/**
 * Reine Hilfsfunktionen des Bueros (public/agents.js). Das Modul fasst das DOM
 * erst beim Aufruf von createWorkshop an und laesst sich deshalb direkt in
 * Node laden.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  toolActivity,
  entrypointLabel,
  limitState,
  calendarFace,
  stackSheets,
  typeDuration,
  coinCount,
  arrivals,
  toolLabel,
  isLongWork,
  roomAsleep,
  lookOffset,
  LONG_WORK_MS,
} from '../public/agents.js';

test('jedes Werkzeug bekommt eine passende Taetigkeit', () => {
  const cases = {
    Read: 'read',
    Grep: 'search',
    Glob: 'search',
    Edit: 'write',
    Write: 'write',
    Bash: 'shell',
    PowerShell: 'shell',
    WebFetch: 'web',
    WebSearch: 'web',
    TodoWrite: 'todo',
    Agent: 'delegate',
  };
  for (const [tool, activity] of Object.entries(cases)) assert.equal(toolActivity(tool), activity, tool);
});

test('Testlaeufe sind ein eigenes Bild, Commit und Push bleiben Shell', () => {
  assert.equal(toolActivity('Bash', 'test'), 'test');
  assert.equal(toolActivity('Bash', 'commit'), 'shell', 'gefeiert wird erst der Erfolg');
  assert.equal(toolActivity('Bash', 'push'), 'shell');
});

test('MCP-Werkzeuge sprechen mit einem fremden Dienst, Unbekanntes bleibt neutral', () => {
  assert.equal(toolActivity('mcp__claude_ai_Notion__notion-search'), 'web');
  assert.equal(toolActivity('IrgendeinNeuesWerkzeug'), 'tool');
  assert.equal(toolActivity(null), null);
});

test('Einstiegspunkte werden lesbar benannt', () => {
  assert.equal(entrypointLabel('cli'), 'Terminal');
  assert.equal(entrypointLabel('claude-vscode'), 'VS Code');
  assert.equal(entrypointLabel('sdk-ts'), 'sdk-ts', 'Unbekanntes bleibt beim Rohwert');
  assert.equal(entrypointLabel(null), 'unbekannt');
});

test('das Buero reagiert auf die Warnstufen des echten 5h-Fensters', () => {
  const live = (percent, level) => ({ source: 'anthropic', percent, level });
  assert.equal(limitState(live(40, 'ok')), 'ok');
  assert.equal(limitState(live(75, 'warn')), 'warn');
  assert.equal(limitState(live(95, 'critical')), 'critical');
  assert.equal(limitState(live(100, 'critical')), 'reached', 'ab 100 % Zwangspause');
  assert.equal(limitState(live(null, 'unknown')), 'unknown');
  assert.equal(limitState(null), 'unknown');
});

test('eine lokale Schaetzung loest weder Alarm noch Pause aus', () => {
  // Die Schaetzung kann weit daneben liegen (z. B. 984 % nach neuer Kalibrierung).
  assert.equal(limitState({ source: 'estimate', percent: 984, level: 'critical' }), 'unknown');
});

test('der Kalender zaehlt volle Tage, am letzten Tag Stunden', () => {
  const now = Date.parse('2026-10-01T10:00:00Z');
  const in_ = (h) => now + h * 3_600_000;
  assert.deepEqual(calendarFace(in_(4.3 * 24), now), { big: '4', small: 'Tage' });
  assert.deepEqual(calendarFace(in_(30), now), { big: '1', small: 'Tag' });
  assert.deepEqual(calendarFace(in_(5.2), now), { big: '6', small: 'Std.' });
  assert.deepEqual(calendarFace(in_(0.4), now), { big: '1', small: 'Stunde' });
  assert.deepEqual(calendarFace(in_(-1), now), { big: '0', small: 'Std.' });
  assert.equal(calendarFace(undefined, now), null);
});

test('der Aktenstapel waechst mit dem Kontext', () => {
  assert.equal(stackSheets(0, 1_000_000), 0, 'kein Kontext, kein Stapel');
  assert.equal(stackSheets(5_000, 1_000_000), 1, 'etwas Kontext ist mindestens ein Blatt');
  assert.equal(stackSheets(500_000, 1_000_000), 8);
  assert.equal(stackSheets(1_000_000, 1_000_000), 16);
  assert.equal(stackSheets(3_000_000, 1_000_000), 16, 'nie ueber den Rand');
  assert.equal(stackSheets(100_000, 200_000, 10), 5, 'Haiku: kleineres Fenster');
  assert.equal(stackSheets(100, null), 0);
});

test('das Tipptempo folgt dem Output', () => {
  assert.equal(typeDuration(0), 0.5, 'gemaechlich');
  assert.equal(typeDuration(1500), 0.33);
  assert.equal(typeDuration(3000), 0.16, 'Hoechsttempo');
  assert.equal(typeDuration(99_999), 0.16);
  assert.equal(typeDuration(undefined), 0.5);
});

test('Muenzen zeigen die Groessenordnung der Kosten', () => {
  assert.equal(coinCount(0), 0);
  assert.equal(coinCount(0.2), 1);
  assert.equal(coinCount(3), 2);
  assert.equal(coinCount(7), 3);
  assert.equal(coinCount(190), 8);
  assert.equal(coinCount(10_000), 8, 'gedeckelt');
  assert.equal(coinCount(null), 0);
});

test('wer lange am Stueck arbeitet, streckt sich', () => {
  const now = Date.now();
  assert.equal(isLongWork({ status: 'busy', statusSince: now - LONG_WORK_MS - 1 }, now), true);
  assert.equal(isLongWork({ status: 'busy', statusSince: now - 60_000 }, now), false);
  assert.equal(isLongWork({ status: 'idle', statusSince: now - 2 * LONG_WORK_MS }, now), false, 'nur wer arbeitet');
  assert.equal(isLongWork({ status: 'busy' }, now), false);
});

test('ein Raum schlaeft erst, wenn wirklich niemand arbeitet', () => {
  const room = (...sessions) => ({ sessions });
  const s = (status, agents = []) => ({ status, agents });
  assert.equal(roomAsleep(room(s('idle'), s('idle'))), true);
  assert.equal(roomAsleep(room(s('idle'), s('busy'))), false);
  assert.equal(roomAsleep(room(s('idle', [{ state: 'running' }]))), false, 'ein Hintergrund-Agent arbeitet noch');
  assert.equal(roomAsleep(room(s('idle', [{ state: 'completed' }]))), true);
  assert.equal(roomAsleep(room()), false);
});

test('der Blick geht zur fertigen Figur', () => {
  assert.equal(lookOffset(100, 300), 2);
  assert.equal(lookOffset(300, 100), -2);
  assert.equal(lookOffset(100, 102), 0, 'direkt davor: geradeaus');
  assert.equal(lookOffset(undefined, 100), 0);
});

test('arrivals: neue Figuren kommen, verschwundene gehen', () => {
  assert.deepEqual(arrivals(['s1', 'a1', 'a2'], ['s1', 'a2', 'a3']), { entering: ['a3'], leaving: ['a1'] });
  // Gleicher Stand: niemand bewegt sich, auch nicht bei anderer Reihenfolge.
  assert.deepEqual(arrivals(['s1', 'a1'], ['a1', 's1']), { entering: [], leaving: [] });
  // Neuer Raum: alle kommen herein; aufgeloester Raum: alle gehen.
  assert.deepEqual(arrivals([], ['s1', 'a1']), { entering: ['s1', 'a1'], leaving: [] });
  assert.deepEqual(arrivals(['s1'], []), { entering: [], leaving: ['s1'] });
  // Iterierbare Eingaben (Map-Schluessel) gehen auch.
  assert.deepEqual(arrivals(new Map([['x', 1]]).keys(), new Map([['y', 1]]).keys()), { entering: ['y'], leaving: ['x'] });
});

test('toolLabel kuerzt MCP-Werkzeuge auf das Werkzeug', () => {
  assert.equal(toolLabel('mcp__claude_ai_Notion__notion-search'), 'notion-search');
  assert.equal(toolLabel('mcp__server__tool'), 'tool');
  assert.equal(toolLabel('Bash'), 'Bash');
  // Unvollstaendige Namen bleiben, wie sie sind.
  assert.equal(toolLabel('mcp__nurserver'), 'mcp__nurserver');
  assert.equal(toolLabel('mcp__server__'), 'mcp__server__');
  assert.equal(toolLabel(null), '');
});
