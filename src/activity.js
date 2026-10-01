/**
 * Was gerade arbeitet: laufende Claude-Code-Sitzungen und ihre Subagents.
 *
 * Alle Quellen liegen lokal und sind NICHT dokumentiert - deshalb wird
 * defensiv gelesen und alles Unbekannte uebersprungen statt geraten:
 *
 *  - <config>/sessions/<pid>.json: ein Eintrag je laufendem Claude-Code-
 *    Prozess mit Sitzungs-Id, Arbeitsverzeichnis und Status (busy/idle).
 *    Die .key-Dateien daneben sind Schluessel und werden nie gelesen.
 *  - <config>/projects/<projekt>/<session>/subagents/agent-<id>.meta.json:
 *    Typ, Auftrag, Vorder-/Hintergrund, Verschachtelungstiefe und bei
 *    verschachtelten Agents der Auftraggeber.
 *  - Das Ende eines Subagents steht im Transkript seines Auftraggebers:
 *    im Vordergrund als tool_result zum Aufruf, im Hintergrund als
 *    <task-notification> mit Status (completed, failed, killed ...).
 *
 * Zwei Lesearten, damit auch Transkripte mit Hunderten MB guenstig bleiben:
 *  - inkrementell und eng vorgefiltert: Aufrufe des Agent-Werkzeugs, deren
 *    Ergebnisse und Abschlussmeldungen. Nur diese Zeilen werden geparst.
 *  - nur das Dateiende: was eine Sitzung bzw. ein Agent GERADE tut.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { scanLines, readTailLines, projectNameFrom } from './parser.js';

/** Werkzeuge, mit denen Claude Code Subagents startet. */
const AGENT_TOOLS = new Set(['Agent', 'Task']);
/** Wie lange beendete Subagents noch sichtbar bleiben. */
export const DEFAULT_RECENT_MS = 15 * 60_000;
/**
 * Schreibt ein Agent laenger als das nach seiner Abschlussmeldung weiter,
 * wurde er wieder aufgenommen (SendMessage, Auftraggeber mit eigenen
 * Hintergrund-Kindern). In echten Daten liegt die letzte Zeile eines fertigen
 * Agents stets vor seiner Meldung.
 */
const RESUME_GRACE_MS = 3000;
/**
 * "busy", aber so lange kein einziges Byte geschrieben: kein Lebenszeichen.
 * Typisch fuer eine hart beendete Sitzung, deren Prozessnummer Windows
 * inzwischen neu vergeben hat - die Statusdatei bleibt dann auf "busy" stehen.
 */
export const STALE_BUSY_MS = 30 * 60_000;
/** So lange bleiben Lesestaende erhalten, wenn eine Datei kurz fehlt. */
const KEEP_MS = 60_000;

/**
 * Laeuft der Prozess noch? Signal 0 prueft nur die Existenz - auch unter
 * Windows. EPERM heisst: es gibt ihn, er gehoert nur jemand anderem.
 */
export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

/**
 * Kontextfenster eines Modells in Tokens. Die aktuellen Modelle haben 1 Mio.,
 * Haiku und die 4.x-Generation bis 4.5 standardmaessig 200.000.
 */
export function contextWindow(model) {
  const m = String(model ?? '').toLowerCase();
  if (m.endsWith('[1m]')) return 1_000_000;
  if (m.includes('haiku')) return 200_000;
  if (/claude-(?:opus|sonnet)-4(?:-[0-5])?(?:-\d{8})?$/.test(m) || /claude-(?:opus|sonnet)-4-[0-5]\b/.test(m)) return 200_000;
  if (/claude-3/.test(m)) return 200_000;
  return 1_000_000;
}

/** Kennung dieses Rechners, wie Claude Code sie als pidDomain schreibt. */
export function localPidDomain() {
  return `${process.platform}:${os.hostname()}`.toLowerCase();
}

/**
 * Ordnername eines Arbeitsverzeichnisses, wie Claude Code ihn anlegt: alles
 * ausser Buchstaben und Ziffern wird zu '-' ("c:\Projekte\app" ->
 * "c--Projekte-app", "Künstliche" -> "K-nstliche").
 */
