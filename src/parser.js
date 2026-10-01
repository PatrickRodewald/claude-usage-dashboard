/**
 * Einlesen und Normalisieren der Claude-Code-Transkripte (.jsonl).
 *
 * Drei Dinge, die in echten Daten verifiziert wurden und die Logik bestimmen:
 *
 * 1. Claude Code schreibt EINE ZEILE PRO CONTENT-BLOCK (text, tool_use,
 *    thinking) und haengt an jede ein usage-Objekt. Ohne Deduplizierung ueber
 *    (message.id, requestId) werden Tokens dadurch ueber den Faktor 2 hinaus
 *    doppelt gezaehlt.
 *
 * 2. Diese usage-Objekte sind NICHT immer identisch: in Subagent-Transkripten
 *    (agent-*.jsonl) tragen die fruehen Zeilen einen vorlaeufigen Output-Stand
 *    von 1-4 Tokens, erst die letzte den endgueltigen. Wer die erste Zeile
 *    behaelt, verliert dort den Grossteil des Outputs (in echten Daten 17 %
 *    des gesamten Outputs). Deshalb gilt je Zaehler das Maximum aller Zeilen -
 *    siehe mergeDuplicate.
 *
 * 3. cache_creation trennt ephemeral_5m/1h. Die beiden haben unterschiedliche
 *    Preise, deshalb werden sie hier getrennt gefuehrt statt aufsummiert.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_IGNORED_MODELS = new Set(['<synthetic>']);

/**
 * Stand der Auswertung. Erhoehen, wenn sich das Lesen der Transkripte so
 * aendert, dass archivierte Summen noch vorhandener Dateien falsch sind - der
 * naechste Start liest diese Dateien dann einmal vollstaendig neu, statt sie
 * als "fertig archiviert" zu ueberspringen.
 *
 *  1: Ausgangsstand
 *  2: Subagent-Output aus der letzten statt der ersten Zeile eines Requests
 */
export const READER_REV = 2;

/**
 * Verzeichnisse mit Transkripten finden.
 * Reihenfolge: $CLAUDE_CONFIG_DIR, ~/.claude, ~/.config/claude, plus extras.
 */
export function discoverDataDirs({ env = process.env, home = os.homedir(), extra = [], only = [] } = {}) {
  const candidates = [];
  // 'only' schaltet die Suche komplett ab und nutzt ausschliesslich die
  // angegebenen Pfade - fuer abweichende Ablageorte und fuer Demo-Daten.
  if (only.length) {
    const seenOnly = new Set();
    const found = [];
    for (const dir of only) {
      if (!dir) continue;
      const resolved = path.resolve(dir);
      if (seenOnly.has(resolved)) continue;
      seenOnly.add(resolved);
      try {
        if (fs.statSync(resolved).isDirectory()) found.push(resolved);
      } catch {
        /* nicht vorhanden */
      }
    }
    return found;
  }
  if (env.CLAUDE_CONFIG_DIR) {
    for (const part of env.CLAUDE_CONFIG_DIR.split(path.delimiter)) {
      if (part.trim()) candidates.push(path.join(part.trim(), 'projects'));
    }
  }
  candidates.push(path.join(home, '.claude', 'projects'));
  candidates.push(path.join(home, '.config', 'claude', 'projects'));
  for (const e of extra) if (e) candidates.push(e);

  const seen = new Set();
  const found = [];
  for (const dir of candidates) {
    const resolved = path.resolve(dir);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    try {
      if (fs.statSync(resolved).isDirectory()) found.push(resolved);
    } catch {
      // Nicht vorhanden - das ist der Normalfall fuer die meisten Kandidaten.
    }
  }
  return found;
}

/**
 * Wie tief unterhalb eines Projektordners nach Transkripten gesucht wird.
 * Subagents liegen in <Projekt>/<Session>/subagents/agent-*.jsonl, also zwei
 * Ebenen tiefer; eine Ebene Reserve fuer kuenftige Ablagen.
 */
const MAX_TRANSCRIPT_DEPTH = 3;

