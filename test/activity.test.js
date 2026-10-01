/**
 * Live-Ansicht: laufende Sitzungen und Subagents aus den Dateien, die Claude
 * Code unter ~/.claude anlegt - hier in einem Temp-Ordner nachgebaut.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createActivityTracker,
  encodeProjectDir,
  absorbLines,
  newMarks,
  pendingToolFromLines,
  STALE_BUSY_MS,
  commandKind,
  tailInfo,
  contextWindow,
} from '../src/activity.js';

const MIN = 60_000;

function sandbox() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cud-act-'));
  fs.mkdirSync(path.join(base, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(base, 'projects'), { recursive: true });
  const alive = new Set();
  const projectDir = (cwd, dirName = encodeProjectDir(cwd)) => {
    const d = path.join(base, 'projects', dirName);
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  return {
    base,
    alive,
    tracker: (opts = {}) =>
      createActivityTracker({ configDirs: () => [base], isAlive: (pid) => alive.has(pid), ...opts }),
    session(pid, s) {
      alive.add(pid);
      fs.writeFileSync(
        path.join(base, 'sessions', `${pid}.json`),
        JSON.stringify({ pid, kind: 'interactive', entrypoint: 'claude-vscode', version: '2.1.285', ...s }),
      );
    },
    projectDir,
    main(cwd, sessionId, lines, dirName) {
      const file = path.join(projectDir(cwd, dirName), `${sessionId}.jsonl`);
      fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : ''));
      return file;
    },
    agent(cwd, sessionId, id, meta, lines = [], dirName) {
      const dir = path.join(projectDir(cwd, dirName), sessionId, 'subagents');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `agent-${id}.meta.json`), JSON.stringify(meta));
      const file = path.join(dir, `agent-${id}.jsonl`);
      fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : ''));
      return file;
    },
    append(file, lines) {
      fs.appendFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    },
  };
}

const iso = (ms) => new Date(ms).toISOString();

/** Assistant-Zeile mit Werkzeugaufrufen (eine Zeile pro Content-Block). */
function toolUse(ts, msgId, ...tools) {
  return {
    type: 'assistant',
    timestamp: iso(ts),
    message: {
      id: msgId,
      role: 'assistant',
      content: tools.map(([id, name]) => ({ type: 'tool_use', id, name, input: {} })),
    },
  };
}

function toolResult(ts, toolUseId, { isError = false, async = false } = {}) {
  return {
    type: 'user',
    timestamp: iso(ts),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError, content: 'ok' }] },
    ...(async ? { toolUseResult: { isAsync: true, status: 'async_launched' } } : {}),
  };
}

/** Abschlussmeldung eines Hintergrund-Agents, wie sie im Auftraggeber landet. */
function notification(ts, agentId, status = 'completed') {
  return {
    type: 'queue-operation',
    operation: 'enqueue',
    timestamp: iso(ts),
    content:
      `<task-notification>\n<task-id>${agentId}</task-id>\n<tool-use-id>toolu_x</tool-use-id>\n` +
      `<output-file>C:\\tmp\\${agentId}.output</output-file>\n<status>${status}</status>\n` +
      `<summary>Agent finished</summary>\n</task-notification>`,
  };
}

const CWD = 'c:\\Projekte\\app';

function allAgents(snap) {
  return snap.projects.flatMap((p) => p.sessions.flatMap((s) => s.agents));
}

// --- Sitzungen --------------------------------------------------------------

test('zeigt nur Sitzungen, deren Prozess noch laeuft', async () => {
  const now = Date.now();
  const sb = sandbox();
  sb.session(101, { sessionId: 's-a', cwd: CWD, status: 'busy', startedAt: now - 60 * MIN, statusUpdatedAt: now - MIN });
  sb.session(102, { sessionId: 's-b', cwd: CWD, status: 'idle', startedAt: now - 30 * MIN });
  sb.alive.delete(102); // Prozess beendet, Datei liegt noch herum
  const t = sb.tracker();
  await t.refresh(now);
  const snap = t.snapshot();
  assert.equal(snap.available, true);
  assert.deepEqual(snap.counts, { sessions: 1, busy: 1, agentsRunning: 0 });
  assert.equal(snap.projects[0].label, 'app');
  assert.equal(snap.projects[0].sessions[0].status, 'busy');
});

test('Schluesseldateien und kaputte Statusdateien werden uebergangen', async () => {
  const now = Date.now();
  const sb = sandbox();
  sb.session(101, { sessionId: 's-a', cwd: CWD, status: 'idle', startedAt: now });
  fs.writeFileSync(path.join(sb.base, 'sessions', '101.abc123.key'), 'geheim');
  fs.writeFileSync(path.join(sb.base, 'sessions', '103.json'), '{ kaputt');
  sb.alive.add(103);
  const t = sb.tracker();
  await t.refresh(now);
  assert.equal(t.snapshot().counts.sessions, 1);
});

test('ohne Sitzungsordner ist die Ansicht nicht verfuegbar statt leer', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cud-act-'));
  const t = createActivityTracker({ configDirs: () => [base] });
  await t.refresh();
  assert.equal(t.snapshot().available, false);
});

test('mehrere Sitzungen im selben Ordner landen in einer Station', async () => {
  const now = Date.now();
  const sb = sandbox();
  sb.session(101, { sessionId: 's-a', cwd: CWD, status: 'busy', startedAt: now - 2 * MIN, statusUpdatedAt: now });
  sb.session(102, { sessionId: 's-b', cwd: 'C:\\Projekte\\APP\\', status: 'idle', startedAt: now - MIN });
  sb.session(103, { sessionId: 's-c', cwd: 'c:\\Projekte\\anderes', status: 'idle', startedAt: now });
  const t = sb.tracker();
  await t.refresh(now);
  const snap = t.snapshot();
  assert.equal(snap.projects.length, 2);
  assert.equal(snap.projects[0].label, 'app', 'arbeitende Station zuerst');
  assert.deepEqual(snap.projects[0].sessions.map((s) => s.sessionId), ['s-a', 's-b']);
});

// --- Was die Hauptsitzung gerade tut -----------------------------------------

