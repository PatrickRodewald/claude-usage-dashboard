/**
 * Zeitzonen-Helfer auf Basis von Intl - keine Abhaengigkeiten.
 *
 * Alle Zeitstempel werden intern als UTC-Millisekunden gefuehrt. Diese Datei
 * uebersetzt zwischen "Instant" (ms seit Epoch) und "Zivilzeit in einer Zone"
 * (Jahr/Monat/Tag/Stunde). Genau an dieser Grenze entstehen sonst die
 * Sommerzeit-Fehler, deshalb ist sie hier isoliert und einzeln getestet.
 */

const formatterCache = new Map();

function formatter(timeZone) {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** Zivilzeit-Bestandteile eines Instants in der angegebenen Zone. */
export function getZonedParts(instantMs, timeZone) {
  const parts = formatter(timeZone).formatToParts(new Date(instantMs));
  const o = {};
  for (const p of parts) if (p.type !== 'literal') o[p.type] = p.value;
  // Manche ICU-Versionen liefern fuer Mitternacht "24" statt "00".
  const hour = Number(o.hour) === 24 ? 0 : Number(o.hour);
  return {
    year: Number(o.year),
    month: Number(o.month),
    day: Number(o.day),
    hour,
    minute: Number(o.minute),
    second: Number(o.second),
  };
}

/** UTC-Offset der Zone zum gegebenen Instant, in Millisekunden. */
export function tzOffsetMs(instantMs, timeZone) {
  const p = getZonedParts(instantMs, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Auf volle Sekunden abschneiden - formatToParts hat keine Millisekunden.
  return asIfUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * Zivilzeit in der Zone -> UTC-Millisekunden.
 *
 * Zwei Durchlaeufe: der erste Offset ist eine Schaetzung anhand der naiven
 * Zeit, der zweite korrigiert sie an Zeitumstellungs-Grenzen. Nicht existente
 * Ortszeiten (Sprung vorwaerts) landen auf der Zeit direkt nach dem Sprung,
 * doppelte Ortszeiten (Sprung rueckwaerts) auf einem der beiden Vorkommen.
 */
export function zonedToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  let ts = naive - tzOffsetMs(naive, timeZone);
  ts = naive - tzOffsetMs(ts, timeZone);
  return ts;
}

/** Zivil-Datum um n Tage verschieben (ohne Zeitzonen-Arithmetik). */
export function shiftCivilDays({ year, month, day }, days) {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** "YYYY-MM-DD" in der Zone. */
export function dayKey(instantMs, timeZone) {
  const p = getZonedParts(instantMs, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Mitternacht des Tages, in dem der Instant liegt (Zonenzeit) -> UTC-ms. */
export function startOfDay(instantMs, timeZone) {
  const p = getZonedParts(instantMs, timeZone);
  return zonedToUtc({ year: p.year, month: p.month, day: p.day }, timeZone);
}

/** Wochentag (0 = Sonntag) in der Zone. */
export function zonedWeekday(instantMs, timeZone) {
  const p = getZonedParts(instantMs, timeZone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/**
 * Beginn des Wochenfensters: das juengste Vorkommen von
 * (resetWeekday, resetHour:resetMinute), das nicht in der Zukunft liegt.
 */
export function startOfWeekWindow(instantMs, timeZone, week = {}) {
  const { resetWeekday = 1, resetHour = 0, resetMinute = 0 } = week;
  const p = getZonedParts(instantMs, timeZone);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  const back = (weekday - resetWeekday + 7) % 7;

  const at = (offsetDays) =>
    zonedToUtc(
      { ...shiftCivilDays(p, offsetDays), hour: resetHour, minute: resetMinute, second: 0 },
      timeZone,
    );

  const candidate = at(-back);
  // Am Reset-Tag selbst, aber noch vor der Reset-Uhrzeit: eine Woche zurueck.
  return candidate <= instantMs ? candidate : at(-back - 7);
}

/**
 * Ende des Wochenfensters = naechster Reset. Ueber das Zivil-Datum +7 Tage
 * gerechnet, damit eine Zeitumstellung innerhalb der Woche die Uhrzeit des
 * Resets nicht um eine Stunde verschiebt.
 */
export function endOfWeekWindow(weekStartMs, timeZone) {
  const p = getZonedParts(weekStartMs, timeZone);
  return zonedToUtc(
    { ...shiftCivilDays(p, 7), hour: p.hour, minute: p.minute, second: 0 },
    timeZone,
  );
}

/** Liste der letzten n Tagesschluessel (aeltester zuerst), inkl. heute. */
export function lastNDayKeys(nowMs, timeZone, n) {
  const p = getZonedParts(nowMs, timeZone);
  const keys = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = shiftCivilDays(p, -i);
    keys.push(
      `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`,
    );
  }
  return keys;
}