/**
 * Alle .jsonl-Dateien unterhalb der Datenverzeichnisse auflisten.
 *
 * Bewusst auch in Unterordnern: Claude Code schreibt Subagent-Sitzungen in
 * eigene Dateien unter <Session>/subagents/. Wer nur die oberste Ebene liest,
 * verliert deren Verbrauch komplett - in echten Daten ein erheblicher Teil.
 * Doppelt erfasste Requests faengt die Deduplizierung ueber den Schluessel ab.
 */
export function listTranscripts(dirs) {
  const files = [];
  const walk = (dir, projectName, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const f of entries) {
      const p = path.join(dir, f.name);
      if (f.isFile() && f.name.endsWith('.jsonl')) {
        files.push({ file: p, projectDir: projectName });
      } else if (f.isDirectory() && depth < MAX_TRANSCRIPT_DEPTH) {
        walk(p, projectName, depth + 1);
      }
    }
  };
  for (const dir of dirs) {
    let projects;
    try {
      projects = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const p of projects) {
      if (p.isDirectory()) walk(path.join(dir, p.name), p.name, 0);
    }
  }
  return files;
}

/** Lesbarer Projektname: bevorzugt cwd aus dem Eintrag, sonst Ordnername. */
export function projectNameFrom(cwd, fallbackDirName) {
  if (typeof cwd === 'string' && cwd.trim()) {
    const cleaned = cwd.replace(/[\\/]+$/, '');
    const parts = cleaned.split(/[\\/]/);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  if (!fallbackDirName) return 'unbekannt';
  // Rueckfall auf den Ordnernamen: "c--Projekte-beispiel-projekt" -> "beispiel-projekt".
  // Die Kodierung ist verlustbehaftet (ein '-' im Originalpfad ist nicht vom
  // Trennzeichen zu unterscheiden), deshalb nur die Heuristik "erstes Segment
  // ist das Elternverzeichnis". Greift ohnehin fast nie, weil echte Eintraege
  // immer ein cwd mitbringen.
  const m = /^[a-zA-Z]--(.*)$/.exec(fallbackDirName);
  const rest = m ? m[1] : fallbackDirName;
  const segs = rest.split('-').filter(Boolean);
  return segs.length >= 2 ? segs.slice(1).join('-') : rest;
}

/**
 * Dedup-Schluessel. Primaer (message.id, requestId) - so macht es auch ccusage.
 * requestId fehlt in echten Daten bei einigen wenigen Eintraegen, deshalb der
 * Rueckfall auf uuid; ohne den wuerden diese Eintraege alle auf denselben
 * Schluessel "msg_x::undefined" kollabieren und faelschlich verworfen.
 */
export function dedupKey(obj) {
  const id = obj?.message?.id;
  if (!id) return null;
  const req = obj.requestId ?? obj.uuid;
  if (!req) return null;
  return `${id}::${req}`;
}

/**
 * Eine geparste JSONL-Zeile in einen normalisierten Eintrag umwandeln.
 * Gibt null zurueck, wenn die Zeile keine abrechenbare Nutzung enthaelt.
 */
export function extractEntry(obj, { fallbackDirName, ignoreModels = DEFAULT_IGNORED_MODELS } = {}) {
  if (!obj || obj.type !== 'assistant') return null;
  const message = obj.message;
  const usage = message?.usage;
  if (!usage) return null;

  const model = message.model;
  if (!model || ignoreModels.has(model)) return null;

  const key = dedupKey(obj);
  if (!key) return null;

  const ts = Date.parse(obj.timestamp);
  if (!Number.isFinite(ts)) return null;

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

  // Cache-Writes nach TTL trennen. Fehlt die Aufschluesselung (aeltere
  // Claude-Code-Versionen), faellt alles auf 5m zurueck - das ist Anthropics
  // Default-TTL und der guenstigere der beiden Saetze, also die konservative
  // Annahme fuer eine Kostenschaetzung.
  const cc = usage.cache_creation;
  const ccTotal = num(usage.cache_creation_input_tokens);
  let cacheWrite5m = 0;
  let cacheWrite1h = 0;
  if (cc && (typeof cc.ephemeral_5m_input_tokens === 'number' || typeof cc.ephemeral_1h_input_tokens === 'number')) {
    cacheWrite5m = num(cc.ephemeral_5m_input_tokens);
    cacheWrite1h = num(cc.ephemeral_1h_input_tokens);
    // Summe stimmt nicht mit dem Gesamtfeld ueberein -> Gesamtfeld gewinnt,
    // Differenz landet beim guenstigeren 5m-Satz.
    const sum = cacheWrite5m + cacheWrite1h;
    if (ccTotal > sum) cacheWrite5m += ccTotal - sum;
  } else {
    cacheWrite5m = ccTotal;
  }

  // Projekt-Identitaet ist der Transkript-Ordner, NICHT das cwd: waehrend einer
  // Sitzung wechselt cwd in Unterverzeichnisse, wodurch ein Projekt sonst in
  // "src", "server", "components" ... zerfaellt. Das cwd dient nur noch dazu,
  // spaeter einen lesbaren Namen abzuleiten.
  const project = fallbackDirName || projectNameFrom(obj.cwd, null);

  const str = (v) => (typeof v === 'string' && v.trim() ? v : null);
  const thinking = usage.output_tokens_details?.thinking_tokens;
  const toolUse = Array.isArray(message.content)
    ? message.content.find((b) => b?.type === 'tool_use' && typeof b.name === 'string')
    : null;

  return {
    key,
    ts,
    model,
    speed: usage.speed === 'fast' ? 'fast' : 'standard',
    sessionId: obj.sessionId ?? null,
    project,
    projectDir: fallbackDirName ?? null,
    cwd: obj.cwd ?? null,
    input: num(usage.input_tokens),
    output: num(usage.output_tokens),
    cacheWrite5m,
    cacheWrite1h,
    cacheRead: num(usage.cache_read_input_tokens),
    // Thinking-Anteil am Output. null heisst "nicht gemeldet" (aeltere
    // Versionen, Zwischenzeilen) - das ist etwas anderes als 0.
    thinking: typeof thinking === 'number' ? num(thinking) : null,
    // Zuordnung, die Claude Code mitschreibt: welcher Subagent bzw. Skill den
    // Request ausgeloest hat, und mit welcher Effort-Stufe er lief.
    agent: str(obj.attributionAgent),
    skill: str(obj.attributionSkill),
    effort: str(obj.effort),
    // Id des Subagents (nur in dessen eigenem Transkript gesetzt) - damit
    // laesst sich der Verbrauch eines gerade laufenden Agents zuordnen.
    agentId: str(obj.agentId),
    // Erstes Werkzeug, das dieser Request aufruft - fuer den Tagesrueckblick.
    // Claude Code schreibt je Content-Block eine Zeile; der Werkzeugaufruf
    // kommt per mergeDuplicate dazu.
    tool: str(toolUse?.name),
  };
}

/**
 * Weitere Zeile desselben Requests in den vorhandenen Eintrag einarbeiten.
 *
 * Zaehler wachsen waehrend des Streamens nur (Output ohnehin; Input und
 * Cache-Reads bei Turns mit serverseitigen Tools ueber mehrere Modellaufrufe),
 * deshalb gilt je Feld das Maximum. Die beiden Cache-Write-Felder werden als
 * Paar uebernommen, weil ihre Aufteilung aus derselben Zeile stammen muss.
 *
 * @returns Zuwachs je Feld - oder null, wenn die Zeile nichts Neues bringt.
 *          Der Zuwachs kann fuer EIN Cache-Write-Feld negativ sein, wenn sich
 *          nur die Aufteilung verschiebt; die Summe waechst trotzdem.
 */
export function mergeDuplicate(target, src) {
  let delta = null;
  for (const f of ['input', 'output', 'cacheRead']) {
    const d = (src[f] || 0) - (target[f] || 0);
    if (d > 0) {
      (delta ??= {})[f] = d;
      target[f] += d;
    }
  }
  const tw = (target.cacheWrite5m || 0) + (target.cacheWrite1h || 0);
  const sw = (src.cacheWrite5m || 0) + (src.cacheWrite1h || 0);
  if (sw > tw) {
    delta ??= {};
    delta.cacheWrite5m = (src.cacheWrite5m || 0) - (target.cacheWrite5m || 0);
    delta.cacheWrite1h = (src.cacheWrite1h || 0) - (target.cacheWrite1h || 0);
    target.cacheWrite5m = src.cacheWrite5m || 0;
    target.cacheWrite1h = src.cacheWrite1h || 0;
  }
  if (src.thinking != null && (target.thinking == null || src.thinking > target.thinking)) {
    target.thinking = src.thinking;
  }
  target.agent ??= src.agent ?? null;
  target.skill ??= src.skill ?? null;
  target.effort ??= src.effort ?? null;
  target.agentId ??= src.agentId ?? null;
  target.tool ??= src.tool ?? null;
  return delta;
}

const LIMIT_KIND = { five_hour: 'fiveHour', seven_day: 'week' };

/**
 * Limit-Treffer aus einer Zeile lesen.
 *
 * Lehnt Anthropic einen Request wegen des Abo-Limits ab (HTTP 429), schreibt
 * Claude Code eine Fehlerzeile mit quotaLimits: welches Fenster voll war und
 * wann es zurueckgesetzt wird. Das ist der einzige Moment, in dem die
 * Auslastung EXAKT bekannt ist - 100 % - und damit ein Messpunkt ohne
 * Rundung und ohne Abruf.
 *
 * Diese Zeilen tragen das Modell <synthetic> und keine Nutzung, deshalb
 * laufen sie hier getrennt von extractEntry.
 */
export function extractLimitEvent(obj) {
  if (!obj || obj.type !== 'assistant') return null;
  const q = obj.quotaLimits;
  if (!q || typeof q !== 'object' || q.status !== 'rejected') return null;
  const kind = LIMIT_KIND[q.rateLimitType];
  if (!kind) return null;
  const ts = Date.parse(obj.timestamp);
  const resets = Number(q.resetsAt);
  if (!Number.isFinite(ts) || !Number.isFinite(resets) || resets <= 0) return null;
  // resetsAt kommt in Sekunden; ein Wert in Millisekunden wird nicht erneut
  // umgerechnet.
  const end = resets < 1e12 ? resets * 1000 : resets;
  if (end <= ts) return null;
  return { key: `${kind}:${end}`, kind, ts, end };
}

/**
 * Einen Textblock aus vollstaendigen JSONL-Zeilen parsen.
 * Kaputte Zeilen werden uebersprungen und gezaehlt, nicht geworfen.
 */
export function parseChunk(text, opts = {}) {
  const entries = [];
  const events = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    try {
      const entry = extractEntry(obj, opts);
      if (entry) entries.push(entry);
      const event = extractLimitEvent(obj);
      if (event) events.push(event);
    } catch {
      skipped++;
    }
  }
  return { entries, events, skipped };
}