test('erkennt das gerade laufende Werkzeug der Hauptsitzung', async () => {
  const now = Date.now();
  const sb = sandbox();
  sb.session(101, { sessionId: 's-a', cwd: CWD, status: 'busy', startedAt: now - 10 * MIN });
  const file = sb.main(CWD, 's-a', [toolUse(now - 3000, 'm1', ['t1', 'Bash'])]);
  const t = sb.tracker();
  await t.refresh(now);
  let s = t.snapshot().projects[0].sessions[0];
  assert.deepEqual([s.doing.kind, s.doing.tool], ['tool', 'Bash']);

  sb.append(file, [toolResult(now - 1000, 't1')]);
  await t.refresh(now);
  s = t.snapshot().projects[0].sessions[0];
  assert.equal(s.doing.kind, 'thinking', 'Ergebnis da, Claude denkt weiter');

  sb.append(file, [toolUse(now - 500, 'm2', ['t2', 'Agent'])]);
  await t.refresh(now);
  assert.equal(t.snapshot().projects[0].sessions[0].doing.kind, 'delegating');
});

test('eine ruhende Sitzung tut nichts, auch mit offenem Werkzeug im Transkript', async () => {
  const now = Date.now();
  const sb = sandbox();
  sb.session(101, { sessionId: 's-a', cwd: CWD, status: 'idle', startedAt: now - 10 * MIN });
  sb.main(CWD, 's-a', [toolUse(now - 3000, 'm1', ['t1', 'Bash'])]);
  const t = sb.tracker();
  await t.refresh(now);
  assert.equal(t.snapshot().projects[0].sessions[0].doing.kind, 'idle');
});

test('der Projektordner wird ohne Ruecksicht auf Gross-/Kleinschreibung gefunden', async () => {
  const now = Date.now();
  const sb = sandbox();
  sb.session(101, { sessionId: 's-a', cwd: 'c:\\Projekte\\app', status: 'busy', startedAt: now - MIN });
  sb.main('c:\\Projekte\\app', 's-a', [toolUse(now, 'm1', ['t1', 'Read'])], 'C--Projekte-app');
  const t = sb.tracker();
  await t.refresh(now);
  assert.equal(t.snapshot().projects[0].sessions[0].doing.tool, 'Read');
});

// --- Subagents ------------------------------------------------------------------

test('Vordergrund-Agent laeuft bis zum Ergebnis seines Aufrufs', async () => {
  const now = Date.now();
  const sb = sandbox();
  sb.session(101, { sessionId: 's-a', cwd: CWD, status: 'busy', startedAt: now - 10 * MIN });
  const main = sb.main(CWD, 's-a', [toolUse(now - 5 * MIN, 'm1', ['tu-1', 'Agent'])]);
  sb.agent(CWD, 's-a', 'a1', { agentType: 'Explore', description: 'Suche', toolUseId: 'tu-1', spawnDepth: 1 }, [
    toolUse(now - 1000, 'x1', ['st-1', 'Grep']),
  ]);
  const t = sb.tracker();
  await t.refresh(now);
  let [a] = allAgents(t.snapshot());
  assert.equal(a.state, 'running');
  assert.equal(a.tool, 'Grep', 'aktuelles Werkzeug aus dem eigenen Transkript');
  assert.equal(a.startedAt, now - 5 * MIN, 'Start = Zeitpunkt des Aufrufs');
  assert.equal(t.snapshot().counts.agentsRunning, 1);

  sb.append(main, [toolResult(now - 500, 'tu-1')]);
  await t.refresh(now);
  [a] = allAgents(t.snapshot());
  assert.equal(a.state, 'completed');
  assert.equal(a.finishedAt, now - 500);
  assert.equal(a.tool, null);
});

test('ein fehlgeschlagener Vordergrund-Agent wird als solcher erkannt', async () => {
  const now = Date.now();
  const sb = sandbox();
  sb.session(101, { sessionId: 's-a', cwd: CWD, status: 'busy', startedAt: now - 10 * MIN });
  sb.main(CWD, 's-a', [toolUse(now - 2 * MIN, 'm1', ['tu-1', 'Agent']), toolResult(now - MIN, 'tu-1', { isError: true })]);
  sb.agent(CWD, 's-a', 'a1', { agentType: 'Plan', toolUseId: 'tu-1' }, [toolUse(now - MIN, 'x1', ['st', 'Read'])]);
  const t = sb.tracker();
  await t.refresh(now);
  assert.equal(allAgents(t.snapshot())[0].state, 'failed');
});

test('Hintergrund-Agent: der sofortige Start-Bescheid heisst nicht "fertig"', async () => {
  const now = Date.now();
  const sb = sandbox();
  sb.session(101, { sessionId: 's-a', cwd: CWD, status: 'idle', startedAt: now - 10 * MIN });
  const main = sb.main(CWD, 's-a', [
    toolUse(now - 4 * MIN, 'm1', ['tu-1', 'Agent']),
    toolResult(now - 4 * MIN + 500, 'tu-1', { async: true }),
  ]);
  sb.agent(CWD, 's-a', 'bg1', { agentType: 'general-purpose', toolUseId: 'tu-1', requestShape: 'background' }, [
    toolUse(now - 2000, 'x1', ['st', 'WebFetch']),
  ]);
  const t = sb.tracker();
  await t.refresh(now);
  let [a] = allAgents(t.snapshot());
  assert.equal(a.state, 'running', 'Sitzung ruht, der Hintergrund-Agent arbeitet weiter');
  assert.equal(a.background, true);
  assert.equal(a.tool, 'WebFetch');

  sb.append(main, [notification(now - 100, 'bg1', 'completed')]);
  await t.refresh(now);
  [a] = allAgents(t.snapshot());
  assert.equal(a.state, 'completed');
  assert.equal(a.finishedAt, now - 100);
});

test('Abschlussmeldungen mit anderem Status', async () => {
  const now = Date.now();
  const sb = sandbox();
  sb.session(101, { sessionId: 's-a', cwd: CWD, status: 'idle', startedAt: now - 10 * MIN });
  sb.main(CWD, 's-a', [notification(now - 1000, 'f1', 'failed'), notification(now - 1000, 'k1', 'killed')]);
  for (const id of ['f1', 'k1']) {
    sb.agent(CWD, 's-a', id, { agentType: 'general-purpose', toolUseId: `tu-${id}`, requestShape: 'background' }, [
      toolUse(now - 2000, `x-${id}`, ['st', 'Bash']),
    ]);
  }
  const t = sb.tracker();
  await t.refresh(now);
  const states = Object.fromEntries(allAgents(t.snapshot()).map((a) => [a.id, a.state]));
  assert.deepEqual(states, { f1: 'failed', k1: 'stopped' });
});

