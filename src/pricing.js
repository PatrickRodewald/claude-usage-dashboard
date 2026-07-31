/**
 * Kostenberechnung auf Basis der lokalen Preistabelle (pricing.json).
 *
 * Wichtig: Cache-Writes werden nach TTL getrennt abgerechnet. Ein 1-Stunden-
 * Cache-Write kostet 2,0x Input, ein 5-Minuten-Write nur 1,25x. In echten
 * Claude-Code-Transkripten ist praktisch alles 1h - wer pauschal mit 1,25x
 * rechnet, unterschaetzt diesen Posten um 37 %.
 */

export const EMPTY_TOTALS = Object.freeze({
  input: 0,
  output: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
});

/** Summiert Token-Felder zweier Objekte (mutiert das Ziel). */
export function addTokens(target, src) {
  target.input += src.input || 0;
  target.output += src.output || 0;
  target.cacheWrite5m += src.cacheWrite5m || 0;
  target.cacheWrite1h += src.cacheWrite1h || 0;
  target.cacheRead += src.cacheRead || 0;
  return target;
}

export function newTotals() {
  return { ...EMPTY_TOTALS };
}

/** Gesamt-Tokens (Rohsumme aller Kategorien). */
export function totalTokens(t) {
  return (
    (t.input || 0) +
    (t.output || 0) +
    (t.cacheWrite5m || 0) +
    (t.cacheWrite1h || 0) +
    (t.cacheRead || 0)
  );
}

/** Gewichtete Tokens - so wird gegen das geschaetzte Abo-Limit gezaehlt. */
export function weightedTokens(t, weights) {
  const w = weights || {};
  const wIn = w.input ?? 1;
  const wOut = w.output ?? 1;
  const wWrite = w.cacheWrite ?? 1;
  const wRead = w.cacheRead ?? 0;
  return (
    (t.input || 0) * wIn +
    (t.output || 0) * wOut +
    ((t.cacheWrite5m || 0) + (t.cacheWrite1h || 0)) * wWrite +
    (t.cacheRead || 0) * wRead
  );
}

/** Cache-Trefferquote: Anteil der aus dem Cache gelesenen Input-Tokens. */
export function cacheHitRate(t) {
  const writes = (t.cacheWrite5m || 0) + (t.cacheWrite1h || 0);
  const denom = (t.cacheRead || 0) + writes + (t.input || 0);
  return denom === 0 ? 0 : (t.cacheRead || 0) / denom;
}

export function createPricing(table) {
  const models = table?.models ?? {};
  const aliases = table?.aliases ?? {};
  const ignore = new Set(table?.ignoreModels?.list ?? []);

  /** Modellname auf einen Tabellen-Eintrag aufloesen (inkl. Alias + Datums-Suffix). */
  function resolveName(model) {
    if (!model) return null;
    if (models[model]) return model;
    const alias = aliases[model];
    if (typeof alias === 'string' && models[alias]) return alias;
    // Datierte Varianten wie "claude-opus-5-20260401" auf die Basis-ID kuerzen.
    const stripped = model.replace(/-\d{8}$/, '');
    if (models[stripped]) return stripped;
    return null;
  }

  /**
   * Aktive Tarife fuer ein Modell.
   * Beruecksichtigt Fast-Mode (usage.speed === 'fast') und befristete
   * Einfuehrungspreise (promo.until), damit historische Eintraege korrekt
   * bepreist bleiben, auch wenn die Aktion inzwischen abgelaufen ist.
   */
  function rateFor(model, { speed = 'standard', timestampMs = Date.now() } = {}) {
    const name = resolveName(model);
    if (!name) return null;
    const entry = models[name];

    let rates = entry;
    if (speed === 'fast' && entry.fast) rates = entry.fast;

    const promo = entry.promo;
    if (promo && speed !== 'fast') {
      const until = Date.parse(promo.until);
      if (Number.isFinite(until) && timestampMs <= until) rates = promo;
    }

    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return {
      model: name,
      input: num(rates.input),
      output: num(rates.output),
      cacheWrite5m: num(rates.cacheWrite5m),
      cacheWrite1h: num(rates.cacheWrite1h),
      cacheRead: num(rates.cacheRead),
    };
  }

  /**
   * Kosten in USD fuer einen Token-Satz.
   * Rueckgabe { cost, known }. Bei unbekanntem Modell: cost 0, known false -
   * die App zeigt dann "Preis unbekannt" statt abzustuerzen.
   */
  function costFor(tokens, model, opts) {
    const r = rateFor(model, opts);
    if (!r) return { cost: 0, known: false, model: null };
    const per = 1e6;
    const cost =
      ((tokens.input || 0) * r.input +
        (tokens.output || 0) * r.output +
        (tokens.cacheWrite5m || 0) * r.cacheWrite5m +
        (tokens.cacheWrite1h || 0) * r.cacheWrite1h +
        (tokens.cacheRead || 0) * r.cacheRead) /
      per;
    return { cost, known: true, model: r.model };
  }

  return {
    resolveName,
    rateFor,
    costFor,
    isIgnored: (model) => ignore.has(model),
    knownModels: () => Object.keys(models),
  };
}
