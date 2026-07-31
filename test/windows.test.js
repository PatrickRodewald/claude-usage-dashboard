import test from 'node:test';
import assert from 'node:assert/strict';

import {
  tzOffsetMs,
  zonedToUtc,
  dayKey,
  startOfDay,
  startOfWeekWindow,
  endOfWeekWindow,
  lastNDayKeys,
  zonedWeekday,
  getZonedParts,
} from '../src/tz.js';
import {
  buildSessionBlocks,
  activeBlock,
  currentWeekWindow,
  burnRate,
  projectLimitHit,
  warnLevel,
  floorToHour,
  HOUR_MS,
} from '../src/windows.js';

const TZ = 'Europe/Berlin';
const MIN = 60_000;
const iso = (s) => Date.parse(s);

// 2026: Sommerzeitbeginn So 29.03. (02:00 -> 03:00), Ende So 25.10. (03:00 -> 02:00)

// --- Zeitzone / Sommerzeit -----------------------------------------------

test('UTC-Offset Berlin: +1h im Winter, +2h im Sommer', () => {
  assert.equal(tzOffsetMs(iso('2026-01-15T12:00:00Z'), TZ), 1 * HOUR_MS);
  assert.equal(tzOffsetMs(iso('2026-07-15T12:00:00Z'), TZ), 2 * HOUR_MS);
});

test('Offset kippt exakt am Umstellungszeitpunkt', () => {
  assert.equal(tzOffsetMs(iso('2026-03-29T00:59:59Z'), TZ), 1 * HOUR_MS);
  assert.equal(tzOffsetMs(iso('2026-03-29T01:00:00Z'), TZ), 2 * HOUR_MS);
  assert.equal(tzOffsetMs(iso('2026-10-25T00:59:59Z'), TZ), 2 * HOUR_MS);
  assert.equal(tzOffsetMs(iso('2026-10-25T01:00:00Z'), TZ), 1 * HOUR_MS);
});

test('zonedToUtc rechnet Ortszeit korrekt zurueck', () => {
  assert.equal(zonedToUtc({ year: 2026, month: 1, day: 15, hour: 13 }, TZ), iso('2026-01-15T12:00:00Z'));
  assert.equal(zonedToUtc({ year: 2026, month: 7, day: 15, hour: 14 }, TZ), iso('2026-07-15T12:00:00Z'));
});

test('nicht existierende Ortszeit (Sprung vorwaerts) wirft nicht', () => {
  // 29.03.2026 02:30 gibt es in Berlin nicht.
  const ts = zonedToUtc({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 }, TZ);
  assert.ok(Number.isFinite(ts));
  assert.equal(dayKey(ts, TZ), '2026-03-29');
});

test('doppelte Ortszeit (Sprung rueckwaerts) liefert einen gueltigen Instant', () => {
  const ts = zonedToUtc({ year: 2026, month: 10, day: 25, hour: 2, minute: 30 }, TZ);
  assert.ok(Number.isFinite(ts));
  assert.equal(dayKey(ts, TZ), '2026-10-25');
});

test('Tag der Sommerzeit-Umstellung hat 23 bzw. 25 Stunden', () => {
  const springStart = startOfDay(iso('2026-03-29T12:00:00Z'), TZ);
  const springNext = startOfDay(iso('2026-03-30T12:00:00Z'), TZ);
  assert.equal(springNext - springStart, 23 * HOUR_MS, '29.03. ist 23h lang');

  const fallStart = startOfDay(iso('2026-10-25T12:00:00Z'), TZ);
  const fallNext = startOfDay(iso('2026-10-26T12:00:00Z'), TZ);
  assert.equal(fallNext - fallStart, 25 * HOUR_MS, '25.10. ist 25h lang');
});

