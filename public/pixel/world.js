/*
 * Pixel-Buero, ohne DOM: wie das Gebaeude aufgebaut ist, wie Figuren darin
 * laufen und was jede Figur gerade zeigt. Der Renderer (office.js) zeichnet
 * danach. Masse in Kacheln zu 16 Pixeln; Pixel sind Originalpixel der
 * Grafiken (angezeigt meist dreifach).
 *
 * Grundriss: oben die Aussenwand mit dem Eingang, darunter ein Flur. Vom Flur
 * fuehrt in jeden Raum eine Tuer in dessen Rueckwand: zuerst die gemeinsame
 * Kueche, dann je Projekt ein Raum, getrennt durch Waende. Passen nicht alle
 * Raeume nebeneinander, folgt darunter die naechste Reihe mit eigenem Flur;
 * ein Laengsflur am linken Rand verbindet die Flure.
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
/** Waende von vorn gesehen (Aussenwand, Rueckwand jedes Raums): zwei Kacheln hoch. */
export const WALL_ROWS = 2;
/** Seitenwaende und Trennwaende: so dick (Pixel). */
export const SIDE_PX = 4;
/** Laengsflur am linken Rand. */
export const SPINE = 2;
const CORRIDOR_ROWS = 2;
export const KITCHEN = 'kitchen';
const KITCHEN_COLS = 8;
const KITCHEN_ROWS = 4;
const MIN_ROOM_COLS = 7;
/** Tuer eines Projektraums: zweite Spalte, daneben das Namensschild. */
const ROOM_DOOR = 1;
const MAIN_SEAT_ROW = 1;
/** Erste Subagent-Reihe: vor dem Haupttisch ein Laufweg und ein Gang. */
const FIRST_AGENT_ROW = MAIN_SEAT_ROW + 4;
/** Sitzreihe, Tisch, Gang. */
const AGENT_ROW_STEP = 3;
const AGENTS_PER_ROW = 4;
/** Kacheln je Subagent-Platz (Tisch 2 breit, dazwischen Luft). */
const AGENT_SLOT = 3;
const MAIN_SLOT = 5;

/* --- Gebaeude ---------------------------------------------------------------- */

/** Aendert sich das, wird das Gebaeude neu aufgebaut. */
export function buildingSignature(projects) {
  return JSON.stringify(
    projects.map((p) => [p.key, p.sessions.map((s) => [s.sessionId, orderAgents(s.agents ?? []).map((a) => a.id)])]),
  );
}

function sessionBlocks(project) {
  return project.sessions.map((s) => {
    const agents = orderAgents(s.agents ?? []);
    const perRow = Math.min(AGENTS_PER_ROW, Math.max(1, agents.length));
    return {
      s,
      agents,
      width: Math.max(MAIN_SLOT, perRow * AGENT_SLOT + 1),
      rows: Math.ceil(agents.length / AGENTS_PER_ROW),
    };
  });
}

/** Innenmass eines Projektraums (ohne Rueckwand), so klein wie moeglich. */
function roomSize(project) {
  const blocks = sessionBlocks(project);
  const used = blocks.reduce((n, b) => n + b.width, 0);
  const agentRows = Math.max(0, ...blocks.map((b) => b.rows));
  const lastSeat = agentRows ? FIRST_AGENT_ROW + (agentRows - 1) * AGENT_ROW_STEP : MAIN_SEAT_ROW;
  // Tisch belegt Sitzreihe und die naechste, davor ein Laufweg.
  return { blocks, used, cols: Math.max(MIN_ROOM_COLS, used + 2), rows: lastSeat + 3 };
}

