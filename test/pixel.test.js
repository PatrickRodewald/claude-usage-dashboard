/**
 * Pixel-Buero ohne DOM (public/pixel/world.js): Raumaufbau, Wegfindung, was
 * jede Figur zeigt - und ob alles, was der Renderer zeichnet, im Atlas steht.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  TILE,
  WALL_ROWS,
  layoutRoom,
  roomSignature,
  findPath,
  walkable,
  feetOf,
  tileAt,
  facing,
  poseFor,
  speechText,
  figureView,
  pixelErrands,
  frameIndex,
  pixelScale,
  OUTFITS,
  KEY_COLORS,
  outfitFor,
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

test('ein Raum mit einer Sitzung: Mindestgroesse, Tuer, Kaffeeecke, Platz', () => {
  const room = layoutRoom(project(session('s1')));
  assert.equal(room.cols, 14);
  assert.equal(room.rows, 9);
  assert.equal(room.seats.length, 1);
  const [seat] = room.seats;
  assert.deepEqual([seat.kind, seat.desk, seat.row], ['session', 'desk-large', 5]);
  assert.ok(walkable(room, room.door.col, room.door.row), 'die Tuer ist ein Durchgang');
  assert.ok(!walkable(room, room.door.col + 1, room.door.row), 'die Wand daneben nicht');
  assert.ok(!walkable(room, room.kitchen.counter.col, room.kitchen.counter.row), 'die Theke steht im Weg');
  assert.equal(room.rug, null, 'ohne Subagents kein Teppich');
});

test('jeder Platz und jede Ecke ist von der Tuer aus erreichbar', () => {
  const agents = (n, p) => Array.from({ length: n }, (_, i) => agent(`${p}${i}`));
  const room = layoutRoom(project(session('s1', agents(6, 'a')), session('s2', agents(2, 'b')), session('s3')));
  assert.equal(room.seats.length, 3 + 8);
  const spots = [...room.seats, room.kitchen.coffee, room.kitchen.water];
  for (const s of spots) {
    assert.ok(walkable(room, s.col, s.row), `begehbar: ${JSON.stringify(s)}`);
    assert.ok(findPath(room, room.door, s), `erreichbar: ${JSON.stringify(s)}`);
  }
  // Kein Platz doppelt belegt.
  assert.equal(new Set(room.seats.map((s) => `${s.col},${s.row}`)).size, room.seats.length);
  // Subagents sitzen auf dem Teppich.
  for (const s of room.seats.filter((x) => x.kind === 'agent')) {
    assert.ok(s.col >= room.rug.col && s.col < room.rug.col + room.rug.w, `Teppich deckt Spalte ${s.col}`);
    assert.ok(s.row >= room.rug.row && s.row < room.rug.row + room.rug.h, `Teppich deckt Reihe ${s.row}`);
    assert.equal(s.owner, s.id.startsWith('a') ? 's1' : 's2');
  }
  // Der Teppich bleibt im Raum.
  assert.ok(room.rug.col + room.rug.w <= room.cols && room.rug.row + room.rug.h <= room.rows);
});

test('Wegfindung: kuerzester Weg, schon da, unerreichbar', () => {
  const room = layoutRoom(project(session('s1')));
  const from = { col: 9, row: 7 };
  const to = { col: 12, row: 3 };
  const path = findPath(room, from, to);
  assert.equal(path.length, 3 + 4, 'freie Flaeche: Manhattan-Abstand');
  assert.deepEqual(path[path.length - 1], to);
  for (let i = 1; i < path.length; i++) {
    const d = Math.abs(path[i].col - path[i - 1].col) + Math.abs(path[i].row - path[i - 1].row);
    assert.equal(d, 1, 'nur Nachbarkacheln');
  }
  assert.deepEqual(findPath(room, from, from), []);
  assert.equal(findPath(room, from, { col: 5, row: 0 }), null, 'in die Wand geht es nicht');
  // Um die Theke herum statt hindurch.
  const around = findPath(room, { col: 2, row: 2 }, { col: 8, row: 2 });
  assert.ok(around.every((t) => walkable(room, t.col, t.row)));
  assert.ok(around.length > 6);
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
  assert.deepEqual(idle.options.map(([n]) => n), ['coffee', 'water', 'stroll']);
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

test('Raumsignatur aendert sich nur mit Sitzungen und Subagents', () => {
  const a = project(session('s1', [agent('a1')]));
  const b = project(session('s1', [agent('a1', { tool: 'Read' })], { status: 'idle' }));
  assert.equal(roomSignature(a), roomSignature(b));
  assert.notEqual(roomSignature(a), roomSignature(project(session('s1', [agent('a1'), agent('a2')]))));
});

test('alles, was der Renderer zeichnet, steht im Atlas', () => {
  const sprites = new Set(Object.keys(atlas.sprites));
  const anims = atlas.animations;
  const need = [
    'wood-a', 'wood-b', 'kitchen',
    ...['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'].map((p) => `rug-${p}`),
    'wall-plain', 'wall-wainscot', 'wall-end-left', 'wall-end-right', 'wall-side-cap', 'wall-outer-corner',
    'door-wood-closed', 'door-wood-half-open', 'door-wood-open',
    'kitchen-counter', 'espresso-idle', 'tray-mugs', 'fridge', 'cooler-bubble-1',
    'desk-large', 'desk-small', 'chair-front', 'laptop-back-open', 'laptop-closed', 'lamp-on', 'lamp-off', 'mug-idle',
    'bubble-speech-tail', 'bubble-thought-puff-large', 'bubble-thought-puff-small',
    ...['speech', 'thought'].flatMap((b) =>
      ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'].map((p) => `bubble-${b}-${p}`),
    ),
    ...['alert', 'error', 'sweat', 'done', 'heart', 'coffee', 'question', 'idea', 'waiting'].map((e) => `emote-${e}`),
  ];
  for (const look of ['look-01', 'look-02']) need.push(`${look}-back`, `${look}-right`, `${look}-think-0`);
  for (const name of need) assert.ok(sprites.has(name), `Sprite fehlt: ${name}`);

  const needAnims = ['espresso', 'cooler-bubble', 'mug-steam', 'sleep-z'];
  for (const look of ['look-01', 'look-02']) {
    for (const a of ['walk-front', 'walk-back', 'walk-right', 'idle', 'type', 'read', 'write', 'think']) needAnims.push(`${look}-${a}`);
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
});