/**
 * Inkrementelles Lesen ab einem Byte-Offset.
 *
 * Liest nur den angehaengten Teil der Datei. Eine unvollstaendige letzte Zeile
 * (Claude Code schreibt waehrend einer laufenden Sitzung weiter) wird NICHT
 * konsumiert - der Offset bleibt davor stehen, sodass sie beim naechsten Lauf
 * vollstaendig verarbeitet wird.
 *
 * Ist die Datei kleiner als der gespeicherte Offset, wurde sie rotiert oder
 * neu geschrieben -> vollstaendiger Neueinlesevorgang.
 *
 * Gelesen wird blockweise: Subagent-Transkripte erreichen in echten Daten
 * mehr als 500 MB, und ein String dieser Laenge uebersteigt das, was Node
 * ueberhaupt anlegen kann.
 */
const READ_CHUNK = 32 * 1024 * 1024;
/** Laengere Einzelzeilen werden uebersprungen statt den Speicher zu sprengen. */
const MAX_LINE = 256 * 1024 * 1024;


/**
 * Vollstaendige Zeilen einer Datei ab einem Byte-Offset blockweise lesen.
 *
 * onText bekommt Textbloecke, die ausschliesslich aus vollstaendigen Zeilen
 * bestehen. Grundlage fuer readIncremental und fuer alles andere, das
 * Transkripte nachverfolgt (activity.js) - die Regeln zu angefangenen und
 * ueberlangen Zeilen gelten damit ueberall gleich.
 *
 * @returns {{offset, size, restarted, mtimeMs, skipped, missing?}}
 */