test('beendete Agents verschwinden nach der Anzeigedauer', async () => {
  const now = Date.now();
  const sb = sandbox();
  sb.session(101, { sessionId: 's-a', cwd: CWD, status: 'idle', startedAt: now - 120 * MIN });
  sb.main(CWD, 's-a', [notification(now - 20 * MIN, 'alt', 'completed'), notification(now - 5 * MIN, 'neu', 'completed')]);
  for (const id of ['alt', 'neu']) {
    sb.agent(CWD, 's-a', id, { agentType: 'Explore', toolUseId: `tu-${id}`, requestShape: 'background' });
  }
  const t = sb.tracker({ recentMs: 15 * MIN });
  await t.refresh(now);
  assert.deepEqual(allAgents(t.snapshot()).map((a) => a.id), ['neu']);
});

test('ein Agent aus einem frueheren Lauf der Sitzung gilt als abgebrochen', async () => {
  // Sitzung fortgesetzt: neuer Prozess, alter Agent hat nie ein Ende gemeldet.
  const now = Date.now();
  const sb = sandbox();
  sb.session(101, { sessionId: 's-a', cwd: CWD, status: 'idle', startedAt: now + 1000 });
  sb.main(CWD, 's-a', [toolUse(now - 3 * MIN, 'm1', ['tu-1', 'Agent'])]);
  sb.agent(CWD, 's-a', 'a1', { agentType: 'Explore', toolUseId: 'tu-1' }, [toolUse(now - MIN, 'x', ['st', 'Read'])]);
  const t = sb.tracker();
  await t.refresh(now + 2000);
  const [a] = allAgents(t.snapshot());
  assert.equal(a.state, 'stopped');
  assert.equal(t.snapshot().counts.agentsRunning, 0);
});

test('verschachtelte Agents haengen an ihrem Auftraggeber', async () => {
  const now = Date.now();
  const sb = sandbox();
  sb.session(101, { sessionId: 's-a', cwd: CWD, status: 'busy', startedAt: now - 10 * MIN });
  sb.main(CWD, 's-a', [toolUse(now - 5 * MIN, 'm1', ['tu-1', 'Agent'])]);
  sb.agent(CWD, 's-a', 'eltern', { agentType: 'general-purpose', toolUseId: 'tu-1', spawnDepth: 1 }, [
    toolUse(now - 3 * MIN, 'e1', ['tu-2', 'Agent']),
  ]);
  sb.agent(CWD, 's-a', 'kind', { agentType: 'Explore', toolUseId: 'tu-2', spawnDepth: 2 }, [
    toolUse(now - 1000, 'k1', ['st', 'Glob']),
  ]);
  const t = sb.tracker();
  await t.refresh(now);
  const byId = Object.fromEntries(allAgents(t.snapshot()).map((a) => [a.id, a]));
  assert.equal(byId.eltern.parentId, null);
  assert.equal(byId.kind.parentId, 'eltern');
  assert.equal(byId.kind.depth, 2);
  assert.equal(byId.eltern.tool, 'Agent', 'der Auftraggeber wartet auf sein Kind');
});

test('ein neu geschriebenes Transkript wird von vorn ausgewertet', async () => {
  const now = Date.now();
  const sb = sandbox();
  sb.session(101, { sessionId: 's-a', cwd: CWD, status: 'busy', startedAt: now - 10 * MIN });
  const file = sb.main(CWD, 's-a', [
    toolUse(now - 3000, 'm1', ['t1', 'Bash']),
    toolResult(now - 2000, 't1'),
    toolUse(now - 1000, 'm2', ['t2', 'Read']),
  ]);
  const t = sb.tracker();
  await t.refresh(now);
  assert.equal(t.snapshot().projects[0].sessions[0].doing.tool, 'Read');
  // Kuerzer als der gemerkte Lesestand -> neu geschrieben.
  fs.writeFileSync(file, JSON.stringify(toolUse(now, 'm9', ['t9', 'Edit'])) + '\n');
  await t.refresh(now);
  assert.equal(t.snapshot().projects[0].sessions[0].doing.tool, 'Edit');
});

test('Kosten je Sitzung und Agent kommen vom Aufrufer', async () => {
  const now = Date.now();
  const sb = sandbox();
  sb.session(101, { sessionId: 's-a', cwd: CWD, status: 'busy', startedAt: now - 10 * MIN });
  sb.main(CWD, 's-a', [toolUse(now - MIN, 'm1', ['tu-1', 'Agent'])]);
  sb.agent(CWD, 's-a', 'a1', { agentType: 'Explore', toolUseId: 'tu-1' }, [toolUse(now, 'x', ['st', 'Read'])]);
  const t = sb.tracker();
  await t.refresh(now);
  const usage = (sid, aid) => (aid ? { cost: 1.5, costKnown: true, requests: 3 } : { cost: 4, costKnown: true, requests: 9 });
  const s = t.snapshot({ usage }).projects[0].sessions[0];
  assert.equal(s.cost, 4);
  assert.equal(s.agents[0].cost, 1.5);
  assert.equal(s.agents[0].requests, 3);
});

// --- Rohzeilen ------------------------------------------------------------------

test('Abschlussmeldungen werden auch aus attachment-Zeilen gelesen', () => {
  const marks = newMarks();
  const line = JSON.stringify({
    type: 'attachment',
    timestamp: '2026-10-01T07:51:02.612Z',
    attachment: {
      type: 'queued_command',
      prompt: '<task-notification>\n<task-id>abc</task-id>\n<status>completed</status>\n</task-notification>',
    },
  });
  absorbLines(marks, line);
  assert.deepEqual(marks.tasks.get('abc'), { status: 'completed', ts: Date.parse('2026-10-01T07:51:02.612Z') });
});

test('Werkzeuge derselben Antwort ueber mehrere Zeilen gehoeren zusammen', () => {
  const now = Date.now();
  const lines = [toolUse(now, 'm1', ['a', 'Read']), toolUse(now, 'm1', ['b', 'Grep']), toolResult(now, 'a')].map(
    (l) => JSON.stringify(l),
  );
  assert.equal(pendingToolFromLines(lines).name, 'Grep');
  lines.push(JSON.stringify(toolResult(now, 'b')));
  assert.equal(pendingToolFromLines(lines), null, 'alles erledigt');
  lines.push(JSON.stringify(toolUse(now, 'm2', ['c', 'Edit'])));
  assert.equal(pendingToolFromLines(lines).name, 'Edit', 'neue Antwort, neue Runde');
});