/**
 * Das ganze Gebaeude. maxCols begrenzt die Breite (in Kacheln); breitere
 * Raeume bekommen trotzdem ihre Reihe.
 *
 * Ergebnis (Kacheln, wenn nicht anders gesagt):
 *   cols, rows, entrance {col,row} (Tuer in der Aussenwand), entry (Flur davor),
 *   rooms [{ key, kind, label, project, c0, r0, cols, rows, face, door, band }],
 *   bands [{ corridor, face, top, rows }], kitchen { counter, fridge, cooler, coffee, water },
 *   seats [{ id, kind, owner, room, col, row, desk }], rugs [{col,row,w,h}],
 *   doors [{ key, col, row, kind }], faces [{ row, c0, c1, style }],
 *   dividers [{ col, r0, r1 }] (Wand links der Spalte), ledges [{ row, c0, c1 }] (Wand unter der Reihe),
 *   blocked, wallE, wallS (Uint8Array je Kachel), floor [Name je Kachel oder null]
 */
export function layoutBuilding(projects, maxCols = Infinity) {
  const units = [
    { kind: 'kitchen', key: KITCHEN, cols: KITCHEN_COLS, rows: KITCHEN_ROWS },
    ...projects.map((p) => ({ kind: 'project', key: p.key, project: p, ...roomSize(p) })),
  ];
  const cap = Math.max(maxCols - SPINE, ...units.map((u) => u.cols));
  const bands = [];
  for (const u of units) {
    const last = bands[bands.length - 1];
    if (last && last.width + u.cols <= cap) {
      last.units.push(u);
      last.width += u.cols;
    } else {
      bands.push({ units: [u], width: u.cols });
    }
  }
  const inner = Math.max(...bands.map((b) => b.width));
  const cols = SPINE + inner;
  let row = WALL_ROWS;
  for (const b of bands) {
    b.corridor = row;
    b.face = row + CORRIDOR_ROWS;
    b.top = b.face + WALL_ROWS;
    b.rows = Math.max(...b.units.map((u) => u.rows));
    row = b.top + b.rows;
    // Die Restbreite teilen sich die Raeume der Reihe.
    const extra = inner - b.width;
    const share = Math.floor(extra / b.units.length);
    for (const u of b.units) u.cols += share;
    b.units[b.units.length - 1].cols += extra - share * b.units.length;
  }
  const rows = row;

  const at = (c, r) => r * cols + c;
  const blocked = new Uint8Array(cols * rows);
  const wallE = new Uint8Array(cols * rows);
  const wallS = new Uint8Array(cols * rows);
  const floor = new Array(cols * rows).fill(null);
  const block = (c, r) => {
    if (c >= 0 && c < cols && r >= 0 && r < rows) blocked[at(c, r)] = 1;
  };
  const open = (c, r) => {
    blocked[at(c, r)] = 0;
  };

  const L = {
    cols,
    rows,
    entrance: { col: 1, row: WALL_ROWS - 1 },
    entry: { col: 1, row: WALL_ROWS },
    rooms: [],
    bands: bands.map(({ corridor, face, top, rows: h }) => ({ corridor, face, top, rows: h })),
    kitchen: null,
    seats: [],
    rugs: [],
    doors: [],
    faces: [],
    dividers: [],
    ledges: [],
    blocked,
    wallE,
    wallS,
    floor,
  };

  // Aussenwand mit dem Eingang.
  for (let r = 0; r < WALL_ROWS; r++) for (let c = 0; c < cols; c++) block(c, r);
  for (let r = 0; r < WALL_ROWS; r++) open(L.entrance.col, r);
  L.faces.push({ row: 0, c0: 0, c1: cols - 1, style: 'plain' });
  L.doors.push({ key: 'entrance', col: L.entrance.col, row: 0, kind: 'glass' });

  bands.forEach((b, bi) => {
    // Flur ueber die ganze Breite; links laeuft der Laengsflur weiter.
    for (let r = b.corridor; r < b.top + b.rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (r < b.face || c < SPINE) floor[at(c, r)] = 'hallway';
        else if (r < b.top) block(c, r); // Rueckwaende der Raeume
      }
    }
    let x = SPINE;
    for (const u of b.units) {
      const room = {
        key: u.key,
        kind: u.kind,
        label: u.project?.label ?? 'Küche',
        project: u.project ?? null,
        c0: x,
        r0: b.top,
        cols: u.cols,
        rows: b.rows,
        face: b.face,
        band: bi,
        door: { col: x + (u.kind === 'kitchen' ? KITCHEN_COLS - 1 : ROOM_DOOR), row: b.face },
      };
      L.rooms.push(room);
      L.faces.push({ row: b.face, c0: x, c1: x + u.cols - 1, style: 'wainscot' });
      L.doors.push({ key: u.key, col: room.door.col, row: b.face, kind: 'wood' });
      for (let r = b.face; r < b.top; r++) open(room.door.col, r);
      // Wand zum Nachbarn (bzw. zum Laengsflur) links.
      for (let r = b.top; r < b.top + b.rows; r++) wallE[at(x - 1, r)] = 1;
      L.dividers.push({ col: x, r0: b.top, r1: b.top + b.rows });
      for (let r = b.top; r < b.top + b.rows; r++) {
        for (let c = x; c < x + u.cols; c++) {
          floor[at(c, r)] = u.kind === 'kitchen' ? 'kitchen' : (c + r) % 2 ? 'wood-a' : 'wood-b';
        }
      }
      if (u.kind === 'kitchen') furnishKitchen(L, room, block);
      else furnishRoom(L, room, u, block);
      x += u.cols;
    }
    // Unten schliesst eine Wand die Reihe ab; nur der Laengsflur geht weiter.
    const last = bi === bands.length - 1;
    const bottom = b.top + b.rows - 1;
    if (!last) for (let c = SPINE; c < cols; c++) wallS[at(c, bottom)] = 1;
    L.ledges.push({ row: bottom, c0: last ? 0 : SPINE, c1: cols - 1 });
  });
  return L;
}

