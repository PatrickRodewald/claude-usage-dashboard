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
