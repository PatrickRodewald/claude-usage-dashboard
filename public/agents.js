/**
 * "Gerade aktiv" als Buero: was arbeitet, als kleine Figuren.
 *
 * Je Projekt ein Raum. An der Rueckwand haengt eine Tafel mit dem
 * Projektnamen und den Auftraegen der Subagents, daneben ein Fenster (der
 * Himmel folgt der Ortszeit) und eine Uhr. Jede laufende Claude-Code-Sitzung
 * sitzt als Figur an einem Schreibtisch mit Laptop und Kaffeetasse, ihre
 * Subagents an kleineren Tischen davor. Laufen sie, fliegen Papierflieger
 * mit Auftraegen vom Auftraggeber zu ihnen. Sprechblasen zeigen das gerade
 * benutzte Werkzeug.
 *
 * Die Raeume werden nur neu aufgebaut, wenn sich die Besetzung aendert (neue
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

const SIDE = 40; // Rand links/rechts (Platz fuer Pflanze und Fenster)
const MIN_W = 340;
const WALL_H = 140; // Rueckwand; darunter beginnt der Boden
const MAIN_SLOT = 150; // Breite je Sitzung
const AGENT_SLOT = 92; // Breite je Subagent
const AGENTS_PER_ROW = 4;
const MAIN_Y = 100; // Verschiebung der Hauptfigur (lokales y=0 -> global 100)
const MAIN_DESK_Y = MAIN_Y + 88; // Tischplatte der Hauptsitzungen, global
const ROWS_TOP = 264; // erste Subagent-Reihe
const ROW_H = 112;
const BOARD_LINES = 3;

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
  return s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s;
}

/** Eindeutige Ids fuer die Flugbahnen der Papierflieger (mpath braucht eine). */
let routeSeq = 0;

/**
 * Beschriftung einer Sitzung. Claude Code leitet den Namen aus dem Ordner ab
 * ("antropicusagedashboard-d3") - der Projektteil steht schon an der Tafel,
 * unterscheidend ist nur das Kuerzel dahinter. Selbst vergebene Namen
 * bleiben, wie sie sind.
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

/* --- Zeit fuer Uhr und Fenster ------------------------------------------------ */

function zonedTime(timeZone) {
  const now = new Date();
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(now);
    const get = (t) => Number(parts.find((p) => p.type === t)?.value);
    return { h: get('hour'), m: get('minute') };
  } catch {
    return { h: now.getHours(), m: now.getMinutes() };
  }
}

