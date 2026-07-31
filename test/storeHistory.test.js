/**
 * Der Store gegen echte Dateien auf der Platte: Archiv, Kaltstart,
 * Doppelzaehlung und Kalibrierung.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createStore } from '../src/store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const pricingTable = JSON.parse(fs.readFileSync(path.join(root, 'pricing.json'), 'utf8'));

const DAY = 86_400_000;

function sandbox() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cud-store-'));
  const projects = path.join(base, 'projects');
  fs.mkdirSync(projects, { recursive: true });
  return {
    base,
    projects,
    history: path.join(base, 'history.json'),
    /** Eine Transkript-Zeile schreiben. */
    write(projectDir, fileName, lines) {
      const dir = path.join(projects, projectDir);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, fileName);
      fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
      return file;
    },
    /** Datei-Zeitstempel zurueckdatieren (fuer den Archiv-Test). */
    age(file, days) {
      const t = new Date(Date.now() - days * DAY);
      fs.utimesSync(file, t, t);
    },
  };
}

function line(isoTs, over = {}) {
  const { id = 'msg_1', requestId = 'req_1', output = 1000, cwd = 'c:\\Projekte\\app' } = over;
  return {
    type: 'assistant',
    timestamp: isoTs,
    sessionId: over.sessionId ?? 'sess-1',
    requestId,
    uuid: `u-${id}-${requestId}`,
    cwd,
    message: {
      id,
      model: over.model ?? 'claude-opus-5',
      usage: {
        input_tokens: over.input ?? 0,
        output_tokens: output,
        cache_read_input_tokens: over.cacheRead ?? 0,
        cache_creation_input_tokens: 0,
      },
    },
  };
}

function makeStore(sb, over = {}) {
  return createStore({
    historyFile: sb.history,
    pricingTable,
    config: {
      timezone: 'Europe/Berlin',
      plan: 'max5x',
      liveUsage: { enabled: false },
      history: { enabled: true, detailDays: 45, retainDays: 400, saveIntervalMs: 0, ...over.history },
      calibration: { enabled: true, minSamples: 2, minWindows: 2, minPercent: 1, sampleIntervalMs: 0 },
      limits: { mode: 'auto', autoMinSamples: 3, plans: {} },
      counting: { weights: { input: 1, output: 1, cacheWrite: 1, cacheRead: 0 } },
      window: {},
      week: {},
      warnings: {},
      dataDirs: { only: [sb.projects] },
      ...over.config,
    },
  });
}

// --- Archiv ---------------------------------------------------------------

test('das Archiv ueberlebt den Neustart', async () => {
  const sb = sandbox();
  sb.write('c--Projekte-app', 'a.jsonl', [line('2026-07-20T09:00:00Z', { output: 1234 })]);

  const s1 = makeStore(sb);
  await s1.scan();
  s1.flush();
  assert.equal(s1.snapshot().totals.tokens.output, 1234);

  const s2 = makeStore(sb);
  await s2.scan();
  assert.equal(s2.snapshot().totals.tokens.output, 1234);
});

test('geloeschte Transkripte bleiben im Archiv erhalten', async () => {
  // Der eigentliche Zweck: Claude Code raeumt seine Transkripte selbst auf.
  const sb = sandbox();
  const file = sb.write('c--Projekte-app', 'a.jsonl', [
    line('2026-07-20T09:00:00Z', { output: 5000 }),
  ]);

  const s1 = makeStore(sb);
  await s1.scan();
  s1.flush();

  fs.rmSync(file);

  const s2 = makeStore(sb);
  await s2.scan();
  const snap = s2.snapshot();
  assert.equal(snap.totals.tokens.output, 5000, 'Zahlen bleiben');
  assert.equal(snap.totals.liveRequests, 0, 'aber es gibt keine Transkripte mehr');
  assert.equal(snap.history.archivedOnly, 1);
  assert.equal(snap.byProject.length, 1, 'Projekt bleibt in der Aufschluesselung');
});

