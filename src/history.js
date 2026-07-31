/**
 * Persistente Verbrauchs-Historie (data/history.json).
 *
 * Drei Aufgaben:
 *
 * 1. Die Transkripte sind nur geliehen. Claude Code raeumt sie nach einer
 *    eigenen Frist auf - danach waere die Zeitreihe ersatzlos weg. Das Archiv
 *    haelt die Tagessummen fest, auch wenn die Quelldatei laengst geloescht ist.
 * 2. Kaltstart: vollstaendig archivierte, lange nicht mehr geaenderte Dateien
 *    muessen beim Start nicht erneut gelesen werden.
 * 3. Messpunkte fuer die Kalibrierung: Paare aus echter Auslastung (von
 *    Anthropic) und lokal gezaehlten Tokens im selben Fenster.
 *
 * Aufbau: pro Transkript-DATEI ein Datensatz mit Tagessummen je Modell. Das ist
 * idempotent (eine Datei wird beim erneuten Lesen ersetzt, nie aufaddiert) und
 * macht die Zusammenfuehrung mit Archiven anderer Geraete zu einer simplen
 * Vereinigung ueber die Datei-Id.
 *
 * Bewusst reines JSON ohne Datenbank: die Datei soll lesbar, kopierbar und
 * loeschbar bleiben, und das Projekt haengt weiterhin von nichts ab.
 */

import fs from 'node:fs';
import path from 'node:path';

import { dayKey } from './tz.js';
import { newTotals } from './pricing.js';

export const HISTORY_VERSION = 1;

const DAY_MS = 86_400_000;

/**
 * 64-Bit-Hash eines Dedup-Schluessels, als zwei 32-Bit-Werte in base36.
 *
 * Die vollstaendigen Schluessel zu speichern waere bei jahrelanger Nutzung
 * mehrere Megabyte; der Hash kostet 13 Zeichen. Wozu ueberhaupt: eine mit
 * --fork-session abgespaltene Sitzung enthaelt die Nachrichten der Ursprungs-
 * sitzung noch einmal. Ueberlebt die Abspaltung das Aufraeumen des Originals,
 * wuerden dessen archivierte Tokens beim naechsten Kaltstart ein zweites Mal
 * gezaehlt. Der Hash-Satz der nicht gelesenen Dateien verhindert genau das.
 */
