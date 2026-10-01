import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  extractEntry,
  extractLimitEvent,
  mergeDuplicate,
  dedupKey,
  parseChunk,
  projectNameFrom,
  readIncremental,
  listTranscripts,
} from '../src/parser.js';

/** Realistische Assistant-Zeile, nachgebaut aus echten Transkripten. */
function line(overrides = {}) {
  const {
    id = 'msg_01',
    requestId = 'req_01',
    uuid = 'uuid-01',
    model = 'claude-opus-5',
    ts = '2026-07-31T09:27:56.727Z',
    input = 2,
    output = 477,
    eph1h = 9676,
    eph5m = 0,
    read = 25960,
    contentType = 'text',
    ...rest
  } = overrides;
  return {
    type: 'assistant',
    requestId,
    uuid,
    timestamp: ts,
    sessionId: 'sess-1',
    cwd: 'c:\\Projekte\\beispiel-projekt',
    isSidechain: false,
    message: {
      id,
      role: 'assistant',
      model,
      content: [{ type: contentType }],
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_creation_input_tokens: eph1h + eph5m,
        cache_read_input_tokens: read,
        cache_creation: {
          ephemeral_1h_input_tokens: eph1h,
          ephemeral_5m_input_tokens: eph5m,
        },
        service_tier: 'standard',
        speed: 'standard',
      },
    },
    ...rest,
  };
}

test('extrahiert Tokens und trennt Cache-Writes nach TTL', () => {
  const e = extractEntry(line());
  assert.equal(e.input, 2);
  assert.equal(e.output, 477);
  assert.equal(e.cacheWrite1h, 9676);
  assert.equal(e.cacheWrite5m, 0);
  assert.equal(e.cacheRead, 25960);
  assert.equal(e.model, 'claude-opus-5');
  assert.equal(e.speed, 'standard');
});

test('faellt ohne cache_creation-Aufschluesselung auf den 5m-Satz zurueck', () => {
  const raw = line();
  delete raw.message.usage.cache_creation;
  raw.message.usage.cache_creation_input_tokens = 5000;
  const e = extractEntry(raw);
  assert.equal(e.cacheWrite5m, 5000);
  assert.equal(e.cacheWrite1h, 0);
});

test('Differenz zwischen Summenfeld und Aufschluesselung landet beim 5m-Satz', () => {
  const raw = line({ eph1h: 100, eph5m: 0 });
  raw.message.usage.cache_creation_input_tokens = 250; // 150 mehr als aufgeschluesselt
  const e = extractEntry(raw);
  assert.equal(e.cacheWrite1h, 100);
  assert.equal(e.cacheWrite5m, 150);
});

test('ignoriert Nicht-Assistant-Zeilen und Zeilen ohne usage', () => {
  assert.equal(extractEntry({ type: 'queue-operation', operation: 'enqueue' }), null);
  assert.equal(extractEntry({ type: 'user', message: { role: 'user' } }), null);
  assert.equal(extractEntry({ type: 'assistant', message: { id: 'm', model: 'x' } }), null);
});

test('schliesst <synthetic> aus (API-Fehler-Platzhalter, kein echtes Modell)', () => {
  assert.equal(extractEntry(line({ model: '<synthetic>' })), null);
});

test('verwirft Eintraege mit unbrauchbarem Zeitstempel', () => {
  assert.equal(extractEntry(line({ ts: 'kaputt' })), null);
});

test('negative oder fehlende Token-Felder werden zu 0, nicht zu NaN', () => {
  const raw = line();
  raw.message.usage.input_tokens = -5;
  delete raw.message.usage.output_tokens;
  const e = extractEntry(raw);
  assert.equal(e.input, 0);
  assert.equal(e.output, 0);
});

test('erkennt Fast-Mode fuer die Preisauswahl', () => {
  const raw = line();
  raw.message.usage.speed = 'fast';
  assert.equal(extractEntry(raw).speed, 'fast');
});

