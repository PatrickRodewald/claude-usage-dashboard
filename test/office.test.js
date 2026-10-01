/**
 * Reine Hilfsfunktionen des Bueros (public/agents.js). Das Modul fasst das DOM
 * erst beim Aufruf von createWorkshop an und laesst sich deshalb direkt in
 * Node laden.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { toolActivity, entrypointLabel, limitState, calendarFace } from '../public/agents.js';

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
