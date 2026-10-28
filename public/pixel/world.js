/*
 * Pixel-Buero, ohne DOM: wie das Gebaeude aufgebaut ist, wie Figuren darin
 * laufen und was jede Figur gerade zeigt. Der Renderer (office.js) zeichnet
 * danach. Masse in Kacheln zu 16 Pixeln; Pixel sind Originalpixel der
 * Grafiken (angezeigt meist dreifach).
 *
 * Grundriss: oben die Aussenwand mit dem Eingang, darunter ein Flur. Vom Flur
 * fuehrt in jeden Raum eine Tuer in dessen Rueckwand: zuerst die gemeinsame
 * Kueche mit Lounge, dann je Projekt ein Raum, getrennt durch Waende. Passen
 * nicht alle Raeume nebeneinander, folgt darunter die naechste Reihe mit
 * eigenem Flur; ein Laengsflur am linken Rand verbindet die Flure.
 *
 * Eingerichtet wird danach: Regale, Pflanzen, Drucker und Lampen an Waende
 * und in Ecken, Bilder und Fenster an die Waende - immer so, dass jeder Platz
 * erreichbar bleibt. Gleiche Raeume bekommen stets die gleiche Einrichtung.
 */

import { toolActivity, toolLabel, orderAgents, clip, sessionState, agentState, errandsFor } from '../agents.js';

export const TILE = 16;
/** Waende von vorn gesehen (Aussenwand, Rueckwand jedes Raums): zwei Kacheln hoch. */
export const WALL_ROWS = 2;
/** Seitenwaende und Trennwaende: so dick (Pixel). */
export const SIDE_PX = 4;
/** Laengsflur am linken Rand. */
export const SPINE = 2;
const CORRIDOR_ROWS = 2;
export const KITCHEN = 'kitchen';
/** Kueche vorn, Lounge mit Sofa und Kicker dahinter. */
const KITCHEN_COLS = 10;
const KITCHEN_ROWS = 5;
const MIN_ROOM_COLS = 7;
/** Tuer eines Projektraums: zweite Spalte, daneben das Namensschild. */
const ROOM_DOOR = 1;
/** So viele Spalten neben der Tuer gehoeren dem Namensschild. */
export const PLATE_COLS = 4;
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

/**
 * Raeume in fester Reihenfolge (nach Name): der Server stellt arbeitende
 * Projekte nach vorn - das Gebaeude soll deshalb nicht umgebaut werden.
 */