export function keyHash(str) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(36)}.${(h2 >>> 0).toString(36)}`;
}

/**
 * Stabile Id einer Transkript-Datei: Projektordner + Dateiname.
 *
 * Bewusst NICHT der absolute Pfad - der unterscheidet sich zwischen Windows und
 * macOS, waehrend die Session-UUID im Dateinamen global eindeutig ist. Dadurch
 * erkennt die Zusammenfuehrung zweier Geraete dieselbe Datei wieder.
 */
export function transcriptId(projectDir, filePath) {
  return `${projectDir ?? '?'}/${path.basename(filePath)}`;
}

export function emptyArchive() {
  return {
    version: HISTORY_VERSION,
    updatedAt: 0,
    files: {},
    calibration: { fiveHour: [], week: [] },
  };
}

/** Archiv laden. Wirft nie - ein beschaedigtes Archiv startet einfach neu. */
export function loadArchive(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return emptyArchive();
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { ...emptyArchive(), corrupt: true };
  }
  if (!obj || typeof obj !== 'object' || obj.version !== HISTORY_VERSION) {
    // Kein stillschweigendes Migrieren: lieber neu aufbauen, als aus einem
    // unbekannten Format falsche Zahlen abzuleiten.
    return { ...emptyArchive(), replaced: obj?.version ?? null };
  }
  const a = emptyArchive();
  a.updatedAt = Number(obj.updatedAt) || 0;
  if (obj.files && typeof obj.files === 'object') {
    for (const [id, rec] of Object.entries(obj.files)) {
      if (rec && typeof rec === 'object' && rec.days && typeof rec.days === 'object') {
        a.files[id] = rec;
      }
    }
  }
  for (const kind of ['fiveHour', 'week']) {
    const list = obj.calibration?.[kind];
    if (Array.isArray(list)) {
      a.calibration[kind] = list.filter(
        (s) => s && Number.isFinite(s.p) && Number.isFinite(s.w) && Number.isFinite(s.e),
      );
    }
  }
  return a;
}

/**
 * Archiv schreiben - erst in eine temporaere Datei, dann umbenennen.
 * Ein abgebrochener Schreibvorgang laesst so kein halbes JSON zurueck.
 */
export function saveArchive(file, archive, { now = Date.now() } = {}) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const out = {
    version: HISTORY_VERSION,
    updatedAt: now,
    files: archive.files,
    calibration: archive.calibration,
  };
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(out), 'utf8');
  fs.renameSync(tmp, file);
  archive.updatedAt = now;
  return file;
}

/** Leerer Datensatz fuer eine Datei. */
export function newRecord({ project = null, path: filePath = null } = {}) {
  return {
    path: filePath,
    project,
    cwd: null,
    cwdDepth: Infinity,
    size: 0,
    mtimeMs: 0,
    offset: 0,
    firstTs: null,
    lastTs: null,
    days: {},
    keys: [],
  };
}

/**
 * Eingelesene Eintraege einer Datei in deren Datensatz uebernehmen.
 * Wird beim vollstaendigen Neulesen mit einem frischen Datensatz aufgerufen,
 * beim inkrementellen Nachlesen mit dem bestehenden.
 */
export function applyEntries(record, entries, { timeZone = 'Europe/Berlin' } = {}) {
  for (const e of entries) {
    const day = dayKey(e.ts, timeZone);
    let byModel = record.days[day];
    if (!byModel) byModel = record.days[day] = {};
    const mk = `${e.model}|${e.speed === 'fast' ? 'fast' : 'std'}`;
    // [input, output, cacheWrite5m, cacheWrite1h, cacheRead, count]
    let v = byModel[mk];
    if (!v) v = byModel[mk] = [0, 0, 0, 0, 0, 0];
    v[0] += e.input || 0;
    v[1] += e.output || 0;
    v[2] += e.cacheWrite5m || 0;
    v[3] += e.cacheWrite1h || 0;
    v[4] += e.cacheRead || 0;
    v[5] += 1;

    if (record.firstTs == null || e.ts < record.firstTs) record.firstTs = e.ts;
    if (record.lastTs == null || e.ts > record.lastTs) record.lastTs = e.ts;
    if (e.key) record.keys.push(keyHash(e.key));

    // Flachstes cwd merken - daraus wird spaeter der Anzeigename des Projekts.
    const cwd = typeof e.cwd === 'string' && e.cwd.trim() ? e.cwd : null;
    if (cwd) {
      const depth = cwd.split(/[\\/]/).filter(Boolean).length;
      if (depth < (record.cwdDepth ?? Infinity)) {
        record.cwd = cwd;
        record.cwdDepth = depth;
      }
    }
  }
  return record;
}

/**
 * Alle Tagesbuckets des Archivs flach ausgeben.
 * @returns {Array<{day, project, cwd, model, speed, tokens, count, fromDisk}>}
 */
export function archiveBuckets(archive) {
  const out = [];
  for (const rec of Object.values(archive.files ?? {})) {
    for (const [day, byModel] of Object.entries(rec.days ?? {})) {
      for (const [mk, v] of Object.entries(byModel)) {
        const sep = mk.lastIndexOf('|');
        const model = sep === -1 ? mk : mk.slice(0, sep);
        const speed = sep === -1 ? 'std' : mk.slice(sep + 1);
        out.push({
          day,
          project: rec.project ?? 'unbekannt',
          cwd: rec.cwd ?? null,
          cwdDepth: rec.cwdDepth ?? Infinity,
          model,
          speed: speed === 'fast' ? 'fast' : 'standard',
          tokens: {
            input: v[0] || 0,
            output: v[1] || 0,
            cacheWrite5m: v[2] || 0,
            cacheWrite1h: v[3] || 0,
            cacheRead: v[4] || 0,
          },
          count: v[5] || 0,
          present: Boolean(rec.path),
        });
      }
    }
  }
  return out;
}

/** Alle Schluessel-Hashes ausser denen der uebergebenen Dateien. */
export function hashesExcept(archive, excludeIds = new Set()) {
  const set = new Set();
  for (const [id, rec] of Object.entries(archive.files ?? {})) {
    if (excludeIds.has(id)) continue;
    for (const h of rec.keys ?? []) set.add(h);
  }
  return set;
}

/**
 * Archiv beschneiden: alte Tage entfernen, Schluessel-Hashes laengst
 * abgeschlossener Dateien vergessen, leere Datensaetze verwerfen.
 */
export function pruneArchive(archive, { now = Date.now(), retainDays = 400, keyDays = 120 } = {}) {
  const dayCutoff = dayKeyFromMs(now - retainDays * DAY_MS);
  const keyCutoff = now - keyDays * DAY_MS;
  let removedDays = 0;
  let removedFiles = 0;
  let removedKeys = 0;

  for (const [id, rec] of Object.entries(archive.files ?? {})) {
    for (const day of Object.keys(rec.days ?? {})) {
      if (day < dayCutoff) {
        delete rec.days[day];
        removedDays++;
      }
    }
    // Hashes braucht nur, wer noch als Doppelgaenger auftauchen kann. Eine
    // Datei, die seit Monaten nicht mehr angefasst wurde, wird nicht mehr
    // abgespalten - ihre Hashes koennen weg.
    if (rec.keys?.length && !rec.path && (rec.lastTs ?? 0) < keyCutoff) {
      removedKeys += rec.keys.length;
      rec.keys = [];
    }
    if (Object.keys(rec.days ?? {}).length === 0) {
      delete archive.files[id];
      removedFiles++;
    }
  }
  return { removedDays, removedFiles, removedKeys };
}

/**
 * Tagesschluessel fuer die Beschneidungs-Grenze - bewusst in UTC.
 * Die Grenze liegt bei Hunderten von Tagen; ob sie um eine Stunde verrutscht,
 * ist ohne Belang, und so bleibt die Funktion frei von Zonen-Annahmen.
 */
function dayKeyFromMs(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

/**
 * Archiv eines anderen Geraets hinzufuegen (read-only).
 *
 * Vereinigung ueber die Datei-Id. Kennt das eigene Archiv eine Datei bereits,
 * gewinnt der eigene Datensatz - so kann derselbe synchronisierte Ordner auf
 * beiden Geraeten liegen, ohne dass etwas doppelt zaehlt. Fremde Datensaetze
 * werden nie zurueckgeschrieben und nie erneut gelesen; ihr 'path' ist null.
 */
export function mergeForeign(archive, foreign) {
  let added = 0;
  for (const [id, rec] of Object.entries(foreign?.files ?? {})) {
    if (archive.files[id]) continue;
    archive.files[id] = { ...rec, path: null, foreign: true };
    added++;
  }
  return { added };
}

/* --- Kalibrierung -------------------------------------------------------- */

/**
 * Messpunkt aufnehmen: echte Auslastung gegen lokal gezaehlten Verbrauch.
 *
 * Gespeichert wird bewusst wenig: Zeitpunkt, Fensterende (identifiziert das
 * Fenster), Prozentwert, gewichtete Tokens, Kosten, Requestzahl.
 */
export function addSample(archive, kind, sample, { maxSamples = 500, minGapMs = 300_000 } = {}) {
  const list = archive.calibration[kind];
  if (!Array.isArray(list)) return false;
  const last = list[list.length - 1];
  // Nicht bei jedem Polling einen Punkt setzen: ein Dashboard, das den ganzen
  // Tag laeuft, wuerde die Stichprobe sonst mit Beinahe-Duplikaten fluten und
  // spaete Messpunkte kuenstlich uebergewichten.
  if (last && last.e === sample.e && sample.t - last.t < minGapMs) return false;
  list.push(sample);
  if (list.length > maxSamples) list.splice(0, list.length - maxSamples);
  return true;
}

/**
 * Regression durch den Ursprung: y = k * Prozent.
 *
 * Durch den Ursprung, weil beide Groessen zum Fensterstart gemeinsam bei null
 * beginnen - ein Achsenabschnitt waere hier physikalisch sinnlos.
 *
 * Guetemass ist NICHT R² (das ist bei Modellen ohne Achsenabschnitt fast immer
 * nahe 1 und damit nichtssagend), sondern der Variationskoeffizient der
 * einzelnen Verhaeltnisse y/x. Der ist einheitenfrei und deshalb direkt
 * vergleichbar zwischen "Tokens erklaeren die Auslastung" und "Kosten
 * erklaeren die Auslastung".
 */
export function fitRatio(samples, pick) {
  let sxx = 0;
  let sxy = 0;
  const ratios = [];
  for (const s of samples) {
    const x = s.p;
    const y = pick(s);
    if (!(x > 0) || !(y > 0)) continue;
    sxx += x * x;
    sxy += x * y;
    ratios.push(y / x);
  }
  if (ratios.length < 2 || sxx === 0) return null;
  const perPercent = sxy / sxx;
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const variance = ratios.reduce((a, b) => a + (b - mean) ** 2, 0) / (ratios.length - 1);
  const cv = mean > 0 ? Math.sqrt(variance) / mean : null;
  return { perPercent, cv, n: ratios.length, mean };
}

/**
 * Kalibrier-Zusammenfassung fuer ein Fenster.
 *
 * 'ok' erst, wenn genug Punkte aus genug VERSCHIEDENEN Fenstern vorliegen -
 * zwanzig Messungen aus einer einzigen Sitzung sind keine zwanzig Belege.
 */
export function calibrationSummary(archive, kind, { minSamples = 8, minWindows = 3, cvGap = 0.15 } = {}) {
  const samples = archive.calibration?.[kind] ?? [];
  const windows = new Set(samples.map((s) => s.e)).size;
  const tokens = fitRatio(samples, (s) => s.w);
  const cost = fitRatio(samples, (s) => s.c);
  const ok = samples.length >= minSamples && windows >= minWindows && tokens != null;

  // Welche Groesse erklaert die Auslastung besser? Nur behaupten, wenn der
  // Unterschied deutlich ist - sonst bleibt die Frage ehrlich offen.
  let better = null;
  if (tokens?.cv != null && cost?.cv != null) {
    // Als Nenner die groessere Streuung: eine Streuung von exakt 0 ist der
    // beste denkbare Fit und darf nicht durch die Pruefung fallen.
    const denom = Math.max(tokens.cv, cost.cv);
    if (denom > 0) {
      const rel = (cost.cv - tokens.cv) / denom;
      if (rel > cvGap) better = 'tokens';
      else if (-rel > cvGap) better = 'cost';
    }
  }

  return {
    ok,
    samples: samples.length,
    windows,
    minSamples,
    minWindows,
    firstTs: samples.length ? samples[0].t : null,
    lastTs: samples.length ? samples[samples.length - 1].t : null,
    tokensPerPercent: tokens?.perPercent ?? null,
    tokensCv: tokens?.cv ?? null,
    costPerPercent: cost?.perPercent ?? null,
    costCv: cost?.cv ?? null,
    better,
    // 100 % des Limits, ausgedrueckt in gewichteten Tokens.
    limit: ok ? tokens.perPercent * 100 : null,
    costAtLimit: ok && cost ? cost.perPercent * 100 : null,
  };
}

/** Tokens eines Buckets als frisches Totals-Objekt. */
export function bucketTotals(bucket) {
  const t = newTotals();
  t.input = bucket.tokens.input;
  t.output = bucket.tokens.output;
  t.cacheWrite5m = bucket.tokens.cacheWrite5m;
  t.cacheWrite1h = bucket.tokens.cacheWrite1h;
  t.cacheRead = bucket.tokens.cacheRead;
  return t;
}
