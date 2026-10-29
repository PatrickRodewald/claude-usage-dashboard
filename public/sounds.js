/*
 * Toene des Bueros - gleich, welches Buero gerade zu sehen ist: ein heller
 * Zweiklang, wenn ein Subagent fertig wird, ein Warnton, wenn das 5h-Limit
 * kritisch wird oder erreicht ist. Standardmaessig aus; synthetisiert per Web
 * Audio, keine Dateien.
 */

import { limitState } from './agents.js';

const alarming = (l) => l === 'critical' || l === 'reached';

/**
 * Welche Toene zwischen zwei Staenden faellig sind: { cues, state }. prev ist
 * der state des letzten Aufrufs - beim ersten Mal null, dann klingt nichts
 * (beim Laden ist niemand gerade fertig geworden). Der Warnton kommt zuerst.
 */
export function soundCues(prev, activity, env = {}) {
  const agents = new Map();
  for (const p of activity?.projects ?? []) {
    for (const s of p.sessions ?? []) for (const a of s.agents ?? []) agents.set(a.id, a.state);
  }
  const state = { agents, limit: limitState(env?.fiveHour) };
  if (!prev) return { cues: [], state };
  const cues = [];
  if (alarming(state.limit) && !alarming(prev.limit)) cues.push('alarm');
  for (const [id, now] of agents) {
    if (now !== 'running' && prev.agents.get(id) === 'running') {
      cues.push('chime');
      break;
    }
  }
  return { cues, state };
}

const NOTES = {
  alarm: [
    [660, 0, 'square', 0.04],
    [660, 0.28, 'square', 0.04],
  ],
  chime: [
    [880, 0, 'sine', 0.08],
    [1320, 0.16, 'sine', 0.07],
  ],
};

/**
 * @returns {{ setSound(on), play(name), observe(activity, env) }}
 * Jeder Ton wird zusaetzlich als Ereignis 'cud-sound' am Dokument gemeldet
 * (auch stumm) - zum Nachvollziehen und fuer Tests.
 */
export function createSound() {
  let on = false;
  let audio = null;
  let lastAt = 0;
  let prev = null;

  const play = (name) => {
    document.dispatchEvent(new CustomEvent('cud-sound', { detail: { name, on } }));
    if (!on || !audio) return;
    // Mehrere Ereignisse im selben Moment ergeben einen Ton, keine Kakophonie.
    const nowMs = performance.now();
    if (nowMs - lastAt < 800) return;
    lastAt = nowMs;
    const t0 = audio.currentTime + 0.01;
    for (const [freq, dt, type, vol] of NOTES[name] ?? NOTES.chime) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + dt);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + dt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.4);
      osc.connect(gain).connect(audio.destination);
      osc.start(t0 + dt);
      osc.stop(t0 + dt + 0.45);
    }
  };

  return {
    /** Toene ein/aus. Der Audio-Kontext entsteht hier - Browser verlangen dafuer einen Klick. */
    setSound(value) {
      on = Boolean(value);
      if (on && !audio) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audio = new AC();
      }
      if (on) audio?.resume?.().catch(() => {});
    },
    play,
    /** Neuer Stand aus dem Snapshot: faellige Toene spielen. */
    observe(activity, env) {
      const r = soundCues(prev, activity, env);
      prev = r.state;
      for (const cue of r.cues) play(cue);
    },
  };
}