// --- Deduplizierung -------------------------------------------------------

test('Dedup-Schluessel kombiniert message.id und requestId', () => {
  assert.equal(dedupKey(line({ id: 'msg_A', requestId: 'req_B' })), 'msg_A::req_B');
});

test('faellt ohne requestId auf uuid zurueck, statt alle zu kollabieren', () => {
  // In echten Daten betrifft das die wenigen Eintraege ohne requestId. Ohne
  // Rueckfall wuerden sie alle auf "id::undefined" kollabieren.
  const a = line({ id: 'msg_A', uuid: 'u1' });
  const b = line({ id: 'msg_A', uuid: 'u2' });
  delete a.requestId;
  delete b.requestId;
  assert.equal(dedupKey(a), 'msg_A::u1');
  assert.equal(dedupKey(b), 'msg_A::u2');
  assert.notEqual(dedupKey(a), dedupKey(b));
});

test('ohne message.id gibt es keinen Schluessel', () => {
  const raw = line();
  delete raw.message.id;
  assert.equal(dedupKey(raw), null);
});

test('drei Content-Bloecke desselben Requests ergeben EINEN Schluessel', () => {
  // Genau dieser Fall verdoppelt in echten Daten die Tokenzahl.
  const blocks = ['text', 'tool_use', 'tool_use'].map((contentType, i) =>
    line({ contentType, ts: `2026-07-31T09:27:5${6 + i}.000Z` }),
  );
  const keys = new Set(blocks.map(dedupKey));
  assert.equal(keys.size, 1);

  const seen = new Map();
  for (const raw of blocks) {
    const e = extractEntry(raw);
    if (!seen.has(e.key)) seen.set(e.key, e);
  }
  assert.equal(seen.size, 1);
  assert.equal([...seen.values()][0].output, 477, 'Output darf nicht 3x gezaehlt werden');
});

// --- Nachgereichte Staende (Subagents) ------------------------------------

test('Subagent-Zeilen: der endgueltige Output der letzten Zeile gewinnt', () => {
  // Nachgebaut aus echten agent-*.jsonl: erst Zwischenstaende mit 1 Token,
  // die letzte Zeile traegt den Endstand samt Thinking-Angabe.
  const blocks = [
    line({ contentType: 'thinking', output: 1 }),
    line({ contentType: 'tool_use', output: 1 }),
    line({ contentType: 'tool_use', output: 383 }),
  ];
  blocks[2].message.usage.output_tokens_details = { thinking_tokens: 70 };

  const [first, ...rest] = blocks.map((b) => extractEntry(b));
  assert.equal(first.thinking, null, 'Zwischenzeile meldet kein Thinking');
  const deltas = rest.map((e) => mergeDuplicate(first, e));
  assert.equal(deltas[0], null, 'gleicher Stand bringt nichts Neues');
  assert.deepEqual(deltas[1], { output: 382 });
  assert.equal(first.output, 383);
  assert.equal(first.thinking, 70);
  assert.equal(first.input, 2, 'unveraenderte Felder bleiben, wie sie sind');
});

test('ein spaeter kleinerer Stand senkt nichts ab', () => {
  const a = extractEntry(line({ output: 500 }));
  const b = extractEntry(line({ output: 3 }));
  assert.equal(mergeDuplicate(a, b), null);
  assert.equal(a.output, 500);
});

test('Cache-Writes werden als Paar uebernommen, nicht feldweise maximiert', () => {
  // Feldweises Maximum wuerde aus 5m=100 (ohne Aufschluesselung) und
  // 1h=100 (mit) 200 Tokens machen - es ist aber derselbe Write.
  const a = extractEntry(line({ eph1h: 0, eph5m: 100 }));
  const b = extractEntry(line({ eph1h: 120, eph5m: 0 }));
  const delta = mergeDuplicate(a, b);
  assert.equal(a.cacheWrite5m + a.cacheWrite1h, 120);
  assert.equal(a.cacheWrite1h, 120);
  assert.equal(delta.cacheWrite5m, -100);
  assert.equal(delta.cacheWrite1h, 120);
});

