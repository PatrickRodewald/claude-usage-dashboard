/*
 * Pixel-Buero, ohne DOM: wie ein Raum aufgebaut ist, wie Figuren darin
 * laufen und was jede Figur gerade zeigt. Der Renderer (office.js) zeichnet
 * danach. Masse in Kacheln zu 16 Pixeln; Pixel sind Originalpixel der
 * Grafiken (angezeigt meist dreifach).
 */

import {
  toolActivity,
  toolLabel,
  orderAgents,
  ERRAND_IDLE_MS,
  PACE_AFTER_MS,
  VISIT_AFTER_MS,
} from '../agents.js';

export const TILE = 16;
/** Rueckwand: zwei Kacheln hoch, der Boden beginnt darunter. */
export const WALL_ROWS = 2;
/** Seitenwaende: so dick (Pixel) links und rechts neben dem Boden. */
export const SIDE_PX = 4;

const DOOR_COL = 1;
/** Kaffeeecke an der Rueckwand: Theke (3 breit), Kuehlschrank, Wasserspender. */
const COUNTER_COL = 3;
const FRIDGE_COL = 6;
const COOLER_COL = 7;
const MIN_COLS = 14;
const MAIN_SEAT_ROW = 5;
/** Erste Subagent-Reihe: hinter dem Haupttisch ein Laufweg und ein Gang. */
const FIRST_AGENT_ROW = MAIN_SEAT_ROW + 4;
/** Sitzreihe, Tisch, Gang. */
const AGENT_ROW_STEP = 3;
const AGENTS_PER_ROW = 4;
/** Kacheln je Subagent-Platz (Tisch 2 breit, dazwischen Luft). */
const AGENT_SLOT = 3;
const MAIN_SLOT = 5;

/* --- Raum ------------------------------------------------------------------ */

/** Aendert sich das, wird der Raum neu aufgebaut. */
export function roomSignature(project) {
  return JSON.stringify(project.sessions.map((s) => [s.sessionId, orderAgents(s.agents ?? []).map((a) => a.id)]));
}

/**
 * Raum fuer ein Projekt: Sitzungen nebeneinander an grossen Tischen, ihre
 * Subagents in Reihen darunter an kleinen Tischen auf einem Teppich.
 *
 * Ergebnis (alles in Kacheln):
 *   cols, rows, door {col,row}, entry {col,row},
 *   kitchen { counter, fridge, cooler, coffee, water } (je {col,row}),
 *   seats [{ id, kind, owner, col, row, desk }], rug {col,row,w,h} | null,
 *   blocked Uint8Array (1 = nicht begehbar), floor [name je Kachel]
 */
