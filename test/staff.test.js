/**
 * Belegschaft im Pixel-Buero (public/pixel/staff.js): Dienstplan, wer wann da
 * ist, wie viele auffuellen - und der Teamraum im Grundriss (world.js).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { STAFF, STAFF_FILL, STAFF_POSES, STAFF_ERRANDS, dayClock, shiftsFor, atWork, onDuty, staffWanted, hourText } from '../public/pixel/staff.js';
import { TEAM, KITCHEN, layoutBuilding, findPath, roomAt, walkable, OUTFITS, lookFor, outfitFor, figureView } from '../public/pixel/world.js';

const session = (id) => ({ sessionId: id, status: 'busy', doing: { kind: 'thinking' }, agents: [] });
const named = (key, ...sessions) => ({ key, label: key, sessions });
const ids = STAFF.map((s) => s.id);

/** Werktage und Wochenenden ueber ein paar Wochen. */
const days = Array.from({ length: 28 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9, 1 + i));
  return { day: d.toISOString().slice(0, 10), weekday: d.getUTCDay() };
});

test('Belegschaft: sechs Leute, eigene Looks und gedeckte Kleidung, die keine Sitzung traegt', () => {
  assert.equal(STAFF.length, 6);
  assert.equal(new Set(ids).size, 6);
  for (const s of STAFF) {
    assert.ok(OUTFITS[s.outfit], `${s.name}: Kleidung ${s.outfit}`);
    assert.ok(!['blue', 'red', 'purple', 'green', 'orange', 'brown', 'grey', 'yellow'].includes(s.outfit), `${s.name}: nicht wie Sitzungen und Subagents`);
    assert.equal(lookFor('staff', s), s.look);
    assert.equal(outfitFor('staff', s), s.outfit);
  }
  assert.deepEqual(STAFF_POSES.map(([p]) => p).sort(), ['read', 'think', 'type', 'write']);
  assert.ok(STAFF_ERRANDS.rate > 0 && STAFF_ERRANDS.options.length);
});

test('was die Belegschaft zeigt: arbeiten ohne Blasen, auch wenn das Limit erreicht ist', () => {
  const v = figureView('staff', { ...STAFF[0], pose: 'read' }, { limit: 'reached' });
  assert.equal(v.state, 'staff');
  assert.equal(v.pose, 'read');
  assert.equal(v.speech, null);
  assert.equal(v.thought, false);
  assert.equal(v.emote, null);
  assert.equal(v.lamp, true);
  assert.equal(v.leaving, false);
  assert.equal(figureView('staff', STAFF[1]).pose, 'type');
});

test('Dienstplan: derselbe Tag ergibt denselben Plan, ein anderer Tag einen anderen', () => {
  const a = shiftsFor('2026-10-29', 4);
  const b = shiftsFor('2026-10-29', 4);
  assert.deepEqual([...a.shifts], [...b.shifts]);
  assert.deepEqual(a.order, b.order);
  assert.deepEqual([...a.order].sort(), [...ids].sort(), 'jede Person genau einmal in der Reihenfolge');
  const c = shiftsFor('2026-10-30', 5);
  assert.notDeepEqual([...a.shifts], [...c.shifts]);
});

test('Dienstplan: werktags morgens kommen, mittags essen, abends gehen; am Wochenende selten jemand', () => {
  let weekendShifts = 0;
  let weekdayShifts = 0;
  for (const { day, weekday } of days) {
    const plan = shiftsFor(day, weekday);
    for (const shift of plan.shifts.values()) {
      if (!shift) continue;
      assert.ok(shift.leave > shift.arrive, `${day}: erst kommen, dann gehen`);
      assert.ok(shift.leave <= 24, `${day}: vor Mitternacht weg`);
      if (weekday === 0 || weekday === 6) {
        weekendShifts++;
        assert.equal(shift.lunch, null);
        assert.ok(shift.arrive >= 10 && shift.leave - shift.arrive <= 4, `${day}: nur ein paar Stunden`);
      } else {
        weekdayShifts++;
        assert.ok(shift.arrive >= 7.5 && shift.arrive <= 9.5, `${day}: kommt morgens (${shift.arrive})`);
        assert.ok(shift.leave >= 16, `${day}: bleibt bis zum Nachmittag`);
        assert.ok(shift.lunch[0] >= 11.75 && shift.lunch[1] <= 13.5 + 0.5 + 1 / 3 && shift.lunch[1] > shift.lunch[0], `${day}: Mittag`);
      }
    }
  }
  assert.ok(weekdayShifts > 100, 'werktags sind fast alle da');
  assert.ok(weekendShifts < 10, 'am Wochenende kaum jemand');
});

