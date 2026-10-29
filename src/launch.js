/**
 * Claude in einem Projektordner starten: ein eigenes PowerShell-Fenster, darin
 * `claude`. Ausgeloest per Klick auf ein Namensschild im Pixel-Buero.
 *
 * Gestartet wird nur in Ordnern, die das Dashboard selbst als Projekt kennt
 * (offene Sitzungen und Verbrauch aus den Transkripten) - der Browser sagt
 * nur, welcher davon. Und nur auf Anfrage der eigenen Seite.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

/** Derselbe Ordner wird hoechstens so oft gestartet (Doppelklick). */
export const LAUNCH_GAP_MS = 3000;
const MAX_BODY = 4096;

/** Ordner der bekannten Projekte: offene Sitzungen und alles mit Verbrauch. */
export function projectDirs(snapshot) {
  const dirs = new Set();
  for (const p of snapshot?.activity?.projects ?? []) if (p.cwd) dirs.add(p.cwd);
  for (const p of snapshot?.byProject ?? []) if (p.cwd) dirs.add(p.cwd);
  return dirs;
}

/**
 * Kommt die Anfrage von der eigenen Seite? Fremde Seiten schickt der Browser
 * mit ihrem eigenen Origin; ohne Origin (kein Browser) gibt es auch nichts.
 */
export function localOrigin(origin, port) {
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

export function launchSupported(platform = process.platform) {
  return platform === 'win32';
}

const powershell = () => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const encoded = (script) => Buffer.from(script, 'utf16le').toString('base64');

/**
 * Merkmale einer laufenden Claude-Code-Sitzung. Laeuft der Server selbst aus
 * Claude Code heraus, erbt das neue claude sie, haelt sich fuer eine
 * Untersitzung und speichert kein Transkript - dann fehlt es im Dashboard.
 */
const SESSION_VARS = new Set([
  'CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_EFFORT', 'CLAUDE_PID',
]);

/** Umgebung ohne Sitzungsmerkmale; Einstellungen wie CLAUDE_CODE_USE_BEDROCK bleiben. */
export function freshEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !SESSION_VARS.has(k.toUpperCase())));
}

/**
 * Neues PowerShell-Fenster im Ordner, darin claude. Eine unsichtbare
 * PowerShell oeffnet es per Start-Process: abgeloest (detached) gestartet
 * hat PowerShell keine Konsole und endet sofort, ohne Abloesen teilte sie
 * sich die des Servers. Der Ordner geht nur als Arbeitsverzeichnis mit, nie
 * in eine Befehlszeile - da laesst sich nichts einschleusen.
 */
export function openTerminal(cwd, { spawnFn = spawn, env = process.env } = {}) {
  const exe = powershell();
  const script = `Start-Process -FilePath '${exe}' -ArgumentList '-NoExit','-Command','claude'`;
  const child = spawnFn(exe, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded(script)], {
    cwd,
    env: freshEnv(env),
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on?.('error', () => {});
  child.unref?.();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Anfrage zu gross'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * POST /api/launch mit { cwd }: Antwort { status, body }.
 * ctx = { port, enabled, supported, known: Set der Projektordner, launcher(cwd), last: Map, now }
 */
export async function handleLaunch(req, ctx) {
  const fail = (status, error) => ({ status, body: { error } });
  if (!ctx.enabled) return fail(403, 'Starten ist abgeschaltet (config.json: launch.enabled)');
  if (ctx.supported === false) return fail(501, 'Starten geht bisher nur unter Windows');
  if (req.method !== 'POST') return fail(405, 'Nur POST');
  if (!localOrigin(req.headers.origin, ctx.port)) return fail(403, 'Nur von der eigenen Seite');
  // JSON zwingt fremde Seiten zu einer Vorabfrage, die hier niemand beantwortet.
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return fail(415, 'Erwartet JSON');
  let cwd;
  try {
    cwd = JSON.parse(await readBody(req))?.cwd;
  } catch (err) {
    return fail(err.status ?? 400, err.status ? err.message : 'Kein gueltiges JSON');
  }
  if (typeof cwd !== 'string' || !ctx.known.has(cwd)) return fail(404, 'Kein bekanntes Projekt');
  try {
    if (!(await fs.promises.stat(cwd)).isDirectory()) throw new Error();
  } catch {
    return fail(404, 'Den Ordner gibt es nicht mehr');
  }
  const now = ctx.now ?? Date.now();
  if (now - (ctx.last.get(cwd) ?? -Infinity) < LAUNCH_GAP_MS) return fail(429, 'Wird schon gestartet');
  ctx.last.set(cwd, now);
  try {
    ctx.launcher(cwd);
  } catch (err) {
    return fail(500, `Start fehlgeschlagen: ${err?.message ?? err}`);
  }
  return { status: 200, body: { ok: true } };
}
