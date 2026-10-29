/*
 * Belegschaft des Pixel-Bueros: Kolleginnen und Kollegen, die nicht an deinen
 * Projekten arbeiten. Sie sitzen im Teamraum, holen Kaffee, drucken, reden
 * miteinander - und fuellen das Buero auf, wenn wenige Sitzungen offen sind.
 *
 * Werktags kommen sie morgens, gehen mittags essen und abends nach Hause, nach
 * einem Plan, der je Tag ausgewuerfelt wird: nach dem Neuladen ist alles wie
 * vorher. Am Wochenende schaut hoechstens mal jemand vorbei, nachts ist keiner
 * da. Sie tragen gedeckte Kleidung, zeigen keine Status-Blasen und zaehlen
 * nirgends mit.
 */

import { seeded, shuffled } from './world.js';

export const STAFF = [
  { id: 'staff:kim', name: 'Kim', role: 'Buchhaltung', look: 'look-01', outfit: 'anthrazit' },
  { id: 'staff:alex', name: 'Alex', role: 'IT-Support', look: 'look-02', outfit: 'tanne' },
  { id: 'staff:robin', name: 'Robin', role: 'Design', look: 'look-03', outfit: 'sand' },
  { id: 'staff:sascha', name: 'Sascha', role: 'Vertrieb', look: 'look-04', outfit: 'hemd' },
  { id: 'staff:toni', name: 'Toni', role: 'Personal', look: 'look-05', outfit: 'bordeaux' },
  { id: 'staff:charlie', name: 'Charlie', role: 'Werkstudium', look: 'look-06', outfit: 'anthrazit' },
];

/** So viele Figuren sollen da sein: die Belegschaft fuellt bis dahin auf. */
export const STAFF_FILL = 8;

/** Haltung am Tisch: meist tippen, dazwischen lesen, schreiben, gruebeln. */
export const STAFF_POSES = [
  ['type', 5],
  ['read', 2],
  ['write', 2],
  ['think', 1],
];

/** Wohin es zwischendurch geht: { rate (Chance je Sekunde und Person), options }. */
export const STAFF_ERRANDS = {
  rate: 1 / 50,
  options: [
    ['coffee', 3],
    ['water', 2],
    ['print', 2],
    ['chat', 3],
    ['board', 1],
    ['stroll', 1],
    ['sofa', 1],
    ['kicker', 1],
  ],
};

/** Wer frei hat (Urlaub, krank), wer am Wochenende kommt, wer laenger bleibt. */
const DAY_OFF = 0.08;
const WEEKEND = 0.12;
const LATE = 0.15;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Tag und Uhrzeit in einer Zeitzone: { day: 'JJJJ-MM-TT', weekday: 0 (Sonntag)
 * bis 6, hour: Stunden mit Minuten als Bruch }. Ohne Zone: Ortszeit des Browsers.
 */
export function dayClock(timeZone, ms = Date.now()) {
  const d = new Date(ms);
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t)?.value;
    return {
      day: `${get('year')}-${get('month')}-${get('day')}`,
      weekday: WEEKDAYS.indexOf(get('weekday')),
      hour: Number(get('hour')) + Number(get('minute')) / 60,
    };
  } catch {
    const pad = (n) => String(n).padStart(2, '0');
    return {
      day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      weekday: d.getDay(),
      hour: d.getHours() + d.getMinutes() / 60,
    };
  }
}

/**
 * Dienstplan eines Tages: { day, order: Ids (wer zuerst gebraucht wird),
 * shifts: Map Id -> { arrive, leave, lunch: [von, bis] | null } oder null (frei) }.
 * Zeiten in Stunden; derselbe Tag ergibt immer denselben Plan.
 */
export function shiftsFor(day, weekday, roster = STAFF) {
  const weekend = weekday === 0 || weekday === 6;
  const shifts = new Map();
  for (const s of roster) {
    const rnd = seeded(`${day}|${s.id}`);
    if (weekend) {
      if (rnd() >= WEEKEND) {
        shifts.set(s.id, null);
        continue;
      }
      const arrive = 10 + rnd() * 3;
      shifts.set(s.id, { arrive, leave: arrive + 2 + rnd() * 2, lunch: null });
      continue;
    }
    if (rnd() < DAY_OFF) {
      shifts.set(s.id, null);
      continue;
    }
    const arrive = 7.5 + rnd() * 2;
    const lunchAt = 11.75 + rnd() * 1.75;
    const lunch = [lunchAt, lunchAt + 0.5 + rnd() / 3];
    const late = rnd() < LATE ? 1.5 + rnd() * 2.5 : 0;
    shifts.set(s.id, { arrive, lunch, leave: arrive + 8.5 + rnd() * 1.5 + late });
  }
  return { day, order: shuffled(roster.map((s) => s.id), seeded(`reihe|${day}`)), shifts };
}

/** Ist jemand laut Plan gerade im Haus (nicht beim Mittagessen)? */
export function atWork(shift, hour) {
  if (!shift || hour < shift.arrive || hour >= shift.leave) return false;
  return !(shift.lunch && hour >= shift.lunch[0] && hour < shift.lunch[1]);
}

/** Wer jetzt da sein soll: hoechstens want, in der Reihenfolge des Tages. */
export function onDuty(plan, hour, want) {
  return plan.order.filter((id) => atWork(plan.shifts.get(id), hour)).slice(0, Math.max(0, want));
}

/** Wie viele aus der Belegschaft gebraucht werden, damit es fill Figuren sind. */
export function staffWanted(sessions, fill = STAFF_FILL, max = STAFF.length) {
  return Math.max(0, Math.min(max, Math.round(fill) - sessions));
}

/** Uhrzeit "8:05" zu Stunden mit Bruch. */
export function hourText(hour) {
  const min = Math.round(hour * 60);
  return `${Math.floor(min / 60) % 24}:${String(min % 60).padStart(2, '0')}`;
}