function skyFor(h) {
  if (h >= 7 && h < 18) return 'day';
  if (h >= 5 && h < 7) return 'dawn';
  if (h >= 18 && h < 21) return 'dusk';
  return 'night';
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

const MARK = { running: '▸', completed: '✓', failed: '✗', stopped: '–' };
const SESSION_DOING = {
  tool: (s) => s.doing.tool,
  delegating: () => 'delegiert',
  thinking: () => 'denkt nach',
  idle: () => 'Pause',
  stale: () => 'kein Lebenszeichen',
};

/**
 * Was an der Tafel steht: die Auftraege der Subagents (laufende zuerst),
 * ohne Subagents, was jede Sitzung gerade tut.
 */
function boardLines(project) {
  const agents = project.sessions.flatMap((s) => s.agents);
  if (agents.length) {
    const sorted = [...agents].sort(
      (a, b) => (a.state === 'running' ? 0 : 1) - (b.state === 'running' ? 0 : 1) || (b.finishedAt ?? 0) - (a.finishedAt ?? 0),
    );
    const lines = sorted.map((a) => `${MARK[a.state] ?? '•'} ${a.description ?? a.type}`);
    if (lines.length > BOARD_LINES) return [...lines.slice(0, BOARD_LINES - 1), `+ ${lines.length - BOARD_LINES + 1} weitere`];
    return lines;
  }
  return project.sessions
    .slice(0, BOARD_LINES)
    .map((s) => `${sessionLabel(s, project.label)}: ${(SESSION_DOING[sessionState(s)] ?? (() => s.status))(s)}`);
}

/* --- Einrichtung ---------------------------------------------------------------- */

/** Rueckwand, Sockelleiste und Dielenboden. */
function drawRoom(svg, w, h) {
  el('rect', { x: 0, y: 0, width: w, height: WALL_H, class: 'office-wall' }, svg);
  // Wandvertaefelung unten an der Wand
  el('rect', { x: 0, y: WALL_H - 34, width: w, height: 34, class: 'office-wainscot' }, svg);
  el('rect', { x: 0, y: WALL_H, width: w, height: h - WALL_H, class: 'office-floor' }, svg);
  for (let y = WALL_H + 16; y < h; y += 20) {
    el('line', { x1: 0, y1: y, x2: w, y2: y, class: 'office-floorline' }, svg);
  }
  el('rect', { x: 0, y: WALL_H - 4, width: w, height: 6, class: 'office-baseboard' }, svg);
}

/** Tafel an der Rueckwand: Rahmen, Schreibflaeche, Kreideablage, Schrift. */
function drawBoard(svg, w) {
  const bw = Math.max(170, Math.min(320, w - 200));
  const bx = (w - bw) / 2;
  const by = 12;
  const bh = 80;
  el('rect', { x: bx - 5, y: by - 5, width: bw + 10, height: bh + 10, rx: 4, class: 'board-frame' }, svg);
  el('rect', { x: bx, y: by, width: bw, height: bh, rx: 2, class: 'board' }, svg);
  // Kreideablage mit zwei Stuecken Kreide
  el('rect', { x: bx + 10, y: by + bh + 5, width: bw - 20, height: 4, rx: 1.5, class: 'board-frame' }, svg);
  el('rect', { x: bx + bw - 44, y: by + bh + 2, width: 12, height: 3, rx: 1.5, class: 'chalk-piece' }, svg);
  el('rect', { x: bx + bw - 28, y: by + bh + 2, width: 8, height: 3, rx: 1.5, class: 'chalk-piece alt' }, svg);

  const title = el('text', { x: bx + 12, y: by + 22, class: 'chalk chalk-title' }, svg);
  // Kreidestrich unter dem Titel
  el('path', { d: `M${bx + 12} ${by + 29}q${bw * 0.3} 3 ${bw * 0.55} -1`, class: 'chalk-line' }, svg);
  const lines = [];
  for (let i = 0; i < BOARD_LINES; i++) {
    lines.push(el('text', { x: bx + 14, y: by + 45 + i * 14, class: 'chalk chalk-item' }, svg));
  }
  return {
    title,
    lines,
    // Zeichen pro Zeile grob nach Breite - die Kreideschrift ist breit.
    titleChars: Math.floor((bw - 24) / 8.6),
    lineChars: Math.floor((bw - 28) / 6.4),
    sideRoom: bx - 10,
  };
}

/** Fenster mit Himmel je Tageszeit (Sonne, Mond, Sterne). */
function drawWindow(svg, x, y) {
  const g = el('g', { class: 'window', 'data-sky': 'day' }, svg);
  el('rect', { x: x - 3, y: y - 3, width: 62, height: 58, rx: 3, class: 'window-frame' }, g);
  el('rect', { x, y, width: 56, height: 52, class: 'sky' }, g);
  el('circle', { cx: x + 40, cy: y + 15, r: 7, class: 'sun' }, g);
  el('circle', { cx: x + 38, cy: y + 14, r: 6, class: 'moon' }, g);
  for (const [sx, sy] of [
    [10, 10],
    [22, 22],
    [14, 36],
    [46, 34],
  ]) {
    el('circle', { cx: x + sx, cy: y + sy, r: 1.1, class: 'star' }, g);
  }
  // Ein paar Wolken, nur am Tag
  el('path', { d: `M${x + 8} ${y + 40}h18a5 5 0 0 0 -6 -6a7 7 0 0 0 -12 6z`, class: 'cloud' }, g);
  // Fensterkreuz
  el('path', { d: `M${x + 28} ${y}v52M${x} ${y + 26}h56`, class: 'window-cross' }, g);
  el('rect', { x: x - 6, y: y + 52, width: 68, height: 4, rx: 1.5, class: 'window-frame' }, g);
  return g;
}

/** Wanduhr mit echter Uhrzeit. */
function drawClock(svg, cx, cy) {
  const g = el('g', { class: 'clock' }, svg);
  el('circle', { cx, cy, r: 17, class: 'clock-rim' }, g);
  el('circle', { cx, cy, r: 14.5, class: 'clock-face' }, g);
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    const r1 = i % 3 === 0 ? 10.5 : 12;
    el(
      'line',
      {
        x1: cx + Math.sin(a) * r1,
        y1: cy - Math.cos(a) * r1,
        x2: cx + Math.sin(a) * 13.2,
        y2: cy - Math.cos(a) * 13.2,
        class: 'clock-tick',
      },
      g,
    );
  }
  const hour = el('line', { x1: cx, y1: cy, x2: cx, y2: cy - 7.5, class: 'clock-hand hour' }, g);
  const minute = el('line', { x1: cx, y1: cy, x2: cx, y2: cy - 11, class: 'clock-hand minute' }, g);
  el('circle', { cx, cy, r: 1.4, class: 'clock-pin' }, g);
  return { hour, minute, cx, cy };
}