test('liest Agent, Skill, Effort und Thinking-Tokens mit', () => {
  const raw = line({ attributionAgent: 'Explore', attributionSkill: 'docs', effort: 'xhigh' });
  raw.message.usage.output_tokens_details = { thinking_tokens: 120 };
  const e = extractEntry(raw);
  assert.equal(e.agent, 'Explore');
  assert.equal(e.skill, 'docs');
  assert.equal(e.effort, 'xhigh');
  assert.equal(e.thinking, 120);

  const plain = extractEntry(line());
  assert.equal(plain.agent, null);
  assert.equal(plain.skill, null);
  assert.equal(plain.effort, null);
  assert.equal(plain.thinking, null, 'nicht gemeldet ist nicht dasselbe wie 0');
});

// --- Limit-Treffer --------------------------------------------------------

/** Ablehnungszeile, wie Claude Code sie beim Erreichen des Limits schreibt. */
function rejection(over = {}) {
  return {
    type: 'assistant',
    timestamp: '2026-09-29T10:51:00.658Z',
    apiErrorStatus: 429,
    isApiErrorMessage: true,
    quotaLimits: {
      status: 'rejected',
      resetsAt: 1790681400,
      rateLimitType: 'five_hour',
      overageStatus: 'rejected',
      isUsingOverage: false,
      ...over,
    },
    message: {
      id: 'msg_err',
      model: '<synthetic>',
      content: [{ type: 'text', text: "You've hit your session limit" }],
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  };
}

test('erkennt einen Limit-Treffer samt Fenster und Reset', () => {
  const ev = extractLimitEvent(rejection());
  assert.equal(ev.kind, 'fiveHour');
  assert.equal(ev.end, 1790681400 * 1000, 'resetsAt kommt in Sekunden');
  assert.equal(ev.ts, Date.parse('2026-09-29T10:51:00.658Z'));
  assert.equal(ev.key, `fiveHour:${1790681400 * 1000}`);
  assert.equal(extractLimitEvent(rejection({ rateLimitType: 'seven_day' })).kind, 'week');
});

test('nur echte Ablehnungen zaehlen als Limit-Treffer', () => {
  assert.equal(extractLimitEvent(rejection({ status: 'allowed_warning' })), null);
  assert.equal(extractLimitEvent(rejection({ rateLimitType: 'seven_day_opus' })), null, 'unbekanntes Fenster');
  assert.equal(extractLimitEvent(rejection({ resetsAt: null })), null);
  assert.equal(extractLimitEvent(rejection({ resetsAt: 1 })), null, 'Reset vor dem Treffer ist unbrauchbar');
  assert.equal(extractLimitEvent(line()), null, 'normale Zeile');
});

test('parseChunk liefert Limit-Treffer, obwohl die Zeile kein Eintrag ist', () => {
  const text = [JSON.stringify(line()), JSON.stringify(rejection())].join('\n');
  const { entries, events } = parseChunk(text);
  assert.equal(entries.length, 1, '<synthetic> bleibt als Eintrag ausgeschlossen');
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'fiveHour');
});

// --- Robustheit -----------------------------------------------------------

test('parseChunk ueberspringt kaputte Zeilen und zaehlt sie', () => {
  const text = [
    JSON.stringify(line({ id: 'm1', requestId: 'r1' })),
    '{ das ist kein json',
    '',
    '   ',
    JSON.stringify(line({ id: 'm2', requestId: 'r2' })),
    '{"type":"assistant","message":{',
  ].join('\n');
  const { entries, skipped } = parseChunk(text);
  assert.equal(entries.length, 2);
  assert.equal(skipped, 2);
});

