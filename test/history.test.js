import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  keyHash,
  transcriptId,
  emptyArchive,
  loadArchive,
  saveArchive,
  newRecord,
  applyEntries,
  archiveBuckets,
  hashesExcept,
  pruneArchive,
  mergeForeign,
  addSample,
  fitRatio,
  calibrationSummary,
  HISTORY_VERSION,
} from '../src/history.js';

const iso = (s) => Date.parse(s);
const DAY = 86_400_000;

function tmpFile(name = 'history.json') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cud-hist-'));
  return path.join(dir, name);
}

function entry(isoTs, over = {}) {
  return {
    key: `msg-${isoTs}-${over.tag ?? ''}::req`,
    ts: iso(isoTs),
    model: 'claude-opus-5',
    speed: 'standard',
    project: 'projekt-a',
    cwd: 'c:\\Projekte\\a',
    input: 0,
    output: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0,
    ...over,
  };
}

// --- Schluessel-Hash ------------------------------------------------------

test('keyHash ist stabil und trennt verschiedene Schluessel', () => {
  assert.equal(keyHash('msg_1::req_1'), keyHash('msg_1::req_1'));
  assert.notEqual(keyHash('msg_1::req_1'), keyHash('msg_1::req_2'));
  assert.notEqual(keyHash('msg_1::req_1'), keyHash('msg_2::req_1'));
});

test('keyHash bleibt bei realistischen Mengen kollisionsfrei', () => {
  const set = new Set();
  for (let i = 0; i < 50_000; i++) set.add(keyHash(`msg_01ABCDEFGH${i}::req_XYZ${i}`));
  assert.equal(set.size, 50_000);
});

// --- Datei-Id -------------------------------------------------------------

test('Datei-Id ist plattformunabhaengig - derselbe Verlauf auf Windows und macOS', () => {
  // Genau das macht die Zusammenfuehrung zweier Geraete moeglich: der absolute
  // Pfad unterscheidet sich, die Session-UUID nicht.
  const win = transcriptId('c--Projekte-app', 'C:\\Users\\p\\.claude\\projects\\c--Projekte-app\\abc.jsonl');
  const mac = transcriptId('c--Projekte-app', '/Users/p/.claude/projects/c--Projekte-app/abc.jsonl');
  assert.equal(win, mac);
});

// --- Speichern und Laden --------------------------------------------------

test('Archiv ueberlebt Schreiben und Lesen unveraendert', () => {
  const file = tmpFile();
  const a = emptyArchive();
  a.files['p/x.jsonl'] = applyEntries(newRecord({ project: 'p', path: '/x.jsonl' }), [
    entry('2026-07-31T09:00:00Z', { output: 1000 }),
  ]);
  saveArchive(file, a);

  const b = loadArchive(file);
  assert.equal(b.version, HISTORY_VERSION);
  assert.deepEqual(b.files['p/x.jsonl'].days, a.files['p/x.jsonl'].days);
});

test('fehlendes Archiv ist kein Fehler', () => {
  const a = loadArchive(path.join(os.tmpdir(), 'gibt-es-nicht-4711', 'history.json'));
  assert.deepEqual(a.files, {});
});

test('beschaedigtes Archiv wird verworfen statt falsch gelesen', () => {
  const file = tmpFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ das ist kein json', 'utf8');
  const a = loadArchive(file);
  assert.equal(a.corrupt, true);
  assert.deepEqual(a.files, {});
});

test('unbekannte Archiv-Version wird nicht stillschweigend uebernommen', () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ version: 99, files: { a: { days: {} } } }), 'utf8');
  const a = loadArchive(file);
  assert.equal(a.replaced, 99);
  assert.deepEqual(a.files, {});
});

test('Schreiben laesst bei einem Abbruch keine halbe Datei zurueck', () => {
  // Geschrieben wird in eine .tmp-Datei und dann umbenannt; nach dem Lauf darf
  // keine Zwischendatei liegenbleiben.
  const file = tmpFile();
  saveArchive(file, emptyArchive());
  assert.equal(fs.existsSync(`${file}.tmp`), false);
  assert.equal(fs.existsSync(file), true);
});

// --- Buckets --------------------------------------------------------------