/** Topfpflanze an der Wand. */
function drawPlant(svg, x, floorY) {
  const g = el('g', { class: 'plant' }, svg);
  for (const [dx, dy, rot, rx, ry] of [
    [-7, -40, -28, 5, 13],
    [7, -42, 26, 5, 13],
    [0, -52, 0, 5, 15],
    [-11, -26, -55, 4, 11],
    [11, -27, 52, 4, 11],
  ]) {
    el('ellipse', { cx: x + dx, cy: floorY + dy, rx, ry, transform: `rotate(${rot} ${x + dx} ${floorY + dy})`, class: 'leaf' }, g);
  }
  el('path', { d: `M${x - 12} ${floorY - 20}h24l-3 20h-18z`, class: 'pot' }, g);
  el('rect', { x: x - 13, y: floorY - 23, width: 26, height: 5, rx: 1.5, class: 'pot-rim' }, g);
  return g;
}

/** Schreibtisch in Frontansicht: Platte, Vorderkante, zwei Beine. */
function drawDesk(parent, cx, top, width, legs) {
  const g = el('g', { class: 'desk' }, parent);
  el('rect', { x: cx - width / 2 + 4, y: top + 8, width: 4, height: legs, class: 'desk-leg' }, g);
  el('rect', { x: cx + width / 2 - 8, y: top + 8, width: 4, height: legs, class: 'desk-leg' }, g);
  el('rect', { x: cx - width / 2, y: top, width, height: 5, rx: 2, class: 'desk-top' }, g);
  el('rect', { x: cx - width / 2 + 1, y: top + 5, width: width - 2, height: 4, class: 'desk-edge' }, g);
  return g;
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

/** Kaffeetasse; dampft, solange gearbeitet wird. */
function mug(parent, x, deskTop) {
  const g = el('g', { class: 'mug' }, parent);
  el('path', { d: `M${x + 3} ${deskTop - 5}q2 -3 0 -6M${x + 7} ${deskTop - 5}q2 -3 0 -6`, class: 'steam' }, g);
  el('rect', { x, y: deskTop - 9, width: 10, height: 9, rx: 2, class: 'mug-body' }, g);
  el('path', { d: `M${x + 10} ${deskTop - 7}a3 3 0 0 1 0 5`, class: 'mug-handle' }, g);
  return g;
}

/**
 * Hauptfigur am Schreibtisch, in lokalen Koordinaten (Tischplatte bei y=88).
 * Aussen die Position (transform-Attribut), innen die Animation (CSS) -
 * beides auf demselben Element wuerde sich gegenseitig ueberschreiben.
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

  // Schreibtisch, Laptop (Rueckseite mit leuchtendem Logo) und Tasse davor.
  drawDesk(fig, cx, 88, 118, 30);
  el('path', { d: `M${cx - 18} 88l4 -16h28l4 16z`, class: 'laptop' }, fig);
  el('rect', { x: cx - 11, y: 75, width: 22, height: 10, rx: 1.5, class: 'laptop-screen' }, fig);
  mug(fig, cx + 30, 88);

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

/** Kleinere Figur fuer einen Subagent, sitzend am eigenen Tisch. */
function agentFigure(parent, cx, top, color) {
  const fig = el('g', { class: 'fig fig-agent', style: `--fig: ${color}` }, parent);
  const b = bubble(fig, cx, top);

  const bodyG = el('g', { class: 'fig-body' }, fig);
  el('circle', { cx, cy: top + 33, r: 9, class: 'fig-fill' }, bodyG);
  el('circle', { cx: cx - 3.4, cy: top + 32.5, r: 1.6, class: 'fig-eye' }, bodyG);
  el('circle', { cx: cx + 3.4, cy: top + 32.5, r: 1.6, class: 'fig-eye' }, bodyG);
  el('rect', { x: cx - 11, y: top + 44, width: 22, height: 18, rx: 6, class: 'fig-fill' }, bodyG);
  el('rect', { x: cx - 16, y: top + 47, width: 5, height: 12, rx: 2.5, class: 'fig-fill arm arm-l' }, bodyG);
  el('rect', { x: cx + 11, y: top + 47, width: 5, height: 12, rx: 2.5, class: 'fig-fill arm arm-r' }, bodyG);

  drawDesk(fig, cx, top + 58, 70, 20);
  el('path', { d: `M${cx - 10} ${top + 58}l3 -10h14l3 10z`, class: 'laptop' }, fig);
  el('rect', { x: cx - 6, y: top + 50, width: 12, height: 6, rx: 1, class: 'laptop-screen' }, fig);

  // Abzeichen fuer beendete Agents: Haken, Kreuz oder Strich.
  const badge = el('g', { class: 'badge' }, fig);
  el('circle', { cx: cx + 11, cy: top + 24, r: 7 }, badge);
  el('path', { class: 'badge-ok', d: `M${cx + 7.5} ${top + 24}l2.5 2.5l4.5 -5` }, badge);
  el('path', { class: 'badge-fail', d: `M${cx + 8} ${top + 21}l6 6m0 -6l-6 6` }, badge);
  el('path', { class: 'badge-stop', d: `M${cx + 7.5} ${top + 24}h7` }, badge);
  return { fig, bubble: b };
}

/**
 * Weg eines Auftrags vom Tisch des Auftraggebers zum Tisch des Subagents,
 * mit Papierflieger. Der Flieger ist nur sichtbar, solange der Agent laeuft.
 */
function route(parent, from, to) {
  const id = `cud-route-${++routeSeq}`;
  const g = el('g', { class: 'route' }, parent);
  const lift = Math.min(70, Math.abs(to.y - from.y) * 0.6 + 20);
  el(
    'path',
    {
      id,
      d: `M${from.x} ${from.y}C${from.x} ${from.y - lift} ${to.x} ${to.y - lift} ${to.x} ${to.y}`,
      class: 'route-path',
    },
    g,
  );
  const plane = el('g', { class: 'plane' }, g);
  el('path', { d: 'M-7 -4.5L7 0L-7 4.5L-4 0z', class: 'plane-body' }, plane);
  el('path', { d: 'M-4 0L7 0', class: 'plane-fold' }, plane);
  const dur = `${(2.2 + (routeSeq % 5) * 0.25).toFixed(2)}s`;
  const motion = el('animateMotion', { dur, repeatCount: 'indefinite', rotate: 'auto' }, plane);
  el('mpath', { href: `#${id}` }, motion);
  el('animate', { attributeName: 'opacity', values: '0;1;1;0', keyTimes: '0;0.1;0.85;1', dur, repeatCount: 'indefinite' }, plane);
  return g;
}

/* --- Layout ------------------------------------------------------------------- */

/**
 * Agents einer Sitzung in Anzeigereihenfolge: verschachtelte direkt hinter
 * ihrem Auftraggeber, damit ihr Weg kurz bleibt.
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

/* --- Raum ---------------------------------------------------------------------- */

function buildOffice(project, ctx) {
  const root = document.createElement('div');
  root.className = 'station office';

  // Bereiche je Sitzung: so breit wie die breiteste Agent-Reihe davor.
  const blocks = project.sessions.map((s) => {
    const agents = orderAgents(s.agents);
    const cols = Math.min(AGENTS_PER_ROW, Math.max(1, agents.length));
    return { s, agents, width: Math.max(MAIN_SLOT, cols * AGENT_SLOT), rows: Math.ceil(agents.length / AGENTS_PER_ROW) };
  });
  const width = Math.max(MIN_W, SIDE * 2 + blocks.reduce((a, b) => a + b.width, 0));
  const rows = Math.max(0, ...blocks.map((b) => b.rows));
  const height = rows ? ROWS_TOP + rows * ROW_H : MAIN_DESK_Y + 66;

  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    class: 'workshop-svg',
    role: 'img',
  });
  svg.style.maxWidth = `${width}px`;

  drawRoom(svg, width, height);
  const board = drawBoard(svg, width);
  let windowG = null;
  let clock = null;
  if (board.sideRoom >= 74) {
    windowG = drawWindow(svg, Math.max(14, board.sideRoom / 2 - 28), 24);
    clock = drawClock(svg, width - Math.max(30, board.sideRoom / 2), 52);
  }
  drawPlant(svg, width - 20, WALL_H + 30);

  const figures = el('g', {}, svg);
  // Nach den Figuren: die Papierflieger fliegen vor Tischen und Robotern.
  const routes = el('g', { class: 'routes' }, svg);

  const figs = new Map();
  // Etwas Abstand zur Pflanze rechts: der Inhalt wird mittig verteilt.
  const content = blocks.reduce((a, b) => a + b.width, 0);
  let x0 = (width - content) / 2;
  for (const block of blocks) {
    const cx = x0 + block.width / 2;
    const pos = el('g', { transform: `translate(0 ${MAIN_Y})` }, figures);
    const main = mainFigure(pos, cx);
    const label = el('text', { x: cx, y: MAIN_DESK_Y + 46, 'text-anchor': 'middle', class: 'fig-label' }, figures);
    const sub = el('text', { x: cx, y: MAIN_DESK_Y + 59, 'text-anchor': 'middle', class: 'fig-sublabel' }, figures);
    figs.set(block.s.sessionId, { ...main, label, sub, kind: 'session', desk: { x: cx - 26, y: MAIN_DESK_Y + 2 } });
    ctx.hover(main.fig, block.s.sessionId);

    block.agents.forEach((a, i) => {
      const row = Math.floor(i / AGENTS_PER_ROW);
      const inRow = Math.min(AGENTS_PER_ROW, block.agents.length - row * AGENTS_PER_ROW);
      const ax = cx - (inRow * AGENT_SLOT) / 2 + AGENT_SLOT / 2 + (i % AGENTS_PER_ROW) * AGENT_SLOT;
      const top = ROWS_TOP + row * ROW_H;
      const fig = agentFigure(figures, ax, top, typeColor(a.type));
      const label = el('text', { x: ax, y: top + 93, 'text-anchor': 'middle', class: 'fig-label' }, figures);
      const sub = el('text', { x: ax, y: top + 105, 'text-anchor': 'middle', class: 'fig-sublabel' }, figures);
      figs.set(a.id, { ...fig, label, sub, kind: 'agent', desk: { x: ax - 20, y: top + 60 } });
      ctx.hover(fig.fig, a.id);
    });
    x0 += block.width;
  }

  // Wege erst, wenn alle Tische stehen: ein Auftraggeber kann in der
  // Reihenfolge nach seinem Subagent kommen.
  for (const block of blocks) {
    for (const a of block.agents) {
      const from = (figs.get(a.parentId ?? block.s.sessionId) ?? figs.get(block.s.sessionId)).desk;
      const to = figs.get(a.id).desk;
      figs.get(a.id).route = route(routes, from, to);
    }
  }

  root.append(svg);
  return { root, svg, figs, board, windowG, clock, sig: layoutSignature(project) };
}

