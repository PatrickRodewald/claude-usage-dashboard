/**
 * Tagesrueckblick: aus der Zeitleiste des Servers (/api/replay) fuer jeden
 * Zeitpunkt denselben Zustand berechnen, den das Buero live bekommt.
 *
 * Reine Funktionen ohne DOM - laesst sich direkt in Node testen.
 *
 * Die Transkripte sagen nicht, wann eine Sitzung offen war, nur wann sie
 * gearbeitet hat. Deshalb Faustregeln:
 * - Folgt der naechste Request binnen BUSY_GAP_MS, wurde durchgearbeitet
 *   (Werkzeug lief, Modell dachte nach). Nach dem letzten Request eines
 *   solchen Laufs arbeitet die Figur noch AFTER_STEP_MS, dann wartet sie.
 * - Liegen mehr als SPAN_GAP_MS zwischen zwei Requests, geht die Figur und
 *   kommt spaeter wieder; nach dem letzten bleibt sie noch LINGER_MS sitzen.
 * - Ein Subagent kommt mit seinem ersten Request und ist mit dem letzten
 *   fertig; danach bleibt er noch AGENT_LINGER_MS mit Haken sitzen.
 */

export const BUSY_GAP_MS = 5 * 60_000;
export const AFTER_STEP_MS = 60_000;
export const SPAN_GAP_MS = 20 * 60_000;
export const LINGER_MS = 5 * 60_000;
export const AGENT_LINGER_MS = 3 * 60_000;
const RATE_WINDOW_MS = 120_000;
const DELEGATE_TOOLS = new Set(['Agent', 'Task']);

/** Strang (Sitzung oder Subagent) fuer schnelle Abfragen aufbereiten. */
function prepStrand(raw, from) {
  const steps = raw.steps ?? [];
  const t = steps.map((s) => from + s[0]);
  const tool = steps.map((s) => s[1] ?? null);
  const ctx = steps.map((s) => s[3] ?? null);
  const out = steps.map((s) => s[4] ?? 0);
  // Kosten bis einschliesslich Schritt i; Beginn des Arbeitslaufs je Schritt.
  const cum = [];
  const runStart = [];
  let sum = 0;
  steps.forEach((s, i) => {
    sum += s[2] ?? 0;
    cum.push(sum);
    runStart.push(i > 0 && t[i] - t[i - 1] <= BUSY_GAP_MS ? runStart[i - 1] : t[i]);
  });
  return { t, tool, ctx, out, cum, runStart, costKnown: raw.costKnown !== false, contextLimit: raw.contextLimit ?? null };
}

