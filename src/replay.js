/**
 * Tagesrueckblick: kompakte Zeitleiste eines Zeitraums aus den Einzeleintraegen.
 *
 * Je Sitzung und Subagent ein Strang mit einem Schritt pro Request:
 * [Versatz ab from in ms, Werkzeug|null, Kosten-Aequivalent, Kontext, Output].
 * Das Buero im Browser rechnet daraus fuer jeden Zeitpunkt denselben Zustand,
 * den es live zeigt (public/replay.js) - Kommen und Gehen, Aktenstapel,
 * Sparschwein und Uhr laufen dann von selbst mit.
 */

import fs from 'node:fs';
import path from 'node:path';
import { projectNameFrom } from './parser.js';
import { contextWindow } from './activity.js';

/** Ids aus Transkripten landen in Dateipfaden - nur harmlose Zeichen zulassen. */
const SAFE_ID = /^[\w-]{1,128}$/;

/**
 * @param entries  iterierbare Eintraege (wie im Store)
 * @param opts.from, opts.to  Zeitraum [from, to) in UTC-ms
 * @param opts.costOf  (entry) -> { cost, known }
 * @param opts.readMeta  (projectDir, sessionId, agentId) -> meta.json-Inhalt | null
 */
export function buildTimeline(entries, { from, to, costOf, readMeta = () => null }) {
  const projects = new Map();
  for (const e of entries) {
    if (!(e.ts >= from && e.ts < to) || !e.sessionId) continue;
    const key = e.projectDir ?? e.project ?? 'unbekannt';
    let p = projects.get(key);
    if (!p) projects.set(key, (p = { key, cwd: null, cwdTs: -Infinity, sessions: new Map() }));
    if (e.cwd && e.ts > p.cwdTs) {
      p.cwd = e.cwd;
      p.cwdTs = e.ts;
    }
    let s = p.sessions.get(e.sessionId);
    if (!s) p.sessions.set(e.sessionId, (s = { sessionId: e.sessionId, raw: [], agents: new Map() }));
    if (e.agentId) {
      let a = s.agents.get(e.agentId);
      if (!a) s.agents.set(e.agentId, (a = { id: e.agentId, type: null, raw: [] }));
      a.type ??= e.agent ?? null;
      a.raw.push(e);
    } else {
      s.raw.push(e);
    }
  }

  const strand = (raw) => {
    raw.sort((a, b) => a.ts - b.ts);
    let costKnown = true;
    const steps = raw.map((e) => {
      const c = costOf(e);
      if (!c.known) costKnown = false;
      const context = (e.input || 0) + (e.cacheRead || 0) + (e.cacheWrite5m || 0) + (e.cacheWrite1h || 0);
      return [e.ts - from, e.tool ?? null, Math.round(c.cost * 1e5) / 1e5, context, e.output || 0];
    });
    const last = raw[raw.length - 1];
    return { steps, costKnown, contextLimit: last ? contextWindow(last.model) : null };
  };

  const out = [];
  for (const p of projects.values()) {
    const sessions = [];
    for (const s of p.sessions.values()) {
      const agents = [];
      for (const a of s.agents.values()) {
        const meta = readMeta(p.key, s.sessionId, a.id) ?? {};
        agents.push({
          id: a.id,
          type: str(meta.agentType) ?? a.type ?? 'Subagent',
          description: str(meta.description),
          parentId: str(meta.parentAgentId),
          background: meta.requestShape === 'background',
          ...strand(a.raw),
        });
      }
      agents.sort((a, b) => a.steps[0][0] - b.steps[0][0]);
      sessions.push({ sessionId: s.sessionId, ...strand(s.raw), agents });
    }
    out.push({ key: p.key, label: projectNameFrom(p.cwd, p.key), sessions });
  }
  out.sort((a, b) => a.label.localeCompare(b.label, 'de'));
  return { from, to, projects: out };
}

function str(v) {
  return typeof v === 'string' && v.trim() ? v : null;
}

/**
 * Liest agent-<id>.meta.json eines Subagents (Typ, Auftrag, Auftraggeber) aus
 * dem ersten Datenordner, der sie hat. Fehlt sie, bleibt es beim Typ aus den
 * Eintraegen.
 */
export function metaReader(dataDirs) {
  return (projectDir, sessionId, agentId) => {
    if (![projectDir, sessionId, agentId].every((v) => typeof v === 'string' && SAFE_ID.test(v))) return null;
    for (const dir of dataDirs) {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, projectDir, sessionId, 'subagents', `agent-${agentId}.meta.json`), 'utf8'));
      } catch {
        /* naechster Ordner */
      }
    }
    return null;
  };
}