/** Uhr und Fenster auf die aktuelle Zeit stellen. */
function applyTime(st, timeZone) {
  const { h, m } = zonedTime(timeZone);
  if (st.windowG) st.windowG.dataset.sky = skyFor(h);
  if (st.clock) {
    const { cx, cy } = st.clock;
    st.clock.hour.setAttribute('transform', `rotate(${((h % 12) + m / 60) * 30} ${cx} ${cy})`);
    st.clock.minute.setAttribute('transform', `rotate(${m * 6} ${cx} ${cy})`);
  }
}

/** Zustand auf einen bestehenden Raum uebertragen - ohne Neuaufbau. */
function applyOffice(st, project, ctx) {
  // Lange Namen lieber kleiner schreiben als abschneiden - erst ab 11 px wird
  // gekuerzt. titleChars gilt fuer die volle Groesse von 15 px.
  const len = project.label.length;
  const size = len > st.board.titleChars ? Math.max(11, (15 * st.board.titleChars) / len) : 15;
  st.board.title.style.fontSize = `${size.toFixed(1)}px`;
  st.board.title.textContent = clip(project.label, Math.floor((st.board.titleChars * 15) / size));
  const lines = boardLines(project);
  st.board.lines.forEach((t, i) => {
    t.textContent = lines[i] ? clip(lines[i], st.board.lineChars) : '';
  });

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
      if (g.route) g.route.dataset.state = a.state === 'running' ? 'flow' : 'done';
      summary.push(`${a.type} ${as === 'tool' || as === 'thinking' ? 'läuft' : g.sub.textContent}`);
    }
  }
  st.svg.setAttribute('aria-label', `Büro ${project.label}: ${summary.join(', ')}`);
  applyTime(st, ctx.timeZone());
}