/** Theke mit Espressomaschine, Kuehlschrank und Wasserspender an der Rueckwand. */
function furnishKitchen(L, room, block) {
  const r = room.r0;
  const c = room.c0;
  L.kitchen = {
    counter: { col: c + 1, row: r },
    fridge: { col: c + 4, row: r },
    cooler: { col: c + 5, row: r },
    coffee: { col: c + 2, row: r + 1 },
    water: { col: c + 5, row: r + 1 },
  };
  for (let x = c + 1; x <= c + 5; x++) block(x, r);
}

/**
 * Sitzungen nebeneinander an grossen Tischen, ihre Subagents in Reihen davor
 * an kleinen Tischen auf einem Teppich.
 */
function furnishRoom(L, room, u, block) {
  // Ein Tisch sperrt die Kacheln neben dem Sitz und die ganze Reihe davor.
  const desk = (col, row) => {
    block(col - 1, row);
    block(col + 1, row);
    for (let c = col - 1; c <= col + 1; c++) block(c, row + 1);
  };
  let x = room.c0 + Math.floor((room.cols - u.used) / 2);
  let rug = null;
  for (const b of u.blocks) {
    const mainCol = x + Math.floor(b.width / 2);
    const mainRow = room.r0 + MAIN_SEAT_ROW;
    L.seats.push({ id: b.s.sessionId, kind: 'session', owner: null, room: room.key, col: mainCol, row: mainRow, desk: 'desk-large' });
    desk(mainCol, mainRow);
    b.agents.forEach((a, i) => {
      const r = Math.floor(i / AGENTS_PER_ROW);
      const inRow = Math.min(AGENTS_PER_ROW, b.agents.length - r * AGENTS_PER_ROW);
      const col = x + Math.floor((b.width - inRow * AGENT_SLOT) / 2) + 1 + (i % AGENTS_PER_ROW) * AGENT_SLOT;
      const row = room.r0 + FIRST_AGENT_ROW + r * AGENT_ROW_STEP;
      L.seats.push({ id: a.id, kind: 'agent', owner: b.s.sessionId, room: room.key, col, row, desk: 'desk-small' });
      desk(col, row);
      rug = rug
        ? { c0: Math.min(rug.c0, col - 2), c1: Math.max(rug.c1, col + 2), r1: Math.max(rug.r1, row + 2) }
        : { c0: col - 2, c1: col + 2, r1: row + 2 };
    });
    x += b.width;
  }
  if (rug) {
    const c0 = Math.max(room.c0, rug.c0);
    const c1 = Math.min(room.c0 + room.cols - 1, rug.c1);
    const r0 = room.r0 + FIRST_AGENT_ROW - 1;
    const r1 = Math.min(room.r0 + room.rows - 1, rug.r1);
    L.rugs.push({ col: c0, row: r0, w: c1 - c0 + 1, h: r1 - r0 + 1 });
  }
}

