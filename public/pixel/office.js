/*
 * Pixel-Buero: das Buero als Pixelgrafik auf Canvas 2D - ein Gebaeude mit
 * gemeinsamer Kueche und einem Raum je Projekt, verbunden durch Flure und
 * Tueren (Grundriss in world.js). Am Tisch arbeiten die Figuren mit Buch, Block oder Laptop - je
 * nach Werkzeug, mit Datei oder Befehl in der Sprechblase. Wer wartet, holt
 * Kaffee oder Wasser; wer lange nachdenkt, geht auf und ab; wer delegiert,
 * schaut bei seinen Subagents vorbei. Gegangen wird per Wegfindung, gekommen
 * und gegangen durch den Eingang.
 *
 * Grafiken: public/assets/office (atlas.json), Herkunft in art/README.md.
 * Gezeichnet wird in Originalpixeln, ganzzahlig vergroessert und ohne
 * Glaettung; nur Text entsteht in voller Aufloesung.
 */

import { limitState, roomAsleep, errandStillFits, pickWeighted } from '../agents.js';
import {
  TILE,
  WALL_ROWS,
  SIDE_PX,
  layoutBuilding,
  buildingSignature,
  findPath,
  walkable,
  feetOf,
  facing,
  figureView,
  pixelErrands,
  frameIndex,
  pixelScale,
  daylight,
  corridorLights,
  roomAt,
  KEY_COLORS,
  OUTFITS,
  outfitFor,
} from './world.js';

const ASSETS = new URL('../assets/office/', import.meta.url);

/** Grafikpixel je Sekunde. */
const WALK_SPEED = 56;
const HURRY_SPEED = 120;
/** Ereignisse (Nachricht, Fehler, Feier) nur zeigen, solange sie frisch sind. */
const EVENT_FRESH_MS = 60_000;
const CELEBRATE_FRESH_MS = 90_000;
/** Hoechstens so viele sind gleichzeitig unterwegs (Anteil und absolut). */
const AWAY_SHARE = 0.4;
const AWAY_MAX = 6;
/** Schriftgroesse in den Blasen (CSS-Pixel). */
const FONT_CSS = 11;
const FONT_FAMILY = 'ui-monospace, "Cascadia Mono", Consolas, monospace';
const INK = '#181425';
/** Schatten und Dunkelheit in der Konturfarbe der Grafiken. */
const SHADE = '#181425';
const rgb255 = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ');
/** Kopfhoehe ueber dem Fusspunkt: hier setzen Blasen und Symbole an. */
const HEAD = 34;