function inOrder(projects) {
  return [...projects].sort((a, b) => String(a.label ?? '').localeCompare(String(b.label ?? ''), 'de') || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Aendert sich das, wird das Gebaeude neu aufgebaut. */
export function buildingSignature(projects) {
  return JSON.stringify(
    inOrder(projects).map((p) => [p.key, p.sessions.map((s) => [s.sessionId, orderAgents(s.agents ?? []).map((a) => a.id)])]),
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
 *   items [{ name, col, row, w, kind? }] (Moebel; col/row: Kachel links unten),
 *   wall [{ name, x, y, kind, room? }] (Wandschmuck, Pixel), mats [{ name, col, row }] (flach am Boden),
 *   lounge { sofa: [{ x, y, from }], kicker: { left, right } },
 *   blocked, wallE, wallS (Uint8Array je Kachel), floor [Name je Kachel oder null]
 */
export function layoutBuilding(projects, maxCols = Infinity) {
  const units = [
    { kind: 'kitchen', key: KITCHEN, cols: KITCHEN_COLS, rows: KITCHEN_ROWS },
    ...inOrder(projects).map((p) => ({ kind: 'project', key: p.key, project: p, ...roomSize(p) })),
  ];
  const cap = Math.max(maxCols - SPINE, ...units.map((u) => u.cols));
  // Jeder Raum in die erste Reihe, in der er noch Platz hat.
  const bands = [];
  for (const u of units) {
    const band = bands.find((b) => b.width + u.cols <= cap);
    if (band) {
      band.units.push(u);
      band.width += u.cols;
    } else {
      bands.push({ units: [u], width: u.cols });
    }
  }
  const inner = Math.max(...bands.map((b) => b.width));
  const cols = SPINE + inner;
  // Viel Platz uebrig (eine Reihe ist kuerzer als die breiteste): dort eine
  // Lounge, statt die Raeume leer in die Breite zu ziehen.
  bands.forEach((b, bi) => {
    const extra = inner - b.width;
    if (extra < MIN_ROOM_COLS) return;
    b.units.push({ kind: 'lounge', key: `lounge-${bi}`, cols: extra, rows: 0 });
    b.width = inner;
  });
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
    items: [],
    wall: [],
    mats: [],
    lounge: null,
    blocked,
    wallE,
    wallS,
    floor,
    /** Schon eingerichtet oder freizuhalten (Plaetze, Tueren, Laufwege). */
    used: new Uint8Array(cols * rows),
  };

  // Aussenwand mit dem Eingang.
  for (let r = 0; r < WALL_ROWS; r++) for (let c = 0; c < cols; c++) block(c, r);
  for (let r = 0; r < WALL_ROWS; r++) open(L.entrance.col, r);
  L.faces.push({ row: 0, c0: 0, c1: cols - 1, style: 'brick' });
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
      const style =
        u.kind === 'kitchen'
          ? { wall: 'plain', floor: 'kitchen' }
          : u.kind === 'lounge'
            ? { wall: 'brick', floor: 'carpet-wine' }
            : ROOM_STYLES[hash(u.key) % ROOM_STYLES.length];
      const room = {
        key: u.key,
        kind: u.kind,
        label: u.project?.label ?? (u.kind === 'kitchen' ? 'Küche' : 'Lounge'),
        project: u.project ?? null,
        c0: x,
        r0: b.top,
        cols: u.cols,
        rows: b.rows,
        face: b.face,
        band: bi,
        door: { col: x + (u.kind === 'kitchen' ? KITCHEN_COLS - 1 : ROOM_DOOR), row: b.face },
        style,
      };
      L.rooms.push(room);
      L.faces.push({ row: b.face, c0: x, c1: x + u.cols - 1, style: style.wall });
      L.doors.push({ key: u.key, col: room.door.col, row: b.face, kind: 'wood' });
      for (let r = b.face; r < b.top; r++) open(room.door.col, r);
      // Wand zum Nachbarn (bzw. zum Laengsflur) links.
      for (let r = b.top; r < b.top + b.rows; r++) wallE[at(x - 1, r)] = 1;
      L.dividers.push({ col: x, r0: b.top, r1: b.top + b.rows });
      for (let r = b.top; r < b.top + b.rows; r++) {
        for (let c = x; c < x + u.cols; c++) {
          floor[at(c, r)] = style.floor === 'wood' ? ((c + r) % 2 ? 'wood-a' : 'wood-b') : style.floor;
        }
      }
      if (u.kind === 'kitchen') furnishKitchen(L, room, block);
      else if (u.kind === 'project') furnishRoom(L, room, u, block);
      x += u.cols;
    }
    // Unten schliesst eine Wand die Reihe ab; nur der Laengsflur geht weiter.
    const last = bi === bands.length - 1;
    const bottom = b.top + b.rows - 1;
    if (!last) for (let c = SPINE; c < cols; c++) wallS[at(c, bottom)] = 1;
    L.ledges.push({ row: bottom, c0: last ? 0 : SPINE, c1: cols - 1 });
  });
  decorate(L);
  return L;
}

/** Wand und Boden eines Projektraums, fest je Projekt. */
const ROOM_STYLES = [
  { wall: 'wainscot', floor: 'wood' },
  { wall: 'green', floor: 'wood' },
  { wall: 'wood', floor: 'carpet-blue' },
  { wall: 'wainscot', floor: 'carpet-wine' },
  { wall: 'wood', floor: 'carpet-green' },
];

