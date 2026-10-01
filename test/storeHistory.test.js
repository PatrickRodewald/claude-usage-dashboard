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
    fetchUsage: over.fetchUsage,
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

// --- Nachgereichter Subagent-Output ---------------------------------------

/** Drei Zeilen EINES Subagent-Requests: Zwischenstaende, dann der Endstand. */
function subagentLines(isoTs, final = 383) {
  return [
    line(isoTs, { id: 'msg_sub', requestId: 'req_sub', output: 1 }),
    line(isoTs, { id: 'msg_sub', requestId: 'req_sub', output: 1 }),
    line(isoTs, { id: 'msg_sub', requestId: 'req_sub', output: final }),
  ];
}

test('Subagent-Requests zaehlen mit ihrem endgueltigen Output', async () => {
  // Ablage wie bei Claude Code: <Projekt>/<Session>/subagents/agent-*.jsonl
  const sb = sandbox();
  sb.write('c--Projekte-app', 'sess-1.jsonl', [line('2026-09-28T08:00:00Z', { id: 'm0', requestId: 'r0', output: 17 })]);
  sb.write(path.join('c--Projekte-app', 'sess-1', 'subagents'), 'agent-a1.jsonl', subagentLines('2026-09-28T09:00:00Z'));

  const s = makeStore(sb);
  await s.scan();
  const snap = s.snapshot();
  assert.equal(snap.totals.tokens.output, 17 + 383, 'Subagent mitgezaehlt, und nicht mit 1 aus der ersten Zeile');
  assert.equal(snap.totals.requests, 2);
  assert.equal(snap.scan.lateUsage, 1);
  assert.deepEqual(snap.byProject.map((p) => p.id), ['c--Projekte-app'], 'gehoert zum Projekt, nicht zu einem eigenen');
  s.flush();

  const s2 = makeStore(sb);
  await s2.scan();
  assert.equal(s2.snapshot().totals.tokens.output, 17 + 383, 'auch das Archiv stimmt nach dem Neustart');
});

test('ein spaeter angehaengter Endstand korrigiert Eintrag und Archiv', async () => {
  // Der Normalfall waehrend einer laufenden Sitzung: Zwischenstand und
  // Endstand landen in verschiedenen Lesedurchgaengen.
  const sb = sandbox();
  const [first, , last] = subagentLines('2026-09-28T09:00:00Z');
  const file = sb.write('c--Projekte-app', 'agent-a1.jsonl', [first]);

  const s = makeStore(sb);
  await s.scan();
  assert.equal(s.snapshot().totals.tokens.output, 1);

  fs.appendFileSync(file, JSON.stringify(last) + '\n');
  await s.scan();
  const snap = s.snapshot();
  assert.equal(snap.totals.tokens.output, 383, 'Archiv-Summen');
  assert.equal(snap.totals.requests, 1);
  assert.equal(snap.bySession[0].tokens.output, 383, 'Einzeleintraege');
});

test('ein Archiv aus aelterem Auswertungsstand wird einmal neu gelesen', async () => {
  const sb = sandbox();
  const file = sb.write('c--Projekte-app', 'agent-a1.jsonl', subagentLines('2026-07-01T09:00:00Z'));
  const s1 = makeStore(sb);
  await s1.scan();
  s1.flush();

  // Archiv so zuruecksetzen, wie es die alte Version geschrieben haette: der
  // Zwischenstand von 1 Token, Stand 1. Die Datei ist alt genug, um sonst als
  // "fertig archiviert" uebersprungen zu werden.
  const raw = JSON.parse(fs.readFileSync(sb.history, 'utf8'));
  for (const rec of Object.values(raw.files)) {
    for (const byModel of Object.values(rec.days)) for (const v of Object.values(byModel)) v[1] = 1;
  }
  raw.readerRev = 1;
  fs.writeFileSync(sb.history, JSON.stringify(raw));
  sb.age(file, 60);
  const st = fs.statSync(file);
  for (const rec of Object.values(raw.files)) rec.mtimeMs = st.mtimeMs;
  fs.writeFileSync(sb.history, JSON.stringify(raw));

  const s2 = makeStore(sb);
  await s2.scan();
  assert.equal(s2.stats.filesSkipped, 0, 'trotz Alter nicht uebersprungen');
  assert.equal(s2.snapshot().totals.tokens.output, 383);
  s2.flush();
  assert.equal(JSON.parse(fs.readFileSync(sb.history, 'utf8')).readerRev, 2);

  const s3 = makeStore(sb);
  await s3.scan();
  assert.equal(s3.stats.filesSkipped, 1, 'danach greift das Ueberspringen wieder');
  assert.equal(s3.snapshot().totals.tokens.output, 383);
});

// --- Limit-Treffer --------------------------------------------------------

