/*
 * Pixel-Buero: das Buero als Pixelgrafik auf Canvas 2D. Je Projekt ein Raum
 * aus Kacheln. Am Tisch arbeiten die Figuren mit Buch, Block oder Laptop - je
 * nach Werkzeug, mit Datei oder Befehl in der Sprechblase. Wer wartet, holt
 * Kaffee oder Wasser; wer lange nachdenkt, geht auf und ab; wer delegiert,
 * schaut bei seinen Subagents vorbei. Gegangen wird per Wegfindung, gekommen
 * und gegangen durch die Tuer.
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
  layoutRoom,
  roomSignature,
  findPath,
  walkable,
  feetOf,
  facing,
  figureView,
  pixelErrands,
  frameIndex,
  pixelScale,
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
const AWAY_MAX = 4;
/** Schriftgroesse in den Blasen (CSS-Pixel). */
const FONT_CSS = 11;
const FONT_FAMILY = 'ui-monospace, "Cascadia Mono", Consolas, monospace';
const INK = '#181425';
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
  return { atlas, draw, anim, frame, sprite: (n) => atlas.sprites[n] };
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
 * @param container  Element, das die Raeume aufnimmt
 * @param opts       { tooltip, describe(kind, item) -> string, emptyText? }
 * @returns {{ render(activity, env), tick(), setSound(on), ready: Promise }}
 */