test('projectNameFrom nutzt cwd, sonst den Ordnernamen', () => {
  assert.equal(projectNameFrom('c:\\Projekte\\beispiel-projekt'), 'beispiel-projekt');
  assert.equal(projectNameFrom('/home/x/code/foo/'), 'foo');
  assert.equal(projectNameFrom(null, 'c--Projekte-AcmeShop'), 'AcmeShop');
  assert.equal(projectNameFrom(undefined, undefined), 'unbekannt');
});

// --- Inkrementelles Lesen -------------------------------------------------

test('readIncremental liest nur den angehaengten Teil', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cud-'));
  const file = path.join(dir, 'a.jsonl');
  try {
    fs.writeFileSync(file, JSON.stringify(line({ id: 'm1', requestId: 'r1' })) + '\n');
    const first = await readIncremental(file, 0);
    assert.equal(first.entries.length, 1);
    assert.ok(first.offset > 0);

    fs.appendFileSync(file, JSON.stringify(line({ id: 'm2', requestId: 'r2' })) + '\n');
    const second = await readIncremental(file, first.offset);
    assert.equal(second.entries.length, 1, 'nur der neue Eintrag');
    assert.equal(second.entries[0].key, 'm2::r2');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('unvollstaendige letzte Zeile wird nicht konsumiert', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cud-'));
  const file = path.join(dir, 'b.jsonl');
  try {
    const complete = JSON.stringify(line({ id: 'm1', requestId: 'r1' })) + '\n';
    // Eine echte zweite Zeile mittendrin abschneiden - so sieht es aus, wenn
    // Claude Code waehrend einer laufenden Sitzung gerade schreibt.
    const secondLine = JSON.stringify(line({ id: 'm2', requestId: 'r2' }));
    const cut = Math.floor(secondLine.length / 2);
    fs.writeFileSync(file, complete + secondLine.slice(0, cut));

    const first = await readIncremental(file, 0);
    assert.equal(first.entries.length, 1);
    assert.equal(first.skipped, 0, 'Teilzeile darf nicht als kaputt zaehlen');
    assert.equal(first.offset, Buffer.byteLength(complete), 'Offset steht vor der Teilzeile');

    // Zeile vervollstaendigen -> beim naechsten Lauf komplett verarbeitet
    fs.appendFileSync(file, secondLine.slice(cut) + '\n');
    const second = await readIncremental(file, first.offset);
    assert.equal(second.entries.length, 1);
    assert.equal(second.entries[0].key, 'm2::r2');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('geschrumpfte Datei loest vollstaendigen Neueinlesevorgang aus', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cud-'));
  const file = path.join(dir, 'c.jsonl');
  try {
    fs.writeFileSync(
      file,
      [1, 2, 3].map((n) => JSON.stringify(line({ id: `m${n}`, requestId: `r${n}` }))).join('\n') + '\n',
    );
    const first = await readIncremental(file, 0);
    assert.equal(first.entries.length, 3);

    fs.writeFileSync(file, JSON.stringify(line({ id: 'z', requestId: 'rz' })) + '\n');
    const second = await readIncremental(file, first.offset);
    assert.equal(second.restarted, true);
    assert.equal(second.entries.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mehrbyte-UTF-8 ueberlebt die Offset-Grenze', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cud-'));
  const file = path.join(dir, 'd.jsonl');
  try {
    const raw = line({ id: 'm1', requestId: 'r1' });
    raw.cwd = 'c:\\Projekte\\Küchen-Ärger-日本';
    fs.writeFileSync(file, JSON.stringify(raw) + '\n');
    const res = await readIncremental(file, 0);
    assert.equal(res.entries.length, 1);
    assert.equal(res.entries[0].project, 'Küchen-Ärger-日本');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fehlende Datei wirft nicht', async () => {
  const res = await readIncremental(path.join(os.tmpdir(), 'gibt-es-nicht-xyz.jsonl'), 0);
  assert.equal(res.missing, true);
  assert.deepEqual(res.entries, []);
});

// --- Blockweises Lesen (Dateien > 500 MB) ---------------------------------

test('blockweises Lesen liefert dasselbe wie das Lesen am Stueck', async () => {
  // Blockgroesse 97 Bytes: jede Zeile wird mehrfach zerschnitten, auch mitten
  // in Mehrbyte-Zeichen.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cud-'));
  const file = path.join(dir, 'gross.jsonl');
  try {
    const lines = [1, 2, 3, 4, 5].map((n) => {
      const raw = line({ id: `m${n}`, requestId: `r${n}`, output: n * 100 });
      raw.cwd = `c:\\Projekte\\Küchen-Ärger-日本-${n}`;
      return JSON.stringify(raw);
    });
    fs.writeFileSync(file, lines.join('\n') + '\n');
    const whole = await readIncremental(file, 0);
    const chunked = await readIncremental(file, 0, { chunkSize: 97 });
    assert.equal(chunked.entries.length, 5);
    assert.deepEqual(chunked.entries, whole.entries);
    assert.equal(chunked.offset, fs.statSync(file).size);
    assert.equal(chunked.skipped, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('blockweise: angefangene letzte Zeile bleibt auch ueber Blockgrenzen stehen', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cud-'));
  const file = path.join(dir, 'b.jsonl');
  try {
    const complete = JSON.stringify(line({ id: 'm1', requestId: 'r1' })) + '\n';
    const second = JSON.stringify(line({ id: 'm2', requestId: 'r2' }));
    fs.writeFileSync(file, complete + second.slice(0, 300));
    const first = await readIncremental(file, 0, { chunkSize: 64 });
    assert.equal(first.entries.length, 1);
    assert.equal(first.offset, Buffer.byteLength(complete));

    fs.appendFileSync(file, second.slice(300) + '\n');
    const next = await readIncremental(file, first.offset, { chunkSize: 64 });
    assert.equal(next.entries.length, 1);
    assert.equal(next.entries[0].key, 'm2::r2');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('eine ueberlange Einzelzeile wird uebersprungen, die Datei weiter gelesen', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cud-'));
  const file = path.join(dir, 'lang.jsonl');
  try {
    const huge = JSON.stringify({ type: 'user', blob: 'x'.repeat(5000) });
    fs.writeFileSync(
      file,
      [
        JSON.stringify(line({ id: 'm1', requestId: 'r1' })),
        huge,
        JSON.stringify(line({ id: 'm2', requestId: 'r2' })),
      ].join('\n') + '\n',
    );
    const res = await readIncremental(file, 0, { chunkSize: 256, maxLine: 2000 });
    assert.deepEqual(res.entries.map((e) => e.key), ['m1::r1', 'm2::r2']);
    assert.equal(res.skipped, 1);
    assert.equal(res.offset, fs.statSync(file).size);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Subagent-Transkripte in Unterordnern werden gefunden', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cud-'));
  try {
    const proj = path.join(base, 'c--Projekte-app');
    const sub = path.join(proj, 'sess-1', 'subagents');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(proj, 'sess-1.jsonl'), '');
    fs.writeFileSync(path.join(sub, 'agent-a1.jsonl'), '');
    fs.writeFileSync(path.join(proj, 'sess-1', 'notiz.txt'), '');
    const found = listTranscripts([base]);
    assert.deepEqual(
      found.map((f) => path.relative(base, f.file)).sort(),
      [
        path.join('c--Projekte-app', 'sess-1', 'subagents', 'agent-a1.jsonl'),
        path.join('c--Projekte-app', 'sess-1.jsonl'),
      ].sort(),
    );
    assert.ok(found.every((f) => f.projectDir === 'c--Projekte-app'), 'Projekt bleibt der oberste Ordner');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