test('dayKey ordnet nach Ortszeit, nicht nach UTC', () => {
  // 22:30 UTC ist im Sommer bereits 00:30 des Folgetags in Berlin.
  assert.equal(dayKey(iso('2026-07-30T22:30:00Z'), TZ), '2026-07-31');
  assert.equal(dayKey(iso('2026-07-30T21:30:00Z'), TZ), '2026-07-30');
  // Im Winter kippt es eine Stunde spaeter.
  assert.equal(dayKey(iso('2026-01-30T23:30:00Z'), TZ), '2026-01-31');
  assert.equal(dayKey(iso('2026-01-30T22:30:00Z'), TZ), '2026-01-30');
});

test('lastNDayKeys liefert n aufsteigende Tage inkl. heute', () => {
  const keys = lastNDayKeys(iso('2026-03-02T12:00:00Z'), TZ, 4);
  assert.deepEqual(keys, ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
});

test('lastNDayKeys ueberspringt keinen Tag ueber die Sommerzeitgrenze', () => {
  const keys = lastNDayKeys(iso('2026-03-30T12:00:00Z'), TZ, 4);
  assert.deepEqual(keys, ['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30']);
});

// --- Wochenfenster --------------------------------------------------------

const MONDAY_MIDNIGHT = { resetWeekday: 1, resetHour: 0, resetMinute: 0 };

test('Wochenfenster startet beim letzten Reset-Zeitpunkt', () => {
  const now = iso('2026-07-31T10:00:00Z'); // Freitag
  assert.equal(zonedWeekday(now, TZ), 5);
  const start = startOfWeekWindow(now, TZ, MONDAY_MIDNIGHT);
  assert.equal(start, iso('2026-07-26T22:00:00Z')); // Mo 27.07. 00:00 Berlin
  assert.equal(dayKey(start, TZ), '2026-07-27');
});

test('exakt zur Reset-Zeit beginnt bereits die neue Woche', () => {
  const atReset = zonedToUtc({ year: 2026, month: 7, day: 27, hour: 0 }, TZ);
  assert.equal(startOfWeekWindow(atReset, TZ, MONDAY_MIDNIGHT), atReset);
  assert.equal(
    startOfWeekWindow(atReset - 1, TZ, MONDAY_MIDNIGHT),
    zonedToUtc({ year: 2026, month: 7, day: 20, hour: 0 }, TZ),
    'eine Millisekunde davor gehoert noch zur Vorwoche',
  );
});

test('Wochenfenster mit Sommerzeit-Umstellung ist 167h lang, Reset bleibt 00:00', () => {
  // Woche Mo 23.03. - Mo 30.03.2026; dazwischen faellt eine Stunde weg.
  const now = iso('2026-03-25T12:00:00Z');
  const start = startOfWeekWindow(now, TZ, MONDAY_MIDNIGHT);
  const end = endOfWeekWindow(start, TZ);
  assert.equal(start, iso('2026-03-22T23:00:00Z'));
  assert.equal(end, iso('2026-03-29T22:00:00Z'));
  assert.equal(end - start, 167 * HOUR_MS, 'eine Stunde kuerzer als 7 Tage');
  assert.equal(dayKey(end, TZ), '2026-03-30');
  const p = getZonedParts(end, TZ);
  assert.equal(p.hour, 0, 'Reset liegt wieder auf Mitternacht Ortszeit');
  assert.equal(p.minute, 0);
});

test('Wochenfenster im Herbst ist 169h lang', () => {
  const now = iso('2026-10-21T12:00:00Z');
  const start = startOfWeekWindow(now, TZ, MONDAY_MIDNIGHT);
  const end = endOfWeekWindow(start, TZ);
  assert.equal(end - start, 169 * HOUR_MS);
});

test('abweichender Reset-Zeitpunkt wird respektiert', () => {
  // Donnerstag 09:30
  const cfg = { resetWeekday: 4, resetHour: 9, resetMinute: 30 };
  const now = iso('2026-07-31T10:00:00Z'); // Fr 12:00 Berlin
  const { start, end } = currentWeekWindow(now, TZ, cfg);
  assert.equal(start, zonedToUtc({ year: 2026, month: 7, day: 30, hour: 9, minute: 30 }, TZ));
  assert.equal(end, zonedToUtc({ year: 2026, month: 8, day: 6, hour: 9, minute: 30 }, TZ));
  assert.ok(start <= now && now < end);
});

test('am Reset-Tag vor der Reset-Uhrzeit gilt noch die Vorwoche', () => {
  const cfg = { resetWeekday: 4, resetHour: 9, resetMinute: 30 };
  const before = zonedToUtc({ year: 2026, month: 7, day: 30, hour: 9, minute: 0 }, TZ);
  const start = startOfWeekWindow(before, TZ, cfg);
  assert.equal(start, zonedToUtc({ year: 2026, month: 7, day: 23, hour: 9, minute: 30 }, TZ));
});

// --- 5-Stunden-Session-Bloecke -------------------------------------------

const e = (isoTs, tokens = {}) => ({
  ts: iso(isoTs),
  model: 'claude-opus-5',
  input: 0,
  output: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
  ...tokens,
});

test('Blockstart wird auf die volle Stunde abgerundet', () => {
  assert.equal(floorToHour(iso('2026-07-31T09:42:17.500Z')), iso('2026-07-31T09:00:00Z'));
  const [b] = buildSessionBlocks([e('2026-07-31T09:42:00Z')]);
  assert.equal(b.start, iso('2026-07-31T09:00:00Z'));
  assert.equal(b.end, iso('2026-07-31T14:00:00Z'));
  assert.equal(b.firstActivity, iso('2026-07-31T09:42:00Z'));
});

test('ohne Ankern startet der Block exakt bei der ersten Nachricht', () => {
  const [b] = buildSessionBlocks([e('2026-07-31T09:42:00Z')], { anchorToFullHour: false });
  assert.equal(b.start, iso('2026-07-31T09:42:00Z'));
});

test('Nachrichten innerhalb des Fensters bleiben in einem Block', () => {
  const blocks = buildSessionBlocks([
    e('2026-07-31T09:10:00Z'),
    e('2026-07-31T11:00:00Z'),
    e('2026-07-31T13:59:00Z'),
  ]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].entryCount, 3);
});

