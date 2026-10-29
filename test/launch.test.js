/**
 * Claude per Klick starten (src/launch.js): nur bekannte Projektordner, nur
 * von der eigenen Seite, und der Ordner steht nie in einer Befehlszeile.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { handleLaunch, localOrigin, projectDirs, openTerminal, freshEnv, LAUNCH_GAP_MS } from '../src/launch.js';

const PORT = 7842;
const dir = os.tmpdir();

/** Anfrage wie vom Browser der eigenen Seite; over ersetzt Teile davon. */
function request(body = { cwd: dir }, over = {}) {
  const req = Readable.from([Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
  req.method = over.method ?? 'POST';
  req.headers = { origin: `http://127.0.0.1:${PORT}`, 'content-type': 'application/json', ...over.headers };
  return req;
}

function context(over = {}) {
  const started = [];
  return {
    started,
    ctx: { port: PORT, enabled: true, supported: true, known: new Set([dir]), launcher: (cwd) => started.push(cwd), last: new Map(), now: 1000, ...over },
  };
}

test('startet nur in Ordnern, die das Dashboard als Projekt kennt', async () => {
  const { ctx, started } = context();
  assert.equal((await handleLaunch(request(), ctx)).status, 200);
  assert.deepEqual(started, [dir]);
  for (const cwd of [path.join(dir, 'anderswo'), 'C:\\Windows', '', 42, null]) {
    const { ctx: c, started: s } = context();
    assert.equal((await handleLaunch(request({ cwd }), c)).status, 404, String(cwd));
    assert.deepEqual(s, []);
  }
});

test('nur Anfragen der eigenen Seite: Origin, POST und JSON', async () => {
  const cases = [
    [{ headers: { origin: 'https://evil.example' } }, 403],
    [{ headers: { origin: undefined } }, 403],
    [{ headers: { origin: `http://127.0.0.1:${PORT + 1}` } }, 403],
    [{ headers: { 'content-type': 'text/plain' } }, 415],
    [{ headers: { 'content-type': 'application/x-www-form-urlencoded' } }, 415],
    [{ method: 'GET' }, 405],
  ];
  for (const [over, status] of cases) {
    const { ctx, started } = context();
    assert.equal((await handleLaunch(request(undefined, over), ctx)).status, status, JSON.stringify(over));
    assert.deepEqual(started, []);
  }
  assert.ok(localOrigin(`http://localhost:${PORT}`, PORT));
  assert.ok(!localOrigin(`http://localhost:${PORT}.evil.example`, PORT));
});

test('abgeschaltet, kaputtes JSON, fehlender Ordner, Doppelklick', async () => {
  assert.equal((await handleLaunch(request(), context({ enabled: false }).ctx)).status, 403);
  assert.equal((await handleLaunch(request(), context({ supported: false }).ctx)).status, 501);
  assert.equal((await handleLaunch(request('{kaputt'), context().ctx)).status, 400);
  assert.equal((await handleLaunch(request('x'.repeat(5000)), context().ctx)).status, 413);
  const gone = path.join(dir, 'cud-gibt-es-nicht-4711');
  const { ctx: g, started: none } = context({ known: new Set([gone]) });
  const res = await handleLaunch(request({ cwd: gone }), g);
  assert.equal(res.status, 404);
  assert.match(res.body.error, /gibt es nicht mehr/);
  assert.deepEqual(none, []);
  // Zweimal schnell hintereinander: ein Fenster.
  const { ctx, started } = context();
  assert.equal((await handleLaunch(request(), ctx)).status, 200);
  assert.equal((await handleLaunch(request(), ctx)).status, 429);
  assert.equal((await handleLaunch(request(), { ...ctx, now: ctx.now + LAUNCH_GAP_MS })).status, 200);
  assert.equal(started.length, 2);
});

test('bekannte Ordner: offene Sitzungen und Projekte mit Verbrauch', () => {
  const dirs = projectDirs({
    activity: { projects: [{ cwd: 'C:\\a' }, { cwd: null }] },
    byProject: [{ cwd: 'C:\\b' }, { cwd: null }, { cwd: 'C:\\a' }],
  });
  assert.deepEqual([...dirs], ['C:\\a', 'C:\\b']);
  assert.deepEqual([...projectDirs(null)], []);
});

test('der Ordner geht nur als Arbeitsverzeichnis mit, nie in die Befehlszeile', () => {
  const calls = [];
  const evil = "C:\\Projekte\\x'; Remove-Item -Recurse C:\\ ; '";
  openTerminal(evil, { spawnFn: (exe, args, opts) => (calls.push({ exe, args, opts }), { on() {}, unref() {} }) });
  assert.equal(calls.length, 1);
  const [{ exe, args, opts }] = calls;
  assert.match(exe, /powershell\.exe$/i);
  assert.equal(opts.cwd, evil);
  assert.equal(opts.windowsHide, true);
  const script = Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');
  assert.match(script, /^Start-Process -FilePath '.+powershell\.exe' -ArgumentList '-NoExit','-Command','claude'$/);
  assert.ok(!args.join(' ').includes('Projekte') && !script.includes('Projekte'));
});

test('das neue claude erbt keine Sitzungsmerkmale der Claude-Code-Sitzung, die den Server startete', () => {
  const env = { Path: 'C:/Windows', CLAUDECODE: '1', claude_code_child_session: '1', CLAUDE_CODE_SESSION_ID: 'abc', CLAUDE_PID: '42', CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_MODEL: 'x' };
  assert.deepEqual(freshEnv(env), { Path: 'C:/Windows', CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_MODEL: 'x' });
  const calls = [];
  openTerminal('C:/x', { env, spawnFn: (exe, args, opts) => (calls.push(opts), { on() {}, unref() {} }) });
  assert.equal(calls[0].env.CLAUDECODE, undefined);
  assert.equal(calls[0].env.Path, 'C:/Windows');
});