test('Meldungstext in Werkzeug-Ausgaben und spaeteren Queue-Zeilen zaehlt nicht', () => {
  // Liest Claude ein Transkript per cat oder grep, steht der Meldungstext im
  // Ergebnis; die "remove"-Zeile der Warteschlange kommt oft Minuten spaeter.
  const marks = newMarks();
  const text = '<task-notification>\n<task-id>x1</task-id>\n<status>completed</status>\n</task-notification>';
  absorbLines(
    marks,
    [
      { type: 'queue-operation', operation: 'enqueue', timestamp: '2026-10-01T07:51:02.000Z', content: text },
      { type: 'queue-operation', operation: 'remove', timestamp: '2026-10-01T07:51:21.000Z', content: text },
      {
        type: 'user',
        timestamp: '2026-10-01T08:00:00.000Z',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'cat', content: text.replace('x1', 'x2') }] },
      },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n'),
  );
  assert.deepEqual(marks.tasks.get('x1'), { status: 'completed', ts: Date.parse('2026-10-01T07:51:02.000Z') });
  assert.equal(marks.tasks.has('x2'), false, 'nur echte Zustellungen');
});

test('die juengste Meldung eines Agents gilt', () => {
  const marks = newMarks();
  const note = (ts, status) =>
    JSON.stringify({
      type: 'queue-operation',
      operation: 'enqueue',
      timestamp: ts,
      content: `<task-notification>\n<task-id>r1</task-id>\n<status>${status}</status>\n</task-notification>`,
    });
  absorbLines(marks, [note('2026-10-01T10:00:00Z', 'completed'), note('2026-10-01T10:30:00Z', 'failed')].join('\n'));
  assert.deepEqual(marks.tasks.get('r1'), { status: 'failed', ts: Date.parse('2026-10-01T10:30:00Z') });
});

test('ein Agent-Ergebnis, das selbst Meldungstext zitiert, beendet den Agent trotzdem', () => {
  const marks = newMarks();
  const now = Date.now();
  const result = toolResult(now, 'tu-1');
  result.message.content[0].content = 'Bericht: <task-notification><task-id>zz</task-id></task-notification>';
  absorbLines(marks, [toolUse(now - 1000, 'm1', ['tu-1', 'Agent']), result].map((l) => JSON.stringify(l)).join('\n'));
  assert.ok(marks.results.has('tu-1'));
});

// --- Befunde aus dem Review -------------------------------------------------------

test('ein wieder aufgenommener Agent laeuft wieder, statt "fertig" zu bleiben', async () => {
  // Hintergrund-Agent fertig gemeldet, danach per SendMessage fortgesetzt:
  // er schreibt nach seiner Meldung weiter.
  const now = Date.now();
  const sb = sandbox();
  sb.session(101, { sessionId: 's-a', cwd: CWD, status: 'idle', startedAt: now - 120 * MIN });
  sb.main(CWD, 's-a', [notification(now - 60 * MIN, 'r1', 'completed')]);
  sb.agent(CWD, 's-a', 'r1', { agentType: 'general-purpose', toolUseId: 'tu-r1', requestShape: 'background' }, [
    toolUse(now - 61 * MIN, 'x1', ['s1', 'Read']),
    toolUse(now - 2000, 'x2', ['s2', 'WebSearch']),
  ]);
  const t = sb.tracker({ recentMs: 15 * MIN });
  await t.refresh(now);
  const [a] = allAgents(t.snapshot());
  assert.equal(a.state, 'running', 'sonst stuende er als fertig da - oder waere ganz weggefiltert');
  assert.equal(a.tool, 'WebSearch');
});

test('eine nur angefasste Datei weckt einen fertigen Agent nicht auf', async () => {
  // Die Aenderungszeit ist juenger als die Meldung, der Inhalt aber nicht.
  const now = Date.now();
  const sb = sandbox();
  sb.session(101, { sessionId: 's-a', cwd: CWD, status: 'idle', startedAt: now - 120 * MIN });
  sb.main(CWD, 's-a', [notification(now - 5 * MIN, 'r1', 'completed')]);
  sb.agent(CWD, 's-a', 'r1', { agentType: 'Explore', toolUseId: 'tu-r1', requestShape: 'background' }, [
    toolUse(now - 6 * MIN, 'x1', ['s1', 'Read']),
  ]);
  const t = sb.tracker();
  await t.refresh(now);
  assert.equal(allAgents(t.snapshot())[0].state, 'completed');
});

test('verschachtelte Agents: Auftraggeber aus den Metadaten, stabile Reihenfolge', async () => {
  const now = Date.now();
  const sb = sandbox();
  sb.session(101, { sessionId: 's-a', cwd: CWD, status: 'busy', startedAt: now - 60 * MIN, statusUpdatedAt: now });
  sb.main(CWD, 's-a', [toolUse(now - 30 * MIN, 'm1', ['tu-p', 'Agent'])]);
  sb.agent(CWD, 's-a', 'p', { agentType: 'general-purpose', toolUseId: 'tu-p', spawnDepth: 1 }, [
    toolUse(now - 20 * MIN, 'p1', ['tu-k1', 'Agent'], ['tu-k2', 'Agent']),
  ]);
  for (const k of ['k1', 'k2']) {
    sb.agent(CWD, 's-a', k, { agentType: 'Explore', toolUseId: `tu-${k}`, spawnDepth: 2, parentAgentId: 'p', requestShape: 'background' }, [
      toolUse(now - 1000, `${k}x`, ['s', 'Read']),
    ]);
  }
  const t = sb.tracker();
  const order = [];
  for (let i = 0; i < 3; i++) {
    // Zwischen den Durchlaeufen schreiben die Kinder abwechselnd weiter.
    sb.append(path.join(sb.base, 'projects', encodeProjectDir(CWD), 's-a', 'subagents', `agent-${i % 2 ? 'k1' : 'k2'}.jsonl`), [
      toolUse(now - 500, `w${i}`, ['s', 'Grep']),
    ]);
    await t.refresh(now);
    order.push(allAgents(t.snapshot()).map((a) => a.id).join(','));
  }
  assert.equal(new Set(order).size, 1, `Reihenfolge wechselte: ${order.join(' | ')}`);
  const byId = Object.fromEntries(allAgents(t.snapshot()).map((a) => [a.id, a]));
  assert.equal(byId.k1.parentId, 'p');
  assert.equal(byId.k1.startedAt, now - 20 * MIN, 'Start aus dem Transkript des Auftraggebers');
});

