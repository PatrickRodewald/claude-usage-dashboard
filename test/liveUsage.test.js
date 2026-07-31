import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseUsageBody,
  projectFromUtilization,
  fetchLiveUsage,
  credentialPaths,
  planFromTier,
  PLAN_LABEL,
  HOUR_MS,
} from '../src/liveUsage.js';

const NOW = Date.parse('2026-07-31T10:00:00Z');
const DAY = 24 * HOUR_MS;

/** Echte Antwort von GET /api/oauth/usage (gekürzt auf die belegten Felder). */
function usageBody(over = {}) {
  return {
    five_hour: { utilization: 35, resets_at: '2026-07-31T11:20:00.966437+00:00' },
    seven_day: { utilization: 13, resets_at: '2026-08-03T21:00:00.966457+00:00' },
    extra_usage: { is_enabled: false, spend_limit_reached: false },
    limits: [
      {
        kind: 'session',
        group: 'session',
        percent: 35,
        severity: 'normal',
        resets_at: '2026-07-31T11:20:00.966437+00:00',
        is_active: true,
      },
      {
        kind: 'weekly_all',
        group: 'weekly',
        percent: 13,
        severity: 'normal',
        resets_at: '2026-08-03T21:00:00.966457+00:00',
        is_active: false,
      },
      {
        kind: 'weekly_scoped',
        group: 'weekly',
        percent: 1,
        severity: 'normal',
        resets_at: '2026-08-03T20:59:59.966723+00:00',
        scope: { model: { display_name: 'Fable' } },
        is_active: false,
      },
    ],
    spend: { used: { amount_minor: 0, currency: 'USD', exponent: 2 }, percent: 0, enabled: false },
    ...over,
  };
}

// --- Antwort auswerten ----------------------------------------------------