/* --- Einstieg ------------------------------------------------------------------ */

/**
 * @param container  Element, das die Raeume aufnimmt
 * @param ctx        { tooltip, usd(n), describe(kind, data) -> string, timeZone() }
 * @returns {{ render(activity), tick() }}  tick() stellt Uhren und Fenster
 */
export function createWorkshop(container, { tooltip, usd, describe, timeZone = () => undefined }) {
  /** Raeume je Projekt: key -> { root, figs, sig, ... } */
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
  const ctx = { usd, hover, timeZone };

  let empty = null;

  function render(activity) {
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
        empty.textContent = 'Gerade ist keine Claude-Code-Sitzung offen – das Büro ist leer.';
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
        const fresh = buildOffice(p, ctx);
        if (st) {
          dropHover(st);
          st.root.replaceWith(fresh.root);
        }
        st = fresh;
        stations.set(p.key, st);
      }
      applyOffice(st, p, ctx);
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
    // Umhaengen startet die Animationen des Raums neu.
    const current = [...container.children].filter((n) => n.classList.contains('station'));
    if (current.length !== wanted.length || current.some((n, i) => n !== wanted[i])) {
      for (const n of wanted) container.append(n);
    }
  }

  function tick() {
    for (const st of stations.values()) applyTime(st, timeZone());
  }

  return { render, tick };
}
