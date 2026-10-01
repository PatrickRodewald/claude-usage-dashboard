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

import {
  discoverDataDirs,
  listTranscripts,
  readIncremental,
  mergeDuplicate,
  READER_REV,
} from './parser.js';
import { createPricing, weightedTokens, newTotals, addTokens } from './pricing.js';
import { buildSnapshot } from './aggregate.js';
import { fetchLiveUsage, HOUR_MS } from './liveUsage.js';
import { createActivityTracker, DEFAULT_RECENT_MS, contextWindow } from './activity.js';
import { buildTimeline, metaReader } from './replay.js';
import { dayKey, startOfDay, zonedToUtc } from './tz.js';
import {
  loadArchive,
  saveArchive,
  emptyArchive,
  newRecord,
  applyEntries,
  applyDelta,
  addAnchor,
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
/** Zeitraum fuer den Output-Durchsatz einer Figur (Tipptempo im Buero). */
const RATE_WINDOW_MS = 120_000;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadConfig(file = path.join(rootDir, 'config.json')) {
  return readJson(file);
}

export function loadPricingTable(file = path.join(rootDir, 'pricing.json')) {
  return readJson(file);
}

/**
 * @param fetchUsage Abrufer fuer die echte Auslastung. Nur zum Einschleusen in
 *                   Tests gedacht - im Betrieb immer der echte Aufruf.
 * @param isAlive    Prozesspruefung fuer die Live-Ansicht, ebenfalls nur fuer
 *                   Tests (dort gibt es die Prozesse der Testdaten nicht).
 */
export function createStore({
  config,
  pricingTable,
  historyFile,
  fetchUsage = fetchLiveUsage,
  isAlive,
} = {}) {
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
  /** Bereits verarbeitete Limit-Treffer (Fenster), siehe recordLimitHit. */
  const seenLimitHits = new Set();

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
    // Doppelte Zeilen, die einen hoeheren Stand nachgereicht haben (Subagents).
    lateUsage: 0,
    limitHits: 0,
    // Ergebnis der einmaligen Neuberechnung nach geaenderter Zaehlung.
    recalibrated: null,
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

  /**
   * Was gerade arbeitet. Die Konfigurationsordner sind die Eltern der
   * Transkript-Verzeichnisse (~/.claude/projects -> ~/.claude).
   */
  const activityEnabled = cfg.activity?.enabled !== false;
  const activity = activityEnabled
    ? createActivityTracker({
        configDirs: () => dataDirs().map((d) => path.dirname(d)),
        recentMs: cfg.activity?.recentMs ?? DEFAULT_RECENT_MS,
        isAlive,
      })
    : null;

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
      seenLimitHits.clear();
      stats.rawEntries = 0;
      stats.duplicatesSkipped = 0;
      stats.lateUsage = 0;
      stats.limitHits = 0;
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
    // Hat sich die Auswertung seit dem Entstehen des Archivs geaendert, sind
    // dessen Summen fuer noch vorhandene Dateien veraltet. Dann wird einmal
    // alles neu gelesen - bereits geloeschte Transkripte lassen sich nicht
    // mehr korrigieren und behalten ihre Zahlen.
    const rereadAll = historyEnabled && (archive.readerRev ?? 1) < READER_REV;

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
        !rereadAll &&
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
    const limitEvents = [];
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
      // Schluessel, die in DIESEM Durchgang neu sind: ihre Werte gehen erst
      // nach der Schleife ins Archiv, ein Nachtrag darf sie also nicht noch
      // einmal gesondert verbuchen.
      const pending = new Set();
      for (const entry of result.entries) {
        stats.rawEntries++;
        const prev = entries.get(entry.key);
        if (prev) {
          // Erwarteter Normalfall: Claude Code schreibt eine Zeile pro
          // Content-Block. Meist mit identischem usage-Objekt - in
          // Subagent-Transkripten aber mit wachsendem Output, die letzte Zeile
          // traegt den endgueltigen Stand.
          stats.duplicatesSkipped++;
          const delta = mergeDuplicate(prev, entry);
          if (delta) {
            stats.lateUsage++;
            if (rec && !pending.has(entry.key)) applyDelta(rec, prev, delta, { timeZone: tz });
          }
          continue;
        }
        if (historyEnabled && foreignHashes.has(keyHash(entry.key))) {
          // Steht bereits in einer archivierten, hier nicht gelesenen Datei.
          stats.archiveDuplicates++;
          continue;
        }
        entries.set(entry.key, entry);
        accepted.push(entry);
        pending.add(entry.key);
      }
      limitEvents.push(...(result.events ?? []));

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
      if (rereadAll) {
        stats.recalibrated = recalibrate();
        archive.readerRev = READER_REV;
        archiveDirty = true;
      }
    }

    // Erst nach dem Einlesen ALLER Dateien: das Fenster eines Limit-Treffers
    // kann Requests aus mehreren Transkripten umfassen.
    for (const ev of limitEvents) recordLimitHit(ev);

    // Die Live-Ansicht darf das Einlesen nie zu Fall bringen - sie liest
    // undokumentierte Dateien, die sich jederzeit aendern koennen.
    if (activity) {
      try {
        await activity.refresh(now);
        stats.activityError = null;
      } catch (err) {
        stats.activityError = err?.message ?? String(err);
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
  function calibrating() {
    return historyEnabled && cfg.calibration?.enabled !== false;
  }

  /**
   * Lokal gezaehlter Verbrauch in [start, end) als Messwert-Rumpf.
   * null, wenn nichts da ist oder ein Modell keinen Preis hat - ein Punkt mit
   * unvollstaendigen Kosten wuerde den Kostenvergleich verzerren.
   */
  function windowMeasure(start, end) {
    const tokens = newTotals();
    let cost = 0;
    let count = 0;
    for (const e of entries.values()) {
      if (e.ts < start || e.ts >= end) continue;
      addTokens(tokens, e);
      const r = pricing.costFor(e, e.model, { speed: e.speed, timestampMs: e.ts });
      if (!r.known) return null;
      cost += r.cost;
      count++;
    }
    if (count === 0) return null;
    return { w: Math.round(weightedTokens(tokens, weights)), c: Number(cost.toFixed(4)), n: count };
  }

  /**
   * Claude-Code-Anteil an der Wochenauslastung, sofern Anthropic ihn fuer
   * GENAU dieses Fenster gemeldet hat. Ein Anteil aus einer anderen Woche
   * sagt ueber diese nichts.
   */
  function claudeCodeShare(live, weekEnd) {
    const b = live?.breakdown;
    if (!b || !Number.isFinite(b.claudeCodeShare)) return null;
    const winEnd = live.week?.end;
    if (!Number.isFinite(winEnd) || Math.abs(winEnd - weekEnd) > 60_000) return null;
    return Number(b.claudeCodeShare.toFixed(4));
  }

  function sampleCalibration(result, now) {
    if (!calibrating() || !result?.ok) return;
    const minPercent = cfg.calibration?.minPercent ?? 3;
    const maxSamples = cfg.calibration?.maxSamples ?? 500;
    const minGapMs = cfg.calibration?.sampleIntervalMs ?? 300_000;

    for (const kind of ['fiveHour', 'week']) {
      const win = result[kind];
      if (!win || !Number.isFinite(win.percent) || win.percent < minPercent) continue;
      const m = windowMeasure(win.start, win.end);
      if (!m) continue;
      const sample = { t: now, e: win.end, p: win.percent, ...m };
      // Die Aufteilung nach Bereich meldet Anthropic nur fuer die Woche. Fuer
      // das 5h-Fenster liesse sich der Wochenanteil nicht sauber uebertragen -
      // dort koennte gerade nur Claude Code oder nur Cowork gelaufen sein.
      if (kind === 'week') {
        const cc = claudeCodeShare(result, win.end);
        if (cc != null) sample.cc = cc;
      }
      if (addSample(archive, kind, sample, { maxSamples, minGapMs })) archiveDirty = true;
    }
  }

  /**
   * Messpunkte neu berechnen, nachdem sich die Zaehlung geaendert hat.
   *
   * Ein Messpunkt stellt die echte Auslastung dem lokal gezaehlten Verbrauch
   * gegenueber. Zaehlt das Dashboard inzwischen mehr - etwa die Subagents, die
   * frueher gar nicht gelesen wurden -, sind alte Punkte zu niedrig und
   * ergaeben gemischt mit neuen ein falsches Limit. Neu berechnen laesst sich
   * jeder Punkt, dessen Fenster noch vollstaendig in vorhandenen Transkripten
   * liegt; gezaehlt wird wie damals bis zum Messzeitpunkt.
   *
   * Die uebrigen werden verworfen, auch wenn die Kalibrierung dadurch neu
   * anlaeuft. In echten Daten lagen die alten Punkte um den Faktor 2-2,5 unter
   * den neu gezaehlten; schon als Uebergang beigemischt, zeigten sie
   * 5h-Bloecke mit ueber 400 % an. Lieber weniger Punkte als verzerrte.
   */
  function recalibrate() {
    // Bis wann reichen bereits geloeschte Transkripte dieses Geraets? Danach
    // ist die Abdeckung lueckenlos. Archive anderer Geraete zaehlen nicht mit,
    // in die Messpunkte ist ihr Verbrauch nie eingeflossen.
    let gapUntil = -Infinity;
    for (const rec of Object.values(archive.files)) {
      if (!rec.path && !rec.foreign && Number.isFinite(rec.lastTs)) {
        gapUntil = Math.max(gapUntil, rec.lastTs);
      }
    }
    let kept = 0;
    let dropped = 0;
    for (const kind of ['fiveHour', 'week']) {
      const windowMs = kind === 'fiveHour' ? 5 * HOUR_MS : 7 * DAY_MS;
      const out = [];
      for (const s of archive.calibration[kind] ?? []) {
        const start = s.e - windowMs;
        const m = start > gapUntil ? windowMeasure(start, Math.min(s.e, s.t + 1)) : null;
        if (m) {
          out.push({ ...s, ...m });
          kept++;
        } else {
          dropped++;
        }
      }
      archive.calibration[kind] = out;
    }
    return { kept, dropped };
  }

  /**
   * Limit-Treffer aus den Transkripten als exakten Messpunkt aufnehmen:
   * Auslastung 100 %, lokaler Verbrauch vom Fensterstart bis zur Ablehnung.
   */
  function recordLimitHit(ev) {
    if (!calibrating() || seenLimitHits.has(ev.key)) return;
    seenLimitHits.add(ev.key);
    const windowMs = ev.kind === 'fiveHour' ? 5 * HOUR_MS : 7 * DAY_MS;
    const m = windowMeasure(ev.end - windowMs, ev.ts + 1);
    if (!m) return;
    const sample = { t: ev.ts, e: ev.end, p: 100, ...m };
    if (ev.kind === 'week') {
      const cc = claudeCodeShare(lastGoodLive, ev.end);
      if (cc != null) sample.cc = cc;
    }
    const maxSamples = cfg.calibration?.maxSamples ?? 500;
    if (addAnchor(archive, ev.kind, sample, { maxSamples })) {
      stats.limitHits++;
      archiveDirty = true;
    }
  }

  function calibration() {
    if (!calibrating()) return null;
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
  /**
   * Letzter ERFOLGREICHER Abruf. Ueberlebt Fehlversuche bewusst: der Endpunkt
   * drosselt regelmaessig (429), und ohne diesen Puffer wuerde jede einzelne
   * Drosselung das gesamte Dashboard fuer die Dauer der Wartezeit auf die
   * lokale Schaetzung zurueckwerfen - sichtbar als Springen zwischen "live"
   * und "Schaetzung". Wie lange der Wert weiterverwendet wird, entscheidet
   * aggregate.js (liveUsage.staleAfterMs, und nie ueber einen Fensterreset
   * hinaus).
   */
  let lastGoodLive = null;
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
      // Ausdruecklich abgeschaltet: dann auch keinen alten Wert nachreichen.
      lastGoodLive = null;
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

    // Ueber then() gestartet, damit auch ein synchron werfender Abrufer im
    // catch() unten landet und nicht am Aufrufer vorbeifliegt.
    liveInFlight = Promise.resolve()
      .then(() => fetchUsage({ now, timeoutMs: cfg.liveUsage?.timeoutMs ?? 6000 }))
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
        if (result.ok) lastGoodLive = liveUsage;
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

  /**
   * Verbrauch der gerade laufenden Sitzungen und ihrer Subagents, aus den
   * Einzeleintraegen. Subagent-Zeilen tragen die Sitzungs-Id des Auftraggebers
   * und zusaetzlich ihre eigene agentId.
   */
  function activityUsage(now = Date.now()) {
    const ids = activity.sessionIds();
    const sums = new Map();
    if (ids.size) {
      const slot = (key) => {
        let u = sums.get(key);
        if (!u) {
          sums.set(key, (u = { cost: 0, costKnown: true, requests: 0, lastTs: -1, context: null, model: null, maxContext: 0, recentOutput: 0 }));
        }
        return u;
      };
      const addCost = (u, e) => {
        const r = pricing.costFor(e, e.model, { speed: e.speed, timestampMs: e.ts });
        u.cost += r.cost;
        if (!r.known) u.costKnown = false;
        u.requests++;
      };
      // Eigener Strang: Kontext der juengsten Anfrage und Output der letzten
      // zwei Minuten - fuer die Sitzung nur der Hauptstrang, nicht ihre Agents.
      // Der groesste Kontext verraet ein 1M-Fenster (contextWindow).
      const addOwn = (u, e) => {
        const context = (e.input || 0) + (e.cacheRead || 0) + (e.cacheWrite5m || 0) + (e.cacheWrite1h || 0);
        if (context > u.maxContext) u.maxContext = context;
        if (e.ts > u.lastTs) {
          u.lastTs = e.ts;
          u.context = context;
          u.model = e.model;
        }
        if (now - e.ts <= RATE_WINDOW_MS && e.ts <= now) u.recentOutput += e.output || 0;
      };
      for (const e of entries.values()) {
        if (!ids.has(e.sessionId)) continue;
        // Kosten der Sitzung schliessen ihre Subagents ein.
        const s = slot(e.sessionId);
        addCost(s, e);
        if (e.agentId) {
          const a = slot(`${e.sessionId}:${e.agentId}`);
          addCost(a, e);
          addOwn(a, e);
        } else {
          addOwn(s, e);
        }
      }
    }
    return (sessionId, agentId) => {
      const u = sums.get(agentId ? `${sessionId}:${agentId}` : sessionId);
      if (!u) return null;
      return {
        cost: u.cost,
        costKnown: u.costKnown,
        requests: u.requests,
        context: u.context,
        contextLimit: u.context == null ? null : contextWindow(u.model, u.maxContext),
        outputPerMin: Math.round(u.recentOutput / (RATE_WINDOW_MS / 60_000)),
      };
    };
  }

  /**
   * Beginn des fruehesten Tages, dessen Einzeleintraege vollstaendig im
   * Speicher liegen. Ein Transkript, das dieser Prozess nicht gelesen hat -
   * vom Archiv uebersprungen (history.detailDays) oder von Claude Code
   * aufgeraeumt -, fehlt allen Tagen bis zu seinem letzten Eintrag. Im
   * Rueckblick saehen die aus, als haette kaum jemand gearbeitet.
   */
  function firstCompleteDay(now) {
    const nextDay = (ms) => startOfDay(startOfDay(ms, tz) + 30 * 3_600_000, tz);
    let first = Infinity;
    for (const e of entries.values()) if (e.ts < first) first = e.ts;
    let from = Number.isFinite(first) ? startOfDay(first, tz) : startOfDay(now, tz);
    if (historyEnabled) {
      // Archive anderer Geraete zaehlen nicht: deren Transkripte gab es hier nie.
      for (const [id, rec] of Object.entries(archive.files)) {
        if (!readIds.has(id) && !rec.foreign && Number.isFinite(rec.lastTs)) from = Math.max(from, nextDay(rec.lastTs));
      }
    }
    return Math.min(from, startOfDay(now, tz));
  }

  /**
   * Zeitleiste eines Tages fuer den Rueckblick im Buero.
   * @param day "YYYY-MM-DD" in der Anzeigezone; ohne (oder ungueltig): heute.
   *            Vor dem ersten vollstaendigen Tag: dieser.
   */
  function replay({ day, now = Date.now() } = {}) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? '');
    let from = m ? zonedToUtc({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }, tz) : startOfDay(now, tz);
    if (!Number.isFinite(from) || from > now) from = startOfDay(now, tz);
    const firstDay = firstCompleteDay(now);
    if (from < firstDay) from = firstDay;
    // Ein Tag hat 23 bis 25 Stunden: 30 Stunden spaeter liegt sicher im naechsten.
    const to = startOfDay(from + 30 * 3_600_000, tz);
    return {
      day: dayKey(from, tz),
      firstDay: dayKey(firstDay, tz),
      today: dayKey(now, tz),
      timezone: tz,
      now,
      ...buildTimeline(entries.values(), {
        from,
        to,
        costOf: (e) => pricing.costFor(e, e.model, { speed: e.speed, timestampMs: e.ts }),
        readMeta: metaReader(dataDirs()),
      }),
    };
  }

  function snapshot(now = Date.now()) {
    const buckets = historyEnabled ? archiveBuckets(archive) : null;
    return buildSnapshot([...entries.values()], {
      activity: activity
        ? { ...activity.snapshot({ usage: activityUsage(now) }), error: stats.activityError ?? null }
        : null,
      config: cfg,
      pricing,
      now,
      liveUsage,
      lastLiveUsage: lastGoodLive,
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
        lateUsage: stats.lateUsage,
        limitHits: stats.limitHits,
        recalibrated: stats.recalibrated,
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
    replay,
    dataDirs,
    /** Ordner, deren Aenderung einen Statuswechsel bedeuten kann (Live-Ansicht). */
    activityDirs: () => (activity ? activity.watchDirs() : []),
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
    /** Letzter erfolgreicher Abruf - null, solange noch keiner geklappt hat. */
    get lastGoodLiveUsage() {
      return lastGoodLive;
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
export function createWatcher(
  dirs,
  onChange,
  { debounceMs = 400, maxWaitMs = 2000, match = (filename) => filename.endsWith('.jsonl') } = {},
) {
  const watchers = [];
  let timer = null;
  let firstAt = 0;
  let watching = false;

  // Entprellt, aber mit Obergrenze: schreiben mehrere Agents ununterbrochen,
  // wuerde ein reines Entprellen den Timer endlos verschieben.
  const trigger = () => {
    const now = Date.now();
    if (timer) clearTimeout(timer);
    else firstAt = now;
    timer = setTimeout(
      () => {
        timer = null;
        onChange();
      },
      Math.max(0, Math.min(debounceMs, firstAt + maxWaitMs - now)),
    );
  };

  for (const dir of dirs) {
    try {
      // Unter Windows den echten, langen Pfad beobachten: bei einem 8.3-
      // Kurznamen ("C:\Users\PATRIC~1\...") meldet das System Aenderungen mit
      // dem langen Namen, und libuv bricht den GANZEN Prozess mit einer
      // Assertion ab (fs-event.c), statt einen Fehler zu liefern.
      const real = fs.realpathSync.native(dir);
      const w = fs.watch(real, { recursive: true }, (_event, filename) => {
        if (!filename || match(String(filename))) trigger();
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