export async function scanLines(filePath, fromOffset, onText, opts = {}) {
  let fh;
  try {
    fh = await fs.promises.open(filePath, 'r');
  } catch {
    return { skipped: 0, offset: fromOffset, size: 0, missing: true };
  }
  try {
    const stat = await fh.stat();
    const size = stat.size;

    let start = fromOffset;
    let restarted = false;
    if (size < fromOffset) {
      start = 0;
      restarted = true;
      // Vor dem ersten Block melden, damit der Aufrufer seinen Stand
      // zuruecksetzen kann - sonst muesste er die Datei ein zweites Mal lesen.
      opts.onRestart?.();
    }

    // Kleinere Werte nur fuer Tests, um Blockgrenzen ohne riesige Dateien zu pruefen.
    const chunkSize = opts.chunkSize ?? READ_CHUNK;
    const maxLine = opts.maxLine ?? MAX_LINE;
    let skipped = 0;
    // Bis hierhin ist alles verarbeitet; der Rest ist eine angefangene Zeile.
    let offset = start;
    let pos = start;
    let carry = Buffer.alloc(0);
    // Mitten in einer ueberlangen Zeile: Bytes bis zum naechsten \n verwerfen.
    let discarding = false;

    while (pos < size) {
      const length = Math.min(chunkSize, size - pos);
      const buf = Buffer.allocUnsafe(length);
      let n = 0;
      while (n < length) {
        const { bytesRead } = await fh.read(buf, n, length - n, pos + n);
        if (bytesRead === 0) break;
        n += bytesRead;
      }
      if (n === 0) break;
      pos += n;

      let data = buf.subarray(0, n);
      if (discarding) {
        const nl = data.indexOf(0x0a);
        if (nl === -1) {
          offset = pos;
          continue;
        }
        data = data.subarray(nl + 1);
        offset = pos - data.length;
        discarding = false;
      }
      if (carry.length) data = Buffer.concat([carry, data]);

      // Nur bis zum letzten Zeilenumbruch konsumieren. Der Schnitt liegt auf
      // einem \n-Byte, das nie Teil einer Mehrbyte-UTF-8-Sequenz ist.
      const lastNl = data.lastIndexOf(0x0a);
      if (lastNl === -1) {
        carry = data;
        if (carry.length > maxLine) {
          skipped++;
          carry = Buffer.alloc(0);
          discarding = true;
          offset = pos;
        }
        continue;
      }
      onText(data.subarray(0, lastNl + 1).toString('utf8'));
      carry = data.subarray(lastNl + 1);
      offset = pos - carry.length;
    }

    return { skipped, offset, size, restarted, mtimeMs: stat.mtimeMs };
  } finally {
    await fh.close().catch(() => {});
  }
}