/* --- Grafiken -------------------------------------------------------------- */

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Grafik fehlt: ${src}`));
    img.src = src;
  });
}

async function loadAssets() {
  const res = await fetch(new URL('atlas.json', ASSETS));
  if (!res.ok) throw new Error(`atlas.json: HTTP ${res.status}`);
  const atlas = await res.json();
  const files = new Set([...Object.keys(atlas.meta.images), ...Object.keys(atlas.auxiliaryImages ?? {})]);
  for (const c of Object.values(atlas.characters ?? {})) {
    if (c.recolorMask) files.add(c.recolorMask);
    for (const m of Object.values(c.animationMasks ?? {})) files.add(m);
  }
  const images = {};
  await Promise.all(
    [...files].map(async (f) => {
      images[f] = await loadImage(new URL(f, ASSETS).href);
    }),
  );
  return { atlas, images };
}

/** Farbmaske zu einem Figurenblatt (sheet, walk, desk-work). */
function maskOf(file) {
  if (file.endsWith('/sheet.png')) return file.replace(/sheet\.png$/, 'recolor-mask.png');
  return file.replace(/(walk|desk-work)\.png$/, '$1-recolor-mask.png');
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const KEY_RGB = KEY_COLORS.map(rgb);

function pixelsOf(img) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  return { canvas: c, g, data: g.getImageData(0, 0, c.width, c.height) };
}

/**
 * Figurenblatt in anderer Kleidung: nur die drei Schluesselfarben, und nur
 * wo die Maske sie als Kleidung ausweist. Haut, Haare, Stuhl bleiben.
 */
function recolor(img, mask, outfit) {
  const { canvas, g, data } = pixelsOf(img);
  const m = mask ? pixelsOf(mask).data.data : null;
  const to = outfit.map(rgb);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0 || (m && m[i + 3] === 0)) continue;
    for (let k = 0; k < 3; k++) {
      const key = KEY_RGB[k];
      if (d[i] === key[0] && d[i + 1] === key[1] && d[i + 2] === key[2]) {
        [d[i], d[i + 1], d[i + 2]] = to[k];
        break;
      }
    }
  }
  g.putImageData(data, 0, 0);
  return canvas;
}

function makeArt({ atlas, images }) {
  const tinted = new Map();
  const imageFor = (file, outfit) => {
    if (!outfit || outfit === 'blue' || !images[maskOf(file)]) return images[file];
    const key = `${file}|${outfit}`;
    let c = tinted.get(key);
    if (!c) {
      c = recolor(images[file], images[maskOf(file)], OUTFITS[outfit]);
      tinted.set(key, c);
    }
    return c;
  };
  /** Sprite mit der linken oberen Ecke bei (x, y); sw/sh schneiden ab. */
  const draw = (ctx, name, x, y, { outfit, flip = false, image, sw, sh } = {}) => {
    const s = atlas.sprites[name];
    if (!s) return;
    const img = imageFor(image ?? s.image, outfit);
    const w = sw ?? s.width;
    const h = sh ?? s.height;
    if (flip) {
      ctx.save();
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(img, s.x, s.y, w, h, 0, 0, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(img, s.x, s.y, w, h, x, y, w, h);
    }
  };
  const anim = (name) => atlas.animations[name];
  /** Spritename einer Animation nach verstrichener Zeit. */
  const frame = (name, elapsed) => {
    const a = atlas.animations[name];
    return a ? a.states[frameIndex(a, elapsed)] : null;
  };
  /** Sprite auf Breite w dehnen: Raender (edge Pixel) bleiben, die Mitte wird gestreckt. */
  const stretch = (ctx, name, x, y, w, edge) => {
    const s = atlas.sprites[name];
    const img = images[s.image];
    const mid = s.width - 2 * edge;
    ctx.drawImage(img, s.x, s.y, edge, s.height, x, y, edge, s.height);
    ctx.drawImage(img, s.x + edge, s.y, mid, s.height, x + edge, y, w - 2 * edge, s.height);
    ctx.drawImage(img, s.x + s.width - edge, s.y, edge, s.height, x + w - edge, y, edge, s.height);
  };
  return { atlas, draw, stretch, anim, frame, sprite: (n) => atlas.sprites[n] };
}

/* --- Zeichenhilfen ---------------------------------------------------------- */

/** Dehnbare Blase aus neun 4x4-Teilen (Kanten und Mitte wiederholt). */
function nineSlice(art, ctx, prefix, x, y, w, h) {
  const P = 4;
  const piece = (name, px, py, pw = P, ph = P) => art.draw(ctx, `${prefix}-${name}`, px, py, { sw: pw, sh: ph });
  for (let yy = y + P; yy < y + h - P; yy += P) {
    const ph = Math.min(P, y + h - P - yy);
    piece('left', x, yy, P, ph);
    piece('right', x + w - P, yy, P, ph);
    for (let xx = x + P; xx < x + w - P; xx += P) piece('center', xx, yy, Math.min(P, x + w - P - xx), ph);
  }
  for (let xx = x + P; xx < x + w - P; xx += P) {
    const pw = Math.min(P, x + w - P - xx);
    piece('top', xx, y, pw);
    piece('bottom', xx, y + h - P, pw);
  }
  piece('top-left', x, y);
  piece('top-right', x + w - P, y);
  piece('bottom-left', x, y + h - P);
  piece('bottom-right', x + w - P, y + h - P);
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

/* --- Buero ----------------------------------------------------------------- */

/**
 * @param container  Element, das das Gebaeude aufnimmt
 * @param opts       { tooltip, describe(kind, item) -> string, timeZone()?, now()?, emptyText? }
 * @returns {{ render(activity, env), tick(), setSound(on), errand(id, name), ready: Promise }}
 */
export function createPixelOffice(
  container,
  {
    tooltip,
    describe,
    timeZone = () => undefined,
    // Tageslicht folgt dieser Uhr (zum Ausprobieren verstellbar).
    now: clock = () => Date.now(),
    emptyText = 'Gerade ist keine Claude-Code-Sitzung offen – das Büro ist leer.',
  },
) {
  /** Bereits gezeigte Ereignisse - jedes nur einmal. */
  const seen = new Set();
  let art = null;
  let failed = null;
  let last = null;
  let renderedOnce = false;
  let raf = 0;
  let lastT = 0;
  let hovered = null;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const still = () => reduced?.matches === true;

  const root = document.createElement('div');
  root.className = 'px-building';
  const canvas = document.createElement('canvas');
  canvas.className = 'px-canvas';
  canvas.setAttribute('role', 'img');
  const empty = document.createElement('p');
  empty.className = 'px-empty';
  empty.textContent = emptyText;
  empty.hidden = true;
  root.append(canvas, empty);
  const ctx = canvas.getContext('2d');

  /** Das Gebaeude: Grundriss, Figuren und was sich an Kueche und Tueren tut. */
  const B = {
    layout: null,
    sig: null,
    bg: null,
    k: 3,
    W: 0,
    H: 0,
    projects: [],
    figs: new Map(),
    /** Beendete Subagents, die schon gegangen sind - nicht wieder hereinholen. */
    departed: new Set(),
    doors: new Map(),
    espresso: { since: -Infinity, until: -Infinity },
    cooler: { until: -Infinity },
    directT: 0,
    limit: 'unknown',
    asleep: new Set(),
    /** Lichtquellen des aktuellen Bilds (in drawScene gesammelt). */
    lights: [],
    daylight: { rgb: [38, 43, 68], a: 0 },
  };

  const ready = loadAssets()
    .then((a) => {
      art = makeArt(a);
      if (last) render(last.act, last.env);
    })
    .catch((err) => {
      failed = err;
      const p = document.createElement('p');
      p.className = 'chart-empty';
      p.textContent = `Pixel-Büro: ${err.message}`;
      container.replaceChildren(p);
    });

  /* --- Grundriss und Hintergrund --------------------------------------------- */

  /**
   * Grundriss passend zum Platz: moeglichst gross (4-, 3-, 2-fach), solange das
   * Gebaeude in Breite und Hoehe ins Fenster passt; sonst 2-fach und scrollen.
   */
  function plan() {
    const availW = container.clientWidth || 1200;
    const availH = Math.max(360, window.innerHeight - 220);
    let pick = null;
    for (const css of [4, 3, 2]) {
      const maxCols = Math.max(1, Math.floor((availW / css - 2 * SIDE_PX) / TILE));
      const L = layoutBuilding(B.projects, maxCols);
      pick = { L, css, maxCols, w: L.cols * TILE + 2 * SIDE_PX, h: L.rows * TILE + SIDE_PX };
      if (pick.w * css <= availW && pick.h * css <= availH) break;
    }
    return pick;
  }

  function relayout(now) {
    const p = plan();
    const sig = `${buildingSignature(B.projects)}|${p.css}|${p.maxCols}`;
    if (sig === B.sig) return;
    B.sig = sig;
    B.layout = p.L;
    B.W = p.w;
    B.H = p.h;
    const dpr = window.devicePixelRatio || 1;
    B.k = pixelScale(p.w, container.clientWidth || p.w * p.css, dpr, p.css);
    canvas.width = p.w * B.k;
    canvas.height = p.h * B.k;
    canvas.style.width = `${(p.w * B.k) / dpr}px`;
    canvas.style.height = `${(p.h * B.k) / dpr}px`;
    buildBackground();
    // Umgebaut: wer sitzt, zieht mit seinem Tisch um; wer unterwegs ist, geht
    // zum neuen Platz (Besorgungen enden), wer geht, sucht den Ausgang neu.
    for (const f of B.figs.values()) {
      const seat = seatOf(f.id);
      if (f.leaving) {
        go(f, [{ walk: B.layout.entrance }, { exit: true }], now);
        continue;
      }
      if (!seat) continue;
      f.seat = seat;
      if (f.seated) {
        const at = feetOf(seat);
        f.x = at.x;
        f.y = at.y;
      } else {
        f.errand = null;
        go(f, [{ walk: seat }, { sit: true }], now);
      }
    }
  }

  /** Was sich nie bewegt: Boeden, Teppiche, Waende - einmal je Grundriss. */
  function buildBackground() {
    const L = B.layout;
    const bg = document.createElement('canvas');
    bg.width = B.W;
    bg.height = B.H;
    const g = bg.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.translate(SIDE_PX, 0);
    for (let r = 0; r < L.rows; r++) {
      for (let c = 0; c < L.cols; c++) {
        const name = L.floor[r * L.cols + c];
        if (name) art.draw(g, name, c * TILE, r * TILE);
      }
    }
    for (const { col, row, w, h } of L.rugs) {
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          const v = r === 0 ? 'top' : r === h - 1 ? 'bottom' : '';
          const hz = c === 0 ? 'left' : c === w - 1 ? 'right' : '';
          const part = v && hz ? `${v}-${hz}` : v || hz || 'center';
          art.draw(g, `rug-${part}`, (col + c) * TILE, (row + r) * TILE);
        }
      }
    }
    // Schatten: unter jeder Wand von vorn ein dunkler Saum auf dem Boden,
    // rechts neben Trennwaenden ein schmaler (Licht von oben links).
    g.fillStyle = SHADE;
    for (const f of L.faces) {
      const y = (f.row + 2) * TILE;
      const x = f.c0 * TILE;
      const w = (f.c1 - f.c0 + 1) * TILE;
      g.globalAlpha = 0.28;
      g.fillRect(x, y, w, 2);
      g.globalAlpha = 0.14;
      g.fillRect(x, y + 2, w, 2);
      g.globalAlpha = 0.06;
      g.fillRect(x, y + 4, w, 2);
    }
    for (const d of L.dividers) {
      g.globalAlpha = 0.16;
      g.fillRect(d.col * TILE + 2, d.r0 * TILE, 2, (d.r1 - d.r0) * TILE);
    }
    g.globalAlpha = 1;
    // Waende von vorn; die Tueren zeichnet die Szene (sie gehen auf und zu).
    const doors = new Set(L.doors.map((d) => `${d.col},${d.row}`));
    for (const f of L.faces) {
      for (let c = f.c0; c <= f.c1; c++) {
        if (doors.has(`${c},${f.row}`)) continue;
        const name =
          c === f.c0 ? 'wall-end-left' : c === f.c1 ? 'wall-end-right' : f.style === 'wainscot' ? 'wall-wainscot' : 'wall-plain';
        art.draw(g, name, c * TILE, f.row * TILE);
      }
    }
    // Trennwaende von oben: senkrecht auf der Raumgrenze, waagerecht unter jeder Reihe.
    for (const d of L.dividers) {
      for (let r = d.r0; r < d.r1; r++) art.draw(g, 'wall-side-cap', d.col * TILE - 2, r * TILE);
    }
    for (const l of L.ledges) {
      const y = (l.row + 1) * TILE - 2;
      for (let c = l.c0; c <= l.c1; c++) {
        g.save();
        g.translate(c * TILE + TILE, y);
        g.rotate(Math.PI / 2);
        art.draw(g, 'wall-side-cap', 0, 0);
        g.restore();
      }
    }
    const right = L.cols * TILE - 12;
    art.draw(g, 'wall-outer-corner', -SIDE_PX, 0);
    art.draw(g, 'wall-outer-corner', right, 0, { flip: true });
    for (let y = TILE; y < L.rows * TILE; y += TILE) {
      art.draw(g, 'wall-side-cap', -SIDE_PX, y);
      art.draw(g, 'wall-side-cap', right, y, { flip: true });
    }
    B.bg = bg;
  }

  /* --- Figuren --------------------------------------------------------------- */

  function seatOf(id) {
    return B.layout?.seats.find((s) => s.id === id) ?? null;
  }

  function newFig(kind, item, seat, arriving) {
    const at = arriving ? feetOf(B.layout.entrance) : feetOf(seat);
    const f = {
      id: kind === 'session' ? item.sessionId : item.id,
      kind,
      item,
      look: kind === 'session' ? 'look-01' : 'look-02',
      outfit: outfitFor(kind, item),
      seat,
      x: at.x,
      y: at.y,
      dir: 'front',
      seated: !arriving,
      plan: [],
      walk: null,
      wait: null,
      errand: null,
      leaving: false,
      gone: false,
      view: null,
      state: null,
      stateSince: performance.now(),
      emote: null,
      coffeeUntil: 0,
      // Nicht alle im Gleichtakt tippen lassen.
      phase: Math.floor(Math.random() * 1000),
    };
    if (arriving) go(f, [{ walk: seat }, { sit: true }], performance.now());
    return f;
  }

  /** Neuer Plan: Schritte { walk: tile, speed? } | { wait: ms, face?, act? } | { sit } | { exit } | { run: fn }. */
  function go(f, plan, now) {
    f.plan = plan.slice();
    f.walk = null;
    f.wait = null;
    f.seated = false;
    next(f, now);
  }

  function next(f, now) {
    const s = f.plan.shift();
    if (!s) return;
    if (s.walk) {
      if (!startWalk(f, s.walk, s.speed ?? WALK_SPEED)) next(f, now);
    } else if (s.wait != null) {
      f.wait = { until: now + s.wait, act: s.act ?? null };
      if (s.face) f.dir = s.face;
      if (s.act === 'coffee') B.espresso = { since: now, until: now + s.wait };
      if (s.act === 'water') B.cooler.until = now + s.wait;
    } else if (s.sit) {
      f.seated = true;
      f.errand = null;
      f.dir = 'front';
      const home = feetOf(f.seat);
      f.x = home.x;
      f.y = home.y;
    } else if (s.exit) {
      f.gone = true;
    } else if (s.run) {
      s.run(now);
      next(f, now);
    }
  }

  /** Naechstgelegene Kachel (Figuren laufen auf den Kachelmitten). */
  const nearTile = (f) => ({ col: Math.round((f.x - TILE / 2) / TILE), row: Math.round((f.y - TILE) / TILE) });

  function startWalk(f, to, speed) {
    const from = nearTile(f);
    const path = findPath(B.layout, from, to);
    if (!path) return false;
    const points = [feetOf(from), ...path.map(feetOf)];
    if (still()) {
      const end = points[points.length - 1];
      f.x = end.x;
      f.y = end.y;
      return false;
    }
    f.walk = { points, i: 0, speed, t: 0 };
    return true;
  }

  function update(f, dt, now) {
    if (f.walk) {
      const w = f.walk;
      w.t += dt;
      let left = (w.speed * dt) / 1000;
      while (left > 0 && w.i < w.points.length) {
        const p = w.points[w.i];
        const dx = p.x - f.x;
        const dy = p.y - f.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.01) f.dir = facing(dx, dy, f.dir);
        if (d <= left) {
          f.x = p.x;
          f.y = p.y;
          left -= d;
          w.i++;
        } else {
          f.x += (dx / d) * left;
          f.y += (dy / d) * left;
          left = 0;
        }
      }
      if (w.i >= w.points.length) {
        f.walk = null;
        next(f, now);
      }
    } else if (f.wait && now >= f.wait.until) {
      f.wait = null;
      next(f, now);
    }
    if (f.emote && now >= f.emote.until) f.emote = null;
  }

  /* --- Besorgungen ------------------------------------------------------------ */

  /** Freier Fleck im eigenen Raum oder im Flur davor, nicht gleich nebenan. */
  function strollSpot(f) {
    const L = B.layout;
    const room = L.rooms.find((r) => r.key === f.seat.room);
    if (!room) return null;
    const band = L.bands[room.band];
    const seats = new Set(L.seats.map((s) => `${s.col},${s.row}`));
    const here = nearTile(f);
    for (let i = 0; i < 40; i++) {
      const inRoom = Math.random() < 0.6;
      const col = inRoom ? room.c0 + Math.floor(Math.random() * room.cols) : Math.floor(Math.random() * L.cols);
      const row = inRoom ? room.r0 + Math.floor(Math.random() * room.rows) : band.corridor + Math.floor(Math.random() * 2);
      if (!walkable(L, col, row) || seats.has(`${col},${row}`)) continue;
      if (Math.abs(col - here.col) + Math.abs(row - here.row) < 4) continue;
      return { col, row };
    }
    return null;
  }

  /** Kueche: an jeder Stelle steht nur einer. */
  const taken = (name, f) => [...B.figs.values()].some((o) => o !== f && o.errand === name && !o.gone);

  function startErrand(f, name, now) {
    const L = B.layout;
    const home = { col: f.seat.col, row: f.seat.row };
    const back = [{ walk: home }, { sit: true }];
    let plan = null;
    if (name === 'coffee' && !taken('coffee', f)) {
      plan = [
        { walk: L.kitchen.coffee },
        { wait: rand(3500, 5000), face: 'back', act: 'coffee' },
        {
          run: (t) => {
            f.emote = { name: 'coffee', until: t + 1800 };
            f.coffeeUntil = t + 60_000;
          },
        },
        ...back,
      ];
    } else if (name === 'water' && !taken('water', f)) {
      plan = [{ walk: L.kitchen.water }, { wait: rand(2500, 4000), face: 'back', act: 'water' }, ...back];
    } else if (name === 'stroll') {
      const spot = strollSpot(f);
      if (spot) plan = [{ walk: spot }, { wait: rand(2000, 4000), face: 'front' }, ...back];
    } else if (name === 'pace') {
      // Hinter dem eigenen Tisch auf und ab.
      const row = home.row - 1;
      const cols = [-3, -2, 2, 3].map((d) => home.col + d).filter((c) => walkable(L, c, row) && findPath(L, home, { col: c, row }));
      if (cols.length) {
        const a = cols[Math.floor(Math.random() * cols.length)];
        plan = [{ walk: { col: a, row } }, { wait: 700 }, { walk: { col: home.col, row } }, { wait: 500 }, ...back];
      }
    } else if (name === 'visit') {
      const busy = L.seats.filter((s) => {
        const a = B.figs.get(s.id);
        return s.owner === f.id && a?.seated && !a.view?.leaving;
      });
      const target = busy[Math.floor(Math.random() * busy.length)];
      // Schraeg hinter den Subagent, damit beide zu sehen sind.
      const side = target && [1, -1].find((d) => walkable(L, target.col + d, target.row - 1));
      if (side) {
        plan = [
          { walk: { col: target.col + side, row: target.row - 1 } },
          {
            run: (t) => {
              f.emote = { name: 'question', until: t + 2000 };
              const other = B.figs.get(target.id);
              if (other) other.emote = { name: 'idea', until: t + 3200 };
            },
          },
          { wait: rand(3000, 4500), face: side > 0 ? 'left' : 'right' },
          ...back,
        ];
      }
    }
    if (!plan) return false;
    f.errand = name;
    go(f, plan, now);
    return true;
  }

  /** Einmal je Sekunde: wer steht auf, wer muss zurueck? */
  function direct(now) {
    const figs = [...B.figs.values()].filter((f) => !f.leaving && !f.gone && f.seat);
    for (const f of figs) {
      if (f.errand && !errandStillFits(f.errand, f.kind, f.state)) {
        f.errand = null;
        go(f, [{ walk: { col: f.seat.col, row: f.seat.row }, speed: HURRY_SPEED }, { sit: true }], now);
      }
    }
    if (still() || B.limit === 'reached') return;
    const away = figs.filter((f) => f.errand).length;
    const cap = Math.min(AWAY_MAX, Math.max(1, Math.floor(figs.length * AWAY_SHARE)));
    if (away >= cap) return;
    for (const f of figs) {
      if (!f.seated || f.errand) continue;
      const agentsRunning = figs.filter((a) => a.kind === 'agent' && a.seat.owner === f.id).length;
      const opts = pixelErrands({ kind: f.kind, state: f.state, stateMs: now - f.stateSince }, { agentsRunning });
      if (!opts || Math.random() >= opts.rate) continue;
      if (startErrand(f, pickWeighted(opts.options), now)) return;
    }
  }

  /* --- Daten uebernehmen -------------------------------------------------------- */

  function flash(f, ev, kind, freshMs, name, ms, now) {
    if (!ev?.id) return;
    const key = `${kind}:${ev.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (ev.at == null || Date.now() - ev.at > freshMs) return;
    f.emote = { name, until: now + ms };
  }

  /** Aufstehen und zum Ausgang gehen; beim ersten Bild sofort weg. */
  function leave(f, now, finish) {
    f.leaving = true;
    f.errand = null;
    if (finish) f.emote = { name: finish, until: now + 4000 };
    if (!renderedOnce || still()) {
      f.gone = true;
      return;
    }
    go(f, [{ walk: B.layout.entrance }, { exit: true }], now);
  }

  function take(kind, item, now) {
    const id = kind === 'session' ? item.sessionId : item.id;
    const view = figureView(kind, item, { limit: B.limit });
    if (B.departed.has(id)) {
      if (view.leaving) return null;
      B.departed.delete(id); // laeuft wieder (fortgesetzt)
    }
    const seat = seatOf(id);
    let f = B.figs.get(id);
    if (!f) {
      // Beim ersten Bild sitzen alle schon; spaeter kommt man durch den Eingang.
      f = newFig(kind, item, seat, renderedOnce && !still());
      B.figs.set(id, f);
    }
    f.item = item;
    if (!f.leaving) f.seat = seat;
    if (view.state !== f.state) {
      f.state = view.state;
      f.stateSince = now;
    }
    f.view = view;
    flash(f, item.error, 'error', EVENT_FRESH_MS, item.error?.kind === 'rate' ? 'sweat' : 'error', 6000, now);
    if (kind === 'session') {
      flash(f, item.prompt, 'prompt', EVENT_FRESH_MS, 'alert', 2600, now);
      flash(f, item.celebration, 'celebrate', CELEBRATE_FRESH_MS, item.celebration?.kind === 'push' ? 'heart' : 'done', 3600, now);
    }
    if (view.leaving && !f.leaving) leave(f, now, view.finish);
    return id;
  }

  /* --- Zeichnen --------------------------------------------------------------- */

  /** Stuhl, Figur am Tisch, Tisch, Lampe, Tasse, Requisit und Haende. */
  function drawDesk(seat, f, now) {
    const p = feetOf(seat);
    const M = art.atlas.mountPoints[seat.desk];
    const dx = seat.desk === 'desk-large' ? p.x - 24 : p.x - 16;
    const dy = p.y - 16;
    const fx = p.x - 8;
    const fy = p.y - 32;
    const seated = f && f.seated && !f.gone;
    const pose = seated ? (f.view?.pose ?? 'type') : null;
    let figName = null;
    let anim = null;
    if (seated) {
      if (pose === 'sleep') {
        figName = `${f.look}-think-0`;
      } else {
        anim = art.anim(`${f.look}-${pose}`);
        const t = still() ? 0 : now + f.phase;
        figName = anim ? anim.states[frameIndex(anim, t)] : `${f.look}-front`;
      }
      art.draw(ctx, figName, fx, fy, { outfit: f.outfit });
    } else {
      art.draw(ctx, 'chair-front', fx, p.y - 24);
      // Wer gerade auf dem eigenen Platz steht (auf- oder hinsetzen), steht vor dem Stuhl.
      if (f && !f.gone && Math.abs(f.x - p.x) < 1 && Math.abs(f.y - p.y) < 6) drawFigure(f, now);
    }
    shadow(dx + 1, dy + 22, art.sprite(seat.desk).width, 3);
    art.draw(ctx, seat.desk, dx, dy);
    const lampOn = M.lamp && f?.view?.lamp && f.seated && !B.asleep.has(seat.room);
    if (M.lamp) art.draw(ctx, lampOn ? 'lamp-on' : 'lamp-off', dx + M.lamp[0], dy + M.lamp[1]);
    if (lampOn) B.lights.push({ x: dx + M.lamp[0] + 11, y: dy + M.lamp[1] + 6, r: 40, s: 1, glow: '#feae34' });
    if (seated && pose !== 'sleep') B.lights.push({ x: dx + M.laptop[0] + 8, y: dy + M.laptop[1] + 4, r: 18, s: 0.7, glow: '#2ce8f5' });
    if (M.mug) {
      const steaming = f && f.coffeeUntil > now && !still();
      art.draw(ctx, steaming ? art.frame('mug-steam', now) : 'mug-idle', dx + M.mug[0], dy + M.mug[1]);
    }
    const prop = anim?.prop;
    if (seated && prop && (prop.animation || prop.sprite)) {
      let name = prop.sprite;
      if (prop.animation) {
        const i = anim.states.indexOf(figName);
        name = art.anim(prop.animation).states[prop.frameMap?.[i] ?? i];
      }
      art.draw(ctx, name, fx + prop.mount[0], fy + prop.mount[1]);
    } else {
      // Laptop: offen, solange jemand arbeitet oder nur kurz weg ist.
      const open = seated ? pose !== 'sleep' : f && !f.leaving && !f.gone && f.errand;
      art.draw(ctx, open ? 'laptop-back-open' : 'laptop-closed', dx + M.laptop[0], dy + M.laptop[1]);
    }
    if (seated) {
      const s = art.sprite(figName);
      if (s?.foregroundImage) art.draw(ctx, figName, fx, fy, { image: s.foregroundImage });
    }
  }

  function drawFigure(f, now) {
    const t = still() ? 0 : now + f.phase;
    let name;
    let flip = false;
    if (f.walk) {
      const dir = f.dir === 'left' ? 'right' : f.dir;
      flip = f.dir === 'left';
      name = art.frame(`${f.look}-walk-${dir}`, f.walk.t);
    } else if (f.dir === 'front') {
      name = art.frame(`${f.look}-idle`, t);
    } else {
      name = `${f.look}-${f.dir === 'left' ? 'right' : f.dir}`;
      flip = f.dir === 'left';
    }
    const x = Math.round(f.x);
    const y = Math.round(f.y);
    shadow(x - 5, y - 2, 10, 2);
    art.draw(ctx, name, x - 8, y - 32, { outfit: f.outfit, flip });
  }

  /** Harter Pixelschatten: ein Rechteck mit abgeschnittenen Ecken. */
  function shadow(x, y, w, h) {
    ctx.fillStyle = SHADE;
    ctx.globalAlpha = 0.3;
    ctx.fillRect(x + 1, y, w - 2, 1);
    ctx.fillRect(x, y + 1, w, Math.max(1, h - 1));
    ctx.globalAlpha = 1;
  }

  /** Tuer: geht auf, solange jemand davor, darin oder dahinter steht. */
  function doorFrame(d, now) {
    let s = B.doors.get(d.key);
    if (!s) {
      s = { level: 0, t: 0 };
      B.doors.set(d.key, s);
    }
    const x = d.col * TILE + TILE / 2;
    const top = d.row * TILE;
    const near = [...B.figs.values()].some(
      (f) => !f.gone && !f.seated && Math.abs(f.x - x) < TILE && f.y > top - TILE / 2 && f.y <= top + 3 * TILE + TILE / 2,
    );
    const want = near ? 2 : 0;
    if (s.level !== want && now - s.t > 120) {
      s.level += Math.sign(want - s.level);
      s.t = now;
    }
    return `door-${d.kind}-${['closed', 'half-open', 'open'][s.level]}`;
  }

  function drawScene(now) {
    const L = B.layout;
    const items = [];
    for (const d of L.doors) {
      const name = doorFrame(d, now);
      items.push({ y: (d.row + WALL_ROWS) * TILE, z: 0, draw: () => art.draw(ctx, name, d.col * TILE, d.row * TILE) });
    }
    const k = L.kitchen;
    const base = (k.counter.row + 1) * TILE;
    const brewing = now < B.espresso.until;
    items.push({
      y: base,
      z: 0,
      draw: () => {
        const cx = k.counter.col * TILE;
        const cy = base - 24;
        const m = art.atlas.mountPoints['kitchen-counter'];
        shadow(cx + 1, base - 2, 80, 3);
        art.draw(ctx, 'kitchen-counter', cx, cy);
        art.draw(ctx, brewing ? art.frame('espresso', now - B.espresso.since) : 'espresso-idle', cx + m.espresso[0], cy + m.espresso[1]);
        art.draw(ctx, 'tray-mugs', cx + m.tray[0], cy + m.tray[1]);
        art.draw(ctx, 'fridge', k.fridge.col * TILE, base - 32);
        art.draw(ctx, now < B.cooler.until ? art.frame('cooler-bubble', now) : 'cooler-bubble-1', k.cooler.col * TILE, base - 32);
      },
    });
    const kitchen = L.rooms.find((r) => r.kind === 'kitchen');
    const inKitchen = [...B.figs.values()].some(
      (f) => !f.gone && roomAt(L, Math.floor(f.x / TILE), Math.floor((f.y - 1) / TILE)) === kitchen,
    );
    if (inKitchen) {
      B.lights.push({
        x: (kitchen.c0 + kitchen.cols / 2) * TILE,
        y: (kitchen.r0 + kitchen.rows / 2) * TILE,
        r: Math.max(kitchen.cols, kitchen.rows) * 10,
        s: 0.95,
        glow: '#fee761',
      });
    }
    if (brewing) B.lights.push({ x: (k.counter.col + 0.5) * TILE, y: base - 14, r: 14, s: 0.6, glow: '#feae34' });
    B.lights.push({ x: (k.cooler.col + 0.5) * TILE, y: base - 20, r: 10, s: 0.5, glow: '#0099db' });
    for (const p of corridorLights(L, 6)) B.lights.push({ x: p.x, y: p.y, r: 22, s: 0.55, glow: null });
    B.lights.push({ x: (L.entrance.col + 0.5) * TILE, y: WALL_ROWS * TILE, r: 22, s: 0.7, glow: '#2ce8f5' });
    const atDesk = new Set();
    for (const seat of L.seats) {
      const f = B.figs.get(seat.id);
      const p = feetOf(seat);
      if (f && !f.seated && !f.gone && Math.abs(f.x - p.x) < 1 && Math.abs(f.y - p.y) < 6) atDesk.add(f);
      items.push({ y: seat.row * TILE + 24, z: 0, draw: () => drawDesk(seat, f, now) });
    }
    for (const f of B.figs.values()) {
      if (f.gone || f.seated || atDesk.has(f)) continue;
      items.push({ y: f.y, z: 1, draw: () => drawFigure(f, now) });
    }
    items.sort((a, b) => a.y - b.y || a.z - b.z);
    for (const it of items) it.draw();
  }

  /* --- Schilder, Blasen und Symbole -------------------------------------------- */

  const dprNow = () => window.devicePixelRatio || 1;
  const font = (css, bold = false) => `${bold ? '600 ' : ''}${Math.round(css * dprNow())}px ${FONT_FAMILY}`;

  /** Text in voller Aufloesung an einer Stelle in Grafikpixeln. */
  function text(str, x, y, { size = FONT_CSS, color = INK, bold = false } = {}) {
    const { k } = B;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = font(size, bold);
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(str, (SIDE_PX + x) * k, y * k + 1);
    ctx.restore();
  }

  function measure(str, size = FONT_CSS, bold = false) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = font(size, bold);
    const w = ctx.measureText(str).width / B.k;
    ctx.restore();
    return w;
  }

  /** Messingschild mit dem Projektnamen neben der Tuer. */
  function plates() {
    const out = [];
    for (const room of B.layout.rooms) {
      if (room.kind !== 'project') continue;
      const x0 = (room.door.col + 1) * TILE + 3;
      const maxW = (room.c0 + room.cols) * TILE - 6 - x0;
      if (maxW < 16) continue;
      let label = room.label;
      while (label.length > 3 && measure(label, 10, true) + 8 > maxW) label = `${label.slice(0, -2)}…`;
      const w = Math.min(maxW, Math.ceil(measure(label, 10, true)) + 8);
      const y = room.face * TILE + 6;
      art.stretch(ctx, 'plate-brass', x0, y, w, 3);
      text(label, x0 + w / 2, y + 4, { size: 10, color: '#3e2731', bold: true });
      out.push({ room, x: x0, y, w, h: 8 });
    }
    return out;
  }

  function speech(str, px, py) {
    const w = Math.max(12, Math.ceil(measure(str)) + 7);
    const h = Math.max(12, Math.ceil((FONT_CSS * dprNow() * 1.15) / B.k) + 6);
    const minX = -SIDE_PX + 1;
    const maxX = B.layout.cols * TILE + SIDE_PX - 1 - w;
    const bx = Math.round(clamp(px - w / 2, minX, maxX));
    const by = Math.max(0, py - 3 - h);
    nineSlice(art, ctx, 'bubble-speech', bx, by, w, h);
    const tx = clamp(px - 2, bx + 3, bx + w - 7);
    art.draw(ctx, 'bubble-speech-tail', tx, by + h - 1);
    text(str, bx + w / 2, by + h / 2);
  }

  function thought(px, py, now) {
    const w = 16;
    const h = 12;
    const bx = Math.round(clamp(px - w / 2 + 3, -SIDE_PX + 1, B.layout.cols * TILE + SIDE_PX - 1 - w));
    const by = Math.max(0, py - 9 - h);
    nineSlice(art, ctx, 'bubble-thought', bx, by, w, h);
    art.draw(ctx, 'bubble-thought-puff-large', px - 1, py - 8);
    art.draw(ctx, 'bubble-thought-puff-small', px - 2, py - 3);
    // Drei Punkte, die nacheinander erscheinen.
    const n = still() ? 3 : Math.floor(now / 450) % 4;
    ctx.fillStyle = INK;
    for (let i = 0; i < n; i++) ctx.fillRect(bx + 4 + i * 3, by + 5, 2, 2);
  }

  function drawOverhead(f, now) {
    if (f.gone) return;
    const px = Math.round(f.x);
    const py = Math.round(f.y) - HEAD;
    const v = f.view ?? {};
    const emote = f.emote?.name ?? (f.seated || f.wait ? v.emote : null);
    if (emote) {
      const bob = still() || !f.emote ? 0 : Math.floor(now / 300) % 2;
      art.draw(ctx, `emote-${emote}`, px - 6, py - 12 - bob);
      return;
    }
    if (f.leaving || f.walk) return;
    if (v.speech && f.seated) speech(v.speech, px, py);
    else if (v.thought) thought(px, py, now);
    else if (v.sleep && f.seated) art.draw(ctx, art.frame('sleep-z', still() ? 0 : now + f.phase), px + 1, py - 10);
  }

  /* --- Licht ------------------------------------------------------------------ */

  let lightCv = null;
  let glowCv = null;
  let hourAt = -Infinity;

  /** Stunde der Ortszeit, hoechstens einmal je Sekunde berechnet. */
  function updateDaylight(t) {
    if (t - hourAt < 1000) return;
    hourAt = t;
    const d = new Date(clock());
    let h = d.getHours() + d.getMinutes() / 60;
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        hour: 'numeric',
        minute: 'numeric',
        hourCycle: 'h23',
        timeZone: timeZone(),
      }).formatToParts(d);
      h = Number(parts.find((p) => p.type === 'hour').value) + Number(parts.find((p) => p.type === 'minute').value) / 60;
    } catch {
      /* unbekannte Zeitzone: Ortszeit des Browsers */
    }
    B.daylight = daylight(h);
  }

  /** Licht in Stufen: hell innen, zwei Ringe, dann nichts - wie gemalt. */
  function rings(g, x, y, r, rgb, s) {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const c = (a) => `rgba(${rgb}, ${a})`;
    grad.addColorStop(0, c(s));
    grad.addColorStop(0.42, c(s));
    grad.addColorStop(0.43, c(s * 0.62));
    grad.addColorStop(0.72, c(s * 0.62));
    grad.addColorStop(0.73, c(s * 0.28));
    grad.addColorStop(1, c(0));
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }

  const canvasOf = (cv) => {
    const c = cv ?? document.createElement('canvas');
    if (c.width !== B.W || c.height !== B.H) {
      c.width = B.W;
      c.height = B.H;
    }
    return c;
  };

  /**
   * Dunkelheit nach Tageszeit als Lichtkarte, die das Bild multipliziert -
   * so bleiben die Farben satt statt grau. Lampen, Bildschirme und
   * Deckenlichter hellen sie auf; dazu ein farbiger Schein. In Grafikpixeln
   * berechnet und ohne Glaettung vergroessert, damit auch das Licht pixelig
   * bleibt.
   */
  function lighting() {
    const { a, rgb } = B.daylight;
    if (a > 0.01) {
      lightCv = canvasOf(lightCv);
      const g = lightCv.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-over';
      // Weiss laesst das Bild, wie es ist; die Nachtfarbe dunkelt ab.
      const t = Math.min(0.85, a * 1.3);
      g.fillStyle = `rgb(${rgb.map((v) => Math.round(255 + (v - 255) * t)).join(', ')})`;
      g.fillRect(0, 0, B.W, B.H);
      g.translate(SIDE_PX, 0);
      for (const l of B.lights) rings(g, l.x, l.y, l.r, '255, 255, 255', l.s);
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(lightCv, -SIDE_PX, 0);
      ctx.globalCompositeOperation = 'source-over';
    }
    // Farbiger Schein: tagsueber kaum, nachts deutlich.
    const glowA = 0.12 + a * 0.45;
    glowCv = canvasOf(glowCv);
    const g = glowCv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, B.W, B.H);
    g.translate(SIDE_PX, 0);
    for (const l of B.lights) {
      if (l.glow) rings(g, l.x, l.y, l.r * 0.8, rgb255(l.glow), glowA * l.s);
    }
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(glowCv, -SIDE_PX, 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  let plateRects = [];

  function draw(now) {
    if (!B.layout || !B.bg) return;
    const { k, layout: L } = B;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    // Deckend grundieren: die Lichtkarte multipliziert sonst Transparenz zu Hellem.
    ctx.fillStyle = SHADE;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.drawImage(B.bg, 0, 0);
    ctx.setTransform(k, 0, 0, k, SIDE_PX * k, 0);
    B.lights = [];
    drawScene(now);
    lighting();
    // Ruhen alle in einem Raum, wird er gedimmt (nachts ist er ohnehin dunkel).
    ctx.fillStyle = `rgba(24, 20, 37, ${(0.3 * (1 - B.daylight.a)).toFixed(3)})`;
    for (const room of L.rooms) {
      if (B.asleep.has(room.key)) ctx.fillRect(room.c0 * TILE, room.face * TILE, room.cols * TILE, (room.rows + WALL_ROWS) * TILE);
    }
    plateRects = plates();
    // Wer weiter unten steht, dessen Blase liegt oben.
    const figs = [...B.figs.values()].sort((a, b) => a.y - b.y);
    for (const f of figs) drawOverhead(f, now);
  }

  /* --- Ablauf -------------------------------------------------------------------- */

  // Ohne Boxen ist der Container (oder ein Vorfahr) ausgeblendet.
  const visible = () => !document.hidden && container.isConnected && container.getClientRects().length > 0;

  function loop(t) {
    raf = 0;
    if (!art || !visible() || !B.layout) return;
    const dt = lastT ? Math.min(100, t - lastT) : 16;
    lastT = t;
    B.directT += dt;
    if (B.directT >= 1000) {
      B.directT = 0;
      direct(t);
    }
    updateDaylight(t);
    for (const f of B.figs.values()) update(f, dt, t);
    for (const [id, f] of B.figs) {
      if (!f.gone) continue;
      B.figs.delete(id);
      if (f.view?.leaving) B.departed.add(id);
    }
    draw(t);
    raf = requestAnimationFrame(loop);
  }

  function kick() {
    if (raf || !art || !visible()) return;
    // Erst sichtbar weiss das Gebaeude, wie viel Platz es hat.
    if (B.layout) relayout(performance.now());
    lastT = 0;
    raf = requestAnimationFrame(loop);
  }
  document.addEventListener('visibilitychange', kick);

  const refit = () => {
    if (art && B.layout && visible()) relayout(performance.now());
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(refit).observe(container);
  window.addEventListener('resize', refit);

  /* --- Tooltip -------------------------------------------------------------------- */

  canvas.addEventListener('pointermove', (ev) => {
    if (!B.layout) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * B.W - SIDE_PX;
    const y = ((ev.clientY - rect.top) / rect.height) * B.H;
    let hit = null;
    for (const f of B.figs.values()) {
      if (f.gone) continue;
      if (x >= f.x - 7 && x <= f.x + 7 && y >= f.y - 30 && y <= f.y && (!hit || f.y > hit.y)) hit = f;
    }
    let textOut = null;
    let key = null;
    if (hit) {
      const room = B.layout.rooms.find((r) => r.key === hit.seat?.room);
      textOut = describe(hit.kind, { ...hit.item, project: room?.label ?? '' });
      key = hit.id;
    } else {
      const plate = plateRects.find((p) => x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h);
      if (plate) {
        const p = plate.room.project;
        const agents = p.sessions.reduce((n, s) => n + s.agents.length, 0);
        textOut = `${p.label}\n${p.sessions.length} ${p.sessions.length === 1 ? 'Sitzung' : 'Sitzungen'}${agents ? ` · ${agents} ${agents === 1 ? 'Subagent' : 'Subagents'}` : ''}\n${p.cwd ?? ''}`.trim();
        key = `room:${p.key}`;
      }
    }
    canvas.style.cursor = key ? 'pointer' : '';
    if (!key) {
      if (hovered) tooltip.hide();
      hovered = null;
      return;
    }
    if (hovered !== key) tooltip.show(ev, textOut);
    else tooltip.move(ev);
    hovered = key;
  });
  canvas.addEventListener('pointerleave', () => {
    hovered = null;
    canvas.style.cursor = '';
    tooltip.hide();
  });

  /* --- Schnittstelle ---------------------------------------------------------------- */

  function render(act, env = {}) {
    last = { act, env };
    if (!art || failed) return;
    if (root.parentNode !== container) container.replaceChildren(root);
    const now = performance.now();
    B.projects = act?.projects ?? [];
    B.limit = limitState(env?.fiveHour);
    B.asleep = new Set(B.projects.filter((p) => roomAsleep(p)).map((p) => p.key));
    relayout(now);
    const present = new Set();
    for (const p of B.projects) {
      for (const s of p.sessions) {
        present.add(take('session', s, now));
        for (const a of s.agents) present.add(take('agent', a, now));
      }
    }
    for (const f of B.figs.values()) {
      if (!present.has(f.id) && !f.leaving) leave(f, now, null);
    }
    empty.hidden = B.projects.length > 0;
    const sessions = B.projects.reduce((n, p) => n + p.sessions.length, 0);
    canvas.setAttribute(
      'aria-label',
      `Büro mit ${B.projects.length} ${B.projects.length === 1 ? 'Projektraum' : 'Projekträumen'} und ${sessions} ${sessions === 1 ? 'Sitzung' : 'Sitzungen'}`,
    );
    renderedOnce = true;
    kick();
  }

  return {
    render,
    /** Gezeichnet wird ohnehin laufend; nach dem Einblenden wieder anstossen. */
    tick: kick,
    setSound() {},
    /** Eine Besorgung von Hand anstossen (zum Ausprobieren und fuer Tests). */
    errand(id, name) {
      const f = B.figs.get(id);
      return f?.seated && !f.leaving ? startErrand(f, name, performance.now()) : false;
    },
    ready,
  };
}