/** Index des letzten Schritts bis einschliesslich ms, sonst -1. */
function indexAt(strand, ms) {
  let lo = 0;
  let hi = strand.t.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (strand.t[mid] <= ms) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Output-Tokens pro Minute in den letzten zwei Minuten vor ms. */
function rateAt(strand, i, ms) {
  let sum = 0;
  for (let j = i; j >= 0 && ms - strand.t[j] < RATE_WINDOW_MS; j--) sum += strand.out[j];
  return Math.round(sum / (RATE_WINDOW_MS / 60_000));
}

/** Zeitpunkte in Abschnitte teilen: eine Luecke ueber gap beginnt einen neuen. */
export function spansOf(times, gap = SPAN_GAP_MS) {
  const spans = [];
  for (const t of times) {
    const last = spans[spans.length - 1];
    if (last && t - last[1] <= gap) last[1] = t;
    else spans.push([t, t]);
  }
  return spans;
}

/**
 * Sitzungen nach ihrem ersten Auftritt ordnen und je Projekt durchnumerieren.
 * Die Namen laufender Sitzungen stehen nur in deren Statusdatei - im
 * Rueckblick heisst es deshalb "Sitzung 1", "Sitzung 2" ...
 */
function numberSessions(label, sessions) {
  const slug = String(label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  return sessions
    .filter((s) => s.spans.length)
    .sort((a, b) => a.spans[0][0] - b.spans[0][0] || a.sessionId.localeCompare(b.sessionId))
    .map((s, i) => ({ ...s, name: `${slug || 'sitzung'}-${i + 1}` }));
}

/** Zeitleiste vom Server einmal aufbereiten (Sortierung, Summen, Abschnitte). */
export function prepareTimeline(raw) {
  const from = raw?.from ?? 0;
  const projects = (raw?.projects ?? []).map((p) => ({
    key: p.key,
    label: p.label,
    sessions: numberSessions(p.label, p.sessions.map((s) => {
      const main = prepStrand(s, from);
      const agents = s.agents
        .filter((a) => a.steps?.length)
        .map((a) => ({
          id: a.id,
          type: a.type,
          description: a.description ?? null,
          parentId: a.parentId ?? null,
          background: Boolean(a.background),
          ...prepStrand(a, from),
        }));
      const times = [...main.t, ...agents.flatMap((a) => a.t)].sort((x, y) => x - y);
      return { sessionId: s.sessionId, main, agents, spans: spansOf(times) };
    })),
  }));
  let start = Infinity;
  let end = -Infinity;
  for (const p of projects) {
    for (const s of p.sessions) {
      for (const [a, b] of s.spans) {
        start = Math.min(start, a);
        end = Math.max(end, b);
      }
    }
  }
  return {
    from,
    to: raw?.to ?? from,
    projects,
    start: Number.isFinite(start) ? start : null,
    end: Number.isFinite(end) ? end : null,
  };
}

/** Zustand eines Subagents zum Zeitpunkt ms - oder null, wenn er nicht im Raum ist. */
function agentAt(a, ms) {
  const start = a.t[0];
  const end = a.t[a.t.length - 1];
  if (ms < start || ms > end + AGENT_LINGER_MS) return null;
  const i = indexAt(a, ms);
  const running = ms < end;
  return {
    id: a.id,
    type: a.type,
    description: a.description,
    background: a.background,
    depth: a.parentId ? 2 : 1,
    parentId: a.parentId,
    state: running ? 'running' : 'completed',
    startedAt: start,
    lastActivity: a.t[i],
    finishedAt: running ? null : end,
    tool: running ? a.tool[i] : null,
    toolDetail: null,
    celebration: null,
    error: null,
    cost: a.cum[i],
    costKnown: a.costKnown,
    requests: i + 1,
    context: a.ctx[i],
    contextLimit: a.contextLimit,
    outputPerMin: running ? rateAt(a, i, ms) : 0,
  };
}

/**
 * Was zum Zeitpunkt ms im Buero los war - in der Form des Live-Snapshots
 * (activity.projects), damit das Buero ihn unveraendert zeichnen kann.
 */
export function snapshotAt(prep, ms) {
  const projects = [];
  let busyCount = 0;
  let agentsRunning = 0;
  let sessionCount = 0;
  for (const p of prep.projects) {
    const sessions = [];
    for (const s of p.sessions) {
      const span = s.spans.find(([a, b]) => ms >= a && ms <= b + LINGER_MS);
      if (!span) continue;
      const agents = s.agents.map((a) => agentAt(a, ms)).filter(Boolean);
      const running = agents.filter((a) => a.state === 'running');

      const m = s.main;
      const i = indexAt(m, ms);
      let busy = false;
      let doing = null;
      let statusSince = span[0];
      if (i >= 0 && m.t[i] >= span[0]) {
        const ti = m.t[i];
        const next = m.t[i + 1];
        busy = (next !== undefined && next - ti <= BUSY_GAP_MS) || ms - ti <= AFTER_STEP_MS;
        if (busy) {
          const tool = m.tool[i];
          doing = !tool
            ? { kind: 'thinking', since: ti }
            : DELEGATE_TOOLS.has(tool)
              ? { kind: 'delegating', since: ti }
              : { kind: 'tool', tool, since: ti };
          statusSince = m.runStart[i];
        } else {
          statusSince = ti + AFTER_STEP_MS;
        }
      }
      // Wartet die Sitzung, waehrend ihre Subagents arbeiten: delegiert.
      if (!busy && running.length) {
        busy = true;
        doing = { kind: 'delegating', since: Math.min(...running.map((a) => a.startedAt)) };
        statusSince = doing.since;
      }

      // Kosten der Sitzung schliessen alle ihre Subagents ein, auch gegangene.
      let cost = i >= 0 ? m.cum[i] : 0;
      let requests = i + 1;
      let costKnown = m.costKnown;
      for (const a of s.agents) {
        const j = indexAt(a, ms);
        if (j < 0) continue;
        cost += a.cum[j];
        requests += j + 1;
        if (!a.costKnown) costKnown = false;
      }

      if (busy) busyCount++;
      agentsRunning += running.length;
      sessionCount++;
      sessions.push({
        sessionId: s.sessionId,
        name: s.name,
        status: busy ? 'busy' : 'idle',
        statusSince,
        startedAt: span[0],
        entrypoint: null,
        doing,
        celebration: null,
        prompt: null,
        error: null,
        cost,
        costKnown,
        requests,
        context: i >= 0 ? m.ctx[i] : null,
        contextLimit: m.contextLimit,
        outputPerMin: i >= 0 && busy ? rateAt(m, i, ms) : 0,
        agents,
      });
    }
    if (sessions.length) projects.push({ key: p.key, label: p.label, sessions });
  }
  // Wie live: arbeitende Projekte zuerst, dann alphabetisch.
  projects.sort((a, b) => {
    const ab = a.sessions.some((s) => s.status === 'busy') ? 0 : 1;
    const bb = b.sessions.some((s) => s.status === 'busy') ? 0 : 1;
    return ab - bb || a.label.localeCompare(b.label, 'de');
  });
  return { projects, counts: { sessions: sessionCount, busy: busyCount, agentsRunning } };
}

/** Beginn der naechsten Anwesenheit nach ms - zum Ueberspringen leerer Stunden. */
export function nextActivity(prep, ms) {
  let best = null;
  for (const p of prep.projects) {
    for (const s of p.sessions) {
      for (const [a] of s.spans) if (a > ms && (best === null || a < best)) best = a;
    }
  }
  return best;
}

/** Requests je Zeitabschnitt ueber den ganzen Tag - fuer die Leiste ueber dem Regler. */
export function activityHistogram(prep, buckets = 96) {
  const counts = new Array(buckets).fill(0);
  const span = prep.to - prep.from;
  if (!(span > 0)) return counts;
  const add = (t) => {
    const k = Math.floor(((t - prep.from) / span) * buckets);
    if (k >= 0 && k < buckets) counts[k]++;
  };
  for (const p of prep.projects) {
    for (const s of p.sessions) {
      s.main.t.forEach(add);
      for (const a of s.agents) a.t.forEach(add);
    }
  }
  return counts;
}