test('wiederholtes Einlesen verdoppelt nichts', async () => {
  const sb = sandbox();
  sb.write('c--Projekte-app', 'a.jsonl', [line('2026-07-20T09:00:00Z', { output: 100 })]);

  const s = makeStore(sb);
  await s.scan();
  await s.scan({ force: true });
  await s.scan({ force: true });
  s.flush();
  assert.equal(s.snapshot().totals.tokens.output, 100);

  const s2 = makeStore(sb);
  await s2.scan();
  assert.equal(s2.snapshot().totals.tokens.output, 100, 'auch ueber Neustarts hinweg');
});

test('angehaengte Zeilen kommen dazu, ohne dass alles neu gelesen wird', async () => {
  const sb = sandbox();
  const file = sb.write('c--Projekte-app', 'a.jsonl', [
    line('2026-07-20T09:00:00Z', { output: 100 }),
  ]);
  const s = makeStore(sb);
  await s.scan();
  const bytesAfterFirst = s.stats.bytesReadTotal;

  fs.appendFileSync(
    file,
    JSON.stringify(line('2026-07-20T10:00:00Z', { id: 'msg_2', requestId: 'req_2', output: 50 })) + '\n',
  );
  await s.scan();

  assert.equal(s.snapshot().totals.tokens.output, 150);
  assert.ok(
    s.stats.bytesReadTotal - bytesAfterFirst < bytesAfterFirst,
    'der zweite Lauf liest weniger als der erste',
  );
});

// --- Kaltstart ------------------------------------------------------------

test('lange unveraenderte, vollstaendig archivierte Dateien werden uebersprungen', async () => {
  const sb = sandbox();
  const file = sb.write('c--Projekte-alt', 'alt.jsonl', [
    line('2026-05-01T09:00:00Z', { output: 777 }),
  ]);
  sb.age(file, 60);

  const s1 = makeStore(sb);
  await s1.scan();
  assert.equal(s1.stats.filesSkipped, 0, 'beim ersten Mal muss gelesen werden');
  s1.flush();

  const s2 = makeStore(sb);
  await s2.scan();
  assert.equal(s2.stats.filesSkipped, 1);
  assert.equal(s2.stats.bytesReadTotal, 0, 'kein einziges Byte gelesen');
  assert.equal(s2.snapshot().totals.tokens.output, 777, 'die Zahlen stehen trotzdem da');
});

test('eine geaenderte alte Datei wird sehr wohl wieder gelesen', async () => {
  const sb = sandbox();
  const file = sb.write('c--Projekte-alt', 'alt.jsonl', [
    line('2026-05-01T09:00:00Z', { output: 10 }),
  ]);
  sb.age(file, 60);

  const s1 = makeStore(sb);
  await s1.scan();
  s1.flush();

  fs.appendFileSync(
    file,
    JSON.stringify(line('2026-05-01T10:00:00Z', { id: 'msg_2', requestId: 'req_2', output: 20 })) + '\n',
  );

  const s2 = makeStore(sb);
  await s2.scan();
  assert.equal(s2.stats.filesSkipped, 0);
  assert.equal(s2.snapshot().totals.tokens.output, 30);
});

test('junge Dateien werden immer vollstaendig gelesen - der Detailansichten wegen', async () => {
  const sb = sandbox();
  sb.write('c--Projekte-app', 'a.jsonl', [line('2026-07-20T09:00:00Z', { output: 42 })]);

  const s1 = makeStore(sb);
  await s1.scan();
  s1.flush();

  const s2 = makeStore(sb);
  await s2.scan();
  assert.equal(s2.stats.filesSkipped, 0);
  assert.equal(s2.size, 1, 'Eintrag liegt fuer Tagesverlauf und Sessions im Speicher');
});

// --- Doppelzaehlung -------------------------------------------------------