test('Eintraege werden nach Tag, Modell und Geschwindigkeit summiert', () => {
  const rec = applyEntries(newRecord({ project: 'p' }), [
    entry('2026-07-31T09:00:00Z', { output: 100 }),
    entry('2026-07-31T10:00:00Z', { output: 200, tag: 'b' }),
    entry('2026-07-31T11:00:00Z', { output: 300, speed: 'fast', tag: 'c' }),
    entry('2026-07-30T11:00:00Z', { output: 400, tag: 'd' }),
  ]);
  const a = emptyArchive();
  a.files['p/x'] = rec;
  const buckets = archiveBuckets(a);

  assert.equal(buckets.length, 3, '2 Modell-Varianten am 31., 1 am 30.');
  const std31 = buckets.find((b) => b.day === '2026-07-31' && b.speed === 'standard');
  assert.equal(std31.tokens.output, 300);
  assert.equal(std31.count, 2);
  const fast31 = buckets.find((b) => b.day === '2026-07-31' && b.speed === 'fast');
  assert.equal(fast31.tokens.output, 300);
  assert.equal(fast31.count, 1);
});

test('Tage werden nach Ortszeit einsortiert, nicht nach UTC', () => {
  const rec = applyEntries(newRecord({ project: 'p' }), [entry('2026-07-30T22:30:00Z', { output: 5 })], {
    timeZone: 'Europe/Berlin',
  });
  assert.deepEqual(Object.keys(rec.days), ['2026-07-31'], '00:30 Berlin gehoert zum 31.');
});

test('das flachste cwd bestimmt den spaeteren Projektnamen', () => {
  const rec = applyEntries(newRecord({ project: 'p' }), [
    entry('2026-07-31T09:00:00Z', { cwd: 'c:\\Projekte\\app\\src\\components' }),
    entry('2026-07-31T09:01:00Z', { cwd: 'c:\\Projekte\\app', tag: 'b' }),
    entry('2026-07-31T09:02:00Z', { cwd: 'c:\\Projekte\\app\\server', tag: 'c' }),
  ]);
  assert.equal(rec.cwd, 'c:\\Projekte\\app');
});

test('erneutes Einlesen einer Datei verdoppelt die Zahlen nicht', () => {
  // Der Kern der Idempotenz: beim vollstaendigen Neulesen wird der Datensatz
  // ersetzt, nicht ergaenzt. Sonst waechst das Archiv bei jedem Neustart.
  const entries = [entry('2026-07-31T09:00:00Z', { output: 100 })];
  const a = emptyArchive();
  a.files['p/x'] = applyEntries(newRecord({ project: 'p' }), entries);
  const before = archiveBuckets(a)[0].tokens.output;

  a.files['p/x'] = applyEntries(newRecord({ project: 'p' }), entries);
  assert.equal(archiveBuckets(a)[0].tokens.output, before);
});

// --- Hashes ---------------------------------------------------------------

test('hashesExcept blendet die selbst gelesenen Dateien aus', () => {
  const a = emptyArchive();
  a.files['p/gelesen'] = applyEntries(newRecord({ project: 'p' }), [entry('2026-07-31T09:00:00Z')]);
  a.files['p/archiv'] = applyEntries(newRecord({ project: 'p' }), [
    entry('2026-07-01T09:00:00Z', { tag: 'alt' }),
  ]);

  const all = hashesExcept(a, new Set());
  assert.equal(all.size, 2);

  const ohneGelesen = hashesExcept(a, new Set(['p/gelesen']));
  assert.equal(ohneGelesen.size, 1);
  assert.ok(ohneGelesen.has(keyHash(`msg-2026-07-01T09:00:00Z-alt::req`)));
});

// --- Beschneiden ----------------------------------------------------------

test('alte Tage fallen aus dem Archiv, junge bleiben', () => {
  const now = iso('2026-07-31T12:00:00Z');
  const a = emptyArchive();
  a.files['p/x'] = applyEntries(newRecord({ project: 'p' }), [
    entry('2026-07-30T09:00:00Z', { output: 1 }),
    entry('2024-01-05T09:00:00Z', { output: 2, tag: 'uralt' }),
  ]);
  const r = pruneArchive(a, { now, retainDays: 400 });
  assert.equal(r.removedDays, 1);
  assert.deepEqual(Object.keys(a.files['p/x'].days), ['2026-07-30']);
});

test('ein Datensatz ohne Tage verschwindet ganz', () => {
  const a = emptyArchive();
  a.files['p/x'] = applyEntries(newRecord({ project: 'p' }), [entry('2020-01-01T09:00:00Z')]);
  const r = pruneArchive(a, { now: iso('2026-07-31T12:00:00Z'), retainDays: 30 });
  assert.equal(r.removedFiles, 1);
  assert.deepEqual(a.files, {});
});

