/**
 * "Werkstatt": was gerade arbeitet, als kleine Figuren.
 *
 * Je Projekt eine Station. Jede laufende Claude-Code-Sitzung sitzt als Figur
 * am Laptop, ihre Subagents stehen darunter und haengen an einer Leitung, in
 * der Arbeit fliesst, solange sie laufen. Sprechblasen zeigen das gerade
 * benutzte Werkzeug.
 *
 * Die Figuren werden nur neu aufgebaut, wenn sich die Besetzung aendert (neue
 * Sitzung, neuer Agent). Ein Status- oder Werkzeugwechsel setzt lediglich
 * Attribute - sonst wuerden die Animationen bei jeder Aktualisierung neu
 * beginnen und die Szene ruckeln.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null) node.setAttribute(k, String(v));
  }
  if (parent) parent.append(node);
  return node;
}

/* --- Masse ----------------------------------------------------------------- */

const PAD = 12;
const MAIN_SLOT = 128; // Breite je Sitzung am Tisch
const AGENT_SLOT = 78; // Breite je Subagent
const AGENTS_PER_ROW = 4;
const MAIN_H = 162; // Hoehe des Tischbereichs inkl. Platz fuer die Leitung nach unten
const ROW_H = 104; // Hoehe je Subagent-Reihe

/** Farbe je Agent-Typ. Unbekannte Typen bekommen stabil eine der uebrigen Farben. */
const TYPE_COLOR = {
  'general-purpose': 'var(--series-4)',
  Explore: 'var(--series-3)',
  Plan: 'var(--series-7)',
  'claude-code-guide': 'var(--series-2)',
};
const SPARE_COLORS = ['var(--series-5)', 'var(--series-8)', 'var(--series-6)', 'var(--series-2)'];

