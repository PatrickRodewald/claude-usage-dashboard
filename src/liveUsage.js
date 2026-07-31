/**
 * Echte Verbrauchsdaten direkt von Anthropic.
 *
 * Claude Code hinterlegt sein OAuth-Token unter ~/.claude/.credentials.json.
 * Mit diesem Token liefert GET /api/oauth/usage die tatsaechliche Auslastung
 * des Abos - dieselbe Quelle, aus der auch der /usage-Befehl in Claude Code
 * speist. Damit entfaellt jedes Raten ueber Token-Budgets.
 *
 * Grundsaetze:
 *  - Das Token wird bei JEDEM Aufruf frisch von der Platte gelesen. Claude Code
 *    rotiert es selbst; wir schreiben die Datei niemals und erneuern auch
 *    nichts, sonst wuerden wir Claude Codes eigene Sitzung stoeren.
 *  - Das Token verlaesst den Rechner nur Richtung api.anthropic.com und wird
 *    nirgends geloggt.
 *  - Faellt der Abruf aus (offline, Token abgelaufen, Endpunkt geaendert),
 *    degradiert das Dashboard auf die lokale Schaetzung statt zu scheitern.
 *
 * Der Endpunkt ist nicht Teil der oeffentlich dokumentierten API. Er kann sich
 * ohne Ankuendigung aendern - deshalb defensives Parsen und ein Schalter in
 * der config.json.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile';

export const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

/** Kandidatenpfade fuer die Zugangsdaten (analog zur Transkript-Suche). */
export function credentialPaths({ env = process.env, home = os.homedir() } = {}) {
  const dirs = [];
  if (env.CLAUDE_CONFIG_DIR) {
    for (const part of env.CLAUDE_CONFIG_DIR.split(path.delimiter)) {
      if (part.trim()) dirs.push(part.trim());
    }
  }
  dirs.push(path.join(home, '.claude'));
  dirs.push(path.join(home, '.config', 'claude'));
  return dirs.map((d) => path.join(d, '.credentials.json'));
}

/**
 * Zugangsdaten lesen. Gibt niemals das Token in einem Fehlertext zurueck.
 * @returns {{token: string, expiresAt: number, subscriptionType: string|null,
 *            rateLimitTier: string|null}|null}
 */
export function readCredentials(opts = {}) {
  for (const file of credentialPaths(opts)) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    try {
      const oauth = JSON.parse(raw)?.claudeAiOauth;
      if (!oauth?.accessToken) continue;
      return {
        token: oauth.accessToken,
        expiresAt: Number(oauth.expiresAt) || 0,
        subscriptionType: oauth.subscriptionType ?? null,
        rateLimitTier: oauth.rateLimitTier ?? null,
      };
    } catch {
      // Beschaedigte Datei - naechsten Kandidaten probieren.
    }
  }
  return null;
}

export const PLAN_LABEL = { pro: 'Pro', max5x: 'Max 5×', max20x: 'Max 20×' };

/**
 * Tarif aus den Angaben der Zugangsdaten ableiten.
 *
 * rateLimitTier sieht z. B. so aus: "default_claude_max_5x". Bewusst per
 * Mustererkennung statt fester Liste, damit neue Tarifnamen nicht sofort
 * zu "unbekannt" fuehren. Greift auch offline, weil die Werte lokal in
 * .credentials.json stehen und keinen API-Aufruf brauchen.
 */
export function planFromTier(rateLimitTier, subscriptionType) {
  const tier = String(rateLimitTier ?? '').toLowerCase();
  if (tier) {
    if (/20\s*x/.test(tier)) return 'max20x';
    if (/5\s*x/.test(tier)) return 'max5x';
    if (tier.includes('pro')) return 'pro';
  }
  const sub = String(subscriptionType ?? '').toLowerCase();
  if (sub === 'pro') return 'pro';
  // "max" ohne Stufenangabe: nicht raten, welche Stufe.
  return null;
}