export function encodeProjectDir(cwd) {
  return String(cwd).replace(/[^a-zA-Z0-9]/g, '-');
}

const str = (v) => (typeof v === 'string' && v.trim() ? v : null);
const num = (v) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

/* --- Markierungen in einem Transkript ------------------------------------ */

export function newMarks() {
  return {
    // Aufrufe des Agent-Werkzeugs: toolUseId -> Zeitpunkt
    agentCalls: new Map(),
    // davon noch ohne Ergebnis - nur nach diesen Ids wird gesucht
    openCalls: new Set(),
    // Ergebnisse dieser Aufrufe: toolUseId -> { ts, isError, async }
    results: new Map(),
    // Abschlussmeldungen: agentId -> { status, ts } (die juengste zaehlt)
    tasks: new Map(),
  };
}

const timeOf = (o) => {
  const t = Date.parse(o?.timestamp);
  return Number.isFinite(t) ? t : null;
};

/**
 * Text einer Abschlussmeldung - aber nur aus den Zeilen, mit denen Claude
 * Code sie tatsaechlich zustellt. Dieselben Zeichen stehen auch in Werkzeug-
 * Ausgaben (wenn Claude etwa ein Transkript liest) und in den spaeteren
 * "remove"-Zeilen der Warteschlange; beides wuerde Zeitpunkt und Status
 * verfaelschen.
 */
function notificationText(o) {
  if (o?.type === 'queue-operation' && o.operation === 'enqueue') return str(o.content);
  if (o?.type === 'attachment' && o.attachment?.type === 'queued_command') return str(o.attachment.prompt);
  if (o?.type === 'user' && typeof o.message?.content === 'string') {
    const c = o.message.content.trimStart();
    return c.startsWith('<task-notification>') ? c : null;
  }
  return null;
}

/**
 * Neue Zeilen eines Transkripts auswerten. Eng vorgefiltert: in agentischen
 * Transkripten betrifft fast jede Zeile irgendein Werkzeug, geparst werden
 * aber nur Agent-Aufrufe, Ergebnisse offener Agent-Aufrufe und Meldungen.
 */
export function absorbLines(marks, text) {
  for (const line of text.split('\n')) {
    if (!line) continue;
    // Hoechstens einmal parsen, und nur wenn eine der Pruefungen anschlaegt.
    // Jede Zeile durchlaeuft alle drei: das Ergebnis eines Agents kann selbst
    // den Text einer Meldung enthalten.
    let parsed;
    const obj = () => {
      if (parsed === undefined) {
        try {
          parsed = JSON.parse(line);
        } catch {
          parsed = null;
        }
      }
      return parsed;
    };

    if (line.includes('<task-notification>')) {
      const o = obj();
      const note = notificationText(o);
      if (note) {
        const ts = timeOf(o);
        for (const part of note.split('<task-notification>').slice(1)) {
          const id = /<task-id>([^<]+)<\/task-id>/.exec(part)?.[1];
          const status = /<status>([a-z_]+)<\/status>/.exec(part)?.[1];
          if (!id || !status) continue;
          const prev = marks.tasks.get(id);
          if (!prev || (ts ?? 0) >= (prev.ts ?? 0)) marks.tasks.set(id, { status, ts });
        }
      }
    }

    if (line.includes('"name":"Agent"') || line.includes('"name":"Task"')) {
      const o = obj();
      if (o?.type === 'assistant' && Array.isArray(o.message?.content)) {
        for (const b of o.message.content) {
          if (b?.type === 'tool_use' && typeof b.id === 'string' && AGENT_TOOLS.has(b.name)) {
            marks.agentCalls.set(b.id, timeOf(o));
            marks.openCalls.add(b.id);
          }
        }
      }
    }

    if (marks.openCalls.size && line.includes('"tool_result"')) {
      let hit = false;
      for (const id of marks.openCalls) {
        if (line.includes(id)) {
          hit = true;
          break;
        }
      }
      if (!hit) continue;
      const o = obj();
      if (o?.type !== 'user' || !Array.isArray(o.message?.content)) continue;
      for (const b of o.message.content) {
        if (b?.type !== 'tool_result' || !marks.openCalls.has(b.tool_use_id)) continue;
        marks.openCalls.delete(b.tool_use_id);
        marks.results.set(b.tool_use_id, {
          ts: timeOf(o),
          isError: b.is_error === true,
          // Hintergrund-Start: die Antwort kommt sofort und heisst nur
          // "gestartet", nicht "fertig".
          async: o.toolUseResult?.isAsync === true || o.toolUseResult?.status === 'async_launched',
        });
      }
    }
  }
  return marks;
}

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