test('Hashes laengst geloeschter Transkripte werden irgendwann vergessen', () => {
  const now = iso('2026-07-31T12:00:00Z');
  const a = emptyArchive();
  const rec = applyEntries(newRecord({ project: 'p' }), [entry('2026-01-05T09:00:00Z')]);
  rec.path = null; // nicht mehr auf der Platte
  a.files['p/x'] = rec;
  assert.equal(rec.keys.length, 1);

  pruneArchive(a, { now, retainDays: 400, keyDays: 120 });
  assert.equal(a.files['p/x'].keys.length, 0, 'Tage bleiben, Hashes nicht');
  assert.ok(Object.keys(a.files['p/x'].days).length > 0);
});

test('Hashes vorhandener Dateien bleiben unabhaengig vom Alter erhalten', () => {
  const a = emptyArchive();
  const rec = applyEntries(newRecord({ project: 'p', path: '/x.jsonl' }), [
    entry('2026-01-05T09:00:00Z'),
  ]);
  a.files['p/x'] = rec;
  pruneArchive(a, { now: iso('2026-07-31T12:00:00Z'), retainDays: 400, keyDays: 120 });
  assert.equal(a.files['p/x'].keys.length, 1);
});

// --- Fremde Archive -------------------------------------------------------

test('fremdes Archiv wird vereinigt, eigene Datensaetze gewinnen', () => {
  const mine = emptyArchive();
  mine.files['p/a'] = applyEntries(newRecord({ project: 'p', path: '/a' }), [
    entry('2026-07-31T09:00:00Z', { output: 10 }),
  ]);

  const theirs = emptyArchive();
  // Dieselbe Datei (synchronisierter Ordner) - darf nicht doppelt zaehlen.
  theirs.files['p/a'] = applyEntries(newRecord({ project: 'p' }), [
    entry('2026-07-31T09:00:00Z', { output: 10 }),
  ]);
  // Und eine, die es nur dort gibt.
  theirs.files['p/b'] = applyEntries(newRecord({ project: 'p' }), [
    entry('2026-07-31T09:00:00Z', { output: 7, tag: 'fremd' }),
  ]);

  const r = mergeForeign(mine, theirs);
  assert.equal(r.added, 1, 'nur die unbekannte Datei');
  assert.equal(mine.files['p/b'].foreign, true);
  assert.equal(mine.files['p/b'].path, null, 'fremde Datensaetze werden nie gelesen');

  const total = archiveBuckets(mine).reduce((a, b) => a + b.tokens.output, 0);
  assert.equal(total, 17, '10 eigene + 7 fremde, nicht 27');
});

// --- Kalibrierung ---------------------------------------------------------

test('Messpunkte im selben Fenster werden gedrosselt', () => {
  const a = emptyArchive();
  const base = { e: 1000, p: 10, w: 100, c: 1, n: 5 };
  assert.equal(addSample(a, 'fiveHour', { ...base, t: 0 }, { minGapMs: 300_000 }), true);
  assert.equal(
    addSample(a, 'fiveHour', { ...base, t: 60_000 }, { minGapMs: 300_000 }),
    false,
    'eine Minute spaeter im selben Fenster: kein zweiter Punkt',
  );
  assert.equal(addSample(a, 'fiveHour', { ...base, t: 400_000 }, { minGapMs: 300_000 }), true);
  // Neues Fenster darf sofort messen.
  assert.equal(addSample(a, 'fiveHour', { ...base, e: 2000, t: 401_000 }, { minGapMs: 300_000 }), true);
  assert.equal(a.calibration.fiveHour.length, 3);
});

test('die Messreihe waechst nicht unbegrenzt', () => {
  const a = emptyArchive();
  for (let i = 0; i < 50; i++) {
    addSample(a, 'week', { t: i * 1e6, e: i, p: 10, w: 100, c: 1, n: 1 }, { maxSamples: 10 });
  }
  assert.equal(a.calibration.week.length, 10);
  assert.equal(a.calibration.week[9].e, 49, 'die juengsten bleiben');
});

test('Regression durch den Ursprung trifft die Steigung exakt', () => {
  const fit = fitRatio(
    [
      { p: 10, w: 1000 },
      { p: 20, w: 2000 },
      { p: 55, w: 5500 },
    ],
    (s) => s.w,
  );
  assert.ok(Math.abs(fit.perPercent - 100) < 1e-9);
  assert.ok(fit.cv < 1e-9, 'perfekt proportional: keine Streuung');
  assert.equal(fit.n, 3);
});

