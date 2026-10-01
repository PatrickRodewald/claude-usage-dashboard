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
/** Nur Commits/Pushes, die hoechstens so alt sind, werden gefeiert. */
const CELEBRATE_FRESH_MS = 90_000;

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

/** Uhrzeit "14:30" in der Anzeigezone. */
function hhmm(ms, timeZone) {
  try {
    return new Intl.DateTimeFormat('de-DE', { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
  } catch {
    return new Date(ms).toTimeString().slice(0, 5);
  }
}

/* --- Limit ---------------------------------------------------------------------- */

/**
 * Wie das Buero auf das 5h-Fenster reagiert: 'ok', 'warn' (ab der
 * Warnschwelle), 'critical', 'reached' (100 %, Zwangspause) oder 'unknown'.
 */
export function limitState(fiveHour) {
  // Nur echte Werte von Anthropic: eine lokale Schaetzung kann weit daneben
  // liegen und wuerde sonst grundlos Alarm schlagen oder Pause machen.
  if (fiveHour?.source !== 'anthropic') return 'unknown';
  const p = fiveHour.percent;
  if (!Number.isFinite(p)) return 'unknown';
  if (p >= 100) return 'reached';
  if (fiveHour.level === 'critical') return 'critical';
  if (fiveHour.level === 'warn') return 'warn';
  return 'ok';
}

/**
 * Was der Abreisskalender zeigt: volle Tage bis zum Wochen-Reset, im letzten
 * Tag die angefangenen Stunden.
 */
export function calendarFace(weekEnd, now = Date.now()) {
  if (!Number.isFinite(weekEnd)) return null;
  const hours = (weekEnd - now) / 3_600_000;
  if (hours <= 0) return { big: '0', small: 'Std.' };
  if (hours < 24) {
    const h = Math.ceil(hours);
    return { big: String(h), small: h === 1 ? 'Stunde' : 'Std.' };
  }
  const d = Math.floor(hours / 24);
  return { big: String(d), small: d === 1 ? 'Tag' : 'Tage' };
}

function skyFor(h) {
  if (h >= 7 && h < 18) return 'day';
  if (h >= 5 && h < 7) return 'dawn';
  if (h >= 18 && h < 21) return 'dusk';
  return 'night';
}

/* --- Messwerte als Gegenstaende ------------------------------------------------ */

/** Blaetter im Aktenstapel: Kontext der letzten Anfrage im Verhaeltnis zum Fenster. */
export function stackSheets(context, limit, max = 16) {
  if (!(context > 0) || !(limit > 0)) return 0;
  return Math.max(1, Math.min(max, Math.round((context / limit) * max)));
}

/**
 * Dauer eines Tippschlags in Sekunden: je mehr Output in den letzten zwei
 * Minuten, desto schneller. Ab 3000 Tokens/Min. ist das Maximum erreicht.
 */
export function typeDuration(outputPerMin) {
  const f = Math.min(1, Math.max(0, (outputPerMin || 0) / 3000));
  return Math.round((0.5 - 0.34 * f) * 100) / 100;
}

/**
 * Muenzen neben dem Sparschwein: logarithmisch mit dem Kosten-Aequivalent
 * (1 $ -> 1, 3 $ -> 2, 7 $ -> 3 ... 255 $ -> 8). Die genaue Summe steht unter
 * dem Tisch - die Muenzen zeigen nur die Groessenordnung.
 */
export function coinCount(cost, max = 8) {
  if (!(cost > 0)) return 0;
  return Math.min(max, Math.max(1, Math.ceil(Math.log2(1 + cost))));
}

/* --- Taetigkeit je Werkzeug ---------------------------------------------------- */

const TOOL_ACTIVITY = {
  Read: 'read',
  NotebookRead: 'read',
  Skill: 'read',
  Grep: 'search',
  Glob: 'search',
  LS: 'search',
  ToolSearch: 'search',
  Edit: 'write',
  Write: 'write',
  MultiEdit: 'write',
  NotebookEdit: 'write',
  Bash: 'shell',
  PowerShell: 'shell',
  BashOutput: 'shell',
  WebFetch: 'web',
  WebSearch: 'web',
  TodoWrite: 'todo',
  TaskCreate: 'todo',
  TaskUpdate: 'todo',
  Agent: 'delegate',
  Task: 'delegate',
};

/**
 * Welche Taetigkeit eine Figur zeigt. detail kommt vom Server (Commit, Push,
 * Testlauf); MCP-Werkzeuge sprechen mit einem fremden Dienst - wie das Web.
 */
export function toolActivity(tool, detail) {
  if (!tool) return null;
  // Commit und Push sind waehrend der Ausfuehrung einfach Shell - gefeiert
  // wird erst der Erfolg (celebration).
  if (detail === 'test') return 'test';
  if (TOOL_ACTIVITY[tool]) return TOOL_ACTIVITY[tool];
  if (String(tool).startsWith('mcp__')) return 'web';
  return 'tool';
}

/** Taetigkeit der Hauptfigur einer Sitzung (null = keine). */
function sessionActivity(s, state) {
  if (state === 'tool') return toolActivity(s.doing?.tool, s.doing?.detail);
  if (state === 'delegating') return 'delegate';
  if (state === 'thinking') return 'think';
  return null;
}

function agentActivity(a, state) {
  if (state === 'tool') return toolActivity(a.tool, a.toolDetail);
  if (state === 'thinking') return 'think';
  return null;
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
  if (state === 'thinking') return null; // Gedankenwolke statt Sprechblase
  return clip(s.status, 12);
}

function agentState(a) {
  if (a.state !== 'running') return a.state; // completed | failed | stopped
  return a.tool ? 'tool' : 'thinking';
}

function agentBubble(a, state) {
  if (state === 'tool') return clip(a.tool, 12);
  return null; // Nachdenken: Gedankenwolke; Beendete tragen ein Abzeichen.
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

  // Warnlampe oben auf dem Rahmen: dreht sich ab der Warnschwelle (data-limit).
  const beacon = el('g', { class: 'beacon' }, svg);
  const bcx = bx + bw / 2;
  el('rect', { x: bcx - 7, y: by - 8, width: 14, height: 4, rx: 1, class: 'beacon-base' }, beacon);
  // Ein Strahl, der von vorn gesehen hin und her schwenkt - eine volle
  // Drehung wuerde am oberen Rand des Raums abgeschnitten.
  const beams = el('g', { class: 'beacon-beams' }, beacon);
  el('path', { d: `M${bcx - 30} ${by - 12}l30 -2v4z`, class: 'beacon-beam' }, beams);
  el('path', { d: `M${bcx} ${by - 12}l30 -6v12z`, class: 'beacon-beam' }, beams);
  el('path', { d: `M${bcx - 5} ${by - 8}a5 5 0 0 1 10 0z`, class: 'beacon-dome' }, beacon);

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

/**
 * Abreisskalender: Tage bis zum Wochen-Reset. Fuer das Abreissen liegt ein
 * zweites Blatt bereit, das mit der alten Zahl herunterfaellt.
 */
function drawCalendar(svg, cx, top) {
  const g = el('g', { class: 'calendar' }, svg);
  const title = el('title', {}, g);
  el('rect', { x: cx - 13, y: top, width: 26, height: 28, rx: 2, class: 'calendar-page' }, g);
  el('rect', { x: cx - 13, y: top, width: 26, height: 7, rx: 2, class: 'calendar-head' }, g);
  const head = el('text', { x: cx, y: top + 5.6, 'text-anchor': 'middle', class: 'calendar-headtext' }, g);
  head.textContent = 'Reset';
  const big = el('text', { x: cx, y: top + 19, 'text-anchor': 'middle', class: 'calendar-big' }, g);
  const small = el('text', { x: cx, y: top + 25.5, 'text-anchor': 'middle', class: 'calendar-small' }, g);
  const sheet = el('g', { class: 'calendar-sheet' }, g);
  el('rect', { x: cx - 13, y: top + 7, width: 26, height: 21, rx: 1, class: 'calendar-page' }, sheet);
  const sheetBig = el('text', { x: cx, y: top + 19, 'text-anchor': 'middle', class: 'calendar-big' }, sheet);
  return { g, title, big, small, sheetBig, last: null };
}

/** Kaffeeecke links an der Wand: Theke mit Maschine. Hierher geht es zur Zwangspause. */
function drawCoffeeCorner(svg) {
  const g = el('g', { class: 'coffee-corner' }, svg);
  el('rect', { x: 4, y: WALL_H + 2, width: 38, height: 32, rx: 2, class: 'counter' }, g);
  el('rect', { x: 4, y: WALL_H + 2, width: 38, height: 4, rx: 1.5, class: 'counter-top' }, g);
  el('rect', { x: 12, y: WALL_H - 24, width: 22, height: 26, rx: 3, class: 'machine' }, g);
  el('rect', { x: 15, y: WALL_H - 20, width: 16, height: 6, rx: 1, class: 'machine-panel' }, g);
  el('circle', { cx: 28, cy: WALL_H - 17, r: 1.4, class: 'machine-light' }, g);
  el('rect', { x: 20, y: WALL_H - 12, width: 6, height: 3, class: 'machine-spout' }, g);
  el('rect', { x: 19, y: WALL_H - 5, width: 8, height: 7, rx: 1.5, class: 'mug-body' }, g);
  el('path', { d: `M21 ${WALL_H - 7}q2 -3 0 -6M25 ${WALL_H - 7}q2 -3 0 -6`, class: 'machine-steam' }, g);
  return g;
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

/** Aktenstapel = Kontext. Alle Blaetter stehen bereit, sichtbar sind nur so viele wie noetig. */
function paperStack(parent, x, deskTop, max, sheetH, w) {
  const g = el('g', { class: 'stack' }, parent);
  const sheets = [];
  for (let i = 0; i < max; i++) {
    // Leicht versetzt - ein echter Stapel ist nie ganz gerade.
    const dx = ((i * 7) % 3) - 1;
    sheets.push(el('rect', { x: x - w / 2 + dx, y: deskTop - (i + 1) * sheetH, width: w, height: sheetH, class: 'sheet' }, g));
  }
  return { g, sheets };
}

/** Sparschwein unter dem Tisch mit Muenzstapel und einer Muenze, die hineinfaellt. */
function piggyBank(parent, cx, floorY) {
  const g = el('g', { class: 'piggy' }, parent);
  const coins = [];
  for (let i = 0; i < 8; i++) {
    coins.push(el('ellipse', { cx: cx + 24, cy: floorY - 1.5 - i * 2.6, rx: 5, ry: 1.8, class: 'coin' }, g));
  }
  el('rect', { x: cx - 8, y: floorY - 5, width: 3, height: 5, rx: 1, class: 'pig-detail' }, g);
  el('rect', { x: cx + 5, y: floorY - 5, width: 3, height: 5, rx: 1, class: 'pig-detail' }, g);
  el('ellipse', { cx, cy: floorY - 10, rx: 12, ry: 8, class: 'pig-body' }, g);
  el('ellipse', { cx: cx + 12, cy: floorY - 10, rx: 3, ry: 3.5, class: 'pig-detail' }, g);
  el('path', { d: `M${cx + 3} ${floorY - 18}l3 -4l2 5z`, class: 'pig-detail' }, g);
  el('circle', { cx: cx + 7, cy: floorY - 12, r: 1, class: 'pig-eye' }, g);
  el('path', { d: `M${cx - 4} ${floorY - 17.5}h6`, class: 'pig-slot' }, g);
  el('ellipse', { cx: cx - 1, cy: floorY - 30, rx: 3.2, ry: 3.2, class: 'coin coin-drop' }, g);
  return { g, coins };
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
 * Requisiten je Taetigkeit, links auf dem Tisch. Ursprung (0,0) ist die Mitte
 * der Tischplatte; s skaliert fuer die kleineren Tische der Subagents.
 * Sichtbar ist jeweils nur die Gruppe, deren Klasse zu data-activity passt.
 */
function props(parent, ox, oy, s = 1) {
  const g = el('g', { class: 'props', transform: `translate(${ox} ${oy}) scale(${s})` }, parent);

  // Lesen: aufgeschlagenes Buch, eine Seite blaettert um.
  const read = el('g', { class: 'prop prop-read' }, g);
  el('path', { d: 'M-48 -1l12 -3v-9l-12 3z', class: 'paper' }, read);
  el('path', { d: 'M-36 -4l12 3v-9l-12 -3z', class: 'paper' }, read);
  el('path', { d: 'M-36 -4l11 2v-9l-11 -2z', class: 'paper flip' }, read);
  el('path', { d: 'M-49 0h26', class: 'book-spine' }, read);

  // Suchen: Lupe wandert ueber einen Stapel Blaetter.
  const search = el('g', { class: 'prop prop-search' }, g);
  el('rect', { x: -50, y: -4, width: 24, height: 4, rx: 1, class: 'paper' }, search);
  const lens = el('g', { class: 'lens' }, search);
  el('circle', { cx: -42, cy: -11, r: 5, class: 'lens-glass' }, lens);
  el('path', { d: 'M-38.5 -7.5l5 5', class: 'lens-handle' }, lens);

  // Schreiben: Notizblock, der Stift kritzelt.
  const write = el('g', { class: 'prop prop-write' }, g);
  el('rect', { x: -50, y: -16, width: 18, height: 16, rx: 1.5, class: 'paper' }, write);
  for (const y of [-12, -8, -4]) el('path', { d: `M-47 ${y}h12`, class: 'paper-line' }, write);
  const pencil = el('g', { class: 'pencil' }, write);
  el('path', { d: 'M-40 -6l9 -13l3 2l-9 13z', class: 'pencil-body' }, pencil);
  el('path', { d: 'M-40 -6l-1 4l3 -2z', class: 'pencil-tip' }, pencil);

  // Testlauf: Reagenzglas mit aufsteigenden Blasen.
  const test = el('g', { class: 'prop prop-test' }, g);
  el('path', { d: 'M-42 -22v17a4 4 0 0 0 8 0v-17', class: 'tube' }, test);
  el('path', { d: 'M-42 -12v7a4 4 0 0 0 8 0v-7z', class: 'tube-liquid' }, test);
  for (const [x, d] of [
    [-40, 0],
    [-37, 0.5],
    [-39, 1],
  ]) {
    el('circle', { cx: x, cy: -8, r: 1.2, class: 'bubble-dot', style: `animation-delay:${d}s` }, test);
  }

  // Web: kleiner Globus, der sich dreht.
  const web = el('g', { class: 'prop prop-web' }, g);
  el('circle', { cx: -40, cy: -10, r: 8, class: 'globe' }, web);
  el('ellipse', { cx: -40, cy: -10, rx: 3.5, ry: 8, class: 'globe-line meridian' }, web);
  el('path', { d: 'M-48 -10h16M-46.5 -14.5h13M-46.5 -5.5h13', class: 'globe-line' }, web);
  el('path', { d: 'M-44 0h8l-1 -2h-6z', class: 'globe-stand' }, web);

  // To-dos: Klemmbrett, Haken erscheinen nacheinander.
  const todo = el('g', { class: 'prop prop-todo' }, g);
  el('rect', { x: -50, y: -20, width: 18, height: 20, rx: 2, class: 'clipboard' }, todo);
  el('rect', { x: -45, y: -22, width: 8, height: 4, rx: 1, class: 'clip' }, todo);
  [-15, -9, -3].forEach((y, i) => {
    el('rect', { x: -47, y: y - 2.5, width: 4, height: 4, rx: 0.8, class: 'paper' }, todo);
    el('path', { d: `M-47 ${y - 0.5}l1.5 1.5l3 -3.5`, class: 'tick', style: `animation-delay:${i * 0.6}s` }, todo);
    el('path', { d: `M-41 ${y - 0.5}h7`, class: 'paper-line' }, todo);
  });

  // Delegieren: Papierflieger, startbereit in der Hand.
  const del = el('g', { class: 'prop prop-delegate' }, g);
  el('path', { d: 'M-46 -14l14 4l-14 4l3 -4z', class: 'plane-body' }, del);

  return g;
}

/** Bildschirminhalt bei Shell-Arbeit: gruener Text, der durchlaeuft. */
function screenFx(parent, x, y, w, h) {
  const g = el('g', { class: 'screen-fx' }, parent);
  const rows = 3;
  for (let i = 0; i < rows; i++) {
    const ly = y + 2 + (i * (h - 3)) / (rows - 1);
    el('path', { d: `M${x + 2} ${ly}h${w * (0.45 + 0.15 * i)}`, class: 'screen-line', style: `animation-delay:${i * 0.25}s` }, g);
  }
  return g;
}

/** Funkwellen fuer Web-Werkzeuge. */
function waves(parent, x, y, r = 8) {
  const g = el('g', { class: 'waves' }, parent);
  for (let i = 0; i < 3; i++) {
    el(
      'path',
      { d: `M${x - r} ${y}a${r} ${r} 0 0 1 ${2 * r} 0`, class: 'wave', style: `animation-delay:${i * 0.4}s` },
      g,
    );
  }
  return g;
}

/** Gedankenwolke mit drehendem Zahnrad - Claude denkt nach. */
function thought(parent, x, y, s = 1) {
  const g = el('g', { class: 'thought', transform: `translate(${x} ${y}) scale(${s})` }, parent);
  el('circle', { cx: -9, cy: 14, r: 1.8, class: 'cloud-puff' }, g);
  el('circle', { cx: -5, cy: 9, r: 2.6, class: 'cloud-puff' }, g);
  el('path', { d: 'M-10 0a7 7 0 0 1 8 -7a8 8 0 0 1 14 2a6 6 0 0 1 2 11h-20a6 6 0 0 1 -4 -6z', class: 'cloud-puff' }, g);
  // Position und Drehung getrennt: die CSS-Drehung ersetzt sonst das translate.
  const gear = el('g', { class: 'gear' }, el('g', { transform: 'translate(3 0)' }, g));
  const teeth = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    teeth.push(`M${Math.cos(a) * 3} ${Math.sin(a) * 3}L${Math.cos(a) * 5.4} ${Math.sin(a) * 5.4}`);
  }
  el('path', { d: teeth.join(''), class: 'gear-teeth' }, gear);
  el('circle', { cx: 0, cy: 0, r: 3.4, class: 'gear-body' }, gear);
  el('circle', { cx: 0, cy: 0, r: 1.2, class: 'gear-hole' }, gear);
  return g;
}

/** Konfetti (Commit) und Rakete (Push) - nur kurz eingeblendet, siehe celebrate(). */
function celebrationFx(parent, cx, y) {
  const g = el('g', { class: 'celebration' }, parent);
  const confetti = el('g', { class: 'confetti' }, g);
  const colors = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-7)'];
  for (let i = 0; i < 14; i++) {
    const dx = ((i * 37) % 60) - 30;
    el(
      'rect',
      {
        x: cx + dx,
        y,
        width: 3,
        height: 5,
        rx: 0.8,
        fill: colors[i % colors.length],
        class: 'confetto',
        style: `--dx:${dx / 3}px;animation-delay:${(i % 5) * 0.08}s`,
      },
      confetti,
    );
  }
  const rocket = el('g', { class: 'rocket' }, g);
  el('path', { d: `M${cx + 34} ${y + 30}l-5 -9l5 -12l5 12z`, class: 'rocket-body' }, rocket);
  el('path', { d: `M${cx + 29} ${y + 21}l-3 6h6zM${cx + 39} ${y + 21}l3 6h-6z`, class: 'rocket-fin' }, rocket);
  el('path', { d: `M${cx + 31} ${y + 31}l3 7l3 -7z`, class: 'rocket-flame' }, rocket);
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
  // Nur in der Zwangspause sichtbar: Beine zum Stehen und eine Tasse in der Hand.
  const legs = el('g', { class: 'legs' }, bodyG);
  el('rect', { x: cx - 12, y: 88, width: 8, height: 24, rx: 3, class: 'fig-fill' }, legs);
  el('rect', { x: cx + 4, y: 88, width: 8, height: 24, rx: 3, class: 'fig-fill' }, legs);
  el('rect', { x: cx + 18, y: 78, width: 9, height: 9, rx: 2, class: 'mug-body break-cup' }, bodyG);

  // Funkwellen ueber der Antenne (Web) und Gedankenwolke (Nachdenken).
  waves(fig, cx, 21, 6);
  thought(fig, cx + 4, 9);

  // Schreibtisch, Laptop (Rueckseite mit leuchtendem Logo) und Tasse davor.
  drawDesk(fig, cx, 88, 118, 30);
  el('path', { d: `M${cx - 18} 88l4 -16h28l4 16z`, class: 'laptop' }, fig);
  el('rect', { x: cx - 11, y: 75, width: 22, height: 10, rx: 1.5, class: 'laptop-screen' }, fig);
  screenFx(fig, cx - 11, 75, 22, 10);
  mug(fig, cx + 30, 88);
  props(fig, cx, 88);
  const stack = paperStack(fig, cx + 49, 88, 16, 2.5, 13);
  const piggy = piggyBank(fig, cx - 8, 126);
  celebrationFx(fig, cx, 0);

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
  return { fig, bubble: b, stack, piggy };
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
  const legs = el('g', { class: 'legs' }, bodyG);
  el('rect', { x: cx - 8, y: top + 60, width: 6, height: 14, rx: 2, class: 'fig-fill' }, legs);
  el('rect', { x: cx + 2, y: top + 60, width: 6, height: 14, rx: 2, class: 'fig-fill' }, legs);
  el('rect', { x: cx + 12, y: top + 53, width: 6, height: 6, rx: 1.5, class: 'mug-body break-cup' }, bodyG);

  waves(fig, cx, top + 22, 5);
  thought(fig, cx + 3, top + 9, 0.75);

  drawDesk(fig, cx, top + 58, 70, 20);
  el('path', { d: `M${cx - 10} ${top + 58}l3 -10h14l3 10z`, class: 'laptop' }, fig);
  el('rect', { x: cx - 6, y: top + 50, width: 12, height: 6, rx: 1, class: 'laptop-screen' }, fig);
  screenFx(fig, cx - 6, top + 50, 12, 6);
  props(fig, cx, top + 58, 0.62);
  const stack = paperStack(fig, cx + 25, top + 58, 10, 2, 9);
  celebrationFx(fig, cx, top - 4);

  // Abzeichen fuer beendete Agents: Haken, Kreuz oder Strich. Bewusst nicht im
  // (blass gestellten) Koerper; in die Pause geht es per CSS mit.
  const badge = el('g', { class: 'badge' }, fig);
  el('circle', { cx: cx + 11, cy: top + 24, r: 7 }, badge);
  el('path', { class: 'badge-ok', d: `M${cx + 7.5} ${top + 24}l2.5 2.5l4.5 -5` }, badge);
  el('path', { class: 'badge-fail', d: `M${cx + 8} ${top + 21}l6 6m0 -6l-6 6` }, badge);
  el('path', { class: 'badge-stop', d: `M${cx + 7.5} ${top + 24}h7` }, badge);
  return { fig, bubble: b, stack };
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
  let calendar = null;
  if (board.sideRoom >= 74) {
    windowG = drawWindow(svg, Math.max(14, board.sideRoom / 2 - 28), 24);
    clock = drawClock(svg, width - Math.max(30, board.sideRoom / 2), 52);
    calendar = drawCalendar(svg, clock.cx, 76);
  }
  drawPlant(svg, width - 20, WALL_H + 30);
  drawCoffeeCorner(svg);

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
    figs.set(block.s.sessionId, {
      ...main,
      label,
      sub,
      kind: 'session',
      desk: { x: cx - 26, y: MAIN_DESK_Y + 2 },
      // Wo die Figur steht, wenn sie aufsteht (Fuesse der Beine, global).
      home: { x: cx, feet: MAIN_Y + 112 },
    });
    ctx.hover(main.fig, block.s.sessionId);

    block.agents.forEach((a, i) => {
      const row = Math.floor(i / AGENTS_PER_ROW);
      const inRow = Math.min(AGENTS_PER_ROW, block.agents.length - row * AGENTS_PER_ROW);
      const ax = cx - (inRow * AGENT_SLOT) / 2 + AGENT_SLOT / 2 + (i % AGENTS_PER_ROW) * AGENT_SLOT;
      const top = ROWS_TOP + row * ROW_H;
      const fig = agentFigure(figures, ax, top, typeColor(a.type));
      const label = el('text', { x: ax, y: top + 93, 'text-anchor': 'middle', class: 'fig-label' }, figures);
      const sub = el('text', { x: ax, y: top + 105, 'text-anchor': 'middle', class: 'fig-sublabel' }, figures);
      figs.set(a.id, { ...fig, label, sub, kind: 'agent', desk: { x: ax - 20, y: top + 60 }, home: { x: ax, feet: top + 74 } });
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

  // Zwangspause: jede Figur weiss, wohin sie geht - eine Schlange neben der
  // Kaffeemaschine, Fuesse auf derselben Linie. Gesetzt als CSS-Variablen,
  // der Weg selbst ist eine CSS-Transition.
  // Der Abstand folgt der Figurbreite; reicht der Raum nicht, beginnt eine
  // zweite Reihe etwas weiter vorn.
  let qx = 52;
  let qRow = 0;
  for (const block of blocks) {
    for (const id of [block.s.sessionId, ...block.agents.map((a) => a.id)]) {
      const f = figs.get(id);
      if (!f) continue;
      // Breite samt Armen und Tasse (gemessen: 50 bzw. 34 px) plus etwas Luft.
      const span = f.kind === 'session' ? 54 : 38;
      if (qx + span > width - 50) {
        qx = 52;
        qRow++;
      }
      const targetX = qx + span / 2;
      const feetY = WALL_H + 52 + qRow * 40;
      f.fig.style.setProperty('--bx', `${targetX - f.home.x}px`);
      f.fig.style.setProperty('--by', `${feetY - f.home.feet}px`);
      qx += span;
    }
  }

  // Roter Schimmer ueber dem ganzen Raum, solange das Limit kritisch ist.
  el('rect', { x: 0, y: 0, width, height, class: 'alarm-glow' }, svg);

  root.append(svg);
  return { root, svg, figs, board, windowG, clock, calendar, sig: layoutSignature(project) };
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

/** Aktenstapel auf die Kontextgroesse bringen; ab 85 % wackelt er. */
function applyStack(stack, context, limit) {
  if (!stack) return;
  const n = stackSheets(context, limit, stack.sheets.length);
  stack.sheets.forEach((r, i) => {
    r.style.visibility = i < n ? '' : 'hidden';
  });
  if (context > 0 && limit > 0 && context / limit >= 0.85) stack.g.dataset.high = '1';
  else if (stack.g.dataset.high) delete stack.g.dataset.high;
}

/** Muenzen nach Kosten; steigen sie, faellt eine Muenze ins Schwein. */
function applyPiggy(f, cost) {
  if (!f.piggy) return;
  const k = coinCount(cost);
  f.piggy.coins.forEach((c, i) => {
    c.style.visibility = i < k ? '' : 'hidden';
  });
  if (f.lastCost != null && cost != null && cost > f.lastCost + 1e-6) {
    const g = f.piggy.g;
    g.classList.remove('drop');
    g.getBoundingClientRect(); // Animation neu starten
    g.classList.add('drop');
    clearTimeout(f.dropTimer);
    f.dropTimer = setTimeout(() => g.classList.remove('drop'), 900);
  }
  if (cost != null) f.lastCost = cost;
}

function setTempo(node, outputPerMin) {
  const v = `${typeDuration(outputPerMin)}s`;
  if (node.style.getPropertyValue('--type-dur') !== v) node.style.setProperty('--type-dur', v);
}

function setActivity(node, activity) {
  if (activity) {
    if (node.dataset.activity !== activity) node.dataset.activity = activity;
  } else if (node.dataset.activity) {
    delete node.dataset.activity;
  }
}

/** Abreisskalender nachfuehren; bei einer neuen Zahl faellt das alte Blatt. */
function applyCalendar(st, timeZone) {
  const cal = st.calendar;
  if (!cal) return;
  const week = st.env?.week;
  const face = calendarFace(week?.end);
  cal.g.style.display = face ? '' : 'none';
  if (!face) return;
  const key = `${face.big} ${face.small}`;
  if (cal.last && cal.last !== key) {
    cal.sheetBig.textContent = cal.big.textContent;
    cal.g.classList.remove('tear');
    cal.g.getBoundingClientRect(); // Animation neu starten
    cal.g.classList.add('tear');
    clearTimeout(cal.timer);
    cal.timer = setTimeout(() => cal.g.classList.remove('tear'), 1300);
  }
  cal.last = key;
  cal.big.textContent = face.big;
  cal.small.textContent = face.small;
  let when = '';
  try {
    when = new Intl.DateTimeFormat('de-DE', {
      timeZone,
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(week.end));
  } catch {
    when = new Date(week.end).toLocaleString('de-DE');
  }
  cal.title.textContent =
    `Wochenlimit setzt sich zurück: ${when}` +
    (Number.isFinite(week.percent) ? ` · ${Math.round(week.percent)} % verbraucht` : '');
}

/** Zustand auf einen bestehenden Raum uebertragen - ohne Neuaufbau. */
function applyOffice(st, project, ctx, env = {}) {
  st.env = env;
  // Limit: Warnlampe und Schimmer haengen an data-limit (CSS); bei 100 %
  // stehen alle auf und gehen zur Kaffeemaschine.
  const limit = limitState(env.fiveHour);
  if (st.root.dataset.limit !== limit) st.root.dataset.limit = limit;
  const onBreak = limit === 'reached';
  for (const f of st.figs.values()) {
    if (onBreak) f.fig.dataset.break = '1';
    else if (f.fig.dataset.break) delete f.fig.dataset.break;
  }

  // Lange Namen lieber kleiner schreiben als abschneiden - erst ab 11 px wird
  // gekuerzt. titleChars gilt fuer die volle Groesse von 15 px.
  const len = project.label.length;
  const size = len > st.board.titleChars ? Math.max(11, (15 * st.board.titleChars) / len) : 15;
  st.board.title.style.fontSize = `${size.toFixed(1)}px`;
  st.board.title.textContent = clip(project.label, Math.floor((st.board.titleChars * 15) / size));
  let lines = boardLines(project);
  if (onBreak && Number.isFinite(env.fiveHour?.end)) {
    lines = [`Zwangspause bis ${hhmm(env.fiveHour.end, ctx.timeZone())}`, ...lines].slice(0, BOARD_LINES);
  }
  st.board.lines.forEach((t, i) => {
    t.textContent = lines[i] ? clip(lines[i], st.board.lineChars) : '';
  });

  const summary = [];
  for (const s of project.sessions) {
    const f = st.figs.get(s.sessionId);
    if (!f) continue;
    const state = sessionState(s);
    f.fig.dataset.state = state;
    setActivity(f.fig, sessionActivity(s, state));
    setTempo(f.fig, s.outputPerMin);
    applyStack(f.stack, s.context, s.contextLimit);
    applyPiggy(f, s.cost);
    applyBubble(f.bubble, sessionBubble(s, state));
    f.label.textContent = clip(sessionLabel(s, project.label), 18);
    f.sub.textContent = s.cost != null && s.costKnown ? ctx.usd(s.cost) : entrypointLabel(s.entrypoint);
    summary.push(`${sessionLabel(s, project.label)}: ${state === 'idle' ? 'wartet' : 'arbeitet'}`);

    for (const a of s.agents) {
      const g = st.figs.get(a.id);
      if (!g) continue;
      const as = agentState(a);
      g.fig.dataset.state = as;
      setActivity(g.fig, agentActivity(a, as));
      setTempo(g.fig, a.outputPerMin);
      applyStack(g.stack, a.context, a.contextLimit);
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
  if (onBreak) summary.unshift('Limit erreicht, Zwangspause');
  st.svg.setAttribute('aria-label', `Büro ${project.label}: ${summary.join(', ')}`);
  applyTime(st, ctx.timeZone());
  applyCalendar(st, ctx.timeZone());
}

/* --- Einstieg ------------------------------------------------------------------ */

/**
 * @param container  Element, das die Raeume aufnimmt
 * @param ctx        { tooltip, usd(n), describe(kind, data) -> string, timeZone() }
 * @returns {{ render(activity, env), tick() }}  env = { fiveHour, week } aus snapshot.live;
 *          tick() stellt Uhren, Fenster und Kalender
 */
export function createWorkshop(container, { tooltip, usd, describe, timeZone = () => undefined }) {
  /** Raeume je Projekt: key -> { root, figs, sig, ... } */
  const stations = new Map();
  /** Aktuelle Daten je Figur fuer den Tooltip (zum Zeitpunkt des Zeigens). */
  const data = new Map();
  /** Figur unter dem Mauszeiger - ihr Tooltip folgt den Aktualisierungen. */
  let hovered = null;
  /** Bereits gefeierte Commits/Pushes - jeder nur einmal, und nur frische. */
  const celebrated = new Set();

  const celebrate = (st, figId, c) => {
    if (!c?.id || celebrated.has(c.id)) return;
    celebrated.add(c.id);
    // Beim ersten Laden der Seite liegen aeltere Commits vor - die nicht.
    if (c.at == null || Date.now() - c.at > CELEBRATE_FRESH_MS) return;
    const f = st.figs.get(figId);
    if (!f) return;
    f.fig.dataset.celebrate = c.kind;
    setTimeout(() => {
      if (f.fig.dataset.celebrate === c.kind) delete f.fig.dataset.celebrate;
    }, 3600);
  };

  // Im Hintergrund-Tab sieht niemand zu: Animationen anhalten (CSS ueber die
  // Klasse, die Papierflieger laufen per SMIL und brauchen pauseAnimations).
  const syncPause = () => {
    const hidden = document.hidden;
    container.classList.toggle('paused', hidden);
    for (const st of stations.values()) {
      if (hidden) st.svg.pauseAnimations?.();
      else st.svg.unpauseAnimations?.();
    }
  };
  document.addEventListener('visibilitychange', syncPause);

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

  function render(activity, env = {}) {
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
        if (document.hidden) st.svg.pauseAnimations?.();
      }
      applyOffice(st, p, ctx, env);
      for (const s of p.sessions) {
        celebrate(st, s.sessionId, s.celebration);
        for (const a of s.agents) celebrate(st, a.id, a.celebration);
      }
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
    for (const st of stations.values()) {
      applyTime(st, timeZone());
      applyCalendar(st, timeZone());
    }
  }

  return { render, tick };
}