function rejectionLine(isoTs, resetsAtIso, type = 'five_hour') {
  return {
    type: 'assistant',
    timestamp: isoTs,
    sessionId: 'sess-1',
    requestId: `req-err-${isoTs}`,
    uuid: `u-err-${isoTs}`,
    apiErrorStatus: 429,
    quotaLimits: {
      status: 'rejected',
      resetsAt: Date.parse(resetsAtIso) / 1000,
      rateLimitType: type,
    },
    message: {
      id: `msg-err-${isoTs}`,
      model: '<synthetic>',
      content: [{ type: 'text', text: "You've hit your session limit" }],
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  };
}

test('ein erreichtes Limit wird zum exakten Messpunkt', async () => {
  const sb = sandbox();
  sb.write('c--Projekte-app', 'a.jsonl', [
    line('2026-09-29T05:00:00Z', { output: 9999 }), // vor dem Fenster
    line('2026-09-29T08:00:00Z', { id: 'm2', requestId: 'r2', output: 6000 }),
    line('2026-09-29T10:00:00Z', { id: 'm3', requestId: 'r3', output: 4000 }),
    rejectionLine('2026-09-29T10:51:00Z', '2026-09-29T12:30:00Z'),
    rejectionLine('2026-09-29T10:51:26Z', '2026-09-29T12:30:00Z'), // erneuter Versuch
  ]);

  const s = makeStore(sb);
  await s.scan();
  const samples = s.archive.calibration.fiveHour;
  assert.equal(samples.length, 1, 'ein Fenster, ein Punkt');
  assert.equal(samples[0].p, 100);
  assert.equal(samples[0].src, 'limit');
  assert.equal(samples[0].w, 10_000, 'nur der Verbrauch im Fenster 07:30-12:30');
  assert.equal(samples[0].n, 2);
  assert.equal(s.calibration().fiveHour.anchors, 1);

  await s.scan({ force: true });
  s.flush();
  const s2 = makeStore(sb);
  await s2.scan();
  assert.equal(s2.archive.calibration.fiveHour.length, 1, 'weder Neueinlesen noch Neustart verdoppeln');
});

// --- Bereichsanteil -------------------------------------------------------

test('Wochen-Messpunkte merken sich den Claude-Code-Anteil', async () => {
  const sb = sandbox();
  const now = Date.parse('2026-10-01T08:00:00Z');
  sb.write('c--Projekte-app', 'a.jsonl', [line('2026-09-30T09:00:00Z', { output: 1000 })]);
  const weekEnd = Date.parse('2026-10-05T20:59:59.831Z');
  const fetchUsage = async () => ({
    ok: true,
    fetchedAt: now,
    fiveHour: null,
    week: { percent: 20, end: weekEnd, start: weekEnd - 7 * DAY },
    breakdown: { claudeCodeShare: 0.88, rows: [] },
  });
  const s = makeStore(sb, { fetchUsage, config: { liveUsage: { enabled: true, minIntervalMs: 0 } } });
  await s.scan();
  await s.refreshLiveUsage({ now });
  const [sample] = s.archive.calibration.week;
  assert.equal(sample.p, 20, 'Rohwert bleibt erhalten');
  assert.equal(sample.cc, 0.88);
});

test('ohne gemeldete Aufteilung bleibt der Messpunkt unbereinigt', async () => {
  const sb = sandbox();
  const now = Date.parse('2026-10-01T08:00:00Z');
  sb.write('c--Projekte-app', 'a.jsonl', [line('2026-09-30T09:00:00Z', { output: 1000 })]);
  const weekEnd = Date.parse('2026-10-05T20:59:59.831Z');
  const s = makeStore(sb, {
    fetchUsage: async () => ({
      ok: true,
      fetchedAt: now,
      fiveHour: null,
      week: { percent: 20, end: weekEnd, start: weekEnd - 7 * DAY },
      breakdown: null,
    }),
    config: { liveUsage: { enabled: true, minIntervalMs: 0 } },
  });
  await s.scan();
  await s.refreshLiveUsage({ now });
  assert.equal(s.archive.calibration.week[0].cc, undefined);
});

test('ein Wochen-Limit-Treffer uebernimmt den Anteil nur aus derselben Woche', async () => {
  const now = Date.parse('2026-10-01T08:00:00Z');
  const weekEnd = Date.parse('2026-10-05T20:59:59.831Z');
  const run = async (liveWeekEnd) => {
    const sb = sandbox();
    sb.write('c--Projekte-app', 'a.jsonl', [
      line('2026-09-30T09:00:00Z', { output: 1000 }),
      rejectionLine('2026-09-30T10:00:00Z', '2026-10-05T21:00:00Z', 'seven_day'),
    ]);
    const s = makeStore(sb, {
      fetchUsage: async () => ({
        ok: true,
        fetchedAt: now,
        fiveHour: null,
        week: { percent: 1, end: liveWeekEnd, start: liveWeekEnd - 7 * DAY },
        breakdown: { claudeCodeShare: 0.88, rows: [] },
      }),
      // minPercent hoch, damit nur der Treffer einen Wochenpunkt setzt.
      config: {
        liveUsage: { enabled: true, minIntervalMs: 0 },
        calibration: { enabled: true, minPercent: 50, sampleIntervalMs: 0 },
      },
    });
    await s.refreshLiveUsage({ now });
    await s.scan();
    return s.archive.calibration.week;
  };

  const same = await run(weekEnd);
  assert.equal(same.length, 1);
  assert.equal(same[0].src, 'limit');
  assert.equal(same[0].cc, 0.88, 'Fensterende auf die Sekunde gerundet - dieselbe Woche');

  const other = await run(weekEnd + 7 * DAY);
  assert.equal(other.length, 1);
  assert.equal(other[0].cc, undefined, 'Anteil einer anderen Woche sagt ueber diese nichts');
});

// --- Messpunkte nach geaenderter Zaehlung ---------------------------------

test('alte Messpunkte werden mit der neuen Zaehlung nachgerechnet oder verworfen', async () => {
  const sb = sandbox();
  // Haupt-Transkript plus Subagent, den die alte Version nicht gelesen hat.
  sb.write('c--Projekte-app', 'sess-1.jsonl', [line('2026-09-28T09:00:00Z', { id: 'm0', requestId: 'r0', output: 1000 })]);
  sb.write(path.join('c--Projekte-app', 'sess-1', 'subagents'), 'agent-a1.jsonl', subagentLines('2026-09-28T09:30:00Z', 3000));
  const s1 = makeStore(sb);
  await s1.scan();
  s1.flush();

  // Zustand, wie ihn die alte Version hinterlassen haette: Stand 1, ein
  // Messpunkt ohne den Subagent (w = 1000), und einer aus einer Zeit, deren
  // Transkript inzwischen geloescht ist.
  const raw = JSON.parse(fs.readFileSync(sb.history, 'utf8'));
  raw.readerRev = 1;
  raw.files['c--Projekte-alt/weg.jsonl'] = {
    path: null,
    project: 'c--Projekte-alt',
    lastTs: Date.parse('2026-09-20T12:00:00Z'),
    days: { '2026-09-20': { 'claude-opus-5|std': [0, 500, 0, 0, 0, 1] } },
    keys: [],
  };
  const fiveHourEnd = Date.parse('2026-09-28T13:00:00Z');
  raw.calibration.fiveHour = [
    { t: Date.parse('2026-09-20T11:00:00Z'), e: Date.parse('2026-09-20T13:00:00Z'), p: 5, w: 500, c: 0.01, n: 1 },
    { t: Date.parse('2026-09-28T10:00:00Z'), e: fiveHourEnd, p: 10, w: 1000, c: 0.025, n: 1 },
  ];
  fs.writeFileSync(sb.history, JSON.stringify(raw));

  const s2 = makeStore(sb);
  await s2.scan();
  const samples = s2.archive.calibration.fiveHour;
  assert.equal(samples.length, 1, 'der Punkt ohne vorhandene Transkripte faellt weg');
  assert.equal(samples[0].e, fiveHourEnd);
  assert.equal(samples[0].p, 10, 'die echte Auslastung bleibt, wie sie gemessen wurde');
  assert.equal(samples[0].w, 1000 + 3000, 'jetzt mit dem Subagent');
  assert.equal(samples[0].n, 2);
  assert.deepEqual(s2.snapshot().scan.recalibrated, { kept: 1, dropped: 1 });

  // Nur einmal: der naechste Start rechnet nichts mehr um.
  s2.flush();
  const s3 = makeStore(sb);
  await s3.scan();
  assert.equal(s3.snapshot().scan.recalibrated, null);
  assert.deepEqual(s3.archive.calibration.fiveHour.map((s) => s.w), [4000]);
});

test('nachgerechnet wird nur bis zum damaligen Messzeitpunkt', async () => {
  const sb = sandbox();
  sb.write('c--Projekte-app', 'a.jsonl', [
    line('2026-09-28T09:00:00Z', { id: 'm1', requestId: 'r1', output: 1000 }),
    line('2026-09-28T11:00:00Z', { id: 'm2', requestId: 'r2', output: 7000 }), // nach der Messung
  ]);
  const s1 = makeStore(sb);
  await s1.scan();
  s1.flush();
  const raw = JSON.parse(fs.readFileSync(sb.history, 'utf8'));
  raw.readerRev = 1;
  raw.calibration.fiveHour = [
    { t: Date.parse('2026-09-28T10:00:00Z'), e: Date.parse('2026-09-28T13:00:00Z'), p: 10, w: 1, c: 0, n: 1 },
  ];
  fs.writeFileSync(sb.history, JSON.stringify(raw));

  const s2 = makeStore(sb);
  await s2.scan();
  assert.equal(s2.archive.calibration.fiveHour[0].w, 1000);
});