test('Pause laenger als das Fenster startet einen neuen Block', () => {
  const blocks = buildSessionBlocks([
    e('2026-07-31T09:10:00Z'),
    e('2026-07-31T14:20:00Z'), // 5h10m Pause
  ]);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[1].start, iso('2026-07-31T14:00:00Z'));
});

test('Fensterablauf startet neuen Block auch ohne lange Pause', () => {
  // Durchgehend aktiv, aber ueber die 5h-Grenze des ersten Blocks hinaus.
  const blocks = buildSessionBlocks([
    e('2026-07-31T09:00:00Z'),
    e('2026-07-31T11:00:00Z'),
    e('2026-07-31T13:30:00Z'),
    e('2026-07-31T14:30:00Z'), // > 09:00 + 5h
  ]);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].end, iso('2026-07-31T14:00:00Z'));
  assert.equal(blocks[1].start, iso('2026-07-31T14:00:00Z'));
});

test('Bloecke summieren Tokens und sammeln Modelle', () => {
  const blocks = buildSessionBlocks([
    e('2026-07-31T09:00:00Z', { output: 100, cacheRead: 5 }),
    { ...e('2026-07-31T10:00:00Z', { output: 50 }), model: 'claude-haiku-4-5' },
  ]);
  assert.equal(blocks[0].tokens.output, 150);
  assert.equal(blocks[0].tokens.cacheRead, 5);
  assert.deepEqual(blocks[0].models.sort(), ['claude-haiku-4-5', 'claude-opus-5']);
});

test('unsortierte Eingabe wird korrekt gruppiert', () => {
  const blocks = buildSessionBlocks([
    e('2026-07-31T13:00:00Z'),
    e('2026-07-31T09:00:00Z'),
    e('2026-07-31T11:00:00Z'),
  ]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].start, iso('2026-07-31T09:00:00Z'));
});

test('leere Eingabe ergibt keine Bloecke', () => {
  assert.deepEqual(buildSessionBlocks([]), []);
});

// --- Aktiver Block --------------------------------------------------------

