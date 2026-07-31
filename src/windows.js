/**
 * Fensterlogik: rollierendes 5-Stunden-Fenster und Wochenfenster.
 *
 * Das 5h-Fenster ist als "Session-Block" modelliert (wie ccusage): der Block
 * beginnt mit der ersten Nachricht nach einer Pause, abgerundet auf die volle
 * Stunde, und laeuft dann fest 5 Stunden. Anthropic legt die genaue Mechanik
 * nicht offen; das ist die etablierte Naeherung.
 */

import { newTotals, addTokens, weightedTokens } from './pricing.js';
import { startOfWeekWindow, endOfWeekWindow, getZonedParts, zonedToUtc } from './tz.js';

export const HOUR_MS = 3600_000;

/** Auf die volle Stunde abrunden (UTC). */
export function floorToHour(ms) {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

/**
 * Eintraege in 5-Stunden-Session-Bloecke gruppieren.
 *
 * Ein neuer Block beginnt, wenn seit dem Blockstart >= blockHours vergangen
 * sind ODER seit der letzten Aktivitaet >= blockHours Pause war.
 *
 * @param entries chronologisch sortierbare Eintraege
 */
export function buildSessionBlocks(entries, { blockHours = 5, anchorToFullHour = true } = {}) {
  const blockMs = blockHours * HOUR_MS;
  const sorted = [...entries].sort((a, b) => a.ts - b.ts);
  const blocks = [];
  let current = null;

  for (const e of sorted) {
    const needsNew =
      !current || e.ts - current.start >= blockMs || e.ts - current.lastActivity >= blockMs;

    if (needsNew) {
      current = {
        start: anchorToFullHour ? floorToHour(e.ts) : e.ts,
        end: 0,
        firstActivity: e.ts,
        lastActivity: e.ts,
        entryCount: 0,
        tokens: newTotals(),
        models: new Set(),
      };
      current.end = current.start + blockMs;
      blocks.push(current);
    }

    current.lastActivity = e.ts;
    current.entryCount++;
    addTokens(current.tokens, e);
    current.models.add(e.model);
  }

  return blocks.map((b) => ({ ...b, models: [...b.models] }));
}

/**
 * Der aktuell laufende Block, falls es einen gibt.
 * Aktiv heisst: das Fenster ist noch nicht abgelaufen UND die letzte
 * Aktivitaet liegt nicht laenger als die Fensterlaenge zurueck.
 */
export function activeBlock(blocks, nowMs, { blockHours = 5 } = {}) {
  const blockMs = blockHours * HOUR_MS;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (nowMs < b.end && nowMs - b.lastActivity < blockMs) return b;
  }
  return null;
}

/** Aktuelles Wochenfenster in lokaler Zeit. */
export function currentWeekWindow(nowMs, timeZone, weekCfg) {
  const start = startOfWeekWindow(nowMs, timeZone, weekCfg);
  const end = endOfWeekWindow(start, timeZone);
  return { start, end };
}

/** Alle abgeschlossenen und laufenden Wochenfenster ueber einen Eintragsatz. */
export function weekWindowsFor(entries, timeZone, weekCfg, nowMs) {
  const map = new Map();
  for (const e of entries) {
    const start = startOfWeekWindow(e.ts, timeZone, weekCfg);
    let bucket = map.get(start);
    if (!bucket) {
      bucket = { start, end: endOfWeekWindow(start, timeZone), tokens: newTotals(), entryCount: 0 };
      map.set(start, bucket);
    }
    addTokens(bucket.tokens, e);
    bucket.entryCount++;
  }
  const current = startOfWeekWindow(nowMs, timeZone, weekCfg);
  if (!map.has(current)) {
    map.set(current, {
      start: current,
      end: endOfWeekWindow(current, timeZone),
      tokens: newTotals(),
      entryCount: 0,
    });
  }
  return [...map.values()].sort((a, b) => a.start - b.start);
}

/**
 * Burn-Rate in gewichteten Tokens pro Minute.
 *
 * Bezugszeitraum ist die tatsaechlich verstrichene Zeit im Fenster
 * (Fensterstart bis jetzt), nicht die Spanne zwischen erster und letzter
 * Nachricht - sonst schiessen kurze, dichte Bursts auf absurde Werte hoch.
 */
export function burnRate(tokens, windowStartMs, nowMs, weights, { minMinutes = 1 } = {}) {
  const minutes = Math.max((nowMs - windowStartMs) / 60_000, minMinutes);
  return weightedTokens(tokens, weights) / minutes;
}

/**
 * Prognose: wann wird das Limit bei aktueller Rate erreicht?
 * Gibt null zurueck, wenn die Rate 0 ist, das Limit unbekannt ist oder das
 * Limit vor dem regulaeren Reset nicht mehr erreicht wird.
 */
export function projectLimitHit({ used, limit, ratePerMinute, nowMs, windowEndMs }) {
  if (!Number.isFinite(limit) || limit <= 0) return null;
  if (!Number.isFinite(ratePerMinute) || ratePerMinute <= 0) return null;
  const remaining = limit - used;
  if (remaining <= 0) return { atMs: nowMs, beforeReset: true, alreadyReached: true };
  const minutes = remaining / ratePerMinute;
  const atMs = nowMs + minutes * 60_000;
  return {
    atMs,
    minutesRemaining: minutes,
    beforeReset: atMs < windowEndMs,
    alreadyReached: false,
  };
}

/** Zivil-Monat verschieben, ohne ueber Monatslaengen zu stolpern. */
function shiftCivilMonths({ year, month }, delta) {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/**
 * Aktueller Abrechnungszeitraum des Abos.
 *
 * billingDay wird auf 1-28 begrenzt: ein Abo, das am 31. beginnt, haette in
 * kurzen Monaten keinen Starttag - lieber eine klare Begrenzung als eine stille
 * Verschiebung um ein bis drei Tage.
 */
export function billingPeriod(nowMs, timeZone, { billingDay = 1 } = {}) {
  const day = Math.min(28, Math.max(1, Math.round(Number(billingDay) || 1)));
  const p = getZonedParts(nowMs, timeZone);
  const base = p.day >= day ? { year: p.year, month: p.month } : shiftCivilMonths(p, -1);
  const start = zonedToUtc({ ...base, day, hour: 0, minute: 0, second: 0 }, timeZone);
  const end = zonedToUtc({ ...shiftCivilMonths(base, 1), day, hour: 0, minute: 0, second: 0 }, timeZone);
  return { start, end };
}

/** Warnstufe aus dem Prozentanteil ableiten. */
export function warnLevel(percent, { warnPercent = 70, criticalPercent = 90 } = {}) {
  if (!Number.isFinite(percent)) return 'unknown';
  if (percent >= criticalPercent) return 'critical';
  if (percent >= warnPercent) return 'warn';
  return 'ok';
}