test('liest die echten Auslastungswerte aus', () => {
  const r = parseUsageBody(usageBody(), { now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.fiveHour.percent, 35);
  assert.equal(r.week.percent, 13);
  assert.equal(r.fiveHour.end, Date.parse('2026-07-31T11:20:00.966437+00:00'));
});

test('rekonstruiert den Fensterstart aus Reset minus Fensterlaenge', () => {
  const r = parseUsageBody(usageBody(), { now: NOW });
  assert.equal(r.fiveHour.end - r.fiveHour.start, 5 * HOUR_MS);
  assert.equal(r.week.end - r.week.start, 7 * DAY);
});

test('uebernimmt severity und is_active aus limits[]', () => {
  const r = parseUsageBody(usageBody(), { now: NOW });
  assert.equal(r.fiveHour.severity, 'normal');
  assert.equal(r.fiveHour.isActive, true);
  assert.equal(r.week.isActive, false);
});

test('erfasst modellspezifische Wochenlimits', () => {
  const r = parseUsageBody(usageBody(), { now: NOW });
  assert.equal(r.scoped.length, 1);
  assert.equal(r.scoped[0].label, 'Fable');
  assert.equal(r.scoped[0].percent, 1);
});

test('faellt auf five_hour/seven_day zurueck, wenn limits[] fehlt', () => {
  const body = usageBody();
  delete body.limits;
  const r = parseUsageBody(body, { now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.fiveHour.percent, 35);
  assert.equal(r.week.percent, 13);
  assert.deepEqual(r.scoped, []);
});

test('meldet ein geaendertes Antwortformat statt zu raten', () => {
  assert.equal(parseUsageBody({ voellig: 'anders' }, { now: NOW }).reason, 'unexpected-shape');
  assert.equal(parseUsageBody(null, { now: NOW }).reason, 'bad-json');
  assert.equal(parseUsageBody('kein objekt', { now: NOW }).reason, 'bad-json');
});

test('unbrauchbare Zeitangabe verwirft das Fenster, statt NaN zu liefern', () => {
  const body = usageBody({
    limits: [{ kind: 'session', percent: 35, resets_at: 'kaputt' }],
    five_hour: { utilization: 35, resets_at: 'auch kaputt' },
  });
  const r = parseUsageBody(body, { now: NOW });
  assert.equal(r.ok, true, 'die Woche traegt die Antwort weiterhin');
  assert.equal(r.fiveHour, null);
  assert.equal(r.week.percent, 13);
});

test('reicht Tarifangaben aus den Zugangsdaten durch', () => {
  const r = parseUsageBody(usageBody(), {
    now: NOW,
    cred: { subscriptionType: 'max', rateLimitTier: 'default_claude_max_5x' },
  });
  assert.equal(r.subscriptionType, 'max');
  assert.equal(r.rateLimitTier, 'default_claude_max_5x');
});

// --- Prognose auf echten Prozentwerten ------------------------------------

test('Prognose rechnet mit Prozent pro Minute seit Fensterbeginn', () => {
  // Fenster laeuft seit 60 Min., 30 % verbraucht -> 0,5 %/Min. -> 100 % in 140 Min.
  const win = { percent: 30, start: NOW - 60 * 60_000, end: NOW + 4 * HOUR_MS };
  const p = projectFromUtilization(win, NOW);
  assert.equal(p.percentPerMinute, 0.5);
  assert.equal(p.minutesRemaining, 140);
  assert.equal(p.beforeReset, true);
});

test('Prognose erkennt, wenn der Reset vor dem Limit kommt', () => {
  const win = { percent: 5, start: NOW - 60 * 60_000, end: NOW + 30 * 60_000 };
  assert.equal(projectFromUtilization(win, NOW).beforeReset, false);
});

test('Prognose meldet ein bereits erreichtes Limit', () => {
  const win = { percent: 100, start: NOW - 60 * 60_000, end: NOW + HOUR_MS };
  assert.equal(projectFromUtilization(win, NOW).alreadyReached, true);
});

test('Prognose ohne Verbrauch liefert keine Zielzeit', () => {
  const win = { percent: 0, start: NOW - 60 * 60_000, end: NOW + HOUR_MS };
  const p = projectFromUtilization(win, NOW);
  assert.equal(p.percentPerMinute, 0);
  assert.equal(p.atMs, null);
});

test('Prognose ohne Fenster ist null', () => {
  assert.equal(projectFromUtilization(null, NOW), null);
  assert.equal(projectFromUtilization({ percent: null }, NOW), null);
});

// --- Tarif-Erkennung ------------------------------------------------------

test('erkennt den Tarif aus rateLimitTier', () => {
  assert.equal(planFromTier('default_claude_max_5x'), 'max5x');
  assert.equal(planFromTier('default_claude_max_20x'), 'max20x');
  assert.equal(planFromTier('default_claude_pro'), 'pro');
});

test('20x wird nicht faelschlich als 5x gelesen', () => {
  // Reihenfolge der Pruefungen ist hier entscheidend.
  assert.equal(planFromTier('claude_max_20x'), 'max20x');
  assert.notEqual(planFromTier('claude_max_20x'), 'max5x');
});

test('unbekannte Tarifnamen fallen auf subscriptionType zurueck', () => {
  assert.equal(planFromTier('irgendein_neuer_tarif', 'pro'), 'pro');
});

test('"max" ohne Stufenangabe wird nicht geraten', () => {
  // Lieber null (und damit der Wert aus config.json) als die falsche Stufe.
  assert.equal(planFromTier(null, 'max'), null);
  assert.equal(planFromTier('', ''), null);
  assert.equal(planFromTier(undefined, undefined), null);
});

test('Tarifangaben werden auch bei gescheitertem Abruf mitgeliefert', async () => {
  // Sie stehen lokal in .credentials.json - dafuer braucht es kein Netz.
  const cred = { token: 'x', expiresAt: NOW + HOUR_MS, subscriptionType: 'max',
                 rateLimitTier: 'default_claude_max_20x' };
  const r = await fetchLiveUsage({
    now: NOW,
    credentials: cred,
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.equal(r.ok, false);
  assert.equal(r.rateLimitTier, 'default_claude_max_20x');
  assert.equal(planFromTier(r.rateLimitTier, r.subscriptionType), 'max20x');
});

test('auch bei abgelaufenem Token bleibt der Tarif bekannt', async () => {
  const r = await fetchLiveUsage({
    now: NOW,
    credentials: { token: 'x', expiresAt: NOW - 1, rateLimitTier: 'default_claude_pro' },
    fetchImpl: () => assert.fail('kein Abruf erwartet'),
  });
  assert.equal(r.reason, 'token-expired');
  assert.equal(planFromTier(r.rateLimitTier), 'pro');
});

// --- Abruf: Fehlerpfade ---------------------------------------------------

const CRED = { token: 'sk-ant-test', expiresAt: NOW + HOUR_MS };

test('ohne Zugangsdaten wird nicht abgerufen', async () => {
  const r = await fetchLiveUsage({
    now: NOW,
    credentials: null,
    fetchImpl: () => assert.fail('darf nicht aufgerufen werden'),
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-credentials');
});

test('abgelaufenes Token wird nicht selbst erneuert', async () => {
  // Claude Code verwaltet das Token; wir wuerden sonst dessen Sitzung stoeren.
  const r = await fetchLiveUsage({
    now: NOW,
    credentials: { token: 'x', expiresAt: NOW - 1 },
    fetchImpl: () => assert.fail('darf nicht aufgerufen werden'),
  });
  assert.equal(r.reason, 'token-expired');
});

test('401/403 werden als abgelehntes Token gemeldet', async () => {
  for (const status of [401, 403]) {
    const r = await fetchLiveUsage({
      now: NOW,
      credentials: CRED,
      fetchImpl: async () => ({ ok: false, status, json: async () => ({}) }),
    });
    assert.equal(r.reason, 'unauthorized');
    assert.equal(r.status, status);
  }
});

test('Netzwerkfehler wirft nicht, sondern degradiert', async () => {
  const r = await fetchLiveUsage({
    now: NOW,
    credentials: CRED,
    fetchImpl: async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    },
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'network');
});

test('Zeitueberschreitung wird als solche gemeldet', async () => {
  const r = await fetchLiveUsage({
    now: NOW,
    credentials: CRED,
    fetchImpl: async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    },
  });
  assert.equal(r.reason, 'timeout');
});

test('erfolgreicher Abruf sendet Bearer-Token und OAuth-Beta-Header', async () => {
  let seen = null;
  const r = await fetchLiveUsage({
    now: NOW,
    credentials: { ...CRED, rateLimitTier: 'default_claude_max_5x' },
    fetchImpl: async (url, init) => {
      seen = { url, headers: init.headers };
      return { ok: true, status: 200, json: async () => usageBody() };
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.fiveHour.percent, 35);
  assert.equal(seen.url, 'https://api.anthropic.com/api/oauth/usage');
  assert.equal(seen.headers.Authorization, 'Bearer sk-ant-test');
  assert.equal(seen.headers['anthropic-beta'], 'oauth-2025-04-20');
});

test('Zugangsdaten werden an den ueblichen Orten gesucht', () => {
  const norm = (p) => p.replace(/\\/g, '/');
  const paths = credentialPaths({ env: {}, home: '/home/x' }).map(norm);
  assert.ok(paths.some((p) => p.includes('.claude')));
  assert.ok(paths.some((p) => p.includes('.config/claude')));
  assert.ok(paths.every((p) => p.endsWith('.credentials.json')));

  // CLAUDE_CONFIG_DIR hat Vorrang vor den Standardpfaden.
  const withEnv = credentialPaths({
    env: { CLAUDE_CONFIG_DIR: '/eigener/pfad' },
    home: '/home/x',
  }).map(norm);
  assert.ok(withEnv[0].includes('/eigener/pfad'));
});