export function layoutRoom(project) {
  const blocks = project.sessions.map((s) => {
    const agents = orderAgents(s.agents ?? []);
    const perRow = Math.min(AGENTS_PER_ROW, Math.max(1, agents.length));
    return {
      s,
      agents,
      width: Math.max(MAIN_SLOT, perRow * AGENT_SLOT + 1),
      rows: Math.ceil(agents.length / AGENTS_PER_ROW),
    };
  });
  const used = blocks.reduce((n, b) => n + b.width, 0);
  const cols = Math.max(MIN_COLS, used + 2);
  const agentRows = Math.max(0, ...blocks.map((b) => b.rows));
  const lastSeatRow = agentRows ? FIRST_AGENT_ROW + (agentRows - 1) * AGENT_ROW_STEP : MAIN_SEAT_ROW;
  // Tisch belegt Sitzreihe und die naechste, davor ein Laufweg.
  const rows = Math.max(lastSeatRow + 3, MAIN_SEAT_ROW + 4);

  const blocked = new Uint8Array(cols * rows);
  const block = (c, r) => {
    if (c >= 0 && c < cols && r >= 0 && r < rows) blocked[r * cols + c] = 1;
  };
  // Rueckwand ganz, nur die Tuer ist ein Durchgang.
  for (let r = 0; r < WALL_ROWS; r++) for (let c = 0; c < cols; c++) block(c, r);
  const door = { col: DOOR_COL, row: WALL_ROWS - 1 };
  blocked[door.row * cols + door.col] = 0;

  const kitchen = {
    counter: { col: COUNTER_COL, row: WALL_ROWS },
    fridge: { col: FRIDGE_COL, row: WALL_ROWS },
    cooler: { col: COOLER_COL, row: WALL_ROWS },
    coffee: { col: COUNTER_COL + 1, row: WALL_ROWS + 1 },
    water: { col: COOLER_COL, row: WALL_ROWS + 1 },
  };
  for (let c = COUNTER_COL; c < COUNTER_COL + 3; c++) block(c, WALL_ROWS);
  block(FRIDGE_COL, WALL_ROWS);
  block(COOLER_COL, WALL_ROWS);

  const seats = [];
  // Ein Tisch sperrt die Kacheln neben dem Sitz und die ganze Reihe davor.
  const desk = (col, row) => {
    block(col - 1, row);
    block(col + 1, row);
    for (let c = col - 1; c <= col + 1; c++) block(c, row + 1);
  };
  let x = Math.floor((cols - used) / 2);
  let rug = null;
  for (const b of blocks) {
    const mainCol = x + Math.floor(b.width / 2);
    seats.push({ id: b.s.sessionId, kind: 'session', owner: null, col: mainCol, row: MAIN_SEAT_ROW, desk: 'desk-large' });
    desk(mainCol, MAIN_SEAT_ROW);
    b.agents.forEach((a, i) => {
      const r = Math.floor(i / AGENTS_PER_ROW);
      const inRow = Math.min(AGENTS_PER_ROW, b.agents.length - r * AGENTS_PER_ROW);
      const col = x + Math.floor((b.width - inRow * AGENT_SLOT) / 2) + 1 + (i % AGENTS_PER_ROW) * AGENT_SLOT;
      const row = FIRST_AGENT_ROW + r * AGENT_ROW_STEP;
      seats.push({ id: a.id, kind: 'agent', owner: b.s.sessionId, col, row, desk: 'desk-small' });
      desk(col, row);
      const c0 = col - 2;
      const c1 = col + 2;
      rug = rug ? { c0: Math.min(rug.c0, c0), c1: Math.max(rug.c1, c1) } : { c0, c1 };
    });
    x += b.width;
  }
  if (rug) {
    const c0 = Math.max(0, rug.c0);
    const c1 = Math.min(cols - 1, rug.c1);
    rug = { col: c0, row: FIRST_AGENT_ROW - 1, w: c1 - c0 + 1, h: lastSeatRow + 2 - (FIRST_AGENT_ROW - 1) + 1 };
  }

  const floor = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r < WALL_ROWS) floor.push(null);
      else if (r <= WALL_ROWS + 1 && c >= COUNTER_COL - 1 && c <= COOLER_COL + 1) floor.push('kitchen');
      else floor.push((c + r) % 2 ? 'wood-a' : 'wood-b');
    }
  }

  return {
    cols,
    rows,
    door,
    entry: { col: door.col, row: WALL_ROWS },
    kitchen,
    seats,
    rug,
    blocked,
    floor,
  };
}

export function walkable(room, col, row) {
  return col >= 0 && col < room.cols && row >= 0 && row < room.rows && !room.blocked[row * room.cols + col];
}

/**
 * Kuerzester Weg auf dem Kachelraster (vier Richtungen), ohne Start, mit
 * Ziel. [] wenn schon da, null wenn unerreichbar.
 */
export function findPath(room, from, to) {
  if (from.col === to.col && from.row === to.row) return [];
  if (!walkable(room, to.col, to.row)) return null;
  const { cols, rows } = room;
  const prev = new Int32Array(cols * rows).fill(-1);
  const start = from.row * cols + from.col;
  const goal = to.row * cols + to.col;
  prev[start] = start;
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    if (cur === goal) break;
    const c = cur % cols;
    const r = (cur - c) / cols;
    for (const [dc, dr] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const nc = c + dc;
      const nr = r + dr;
      if (!walkable(room, nc, nr)) continue;
      const n = nr * cols + nc;
      if (prev[n] !== -1) continue;
      prev[n] = cur;
      queue.push(n);
    }
  }
  if (prev[goal] === -1) return null;
  const path = [];
  for (let n = goal; n !== start; n = prev[n]) path.push({ col: n % cols, row: Math.floor(n / cols) });
  return path.reverse();
}