test('eine abgespaltene Sitzung bringt archivierte Requests nicht ein zweites Mal ein', async () => {
  // Genau der Fall, der ein Archiv sonst still aufblaehen wuerde: --fork-session
  // kopiert die bisherigen Nachrichten in eine neue Datei. Ueberlebt die Kopie
  // das Aufraeumen des Originals nicht, aber das Original wird uebersprungen,
  // taeuchten dieselben Requests zweimal auf.
  const sb = sandbox();
  const original = sb.write('c--Projekte-app', 'original.jsonl', [
    line('2026-05-01T09:00:00Z', { id: 'msg_1', requestId: 'req_1', output: 500 }),
  ]);
  sb.age(original, 60);

  const s1 = makeStore(sb);
  await s1.scan();
  s1.flush();
  assert.equal(s1.snapshot().totals.tokens.output, 500);

  // Die Abspaltung enthaelt dieselbe Nachricht noch einmal, plus eine neue.
  sb.write('c--Projekte-app', 'fork.jsonl', [
    line('2026-05-01T09:00:00Z', { id: 'msg_1', requestId: 'req_1', output: 500 }),
    line('2026-07-20T09:00:00Z', { id: 'msg_2', requestId: 'req_2', output: 300 }),
  ]);

  const s2 = makeStore(sb);
  await s2.scan();
  assert.equal(s2.stats.filesSkipped, 1, 'das Original wird uebersprungen');
  assert.equal(s2.stats.archiveDuplicates, 1, 'die Kopie wird als Duplikat erkannt');
  assert.equal(s2.snapshot().totals.tokens.output, 800, '500 + 300, nicht 1300');
});

test('ohne Archiv greift weiterhin die normale Deduplizierung', async () => {
  const sb = sandbox();
  sb.write('c--Projekte-app', 'a.jsonl', [
    line('2026-07-20T09:00:00Z', { output: 100 }),
    line('2026-07-20T09:00:00Z', { output: 100 }), // dieselbe Zeile, anderer Content-Block
  ]);
  const s = makeStore(sb, { history: { enabled: false } });
  await s.scan();
  assert.equal(s.snapshot().totals.tokens.output, 100);
  assert.equal(s.stats.duplicatesSkipped, 1);
  assert.equal(s.snapshot().history.enabled, false);
});

// --- Mehrere Geraete ------------------------------------------------------

test('das Archiv eines zweiten Geraets wird lesend dazugenommen', async () => {
  const sb = sandbox();
  sb.write('c--Projekte-app', 'a.jsonl', [line('2026-07-20T09:00:00Z', { output: 100 })]);

  // Ein "anderes Geraet" baut sein eigenes Archiv.
  const other = sandbox();
  other.write('c--Projekte-app', 'b.jsonl', [
    line('2026-07-20T09:00:00Z', { id: 'msg_9', requestId: 'req_9', output: 900 }),
  ]);
  const remote = makeStore(other);
  await remote.scan();
  remote.flush();

  const s = makeStore(sb, { history: { merge: [other.history] } });
  await s.scan();
  const snap = s.snapshot();
  assert.equal(snap.totals.tokens.output, 1000, '100 eigene + 900 fremde');
  assert.equal(snap.history.merged, 1);
});

// --- Kalibrierung ---------------------------------------------------------

test('Messpunkte werden gesammelt und ergeben ein gemessenes Limit', async () => {
  const sb = sandbox();
  const now = Date.parse('2026-07-20T12:00:00Z');
  sb.write('c--Projekte-app', 'a.jsonl', [
    line('2026-07-20T09:00:00Z', { output: 4400 }),
    line('2026-07-20T10:00:00Z', { id: 'msg_2', requestId: 'req_2', output: 4400 }),
  ]);

  const s = makeStore(sb);
  await s.scan();

  // Zwei Fenster, in denen 8800 gewichtete Tokens genau 10 % ausmachen.
  const archive = s.archive;
  for (let i = 0; i < 3; i++) {
    archive.calibration.fiveHour.push({
      t: now + i * 1e6,
      e: Date.parse('2026-07-20T14:00:00Z') + i * 5 * 3600_000,
      p: 10,
      w: 8800,
      c: 0.22,
      n: 2,
    });
  }

  const cal = s.calibration();
  assert.equal(cal.fiveHour.ok, true);
  assert.ok(Math.abs(cal.fiveHour.limit - 88000) < 1e-6);

  const snap = s.snapshot(now);
  assert.equal(snap.live.fiveHour.limitSource, 'measured');
  assert.ok(Math.abs(snap.live.fiveHour.limit - 88000) < 1e-6);
  assert.ok(Math.abs(snap.live.fiveHour.percent - 10) < 0.01, '8800 von 88000 = 10 %');
});

