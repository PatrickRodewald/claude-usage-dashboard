/**
 * Pixel-Buero ohne DOM (public/pixel/world.js): Grundriss des Gebaeudes,
 * Wegfindung, was jede Figur zeigt - und ob alles, was der Renderer zeichnet,
 * im Atlas steht.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  TILE,
  WALL_ROWS,
  SPINE,
  KITCHEN,
  layoutBuilding,
  buildingSignature,
  findPath,
  walkable,
  roomAt,
  feetOf,
  tileAt,
  facing,
  poseFor,
  speechText,
  figureView,
  pixelErrands,
  frameIndex,
  pixelScale,
  daylight,
  corridorLights,
  OUTFITS,
  KEY_COLORS,
  outfitFor,
  lookFor,
  windowSprite,
  FURNITURE,
  WALL_ART,
} from '../public/pixel/world.js';
import { ERRAND_IDLE_MS, PACE_AFTER_MS, VISIT_AFTER_MS } from '../public/agents.js';

const atlas = JSON.parse(fs.readFileSync(new URL('../public/assets/office/atlas.json', import.meta.url), 'utf8'));

const session = (id, agents = [], extra = {}) => ({
  sessionId: id,
  status: 'busy',
  doing: { kind: 'thinking' },
  agents,
  ...extra,
});
const agent = (id, extra = {}) => ({ id, type: 'general-purpose', state: 'running', tool: null, parentId: null, ...extra });
const project = (...sessions) => ({ key: 'p', label: 'p', sessions });
const named = (key, ...sessions) => ({ key, label: key, sessions });
const many = (n, p) => Array.from({ length: n }, (_, i) => agent(`${p}${i}`));

test('ein Gebaeude: Eingang, Flur, gemeinsame Kueche und ein Raum je Projekt', () => {
  const L = layoutBuilding([project(session('s1'))]);
  assert.deepEqual(L.rooms.map((r) => r.kind), ['kitchen', 'project']);
  assert.equal(L.rooms[0].key, KITCHEN);
  assert.equal(L.bands.length, 1);
  assert.ok(walkable(L, L.entrance.col, L.entrance.row), 'der Eingang ist ein Durchgang');
  assert.ok(!walkable(L, L.entrance.col + 1, L.entrance.row), 'die Aussenwand daneben nicht');
  assert.equal(L.floor[L.entry.row * L.cols + L.entry.col], 'hallway', 'hinter dem Eingang liegt der Flur');
  for (const room of L.rooms) {
    // Die Tuer fuehrt durch die Rueckwand: beide Wandreihen begehbar, daneben Wand.
    for (let r = room.face; r < room.face + WALL_ROWS; r++) {
      assert.ok(walkable(L, room.door.col, r), `${room.key}: Tuer in Reihe ${r}`);
      assert.ok(!walkable(L, room.door.col === room.c0 ? room.door.col + 1 : room.door.col - 1, r), `${room.key}: Wand neben der Tuer`);
    }
    assert.equal(room.door.row, room.face);
  }
  const [seat] = L.seats;
  assert.deepEqual([seat.kind, seat.desk, seat.room], ['session', 'desk-large', 'p']);
  assert.ok(!walkable(L, L.kitchen.counter.col, L.kitchen.counter.row), 'die Theke steht im Weg');
  assert.deepEqual(L.rugs, [], 'ohne Subagents kein Teppich');
});

test('jeder Platz ist vom Eingang und von der Kueche aus erreichbar, auch ueber mehrere Reihen', () => {
  const projects = [
    named('A', session('a', many(6, 'a'))),
    named('B', session('b')),
    named('C', session('c1'), session('c2', many(2, 'c'))),
    named('D', session('d')),
  ];
  const L = layoutBuilding(projects, 30);
  assert.ok(L.bands.length > 1, 'schmal: mehrere Reihen');
  assert.ok(L.cols <= 30, `hoechstens 30 Kacheln breit, nicht ${L.cols}`);
  assert.equal(L.seats.length, 5 + 8);
  for (const s of L.seats) {
    assert.ok(findPath(L, L.entrance, s), `vom Eingang: ${s.id}`);
    assert.ok(findPath(L, s, L.kitchen.coffee), `zur Kueche: ${s.id}`);
    assert.ok(findPath(L, s, L.kitchen.water), `zum Wasser: ${s.id}`);
    assert.equal(roomAt(L, s.col, s.row)?.key, s.room, `${s.id} sitzt in seinem Raum`);
  }
  assert.equal(new Set(L.seats.map((s) => `${s.col},${s.row}`)).size, L.seats.length, 'kein Platz doppelt');
  // Subagents sitzen auf einem Teppich in ihrem Raum.
  for (const s of L.seats.filter((x) => x.kind === 'agent')) {
    const rug = L.rugs.find((g) => s.col >= g.col && s.col < g.col + g.w && s.row >= g.row && s.row < g.row + g.h);
    assert.ok(rug, `Teppich unter ${s.id}`);
    const room = L.rooms.find((r) => r.key === s.room);
    assert.ok(rug.col >= room.c0 && rug.col + rug.w <= room.c0 + room.cols, 'Teppich bleibt im Raum');
    assert.ok(rug.row + rug.h <= room.r0 + room.rows);
  }
  // Raeume ueberlappen nicht und bleiben im Gebaeude.
  const cells = new Set();
  for (const r of L.rooms) {
    assert.ok(r.c0 >= SPINE && r.c0 + r.cols <= L.cols && r.r0 + r.rows <= L.rows, `${r.key} im Gebaeude`);
    for (let y = r.r0; y < r.r0 + r.rows; y++) {
      for (let x = r.c0; x < r.c0 + r.cols; x++) {
        assert.ok(!cells.has(`${x},${y}`), `${r.key} ueberlappt bei ${x},${y}`);
        cells.add(`${x},${y}`);
      }
    }
  }
});

test('Waende trennen die Raeume: von Raum zu Raum geht es durch Tueren und Flur', () => {
  const L = layoutBuilding([named('A', session('a')), named('B', session('b'))]);
  const [, A, B] = L.rooms;
  assert.equal(A.c0 + A.cols, B.c0, 'nebeneinander');
  // Zwei freie Kacheln direkt an der Wand zwischen A und B (die Ecken koennen moebliert sein).
  const row = [...Array(A.rows).keys()]
    .map((i) => A.r0 + i)
    .find((r) => walkable(L, A.c0 + A.cols - 1, r) && walkable(L, B.c0, r));
  assert.ok(row != null, 'an der Trennwand ist irgendwo Platz');
  const left = { col: A.c0 + A.cols - 1, row };
  const right = { col: B.c0, row };
  const path = findPath(L, left, right);
  assert.ok(path.length > 1, 'kein Schritt durch die Wand');
  assert.ok(path.some((t) => !roomAt(L, t.col, t.row)), 'der Weg fuehrt ueber den Flur');
  assert.ok(path.some((t) => t.col === A.door.col && t.row === A.face), 'durch die eigene Tuer hinaus');
  assert.ok(path.some((t) => t.col === B.door.col && t.row === B.face), 'durch die andere Tuer hinein');
  // Auch die Kueche ist ein eigener Raum.
  const k = findPath(L, L.seats[0], L.kitchen.coffee);
  assert.ok(k.length > 1 && k.some((t) => !roomAt(L, t.col, t.row)));
});

test('Einrichtung: Moebel versperren keinen Weg, stehen auf dem Boden und nie auf einem Platz', () => {
  let seed = 11;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let iter = 0; iter < 150; iter++) {
    const projects = Array.from({ length: Math.floor(rnd() * 6) }, (_, p) =>
      named(
        `${rnd() < 0.5 ? 'p' : 'projekt-mit-langem-namen-'}${p}`,
        ...Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, s) => session(`p${p}s${s}`, many(Math.floor(rnd() * 9), `p${p}s${s}a`))),
      ),
    );
    const L = layoutBuilding(projects, 10 + Math.floor(rnd() * 70));
    const targets = [...L.seats, L.kitchen.coffee, L.kitchen.water, L.lounge.kicker.left, L.lounge.kicker.right, ...L.lounge.sofa.map((s) => s.from)];
    for (const t of targets) assert.ok(findPath(L, L.entrance, t), `${iter}: ${JSON.stringify(t)} erreichbar`);
    const taken = new Set();
    for (const it of L.items) {
      for (let c = it.col; c < it.col + it.w; c++) {
        const key = `${c},${it.row}`;
        assert.ok(!taken.has(key), `${iter}: ${it.name} steht nicht auf anderem`);
        taken.add(key);
        assert.ok(L.floor[it.row * L.cols + c], `${iter}: ${it.name} steht auf dem Boden`);
        assert.equal(roomAt(L, c, it.row), roomAt(L, it.col, it.row), `${iter}: ${it.name} in einem Raum`);
      }
    }
    for (const s of L.seats) assert.ok(!taken.has(`${s.col},${s.row}`), `${iter}: Platz ${s.id} frei`);
  }
});

test('gleiche Projekte, gleiche Einrichtung - egal in welcher Reihenfolge der Server sie meldet', () => {
  const a = named('alpha', session('a1', many(3, 'x')));
  const b = named('beta', session('b1'), session('b2'));
  const one = layoutBuilding([a, b], 40);
  const two = layoutBuilding([b, a], 40);
  assert.deepEqual(two.rooms.map((r) => r.key), one.rooms.map((r) => r.key), 'Raeume nach Namen');
  assert.deepEqual(two.items, one.items);
  assert.deepEqual(two.wall, one.wall);
  assert.equal(buildingSignature([a, b]), buildingSignature([b, a]), 'kein Umbau, nur weil ein Projekt anfaengt zu arbeiten');
  // Kueche und Lounge stehen fest, auch wenn die Reihe hoeher wird.
  const tall = layoutBuilding([named('alpha', session('a1', many(8, 'x')))], 40);
  assert.deepEqual(tall.kitchen, one.kitchen);
  assert.deepEqual(tall.lounge, one.lounge);
});

test('Wandschmuck: an einer Wand, nicht ueber Tueren und nicht ueber dem Namensschild', () => {
  const L = layoutBuilding([named('claude-usage-dashboard', session('a', many(4, 'a')), session('b')), named('x', session('c'))], 60);
  const kinds = new Set(L.wall.map((w) => w.kind));
  for (const k of ['window', 'clock', 'tv', 'calendar', 'whiteboard']) assert.ok(kinds.has(k), `${k} haengt`);
  for (const w of L.wall) {
    const c0 = w.x / TILE;
    const c1 = c0 + w.w / TILE - 1;
    const face = L.faces.find((f) => w.y >= f.row * TILE && w.y + w.h <= (f.row + WALL_ROWS) * TILE && c0 >= f.c0 && c1 <= f.c1);
    assert.ok(face, `${w.name} auf einer Wand`);
    for (const d of L.doors) assert.ok(d.row !== face.row || d.col < c0 || d.col > c1, `${w.name} nicht ueber einer Tuer`);
    const room = L.rooms.find((r) => r.key === w.room);
    if (room?.kind === 'project') assert.ok(c0 > room.door.col + room.plateCols, `${w.name} rechts vom Schild`);
  }
  assert.ok(L.wall.filter((w) => w.kind === 'window').every((w) => w.y < WALL_ROWS * TILE), 'Fenster in der Aussenwand');
});

test('Fenster nach Tageszeit', () => {
  assert.equal(windowSprite(12), 'window-day');
  assert.equal(windowSprite(6), 'window-dawn');
  assert.equal(windowSprite(18), 'window-dusk');
  assert.equal(windowSprite(23), 'window-night');
  assert.equal(windowSprite(2), 'window-night');
  assert.equal(windowSprite(26), 'window-night');
});

test('Looks: fest je Figur, Sitzungen und Subagents getrennt', () => {
  assert.equal(lookFor('session', { sessionId: 's1' }), lookFor('session', { sessionId: 's1' }));
  const sessions = new Set(Array.from({ length: 40 }, (_, i) => lookFor('session', { sessionId: `s${i}` })));
  const agents = new Set(Array.from({ length: 40 }, (_, i) => lookFor('agent', { id: `a${i}` })));
  assert.equal(sessions.size, 3, 'drei Gesichter fuer Sitzungen');
  assert.equal(agents.size, 3, 'drei fuer Subagents');
  for (const look of sessions) assert.ok(!agents.has(look), `${look} nur einmal vergeben`);
  for (const look of [...sessions, ...agents]) assert.equal(atlas.characters[look]?.role, sessions.has(look) ? 'main-session' : 'subagent');
});

test('Reihen: Restbreite wird geteilt, ein breiter Raum bekommt trotzdem Platz', () => {
  const wide = named('W', session('w1', many(4, 'w')), session('w2', many(4, 'v')), session('w3'));
  const L = layoutBuilding([named('A', session('a')), wide], 20);
  assert.ok(L.cols > 20, 'der breite Raum passt nicht in 20 Kacheln - dann eben breiter');
  const total = (band) => L.rooms.filter((r) => r.band === band).reduce((n, r) => n + r.cols, 0);
  for (let b = 0; b < L.bands.length; b++) assert.equal(total(b), L.cols - SPINE, `Reihe ${b} fuellt die Breite`);
  const one = layoutBuilding([named('A', session('a')), named('B', session('b'))]);
  assert.equal(one.bands.length, 1, 'ohne Grenze eine Reihe');
});

test('Wegfindung: kuerzester Weg, schon da, unerreichbar', () => {
  const L = layoutBuilding([project(session('s1'))]);
  const from = { col: 3, row: L.bands[0].corridor };
  const to = { col: 10, row: L.bands[0].corridor + 1 };
  const path = findPath(L, from, to);
  assert.equal(path.length, 7 + 1, 'freier Flur: Manhattan-Abstand');
  assert.deepEqual(path[path.length - 1], to);
  for (let i = 1; i < path.length; i++) {
    const d = Math.abs(path[i].col - path[i - 1].col) + Math.abs(path[i].row - path[i - 1].row);
    assert.equal(d, 1, 'nur Nachbarkacheln');
  }
  assert.deepEqual(findPath(L, from, from), []);
  assert.equal(findPath(L, from, { col: 5, row: 0 }), null, 'in die Wand geht es nicht');
  assert.equal(findPath(L, { col: -3, row: 2 }, from), null, 'von ausserhalb nicht');
});

test('Kachel und Fusspunkt passen zusammen; Blickrichtung je Schritt', () => {
  const t = { col: 4, row: 6 };
  const p = feetOf(t);
  assert.deepEqual(p, { x: 4 * TILE + 8, y: 7 * TILE });
  assert.deepEqual(tileAt(p.x, p.y), t);
  assert.equal(facing(3, 0), 'right');
  assert.equal(facing(-3, 1), 'left');
  assert.equal(facing(0, 2), 'front');
  assert.equal(facing(0, -2), 'back');
  assert.equal(facing(0, 0, 'left'), 'left', 'im Stand bleibt die Richtung');
});

test('Haltung und Sprechblase je Werkzeug', () => {
  assert.equal(poseFor('read'), 'read');
  assert.equal(poseFor('search'), 'read');
  assert.equal(poseFor('write'), 'write');
  assert.equal(poseFor('shell'), 'type');
  assert.equal(poseFor('think'), 'think');
  assert.equal(poseFor(undefined), 'type');
  assert.equal(speechText('Read', 'app.js'), 'Read app.js');
  assert.equal(speechText('Bash', 'npm test'), '$ npm test');
  assert.equal(speechText('Agent', 'Tests schreiben'), '→ Tests schreiben');
  assert.equal(speechText('Agent', null), 'delegiert');
  assert.equal(speechText('mcp__claude_ai_Notion__notion-search', null), 'notion-search');
  const long = speechText('Edit', 'a-very-long-file-name-that-does-not-fit.js', 20);
  assert.equal(long.length, 20);
  assert.ok(long.endsWith('…'));
});

test('was eine Sitzung zeigt', () => {
  const idle = figureView('session', session('s', [], { status: 'idle', doing: { kind: 'idle' } }));
  assert.deepEqual([idle.state, idle.pose, idle.sleep, idle.lamp], ['idle', 'sleep', true, false]);
  const read = figureView('session', session('s', [], { doing: { kind: 'tool', tool: 'Read', target: 'app.js' } }));
  assert.deepEqual([read.state, read.pose, read.speech], ['tool', 'read', 'Read app.js']);
  const test_ = figureView('session', session('s', [], { doing: { kind: 'tool', tool: 'Bash', detail: 'test', target: 'npm test' } }));
  assert.deepEqual([test_.pose, test_.speech], ['type', '$ npm test']);
  const think = figureView('session', session('s'));
  assert.deepEqual([think.state, think.pose, think.thought, think.speech], ['thinking', 'think', true, null]);
  const del = figureView('session', session('s', [], { doing: { kind: 'delegating', tool: 'Agent', target: 'Suche' } }));
  assert.deepEqual([del.state, del.speech], ['delegating', '→ Suche']);
  const stale = figureView('session', session('s', [], { status: 'stale' }));
  assert.equal(stale.emote, 'question');
  const limit = figureView('session', session('s', [], { doing: { kind: 'tool', tool: 'Read' } }), { limit: 'reached' });
  assert.deepEqual([limit.emote, limit.speech, limit.pose], ['waiting', null, 'sleep'], 'Zwangspause');
});

test('was ein Subagent zeigt; beendete gehen', () => {
  const grep = figureView('agent', agent('a', { tool: 'Grep', toolTarget: 'TODO' }));
  assert.deepEqual([grep.state, grep.pose, grep.speech], ['tool', 'read', 'Grep TODO']);
  const long = figureView('agent', agent('a', { tool: 'Grep', toolTarget: 'createWorkshop' }));
  assert.equal(long.speech, 'Grep createWorksh…', 'Subagent-Tische stehen eng: kuerzere Blasen');
  assert.equal(figureView('agent', agent('a')).thought, true);
  const done = figureView('agent', agent('a', { state: 'completed' }));
  assert.deepEqual([done.leaving, done.finish], [true, 'done']);
  assert.equal(figureView('agent', agent('a', { state: 'failed' })).finish, 'error');
  assert.equal(figureView('agent', agent('a', { state: 'stopped' })).finish, null);
  const gone = figureView('agent', agent('a', { state: 'completed' }), { limit: 'reached' });
  assert.equal(gone.emote, null, 'wer geht, wartet nicht aufs Limit');
});

test('Besorgungen: Kaffee nach einer Weile, auf und ab beim Nachdenken, Besuch beim Delegieren', () => {
  assert.equal(pixelErrands({ kind: 'session', state: 'idle', stateMs: ERRAND_IDLE_MS - 1 }), null);
  const idle = pixelErrands({ kind: 'session', state: 'idle', stateMs: ERRAND_IDLE_MS });
  assert.deepEqual(idle.options.map(([n]) => n), ['coffee', 'water', 'stroll', 'sofa', 'kicker']);
  assert.deepEqual(pixelErrands({ kind: 'agent', state: 'thinking', stateMs: PACE_AFTER_MS }).options, [['pace', 1]]);
  assert.equal(pixelErrands({ kind: 'session', state: 'delegating', stateMs: VISIT_AFTER_MS }, { agentsRunning: 0 }), null);
  assert.deepEqual(
    pixelErrands({ kind: 'session', state: 'delegating', stateMs: VISIT_AFTER_MS }, { agentsRunning: 2 }).options,
    [['visit', 1]],
  );
  assert.equal(pixelErrands({ kind: 'session', state: 'tool', stateMs: 60_000 }), null, 'wer arbeitet, bleibt sitzen');
});

test('Animationsbild und Massstab', () => {
  const loop = { frames: 3, frameDurationMs: 100, loop: true, states: ['a', 'b', 'c'] };
  assert.deepEqual([0, 99, 100, 250, 300].map((t) => frameIndex(loop, t)), [0, 0, 1, 2, 0]);
  const once = { frames: 3, frameDurationMs: 100, loop: false, states: ['a', 'b', 'c'] };
  assert.equal(frameIndex(once, 5000), 2, 'einmalige Animation bleibt am Ende');
  assert.equal(pixelScale(232, 1500, 1), 3);
  assert.equal(pixelScale(232, 500, 1), 2, 'schmal: kleiner, aber ganzzahlig');
  assert.equal(pixelScale(232, 1500, 1.25), 4, '125 %: 4 Geraetepixel je Grafikpixel');
  assert.equal(pixelScale(232, 100, 1), 1, 'nie kleiner als 1');
});

test('Tageslicht: tagsueber hell, abends violett, nachts dunkel, morgens heller', () => {
  assert.equal(daylight(12).a, 0);
  assert.equal(daylight(8).a, 0);
  assert.ok(daylight(18).a > 0 && daylight(18).a < daylight(20).a, 'es wird abends dunkler');
  assert.ok(daylight(23).a >= daylight(20).a);
  assert.equal(daylight(2).a, daylight(23).a, 'die Nacht ist gleich dunkel');
  assert.ok(daylight(6).a < daylight(5).a && daylight(6).a > 0, 'morgens wird es heller');
  assert.equal(daylight(26).a, daylight(2).a, 'Stunden ueber 24 laufen um');
  for (const h of [0, 6, 12, 18, 20, 23.9]) {
    const { rgb, a } = daylight(h);
    assert.equal(rgb.length, 3);
    assert.ok(a >= 0 && a < 1);
  }
});

test('Deckenlampen haengen in jedem Flur und im Laengsflur', () => {
  const L = layoutBuilding([named('A', session('a')), named('B', session('b'))], 20);
  const lights = corridorLights(L, 5);
  for (const b of L.bands) assert.ok(lights.some((p) => p.y === (b.corridor + 1) * TILE), 'Flur einer Reihe');
  for (const p of lights) {
    const t = tileAt(p.x, p.y);
    assert.equal(L.floor[t.row * L.cols + t.col], 'hallway', 'Lampen nur ueber dem Flur');
  }
});

test('Kleidung: Farben aus der Palette, stabil je Sitzung und Typ', () => {
  const gpl = fs.readFileSync(new URL('../art/palettes/endesga-32.gpl', import.meta.url), 'utf8');
  const palette = new Set([...gpl.matchAll(/#([0-9a-f]{6})/gi)].map((m) => `#${m[1].toLowerCase()}`));
  assert.equal(palette.size, 32);
  for (const [name, colors] of Object.entries(OUTFITS)) {
    assert.equal(colors.length, 3, name);
    for (const c of colors) assert.ok(palette.has(c), `${name}: ${c} gehoert zu ENDESGA 32`);
  }
  assert.deepEqual(OUTFITS.blue, KEY_COLORS, 'Blau ist die Originalfarbe');
  assert.deepEqual(KEY_COLORS, [atlas.characterPaletteSwap.light, atlas.characterPaletteSwap.mid, atlas.characterPaletteSwap.dark]);
  assert.equal(outfitFor('session', { sessionId: 'x' }), outfitFor('session', { sessionId: 'x' }));
  assert.equal(outfitFor('agent', { type: 'Explore' }), 'orange');
  assert.ok(OUTFITS[outfitFor('agent', { type: 'irgendwas' })]);
});

test('Gebaeudesignatur aendert sich nur mit Projekten, Sitzungen und Subagents', () => {
  const a = [project(session('s1', [agent('a1')]))];
  const b = [project(session('s1', [agent('a1', { tool: 'Read' })], { status: 'idle' }))];
  assert.equal(buildingSignature(a), buildingSignature(b));
  assert.notEqual(buildingSignature(a), buildingSignature([project(session('s1', [agent('a1'), agent('a2')]))]));
  assert.notEqual(buildingSignature(a), buildingSignature([...a, named('q', session('s9'))]));
});

test('alles, was der Renderer zeichnet, steht im Atlas', () => {
  const sprites = new Set(Object.keys(atlas.sprites));
  const anims = atlas.animations;
  const need = [
    'wood-a', 'wood-b', 'kitchen',
    ...['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'].map((p) => `rug-${p}`),
    'wall-plain', 'wall-wainscot', 'wall-end-left', 'wall-end-right', 'wall-side-cap', 'wall-outer-corner',
    'door-wood-closed', 'door-wood-half-open', 'door-wood-open',
    'hallway', 'door-glass-closed', 'door-glass-half-open', 'door-glass-open', 'plate-brass',
    'kitchen-counter', 'espresso-idle', 'tray-mugs', 'fridge', 'cooler-bubble-1',
    'desk-large', 'desk-small', 'chair-front', 'laptop-back-open', 'laptop-closed', 'lamp-on', 'lamp-off', 'mug-idle',
    'bubble-speech-tail', 'bubble-thought-puff-large', 'bubble-thought-puff-small',
    ...['speech', 'thought'].flatMap((b) =>
      ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'].map((p) => `bubble-${b}-${p}`),
    ),
    ...['alert', 'error', 'sweat', 'done', 'heart', 'coffee', 'question', 'idea', 'waiting'].map((e) => `emote-${e}`),
  ];
  const looks = ['look-01', 'look-02', 'look-03', 'look-04', 'look-05', 'look-06'];
  for (const look of looks) need.push(`${look}-back`, `${look}-right`, `${look}-think-0`);
  // Stufe 2: Waende, Boeden, Moebel, Wandschmuck, was auf Flaechen steht.
  need.push(
    'wall-brick', 'wall-wood', 'wall-green', 'carpet-blue', 'carpet-green', 'carpet-wine', 'doormat',
    'window-day', 'window-dawn', 'window-dusk', 'window-night',
    'microwave', 'fruit-bowl', 'cactus-desk', 'floor-lamp-on', 'vending-0', 'server-0', 'printer-idle', 'kicker-0',
    ...Object.keys(FURNITURE),
    ...Object.keys(WALL_ART).filter((n) => n !== 'window'),
  );
  for (const name of need) assert.ok(sprites.has(name), `Sprite fehlt: ${name}`);

  const needAnims = ['espresso', 'cooler-bubble', 'mug-steam', 'sleep-z', 'vending-glow', 'server-blink', 'printer-print', 'kicker-play'];
  needAnims.push('plane-right', 'plane-up', 'plane-down', 'confetti', 'sparkle', 'dust', 'paper');
  for (const look of looks) {
    for (const a of ['walk-front', 'walk-back', 'walk-right', 'idle', 'type', 'read', 'write', 'think']) needAnims.push(`${look}-${a}`);
  }
  // Ruhe- und Aktionsbilder (Paket F) gibt es fuer die ersten beiden Looks.
  for (const look of ['look-01', 'look-02']) {
    for (const a of ['sleep', 'sip', 'cheer', 'talk', 'drink', 'kicker', 'sofa']) needAnims.push(`${look}-${a}`);
  }
  for (const name of needAnims) {
    const a = anims[name];
    assert.ok(a, `Animation fehlt: ${name}`);
    for (const s of a.states) assert.ok(sprites.has(s), `${name}: Bild ${s} fehlt`);
    if (a.prop?.animation) assert.ok(anims[a.prop.animation], `${name}: Requisit ${a.prop.animation} fehlt`);
    if (a.prop?.sprite) assert.ok(sprites.has(a.prop.sprite), `${name}: Requisit ${a.prop.sprite} fehlt`);
  }
  for (const desk of ['desk-large', 'desk-small']) {
    assert.ok(atlas.mountPoints[desk]?.laptop && atlas.mountPoints[desk]?.mug, `${desk}: Montagepunkte`);
  }
  // Jede Bilddatei des Atlas liegt auch wirklich da.
  for (const file of [...Object.keys(atlas.meta.images), ...Object.keys(atlas.auxiliaryImages)]) {
    assert.ok(fs.existsSync(new URL(`../public/assets/office/${file}`, import.meta.url)), `Datei fehlt: ${file}`);
  }
  assert.equal(WALL_ROWS * TILE, atlas.sprites['wall-plain'].height, 'Rueckwand so hoch wie ihre Kacheln');
  for (const style of ['brick', 'wood', 'green']) assert.equal(atlas.sprites[`wall-${style}`].height, WALL_ROWS * TILE);
});

test('Masse von Moebeln und Wandschmuck stimmen mit dem Atlas', () => {
  for (const [name, [w, h]] of Object.entries(FURNITURE)) {
    const s = atlas.sprites[name];
    assert.equal(Math.ceil(s.width / TILE), w, `${name}: Breite`);
    assert.equal(s.height, h, `${name}: Hoehe`);
    if (s.footprintTiles) assert.equal(s.footprintTiles[0], w, `${name}: Grundflaeche`);
  }
  for (const [name, [w, y, h]] of Object.entries(WALL_ART)) {
    const s = atlas.sprites[name === 'window' ? 'window-day' : name];
    assert.equal(s.width, w * TILE, `${name}: Breite`);
    assert.equal(s.wallY, y, `${name}: Abstand von oben`);
    assert.equal(s.height, h, `${name}: Hoehe`);
    assert.ok(y + h <= WALL_ROWS * TILE, `${name} passt an die Wand`);
  }
});