/**
 * Kueche an der Rueckwand: Automat, Theke mit Espressomaschine, Kuehlschrank,
 * Wasserspender, Spuele. Davor die Lounge: Kicker, Sofa mit Sessel, Couchtisch
 * und ein Esstisch mit Hockern.
 *
 *        0    1  2  3    4    5    6  7  8    9
 *   r    A    [Theke]    K    W    [Spuele]   (Tuer)
 *   r+1  .    .  C  .    .    W'   .  .  .    .        C, W' Kaffee und Wasser holen
 *   r+2  S    [Kicker]   S    [Sofa   ]  Ss   .        S: Spieler, Ss: Sessel
 *   r+3  .    .  .  .    .    .    .  .  .    .        hier setzt man sich aufs Sofa
 *   r+4  H    [Tisch]    H    .  [Couch]  L    P       H: Hocker, L: Stehlampe
 *
 * Ist die Kueche hoeher (die Reihe ist es), rueckt nur der Esstisch nach unten:
 * alles, wohin man geht, bleibt an seinem Platz - auch wenn umgebaut wird.
 */
function furnishKitchen(L, room, block) {
  const r = room.r0;
  const c = room.c0;
  const sofaRow = r + 2;
  const lowRow = r + 4;
  const tableRow = r + room.rows - 1;
  L.kitchen = {
    counter: { col: c + 1, row: r },
    fridge: { col: c + 4, row: r },
    cooler: { col: c + 5, row: r },
    coffee: { col: c + 2, row: r + 1 },
    water: { col: c + 5, row: r + 1 },
  };
  for (let x = c + 1; x <= c + 5; x++) block(x, r);
  const put = (name, col, row, kind, blocks = true) => {
    const w = widthOf(name);
    L.items.push({ name, col, row, w, ...(kind ? { kind } : {}) });
    for (let x = col; x < col + w; x++) {
      if (blocks) block(x, row);
      L.used[row * L.cols + x] = 1;
    }
  };
  put('vending-0', c, r, 'vending');
  put('counter-sink', c + 6, r, 'sink');
  put('kicker-0', c + 1, r + 2, 'kicker');
  put('sofa', c + 5, sofaRow, 'sofa');
  put('armchair', c + 8, sofaRow, 'armchair');
  put('stool', c, tableRow);
  put('kitchen-table', c + 1, tableRow, 'table');
  put('stool', c + 3, tableRow);
  put('coffee-table', c + 6, lowRow);
  put('floor-lamp-off', c + 8, lowRow, 'lamp');
  put('plant-palm', c + 9, lowRow);
  // Sitzplaetze: von der Reihe davor aus erreichbar.
  const seat = (col, dx) => ({
    x: col * TILE + dx,
    y: (sofaRow + 1) * TILE - 2,
    from: { col: col + Math.floor(dx / TILE), row: sofaRow + 1 },
  });
  L.lounge = {
    sofa: [seat(c + 5, 8), seat(c + 5, 40), seat(c + 8, 8)],
    kicker: { left: { col: c, row: r + 2 }, right: { col: c + 4, row: r + 2 } },
  };
  for (const t of [L.kitchen.coffee, L.kitchen.water, L.lounge.kicker.left, L.lounge.kicker.right, ...L.lounge.sofa.map((s) => s.from)]) {
    L.used[t.row * L.cols + t.col] = 1;
  }
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
  // Das Namensschild neben der Tuer: so breit, wie der Name es braucht.
  room.plateCols = Math.min(PLATE_COLS, Math.max(2, Math.ceil((room.label.length * 3 + 11) / TILE)));
}

/* --- Einrichtung ---------------------------------------------------------------- */