function typeColor(type) {
  if (TYPE_COLOR[type]) return TYPE_COLOR[type];
  let h = 0;
  for (const c of String(type)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SPARE_COLORS[h % SPARE_COLORS.length];
}

function clip(text, max) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Beschriftung einer Sitzung. Claude Code leitet den Namen aus dem Ordner ab
 * ("antropicusagedashboard-d3") - der Projektteil steht schon ueber der
 * Station, unterscheidend ist nur das Kuerzel dahinter. Selbst vergebene
 * Namen bleiben, wie sie sind.
 */
function sessionLabel(s, projectLabel) {
  const name = s.name ?? s.sessionId.slice(0, 8);
  const slug = String(projectLabel ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  if (slug && name.toLowerCase().startsWith(`${slug}-`)) return `Sitzung ${name.slice(slug.length + 1)}`;
  return name;
}

/** Woher eine Sitzung kommt, lesbar. Unbekanntes bleibt beim Rohwert. */
const ENTRYPOINT = {
  cli: 'Terminal',
  'claude-vscode': 'VS Code',
  'claude-desktop': 'Desktop',
  'claude-jetbrains': 'JetBrains',
};
export function entrypointLabel(e) {
  return ENTRYPOINT[e] ?? (e ? String(e) : 'unbekannt');
}

/* --- Zustand je Figur -------------------------------------------------------- */

/** Zustand der Hauptfigur einer Sitzung. */
function sessionState(s) {
  if (s.status === 'idle') return 'idle';
  if (s.status === 'stale') return 'stale';
  if (s.status !== 'busy') return 'other';
  return s.doing?.kind === 'tool' || s.doing?.kind === 'delegating' ? s.doing.kind : 'thinking';
}

function sessionBubble(s, state) {
  if (state === 'idle') return null; // schlaeft - die aufsteigenden z sagen genug
  if (state === 'stale') return '?';
  if (state === 'tool') return clip(s.doing.tool, 14);
  if (state === 'delegating') return 'delegiert';
  if (state === 'thinking') return '• • •';
  return clip(s.status, 12);
}

function agentState(a) {
  if (a.state !== 'running') return a.state; // completed | failed | stopped
  return a.tool ? 'tool' : 'thinking';
}

function agentBubble(a, state) {
  if (state === 'tool') return clip(a.tool, 12);
  if (state === 'thinking') return '• • •';
  return null; // Beendete tragen ein Abzeichen statt einer Blase.
}

/* --- Figuren ------------------------------------------------------------------ */

/** Sprechblase; Breite folgt dem Text (applyBubble). */
function bubble(parent, cx, y) {
  const g = el('g', { class: 'bubble' }, parent);
  el('rect', { x: cx - 20, y, width: 40, height: 17, rx: 8.5 }, g);
  el('path', { d: `M${cx - 4} ${y + 17}l4 5l4 -5z` }, g);
  const t = el('text', { x: cx, y: y + 12.5, 'text-anchor': 'middle' }, g);
  return { g, rect: g.firstChild, text: t, cx };
}

function applyBubble(b, text) {
  if (!text) {
    b.g.setAttribute('visibility', 'hidden');
    return;
  }
  b.g.removeAttribute('visibility');
  if (b.text.textContent !== text) {
    b.text.textContent = text;
    // Breite grob nach Zeichenzahl - genau genug fuer kurze Werkzeugnamen und
    // ohne Layout-Messung, die in einem versteckten Panel ohnehin 0 liefert.
    const w = Math.max(30, text.length * 6.4 + 14);
    b.rect.setAttribute('x', String(b.cx - w / 2));
    b.rect.setAttribute('width', String(w));
  }
}

/**
 * Hauptfigur am Tisch. Aufbau: aussen die Position (transform-Attribut),
 * innen die Animation (CSS) - beides auf demselben Element wuerde sich
 * gegenseitig ueberschreiben.
 */
function mainFigure(parent, cx) {
  const fig = el('g', { class: 'fig fig-main', style: '--fig: var(--series-1)' }, parent);
  const b = bubble(fig, cx, 2);

  const bodyG = el('g', { class: 'fig-body' }, fig);
  // Antenne mit Lampe: leuchtet, solange gearbeitet wird.
  el('line', { x1: cx, y1: 31, x2: cx, y2: 25, class: 'fig-line' }, bodyG);
  el('circle', { cx, cy: 24, r: 2.6, class: 'fig-lamp' }, bodyG);
  el('rect', { x: cx - 17, y: 58, width: 34, height: 32, rx: 9, class: 'fig-fill' }, bodyG);
  el('circle', { cx, cy: 44, r: 13, class: 'fig-fill' }, bodyG);
  // Augen offen bzw. geschlossen - welche sichtbar sind, steuert data-state.
  const open = el('g', { class: 'eyes-open' }, bodyG);
  el('circle', { cx: cx - 5, cy: 43, r: 2.2, class: 'fig-eye' }, open);
  el('circle', { cx: cx + 5, cy: 43, r: 2.2, class: 'fig-eye' }, open);
  const closed = el('g', { class: 'eyes-closed' }, bodyG);
  el('path', { d: `M${cx - 8} 44q3 2 6 0M${cx + 2} 44q3 2 6 0`, class: 'fig-eye-line' }, closed);
  // Arme zum Tisch; tippen, solange gearbeitet wird.
  el('rect', { x: cx - 23, y: 66, width: 7, height: 20, rx: 3.5, class: 'fig-fill arm arm-l' }, bodyG);
  el('rect', { x: cx + 16, y: 66, width: 7, height: 20, rx: 3.5, class: 'fig-fill arm arm-r' }, bodyG);

  // Laptop und Tischplatte vor der Figur.
  el('path', { d: `M${cx - 18} 88l4 -16h28l4 16z`, class: 'laptop' }, fig);
  el('rect', { x: cx - 11, y: 75, width: 22, height: 10, rx: 1.5, class: 'laptop-screen' }, fig);

  // Schlafende Figur: aufsteigende z.
  const zzz = el('g', { class: 'zzz' }, fig);
  for (const [dx, dy, s] of [
    [16, 26, 9],
    [22, 18, 11],
    [29, 9, 13],
  ]) {
    const t = el('text', { x: cx + dx, y: dy, 'font-size': s }, zzz);
    t.textContent = 'z';
  }
  return { fig, bubble: b };
}

/** Kleinere, stehende Figur fuer einen Subagent. */
function agentFigure(parent, cx, top, color) {
  const fig = el('g', { class: 'fig fig-agent', style: `--fig: ${color}` }, parent);
  const b = bubble(fig, cx, top);

  const bodyG = el('g', { class: 'fig-body' }, fig);
  el('circle', { cx, cy: top + 31, r: 9, class: 'fig-fill' }, bodyG);
  el('circle', { cx: cx - 3.4, cy: top + 30.5, r: 1.6, class: 'fig-eye' }, bodyG);
  el('circle', { cx: cx + 3.4, cy: top + 30.5, r: 1.6, class: 'fig-eye' }, bodyG);
  el('rect', { x: cx - 11, y: top + 42, width: 22, height: 20, rx: 6, class: 'fig-fill' }, bodyG);
  el('rect', { x: cx - 16, y: top + 45, width: 5, height: 13, rx: 2.5, class: 'fig-fill arm arm-l' }, bodyG);
  el('rect', { x: cx + 11, y: top + 45, width: 5, height: 13, rx: 2.5, class: 'fig-fill arm arm-r' }, bodyG);
  el('rect', { x: cx - 8, y: top + 61, width: 6, height: 9, rx: 2, class: 'fig-fill' }, bodyG);
  el('rect', { x: cx + 2, y: top + 61, width: 6, height: 9, rx: 2, class: 'fig-fill' }, bodyG);

  // Abzeichen fuer beendete Agents: Haken, Kreuz oder Strich.
  const badge = el('g', { class: 'badge' }, fig);
  el('circle', { cx: cx + 10, cy: top + 22, r: 7 }, badge);
  el('path', { class: 'badge-ok', d: `M${cx + 6.5} ${top + 22}l2.5 2.5l4.5 -5` }, badge);
  el('path', { class: 'badge-fail', d: `M${cx + 7} ${top + 19}l6 6m0 -6l-6 6` }, badge);
  el('path', { class: 'badge-stop', d: `M${cx + 6.5} ${top + 22}h7` }, badge);
  return { fig, bubble: b };
}

/* --- Layout ------------------------------------------------------------------- */

/**
 * Agents einer Sitzung in Anzeigereihenfolge: verschachtelte direkt hinter
 * ihrem Auftraggeber, damit ihre Leitung kurz bleibt.
 */
function orderAgents(agents) {
  const byParent = new Map();
  for (const a of agents) {
    const k = a.parentId ?? '';
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(a);
  }
  const out = [];
  const seen = new Set();
  const visit = (k) => {
    for (const a of byParent.get(k) ?? []) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push(a);
      visit(a.id);
    }
  };
  visit('');
  // Auftraggeber nicht (mehr) sichtbar: trotzdem zeigen.
  for (const a of agents) if (!seen.has(a.id)) out.push(a);
  return out;
}

function layoutSignature(project) {
  return JSON.stringify(
    project.sessions.map((s) => [s.sessionId, orderAgents(s.agents).map((a) => [a.id, a.parentId])]),
  );
}

/* --- Station ------------------------------------------------------------------ */

function buildStation(project, ctx) {
  const root = document.createElement('div');
  root.className = 'station';

  const head = document.createElement('div');
  head.className = 'station-head';
  const name = document.createElement('span');
  name.className = 'station-name';
  const meta = document.createElement('span');
  meta.className = 'station-meta';
  head.append(name, meta);
  root.append(head);

  // Bloecke je Sitzung: so breit wie die breiteste Agent-Reihe darunter.
  const blocks = project.sessions.map((s) => {
    const agents = orderAgents(s.agents);
    const cols = Math.min(AGENTS_PER_ROW, Math.max(1, agents.length));
    return { s, agents, width: Math.max(MAIN_SLOT, cols * AGENT_SLOT), rows: Math.ceil(agents.length / AGENTS_PER_ROW) };
  });
  const width = PAD * 2 + blocks.reduce((a, b) => a + b.width, 0);
  const rows = Math.max(0, ...blocks.map((b) => b.rows));
  // Ohne Subagents endet die Station unter der Beschriftung.
  const height = rows ? MAIN_H + rows * ROW_H + 4 : 136;

  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    class: 'workshop-svg',
    role: 'img',
  });
  svg.style.maxWidth = `${width}px`;
  const links = el('g', { class: 'links' }, svg);
  const figures = el('g', {}, svg);

  const figs = new Map();
  let x0 = PAD;
  for (const block of blocks) {
    const cx = x0 + block.width / 2;
    // Tischplatte je Sitzung.
    el('rect', { x: cx - 52, y: 88, width: 104, height: 7, rx: 3.5, class: 'desk' }, figures);
    const main = mainFigure(figures, cx);
    const label = el('text', { x: cx, y: 113, 'text-anchor': 'middle', class: 'fig-label' }, figures);
    const sub = el('text', { x: cx, y: 127, 'text-anchor': 'middle', class: 'fig-sublabel' }, figures);
    // Leitungen beginnen unter der Beschriftung, nicht mitten hindurch.
    figs.set(block.s.sessionId, { ...main, label, sub, kind: 'session', anchor: { x: cx, y: 133 } });
    ctx.hover(main.fig, block.s.sessionId);

    block.agents.forEach((a, i) => {
      const row = Math.floor(i / AGENTS_PER_ROW);
      const inRow = Math.min(AGENTS_PER_ROW, block.agents.length - row * AGENTS_PER_ROW);
      const rowWidth = inRow * AGENT_SLOT;
      const ax = cx - rowWidth / 2 + AGENT_SLOT / 2 + (i % AGENTS_PER_ROW) * AGENT_SLOT;
      const top = MAIN_H + row * ROW_H;
      const fig = agentFigure(figures, ax, top, typeColor(a.type));
      const label = el('text', { x: ax, y: top + 84, 'text-anchor': 'middle', class: 'fig-label' }, figures);
      const sub = el('text', { x: ax, y: top + 97, 'text-anchor': 'middle', class: 'fig-sublabel' }, figures);
      // Leitung endet ueber der Sprechblase, nicht hinter ihr.
      figs.set(a.id, { ...fig, label, sub, kind: 'agent', anchor: { x: ax, y: top + 101 }, head: { x: ax, y: top - 2 } });
      ctx.hover(fig.fig, a.id);
    });
    x0 += block.width;
  }

  // Leitungen erst, wenn alle Figuren stehen: ein Auftraggeber kann in der
  // Reihenfolge nach seinem Subagent kommen.
  for (const block of blocks) {
    for (const a of block.agents) {
      const from = figs.get(a.parentId ?? block.s.sessionId)?.anchor ?? figs.get(block.s.sessionId).anchor;
      const to = figs.get(a.id).head;
      const midY = (from.y + to.y) / 2;
      const path = el(
        'path',
        { d: `M${from.x} ${from.y}C${from.x} ${midY} ${to.x} ${midY} ${to.x} ${to.y}`, class: 'link' },
        links,
      );
      figs.get(a.id).link = path;
    }
  }

  root.append(svg);
  return { root, name, meta, svg, figs, sig: layoutSignature(project) };
}

