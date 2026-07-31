/**
 * Einlesen und Normalisieren der Claude-Code-Transkripte (.jsonl).
 *
 * Zwei Dinge, die in echten Daten verifiziert wurden und die Logik bestimmen:
 *
 * 1. Claude Code schreibt EINE ZEILE PRO CONTENT-BLOCK (text, tool_use,
 *    thinking) und haengt an jede das VOLLSTAENDIGE, identische usage-Objekt.
 *    Ohne Deduplizierung ueber (message.id, requestId) werden Tokens dadurch
 *    ueber den Faktor 2 hinaus doppelt gezaehlt.
 *
 * 2. cache_creation trennt ephemeral_5m/1h. Die beiden haben unterschiedliche
 *    Preise, deshalb werden sie hier getrennt gefuehrt statt aufsummiert.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_IGNORED_MODELS = new Set(['<synthetic>']);

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

/** Alle .jsonl-Dateien unterhalb der Datenverzeichnisse auflisten. */
export function listTranscripts(dirs) {
  const files = [];
  for (const dir of dirs) {
    let projects;
    try {
      projects = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const p of projects) {
      if (!p.isDirectory()) continue;
      const projectDir = path.join(dir, p.name);
      let entries;
      try {
        entries = fs.readdirSync(projectDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const f of entries) {
        if (f.isFile() && f.name.endsWith('.jsonl')) {
          files.push({ file: path.join(projectDir, f.name), projectDir: p.name });
        }
      }
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
  };
}

/**
 * Einen Textblock aus vollstaendigen JSONL-Zeilen parsen.
 * Kaputte Zeilen werden uebersprungen und gezaehlt, nicht geworfen.
 */
export function parseChunk(text, opts = {}) {
  const entries = [];
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
    } catch {
      skipped++;
    }
  }
  return { entries, skipped };
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
 */
export async function readIncremental(filePath, fromOffset = 0, opts = {}) {
  let fh;
  try {
    fh = await fs.promises.open(filePath, 'r');
  } catch {
    return { entries: [], skipped: 0, offset: fromOffset, size: 0, missing: true };
  }
  try {
    const stat = await fh.stat();
    const size = stat.size;

    let start = fromOffset;
    let restarted = false;
    if (size < fromOffset) {
      start = 0;
      restarted = true;
    }
    if (size === start) {
      return { entries: [], skipped: 0, offset: start, size, restarted, mtimeMs: stat.mtimeMs };
    }

    const length = size - start;
    const buf = Buffer.allocUnsafe(length);
    let bytesRead = 0;
    while (bytesRead < length) {
      const { bytesRead: n } = await fh.read(buf, bytesRead, length - bytesRead, start + bytesRead);
      if (n === 0) break;
      bytesRead += n;
    }

    const view = buf.subarray(0, bytesRead);
    // Nur bis zum letzten Zeilenumbruch konsumieren. Der Schnitt liegt auf
    // einem \n-Byte, das nie Teil einer Mehrbyte-UTF-8-Sequenz ist.
    const lastNl = view.lastIndexOf(0x0a);
    if (lastNl === -1) {
      return { entries: [], skipped: 0, offset: start, size, restarted, mtimeMs: stat.mtimeMs };
    }
    const consumed = lastNl + 1;
    const text = view.subarray(0, consumed).toString('utf8');
    const { entries, skipped } = parseChunk(text, opts);

    return {
      entries,
      skipped,
      offset: start + consumed,
      size,
      restarted,
      mtimeMs: stat.mtimeMs,
    };
  } finally {
    await fh.close().catch(() => {});
  }
}
