/**
 * Zentraler Datenspeicher: haelt den deduplizierten Eintragsindex im
 * Arbeitsspeicher und liest Transkripte inkrementell nach.
 *
 * Pro Datei wird der Byte-Offset gemerkt, bis zu dem bereits gelesen wurde.
 * Ein Rescan liest deshalb nur den angehaengten Teil - bei einer laufenden
 * Sitzung sind das ein paar Kilobyte statt 26 MB.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { discoverDataDirs, listTranscripts, readIncremental } from './parser.js';
import { createPricing } from './pricing.js';
import { buildSnapshot } from './aggregate.js';
import { fetchLiveUsage } from './liveUsage.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadConfig(file = path.join(rootDir, 'config.json')) {
  return readJson(file);
}

export function loadPricingTable(file = path.join(rootDir, 'pricing.json')) {
  return readJson(file);
}

export function createStore({ config, pricingTable } = {}) {
  const cfg = config ?? loadConfig();
  const table = pricingTable ?? loadPricingTable();
  const pricing = createPricing(table);
  const ignoreModels = new Set(table?.ignoreModels?.list ?? ['<synthetic>']);

  /** Dedup-Index: Schluessel -> normalisierter Eintrag. */
  const entries = new Map();
  /** Datei-Zustand: Pfad -> { offset, size, mtimeMs, dirName }. */
  const fileStates = new Map();

  const stats = {
    dirs: [],
    files: 0,
    rawEntries: 0,
    duplicatesSkipped: 0,
    brokenLines: 0,
    lastScanMs: null,
    lastScanDurationMs: null,
    bytesReadTotal: 0,
    fullRescans: 0,
  };

  function dataDirs() {
    return discoverDataDirs({
      extra: cfg.dataDirs?.extra ?? [],
      only: cfg.dataDirs?.only ?? [],
    });
  }

  /**
   * Alle Transkripte pruefen und geaenderte Teile nachlesen.
   * @param {boolean} force alles komplett neu einlesen
   */
  async function scan({ force = false } = {}) {
    const started = Date.now();
    const dirs = dataDirs();
    stats.dirs = dirs;

    if (force) {
      entries.clear();
      fileStates.clear();
      stats.rawEntries = 0;
      stats.duplicatesSkipped = 0;
      stats.brokenLines = 0;
      stats.fullRescans++;
    }

    const files = listTranscripts(dirs);
    stats.files = files.length;
    let changed = 0;

    for (const { file, projectDir } of files) {
      const prev = fileStates.get(file);

      // Unveraenderte Dateien ueberspringen: gleiche Groesse UND gleiche mtime.
      if (prev) {
        let st;
        try {
          st = fs.statSync(file);
        } catch {
          continue;
        }
        if (st.size === prev.size && st.mtimeMs === prev.mtimeMs) continue;
      }

      const from = prev?.offset ?? 0;
      const result = await readIncremental(file, from, {
        fallbackDirName: projectDir,
        ignoreModels,
      });
      if (result.missing) {
        fileStates.delete(file);
        continue;
      }

      stats.bytesReadTotal += Math.max(0, result.offset - (result.restarted ? 0 : from));
      stats.brokenLines += result.skipped;

      for (const entry of result.entries) {
        stats.rawEntries++;
        if (entries.has(entry.key)) {
          // Erwarteter Normalfall: Claude Code schreibt eine Zeile pro
          // Content-Block, jede mit demselben usage-Objekt.
          stats.duplicatesSkipped++;
          continue;
        }
        entries.set(entry.key, entry);
      }

      fileStates.set(file, {
        offset: result.offset,
        size: result.size,
        mtimeMs: result.mtimeMs,
        dirName: projectDir,
      });
      changed++;
    }

    stats.lastScanMs = Date.now();
    stats.lastScanDurationMs = stats.lastScanMs - started;
    return { changed, files: files.length };
  }

  /**
   * Echte Auslastung von Anthropic holen - gedrosselt, damit ein 20-Sekunden-
   * Polling nicht zu 20-Sekunden-API-Aufrufen fuehrt. Der zuletzt erfolgreiche
   * Wert wird weiterverwendet, solange er frisch genug ist.
   */
  let liveUsage = null;
  let liveFetchedAt = 0;
  let liveInFlight = null;

  async function refreshLiveUsage({ force = false, now = Date.now() } = {}) {
    if (cfg.liveUsage?.enabled === false) {
      liveUsage = { ok: false, reason: 'disabled', fetchedAt: now };
      return liveUsage;
    }
    const minInterval = cfg.liveUsage?.minIntervalMs ?? 60000;
    if (!force && liveUsage && now - liveFetchedAt < minInterval) return liveUsage;
    if (liveInFlight) return liveInFlight;

    liveInFlight = fetchLiveUsage({ now, timeoutMs: cfg.liveUsage?.timeoutMs ?? 6000 })
      .then((result) => {
        // Nur erfolgreiche Abrufe setzen den Drossel-Zeitstempel: nach einem
        // Fehler darf der naechste Versuch sofort erfolgen.
        if (result.ok) liveFetchedAt = now;
        liveUsage = result;
        return result;
      })
      .catch((err) => {
        liveUsage = { ok: false, reason: 'network', fetchedAt: now, message: err?.message };
        return liveUsage;
      })
      .finally(() => {
        liveInFlight = null;
      });
    return liveInFlight;
  }

  function snapshot(now = Date.now()) {
    return buildSnapshot([...entries.values()], {
      config: cfg,
      pricing,
      now,
      liveUsage,
      scan: {
        dirs: stats.dirs,
        files: stats.files,
        rawEntries: stats.rawEntries,
        uniqueRequests: entries.size,
        duplicatesSkipped: stats.duplicatesSkipped,
        brokenLines: stats.brokenLines,
        lastScanMs: stats.lastScanMs,
        lastScanDurationMs: stats.lastScanDurationMs,
        bytesReadTotal: stats.bytesReadTotal,
        fullRescans: stats.fullRescans,
      },
    });
  }

  return {
    config: cfg,
    pricing,
    scan,
    snapshot,
    dataDirs,
    refreshLiveUsage,
    get liveUsage() {
      return liveUsage;
    },
    get size() {
      return entries.size;
    },
    get stats() {
      return { ...stats, uniqueRequests: entries.size };
    },
  };
}

/**
 * Datei-Watcher mit Entprellung. Faellt still auf reines Polling zurueck,
 * falls fs.watch auf dem Dateisystem nicht funktioniert (Netzlaufwerke,
 * manche Container-Mounts).
 */
export function createWatcher(dirs, onChange, { debounceMs = 400 } = {}) {
  const watchers = [];
  let timer = null;
  let watching = false;

  const trigger = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, debounceMs);
  };

  for (const dir of dirs) {
    try {
      const w = fs.watch(dir, { recursive: true }, (_event, filename) => {
        if (!filename || filename.endsWith('.jsonl')) trigger();
      });
      w.on('error', () => {});
      watchers.push(w);
      watching = true;
    } catch {
      // Kein rekursives Watching verfuegbar - Polling uebernimmt.
    }
  }

  return {
    active: watching,
    close() {
      if (timer) clearTimeout(timer);
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          /* egal */
        }
      }
    },
  };
}
