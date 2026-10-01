/**
 * Reine Hilfsfunktionen des Bueros (public/agents.js). Das Modul fasst das DOM
 * erst beim Aufruf von createWorkshop an und laesst sich deshalb direkt in
 * Node laden.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { toolActivity, entrypointLabel } from '../public/agents.js';

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