export async function readIncremental(filePath, fromOffset = 0, opts = {}) {
  const entries = [];
  const events = [];
  let skipped = 0;
  const res = await scanLines(
    filePath,
    fromOffset,
    (text) => {
      const part = parseChunk(text, opts);
      for (const e of part.entries) entries.push(e);
      for (const e of part.events) events.push(e);
      skipped += part.skipped;
    },
    opts,
  );
  return { ...res, entries, events, skipped: skipped + res.skipped };
}

/**
 * Die letzten vollstaendigen Zeilen einer Datei, ohne sie ganz zu lesen.
 * Fuer "was macht dieser Agent gerade" reicht das Ende des Transkripts.
 */
export async function readTailLines(filePath, maxBytes = 256 * 1024) {
  let fh;
  try {
    fh = await fs.promises.open(filePath, 'r');
  } catch {
    return [];
  }
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.allocUnsafe(size - start);
    let n = 0;
    while (n < buf.length) {
      const { bytesRead } = await fh.read(buf, n, buf.length - n, start + n);
      if (bytesRead === 0) break;
      n += bytesRead;
    }
    let text = buf.subarray(0, n).toString('utf8');
    // Die letzte Zeile wird womoeglich gerade geschrieben.
    const complete = text.endsWith('\n');
    if (start > 0) {
      // Mitten in einer Zeile begonnen: das angeschnittene Stueck verwerfen.
      // Ohne jeden Umbruch im Fenster gibt es keine vollstaendige Zeile.
      const nl = text.indexOf('\n');
      if (nl === -1) return [];
      text = text.slice(nl + 1);
    }
    const lines = text.split('\n');
    if (!complete) lines.pop();
    return lines.filter((l) => l.trim());
  } finally {
    await fh.close().catch(() => {});
  }
}