/** Moebel: Breite in Kacheln, Hoehe in Pixeln (wie im Atlas). */
export const FURNITURE = {
  'vending-0': [1, 32],
  'counter-sink': [3, 24],
  'kicker-0': [3, 24],
  sofa: [3, 32],
  armchair: [1, 24],
  stool: [1, 16],
  'kitchen-table': [2, 24],
  'coffee-table': [2, 16],
  'floor-lamp-off': [1, 32],
  'plant-tall': [1, 32],
  'plant-palm': [1, 32],
  'plant-bush': [1, 24],
  bookshelf: [2, 32],
  'bookshelf-low': [2, 24],
  'filing-cabinet': [1, 32],
  'coat-rack': [1, 32],
  'printer-idle': [1, 24],
  'server-0': [1, 32],
  'trash-bin': [1, 16],
  'trash-bin-full': [1, 16],
  beanbag: [1, 16],
};
const widthOf = (name) => FURNITURE[name]?.[0] ?? 1;
const heightOf = (name) => FURNITURE[name]?.[1] ?? 16;

/** Wandschmuck: Breite in Kacheln, Abstand von der Oberkante und Hoehe in Pixeln. */
export const WALL_ART = {
  window: [2, 3, 24],
  whiteboard: [3, 3, 24],
  corkboard: [2, 4, 24],
  'wall-tv': [2, 3, 24],
  'wall-shelf': [2, 6, 16],
  'wall-clock': [1, 4, 16],
  calendar: [1, 6, 16],
  'picture-landscape': [1, 6, 16],
  'picture-abstract': [1, 6, 16],
  'poster-mountain': [1, 4, 24],
};

/** Fensterbild zur Stunde: Morgenrot, Tag, Abend, Nacht. */
export function windowSprite(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 7 && h < 17) return 'window-day';
  if (h >= 5.5 && h < 7) return 'window-dawn';
  if (h >= 17 && h < 20.5) return 'window-dusk';
  return 'window-night';
}

/** Zufall mit festem Startwert: derselbe Raum wird immer gleich eingerichtet. */
function seeded(text) {
  let s = hash(text) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shuffled(list, rnd) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const range = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);

/**
 * Kacheln, die vom Eingang aus zu erreichen sind (1 je Kachel). Mit room nur
 * innerhalb dieses Raums, ab der Kachel hinter seiner Tuer - in einen Raum
 * fuehrt kein anderer Weg, also genuegt das, und es geht viel schneller.
 */
function reachable(L, room = null) {
  const seen = new Uint8Array(L.cols * L.rows);
  const from = room ? { col: room.door.col, row: room.r0 } : L.entry;
  const start = from.row * L.cols + from.col;
  const inside = room
    ? (c, r) => c >= room.c0 && c < room.c0 + room.cols && r >= room.r0 && r < room.r0 + room.rows
    : () => true;
  const queue = [start];
  seen[start] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const c = queue[qi] % L.cols;
    const r = (queue[qi] - c) / L.cols;
    for (const [dc, dr] of DIRS) {
      if (!inside(c + dc, r + dr) || !canStep(L, c, r, dc, dr)) continue;
      const n = (r + dr) * L.cols + c + dc;
      if (!seen[n]) {
        seen[n] = 1;
        queue.push(n);
      }
    }
  }
  return seen;
}

/**
 * Richtet das Gebaeude ein. Jedes Moebel wird nur gestellt, wenn danach noch
 * jeder Platz, jede Tuer und jede Stelle in Kueche und Lounge erreichbar ist.
 */