export function walkable(L, col, row) {
  return col >= 0 && col < L.cols && row >= 0 && row < L.rows && !L.blocked[row * L.cols + col];
}

/** Ein Schritt zur Nachbarkachel: frei und keine Wand dazwischen. */
function canStep(L, c, r, dc, dr) {
  const nc = c + dc;
  const nr = r + dr;
  if (!walkable(L, nc, nr)) return false;
  if (dc === 1 && L.wallE[r * L.cols + c]) return false;
  if (dc === -1 && L.wallE[r * L.cols + nc]) return false;
  if (dr === 1 && L.wallS[r * L.cols + c]) return false;
  if (dr === -1 && L.wallS[nr * L.cols + c]) return false;
  return true;
}

/**
 * Kuerzester Weg auf dem Kachelraster (vier Richtungen, nicht durch Waende),
 * ohne Start, mit Ziel. [] wenn schon da, null wenn unerreichbar.
 */
export function findPath(L, from, to) {
  if (from.col === to.col && from.row === to.row) return [];
  if (!walkable(L, to.col, to.row)) return null;
  const { cols, rows } = L;
  if (from.col < 0 || from.col >= cols || from.row < 0 || from.row >= rows) return null;
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
      if (!canStep(L, c, r, dc, dr)) continue;
      const n = (r + dr) * cols + (c + dc);
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

/** Raum, in dem eine Kachel liegt (null: Flur oder Wand). */
export function roomAt(L, col, row) {
  return L.rooms.find((r) => col >= r.c0 && col < r.c0 + r.cols && row >= r.r0 && row < r.r0 + r.rows) ?? null;
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

/* --- Licht -------------------------------------------------------------------- */

const NIGHT = [38, 43, 68]; // #262b44
const DUSK = [104, 56, 108]; // #68386c
const DAWN = [190, 74, 47]; // #be4a2f
const NIGHT_A = 0.62;
const DUSK_A = 0.34;

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/**
 * Wie dunkel es im Buero ist (Stunde 0-24, Ortszeit): { rgb, a }. Tagsueber
 * hell, abends violett, nachts dunkelblau, morgens kurz rot. Lampen und
 * Bildschirme stanzen ihr Licht hinein.
 */
export function daylight(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 7 && h < 17) return { rgb: NIGHT, a: 0 };
  if (h >= 17 && h < 19.5) return { rgb: DUSK, a: (DUSK_A * (h - 17)) / 2.5 };
  if (h >= 19.5 && h < 21) {
    const t = (h - 19.5) / 1.5;
    return { rgb: mix(DUSK, NIGHT, t), a: DUSK_A + (NIGHT_A - DUSK_A) * t };
  }
  if (h >= 5.5 && h < 7) {
    const t = (h - 5.5) / 1.5;
    return { rgb: mix(NIGHT, DAWN, t), a: NIGHT_A * (1 - t) };
  }
  return { rgb: NIGHT, a: NIGHT_A };
}

/** Deckenlampen im Flur: alle paar Kacheln eine, mittig in jedem Flur und im Laengsflur. */
export function corridorLights(L, every = 5) {
  const out = [];
  for (const b of L.bands) {
    for (let c = 2; c < L.cols; c += every) out.push({ x: c * TILE + TILE / 2, y: (b.corridor + 1) * TILE });
  }
  for (let r = L.bands[0].corridor + every; r < L.rows; r += every) out.push({ x: TILE, y: r * TILE });
  return out;
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