test('Statusdateien eines anderen Rechners werden ignoriert', async () => {
  const now = Date.now();
  const sb = sandbox();
  sb.session(101, { sessionId: 's-a', cwd: CWD, status: 'idle', startedAt: now, pidDomain: 'win32:nb-hier' });
  sb.session(102, { sessionId: 's-b', cwd: CWD, status: 'idle', startedAt: now, pidDomain: 'darwin:macbook' });
  const t = sb.tracker({ pidDomain: 'win32:nb-hier' });
  await t.refresh(now);
  assert.deepEqual(t.snapshot().projects[0].sessions.map((s) => s.sessionId), ['s-a']);
});

test('"busy" ohne jedes Lebenszeichen wird nicht als arbeitend gezeigt', async () => {
  // Hart beendete Sitzung, deren Prozessnummer Windows neu vergeben hat.
  const now = Date.now();
  const sb = sandbox();
  const file = sb.main(CWD, 's-a', [toolUse(now - 2 * STALE_BUSY_MS, 'm1', ['t1', 'Bash'])]);
  const old = new Date(now - 2 * STALE_BUSY_MS);
  fs.utimesSync(file, old, old);
  sb.session(101, {
    sessionId: 's-a',
    cwd: CWD,
    status: 'busy',
    startedAt: now - 3 * STALE_BUSY_MS,
    statusUpdatedAt: now - 2 * STALE_BUSY_MS,
  });
  const t = sb.tracker();
  await t.refresh(now);
  const snap = t.snapshot();
  assert.equal(snap.projects[0].sessions[0].status, 'stale');
  assert.equal(snap.counts.busy, 0);
});

test('eine kurz unlesbare Statusdatei laesst die Sitzung nicht verschwinden', async () => {
  const now = Date.now();
  const sb = sandbox();
  sb.session(101, { sessionId: 's-a', cwd: CWD, status: 'busy', startedAt: now, statusUpdatedAt: now });
  const t = sb.tracker();
  await t.refresh(now);
  // Halb geschrieben, mit neuer Aenderungszeit.
  const file = path.join(sb.base, 'sessions', '101.json');
  fs.writeFileSync(file, '{"pid":101,"sessionId":"s-');
  const later = new Date(now + 5000);
  fs.utimesSync(file, later, later);
  await t.refresh(now + 5000);
  assert.equal(t.snapshot().counts.sessions, 1, 'letzter gueltiger Stand bleibt');
});

test('parallele Aktualisierungen werten Zeilen nicht doppelt aus', async () => {
  const now = Date.now();
  const sb = sandbox();
  sb.session(101, { sessionId: 's-a', cwd: CWD, status: 'busy', startedAt: now, statusUpdatedAt: now });
  sb.main(CWD, 's-a', [toolUse(now, 'm1', ['t1', 'Bash'])]);
  const t = sb.tracker();
  const [a, b] = [t.refresh(now), t.refresh(now)];
  assert.equal(a, b, 'derselbe Lauf');
  await a;
});

test('sehr lange Ordnernamen werden ueber den Anfang gefunden', async () => {
  const now = Date.now();
  const sb = sandbox();
  const cwd = `c:\\Projekte\\${'tief\\'.repeat(45)}app`;
  const encoded = encodeProjectDir(cwd);
  assert.ok(encoded.length > 200);
  sb.session(101, { sessionId: 's-a', cwd, status: 'busy', startedAt: now, statusUpdatedAt: now });
  // So wuerde Claude Code kuerzen: Anfang plus Pruefsumme.
  sb.main(cwd, 's-a', [toolUse(now, 'm1', ['t1', 'Glob'])], `${encoded.slice(0, 200)}-1a2b3c`);
  const t = sb.tracker();
  await t.refresh(now);
  assert.equal(t.snapshot().projects[0].sessions[0].doing.tool, 'Glob');
});

// --- Einbindung in den Store ---------------------------------------------------

test('der Snapshot enthaelt die Live-Ansicht samt Kosten je Agent', async () => {
  const { createStore } = await import('../src/store.js');
  const pricingTable = JSON.parse(fs.readFileSync(new URL('../pricing.json', import.meta.url), 'utf8'));
  const now = Date.now();
  const sb = sandbox();
  sb.session(101, { sessionId: 's-a', cwd: CWD, status: 'busy', startedAt: now - 10 * MIN });

  // Ein Request der Hauptsitzung, einer des Subagents (je 1 Mio. Output Opus 5).
  const usageLine = (id, extra = {}) => ({
    type: 'assistant',
    timestamp: iso(now - MIN),
    sessionId: 's-a',
    requestId: `req-${id}`,
    message: { id, model: 'claude-opus-5', role: 'assistant', content: [], usage: { input_tokens: 0, output_tokens: 1_000_000 } },
    ...extra,
  });
  sb.main(CWD, 's-a', [usageLine('m1'), toolUse(now - MIN, 'm2', ['tu-1', 'Agent'])]);
  sb.agent(CWD, 's-a', 'a1', { agentType: 'Explore', toolUseId: 'tu-1' }, [
    usageLine('x1', { agentId: 'a1', isSidechain: true }),
  ]);

  const store = createStore({
    pricingTable,
    isAlive: (pid) => sb.alive.has(pid),
    config: {
      timezone: 'Europe/Berlin',
      liveUsage: { enabled: false },
      history: { enabled: false },
      limits: { mode: 'auto', plans: {} },
      counting: { weights: {} },
      window: {},
      week: {},
      warnings: {},
      dataDirs: { only: [path.join(sb.base, 'projects')] },
    },
  });
  await store.scan({ now });
  const act = store.snapshot(now).activity;
  assert.equal(act.available, true);
  const s = act.projects[0].sessions[0];
  assert.ok(Math.abs(s.cost - 50) < 1e-9, 'Sitzung: Hauptsitzung + Subagent = 2 x 25 USD');
  assert.equal(s.requests, 2);
  assert.ok(Math.abs(s.agents[0].cost - 25) < 1e-9, 'Subagent: nur sein eigener Request');
  assert.equal(s.agents[0].state, 'running');
  assert.equal(store.activityDirs()[0], path.join(sb.base, 'sessions'));
});