/** Prozentwert defensiv einlesen (die API liefert 0-100, ggf. als String). */
function pct(value) {
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

function parseTime(value) {
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/**
 * Ein Limit-Fenster aus der API-Antwort normalisieren.
 * Aus resets_at und der bekannten Fensterlaenge laesst sich der Fensterstart
 * rekonstruieren - Grundlage fuer Burn-Rate und Prognose auf echten Zahlen.
 */
function toWindow(raw, windowMs, extra = {}) {
  if (!raw) return null;
  const percent = pct(raw.utilization ?? raw.percent);
  const end = parseTime(raw.resets_at);
  if (percent == null || end == null) return null;
  return {
    percent,
    end,
    start: end - windowMs,
    severity: typeof raw.severity === 'string' ? raw.severity : null,
    ...extra,
  };
}

/**
 * Aktuelle Auslastung abrufen.
 * Wirft nicht - Fehler landen als { ok: false, reason } im Rueckgabewert.
 */
export async function fetchLiveUsage({
  now = Date.now(),
  timeoutMs = 6000,
  credentials,
  fetchImpl = globalThis.fetch,
  usageUrl = USAGE_URL,
} = {}) {
  // undefined = von der Platte lesen; null = ausdruecklich keine (fuer Tests
  // und fuer Aufrufer, die die Datei schon selbst geprueft haben).
  const cred = credentials === undefined ? readCredentials() : credentials;
  if (!cred) {
    return { ok: false, reason: 'no-credentials', fetchedAt: now };
  }

  // Tarifangaben stehen lokal in den Zugangsdaten und werden deshalb AUCH bei
  // gescheitertem Abruf mitgegeben - das Dashboard kennt den richtigen Plan
  // dann selbst offline.
  const planInfo = {
    subscriptionType: cred.subscriptionType ?? null,
    rateLimitTier: cred.rateLimitTier ?? null,
  };

  if (cred.expiresAt && cred.expiresAt <= now) {
    // Nicht selbst erneuern: Claude Code verwaltet das Token. Beim naechsten
    // Start/Refresh lesen wir es automatisch frisch von der Platte.
    return {
      ok: false,
      reason: 'token-expired',
      fetchedAt: now,
      expiredAt: cred.expiresAt,
      ...planInfo,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(usageUrl, {
      headers: {
        Authorization: `Bearer ${cred.token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'anthropic-version': '2023-06-01',
      },
      signal: controller.signal,
    });
  } catch (err) {
    return {
      ok: false,
      reason: err?.name === 'AbortError' ? 'timeout' : 'network',
      fetchedAt: now,
      ...planInfo,
    };
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: 'unauthorized', status: res.status, fetchedAt: now, ...planInfo };
  }
  if (!res.ok) {
    // Retry-After respektieren, wenn der Server einen Wert nennt.
    const header = Number(res.headers?.get?.('retry-after'));
    return {
      ok: false,
      reason: res.status === 429 ? 'rate-limited' : 'http-error',
      status: res.status,
      retryAfterMs: Number.isFinite(header) && header > 0 ? header * 1000 : null,
      fetchedAt: now,
      ...planInfo,
    };
  }

  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: 'bad-json', fetchedAt: now, ...planInfo };
  }

  return parseUsageBody(body, { now, cred });
}

/** Antwortkoerper in die Dashboard-Form bringen (separat, damit testbar). */
export function parseUsageBody(body, { now = Date.now(), cred = null } = {}) {
  if (!body || typeof body !== 'object') {
    return { ok: false, reason: 'bad-json', fetchedAt: now };
  }

  const limits = Array.isArray(body.limits) ? body.limits : [];
  const byKind = (kind) => limits.find((l) => l?.kind === kind) ?? null;

  const sessionLimit = byKind('session');
  const weeklyLimit = byKind('weekly_all');

  // five_hour/seven_day und limits[] sind redundant; limits[] traegt zusaetzlich
  // severity und is_active, deshalb hat es Vorrang.
  const fiveHour =
    toWindow(sessionLimit, 5 * HOUR_MS, { isActive: sessionLimit?.is_active ?? null }) ??
    toWindow(body.five_hour, 5 * HOUR_MS);
  const week =
    toWindow(weeklyLimit, 7 * DAY_MS, { isActive: weeklyLimit?.is_active ?? null }) ??
    toWindow(body.seven_day, 7 * DAY_MS);

  if (!fiveHour && !week) {
    return { ok: false, reason: 'unexpected-shape', fetchedAt: now };
  }

  // Modellspezifische Wochenlimits (z. B. ein eigenes Kontingent fuer Fable).
  const scoped = limits
    .filter((l) => l?.kind === 'weekly_scoped')
    .map((l) => ({
      label: l?.scope?.model?.display_name ?? l?.scope?.model?.name ?? 'unbekannt',
      percent: pct(l.percent),
      end: parseTime(l.resets_at),
      severity: typeof l.severity === 'string' ? l.severity : null,
    }))
    .filter((l) => l.percent != null);

  const spend = body.spend
    ? {
        percent: pct(body.spend.percent),
        enabled: body.spend.enabled === true,
        usedMinor: body.spend.used?.amount_minor ?? null,
        currency: body.spend.used?.currency ?? null,
        exponent: body.spend.used?.exponent ?? 2,
      }
    : null;

  const extraUsage = body.extra_usage
    ? {
        enabled: body.extra_usage.is_enabled === true,
        spendLimitReached: body.extra_usage.spend_limit_reached === true,
      }
    : null;

  return {
    ok: true,
    fetchedAt: now,
    fiveHour,
    week,
    scoped,
    spend,
    extraUsage,
    subscriptionType: cred?.subscriptionType ?? null,
    rateLimitTier: cred?.rateLimitTier ?? null,
  };
}

/**
 * Burn-Rate und Prognose auf Basis der ECHTEN Auslastung.
 *
 * Bezugsgroesse ist Prozent pro Minute seit Fensterbeginn - unabhaengig davon,
 * wie Anthropic intern gewichtet. Genau deshalb ist diese Prognose belastbarer
 * als eine aus lokalen Tokenzahlen abgeleitete.
 */
export function projectFromUtilization(win, now = Date.now()) {
  if (!win || win.percent == null) return null;
  const elapsedMin = Math.max((now - win.start) / 60_000, 1);
  const perMin = win.percent / elapsedMin;
  if (win.percent >= 100) {
    return { percentPerMinute: perMin, atMs: now, beforeReset: true, alreadyReached: true };
  }
  if (perMin <= 0) return { percentPerMinute: 0, atMs: null, beforeReset: false, alreadyReached: false };
  const minutes = (100 - win.percent) / perMin;
  const atMs = now + minutes * 60_000;
  return {
    percentPerMinute: perMin,
    minutesRemaining: minutes,
    atMs,
    beforeReset: atMs < win.end,
    alreadyReached: false,
  };
}

export const REASON_TEXT = {
  'no-credentials': 'Keine Claude-Code-Zugangsdaten gefunden – bist du eingeloggt?',
  'token-expired': 'Zugangstoken abgelaufen – Claude Code erneuert es beim nächsten Start.',
  unauthorized: 'Zugangstoken abgelehnt – in Claude Code neu anmelden.',
  timeout: 'Zeitüberschreitung beim Abruf.',
  network: 'Keine Verbindung zu api.anthropic.com.',
  'rate-limited': 'Zu viele Abrufe – Anthropic drosselt. Es wird automatisch später erneut versucht.',
  'http-error': 'Unerwartete Antwort von Anthropic.',
  'bad-json': 'Antwort von Anthropic nicht lesbar.',
  'unexpected-shape': 'Antwortformat von Anthropic hat sich geändert.',
  disabled: 'Live-Abruf in der config.json deaktiviert.',
};