/** Fusspunkt (Pixel) einer Figur auf einer Kachel: unten mittig. */
export function feetOf(tile) {
  return { x: tile.col * TILE + TILE / 2, y: tile.row * TILE + TILE };
}

/** Kachel unter einem Fusspunkt. */
export function tileAt(x, y) {
  return { col: Math.floor(x / TILE), row: Math.floor((y - 1) / TILE) };
}

/** Blickrichtung fuer einen Schritt: front, back, right oder left. */
export function facing(dx, dy, fallback = 'front') {
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return fallback;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'front' : 'back';
}

/* --- Was eine Figur zeigt ------------------------------------------------------ */

/** Haltung am Tisch je Taetigkeit: Buch, Block oder Laptop. */
const POSE = {
  read: 'read',
  search: 'read',
  web: 'read',
  write: 'write',
  todo: 'write',
  shell: 'type',
  test: 'type',
  tool: 'type',
  delegate: 'type',
  think: 'think',
};

export function poseFor(activity) {
  return POSE[activity] ?? 'type';
}

function clip(text, max) {
  const t = String(text ?? '');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Text der Sprechblase: Werkzeug und woran es arbeitet. Shell-Befehle als
 * Prompt, Auftraege an Subagents mit Pfeil.
 */
export function speechText(tool, target, max = 28) {
  const activity = toolActivity(tool);
  if (target && (activity === 'shell' || activity === 'test')) return clip(`$ ${target}`, max);
  if (activity === 'delegate') return clip(target ? `→ ${target}` : 'delegiert', max);
  const label = toolLabel(tool);
  return clip(target ? `${label} ${target}` : label, max);
}

/** Zustand der Hauptfigur einer Sitzung (wie im SVG-Buero). */
export function sessionState(s) {
  if (s.status === 'idle') return 'idle';
  if (s.status === 'stale') return 'stale';
  if (s.status !== 'busy') return 'other';
  return s.doing?.kind === 'tool' || s.doing?.kind === 'delegating' ? s.doing.kind : 'thinking';
}

export function agentState(a) {
  if (a.state !== 'running') return a.state; // completed | failed | stopped
  return a.tool ? 'tool' : 'thinking';
}

const FINISH = { completed: 'done', failed: 'error' };

/**
 * Was eine Figur zeigt: { state, pose, speech, thought, emote, sleep, lamp,
 * leaving, finish }. pose: type | read | write | think | sleep.
 * limit: 'reached' heisst Zwangspause fuer alle.
 */
export function figureView(kind, item, { limit } = {}) {
  const v = { state: 'other', pose: 'type', speech: null, thought: false, emote: null, sleep: false, lamp: true, leaving: false, finish: null };
  if (kind === 'session') {
    v.state = sessionState(item);
    if (v.state === 'idle') Object.assign(v, { pose: 'sleep', sleep: true, lamp: false });
    else if (v.state === 'stale') Object.assign(v, { pose: 'think', emote: 'question' });
    else if (v.state === 'tool') {
      v.pose = poseFor(toolActivity(item.doing.tool, item.doing.detail));
      v.speech = speechText(item.doing.tool, item.doing.target);
    } else if (v.state === 'delegating') {
      v.speech = speechText(item.doing.tool ?? 'Agent', item.doing.target);
    } else if (v.state === 'thinking') Object.assign(v, { pose: 'think', thought: true });
    else v.speech = clip(item.status, 12);
  } else {
    v.state = agentState(item);
    if (v.state === 'tool') {
      v.pose = poseFor(toolActivity(item.tool, item.toolDetail));
      v.speech = speechText(item.tool, item.toolTarget, 18);
    } else if (v.state === 'thinking') Object.assign(v, { pose: 'think', thought: true });
    else Object.assign(v, { leaving: true, finish: FINISH[v.state] ?? null, lamp: false });
  }
  // Limit erreicht: niemand kann arbeiten - alle warten.
  if (limit === 'reached' && !v.leaving) Object.assign(v, { pose: 'sleep', speech: null, thought: false, emote: 'waiting', sleep: false });
  return v;
}

/* --- Treiben ------------------------------------------------------------------ */

/**
 * Welche Besorgungen eine Figur im Pixel-Buero machen kann: { rate (Chance je
 * Sekunde), options: [[name, gewicht], ...] } oder null.
 * fig = { kind, state, stateMs }, room = { agentsRunning }.
 */
export function pixelErrands(fig, room = {}) {
  if (fig.kind === 'session' && fig.state === 'idle') {
    if (!(fig.stateMs >= ERRAND_IDLE_MS)) return null;
    return {
      rate: 1 / 12,
      options: [
        ['coffee', 3],
        ['water', 2],
        ['stroll', 2],
      ],
    };
  }
  if (fig.state === 'thinking' && fig.stateMs >= PACE_AFTER_MS) return { rate: 1 / 8, options: [['pace', 1]] };
  if (fig.kind === 'session' && fig.state === 'delegating' && room.agentsRunning > 0 && fig.stateMs >= VISIT_AFTER_MS) {
    return { rate: 1 / 12, options: [['visit', 1]] };
  }
  return null;
}

/* --- Zeichnen ----------------------------------------------------------------- */

/** Bild einer Animation nach verstrichener Zeit. */
export function frameIndex(anim, elapsedMs) {
  const n = anim.frames ?? anim.states.length;
  const i = Math.floor(Math.max(0, elapsedMs) / anim.frameDurationMs);
  return anim.loop === false ? Math.min(n - 1, i) : i % n;
}

/**
 * Groesster ganzzahliger Massstab (Geraetepixel je Grafikpixel), bei dem der
 * Raum in die verfuegbare Breite passt - hoechstens preferred CSS-Pixel je
 * Grafikpixel. Ganzzahlig, damit jedes Pixel gleich gross bleibt.
 */
export function pixelScale(logicalWidth, availableCss, dpr = 1, preferred = 3) {
  const max = Math.max(1, Math.round(preferred * dpr));
  const fit = Math.floor((availableCss * dpr) / logicalWidth);
  return Math.max(1, Math.min(max, fit));
}

/** Kleidungsfarben: Schluesselfarben der Figurenblaetter und Ersatz je Farbe. */
export const KEY_COLORS = ['#2ce8f5', '#0099db', '#124e89'];
export const OUTFITS = {
  blue: ['#2ce8f5', '#0099db', '#124e89'],
  green: ['#63c74d', '#3e8948', '#265c42'],
  red: ['#f6757a', '#e43b44', '#a22633'],
  orange: ['#feae34', '#f77622', '#be4a2f'],
  purple: ['#b55088', '#68386c', '#3e2731'],
  grey: ['#c0cbdc', '#8b9bb4', '#5a6988'],
  brown: ['#e4a672', '#b86f50', '#733e39'],
  yellow: ['#fee761', '#feae34', '#be4a2f'],
};

/** Farbe je Subagent-Typ; Unbekannte stabil aus den uebrigen. */
const TYPE_OUTFIT = { 'general-purpose': 'green', Explore: 'orange', Plan: 'purple', 'claude-code-guide': 'grey' };
const SPARE_OUTFITS = ['red', 'brown', 'yellow', 'blue'];
const SESSION_OUTFITS = ['blue', 'red', 'purple', 'green', 'orange', 'brown'];

function hash(text) {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h;
}

export function outfitFor(kind, item) {
  if (kind === 'agent') return TYPE_OUTFIT[item.type] ?? SPARE_OUTFITS[hash(item.type) % SPARE_OUTFITS.length];
  return SESSION_OUTFITS[hash(item.sessionId) % SESSION_OUTFITS.length];
}