test('abgeschaltet liefert der Snapshot keine Live-Ansicht', async () => {
  const { createStore } = await import('../src/store.js');
  const sb = sandbox();
  const store = createStore({
    pricingTable: { models: {} },
    config: {
      activity: { enabled: false },
      liveUsage: { enabled: false },
      history: { enabled: false },
      dataDirs: { only: [path.join(sb.base, 'projects')] },
    },
  });
  await store.scan();
  assert.equal(store.snapshot().activity, null);
  assert.deepEqual(store.activityDirs(), []);
});

// --- Taetigkeiten und Feiern ------------------------------------------------------

test('Shell-Befehle: Commit, Push und Testlaeufe werden erkannt', () => {
  assert.equal(commandKind('Bash', { command: 'git add -A && git commit -m "x"' }), 'commit');
  assert.equal(commandKind('Bash', { command: 'git -C /repo push origin main' }), 'push');
  assert.equal(commandKind('PowerShell', { command: 'git push' }), 'push');
  assert.equal(commandKind('Bash', { command: 'npm test 2>&1 | tail' }), 'test');
  assert.equal(commandKind('Bash', { command: 'node --test test/x.test.js' }), 'test');
  assert.equal(commandKind('Bash', { command: 'pytest -q' }), 'test');
  assert.equal(commandKind('Bash', { command: 'git status' }), null);
  assert.equal(commandKind('Read', { command: 'git commit' }), null, 'nur Shell-Werkzeuge');
});

function shellUse(ts, msgId, id, command) {
  return {
    type: 'assistant',
    timestamp: iso(ts),
    message: { id: msgId, role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] },
  };
}

test('gefeiert wird nur ein erfolgreicher Commit oder Push', () => {
  const now = Date.now();
  const ok = tailInfo(
    [shellUse(now - 2000, 'm1', 'c1', 'git commit -m x'), toolResult(now - 1000, 'c1')].map((l) => JSON.stringify(l)),
  );
  assert.deepEqual(ok.celebration, { id: 'c1', kind: 'commit', at: now - 1000 });
  assert.equal(ok.pending, null);

  const failed = tailInfo(
    [shellUse(now - 2000, 'm1', 'c1', 'git push'), toolResult(now - 1000, 'c1', { isError: true })].map((l) =>
      JSON.stringify(l),
    ),
  );
  assert.equal(failed.celebration, null, 'abgelehnter Push wird nicht gefeiert');

  const running = tailInfo([shellUse(now, 'm1', 'c1', 'git push')].map((l) => JSON.stringify(l)));
  assert.equal(running.celebration, null, 'erst nach dem Ergebnis');
  assert.deepEqual([running.pending.name, running.pending.detail], ['Bash', 'push']);
});

test('der Tracker reicht Detail und Feier bis in den Snapshot durch', async () => {
  const now = Date.now();
  const sb = sandbox();
  sb.session(101, { sessionId: 's-a', cwd: CWD, status: 'busy', startedAt: now - 10 * MIN, statusUpdatedAt: now });
  sb.main(CWD, 's-a', [
    shellUse(now - 5000, 'm1', 'c1', 'git commit -m "fertig"'),
    toolResult(now - 4000, 'c1'),
    shellUse(now - 1000, 'm2', 't1', 'npm test'),
  ]);
  const t = sb.tracker();
  await t.refresh(now);
  const s = t.snapshot().projects[0].sessions[0];
  assert.deepEqual([s.doing.kind, s.doing.tool, s.doing.detail], ['tool', 'Bash', 'test']);
  assert.equal(s.celebration.kind, 'commit');
});

// --- Messwerte: Kontext und Tempo ----------------------------------------------

test('Kontextfenster je Modell', () => {
  assert.equal(contextWindow('claude-opus-5-5'), 1_000_000);
  assert.equal(contextWindow('claude-sonnet-4-6'), 1_000_000);
  assert.equal(contextWindow('claude-haiku-4-5-20251001'), 200_000);
  assert.equal(contextWindow('claude-sonnet-4-5-20250929'), 200_000);
  assert.equal(contextWindow('claude-opus-4-5[1m]'), 1_000_000, 'ausdruecklich 1M');
  assert.equal(contextWindow(undefined), 1_000_000);
  // "sonnet[1m]" steht im Transkript ohne Suffix - nur die Groesse verraet es.
  assert.equal(contextWindow('claude-sonnet-4-5-20250929', 450_000), 1_000_000, 'mehr als 200k geht nur mit 1M');
  assert.equal(contextWindow('claude-sonnet-4-5-20250929', 150_000), 200_000);
});

test('Kontext: ein 1M-Fenster ohne Suffix im Modellnamen wird am groessten Kontext erkannt', async () => {
  const { createStore } = await import('../src/store.js');
  const pricingTable = JSON.parse(fs.readFileSync(new URL('../pricing.json', import.meta.url), 'utf8'));
  const now = Date.now();
  const sb = sandbox();
  sb.session(101, { sessionId: 's-a', cwd: CWD, status: 'busy', startedAt: now - 60 * MIN, statusUpdatedAt: now });
  const line = (id, ts, cacheRead) => ({
    type: 'assistant',
    timestamp: iso(ts),
    sessionId: 's-a',
    requestId: `r-${id}`,
    message: { id, model: 'claude-sonnet-4-5-20250929', role: 'assistant', content: [], usage: { input_tokens: 0, output_tokens: 10, cache_read_input_tokens: cacheRead } },
  });
  // Vor der Compaction 450k, danach wieder klein: das Fenster bleibt 1M.
  sb.main(CWD, 's-a', [line('m1', now - 20 * MIN, 450_000), line('m2', now - MIN, 120_000)]);
  const store = createStore({
    pricingTable,
    isAlive: (pid) => sb.alive.has(pid),
    config: { liveUsage: { enabled: false }, history: { enabled: false }, dataDirs: { only: [path.join(sb.base, 'projects')] } },
  });
  await store.scan({ now });
  const s = store.snapshot(now).activity.projects[0].sessions[0];
  assert.equal(s.context, 120_000);
  assert.equal(s.contextLimit, 1_000_000);
});

