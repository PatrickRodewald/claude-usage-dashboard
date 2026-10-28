/**
 * Toene des Bueros (public/sounds.js): wann der Zweiklang und wann der
 * Warnton faellig ist - unabhaengig davon, welches Buero zu sehen ist.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { soundCues } from '../public/sounds.js';

const act = (...agents) => ({
  projects: [{ key: 'p', label: 'p', sessions: [{ sessionId: 's', agents: agents.map(([id, state]) => ({ id, state })) }] }],
});
const env = (percent, level = 'ok') => ({ fiveHour: { source: 'anthropic', percent, level } });

test('beim Laden klingt nichts', () => {
  const { cues } = soundCues(null, act(['a', 'completed']), env(100));
  assert.deepEqual(cues, []);
});

test('ein Subagent wird fertig: einmal der Zweiklang, auch wenn es mehrere sind', () => {
  let r = soundCues(null, act(['a', 'running'], ['b', 'running']), env(10));
  r = soundCues(r.state, act(['a', 'completed'], ['b', 'failed']), env(10));
  assert.deepEqual(r.cues, ['chime']);
  r = soundCues(r.state, act(['a', 'completed'], ['b', 'failed']), env(10));
  assert.deepEqual(r.cues, [], 'schon fertig - kein zweites Mal');
  r = soundCues(r.state, act(['c', 'completed']), env(10));
  assert.deepEqual(r.cues, [], 'wer nie lief, wird auch nicht fertig');
});

test('Warnton, wenn das Limit kritisch wird oder erreicht ist - einmal je Wechsel', () => {
  let r = soundCues(null, act(), env(50, 'ok'));
  r = soundCues(r.state, act(), env(85, 'warn'));
  assert.deepEqual(r.cues, [], 'die Warnschwelle allein klingelt nicht');
  r = soundCues(r.state, act(), env(95, 'critical'));
  assert.deepEqual(r.cues, ['alarm']);
  r = soundCues(r.state, act(), env(100, 'critical'));
  assert.deepEqual(r.cues, [], 'von kritisch zu erreicht kein zweiter Alarm');
  r = soundCues(r.state, act(), env(20, 'ok'));
  r = soundCues(r.state, act(), env(100, 'critical'));
  assert.deepEqual(r.cues, ['alarm'], 'nach dem Reset wieder');
  // Lokale Schaetzungen schlagen keinen Alarm.
  const local = soundCues(soundCues(null, act(), env(10)).state, act(), { fiveHour: { source: 'local', percent: 100 } });
  assert.deepEqual(local.cues, []);
});

test('Warnton zuerst, wenn beides zugleich passiert', () => {
  const r0 = soundCues(null, act(['a', 'running']), env(50));
  const r = soundCues(r0.state, act(['a', 'completed']), env(100, 'critical'));
  assert.deepEqual(r.cues, ['alarm', 'chime']);
});