/**
 * Was ein Shell-Befehl tut, soweit es fuer die Darstellung zaehlt: ein Commit,
 * ein Push oder ein Testlauf. Alles andere bleibt einfach "Shell".
 */
export function commandKind(toolName, input) {
  if (!SHELL_TOOLS.has(toolName)) return null;
  const cmd = String(input?.command ?? '');
  // "git -C pfad push" ebenso wie "git push"
  if (/\bgit\s+(?:-C\s+\S+\s+)*push\b/.test(cmd)) return 'push';
  if (/\bgit\s+(?:-C\s+\S+\s+)*commit\b/.test(cmd)) return 'commit';
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\bnode\s+--test\b|\bpytest\b|\b(?:go|cargo|dotnet|mvn|gradle)\s+test\b|\bvitest\b|\bjest\b/.test(cmd)) {
    return 'test';
  }
  return null;
}

/**
 * Aus den letzten Zeilen eines Transkripts:
 *  - pending: das zuletzt begonnene, noch offene Werkzeug (mit detail, siehe
 *    commandKind). Claude Code schreibt eine Zeile pro Content-Block;
 *    Werkzeuge derselben Antwort gehoeren zusammen.
 *  - celebration: der juengste ERFOLGREICH abgeschlossene Commit oder Push.
 */
export function tailInfo(lines) {
  let msgId = null;
  let tools = [];
  const notable = new Map(); // toolUseId -> Commit/Push-Aufruf
  let celebration = null;
  let prompt = null;
  let error = null;
  for (const line of lines) {
    const relevant =
      line.includes('"tool_use"') ||
      line.includes('"tool_result"') ||
      line.includes('"type":"user"') ||
      line.includes('"isApiErrorMessage":true') ||
      line.includes('"subtype":"api_error"');
    if (!relevant) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }

    // API-Fehler: Ablehnung durch Anthropic (429 = gedrosselt) oder Verbindung.
    if (o?.type === 'assistant' && o.isApiErrorMessage === true) {
      error = { id: o.uuid ?? `api-${o.timestamp}`, kind: Number(o.apiErrorStatus) === 429 ? 'rate' : 'api', at: timeOf(o) };
      continue;
    }
    if (o?.type === 'system' && o.subtype === 'api_error') {
      error = { id: o.uuid ?? `sys-${o.timestamp}`, kind: 'api', at: timeOf(o) };
      continue;
    }

    // Eine Nachricht von dir: Text, kein Werkzeug-Ergebnis, nichts, was Claude
    // Code selbst einspielt (Meta-Zeilen, Meldungen, Erinnerungen).
    if (o?.type === 'user' && o.isMeta !== true && o.isSidechain !== true) {
      const c = o.message?.content;
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.find((b) => b?.type === 'text')?.text : null;
      const hasResult = Array.isArray(c) && c.some((b) => b?.type === 'tool_result');
      if (typeof text === 'string' && text.trim() && !hasResult && !INJECTED.some((p) => text.trimStart().startsWith(p))) {
        prompt = { id: o.uuid ?? `prompt-${o.timestamp}`, at: timeOf(o) };
      }
    }

    const content = o?.message?.content;
    if (!Array.isArray(content)) continue;
    if (o.type === 'assistant') {
      const uses = content.filter((b) => b?.type === 'tool_use' && typeof b.id === 'string');
      if (!uses.length) continue;
      const id = o.message?.id ?? null;
      if (!id || id !== msgId) {
        msgId = id;
        tools = [];
      }
      for (const b of uses) {
        if (tools.some((t) => t.id === b.id)) continue;
        const name = String(b.name ?? '?');
        const detail = commandKind(name, b.input);
        tools.push({ id: b.id, name, detail, ts: timeOf(o), done: false });
        if (detail === 'commit' || detail === 'push') notable.set(b.id, detail);
      }
    } else if (o.type === 'user') {
      for (const b of content) {
        if (b?.type !== 'tool_result') continue;
        const t = tools.find((x) => x.id === b.tool_use_id);
        if (t) t.done = true;
        const kind = notable.get(b.tool_use_id);
        if (kind && b.is_error !== true) {
          celebration = { id: b.tool_use_id, kind, at: timeOf(o) };
        }
        if (b.is_error === true) error = { id: b.tool_use_id, kind: 'tool', at: timeOf(o) };
      }
    }
  }
  const open = tools.filter((t) => !t.done);
  const p = open.length ? open[open.length - 1] : null;
  return {
    pending: p ? { id: p.id, name: p.name, detail: p.detail, ts: p.ts } : null,
    celebration,
    // Juengste Nachricht von dir und juengster Fehler - das Buero zeigt sie
    // einmal kurz, solange sie frisch sind.
    prompt,
    error,
  };
}

