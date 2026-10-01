/**
 * Tagesrueckblick im Buero: eine Leiste mit Abspielknopf, Zeitregler, Tempo
 * und Tag; ein eigenes Buero zeigt den abgespielten Zeitpunkt. Das Live-Buero
 * laeuft verdeckt weiter und ist beim Zurueckschalten sofort aktuell.
 */

import { createWorkshop } from './agents.js';
import { prepareTimeline, snapshotAt, nextActivity, activityHistogram } from './replay.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Neu gezeichnet wird hoechstens so oft - das Buero braucht keine 60 Bilder/s. */
const FRAME_MS = 120;
/** Der Tag beginnt kurz vor dem ersten Auftritt - mit leerem Buero. */
const LEAD_MS = 60_000;
/** Kuerzere Leerlaeufe werden abgespielt, laengere uebersprungen. */
const SKIP_MS = 2 * 60_000;
const HIST_BUCKETS = 96;

/**
 * @param opts.tooltip, opts.usd, opts.timeZone  wie beim Live-Buero
 * @param opts.describe  (kind, item, now) -> Tooltip-Text
 * @param opts.onToggle  (aktiv) -> void
 */
export function createReplay({ tooltip, usd, describe, timeZone, onToggle }) {
  const $ = (id) => document.getElementById(id);
  const toggle = $('replay-toggle');
  const bar = $('replay-bar');
  const live = $('workshop');
  const stage = $('replay-workshop');
  const playBtn = $('replay-play');
  const slider = $('replay-slider');
  const hist = $('replay-hist');
  const timeOut = $('replay-time');
  const speedSel = $('replay-speed');
  const dayInput = $('replay-day');
  const note = $('replay-note');

  let active = false;
  let prep = null;
  let raw = null;
  let current = Date.now();
  let playing = false;
  let raf = null;
  let lastFrame = null;
  let lastDraw = 0;
  let loadSeq = 0;

  const workshop = createWorkshop(stage, {
    tooltip,
    usd,
    describe: (kind, item) => describe(kind, item, current),
    timeZone,
    now: () => current,
    emptyText: 'Zu dieser Zeit war niemand im Büro.',
  });

  const end = () => (prep ? Math.min(prep.to, raw.now) : current);

  const stamp = (ms) => {
    const opts = { timeZone: timeZone(), weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' };
    try {
      return new Intl.DateTimeFormat('de-DE', opts).format(new Date(ms));
    } catch {
      return new Date(ms).toLocaleString('de-DE');
    }
  };

  function drawHistogram() {
    hist.replaceChildren();
    if (!prep) return;
    const counts = activityHistogram(prep, HIST_BUCKETS);
    const max = Math.max(1, ...counts);
    counts.forEach((c, i) => {
      if (!c) return;
      // Wurzel: ein einzelner Request bleibt neben einem vollen Abschnitt sichtbar.
      const h = Math.max(1.5, Math.sqrt(c / max) * 16);
      const r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('x', String(i + 0.1));
      r.setAttribute('y', String(16 - h));
      r.setAttribute('width', '0.8');
      r.setAttribute('height', String(h));
      hist.append(r);
    });
  }

  function setPlaying(on) {
    playing = on && prep !== null;
    playBtn.textContent = playing ? '❚❚' : '▶';
    playBtn.setAttribute('aria-label', playing ? 'Anhalten' : 'Abspielen');
    if (playing && raf === null) {
      lastFrame = null;
      raf = requestAnimationFrame(frame);
    }
    if (!playing && raf !== null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
  }

  function draw() {
    if (!prep) return;
    let snap = snapshotAt(prep, current);
    // Beim Abspielen leere Stunden ueberspringen - nachts passiert nichts.
    // Direkt auf den naechsten Auftritt: wer kommt, geht ohnehin durch die Tuer.
    if (playing && !snap.projects.length) {
      const next = nextActivity(prep, current);
      if (next === null) {
        current = end();
        setPlaying(false);
      } else if (next - current > SKIP_MS) {
        current = Math.min(end(), next);
      }
      snap = snapshotAt(prep, current);
    }
    workshop.render(snap, {});
    slider.value = String(current);
    timeOut.value = timeOut.textContent = stamp(current);
    const c = snap.counts;
    note.textContent = c.sessions
      ? [
          c.busy ? `${c.busy} ${c.busy === 1 ? 'Sitzung arbeitet' : 'Sitzungen arbeiten'}` : 'alle Sitzungen ruhen',
          c.agentsRunning ? `${c.agentsRunning} ${c.agentsRunning === 1 ? 'Subagent läuft' : 'Subagents laufen'}` : null,
          `${c.sessions} im Büro`,
          'rekonstruiert aus den Transkripten',
        ]
          .filter(Boolean)
          .join(' · ')
      : prep.start === null
        ? 'An diesem Tag hat niemand gearbeitet.'
        : 'Niemand im Büro – beim Abspielen werden leere Zeiten übersprungen.';
  }

  function frame(ts) {
    raf = null;
    if (!playing) return;
    // Nach einem Hintergrund-Tab nicht springen: hoechstens eine Viertelsekunde nachholen.
    const dt = lastFrame === null ? 0 : Math.min(250, ts - lastFrame);
    lastFrame = ts;
    current += dt * Number(speedSel.value);
    if (current >= end()) {
      current = end();
      setPlaying(false);
    }
    if (ts - lastDraw >= FRAME_MS || !playing) {
      lastDraw = ts;
      draw();
    }
    if (playing) raf = requestAnimationFrame(frame);
  }

  async function load(day) {
    const seq = ++loadSeq;
    setPlaying(false);
    note.textContent = 'Lade den Tag …';
    try {
      const res = await fetch(`/api/replay${day ? `?day=${encodeURIComponent(day)}` : ''}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (seq !== loadSeq || !active) return;
      raw = data;
      prep = prepareTimeline(data);
    } catch (err) {
      if (seq === loadSeq) note.textContent = `Rückblick nicht verfügbar: ${err.message}`;
      return;
    }
    dayInput.min = raw.firstDay;
    dayInput.max = raw.today;
    dayInput.value = raw.day;
    slider.min = String(prep.from);
    slider.max = String(end());
    drawHistogram();
    current = prep.start === null ? prep.from : Math.max(prep.from, prep.start - LEAD_MS);
    draw();
    if (prep.start !== null) setPlaying(true);
  }

  function setActive(on) {
    active = on;
    bar.hidden = !on;
    stage.hidden = !on;
    live.hidden = on;
    toggle.textContent = on ? 'Zurück zu live' : 'Rückblick';
    toggle.setAttribute('aria-pressed', String(on));
    tooltip.hide();
    if (on) load(dayInput.value || null);
    else setPlaying(false);
    onToggle?.(on);
  }

  toggle.addEventListener('click', () => setActive(!active));
  playBtn.addEventListener('click', () => {
    // Am Ende angekommen: von vorn.
    if (!playing && prep && current >= end()) current = prep.start === null ? prep.from : Math.max(prep.from, prep.start - LEAD_MS);
    setPlaying(!playing);
  });
  slider.addEventListener('input', () => {
    current = Number(slider.value);
    draw();
  });
  dayInput.addEventListener('change', () => {
    if (dayInput.value) load(dayInput.value);
  });

  return {
    get active() {
      return active;
    },
  };
}