test('Kontext und Tempo: Sitzung nur Hauptstrang, Subagent fuer sich, Kosten zusammen', async () => {
  const { createStore } = await import('../src/store.js');
  const pricingTable = JSON.parse(fs.readFileSync(new URL('../pricing.json', import.meta.url), 'utf8'));
  const now = Date.now();
  const sb = sandbox();
  sb.session(101, { sessionId: 's-a', cwd: CWD, status: 'busy', startedAt: now - 60 * MIN, statusUpdatedAt: now });
  const line = (id, ts, usage, extra = {}) => ({
    type: 'assistant',
    timestamp: iso(ts),
    sessionId: 's-a',
    requestId: `r-${id}`,
    message: { id, model: 'claude-opus-5', role: 'assistant', content: [], usage },
    ...extra,
  });
  sb.main(CWD, 's-a', [
    // aelter als zwei Minuten: zaehlt fuer Kosten, nicht fuers Tempo
    line('m1', now - 10 * MIN, { input_tokens: 10, output_tokens: 9000, cache_read_input_tokens: 100_000 }),
    // juengste Anfrage des Hauptstrangs: Kontext = 50 + 300.000 + 20.000
    line('m2', now - 60_000, {
      input_tokens: 50,
      output_tokens: 1200,
      cache_read_input_tokens: 300_000,
      cache_creation_input_tokens: 20_000,
    }),
    toolUse(now - 30_000, 'm3', ['tu-1', 'Agent']),
  ]);
  sb.agent(CWD, 's-a', 'a1', { agentType: 'Explore', toolUseId: 'tu-1' }, [
    // juenger als m2 - darf den Kontext der Sitzung trotzdem nicht ersetzen
    line('x1', now - 10_000, { input_tokens: 5, output_tokens: 600, cache_read_input_tokens: 40_000 }, { agentId: 'a1' }),
  ]);
  const store = createStore({
    pricingTable,
    isAlive: (pid) => sb.alive.has(pid),
    config: {
      liveUsage: { enabled: false },
      history: { enabled: false },
      dataDirs: { only: [path.join(sb.base, 'projects')] },
    },
  });
  await store.scan({ now });
  const s = store.snapshot(now).activity.projects[0].sessions[0];
  assert.equal(s.context, 320_050);
  assert.equal(s.contextLimit, 1_000_000);
  assert.equal(s.outputPerMin, 600, '1200 Output in zwei Minuten');
  assert.equal(s.requests, 3, 'Kosten und Requests schliessen den Subagent ein');
  const a = s.agents[0];
  assert.equal(a.context, 40_005);
  assert.equal(a.outputPerMin, 300);
});

// --- Ereignisse: Nachricht von dir, Fehler ----------------------------------------

test('eine Nachricht von dir wird erkannt, Eingespieltes nicht', () => {
  const now = Date.now();
  const user = (content, extra = {}) =>
    JSON.stringify({ type: 'user', uuid: `u-${Math.random()}`, timestamp: iso(now), message: { role: 'user', content }, ...extra });
  const mine = tailInfo([user('Bitte baue das ein')]);
  assert.ok(mine.prompt?.id, 'Klartext');
  assert.equal(mine.prompt.at, now);
  assert.ok(tailInfo([user([{ type: 'text', text: 'als Block' }])]).prompt, 'Text-Block');
  for (const [name, line] of [
    ['Meta-Zeile', user('Kontext', { isMeta: true })],
    ['Meldung eines Agents', user('<task-notification>\n<task-id>x</task-id>')],
    ['Erinnerung', user('<system-reminder>…</system-reminder>')],
    ['Werkzeug-Ergebnis', user([{ type: 'tool_result', tool_use_id: 't', content: 'ok' }])],
    ['Subagent-Auftrag', user('Recherchiere X', { isSidechain: true })],
    ['Abbruch per Esc', user('[Request interrupted by user]')],
    ['Abbruch eines Werkzeugs', user([{ type: 'text', text: '[Request interrupted by user for tool use]' }])],
    [
      'Zusammenfassung nach /compact',
      user('This session is being continued from a previous conversation that ran out of context.', { isCompactSummary: true }),
    ],
    ['Zusammenfassung ohne Kennzeichen', user('This session is being continued from a previous conversation. Summary: …')],
  ]) {
    assert.equal(tailInfo([line]).prompt, null, name);
  }
});

test('Fehler: Werkzeug, API und Drosselung', () => {
  const now = Date.now();
  const tool = tailInfo([JSON.stringify(toolResult(now, 't1', { isError: true }))]);
  assert.deepEqual(tool.error, { id: 't1', kind: 'tool', at: now });

  const rate = tailInfo([
    JSON.stringify({ type: 'assistant', uuid: 'e1', timestamp: iso(now), isApiErrorMessage: true, apiErrorStatus: 429, message: { content: [] } }),
  ]);
  assert.deepEqual(rate.error, { id: 'e1', kind: 'rate', at: now });

  const conn = tailInfo([JSON.stringify({ type: 'system', subtype: 'api_error', uuid: 'e2', timestamp: iso(now) })]);
  assert.equal(conn.error.kind, 'api');

  assert.equal(tailInfo([JSON.stringify(toolResult(now, 't1'))]).error, null, 'Erfolg ist kein Fehler');

  // Abgebrochen (Esc) oder abgelehnt hast du - das Werkzeug ist nicht gescheitert.
  for (const content of [
    '[Request interrupted by user for tool use]',
    [{ type: 'text', text: "The user doesn't want to proceed with this tool use. The tool use was rejected." }],
  ]) {
    const r = toolResult(now, 't1', { isError: true });
    r.message.content[0].content = content;
    assert.equal(tailInfo([JSON.stringify(r)]).error, null, JSON.stringify(content));
  }
});