test('wer da ist: nicht nachts, nicht beim Mittagessen, hoechstens so viele wie gebraucht', () => {
  const shift = { arrive: 8, leave: 17, lunch: [12, 12.5] };
  assert.equal(atWork(shift, 7.9), false);
  assert.equal(atWork(shift, 8), true);
  assert.equal(atWork(shift, 12.2), false, 'beim Mittagessen');
  assert.equal(atWork(shift, 12.5), true);
  assert.equal(atWork(shift, 17), false);
  assert.equal(atWork(null, 10), false, 'frei');
  for (const { day, weekday } of days) {
    const plan = shiftsFor(day, weekday);
    assert.deepEqual(onDuty(plan, 3, 6), [], `${day}: um drei Uhr nachts niemand`);
    for (const want of [0, 2, 6]) assert.ok(onDuty(plan, 10.5, want).length <= want);
    // Wer gebraucht wird, kommt in der Reihenfolge des Tages: mehr Bedarf, gleiche Leute plus weitere.
    const two = onDuty(plan, 10.5, 2);
    assert.deepEqual(onDuty(plan, 10.5, 4).slice(0, two.length), two);
  }
  const plan = { order: ['a', 'b', 'c'], shifts: new Map([['a', shift], ['b', null], ['c', shift]]) };
  assert.deepEqual(onDuty(plan, 10, 5), ['a', 'c']);
  assert.deepEqual(onDuty(plan, 10, 1), ['a']);
  assert.deepEqual(onDuty(plan, 10, -1), []);
});

test('auffuellen: so viele, dass es fill Figuren sind, hoechstens alle sechs', () => {
  assert.equal(STAFF_FILL, 8);
  assert.equal(staffWanted(0), 6);
  assert.equal(staffWanted(3), 5);
  assert.equal(staffWanted(4), 4);
  assert.equal(staffWanted(8), 0);
  assert.equal(staffWanted(12), 0);
  assert.equal(staffWanted(1, 3), 2);
  assert.equal(staffWanted(0, 4, 2), 2);
});

test('Tag und Uhrzeit in der Zeitzone; unbekannte Zone: Ortszeit', () => {
  // Donnerstag, 29.10.2026, 23:30 UTC ist in Berlin schon Freitag, 0:30.
  const ms = Date.UTC(2026, 9, 29, 23, 30);
  assert.deepEqual(dayClock('Europe/Berlin', ms), { day: '2026-10-30', weekday: 5, hour: 0.5 });
  assert.deepEqual(dayClock('UTC', ms), { day: '2026-10-29', weekday: 4, hour: 23.5 });
  const local = dayClock('Gibt/Es-Nicht', ms);
  assert.equal(local.weekday, new Date(ms).getDay());
  assert.match(local.day, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(hourText(8.25), '8:15');
  assert.equal(hourText(17.999), '18:00');
});

test('Teamraum: nach der Kueche, ein Tisch je Person, alle erreichbar, mit Drucker und Whiteboard', () => {
  const projects = [named('A', session('a')), named('B'), named('C', session('c1'), session('c2'))];
  for (const cols of [30, 60, 200]) {
    const L = layoutBuilding(projects, cols, ids);
    const team = L.rooms.find((r) => r.key === TEAM);
    assert.ok(team, `${cols}: Teamraum da`);
    assert.equal(team.kind, 'team');
    assert.equal(team.label, 'Team');
    assert.deepEqual(L.rooms.slice(0, 2).map((r) => r.key), [KITCHEN, TEAM], `${cols}: gleich nach der Kueche`);
    const desks = L.seats.filter((s) => s.kind === 'staff');
    assert.deepEqual(desks.map((s) => s.id), ids);
    for (const s of desks) {
      assert.equal(roomAt(L, s.col, s.row), team, `${s.id} sitzt im Teamraum`);
      assert.ok(walkable(L, s.col, s.row), `${s.id}: Platz frei`);
      assert.ok(findPath(L, L.entrance, s), `${cols}: ${s.id} vom Eingang erreichbar`);
      assert.ok(findPath(L, s, L.kitchen.coffee), `${cols}: ${s.id} kommt zur Kueche`);
    }
    assert.equal(new Set(L.seats.map((s) => `${s.col},${s.row}`)).size, L.seats.length, 'kein Platz doppelt');
    // Niemand aus dem Team sitzt in einem Projektraum, und Sitzungen nicht im Teamraum.
    for (const s of L.seats.filter((x) => x.kind !== 'staff')) assert.notEqual(roomAt(L, s.col, s.row), team);
    assert.ok(L.items.some((it) => it.kind === 'printer' && roomAt(L, it.col, it.row) === team), `${cols}: Drucker im Teamraum`);
    assert.ok(L.wall.some((w) => w.kind === 'whiteboard' && w.room === TEAM), `${cols}: Whiteboard im Teamraum`);
  }
});

test('ohne Belegschaft kein Teamraum', () => {
  const L = layoutBuilding([named('A', session('a')), named('B', session('b'))], 200);
  assert.ok(!L.rooms.some((r) => r.kind === 'team'));
  assert.ok(!L.seats.some((s) => s.kind === 'staff'));
});