function decorate(L) {
  const at = (c, r) => r * L.cols + c;
  const inside = (c, r) => c >= 0 && c < L.cols && r >= 0 && r < L.rows;
  const keep = (c, r) => {
    if (inside(c, r)) L.used[at(c, r)] = 1;
  };
  // Freihalten: Plaetze und der Weg dorthin, hinter Haupttischen Platz zum
  // Auf- und Abgehen, Teppiche, Tueren beidseits, der Eingang.
  for (const s of L.seats) {
    keep(s.col, s.row);
    const reach = s.kind === 'session' ? 2 : 0;
    for (let d = -reach; d <= reach; d++) keep(s.col + d, s.row - 1);
  }
  for (const g of L.rugs) for (let r = g.row; r < g.row + g.h; r++) for (let c = g.col; c < g.col + g.w; c++) keep(c, r);
  for (const room of L.rooms) {
    keep(room.door.col, room.r0);
    keep(room.door.col, room.r0 + 1);
    for (let d = -1; d <= 1; d++) {
      keep(room.door.col + d, room.face - 1);
      keep(room.door.col + d, room.face - 2);
    }
  }
  keep(L.entry.col, L.entry.row);
  keep(L.entry.col, L.entry.row + 1);

  const need = [
    ...L.seats,
    L.kitchen.coffee,
    L.kitchen.water,
    L.lounge.kicker.left,
    L.lounge.kicker.right,
    ...L.lounge.sofa.map((s) => s.from),
    ...L.rooms.map((r) => ({ col: r.door.col, row: r.r0 })),
  ];
  const free = (c, r) => inside(c, r) && L.floor[at(c, r)] && !L.blocked[at(c, r)] && !L.used[at(c, r)];
  // Was in einem Raum erreichbar bleiben muss, haengt nur von diesem Raum ab.
  const needIn = new Map(L.rooms.map((r) => [r, need.filter((t) => roomAt(L, t.col, t.row) === r)]));
  const place = (name, col, row, kind) => {
    const w = widthOf(name);
    for (let c = col; c < col + w; c++) if (!free(c, row)) return false;
    for (let c = col; c < col + w; c++) L.blocked[at(c, row)] = 1;
    const room = roomAt(L, col, row);
    const seen = reachable(L, room);
    if (!(room ? needIn.get(room) : need).every((t) => seen[at(t.col, t.row)])) {
      for (let c = col; c < col + w; c++) L.blocked[at(c, row)] = 0;
      return false;
    }
    for (let c = col; c < col + w; c++) L.used[at(c, row)] = 1;
    L.items.push({ name, col, row, w, ...(kind ? { kind } : {}) });
    return true;
  };

  /** Wie weit Wandschmuck ueber einer Spalte hinunterreichen darf (Moebel davor). */
  const wallRoom = (col, face) => {
    let limit = WALL_ROWS * TILE;
    for (const it of L.items) {
      if (it.row === face + WALL_ROWS && col >= it.col && col < it.col + it.w) {
        limit = Math.min(limit, (WALL_ROWS + 1) * TILE - heightOf(it.name));
      }
    }
    return limit;
  };
  const hang = (name, col, face, kind, room, check = true) => {
    const [w, y, h] = WALL_ART[name];
    if (check && range(col, col + w - 1).some((c) => wallRoom(c, face) < y + h)) return false;
    L.wall.push({ name, x: col * TILE, y: face * TILE + y, w: w * TILE, h, kind: kind ?? 'art', ...(room ? { room } : {}) });
    return true;
  };

  // Eingang: Fussmatte, Garderobe; an der Aussenwand die Uhr und Fenster.
  L.mats.push({ name: 'doormat', col: L.entry.col, row: L.entry.row });
  place('coat-rack', 0, L.entry.row);
  hang('wall-clock', L.entrance.col + 1, 0, 'clock', null, false);
  const windows = [];
  for (let c = L.entrance.col + 3; c + 1 < L.cols - 1; c += 4) {
    hang('window', c, 0, 'window', null, false);
    windows.push(c, c + 1);
  }

  // Flure: Pflanzen an der Wand, nicht vor Tueren und Fenstern.
  const plants = ['plant-tall', 'plant-bush', 'plant-palm'];
  L.bands.forEach((b, bi) => {
    const blockedCols = new Set(bi === 0 ? [L.entrance.col + 1, ...windows] : []);
    let n = bi;
    for (let c = 4; c < L.cols - 1; c += 6) {
      for (const cc of [c, c + 1, c - 1]) {
        if (blockedCols.has(cc)) continue;
        if (place(plants[n % plants.length], cc, b.corridor)) {
          n++;
          break;
        }
      }
    }
    place('plant-palm', L.cols - 1, b.corridor);
  });
  place('plant-tall', 0, L.rows - 1);

  for (const room of L.rooms) {
    const rnd = seeded(room.key);
    const c0 = room.c0;
    const c1 = room.c0 + room.cols - 1;
    const r0 = room.r0;
    const r1 = room.r0 + room.rows - 1;
    const spots = {
      wall: (w) => shuffled(range(c0, c1 - w + 1).map((c) => [c, r0]), rnd),
      corner: (w) => shuffled([[c0, r1], [c1 - w + 1, r1], [c0, r0], [c1 - w + 1, r0]], rnd),
      side: () => shuffled(range(r0 + 1, r1 - 1).flatMap((r) => [[c0, r], [c1, r]]), rnd),
    };
    // An Seitenwaenden nicht Stueck an Stueck, und nicht Ruecken an Ruecken mit dem Nachbarraum.
    const covers = (it, c, r) => it.row === r && c >= it.col && c < it.col + it.w;
    const crowded = (c, r) => L.items.some((it) => covers(it, c, r - 1) || covers(it, c, r + 1));
    const across = (c, r) =>
      L.items.some((it) => (covers(it, c - 1, r) && c === c0) || (covers(it, c + 1, r) && c === c1));
    // In der Kueche bleiben Theke und Laufweg davor frei.
    const open = room.kind === 'kitchen' ? (c, r) => r >= r0 + 2 || c >= c0 + KITCHEN_COLS : () => true;
    const wish = (names, where, n = 1, kind) => {
      for (let i = 0; i < n; i++) {
        const name = names[Math.floor(rnd() * names.length)];
        const w = widthOf(name);
        const spot = where.flatMap((k) => spots[k](w).map((p) => [...p, k]));
        const ok = (c, r, k) => open(c, r) && !(k === 'side' && crowded(c, r)) && !across(c, r) && !across(c + w - 1, r);
        if (!spot.some(([c, r, k]) => ok(c, r, k) && place(name, c, r, kind))) return;
      }
    };
    if (room.kind === 'kitchen') {
      // Kueche: Fernseher ueber der Theke, Kalender ueber der Spuele.
      hang('wall-tv', c0 + 2, room.face, 'tv', room.key, false);
      hang('calendar', c0 + 7, room.face, 'calendar', room.key, false);
      if (room.cols > KITCHEN_COLS || room.rows > KITCHEN_ROWS) {
        wish(['plant-tall', 'plant-bush'], ['corner'], 2);
        wish(['bookshelf-low', 'bookshelf'], ['wall'], 1);
        wish(['beanbag'], ['corner', 'side'], 1);
        wish(['trash-bin'], ['side', 'corner'], 1);
      }
      continue;
    }
    if (room.kind === 'lounge') {
      // Lounge: Regale an der Rueckwand, Sitzgruppen im Raum, Pflanzen und Lampen.
      for (let c = room.door.col + 1; c + 1 <= c1; c += 3) place(Math.floor(c / 3) % 2 ? 'bookshelf' : 'bookshelf-low', c, r0);
      if (room.rows >= 4) {
        for (let c = c0 + 1; c + 3 <= c1 - 1; c += 6) {
          if (place('armchair', c, r0 + 2) && !place('coffee-table', c + 1, r0 + 2)) continue;
          place('armchair', c + 3, r0 + 2);
        }
      }
      wish(plants, ['corner'], 4);
      wish(['floor-lamp-off'], ['side', 'corner'], 2, 'lamp');
      wish(['beanbag', 'plant-bush'], ['side'], Math.max(1, room.rows - 4));
      let col = room.door.col + 2;
      for (const name of shuffled(['picture-landscape', 'wall-clock', 'picture-abstract', 'poster-mountain', 'corkboard', 'wall-shelf'], rnd)) {
        const w = WALL_ART[name][0];
        for (let c = col; c + w - 1 <= c1; c++) {
          if (hang(name, c, room.face, name === 'wall-clock' ? 'clock' : 'art', room.key)) {
            col = c + w + 2;
            break;
          }
        }
      }
      continue;
    }
    // Das Whiteboard zuerst: davor bleibt frei, damit man es sieht.
    let col = room.door.col + 1 + room.plateCols;
    if (col + 2 <= c1) {
      hang('whiteboard', col, room.face, 'whiteboard', room.key, false);
      for (let c = col; c < col + 3; c++) keep(c, r0);
      col += 4;
    }
    wish(plants, ['corner'], 2);
    wish(['bookshelf', 'bookshelf-low'], ['wall'], room.cols >= 12 ? 2 : 1);
    if (rnd() < 0.7) wish(['printer-idle'], ['wall'], 1, 'printer');
    if (rnd() < 0.5) wish(['server-0'], ['wall'], 1, 'server');
    wish(['filing-cabinet', 'coat-rack'], ['wall', 'side'], 1);
    wish(['floor-lamp-off'], ['corner', 'side'], 1, 'lamp');
    wish(['trash-bin', 'trash-bin-full'], ['side', 'corner'], 1);
    wish(['plant-bush', 'plant-tall', 'beanbag'], ['side', 'corner'], Math.max(0, room.rows - 6));
    // Bilder rechts vom Namensschild, mit Luft dazwischen.
    for (const name of shuffled(['corkboard', 'wall-shelf', 'picture-landscape', 'picture-abstract', 'poster-mountain'], rnd)) {
      const w = WALL_ART[name][0];
      for (let c = col; c + w - 1 <= c1; c++) {
        if (hang(name, c, room.face, 'art', room.key)) {
          col = c + w + 1;
          break;
        }
      }
    }
  }
}

