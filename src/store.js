/**
 * Zentraler Datenspeicher.
 *
 * Haelt drei Dinge zusammen:
 *  - den deduplizierten Eintragsindex der vorhandenen Transkripte (Arbeitsspeicher),
 *  - das persistente Archiv (data/history.json) mit Tagessummen je Datei,
 *  - den gedrosselten Abruf der echten Auslastung bei Anthropic.
 *
 * Pro Datei wird der Byte-Offset gemerkt, sodass ein Rescan nur den angehaengten
 * Teil liest. Vollstaendig archivierte, seit Wochen unveraenderte Dateien werden
 * beim Start gar nicht mehr geoeffnet - ihre Zahlen stehen im Archiv.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { discoverDataDirs, listTranscripts, readIncremental } from './parser.js';
import { createPricing, weightedTokens, newTotals, addTokens } from './pricing.js';
import { buildSnapshot } from './aggregate.js';
import { fetchLiveUsage } from './liveUsage.js';
import {
  loadArchive,
  saveArchive,
  emptyArchive,
  newRecord,
  applyEntries,
  archiveBuckets,
  transcriptId,
  hashesExcept,
  keyHash,
  pruneArchive,
  mergeForeign,
  addSample,
  calibrationSummary,
} from './history.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAY_MS = 86_400_000;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadConfig(file = path.join(rootDir, 'config.json')) {
  return readJson(file);
}

export function loadPricingTable(file = path.join(rootDir, 'pricing.json')) {
  return readJson(file);
}

export function createStore({ config, pricingTable, historyFile } = {}) {
  const cfg = config ?? loadConfig();
  const table = pricingTable ?? loadPricingTable();
  const pricing = createPricing(table);
  const ignoreModels = new Set(table?.ignoreModels?.list ?? ['<synthetic>']);
  const tz = cfg.timezone ?? 'Europe/Berlin';
  const weights = cfg.counting?.weights ?? {};

  const histCfg = cfg.history ?? {};
  const historyEnabled = histCfg.enabled !== false;
  const archiveFile =
    historyFile ?? path.resolve(rootDir, histCfg.file ?? path.join('data', 'history.json'));

  /** Dedup-Index der vorhandenen Dateien: Schluessel -> normalisierter Eintrag. */
  const entries = new Map();
  /** Datei-Zustand innerhalb dieses Prozesses: Pfad -> { offset, size, mtimeMs }. */
  const fileStates = new Map();
  /** Datei-Ids, die dieser Prozess selbst gelesen hat. */
  const readIds = new Set();

  let archive = emptyArchive();
  let archiveDirty = false;
  let lastSaveMs = 0;
  let archiveNote = null;
  /** Hashes archivierter Eintraege, die NICHT im Arbeitsspeicher liegen. */
  let foreignHashes = new Set();

  if (historyEnabled) {
    archive = loadArchive(archiveFile);
    if (archive.corrupt) archiveNote = 'beschaedigt, neu angelegt';
    else if (archive.replaced !== undefined && archive.replaced !== null) {
      archiveNote = `Format ${archive.replaced} unbekannt, neu angelegt`;
    }
    pruneArchive(archive, {
      now: Date.now(),
      retainDays: histCfg.retainDays ?? 400,
      keyDays: histCfg.keyDays ?? 120,
    });
    // Archive anderer Geraete nur lesend dazunehmen.
    for (const extra of histCfg.merge ?? []) {
      if (!extra) continue;
      const p = path.resolve(rootDir, extra);
      if (p === archiveFile) continue;
      const foreign = loadArchive(p);
      const { added } = mergeForeign(archive, foreign);
      if (added) archiveDirty = true;
    }
  }

  const stats = {
    dirs: [],
    files: 0,
    filesRead: 0,
    filesSkipped: 0,
    rawEntries: 0,
    duplicatesSkipped: 0,
    archiveDuplicates: 0,
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

  function recordFor(id, meta) {
    let rec = archive.files[id];
    if (!rec) rec = archive.files[id] = newRecord(meta);
    return rec;
  }

  /**
   * Alle Transkripte pruefen und geaenderte Teile nachlesen.
   * @param {boolean} force alles komplett neu einlesen
   */
  async function scan({ force = false, now = Date.now() } = {}) {
    const started = Date.now();
    const dirs = dataDirs();
    stats.dirs = dirs;

    if (force) {
      entries.clear();
      fileStates.clear();
      readIds.clear();
      stats.rawEntries = 0;
      stats.duplicatesSkipped = 0;
      stats.archiveDuplicates = 0;
      stats.brokenLines = 0;
      stats.fullRescans++;
    }

    const files = listTranscripts(dirs);
    stats.files = files.length;

    // Vollstaendig archivierte Dateien, die lange nicht mehr angefasst wurden,
    // werden nicht erneut geoeffnet. Die Grenze liegt bewusst weit hinter allem,
    // was das Dashboard im Detail zeigt (Tagesverlauf, Sessions, Bloecke).
    const detailDays = histCfg.detailDays ?? 45;
    const detailCutoff = now - detailDays * DAY_MS;

    const plan = [];
    const seenIds = new Set();
    for (const { file, projectDir } of files) {
      const id = transcriptId(projectDir, file);
      seenIds.add(id);
      let st;
      try {
        st = fs.statSync(file);
      } catch {
        continue;
      }
      const prev = fileStates.get(file);
      if (prev && st.size === prev.size && st.mtimeMs === prev.mtimeMs) continue;

      const rec = archive.files[id];
      const fullyArchived =
        historyEnabled &&
        !force &&
        !readIds.has(id) &&
        rec &&
        rec.path &&
        rec.size === st.size &&
        rec.mtimeMs === st.mtimeMs;

      if (fullyArchived && st.mtimeMs < detailCutoff) {
        stats.filesSkipped++;
        continue;
      }
      plan.push({ file, projectDir, id, st, from: prev?.offset ?? 0 });
    }

    // Dateien, die dieser Prozess nicht liest, koennen trotzdem Eintraege
    // beisteuern - deren Hashes verhindern, dass eine abgespaltene Sitzung
    // (--fork-session) dieselben Requests ein zweites Mal einbringt.
    //
    // Ausgeschlossen werden die gleich zu lesenden Dateien: ihre eigenen
    // Hashes aus dem letzten Lauf wuerden sie sonst beim Kaltstart selbst
    // blockieren, weil ihr Datensatz gerade neu aufgebaut wird.
    if (historyEnabled && plan.length) {
      const own = new Set(readIds);
      for (const p of plan) own.add(p.id);
      foreignHashes = hashesExcept(archive, own);
    }

    let changed = 0;
    for (const { file, projectDir, id, from } of plan) {
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

      const fresh = from === 0 || result.restarted;
      let rec = null;
      if (historyEnabled) {
        if (fresh) {
          // Vollstaendiges Neulesen ersetzt den Datensatz, statt aufzuaddieren -
          // nur so bleibt das Archiv bei wiederholten Laeufen stabil.
          rec = archive.files[id] = newRecord({ project: projectDir, path: file });
        } else {
          rec = recordFor(id, { project: projectDir, path: file });
          rec.path = file;
        }
        readIds.add(id);
      }

      const accepted = [];
      for (const entry of result.entries) {
        stats.rawEntries++;
        if (entries.has(entry.key)) {
          // Erwarteter Normalfall: Claude Code schreibt eine Zeile pro
          // Content-Block, jede mit demselben usage-Objekt.
          stats.duplicatesSkipped++;
          continue;
        }
        if (historyEnabled && foreignHashes.has(keyHash(entry.key))) {
          // Steht bereits in einer archivierten, hier nicht gelesenen Datei.
          stats.archiveDuplicates++;
          continue;
        }
        entries.set(entry.key, entry);
        accepted.push(entry);
      }

      if (rec) {
        applyEntries(rec, accepted, { timeZone: tz });
        rec.size = result.size;
        rec.mtimeMs = result.mtimeMs;
        rec.offset = result.offset;
        archiveDirty = true;
      }

      fileStates.set(file, {
        offset: result.offset,
        size: result.size,
        mtimeMs: result.mtimeMs,
      });
      changed++;
    }

    // Datensaetze ohne Datei auf der Platte behalten ihre Zahlen, verlieren aber
    // den Pfad - genau das ist der Fall "Claude Code hat aufgeraeumt".
    if (historyEnabled) {
      for (const [id, rec] of Object.entries(archive.files)) {
        if (rec.path && !seenIds.has(id)) {
          rec.path = null;
          archiveDirty = true;
        }
      }
    }

    stats.filesRead = readIds.size;
    stats.lastScanMs = Date.now();
    stats.lastScanDurationMs = stats.lastScanMs - started;
    maybeSave(now);
    return { changed, files: files.length };
  }

  function maybeSave(now = Date.now(), { force = false } = {}) {
    if (!historyEnabled || !archiveDirty) return false;
    const interval = histCfg.saveIntervalMs ?? 30_000;
    if (!force && now - lastSaveMs < interval) return false;
    try {
      saveArchive(archiveFile, archive, { now });
      lastSaveMs = now;
      archiveDirty = false;
      mirror();
      return true;
    } catch (err) {
      archiveNote = `konnte nicht geschrieben werden: ${err.message}`;
      return false;
    }
  }

  /** Kopie des Archivs an einen zweiten Ort legen (z. B. einen Sync-Ordner). */
  function mirror() {
    const target = histCfg.mirrorTo;
    if (!target) return;
    try {
      const p = path.resolve(rootDir, target);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.copyFileSync(archiveFile, p);
    } catch {
      /* Spiegeln ist Komfort, kein Muss - Fehler bleiben folgenlos. */
    }
  }

  /* --- Kalibrierung ------------------------------------------------------ */

  /**
   * Messpunkt aufnehmen: echte Auslastung gegen lokal gezaehlten Verbrauch im
   * exakt gleichen Zeitfenster. Daraus laesst sich spaeter ableiten, wie viele
   * gewichtete Tokens einem Prozent des Limits entsprechen - und ob Tokens die
   * Auslastung ueberhaupt besser erklaeren als die Kosten.
   */
  function sampleCalibration(result, now) {
    if (!historyEnabled || cfg.calibration?.enabled === false) return;
    if (!result?.ok) return;
    const minPercent = cfg.calibration?.minPercent ?? 3;
    const maxSamples = cfg.calibration?.maxSamples ?? 500;
    const minGapMs = cfg.calibration?.sampleIntervalMs ?? 300_000;

    for (const kind of ['fiveHour', 'week']) {
      const win = result[kind];
      if (!win || !Number.isFinite(win.percent) || win.percent < minPercent) continue;
      const tokens = newTotals();
      let cost = 0;
      let count = 0;
      let known = true;
      for (const e of entries.values()) {
        if (e.ts < win.start || e.ts >= win.end) continue;
        addTokens(tokens, e);
        const r = pricing.costFor(e, e.model, { speed: e.speed, timestampMs: e.ts });
        cost += r.cost;
        if (!r.known) known = false;
        count++;
      }
      if (count === 0 || !known) continue;
      const added = addSample(
        archive,
        kind,
        {
          t: now,
          e: win.end,
          p: win.percent,
          w: Math.round(weightedTokens(tokens, weights)),
          c: Number(cost.toFixed(4)),
          n: count,
        },
        { maxSamples, minGapMs },
      );
      if (added) archiveDirty = true;
    }
  }

  function calibration() {
    if (!historyEnabled || cfg.calibration?.enabled === false) return null;
    const opts = {
      minSamples: cfg.calibration?.minSamples ?? 8,
      minWindows: cfg.calibration?.minWindows ?? 3,
    };
    return {
      fiveHour: calibrationSummary(archive, 'fiveHour', opts),
      week: calibrationSummary(archive, 'week', opts),
    };
  }

  /* --- Echte Auslastung -------------------------------------------------- */

  /**
   * Echte Auslastung von Anthropic holen - gedrosselt, damit ein 20-Sekunden-
   * Polling nicht zu 20-Sekunden-API-Aufrufen fuehrt. Der zuletzt erfolgreiche
   * Wert wird weiterverwendet, solange er frisch genug ist.
   */
  let liveUsage = null;
  let liveInFlight = null;
  let liveFailures = 0;
  let nextLiveAttemptAt = 0;

  /**
   * Wartezeit nach einem Fehlversuch: exponentiell, gedeckelt.
   * Ohne das wuerde ein 429 bei 20-Sekunden-Polling alle 20 Sekunden erneut
   * angeklopft - was die Drosselung nur verlaengert.
   */
  function backoffMs(result, minInterval, maxBackoff) {
    if (result?.retryAfterMs) return Math.min(result.retryAfterMs, maxBackoff);
    const factor = 2 ** Math.min(liveFailures - 1, 10);
    return Math.min(minInterval * factor, maxBackoff);
  }

  async function refreshLiveUsage({ force = false, now = Date.now() } = {}) {
    if (cfg.liveUsage?.enabled === false) {
      liveUsage = { ok: false, reason: 'disabled', fetchedAt: now };
      return liveUsage;
    }
    const minInterval = cfg.liveUsage?.minIntervalMs ?? 60000;
    const maxBackoff = cfg.liveUsage?.maxBackoffMs ?? 900000;

    // 'force' darf die normale Drosselung ueberspringen, aber NICHT eine
    // laufende Fehler-Wartezeit: sonst wuerde ein Klick auf "Aktualisieren"
    // waehrend einer Drosselung genau das Verhalten ausloesen, das sie
    // verursacht hat.
    const inBackoff = liveFailures > 0 && now < nextLiveAttemptAt;
    if (inBackoff) return liveUsage;
    if (!force && liveUsage && now < nextLiveAttemptAt) return liveUsage;
    if (liveInFlight) return liveInFlight;

    liveInFlight = fetchLiveUsage({ now, timeoutMs: cfg.liveUsage?.timeoutMs ?? 6000 })
      .then((result) => {
        if (result.ok) {
          liveFailures = 0;
          nextLiveAttemptAt = now + minInterval;
          sampleCalibration(result, now);
        } else {
          liveFailures++;
          nextLiveAttemptAt = now + backoffMs(result, minInterval, maxBackoff);
        }
        liveUsage = { ...result, nextAttemptAt: nextLiveAttemptAt, failures: liveFailures };
        return liveUsage;
      })
      .catch((err) => {
        liveFailures++;
        nextLiveAttemptAt = now + backoffMs(null, minInterval, maxBackoff);
        liveUsage = {
          ok: false,
          reason: 'network',
          fetchedAt: now,
          message: err?.message,
          nextAttemptAt: nextLiveAttemptAt,
          failures: liveFailures,
        };
        return liveUsage;
      })
      .finally(() => {
        liveInFlight = null;
      });
    return liveInFlight;
  }

  /* --- Snapshot ---------------------------------------------------------- */

  function historyStats() {
    if (!historyEnabled) return { enabled: false };
    const recs = Object.values(archive.files);
    const days = new Set();
    let archivedOnly = 0;
    for (const r of recs) {
      for (const d of Object.keys(r.days ?? {})) days.add(d);
      if (!r.path) archivedOnly++;
    }
    let bytes = null;
    try {
      bytes = fs.statSync(archiveFile).size;
    } catch {
      /* noch nicht geschrieben */
    }
    return {
      enabled: true,
      file: archiveFile,
      note: archiveNote,
      files: recs.length,
      archivedOnly,
      days: days.size,
      firstDay: days.size ? [...days].sort()[0] : null,
      updatedAt: archive.updatedAt || null,
      bytes,
      merged: (histCfg.merge ?? []).length,
      mirrorTo: histCfg.mirrorTo ?? null,
    };
  }

  function snapshot(now = Date.now()) {
    const buckets = historyEnabled ? archiveBuckets(archive) : null;
    return buildSnapshot([...entries.values()], {
      config: cfg,
      pricing,
      now,
      liveUsage,
      buckets,
      calibration: calibration(),
      history: historyStats(),
      pricingMeta: {
        lastUpdated: table?.lastUpdated ?? null,
        source: table?.source ?? null,
        models: pricing.knownModels().length,
      },
      scan: {
        dirs: stats.dirs,
        files: stats.files,
        filesRead: stats.filesRead,
        filesSkipped: stats.filesSkipped,
        rawEntries: stats.rawEntries,
        uniqueRequests: entries.size,
        duplicatesSkipped: stats.duplicatesSkipped,
        archiveDuplicates: stats.archiveDuplicates,
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
    calibration,
    historyStats,
    archiveFile,
    /** Archiv sofort schreiben (Programmende, Tests). */
    flush(now = Date.now()) {
      return maybeSave(now, { force: true });
    },
    get archive() {
      return archive;
    },
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