export function createPixelOffice(
  container,
  { tooltip, describe, emptyText = 'Gerade ist keine Claude-Code-Sitzung offen – das Büro ist leer.' },
) {
  /** Raeume je Projekt. */
  const rooms = new Map();
  /** Bereits gezeigte Ereignisse - jedes nur einmal. */
  const seen = new Set();
  let art = null;
  let failed = null;
  let last = null;
  let renderedOnce = false;
  let empty = null;
  let raf = 0;
  let lastT = 0;
  let hovered = null;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const still = () => reduced?.matches === true;

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

  /* --- Raum anlegen und zeichnen ------------------------------------------- */

  function createRoom(project) {
    const root = document.createElement('div');
    root.className = 'px-room';
    const caption = document.createElement('div');
    caption.className = 'px-caption';
    const canvas = document.createElement('canvas');
    canvas.className = 'px-canvas';
    root.append(caption, canvas);
    const room = {
      key: project.key,
      project,
      root,
      caption,
      canvas,
      ctx: canvas.getContext('2d'),
      layout: null,
      sig: null,
      bg: null,
      k: 3,
      figs: new Map(),
      /** Beendete Subagents, die schon gegangen sind - nicht wieder hereinholen. */
      departed: new Set(),
      door: { level: 0, t: 0 },
      espresso: { since: -Infinity, until: -Infinity },
      cooler: { until: -Infinity },
      directT: 0,
      asleep: false,
      limit: 'unknown',
    };
    canvas.addEventListener('pointermove', (ev) => hoverAt(room, ev));
    canvas.addEventListener('pointerleave', () => {
      hovered = null;
      canvas.style.cursor = '';
      tooltip.hide();
    });
    return room;
  }

  /** Massstab und Canvas-Groesse passend zur verfuegbaren Breite. */
  function fit(room) {
    const L = room.layout;
    const W = L.cols * TILE + 2 * SIDE_PX;
    const H = L.rows * TILE;
    const dpr = window.devicePixelRatio || 1;
    const avail = container.clientWidth || W * 3;
    const k = pixelScale(W, avail, dpr);
    room.k = k;
    room.W = W;
    room.H = H;
    if (room.canvas.width !== W * k) room.canvas.width = W * k;
    if (room.canvas.height !== H * k) room.canvas.height = H * k;
    room.canvas.style.width = `${(W * k) / dpr}px`;
    room.canvas.style.height = `${(H * k) / dpr}px`;
  }

  /** Was sich nie bewegt: Boden, Teppich, Waende - einmal je Aufbau. */
  function buildBackground(room) {
    const L = room.layout;
    const bg = document.createElement('canvas');
    bg.width = room.W;
    bg.height = room.H;
    const g = bg.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.translate(SIDE_PX, 0);
    for (let r = WALL_ROWS; r < L.rows; r++) {
      for (let c = 0; c < L.cols; c++) art.draw(g, L.floor[r * L.cols + c], c * TILE, r * TILE);
    }
    if (L.rug) {
      const { col, row, w, h } = L.rug;
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          const v = r === 0 ? 'top' : r === h - 1 ? 'bottom' : '';
          const hz = c === 0 ? 'left' : c === w - 1 ? 'right' : '';
          const part = v && hz ? `${v}-${hz}` : v || hz || 'center';
          art.draw(g, `rug-${part}`, (col + c) * TILE, (row + r) * TILE);
        }
      }
    }
    for (let c = 0; c < L.cols; c++) {
      if (c === L.door.col) continue;
      const name =
        c === 0
          ? 'wall-end-left'
          : c === L.cols - 1
            ? 'wall-end-right'
            : c >= L.kitchen.counter.col - 1 && c <= L.kitchen.cooler.col + 1
              ? 'wall-wainscot'
              : 'wall-plain';
      art.draw(g, name, c * TILE, 0);
    }
    const right = L.cols * TILE - 12;
    art.draw(g, 'wall-outer-corner', -SIDE_PX, 0);
    art.draw(g, 'wall-outer-corner', right, 0, { flip: true });
    for (let y = TILE; y < room.H; y += TILE) {
      art.draw(g, 'wall-side-cap', -SIDE_PX, y);
      art.draw(g, 'wall-side-cap', right, y, { flip: true });
    }
    room.bg = bg;
  }

  /* --- Figuren --------------------------------------------------------------- */

  function seatOf(room, id) {
    return room.layout.seats.find((s) => s.id === id) ?? null;
  }

  function newFig(room, kind, item, seat, arriving) {
    const at = arriving ? feetOf(room.layout.door) : feetOf(seat);
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
    if (arriving) go(room, f, [{ walk: seat }, { sit: true }], performance.now());
    return f;
  }

  /** Neuer Plan: Schritte { walk: tile, speed? } | { wait: ms, face?, act? } | { sit } | { exit } | { run: fn }. */
  function go(room, f, plan, now) {
    f.plan = plan.slice();
    f.walk = null;
    f.wait = null;
    f.seated = false;
    next(room, f, now);
  }

  function next(room, f, now) {
    const s = f.plan.shift();
    if (!s) return;
    if (s.walk) {
      if (!startWalk(room, f, s.walk, s.speed ?? WALK_SPEED)) next(room, f, now);
    } else if (s.wait != null) {
      f.wait = { until: now + s.wait, act: s.act ?? null };
      if (s.face) f.dir = s.face;
      if (s.act === 'coffee') room.espresso = { since: now, until: now + s.wait };
      if (s.act === 'water') room.cooler.until = now + s.wait;
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
      next(room, f, now);
    }
  }

  /** Naechstgelegene Kachel (Figuren laufen auf den Kachelmitten). */
  const nearTile = (f) => ({ col: Math.round((f.x - TILE / 2) / TILE), row: Math.round((f.y - TILE) / TILE) });

  function startWalk(room, f, to, speed) {
    const from = nearTile(f);
    const path = findPath(room.layout, from, to);
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

  function update(room, f, dt, now) {
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
        next(room, f, now);
      }
    } else if (f.wait && now >= f.wait.until) {
      f.wait = null;
      next(room, f, now);
    }
    if (f.emote && now >= f.emote.until) f.emote = null;
  }

  /* --- Besorgungen ------------------------------------------------------------ */

  function randomSpot(room, f) {
    const L = room.layout;
    const seats = new Set(L.seats.map((s) => `${s.col},${s.row}`));
    const here = nearTile(f);
    for (let i = 0; i < 40; i++) {
      const col = Math.floor(Math.random() * L.cols);
      const row = WALL_ROWS + 1 + Math.floor(Math.random() * (L.rows - WALL_ROWS - 1));
      if (!walkable(L, col, row) || seats.has(`${col},${row}`)) continue;
      if (Math.abs(col - here.col) + Math.abs(row - here.row) < 4) continue;
      return { col, row };
    }
    return null;
  }

  function startErrand(room, f, name, now) {
    const L = room.layout;
    const home = { col: f.seat.col, row: f.seat.row };
    const back = [{ walk: home }, { sit: true }];
    let plan = null;
    if (name === 'coffee') {
      plan = [
        { walk: L.kitchen.coffee },
        { wait: rand(3500, 5000), face: 'back', act: 'coffee' },
        {
          run: (t) => {
            f.emote = { name: 'coffee', until: t + 1800 };
            f.coffeeUntil = t + 40_000;
          },
        },
        ...back,
      ];
    } else if (name === 'water') {
      plan = [{ walk: L.kitchen.water }, { wait: rand(2500, 4000), face: 'back', act: 'water' }, ...back];
    } else if (name === 'stroll') {
      const spot = randomSpot(room, f);
      if (spot) plan = [{ walk: spot }, { wait: rand(2000, 4000), face: 'front' }, ...back];
    } else if (name === 'pace') {
      // Hinter dem eigenen Tisch auf und ab.
      const row = home.row - 1;
      const cols = [-3, -2, 2, 3].map((d) => home.col + d).filter((c) => walkable(L, c, row));
      if (cols.length) {
        const a = cols[Math.floor(Math.random() * cols.length)];
        plan = [{ walk: { col: a, row } }, { wait: 700 }, { walk: { col: home.col, row } }, { wait: 500 }, ...back];
      }
    } else if (name === 'visit') {
      const busy = L.seats.filter((s) => {
        const a = room.figs.get(s.id);
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
              const other = room.figs.get(target.id);
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
    go(room, f, plan, now);
    return true;
  }

  /** Einmal je Sekunde: wer steht auf, wer muss zurueck? */
  function direct(room, now) {
    const figs = [...room.figs.values()].filter((f) => !f.leaving && !f.gone);
    for (const f of figs) {
      if (f.errand && !errandStillFits(f.errand, f.kind, f.state)) {
        f.errand = null;
        go(room, f, [{ walk: { col: f.seat.col, row: f.seat.row }, speed: HURRY_SPEED }, { sit: true }], now);
      }
    }
    if (still() || room.limit === 'reached') return;
    const away = figs.filter((f) => f.errand).length;
    const cap = Math.min(AWAY_MAX, Math.max(1, Math.floor(figs.length * AWAY_SHARE)));
    if (away >= cap) return;
    const agentsRunning = figs.filter((f) => f.kind === 'agent').length;
    for (const f of figs) {
      if (!f.seated || f.errand) continue;
      const opts = pixelErrands({ kind: f.kind, state: f.state, stateMs: now - f.stateSince }, { agentsRunning });
      if (!opts || Math.random() >= opts.rate) continue;
      if (startErrand(room, f, pickWeighted(opts.options), now)) return;
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

  function updateRoom(room, project, env, now) {
    room.project = project;
    room.limit = limitState(env?.fiveHour);
    room.asleep = roomAsleep(project);
    const sig = roomSignature(project);
    if (sig !== room.sig) {
      room.sig = sig;
      room.layout = layoutRoom(project);
      fit(room);
      buildBackground(room);
      // Tische sind umgezogen: wer sitzt, zieht mit; wer laeuft, geht zum neuen Platz.
      for (const f of room.figs.values()) {
        const seat = seatOf(room, f.id);
        if (!seat) continue;
        f.seat = seat;
        if (f.seated) {
          const p = feetOf(seat);
          f.x = p.x;
          f.y = p.y;
        } else if (!f.leaving && !f.errand) {
          go(room, f, [{ walk: seat }, { sit: true }], now);
        }
      }
    }
    const sessions = project.sessions.length;
    const agents = project.sessions.reduce((n, s) => n + s.agents.length, 0);
    room.caption.textContent = '';
    const name = document.createElement('strong');
    name.textContent = project.label;
    const meta = document.createElement('span');
    meta.textContent = [
      `${sessions} ${sessions === 1 ? 'Sitzung' : 'Sitzungen'}`,
      agents ? `${agents} ${agents === 1 ? 'Subagent' : 'Subagents'}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    room.caption.append(name, meta);
    room.canvas.setAttribute('role', 'img');
    room.canvas.setAttribute('aria-label', `Büro ${project.label}: ${meta.textContent}`);
    room.root.dataset.asleep = room.asleep ? '1' : '0';

    const present = new Set();
    const take = (kind, item) => {
      const id = kind === 'session' ? item.sessionId : item.id;
      const view = figureView(kind, item, { limit: room.limit });
      if (room.departed.has(id)) {
        if (view.leaving) return;
        room.departed.delete(id); // laeuft wieder (fortgesetzt)
      }
      present.add(id);
      let f = room.figs.get(id);
      const seat = seatOf(room, id);
      if (!f) {
        // Beim ersten Bild sitzen alle schon; spaeter kommt man durch die Tuer.
        f = newFig(room, kind, item, seat, renderedOnce && !still());
        room.figs.set(id, f);
      }
      f.item = item;
      f.seat = seat;
      if (view.state !== f.state) {
        f.state = view.state;
        f.stateSince = now;
      }
      f.view = view;
      if (kind === 'session') {
        flash(f, item.prompt, 'prompt', EVENT_FRESH_MS, 'alert', 2600, now);
        flash(f, item.error, 'error', EVENT_FRESH_MS, item.error?.kind === 'rate' ? 'sweat' : 'error', 6000, now);
        flash(f, item.celebration, 'celebrate', CELEBRATE_FRESH_MS, item.celebration?.kind === 'push' ? 'heart' : 'done', 3600, now);
      } else {
        flash(f, item.error, 'error', EVENT_FRESH_MS, item.error?.kind === 'rate' ? 'sweat' : 'error', 6000, now);
      }
      if (view.leaving && !f.leaving) leave(room, f, now, view.finish);
    };
    for (const s of project.sessions) {
      take('session', s);
      for (const a of s.agents) take('agent', a);
    }
    for (const f of room.figs.values()) {
      if (!present.has(f.id) && !f.leaving) leave(room, f, now, null);
    }
  }

  /** Aufstehen und durch die Tuer gehen; beim ersten Bild sofort weg. */
  function leave(room, f, now, finish) {
    f.leaving = true;
    f.errand = null;
    if (finish) f.emote = { name: finish, until: now + 4000 };
    if (!renderedOnce || still()) {
      f.gone = true;
      return;
    }
    go(room, f, [{ walk: room.layout.door }, { exit: true }], now);
  }

  /* --- Zeichnen --------------------------------------------------------------- */

  /** Stuhl, Figur am Tisch, Tisch, Lampe, Tasse, Requisit und Haende. */
  function drawDesk(room, seat, f, now) {
    const { ctx } = room;
    const p = feetOf(seat);
    const L = art.atlas.mountPoints[seat.desk];
    const dx = seat.desk === 'desk-large' ? p.x - 24 : p.x - 16;
    const dy = p.y - 16;
    const fx = p.x - 8;
    const fy = p.y - 32;
    const seated = f && f.seated && !f.gone;
    const pose = seated ? f.view?.pose ?? 'type' : null;
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
      if (f && !f.gone && Math.abs(f.x - p.x) < 1 && Math.abs(f.y - p.y) < 6) drawFigure(room, f, now);
    }
    art.draw(ctx, seat.desk, dx, dy);
    if (L.lamp) art.draw(ctx, f?.view?.lamp && !room.asleep ? 'lamp-on' : 'lamp-off', dx + L.lamp[0], dy + L.lamp[1]);
    if (L.mug) {
      const steaming = f && f.coffeeUntil > now && !still();
      art.draw(ctx, steaming ? art.frame('mug-steam', now) : 'mug-idle', dx + L.mug[0], dy + L.mug[1]);
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
      art.draw(ctx, open ? 'laptop-back-open' : 'laptop-closed', dx + L.laptop[0], dy + L.laptop[1]);
    }
    if (seated) {
      const s = art.sprite(figName);
      if (s?.foregroundImage) art.draw(ctx, figName, fx, fy, { image: s.foregroundImage });
    }
  }

  function drawFigure(room, f, now) {
    const { ctx } = room;
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
    art.draw(ctx, name, Math.round(f.x) - 8, Math.round(f.y) - 32, { outfit: f.outfit, flip });
  }

  function drawScene(room, now) {
    const { ctx, layout: L } = room;
    const items = [];
    // Tuer: oeffnet, solange jemand davor oder darin steht.
    const near = [...room.figs.values()].some(
      (f) => !f.gone && !f.seated && Math.abs(f.x - feetOf(L.door).x) < TILE && f.y <= feetOf(L.entry).y + TILE / 2,
    );
    const want = near ? 2 : 0;
    if (room.door.level !== want && now - room.door.t > 120) {
      room.door.level += Math.sign(want - room.door.level);
      room.door.t = now;
    }
    const doorName = ['door-wood-closed', 'door-wood-half-open', 'door-wood-open'][room.door.level];
    items.push({ y: WALL_ROWS * TILE, z: 0, draw: () => art.draw(ctx, doorName, L.door.col * TILE, 0) });

    const k = L.kitchen;
    const base = (k.counter.row + 1) * TILE;
    const brewing = now < room.espresso.until;
    items.push({
      y: base,
      z: 0,
      draw: () => {
        const cx = k.counter.col * TILE;
        const cy = base - 24;
        const m = art.atlas.mountPoints['kitchen-counter'];
        art.draw(ctx, 'kitchen-counter', cx, cy);
        art.draw(ctx, brewing ? art.frame('espresso', now - room.espresso.since) : 'espresso-idle', cx + m.espresso[0], cy + m.espresso[1]);
        art.draw(ctx, 'tray-mugs', cx + m.tray[0], cy + m.tray[1]);
        art.draw(ctx, 'fridge', k.fridge.col * TILE, base - 32);
        art.draw(ctx, now < room.cooler.until ? art.frame('cooler-bubble', now) : 'cooler-bubble-1', k.cooler.col * TILE, base - 32);
      },
    });

    const atDesk = new Set();
    for (const seat of L.seats) {
      const f = room.figs.get(seat.id);
      if (f && !f.seated && !f.gone && Math.abs(f.x - feetOf(seat).x) < 1 && Math.abs(f.y - feetOf(seat).y) < 6) atDesk.add(f);
      items.push({ y: seat.row * TILE + 24, z: 0, draw: () => drawDesk(room, seat, f, now) });
    }
    for (const f of room.figs.values()) {
      if (f.gone || f.seated || atDesk.has(f)) continue;
      items.push({ y: f.y, z: 1, draw: () => drawFigure(room, f, now) });
    }
    items.sort((a, b) => a.y - b.y || a.z - b.z);
    for (const it of items) it.draw();
  }

  /* --- Blasen und Symbole ------------------------------------------------------- */

  function fontDev() {
    return Math.round(FONT_CSS * (window.devicePixelRatio || 1));
  }

  function speech(room, text, px, py) {
    const { ctx, k } = room;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `${fontDev()}px ${FONT_FAMILY}`;
    const tw = ctx.measureText(text).width;
    ctx.restore();
    const w = Math.max(12, Math.ceil(tw / k) + 7);
    const h = Math.max(12, Math.ceil((fontDev() * 1.15) / k) + 6);
    const minX = -SIDE_PX + 1;
    const maxX = room.layout.cols * TILE + SIDE_PX - 1 - w;
    const bx = Math.round(clamp(px - w / 2, minX, maxX));
    const by = Math.max(0, py - 3 - h);
    nineSlice(art, ctx, 'bubble-speech', bx, by, w, h);
    const tx = clamp(px - 2, bx + 3, bx + w - 7);
    art.draw(ctx, 'bubble-speech-tail', tx, by + h - 1);
    // Text in voller Aufloesung, mittig in der Blase.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `${fontDev()}px ${FONT_FAMILY}`;
    ctx.fillStyle = INK;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(text, (SIDE_PX + bx + w / 2) * k, (by + h / 2) * k + 1);
    ctx.restore();
  }

  function thought(room, px, py, now) {
    const { ctx } = room;
    const w = 16;
    const h = 12;
    const bx = Math.round(clamp(px - w / 2 + 3, -SIDE_PX + 1, room.layout.cols * TILE + SIDE_PX - 1 - w));
    const by = Math.max(0, py - 9 - h);
    nineSlice(art, ctx, 'bubble-thought', bx, by, w, h);
    art.draw(ctx, 'bubble-thought-puff-large', px - 1, py - 8);
    art.draw(ctx, 'bubble-thought-puff-small', px - 2, py - 3);
    // Drei Punkte, die nacheinander erscheinen.
    const n = still() ? 3 : (Math.floor(now / 450) % 4);
    ctx.fillStyle = INK;
    for (let i = 0; i < n; i++) ctx.fillRect(bx + 4 + i * 3, by + 5, 2, 2);
  }

  function drawOverhead(room, f, now) {
    if (f.gone) return;
    const { ctx } = room;
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
    if (v.speech && f.seated) speech(room, v.speech, px, py);
    else if (v.thought) thought(room, px, py, now);
    else if (v.sleep && f.seated) art.draw(ctx, art.frame('sleep-z', still() ? 0 : now + f.phase), px + 1, py - 10);
  }

  function draw(room, now) {
    if (!room.layout || !room.bg) return;
    const { ctx, k } = room;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, room.canvas.width, room.canvas.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.drawImage(room.bg, 0, 0);
    ctx.setTransform(k, 0, 0, k, SIDE_PX * k, 0);
    drawScene(room, now);
    if (room.asleep) {
      // Alle ruhen: der Raum wird gedimmt, nur die z steigen weiter auf.
      ctx.fillStyle = 'rgba(24, 20, 37, 0.32)';
      ctx.fillRect(-SIDE_PX, 0, room.W, room.H);
    }
    // Wer weiter unten steht, dessen Blase liegt oben.
    const figs = [...room.figs.values()].sort((a, b) => a.y - b.y);
    for (const f of figs) drawOverhead(room, f, now);
  }

  /* --- Ablauf -------------------------------------------------------------------- */

  // Ohne Boxen ist der Container (oder ein Vorfahr) ausgeblendet.
  const visible = () => !document.hidden && container.isConnected && container.getClientRects().length > 0;

  function loop(t) {
    raf = 0;
    if (!art || !visible()) return;
    const dt = lastT ? Math.min(100, t - lastT) : 16;
    lastT = t;
    for (const room of rooms.values()) {
      if (!room.layout) continue;
      room.directT += dt;
      if (room.directT >= 1000) {
        room.directT = 0;
        direct(room, t);
      }
      for (const f of room.figs.values()) update(room, f, dt, t);
      for (const [id, f] of room.figs) {
        if (f.gone) {
          room.figs.delete(id);
          if (f.view?.leaving) room.departed.add(id);
        }
      }
      draw(room, t);
    }
    raf = requestAnimationFrame(loop);
  }

  function kick() {
    if (raf || !art || !visible()) return;
    lastT = 0;
    raf = requestAnimationFrame(loop);
  }
  document.addEventListener('visibilitychange', kick);

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
      for (const room of rooms.values()) {
        if (!room.layout) continue;
        fit(room);
        buildBackground(room);
      }
    }).observe(container);
  }

  /* --- Tooltip -------------------------------------------------------------------- */

  function hoverAt(room, ev) {
    if (!room.layout) return;
    const rect = room.canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * room.W - SIDE_PX;
    const y = ((ev.clientY - rect.top) / rect.height) * room.H;
    let hit = null;
    for (const f of room.figs.values()) {
      if (f.gone) continue;
      if (x >= f.x - 7 && x <= f.x + 7 && y >= f.y - 30 && y <= f.y && (!hit || f.y > hit.y)) hit = f;
    }
    room.canvas.style.cursor = hit ? 'pointer' : '';
    if (!hit) {
      if (hovered) tooltip.hide();
      hovered = null;
      return;
    }
    const text = describe(hit.kind, { ...hit.item, project: room.project.label });
    if (hovered !== hit.id) tooltip.show(ev, text);
    else tooltip.move(ev);
    hovered = hit.id;
  }

  /* --- Schnittstelle ---------------------------------------------------------------- */

  function render(act, env = {}) {
    last = { act, env };
    if (!art || failed) return;
    const now = performance.now();
    const projects = act?.projects ?? [];
    if (!projects.length) {
      for (const room of rooms.values()) room.root.remove();
      rooms.clear();
      if (!empty) {
        empty = document.createElement('p');
        empty.className = 'chart-empty';
        empty.textContent = emptyText;
      }
      if (empty.parentNode !== container) container.append(empty);
      renderedOnce = true;
      return;
    }
    if (empty?.parentNode) empty.remove();
    const keep = new Set();
    for (const p of projects) {
      keep.add(p.key);
      let room = rooms.get(p.key);
      if (!room) {
        room = createRoom(p);
        rooms.set(p.key, room);
      }
      updateRoom(room, p, env, now);
      container.append(room.root); // Reihenfolge wie im Snapshot
    }
    for (const [key, room] of rooms) {
      if (keep.has(key)) continue;
      room.root.remove();
      rooms.delete(key);
    }
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
      for (const room of rooms.values()) {
        const f = room.figs.get(id);
        if (f?.seated && !f.leaving) return startErrand(room, f, name, performance.now());
      }
      return false;
    },
    ready,
  };
}