test('Regression ignoriert unbrauchbare Punkte', () => {
  const fit = fitRatio(
    [
      { p: 0, w: 500 },
      { p: 10, w: 0 },
      { p: 10, w: 1000 },
      { p: 20, w: 2000 },
    ],
    (s) => s.w,
  );
  assert.equal(fit.n, 2);
  assert.ok(Math.abs(fit.perPercent - 100) < 1e-9);
});

test('zu wenige Punkte ergeben keine Regression', () => {
  assert.equal(fitRatio([{ p: 10, w: 100 }], (s) => s.w), null);
  assert.equal(fitRatio([], (s) => s.w), null);
});

test('Kalibrierung greift erst ab genug Punkten aus genug Fenstern', () => {
  const a = emptyArchive();
  // Zwanzig Messungen, aber alle aus EINEM Fenster - das sind keine zwanzig Belege.
  for (let i = 0; i < 20; i++) {
    a.calibration.fiveHour.push({ t: i * 4e5, e: 999, p: 10 + i, w: (10 + i) * 100, c: (10 + i) * 0.5, n: 3 });
  }
  const s = calibrationSummary(a, 'fiveHour', { minSamples: 8, minWindows: 3 });
  assert.equal(s.ok, false);
  assert.equal(s.windows, 1);
  assert.equal(s.limit, null);
});

test('gemessenes Limit ergibt sich aus der Steigung mal 100', () => {
  const a = emptyArchive();
  for (let i = 0; i < 9; i++) {
    a.calibration.fiveHour.push({ t: i * 4e5, e: 100 + i, p: 10, w: 8800, c: 4, n: 3 });
  }
  const s = calibrationSummary(a, 'fiveHour', { minSamples: 8, minWindows: 3 });
  assert.equal(s.ok, true);
  assert.equal(s.windows, 9);
  assert.ok(Math.abs(s.tokensPerPercent - 880) < 1e-9);
  assert.ok(Math.abs(s.limit - 88000) < 1e-6, '1 % = 880 Tokens -> 100 % = 88000');
});

test('erkennt, ob Tokens oder Kosten die Auslastung besser erklaeren', () => {
  // Tokens exakt proportional, Kosten stark schwankend -> Tokens erklaeren besser.
  const a = emptyArchive();
  const wobble = [0.4, 1.9, 0.6, 2.3, 0.5, 1.7, 2.6, 0.3, 1.2, 2.9];
  wobble.forEach((f, i) => {
    a.calibration.fiveHour.push({ t: i * 4e5, e: i, p: 20, w: 20 * 500, c: 20 * f, n: 4 });
  });
  const s = calibrationSummary(a, 'fiveHour', { minSamples: 8, minWindows: 3 });
  assert.equal(s.better, 'tokens');
  assert.ok(s.tokensCv < s.costCv);
});

test('erkennt auch den umgekehrten Fall - Kosten erklaeren besser', () => {
  const a = emptyArchive();
  const wobble = [0.4, 1.9, 0.6, 2.3, 0.5, 1.7, 2.6, 0.3, 1.2, 2.9];
  wobble.forEach((f, i) => {
    a.calibration.fiveHour.push({ t: i * 4e5, e: i, p: 20, w: 20 * 500 * f, c: 20 * 0.25, n: 4 });
  });
  const s = calibrationSummary(a, 'fiveHour', { minSamples: 8, minWindows: 3 });
  assert.equal(s.better, 'cost');
});

test('bei aehnlicher Guete bleibt die Frage offen', () => {
  // Beide Groessen streuen gleich stark - dann ist keine Aussage zu treffen.
  const a = emptyArchive();
  const wobble = [0.7, 1.3, 0.8, 1.4, 0.9, 1.1, 1.5, 0.6, 1.2];
  wobble.forEach((f, i) => {
    a.calibration.fiveHour.push({ t: i * 4e5, e: i, p: 20, w: 20 * 500 * f, c: 20 * 0.25 * f, n: 4 });
  });
  const s = calibrationSummary(a, 'fiveHour', { minSamples: 8, minWindows: 3 });
  assert.ok(Math.abs(s.tokensCv - s.costCv) < 1e-9, 'gleiche relative Streuung');
  assert.equal(s.better, null, 'kein Unterschied -> keine Behauptung');
});

test('ohne Messpunkte meldet die Zusammenfassung ehrlich null', () => {
  const s = calibrationSummary(emptyArchive(), 'week', {});
  assert.equal(s.ok, false);
  assert.equal(s.samples, 0);
  assert.equal(s.tokensPerPercent, null);
  assert.equal(s.limit, null);
});
