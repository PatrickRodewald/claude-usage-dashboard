import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  extractEntry,
  dedupKey,
  parseChunk,
  projectNameFrom,
  readIncremental,
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