test('aktiver Block wird erkannt, solange das Fenster laeuft', () => {
  const blocks = buildSessionBlocks([e('2026-07-31T09:10:00Z')]);
  assert.ok(activeBlock(blocks, iso('2026-07-31T12:00:00Z')));
});

test('kein aktiver Block nach Fensterablauf', () => {
  const blocks = buildSessionBlocks([e('2026-07-31T09:10:00Z')]);
  assert.equal(activeBlock(blocks, iso('2026-07-31T14:00:01Z')), null);
});

test('kein aktiver Block, wenn die letzte Aktivitaet zu lange her ist', () => {
  const blocks = buildSessionBlocks([e('2026-07-31T09:10:00Z')], { anchorToFullHour: false });
  // Fenster laeuft bis 14:10, aber Inaktivitaet > 5h ab 14:10.
  assert.equal(activeBlock(blocks, iso('2026-07-31T14:11:00Z')), null);
});

// --- Burn-Rate und Prognose ----------------------------------------------

test('Burn-Rate bezieht sich auf die verstrichene Fensterzeit', () => {
  const tokens = { input: 0, output: 6000, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };
  const start = iso('2026-07-31T09:00:00Z');
  const now = start + 60 * MIN;
  assert.equal(burnRate(tokens, start, now, { output: 1, cacheRead: 0 }), 100);
});

test('Burn-Rate explodiert nicht bei sehr kurzem Fenster', () => {
  const tokens = { input: 0, output: 1000, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };
  const start = iso('2026-07-31T09:00:00Z');
  assert.equal(burnRate(tokens, start, start + 1000, {}), 1000, 'Mindestfenster 1 Minute');
});

test('Prognose trifft den Zeitpunkt des Limit-Erreichens', () => {
  const now = iso('2026-07-31T10:00:00Z');
  const p = projectLimitHit({
    used: 4000,
    limit: 10000,
    ratePerMinute: 100,
    nowMs: now,
    windowEndMs: now + 5 * HOUR_MS,
  });
  assert.equal(p.minutesRemaining, 60);
  assert.equal(p.atMs, now + 60 * MIN);
  assert.equal(p.beforeReset, true);
});

test('Prognose meldet, wenn das Limit vor dem Reset nicht erreicht wird', () => {
  const now = iso('2026-07-31T10:00:00Z');
  const p = projectLimitHit({
    used: 100,
    limit: 1_000_000,
    ratePerMinute: 10,
    nowMs: now,
    windowEndMs: now + HOUR_MS,
  });
  assert.equal(p.beforeReset, false);
});

test('Prognose bei bereits ueberschrittenem Limit', () => {
  const now = iso('2026-07-31T10:00:00Z');
  const p = projectLimitHit({ used: 12000, limit: 10000, ratePerMinute: 50, nowMs: now, windowEndMs: now + HOUR_MS });
  assert.equal(p.alreadyReached, true);
});

test('Prognose ohne Rate oder ohne Limit ist null', () => {
  const now = iso('2026-07-31T10:00:00Z');
  assert.equal(projectLimitHit({ used: 0, limit: 100, ratePerMinute: 0, nowMs: now, windowEndMs: now }), null);
  assert.equal(projectLimitHit({ used: 0, limit: null, ratePerMinute: 10, nowMs: now, windowEndMs: now }), null);
  assert.equal(projectLimitHit({ used: 0, limit: 0, ratePerMinute: 10, nowMs: now, windowEndMs: now }), null);
});

// --- Warnstufen -----------------------------------------------------------

test('Warnstufen bei 70 % und 90 %', () => {
  const w = { warnPercent: 70, criticalPercent: 90 };
  assert.equal(warnLevel(0, w), 'ok');
  assert.equal(warnLevel(69.9, w), 'ok');
  assert.equal(warnLevel(70, w), 'warn');
  assert.equal(warnLevel(89.9, w), 'warn');
  assert.equal(warnLevel(90, w), 'critical');
  assert.equal(warnLevel(250, w), 'critical');
  assert.equal(warnLevel(null, w), 'unknown');
});