/** Texte, die Claude Code selbst als "user" einspielt - keine Nachricht von dir. */
const INJECTED = ['<task-notification>', '<system-reminder>', '<local-command-stdout>', '<local-command-stderr>'];

/** Das gerade laufende Werkzeug (Kurzform von tailInfo). */
export function pendingToolFromLines(lines) {
  return tailInfo(lines).pending;
}

const TASK_STATE = { completed: 'completed', failed: 'failed' };

/** Zeitstempel der juengsten Zeile, die einen traegt. */
export function lastLineTime(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const t = timeOf(JSON.parse(lines[i]));
      if (t != null) return t;
    } catch {
      /* angeschnitten oder kaputt - weiter zurueck */
    }
  }
  return null;
}

/* --- Tracker ------------------------------------------------------------- */

/**
 * @param configDirs  liefert die Claude-Konfigurationsordner (mit sessions/
 *                    und projects/ darin)
 * @param isAlive     Prozesspruefung - nur fuer Tests austauschbar
 * @param pidDomain   Kennung dieses Rechners - ebenso
 */
export function createActivityTracker({
  configDirs,
  isAlive = processAlive,
  recentMs = DEFAULT_RECENT_MS,
  pidDomain = localPidDomain(),
} = {}) {
  /** Inkrementeller Lesestand je Transkript: Pfad -> { offset, marks, seenAt } */
  const tracked = new Map();
  /** Letzter gueltiger Inhalt je JSON-Datei: Pfad -> { mtimeMs, value, seenAt } */
  const jsonCache = new Map();
  /** Auswertung des Dateiendes, solange sich die Datei nicht aendert: Pfad -> { size, mtimeMs, info, seenAt } */
  const tailCache = new Map();
  let state = { available: false, refreshedAt: null, sessions: [] };
  let inFlight = null;

  /** Was am Ende eines Transkripts steht - nur neu gelesen, wenn es sich geaendert hat. */
  async function tailOf(file, now) {
    const st = await statOf(file);
    if (!st) return { pending: null, celebration: null };
    const c = tailCache.get(file);
    if (c && c.size === st.size && c.mtimeMs === st.mtimeMs) {
      c.seenAt = now;
      return c.info;
    }
    const info = tailInfo(await readTailLines(file));
    tailCache.set(file, { size: st.size, mtimeMs: st.mtimeMs, info, seenAt: now });
    return info;
  }

  async function statOf(file) {
    try {
      return await fs.promises.stat(file);
    } catch {
      return null;
    }
  }

  /**
   * JSON-Datei lesen, unveraendert aus dem Zwischenspeicher. Ist sie gerade
   * halb geschrieben, gilt der letzte gueltige Inhalt - sonst verschwaende
   * eine Sitzung bei jedem Statuswechsel fuer einen Durchlauf.
   */
  async function readJson(file, now) {
    const st = await statOf(file);
    const cached = jsonCache.get(file);
    if (!st) return null;
    if (cached && cached.mtimeMs === st.mtimeMs) {
      cached.seenAt = now;
      return cached.value;
    }
    try {
      const value = JSON.parse(await fs.promises.readFile(file, 'utf8'));
      if (!value || typeof value !== 'object') throw new Error('kein Objekt');
      jsonCache.set(file, { mtimeMs: st.mtimeMs, value, seenAt: now, stat: st });
      return value;
    } catch {
      if (cached) cached.seenAt = now;
      return cached?.value ?? null;
    }
  }

  async function marksFor(file, now) {
    let t = tracked.get(file);
    if (!t) tracked.set(file, (t = { offset: 0, marks: newMarks(), seenAt: now }));
    t.seenAt = now;
    const res = await scanLines(file, t.offset, (text) => absorbLines(t.marks, text), {
      // Datei neu geschrieben: Markierungen von vorn - in demselben Lesedurchgang.
      onRestart: () => {
        t.marks = newMarks();
      },
    });
    if (!res.missing) t.offset = res.offset;
    return t.marks;
  }

  async function readSessions(configDir, now) {
    const dir = path.join(configDir, 'sessions');
    let names;
    try {
      names = await fs.promises.readdir(dir);
    } catch {
      return null;
    }
    const out = [];
    for (const name of names) {
      // Nur die Statusdateien "<pid>.json"; erst pruefen, ob der Prozess
      // lebt - die Dateien beendeter Prozesse muessen gar nicht gelesen werden.
      const m = /^(\d+)\.json$/.exec(name);
      if (!m || !isAlive(Number(m[1]))) continue;
      const file = path.join(dir, name);
      const s = await readJson(file, now);
      if (!str(s?.sessionId) || !str(s?.cwd)) continue;
      const pid = num(s.pid) ?? Number(m[1]);
      if (pid !== Number(m[1]) && !isAlive(pid)) continue;
      // Statusdatei eines anderen Rechners (etwa ueber einen synchronisierten
      // Konfigurationsordner): dessen Prozessnummern sagen hier nichts.
      if (str(s.pidDomain) && s.pidDomain.toLowerCase() !== pidDomain) continue;
      const st = jsonCache.get(file)?.stat;
      out.push({
        pid,
        sessionId: s.sessionId,
        cwd: s.cwd,
        name: str(s.name),
        status: str(s.status) ?? 'unknown',
        statusSince: num(s.statusUpdatedAt) ?? num(s.updatedAt),
        // Prozessstart; fehlt er, ersatzweise die Entstehung der Statusdatei.
        startedAt: num(s.startedAt) ?? (st ? st.birthtimeMs || st.mtimeMs : null),
        entrypoint: str(s.entrypoint),
        kind: str(s.kind),
        version: str(s.version),
      });
    }
    return out;
  }

  /** Transkript-Ordner eines Arbeitsverzeichnisses. */
  function projectDirFor(configDir, cwd, listing) {
    const want = encodeProjectDir(cwd);
    const dir = (d) => path.join(configDir, 'projects', d);
    if (listing.includes(want)) return dir(want);
    const lower = want.toLowerCase();
    const hit = listing.find((d) => d.toLowerCase() === lower);
    if (hit) return dir(hit);
    // Sehr lange Pfade kuerzt Claude Code und haengt eine Pruefsumme an; dann
    // traegt nur der Anfang. Nur verwenden, wenn er eindeutig ist.
    if (want.length > 180) {
      const prefix = lower.slice(0, 180);
      const cands = listing.filter((d) => d.toLowerCase().startsWith(prefix));
      if (cands.length === 1) return dir(cands[0]);
    }
    return null;
  }

  async function sessionAgents(session, projectDir, mainMarks, now, keep) {
    const subDir = path.join(projectDir, session.sessionId, 'subagents');
    let names;
    try {
      names = await fs.promises.readdir(subDir);
    } catch {
      return { agents: [], latestWrite: null };
    }

    const all = [];
    let latestWrite = null;
    for (const name of names) {
      const m = /^agent-(.+)\.meta\.json$/.exec(name);
      if (!m) continue;
      const metaFile = path.join(subDir, name);
      const meta = await readJson(metaFile, now);
      if (!meta) continue;
      const id = m[1];
      const file = path.join(subDir, `agent-${id}.jsonl`);
      const fst = await statOf(file);
      const mst = jsonCache.get(metaFile)?.stat;
      const lastActivity = fst?.mtimeMs ?? mst?.mtimeMs ?? null;
      if (lastActivity != null && (latestWrite == null || lastActivity > latestWrite)) latestWrite = lastActivity;
      all.push({
        id,
        file,
        type: str(meta.agentType) ?? 'Agent',
        description: str(meta.description),
        toolUseId: str(meta.toolUseId),
        parentAgentId: str(meta.parentAgentId),
        background: meta.requestShape === 'background',
        depth: Math.max(1, num(meta.spawnDepth) ?? 1),
        lastActivity,
        // Die meta.json entsteht beim Start; geschrieben wird sie spaeter
        // mitunter erneut - deshalb die Entstehungszeit, nicht die Aenderung.
        born: mst ? mst.birthtimeMs || mst.mtimeMs : null,
      });
    }

    // Nur Agents, die in DIESEM Prozess geschrieben haben, koennen laufen;
    // ihre Transkripte werden verfolgt (verschachtelte Aufrufe, Meldungen).
    // Aeltere stammen aus einem frueheren Lauf der Sitzung.
    const since = session.startedAt ?? 0;
    const fileMarks = new Map();
    for (const a of all) {
      if ((a.lastActivity ?? 0) < since) continue;
      fileMarks.set(a.id, await marksFor(a.file, now));
      keep.add(a.file);
    }
    const allMarks = [mainMarks, ...fileMarks.values()];
    const find = (pick) => {
      for (const mk of allMarks) {
        const v = pick(mk);
        if (v != null) return v;
      }
      return null;
    };
    const callerOf = (toolUseId) => {
      if (!toolUseId || mainMarks.agentCalls.has(toolUseId)) return null;
      for (const [id, mk] of fileMarks) if (mk.agentCalls.has(toolUseId)) return id;
      return null;
    };

    const agents = [];
    for (const a of all) {
      const task = find((mk) => mk.tasks.get(a.id));
      const result = a.toolUseId && !a.background ? find((mk) => mk.results.get(a.toolUseId)) : null;
      const end = task ?? (result && !result.async ? result : null);

      // Nach der Meldung weitergearbeitet: wieder aufgenommen. Die Aenderungszeit
      // allein genuegt dafuer nicht (ein Virenscanner oder ein Backup kann sie
      // anfassen) - im Verdachtsfall entscheidet die letzte Zeile selbst.
      let resumed = false;
      if (end && end.ts != null && (a.lastActivity ?? 0) > end.ts + RESUME_GRACE_MS) {
        const last = lastLineTime(await readTailLines(a.file));
        resumed = last != null && last > end.ts + RESUME_GRACE_MS;
      }

      let stateName = 'running';
      let finishedAt = null;
      if (resumed) {
        // laeuft wieder
      } else if (end) {
        stateName = task ? (TASK_STATE[task.status] ?? 'stopped') : result.isError ? 'failed' : 'completed';
        finishedAt = end.ts;
      } else if ((a.lastActivity ?? 0) < since) {
        // Kein Abschluss vermerkt, aber der Prozess wurde seitdem neu
        // gestartet - der Agent ist mit dem alten Prozess untergegangen.
        stateName = 'stopped';
        finishedAt = a.lastActivity;
      }
      if (stateName !== 'running' && (finishedAt == null || now - finishedAt > recentMs)) continue;

      let tool = null;
      let toolDetail = null;
      let celebration = null;
      let error = null;
      if ((a.lastActivity ?? 0) >= since) {
        const info = await tailOf(a.file, now);
        if (stateName === 'running' && info.pending) {
          tool = info.pending.name;
          toolDetail = info.pending.detail;
        }
        celebration = info.celebration;
        error = info.error;
      }

      agents.push({
        id: a.id,
        type: a.type,
        description: a.description,
        background: a.background,
        depth: a.depth,
        parentId: a.parentAgentId ?? callerOf(a.toolUseId),
        state: stateName,
        startedAt: (a.toolUseId && find((mk) => mk.agentCalls.get(a.toolUseId))) ?? a.born,
        lastActivity: a.lastActivity,
        finishedAt,
        tool,
        toolDetail,
        celebration,
        error,
      });
    }
    // Stabil sortieren: die Reihenfolge bestimmt das Layout der Werkstatt,
    // und ein Wechsel bei jeder Aktualisierung wuerde sie neu aufbauen.
    agents.sort((x, y) => (x.startedAt ?? 0) - (y.startedAt ?? 0) || x.id.localeCompare(y.id));
    return { agents, latestWrite };
  }

  async function doRefresh(now) {
    const sessions = [];
    let available = false;
    const keep = new Set();

    for (const configDir of configDirs()) {
      const list = await readSessions(configDir, now);
      if (list == null) continue;
      available = true;
      let listing = [];
      try {
        listing = await fs.promises.readdir(path.join(configDir, 'projects'));
      } catch {
        /* noch keine Transkripte */
      }

      for (const s of list) {
        const projectDir = projectDirFor(configDir, s.cwd, listing);
        let agents = [];
        let doing = null;
        let latestWrite = null;
        let celebration = null;
        let prompt = null;
        let error = null;
        if (projectDir) {
          const mainFile = path.join(projectDir, `${s.sessionId}.jsonl`);
          keep.add(mainFile);
          const mainMarks = await marksFor(mainFile, now);
          latestWrite = (await statOf(mainFile))?.mtimeMs ?? null;
          const res = await sessionAgents(s, projectDir, mainMarks, now, keep);
          agents = res.agents;
          if (res.latestWrite != null && (latestWrite == null || res.latestWrite > latestWrite)) latestWrite = res.latestWrite;
          const info = await tailOf(mainFile, now);
          celebration = info.celebration;
          prompt = info.prompt;
          error = info.error;
          if (s.status === 'busy') {
            const open = info.pending;
            doing = open
              ? {
                  kind: AGENT_TOOLS.has(open.name) ? 'delegating' : 'tool',
                  tool: open.name,
                  detail: open.detail,
                  since: open.ts,
                }
              : { kind: 'thinking', tool: null, since: s.statusSince };
          }
        }

        let status = s.status;
        // "busy" ohne jedes Lebenszeichen: eine Sitzung, die arbeitet, schreibt.
        if (status === 'busy') {
          const last = Math.max(latestWrite ?? 0, s.statusSince ?? 0);
          if (now - last > STALE_BUSY_MS) {
            status = 'stale';
            doing = { kind: 'stale', tool: null, since: last || null };
          }
        }
        if (!doing) doing = { kind: status === 'busy' ? 'thinking' : status === 'stale' ? 'stale' : 'idle', tool: null, since: s.statusSince };
        sessions.push({
          ...s,
          status,
          projectDir: projectDir ? path.basename(projectDir) : null,
          doing,
          celebration,
          prompt,
          error,
          agents,
        });
      }
    }

    // Lesestaende erst nach einer Schonfrist vergessen: fehlt eine Datei nur
    // einen Durchlauf lang, muesste sie sonst danach wieder ganz gelesen werden.
    for (const file of keep) {
      const t = tracked.get(file);
      if (t) t.seenAt = now;
    }
    for (const [file, t] of tracked) if (now - t.seenAt > KEEP_MS) tracked.delete(file);
    for (const [file, c] of jsonCache) if (now - c.seenAt > KEEP_MS) jsonCache.delete(file);
    for (const [file, c] of tailCache) if (now - c.seenAt > KEEP_MS) tailCache.delete(file);

    // Dieselbe Sitzung zweimal (z. B. kurz waehrend eines Neustarts): die
    // juengere gewinnt.
    const bySession = new Map();
    for (const s of sessions) {
      const prev = bySession.get(s.sessionId);
      if (!prev || (s.startedAt ?? 0) > (prev.startedAt ?? 0)) bySession.set(s.sessionId, s);
    }

    state = { available, refreshedAt: now, sessions: [...bySession.values()] };
    return state;
  }

  /** Nicht parallel: zwei Laeufe wuerden dieselben Zeilen doppelt auswerten. */
  function refresh(now = Date.now()) {
    if (!inFlight) {
      inFlight = doRefresh(now).finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  /**
   * Fuer das Dashboard nach Projekt gruppiert.
   * @param usage (sessionId, agentId?) -> { cost, costKnown, requests } | null
   */
  function snapshot({ usage } = {}) {
    const projects = new Map();
    let busy = 0;
    let agentsRunning = 0;
    for (const s of state.sessions) {
      const key = s.cwd.replace(/[\\/]+$/, '').toLowerCase();
      let p = projects.get(key);
      if (!p) {
        p = { key, label: projectNameFrom(s.cwd, s.projectDir), cwd: s.cwd, sessions: [] };
        projects.set(key, p);
      }
      if (s.status === 'busy') busy++;
      const sessionUsage = usage?.(s.sessionId) ?? null;
      p.sessions.push({
        sessionId: s.sessionId,
        pid: s.pid,
        name: s.name,
        status: s.status,
        statusSince: s.statusSince,
        startedAt: s.startedAt,
        entrypoint: s.entrypoint,
        kind: s.kind,
        version: s.version,
        doing: s.doing,
        // Juengster erfolgreicher Commit/Push - das Buero feiert ihn kurz.
        celebration: s.celebration ?? null,
        // Juengste Nachricht von dir und juengster Fehler (einmal kurz gezeigt).
        prompt: s.prompt ?? null,
        error: s.error ?? null,
        cost: sessionUsage?.cost ?? null,
        costKnown: sessionUsage?.costKnown ?? true,
        requests: sessionUsage?.requests ?? 0,
        // Kontext der juengsten Anfrage und Output-Durchsatz des Hauptstrangs.
        context: sessionUsage?.context ?? null,
        contextLimit: sessionUsage?.contextLimit ?? null,
        outputPerMin: sessionUsage?.outputPerMin ?? 0,
        agents: s.agents.map((a) => {
          if (a.state === 'running') agentsRunning++;
          const u = usage?.(s.sessionId, a.id) ?? null;
          return {
            ...a,
            cost: u?.cost ?? null,
            costKnown: u?.costKnown ?? true,
            requests: u?.requests ?? 0,
            context: u?.context ?? null,
            contextLimit: u?.contextLimit ?? null,
            outputPerMin: u?.outputPerMin ?? 0,
          };
        }),
      });
    }
    // Arbeitende Projekte zuerst, dann alphabetisch - die Reihenfolge soll
    // nicht bei jedem Statuswechsel springen, deshalb nur zwei Stufen.
    const list = [...projects.values()].sort((a, b) => {
      const ab = a.sessions.some((s) => s.status === 'busy') ? 0 : 1;
      const bb = b.sessions.some((s) => s.status === 'busy') ? 0 : 1;
      return ab - bb || a.label.localeCompare(b.label, 'de');
    });
    for (const p of list) {
      p.sessions.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0) || a.sessionId.localeCompare(b.sessionId));
    }
    return {
      available: state.available,
      refreshedAt: state.refreshedAt,
      projects: list,
      counts: { sessions: state.sessions.length, busy, agentsRunning },
    };
  }

  return {
    refresh,
    snapshot,
    sessionIds: () => new Set(state.sessions.map((s) => s.sessionId)),
    /** Ordner, deren Aenderungen einen Statuswechsel bedeuten koennen. */
    watchDirs: () => configDirs().map((d) => path.join(d, 'sessions')),
  };
}