export function walkable(L, col, row) {
  return col >= 0 && col < L.cols && row >= 0 && row < L.rows && !L.blocked[row * L.cols + col];
}

const DIRS = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

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
    for (const [dc, dr] of DIRS) {
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

/**
 * Text der Sprechblase: Werkzeug und woran es arbeitet. Shell-Befehle als
 * Prompt, Auftraege an Subagents mit Pfeil.
 */
export function speechText(tool, target, max = 28) {
  const activity = toolActivity(tool);
  if (target && activity === 'shell') return clip(`$ ${target}`, max);
  if (activity === 'delegate') return clip(target ? `→ ${target}` : 'delegiert', max);
  const label = toolLabel(tool);
  return clip(target ? `${label} ${target}` : label, max);
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

/** In der Pause fuehren die Wege im Pixel-Buero in Kueche und Lounge. */
const LEISURE = [
  ['coffee', 3],
  ['water', 2],
  ['stroll', 1],
  ['sofa', 2],
  ['kicker', 2],
];

/**
 * Welche Besorgungen eine Figur im Pixel-Buero machen kann: { rate (Chance je
 * Sekunde), options: [[name, gewicht], ...] } oder null. Wann, entscheidet
 * dieselbe Regel wie im klassischen Buero (errandsFor); nur die Ziele der
 * Pause sind andere, und fertige Subagents gehen statt Pause zu machen.
 * fig = { kind, state, stateMs }, room = { agentsRunning }.
 */
export function pixelErrands(fig, room = {}) {
  const e = errandsFor(fig, room);
  if (!e) return null;
  const busy = e.options.every(([name]) => name === 'pace' || name === 'visit');
  if (busy) return e;
  return fig.kind === 'session' ? { rate: e.rate, options: LEISURE } : null;
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

/** Figuren: Sitzungen und Subagents haben je drei Gesichter. */
const SESSION_LOOKS = ['look-01', 'look-03', 'look-04'];
const AGENT_LOOKS = ['look-02', 'look-05', 'look-06'];

export function lookFor(kind, item) {
  const list = kind === 'agent' ? AGENT_LOOKS : SESSION_LOOKS;
  return list[hash(`look:${kind === 'agent' ? item.id : item.sessionId}`) % list.length];
}