/** Zustand auf eine bestehende Station uebertragen - ohne Neuaufbau. */
function applyStation(st, project, ctx) {
  st.name.textContent = project.label;
  st.name.title = project.cwd;
  const busy = project.sessions.filter((s) => s.status === 'busy').length;
  const running = project.sessions.reduce((n, s) => n + s.agents.filter((a) => a.state === 'running').length, 0);
  st.meta.textContent = [
    `${project.sessions.length} ${project.sessions.length === 1 ? 'Sitzung' : 'Sitzungen'}`,
    busy ? `${busy} arbeitet` : 'ruht',
    running ? `${running} ${running === 1 ? 'Subagent läuft' : 'Subagents laufen'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const summary = [];
  for (const s of project.sessions) {
    const f = st.figs.get(s.sessionId);
    if (!f) continue;
    const state = sessionState(s);
    f.fig.dataset.state = state;
    applyBubble(f.bubble, sessionBubble(s, state));
    f.label.textContent = clip(sessionLabel(s, project.label), 18);
    f.sub.textContent = s.cost != null && s.costKnown ? ctx.usd(s.cost) : entrypointLabel(s.entrypoint);
    summary.push(`${sessionLabel(s, project.label)}: ${state === 'idle' ? 'wartet' : 'arbeitet'}`);

    for (const a of s.agents) {
      const g = st.figs.get(a.id);
      if (!g) continue;
      const as = agentState(a);
      g.fig.dataset.state = as;
      applyBubble(g.bubble, agentBubble(a, as));
      g.label.textContent = clip(a.type, 14);
      // Teilkosten (ein Modell ohne Preis) nicht als exakte Summe ausgeben.
      g.sub.textContent =
        as === 'completed'
          ? 'fertig'
          : as === 'failed'
            ? 'fehlgeschlagen'
            : as === 'stopped'
              ? 'abgebrochen'
              : a.cost != null && a.costKnown
                ? ctx.usd(a.cost)
                : 'läuft';
      if (g.link) g.link.dataset.state = a.state === 'running' ? 'flow' : 'done';
      summary.push(`${a.type} ${as === 'tool' || as === 'thinking' ? 'läuft' : g.sub.textContent}`);
    }
  }
  st.svg.setAttribute('aria-label', `${project.label}: ${summary.join(', ')}`);
}

/* --- Einstieg ------------------------------------------------------------------ */

/**
 * @param container  Element, das die Stationen aufnimmt
 * @param activity   snapshot.activity
 * @param ctx        { tooltip, usd(n), describe(kind, data) -> string }
 */
export function createWorkshop(container, { tooltip, usd, describe }) {
  /** Stationen je Projekt: key -> { root, figs, sig, ... } */
  const stations = new Map();
  /** Aktuelle Daten je Figur fuer den Tooltip (zum Zeitpunkt des Zeigens). */
  const data = new Map();
  /** Figur unter dem Mauszeiger - ihr Tooltip folgt den Aktualisierungen. */
  let hovered = null;

  const hover = (node, id) => {
    node.addEventListener('pointerenter', (ev) => {
      const d = data.get(id);
      if (!d) return;
      hovered = id;
      tooltip.show(ev, describe(d.kind, d.item));
    });
    node.addEventListener('pointermove', (ev) => tooltip.move(ev));
    node.addEventListener('pointerleave', () => {
      if (hovered === id) hovered = null;
      tooltip.hide();
    });
  };
  const ctx = { usd, hover };

  let empty = null;

  return function render(activity) {
    const projects = activity?.projects ?? [];
    data.clear();
    for (const p of projects) {
      for (const s of p.sessions) {
        data.set(s.sessionId, { kind: 'session', item: { ...s, project: p.label } });
        for (const a of s.agents) data.set(a.id, { kind: 'agent', item: { ...a, project: p.label } });
      }
    }

    if (!projects.length) {
      for (const st of stations.values()) st.root.remove();
      stations.clear();
      if (hovered) {
        hovered = null;
        tooltip.hide();
      }
      if (!empty) {
        empty = document.createElement('p');
        empty.className = 'chart-empty';
        empty.textContent = 'Gerade ist keine Claude-Code-Sitzung offen.';
      }
      if (empty.parentNode !== container) container.append(empty);
      return;
    }
    if (empty?.parentNode) empty.remove();

    // Ein Knoten, der unter dem ruhenden Mauszeiger ersetzt wird, bekommt nie
    // ein pointerleave - sein Tooltip bliebe sonst stehen.
    const dropHover = (st) => {
      if (hovered && st.figs.has(hovered)) {
        hovered = null;
        tooltip.hide();
      }
    };

    const wanted = [];
    for (const p of projects) {
      const sig = layoutSignature(p);
      let st = stations.get(p.key);
      if (!st || st.sig !== sig) {
        const fresh = buildStation(p, ctx);
        if (st) {
          dropHover(st);
          st.root.replaceWith(fresh.root);
        }
        st = fresh;
        stations.set(p.key, st);
      }
      applyStation(st, p, ctx);
      wanted.push(st.root);
    }
    for (const [key, st] of stations) {
      if (!projects.some((p) => p.key === key)) {
        dropHover(st);
        st.root.remove();
        stations.delete(key);
      }
    }
    // Der Tooltip der gezeigten Figur folgt dem neuen Stand.
    if (hovered) {
      const d = data.get(hovered);
      if (d) tooltip.update(describe(d.kind, d.item));
      else {
        hovered = null;
        tooltip.hide();
      }
    }
    // Nur umhaengen, wenn sich die Reihenfolge wirklich geaendert hat: jedes
    // Umhaengen startet die Animationen der Station neu.
    const current = [...container.children].filter((n) => n.classList.contains('station'));
    if (current.length !== wanted.length || current.some((n, i) => n !== wanted[i])) {
      for (const n of wanted) container.append(n);
    }
  };
}
