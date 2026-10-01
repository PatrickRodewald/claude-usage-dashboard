/**
 * Tagesrueckblick: Zeitleiste auf dem Server (src/replay.js), Zustand je
 * Zeitpunkt im Browser (public/replay.js) und der Weg durch den Store.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildTimeline, metaReader } from '../src/replay.js';
import { extractEntry, mergeDuplicate } from '../src/parser.js';
import { createStore } from '../src/store.js';
import {
  prepareTimeline,
  snapshotAt,
  nextActivity,
  activityHistogram,
  spansOf,
  AFTER_STEP_MS,
  LINGER_MS,
  AGENT_LINGER_MS,
} from '../public/replay.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pricingTable = JSON.parse(fs.readFileSync(path.join(here, '..', 'pricing.json'), 'utf8'));

const MIN = 60_000;
const FROM = Date.parse('2026-09-30T22:00:00Z'); // Mitternacht in Berlin
const at = (h, m = 0, s = 0) => FROM + h * 3_600_000 + m * MIN + s * 1000;

const entry = (ts, over = {}) => ({
  ts,
  sessionId: 's1',
  projectDir: 'c--Projekte-app',
  cwd: 'c:\\Projekte\\app',
  model: 'claude-opus-5-5',
  input: 10,
  output: 100,
  cacheRead: 1000,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  agentId: null,
  agent: null,
  tool: null,
  ...over,
});
const costOf = () => ({ cost: 0.5, known: true });

// --- Zeitleiste (Server) -----------------------------------------------------

test('buildTimeline: Projekte, Sitzungen und Subagents je Tag, mit Werkzeug und Kosten', () => {
  const tl = buildTimeline(
    [
      entry(at(9), { tool: 'Read' }),
      entry(at(9, 1), { tool: 'Agent' }),
      entry(at(9, 2), { agentId: 'a1', agent: 'general-purpose', tool: 'Grep', output: 50 }),
      entry(at(9, 3), { agentId: 'a1', agent: 'general-purpose' }),
      entry(at(8), { sessionId: 's2', projectDir: 'c--Projekte-zeta', cwd: 'c:\\Projekte\\Zeta' }),
      // ausserhalb des Tages
      entry(at(-1)),
      entry(at(24, 1)),
    ],
    {
      from: FROM,
      to: at(24),
      costOf,
      readMeta: (projectDir, sessionId, agentId) =>
        agentId === 'a1' ? { agentType: 'Explore', description: 'Logs lesen', parentAgentId: null, requestShape: 'background' } : null,
    },
  );
  assert.deepEqual(
    tl.projects.map((p) => p.label),
    ['app', 'Zeta'],
  );
  const s = tl.projects[0].sessions[0];
  assert.equal(s.sessionId, 's1');
  assert.deepEqual(s.steps[0], [9 * 3_600_000, 'Read', 0.5, 1010, 100]);
  assert.equal(s.steps.length, 2);
  assert.equal(s.contextLimit, 1_000_000);
  const a = s.agents[0];
  // Der Typ aus meta.json gewinnt; Auftrag und Hintergrund kommen mit.
  assert.equal(a.type, 'Explore');
  assert.equal(a.description, 'Logs lesen');
  assert.equal(a.background, true);
  assert.deepEqual(
    a.steps.map((x) => x[1]),
    ['Grep', null],
  );
});

test('buildTimeline: ohne meta.json bleibt der Typ aus den Eintraegen; unbekannte Preise werden vermerkt', () => {
  const tl = buildTimeline([entry(at(9), { agentId: 'a1', agent: 'Plan', model: 'mystery' })], {
    from: FROM,
    to: at(24),
    costOf: (e) => ({ cost: 0, known: e.model !== 'mystery' }),
  });
  const a = tl.projects[0].sessions[0].agents[0];
  assert.equal(a.type, 'Plan');
  assert.equal(a.costKnown, false);
});

test('metaReader liest meta.json und laesst keine Pfade aus den Transkripten durch', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cud-replay-'));
  const dir = path.join(base, 'c--app', 's1', 'subagents');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'Explore' }));
  const read = metaReader([path.join(base, 'fehlt'), base]);
  assert.equal(read('c--app', 's1', 'a1').agentType, 'Explore');
  assert.equal(read('c--app', 's1', 'a2'), null);
  assert.equal(read('..', 's1', 'a1'), null);
  assert.equal(read('c--app', '../s1', 'a1'), null);
  assert.equal(read('c--app', 's1', 'a1/../a1'), null);

  // Tief verschachtelte Projekte: Claude Code kuerzt Ordnernamen erst nach 200 Zeichen.
  const long = `c--${'tief-'.repeat(40)}app-1a2b3c`;
  assert.ok(long.length > 200);
  fs.mkdirSync(path.join(base, long, 's1', 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(base, long, 's1', 'subagents', 'agent-a1.meta.json'), JSON.stringify({ agentType: 'Plan' }));
  assert.equal(read(long, 's1', 'a1').agentType, 'Plan');
});

test('buildTimeline: ein 1M-Fenster ohne Suffix im Modellnamen wird am groessten Kontext erkannt', () => {
  const sonnet = { model: 'claude-sonnet-4-5-20250929', input: 0 };
  const limit = (...contexts) =>
    buildTimeline(
      contexts.map((c, i) => entry(at(9, i), { ...sonnet, cacheRead: c })),
      { from: FROM, to: at(24), costOf },
    ).projects[0].sessions[0].contextLimit;
  assert.equal(limit(150_000), 200_000);
  assert.equal(limit(150_000, 320_000, 90_000), 1_000_000, 'mehr als 200k geht nur mit 1M');
});

// --- Zustand je Zeitpunkt (Browser) ------------------------------------------

const timeline = (sessions, projects) =>
  prepareTimeline({
    from: FROM,
    to: at(24),
    projects: projects ?? [{ key: 'p', label: 'app', sessions }],
  });
const step = (ms, tool = null, cost = 0.1, ctx = 5000, out = 200) => [ms - FROM, tool, cost, ctx, out];

test('spansOf trennt bei langen Luecken', () => {
  assert.deepEqual(spansOf([1, 2, 30, 31], 10), [
    [1, 2],
    [30, 31],
  ]);
  assert.deepEqual(spansOf([]), []);
});

test('snapshotAt: Sitzung kommt mit dem ersten Request, arbeitet, wartet und geht', () => {
  const prep = timeline([
    {
      sessionId: 's1',
      contextLimit: 200_000,
      steps: [step(at(9), 'Read'), step(at(9, 2), 'Bash'), step(at(9, 4))],
      agents: [],
    },
  ]);
  assert.equal(snapshotAt(prep, at(8, 59)).projects.length, 0);

  let s = snapshotAt(prep, at(9, 1)).projects[0].sessions[0];
  assert.equal(s.status, 'busy');
  assert.deepEqual(s.doing, { kind: 'tool', tool: 'Read', since: at(9) });
  assert.equal(s.context, 5000);
  assert.equal(s.contextLimit, 200_000);

  // Mitten im Lauf: seit Beginn des Laufs am Stueck gearbeitet.
  s = snapshotAt(prep, at(9, 3)).projects[0].sessions[0];
  assert.equal(s.doing.tool, 'Bash');
  assert.equal(s.statusSince, at(9));
  assert.ok(Math.abs(s.cost - 0.2) < 1e-9);
  assert.equal(s.requests, 2);
  assert.equal(s.outputPerMin, 100); // nur 9:02 liegt in den zwei Minuten: 200 Tokens / 2

  // Letzter Request: Text ohne Werkzeug -> denkt/schreibt, danach wartet sie.
  s = snapshotAt(prep, at(9, 4, 30)).projects[0].sessions[0];
  assert.equal(s.doing.kind, 'thinking');
  s = snapshotAt(prep, at(9, 4) + AFTER_STEP_MS + 1000).projects[0].sessions[0];
  assert.equal(s.status, 'idle');
  assert.equal(s.doing, null);
  assert.equal(s.outputPerMin, 0);

  // Nach der Nachlaufzeit ist sie gegangen.
  assert.equal(snapshotAt(prep, at(9, 4) + LINGER_MS + 1000).projects.length, 0);
});

test('snapshotAt: lange Pause - die Figur geht und kommt wieder', () => {
  const prep = timeline([{ sessionId: 's1', steps: [step(at(9)), step(at(11))], agents: [] }]);
  assert.equal(snapshotAt(prep, at(10)).projects.length, 0);
  assert.equal(nextActivity(prep, at(10)), at(11));
  assert.equal(nextActivity(prep, at(11)), null);
  const s = snapshotAt(prep, at(11)).projects[0].sessions[0];
  assert.equal(s.startedAt, at(11));
  // Kosten zaehlen den ganzen Tag.
  assert.ok(Math.abs(s.cost - 0.2) < 1e-9);
  assert.equal(prep.start, at(9));
  assert.equal(prep.end, at(11));
});

test('snapshotAt: Subagent laeuft, wird fertig und geht; die Sitzung delegiert solange', () => {
  const prep = timeline([
    {
      sessionId: 's1',
      steps: [step(at(9), 'Agent', 1)],
      agents: [
        {
          id: 'a1',
          type: 'Explore',
          description: 'Logs lesen',
          parentId: null,
          background: true,
          contextLimit: 200_000,
          steps: [step(at(9, 1), 'Grep', 0.25), step(at(9, 20), null, 0.25)],
        },
      ],
    },
  ]);
  let s = snapshotAt(prep, at(9, 10)).projects[0].sessions[0];
  // Hauptstrang laengst still, aber der Agent arbeitet: delegiert.
  assert.equal(s.status, 'busy');
  assert.equal(s.doing.kind, 'delegating');
  let a = s.agents[0];
  assert.equal(a.state, 'running');
  assert.equal(a.tool, 'Grep');
  assert.equal(a.description, 'Logs lesen');
  assert.ok(Math.abs(s.cost - 1.25) < 1e-9);

  s = snapshotAt(prep, at(9, 21)).projects[0].sessions[0];
  a = s.agents[0];
  assert.equal(a.state, 'completed');
  assert.equal(a.finishedAt, at(9, 20));
  assert.equal(s.status, 'idle');
  assert.ok(Math.abs(s.cost - 1.5) < 1e-9);

  s = snapshotAt(prep, at(9, 20) + AGENT_LINGER_MS + 1000).projects[0].sessions[0];
  assert.equal(s.agents.length, 0);
  // Gegangene Agents bleiben in den Kosten der Sitzung.
  assert.ok(Math.abs(s.cost - 1.5) < 1e-9);
});

test('snapshotAt: arbeitende Projekte zuerst, dann alphabetisch', () => {
  const prep = timeline(null, [
    { key: 'a', label: 'Alpha', sessions: [{ sessionId: 'x', steps: [step(at(9))], agents: [] }] },
    { key: 'b', label: 'Beta', sessions: [{ sessionId: 'y', steps: [step(at(9, 4))], agents: [] }] },
  ]);
  const snap = snapshotAt(prep, at(9, 4, 30));
  assert.deepEqual(
    snap.projects.map((p) => p.label),
    ['Beta', 'Alpha'],
  );
  assert.equal(snap.projects[0].sessions[0].name, 'beta-1');
  assert.deepEqual(snap.counts, { sessions: 2, busy: 1, agentsRunning: 0 });
});

test('activityHistogram zaehlt Requests je Abschnitt', () => {
  const prep = timeline([
    { sessionId: 's1', steps: [step(at(0, 5)), step(at(0, 10)), step(at(23, 59))], agents: [{ id: 'a', steps: [step(at(12))] }] },
  ]);
  const h = activityHistogram(prep, 24);
  assert.equal(h.length, 24);
  assert.equal(h[0], 2);
  assert.equal(h[12], 1);
  assert.equal(h[23], 1);
  assert.equal(
    h.reduce((x, y) => x + y, 0),
    4,
  );
});

// --- Parser: Werkzeug je Request ------------------------------------------------

test('extractEntry merkt sich das Werkzeug; mergeDuplicate traegt es nach', () => {
  const base = {
    type: 'assistant',
    timestamp: '2026-10-01T09:00:00Z',
    sessionId: 's1',
    requestId: 'r1',
    message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 5 }, content: [{ type: 'text', text: 'hi' }] },
  };
  const text = extractEntry(base);
  assert.equal(text.tool, null);
  const withTool = extractEntry({
    ...base,
    message: { ...base.message, content: [{ type: 'tool_use', id: 't', name: 'Bash', input: {} }] },
  });
  assert.equal(withTool.tool, 'Bash');
  mergeDuplicate(text, withTool);
  assert.equal(text.tool, 'Bash');
});

// --- Store ----------------------------------------------------------------------

test('store.replay liefert den gewaehlten Tag in der Anzeigezone', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cud-replay-store-'));
  const projects = path.join(base, 'projects');
  const dir = path.join(projects, 'c--Projekte-app');
  fs.mkdirSync(path.join(dir, 's1', 'subagents'), { recursive: true });
  const line = (ts, id, over = {}) =>
    JSON.stringify({
      type: 'assistant',
      timestamp: ts,
      sessionId: 's1',
      requestId: `r-${id}`,
      cwd: 'c:\\Projekte\\app',
      message: { id: `m-${id}`, model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 10 }, content: [] },
      ...over,
    });
  fs.writeFileSync(
    path.join(dir, 's1.jsonl'),
    [line('2026-09-30T21:30:00Z', 1), line('2026-09-30T22:30:00Z', 2), line('2026-10-01T08:00:00Z', 3)].join('\n') + '\n',
  );
  fs.writeFileSync(path.join(dir, 's1', 'subagents', 'agent-a1.jsonl'), line('2026-10-01T08:01:00Z', 4, { agentId: 'a1' }) + '\n');
  fs.writeFileSync(path.join(dir, 's1', 'subagents', 'agent-a1.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Suchen' }));

  const store = createStore({
    historyFile: path.join(base, 'history.json'),
    pricingTable,
    config: {
      timezone: 'Europe/Berlin',
      liveUsage: { enabled: false },
      history: { enabled: false },
      activity: { enabled: false },
      dataDirs: { only: [projects] },
    },
  });
  await store.scan();
  const now = Date.parse('2026-10-01T10:00:00Z');
  const r = store.replay({ day: '2026-10-01', now });
  assert.equal(r.day, '2026-10-01');
  assert.equal(r.today, '2026-10-01');
  assert.equal(r.firstDay, '2026-09-30');
  assert.equal(r.from, Date.parse('2026-09-30T22:00:00Z'));
  assert.equal(r.to, Date.parse('2026-10-01T22:00:00Z'));
  // 21:30 UTC gehoert in Berlin noch zum 30.9.
  const s = r.projects[0].sessions[0];
  assert.equal(s.steps.length, 2);
  assert.equal(s.agents[0].description, 'Suchen');

  // Ungueltige oder zukuenftige Tage fallen auf heute zurueck.
  assert.equal(store.replay({ day: 'quatsch', now }).day, '2026-10-01');
  assert.equal(store.replay({ day: '2026-12-24', now }).day, '2026-10-01');
  assert.equal(store.replay({ day: '2026-09-30', now }).projects[0].sessions[0].steps.length, 1);
});

test('prepareTimeline numeriert Sitzungen je Projekt nach ihrem ersten Auftritt', () => {
  const prep = timeline([
    { sessionId: 'spaet', steps: [step(at(11))], agents: [] },
    { sessionId: 'frueh', steps: [step(at(8))], agents: [] },
    { sessionId: 'leer', steps: [], agents: [] },
  ]);
  const sessions = prep.projects[0].sessions;
  assert.deepEqual(
    sessions.map((s) => [s.sessionId, s.name]),
    [
      ['frueh', 'app-1'],
      ['spaet', 'app-2'],
    ],
  );
});