test('das gemessene Limit sticht die Schaetzung aus dem hoechsten Fenster', async () => {
  const sb = sandbox();
  const now = Date.parse('2026-07-20T12:00:00Z');
  sb.write('c--Projekte-app', 'a.jsonl', [
    line('2026-07-14T09:00:00Z', { output: 9000 }),
    line('2026-07-15T09:00:00Z', { id: 'm2', requestId: 'r2', output: 9000 }),
    line('2026-07-16T09:00:00Z', { id: 'm3', requestId: 'r3', output: 9000 }),
    line('2026-07-20T09:00:00Z', { id: 'm4', requestId: 'r4', output: 1000 }),
  ]);

  const s = makeStore(sb);
  await s.scan();
  assert.equal(s.snapshot(now).live.fiveHour.limitSource, 'auto', 'ohne Messung: hoechstes Fenster');

  for (let i = 0; i < 3; i++) {
    s.archive.calibration.fiveHour.push({
      t: now + i * 1e6,
      e: now + i * 5 * 3600_000,
      p: 20,
      w: 10_000,
      c: 0.5,
      n: 2,
    });
  }
  const snap = s.snapshot(now);
  assert.equal(snap.live.fiveHour.limitSource, 'measured');
  assert.ok(Math.abs(snap.live.fiveHour.limit - 50_000) < 1e-6, '1 % = 500 -> 100 % = 50000');
});

test('ohne genug Messpunkte bleibt es bei der ehrlichen Schaetzung', async () => {
  const sb = sandbox();
  const now = Date.parse('2026-07-20T12:00:00Z');
  sb.write('c--Projekte-app', 'a.jsonl', [line('2026-07-20T09:00:00Z', { output: 1000 })]);

  const s = makeStore(sb);
  await s.scan();
  s.archive.calibration.fiveHour.push({ t: now, e: now, p: 10, w: 100, c: 1, n: 1 });

  const snap = s.snapshot(now);
  assert.notEqual(snap.live.fiveHour.limitSource, 'measured');
  assert.equal(snap.calibration.fiveHour.ok, false);
  assert.equal(snap.calibration.fiveHour.samples, 1);
});

// --- Robustheit -----------------------------------------------------------

test('ein beschaedigtes Archiv bringt den Start nicht zu Fall', async () => {
  const sb = sandbox();
  fs.writeFileSync(sb.history, '{kaputt', 'utf8');
  sb.write('c--Projekte-app', 'a.jsonl', [line('2026-07-20T09:00:00Z', { output: 7 })]);

  const s = makeStore(sb);
  await s.scan();
  const snap = s.snapshot();
  assert.equal(snap.totals.tokens.output, 7);
  assert.match(snap.history.note, /beschaedigt/);
});

test('defekte Zeilen werden gezaehlt, nicht verschluckt', async () => {
  const sb = sandbox();
  const dir = path.join(sb.projects, 'c--Projekte-app');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'a.jsonl'),
    JSON.stringify(line('2026-07-20T09:00:00Z', { output: 5 })) + '\n{ kaputt\n',
    'utf8',
  );
  const s = makeStore(sb);
  await s.scan();
  assert.equal(s.stats.brokenLines, 1);
  assert.equal(s.snapshot().totals.tokens.output, 5);
});