test('ein per Esc abgebrochener Subagent gilt als abgebrochen, nicht als fehlgeschlagen', async () => {
  const now = Date.now();
  const sb = sandbox();
  sb.session(101, { sessionId: 's-a', cwd: CWD, status: 'idle', startedAt: now - 10 * MIN });
  const stop = toolResult(now - MIN, 'tu-1', { isError: true });
  stop.message.content[0].content = '[Request interrupted by user for tool use]';
  const fail = toolResult(now - MIN, 'tu-2', { isError: true });
  fail.message.content[0].content = 'Agent crashed';
  sb.main(CWD, 's-a', [toolUse(now - 5 * MIN, 'm1', ['tu-1', 'Agent'], ['tu-2', 'Agent']), stop, fail]);
  sb.agent(CWD, 's-a', 'a1', { agentType: 'Explore', toolUseId: 'tu-1' }, [toolUse(now - 2 * MIN, 'x1', ['s1', 'Read'])]);
  sb.agent(CWD, 's-a', 'a2', { agentType: 'Explore', toolUseId: 'tu-2' }, [toolUse(now - 2 * MIN, 'y1', ['s1', 'Read'])]);
  const t = sb.tracker();
  await t.refresh(now);
  const byId = Object.fromEntries(allAgents(t.snapshot()).map((a) => [a.id, a.state]));
  assert.deepEqual(byId, { a1: 'stopped', a2: 'failed' });
});

// --- Neu vergebene Prozessnummern ---------------------------------------------------

test('eine neu vergebene Prozessnummer laesst keine Geist-Sitzung zurueck', async () => {
  // Fenster hart geschlossen, waehrend die Sitzung wartete: die Statusdatei
  // bleibt auf "idle", und Windows gibt die Nummer einem anderen Programm.
  const now = Date.now();
  const sb = sandbox();
  const written = new Date(now - 60 * MIN);
  const starts = new Map([
    [101, now - 30 * MIN], // erst nach dem letzten Schreiben gestartet: fremd
    [102, now - 90 * MIN], // davor gestartet: der echte Besitzer
    // 103: Startzeit unbekannt (anderer Benutzer) - im Zweifel zeigen
  ]);
  for (const [pid, id] of [
    [101, 's-geist'],
    [102, 's-echt'],
    [103, 's-unklar'],
  ]) {
    sb.session(pid, { sessionId: id, cwd: CWD, status: 'idle', startedAt: now - 120 * MIN });
    fs.utimesSync(path.join(sb.base, 'sessions', `${pid}.json`), written, written);
  }
  const asked = [];
  const t = sb.tracker({
    processStart: async (pids) => {
      asked.push([...pids].sort());
      return starts;
    },
  });
  const ids = () =>
    t
      .snapshot()
      .projects.flatMap((p) => p.sessions.map((s) => s.sessionId))
      .sort();

  await t.refresh(now);
  assert.deepEqual(ids(), ['s-echt', 's-unklar']);
  assert.deepEqual(asked, [[101, 102, 103]], 'ein Aufruf fuer alle');

  // Statuswechsel schreiben die Datei neu - kein Grund, erneut zu fragen:
  // unter Windows kostet die Abfrage eine Sekunde.
  sb.session(102, { sessionId: 's-echt', cwd: CWD, status: 'busy', startedAt: now - 120 * MIN, statusUpdatedAt: now });
  await t.refresh(now + 20_000);
  assert.equal(asked.length, 1);
  assert.deepEqual(ids(), ['s-echt', 's-unklar']);

  // Ein neuer Claude-Code-Prozess bekommt die Nummer und schreibt seine Datei.
  sb.session(101, { sessionId: 's-neu', cwd: CWD, status: 'busy', startedAt: now, statusUpdatedAt: now });
  await t.refresh(now + 40_000);
  assert.deepEqual(ids(), ['s-echt', 's-neu', 's-unklar'], 'nach seinem Start geschrieben: seine');

  // Nach einer Weile wird erneut gefragt - die Nummer koennte inzwischen neu vergeben sein.
  await t.refresh(now + 50_000 + 10 * MIN);
  assert.equal(asked.length, 2);
});

test('Startzeiten von Prozessen je Betriebssystem auslesen', async () => {
  const { procStatStart, parsePsStarts, parseWindowsStarts } = await import('../src/activity.js');
  // Linux: Feld 22 in Takten seit Systemstart; der Name darf Klammern und Leerzeichen enthalten.
  const stat = '4242 (claude (main) x) S 1 4242 4242 0 -1 4194560 100 0 0 0 5 3 0 0 20 0 11 0 123456 0 0';
  assert.equal(procStatStart(stat, 1_790_000_000), 1_790_001_234_560);
  assert.equal(procStatStart('kaputt', 1_790_000_000), null);

  // macOS: lstart in Ortszeit, C-Locale
  const ps = parsePsStarts('  123 Wed Oct  1 10:00:00 2026\n 77 Thu Jan  1 00:00:05 2026\nunsinn\n');
  assert.equal(ps.get(123), new Date(2026, 9, 1, 10, 0, 0).getTime());
  assert.equal(ps.get(77), new Date(2026, 0, 1, 0, 0, 5).getTime());
  assert.equal(ps.size, 2);

  // Windows: FILETIME (100 ns seit 1601, UTC)
  const ms = Date.UTC(2026, 9, 1, 12, 34, 56, 789);
  const ft = (BigInt(ms) + 11_644_473_600_000n) * 10_000n;
  const win = parseWindowsStarts(`15080 ${ft}\r\n\r\nWARNUNG: irgendwas\r\n`);
  assert.deepEqual([...win], [[15080, ms]]);
});

test('der Tracker meldet Nachricht und Fehler je Figur', async () => {
  const now = Date.now();
  const sb = sandbox();
  sb.session(101, { sessionId: 's-a', cwd: CWD, status: 'busy', startedAt: now - 10 * MIN, statusUpdatedAt: now });
  sb.main(CWD, 's-a', [
    { type: 'user', uuid: 'p1', timestamp: iso(now - 5000), message: { role: 'user', content: 'Los geht es' } },
    toolUse(now - 4000, 'm1', ['tu-1', 'Agent']),
  ]);
  sb.agent(CWD, 's-a', 'a1', { agentType: 'Explore', toolUseId: 'tu-1' }, [
    toolUse(now - 3000, 'x1', ['s1', 'Read']),
    toolResult(now - 2000, 's1', { isError: true }),
  ]);
  const t = sb.tracker();
  await t.refresh(now);
  const s = t.snapshot().projects[0].sessions[0];
  assert.deepEqual(s.prompt, { id: 'p1', at: now - 5000 });
  assert.equal(s.error, null);
  assert.deepEqual(s.agents[0].error, { id: 's1', kind: 'tool', at: now - 2000 });
});
