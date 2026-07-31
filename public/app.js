/**
 * Dashboard-Logik: abonniert den SSE-Strom und rendert den Snapshot.
 * Zahlenformatierung durchgaengig de-DE.
 */

import { renderColumnChart, renderStackedBar, createTooltip } from './charts.js';

const $ = (id) => document.getElementById(id);
const tooltip = createTooltip();

const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const nfUsd = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});
const nfUsdPrecise = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 4,
});

let snapshot = null;

/* --- Formatierung -------------------------------------------------------- */

function num(n) {
  return nf0.format(Math.round(n || 0));
}

/** Kompakte Tokenzahl fuer Achsen und Kacheln: 12,4 Mio. / 838 Tsd. / 412 */
function compact(n) {
  const v = Math.abs(n || 0);
  if (v >= 1e9) return `${nf1.format(n / 1e9)} Mrd.`;
  if (v >= 1e6) return `${nf1.format(n / 1e6)} Mio.`;
  if (v >= 1e4) return `${nf0.format(n / 1e3)} Tsd.`;
  if (v >= 1e3) return `${nf1.format(n / 1e3)} Tsd.`;
  return nf0.format(Math.round(n || 0));
}

function usd(n) {
  if (!Number.isFinite(n)) return '–';
  if (n > 0 && n < 0.01) return nfUsdPrecise.format(n);
  return nfUsd.format(n);
}

function pct(n) {
  return Number.isFinite(n) ? `${nf1.format(n)} %` : '–';
}

/** Dauer als "3 Std. 12 Min." / "47 Min." */
function duration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '–';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'weniger als 1 Min.';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} Min.`;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d} Tg. ${h % 24} Std.`;
  }
  return m === 0 ? `${h} Std.` : `${h} Std. ${m} Min.`;
}

function clock(ms, tz) {
  if (!Number.isFinite(ms)) return '–';
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

function dateTime(ms, tz) {
  if (!Number.isFinite(ms)) return '–';
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: tz,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

function dateOnly(ms, tz) {
  if (!Number.isFinite(ms)) return '–';
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).format(new Date(ms));
}

function shortDay(key) {
  const [, m, d] = key.split('-');
  return `${Number(d)}.${Number(m)}.`;
}

/** "12.7." aus einem Zeitstempel, in der Anzeigezone. */
function dayMonth(ms, tz) {
  if (!Number.isFinite(ms)) return '–';
  return new Intl.DateTimeFormat('de-DE', { timeZone: tz, day: 'numeric', month: 'numeric' }).format(
    new Date(ms),
  );
}

/** Warnstufen-Farben aus dem Stylesheet - eine Quelle fuer UI und Charts. */
const LEVEL_COLOR = {
  ok: 'var(--status-good)',
  warn: 'var(--status-warning)',
  critical: 'var(--status-critical)',
  unknown: 'var(--series-1)',
};

/* --- Kacheln ------------------------------------------------------------- */

const REASON_TEXT = {
  'no-credentials': 'keine Zugangsdaten gefunden',
  'token-expired': 'Token abgelaufen',
  unauthorized: 'Token abgelehnt',
  timeout: 'Zeitüberschreitung',
  network: 'keine Verbindung',
  'rate-limited': 'Anthropic drosselt',
  'http-error': 'unerwartete Antwort',
  'bad-json': 'Antwort nicht lesbar',
  'unexpected-shape': 'Antwortformat geändert',
  disabled: 'in config.json deaktiviert',
};

const LEVEL_TEXT = {
  ok: 'im grünen Bereich',
  warn: 'Warnschwelle erreicht',
  critical: 'kritisch',
  unknown: 'Limit unbekannt',
};

function renderWindowTile(w, ids, tz) {
  const value = $(ids.percent);
  const meter = $(ids.meter);
  const note = $(ids.note);

  // Ohne belastbares Limit zeigt die Kachel die absolute Menge statt einer
  // Prozentzahl, die auf einer Schaetzung einer Schaetzung beruhen wuerde.
  value.textContent = w.percent == null ? compact(w.weighted) : pct(w.percent);
  value.dataset.level = w.level;
  meter.dataset.level = w.level;
  // Ohne Limit gar keinen Meter zeigen - eine leere Spur liest sich sonst wie
  // ein voller Balken.
  meter.hidden = w.percent == null;
  meter.querySelector('.meter-fill').style.width =
    w.percent == null ? '0%' : `${Math.min(100, Math.max(0, w.percent))}%`;

  $(ids.used).textContent = `${compact(w.weighted)} Tokens`;
  if (ids.limit) {
    $(ids.limit).textContent = w.limit ? compact(w.limit) : 'unbekannt';
  }

  // Prognose bzw. Erklaerung der Limit-Herkunft
  const parts = [];
  if (w.source === 'anthropic') {
    if (w.projection?.alreadyReached) {
      parts.push('Limit erreicht.');
    } else if (w.projection?.beforeReset) {
      parts.push(
        `Bei aktueller Rate (${nf1.format(w.burnPercentPerMin * 60)} %/Std.) gegen ` +
          `${clock(w.projection.atMs, tz)} bei 100 %.`,
      );
    } else if ((w.burnPercentPerMin ?? 0) <= 0) {
      parts.push('Aktuell kein Verbrauch in diesem Fenster.');
    } else {
      parts.push('Reset kommt vor dem Limit.');
    }
  } else if (w.limitSource === 'calibrating') {
    parts.push(
      `Kalibrierung läuft (${w.limitSamples} von ${w.limitMinSamples ?? 3} abgeschlossenen Fenstern). ` +
        'Bis dahin kein Prozentwert – ein geratener Planwert wäre irreführend.',
    );
  } else if (w.projection?.alreadyReached && w.limitSource === 'measured') {
    parts.push('Gemessenes Limit erreicht.');
  } else if (w.projection?.alreadyReached) {
    parts.push('Geschätztes Limit bereits überschritten.');
  } else if (w.projection?.beforeReset) {
    parts.push(`Limit bei aktueller Rate gegen ${clock(w.projection.atMs, tz)} erreicht.`);
  } else if (w.idle) {
    parts.push('Kein aktives Fenster – seit über 5 Std. keine Aktivität.');
  } else {
    parts.push(`Reset kommt vor dem Limit (${LEVEL_TEXT[w.level] ?? ''}).`);
  }
  if (w.source !== 'anthropic') {
    if (w.limitSource === 'measured') {
      parts.push(
        `100 % = gemessen aus ${w.limitSamples} Vergleichen mit den echten Werten von Anthropic` +
          (Number.isFinite(w.limitSpread) ? ` (Streuung ${nf1.format(w.limitSpread * 100)} %)` : '') +
          '.',
      );
    } else if (w.limitSource === 'auto') {
      parts.push(
        `100 % = höchstes bisher beobachtetes Fenster (${w.limitSamples} Vergleichswerte) – eine untere Schranke.`,
      );
    } else if (w.limitSource === 'plan') {
      parts.push('Fester Planwert aus config.json.');
    }
  }
  note.textContent = parts.join(' ');
  note.dataset.level = w.level;

  // Herkunftskennzeichnung: echt vs. geschätzt
  const src = $(ids.badge);
  if (src) {
    const real = w.source === 'anthropic';
    src.textContent = real ? 'live' : 'Schätzung';
    src.dataset.real = real ? '1' : '0';
    src.title = real
      ? 'Echter Wert aus deinem Abo, direkt von Anthropic abgerufen.'
      : 'Geschätzt – Anthropic konnte nicht abgerufen werden. Grund siehe Kopfzeile.';
  }
}

/* --- Tabellen ------------------------------------------------------------ */

function buildTable(table, { columns, rows, maxBarValue }) {
  table.textContent = '';
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  for (const c of columns) {
    const th = document.createElement('th');
    th.textContent = c.title;
    htr.append(th);
  }
  thead.append(htr);
  table.append(thead);

  const tbody = document.createElement('tbody');
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = columns.length;
    td.className = 'muted';
    td.textContent = 'Keine Daten';
    tr.append(td);
    tbody.append(tr);
  }
  for (const row of rows) {
    const tr = document.createElement('tr');
    if (row.rowTitle) tr.title = row.rowTitle;
    columns.forEach((c, i) => {
      const td = document.createElement('td');
      if (i === 0) {
        td.className = 'name';
        // Mini-Balken als Groessenkanal neben dem Namen
        if (maxBarValue > 0) {
          const bar = document.createElement('span');
          bar.className = 'mini-bar';
          bar.style.width = `${Math.max(2, (row.barValue / maxBarValue) * 44)}px`;
          td.append(bar);
        }
        const span = document.createElement('span');
        span.textContent = c.get(row);
        td.append(span);
      } else {
        const out = c.get(row);
        if (out && typeof out === 'object') {
          td.textContent = out.text;
          if (out.className) td.className = out.className;
          if (out.title) td.title = out.title;
        } else {
          td.textContent = out;
        }
      }
      tr.append(td);
    });
    tbody.append(tr);
  }
  table.append(tbody);
}

function costCell(row) {
  return row.costKnown
    ? { text: usd(row.cost) }
    : { text: 'Preis unbekannt', className: 'unknown-price', title: 'Modell fehlt in pricing.json' };
}

/* --- Rendern ------------------------------------------------------------- */

function render() {
  if (!snapshot) return;
  const s = snapshot;
  const tz = s.timezone;

  $('boot').hidden = true;
  $('app').hidden = false;
  const planBadge = $('plan-badge');
  planBadge.textContent = s.planLabel ?? s.plan;
  planBadge.dataset.source = s.planSource;
  planBadge.title =
    s.planSource === 'account'
      ? `Aus deinem Account gelesen${s.rateLimitTier ? ` (${s.rateLimitTier})` : ''}`
      : 'Aus config.json – kein Account erkannt, daher ggf. falsch';

  renderWindowTile(
    s.live.fiveHour,
    { percent: 'fh-percent', meter: 'fh-meter', used: 'fh-used', limit: 'fh-limit',
      note: 'fh-note', badge: 'fh-badge' },
    tz,
  );
  $('fh-reset').textContent = s.live.fiveHour.idle
    ? '–'
    : `${duration(s.live.fiveHour.msUntilReset)} (${clock(s.live.fiveHour.end, tz)})`;
  // Bei echten Daten ist "Limit" als Tokenzahl bedeutungslos - dort steht
  // stattdessen die verbrauchte Menge im selben Zeitfenster.
  $('fh-limit').textContent =
    s.live.fiveHour.source === 'anthropic'
      ? usd(s.live.fiveHour.cost)
      : s.live.fiveHour.limit
        ? compact(s.live.fiveHour.limit)
        : 'unbekannt';
  $('fh-limit-label').textContent =
    s.live.fiveHour.source === 'anthropic' ? 'Kosten-Äquiv.' : 'Limit';

  renderWindowTile(
    s.live.week,
    { percent: 'wk-percent', meter: 'wk-meter', used: 'wk-used', note: 'wk-note',
      badge: 'wk-badge' },
    tz,
  );
  $('wk-reset').textContent = dateTime(s.live.week.end, tz);

  // Modellspezifische Wochenlimits (die API fuehrt z. B. Fable getrennt)
  const scopedEl = $('wk-scoped');
  if (s.live.scoped?.length) {
    scopedEl.hidden = false;
    scopedEl.textContent =
      'Eigenes Wochenkontingent: ' +
      s.live.scoped.map((x) => `${x.label} ${nf1.format(x.percent)} %`).join(' · ');
  } else {
    scopedEl.hidden = true;
  }

  // Herkunfts-Hinweis in der Kopfzeile
  const srcEl = $('src-note');
  if (s.live.source === 'anthropic') {
    srcEl.dataset.real = '1';
    srcEl.textContent = `echte Abo-Daten · ${s.live.rateLimitTier ?? s.live.subscriptionType ?? ''}`;
    srcEl.title = `Zuletzt abgerufen ${clock(s.live.fetchedAt, tz)}`;
  } else {
    srcEl.dataset.real = '0';
    const retry =
      s.live.nextAttemptAt && s.live.nextAttemptAt > Date.now()
        ? `, nächster Versuch ${clock(s.live.nextAttemptAt, tz)}`
        : '';
    srcEl.textContent = `geschätzt (${REASON_TEXT[s.live.reason] ?? s.live.reason ?? 'unbekannt'}${retry})`;
    srcEl.title = 'Die Limit-Anteile stammen aus der lokalen Hochrechnung.';
  }

  $('today-cost').textContent = usd(s.today.cost);
  $('today-tokens').textContent = compact(s.today.total);
  $('today-req').textContent = num(s.today.count);
  $('total-cost').textContent = usd(s.totals.cost);

  const burn = s.live.fiveHour.burnRatePerMin;
  $('burn-rate').textContent = s.live.fiveHour.idle ? '0' : `${num(burn)}`;
  const proj = s.live.fiveHour.projection;
  $('burn-projection').textContent = !proj
    ? '–'
    : proj.alreadyReached
      ? 'Limit überschritten'
      : proj.beforeReset
        ? `in ${duration(proj.minutesRemaining * 60000)}`
        : 'nach dem Reset';
  $('cache-hit').textContent = pct(s.cache.hitRate * 100);

  // --- Abo-Gegenwert
  const sub = s.subscription;
  const valTile = $('tile-value');
  if (sub?.priceUsd) {
    valTile.hidden = false;
    $('val-ratio').textContent = `${nf1.format(sub.ratio)}×`;
    $('val-cost').textContent = usd(sub.cost);
    $('val-price').textContent = usd(sub.priceUsd);
    $('val-period').textContent = `ab ${dateOnly(sub.start, tz)}`;
    $('val-note').textContent =
      sub.ratio >= 1
        ? `Über die API hättest du in diesem Abrechnungszeitraum ${usd(sub.cost)} gezahlt.`
        : 'API-Äquivalent liegt noch unter dem Abo-Preis.';
  } else {
    // Ohne hinterlegten Preis keine erfundene Kennzahl.
    valTile.hidden = true;
  }

  // --- 30-Tage-Chart
  $('daily-sub').textContent =
    `gewichtete Tokens pro Tag · ${s.timezone}` +
    (s.countingWeights.cacheRead === 0 ? ' · ohne Cache-Reads' : '');
  renderColumnChart($('chart-daily'), {
    data: s.daily.map((d) => ({
      label: shortDay(d.day),
      value: d.weighted,
      tooltip:
        `${dayLabel(d.day)}\n` +
        `${num(d.weighted)} gewichtete Tokens\n` +
        `${compact(d.total)} gesamt · ${d.costKnown ? usd(d.cost) : 'Preis unbekannt'}\n` +
        `${num(d.count)} Requests`,
    })),
    height: 200,
    formatTick: compact,
    labelEvery: 5,
    tooltip,
    emptyText: 'Noch keine Daten in den letzten 30 Tagen',
  });

  // --- Tagesverlauf
  renderColumnChart($('chart-hourly'), {
    data: s.today.byHour.map((h) => ({
      label: String(h.hour).padStart(2, '0'),
      value: h.weighted,
      dim: h.future,
      tooltip:
        `${String(h.hour).padStart(2, '0')}:00–${String(h.hour).padStart(2, '0')}:59\n` +
        `${num(h.weighted)} gewichtete Tokens\n` +
        `${compact(h.total)} gesamt · ${usd(h.cost)}\n` +
        `${num(h.count)} Requests`,
    })),
    height: 180,
    formatTick: compact,
    labelEvery: 3,
    tooltip,
    emptyText: 'Heute noch keine Aktivität',
  });

  // --- Token-Zusammensetzung
  const t = s.totals.tokens;
  const mix = [
    { label: 'Cache-Read', value: t.cacheRead, color: 'var(--series-1)' },
    { label: 'Cache-Write 1 Std.', value: t.cacheWrite1h, color: 'var(--series-2)' },
    { label: 'Cache-Write 5 Min.', value: t.cacheWrite5m, color: 'var(--series-3)' },
    { label: 'Output', value: t.output, color: 'var(--series-4)' },
    { label: 'Input', value: t.input, color: 'var(--series-5)' },
  ].map((m) => ({ ...m, formatted: `${num(m.value)} Tokens` }));

  // --- 5-Stunden-Blöcke
  // Farbe kodiert hier die Warnstufe; ohne belastbares Limit bleibt es bei der
  // neutralen Serienfarbe, damit keine Stufe suggeriert wird, die es nicht gibt.
  const blocks = s.blocks ?? [];
  const hasBlockLimit = blocks.some((b) => b.percent != null);
  const bl = s.blocksLimit ?? {};
  const BLOCK_BASIS = {
    measured: 'gemessen aus dem Vergleich mit Anthropic',
    auto: 'gegen das höchste bisher beobachtete Fenster',
    plan: 'gegen den Planwert aus config.json',
  };
  // Für abgeschlossene Fenster liefert Anthropic keine Prozentwerte - diese
  // Balken sind also lokal gerechnet, auch wenn die Kachel oben echt ist.
  $('blocks-sub').textContent = hasBlockLimit
    ? `Auslastung je Fenster, ${BLOCK_BASIS[bl.source] ?? 'lokal gerechnet'} · neuestes rechts`
    : 'gewichtete Tokens je Fenster · neuestes rechts';
  renderColumnChart($('chart-blocks'), {
    data: blocks.map((b) => ({
      // Uhrzeit allein wiederholt sich über Tage hinweg; das Datum trennt.
      label: dayMonth(b.start, tz),
      value: hasBlockLimit ? (b.percent ?? 0) : b.weighted,
      color: hasBlockLimit ? LEVEL_COLOR[b.level] : undefined,
      dim: b.active,
      tooltip:
        `${dateTime(b.start, tz)} – ${clock(b.end, tz)}${b.active ? '  (läuft)' : ''}\n` +
        (b.percent != null ? `${pct(b.percent)} des Limits\n` : '') +
        `${num(b.weighted)} gewichtete Tokens\n` +
        `${compact(b.total)} gesamt · ${b.costKnown ? usd(b.cost) : 'Preis unbekannt'}\n` +
        `${num(b.count)} Requests`,
    })),
    height: 190,
    formatTick: hasBlockLimit ? (v) => `${nf0.format(v)} %` : compact,
    labelEvery: blocks.length > 12 ? 3 : 1,
    tooltip,
    emptyText: 'Noch keine abgeschlossenen 5-Stunden-Fenster',
  });

  renderStackedBar($('chart-mix'), mix, { tooltip });
  const legend = $('mix-legend');
  legend.textContent = '';
  const mixTotal = mix.reduce((a, m) => a + m.value, 0) || 1;
  for (const m of mix) {
    const li = document.createElement('li');
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = m.color;
    const name = document.createElement('span');
    name.textContent = m.label;
    const val = document.createElement('span');
    val.className = 'legend-value';
    val.textContent = `${compact(m.value)} · ${nf1.format((m.value / mixTotal) * 100)} %`;
    li.append(sw, name, val);
    legend.append(li);
  }

  // --- Tabellen
  // Schmale Panels: nur Name / Tokens / Kosten. Requests wandern in den
  // Zeilen-Tooltip - sonst wird die Kostenspalte abgeschnitten.
  const compactCols = (nameTitle) => [
    { title: nameTitle, get: (r) => r.key },
    { title: 'Tokens', get: (r) => compact(r.total) },
    { title: 'Kosten', get: costCell },
  ];

  buildTable($('tbl-projects'), {
    columns: compactCols('Projekt'),
    rows: s.byProject.map((p) => ({
      ...p,
      barValue: p.cost,
      rowTitle: `${num(p.count)} Requests · ${num(p.total)} Tokens`,
    })),
    maxBarValue: Math.max(0, ...s.byProject.map((p) => p.cost)),
  });

  buildTable($('tbl-models'), {
    columns: compactCols('Modell'),
    rows: s.byModel.map((m) => ({
      ...m,
      barValue: m.cost,
      rowTitle: `${num(m.count)} Requests · ${num(m.total)} Tokens`,
    })),
    maxBarValue: Math.max(0, ...s.byModel.map((m) => m.cost)),
  });

  buildTable($('tbl-sessions'), {
    columns: [
      { title: 'Projekt', get: (r) => r.projects[0] ?? '–' },
      { title: 'Session', get: (r) => ({ text: String(r.key).slice(0, 8), title: r.key }) },
      { title: 'Zuletzt', get: (r) => ({ text: dateTime(r.lastTs, tz) }) },
      { title: 'Tokens', get: (r) => compact(r.total) },
      { title: 'Requests', get: (r) => num(r.count) },
      { title: 'Kosten', get: costCell },
    ],
    rows: s.bySession.map((x) => ({ ...x, barValue: x.cost })),
    maxBarValue: Math.max(0, ...s.bySession.map((x) => x.cost)),
  });

  // --- Fusszeile
  const sc = s.scan ?? {};
  $('scan-info').textContent =
    `${num(sc.files)} Transkripte` +
    (sc.filesSkipped ? ` (${num(sc.filesSkipped)} bereits archiviert, nicht erneut gelesen)` : '') +
    ` · ${num(sc.uniqueRequests)} eindeutige Requests ` +
    `(${num(sc.duplicatesSkipped)} Duplikate übersprungen, ${num(sc.brokenLines)} defekte Zeilen) · ` +
    `zuletzt eingelesen ${clock(sc.lastScanMs, tz)} in ${num(sc.lastScanDurationMs)} ms`;

  const h = s.history;
  const histEl = $('history-info');
  if (h?.enabled) {
    const parts = [
      `Archiv: ${num(h.days)} Tage aus ${num(h.files)} Transkripten`,
      h.firstDay ? `ab ${dayLabelShort(h.firstDay)}` : null,
      h.archivedOnly
        ? `${num(h.archivedOnly)} davon von Claude Code bereits aufgeräumt – nur hier noch vorhanden`
        : null,
      h.merged ? `${num(h.merged)} weiteres Gerät eingebunden` : null,
      h.bytes != null ? `${nf1.format(h.bytes / 1024)} KB` : null,
      h.note,
    ].filter(Boolean);
    histEl.hidden = false;
    histEl.textContent = parts.join(' · ');
  } else {
    histEl.hidden = false;
    histEl.textContent =
      'Archiv deaktiviert – die Historie reicht nur so weit zurück, wie Claude Code seine Transkripte aufhebt.';
  }

  // Kalibrierung: was wurde gemessen, und erklären Tokens oder Kosten die
  // Auslastung besser? Diese Frage ist offen, solange Anthropic nichts sagt.
  const calEl = $('calib-info');
  const cal = s.calibration?.fiveHour;
  if (cal && cal.samples > 0) {
    calEl.hidden = false;
    if (cal.ok) {
      const better =
        cal.better === 'tokens'
          ? ' Die Auslastung folgt den gewichteten Tokens enger als den Kosten.'
          : cal.better === 'cost'
            ? ' Die Auslastung folgt den Kosten enger als den Tokens – das Limit dürfte kostenbasiert sein.'
            : ' Tokens und Kosten erklären sie bisher gleich gut.';
      calEl.textContent =
        `Gemessen aus ${num(cal.samples)} Vergleichen in ${num(cal.windows)} Fenstern: ` +
        `1 % des 5h-Limits ≈ ${compact(cal.tokensPerPercent)} gewichtete Tokens ` +
        `bzw. ${usd(cal.costPerPercent)}. Volles Fenster ≈ ${compact(cal.limit)} Tokens.` +
        better;
    } else {
      calEl.textContent =
        `Kalibrierung sammelt: ${num(cal.samples)} von ${num(cal.minSamples)} Messpunkten aus ` +
        `${num(cal.windows)} von ${num(cal.minWindows)} verschiedenen Fenstern. ` +
        'Danach steht das Limit auf gemessenen Zahlen statt auf einer Schätzung.';
    }
  } else {
    calEl.hidden = true;
  }

  // Ehrlicher Hinweis: oben Account, unten dieses Gerät.
  const scopeEl = $('scope-note');
  scopeEl.textContent =
    s.live.source === 'anthropic'
      ? 'Die Auslastung oben gilt für deinen gesamten Account, die Aufschlüsselungen unten nur für die ' +
        'Transkripte auf diesem Gerät. Wer auf mehreren Rechnern arbeitet, kann die Archive über ' +
        'history.mirrorTo / history.merge in der config.json zusammenführen.'
      : 'Alle Zahlen stammen von diesem Gerät. Arbeit auf anderen Rechnern zählt gegen dasselbe Abo, ' +
        'taucht hier aber nicht auf.';

  // Preistabelle altert still - deshalb sichtbar machen, wie alt sie ist.
  const pm = s.pricingMeta;
  const priceEl = $('warn-price');
  const ageDays = pm?.lastUpdated
    ? Math.floor((Date.now() - Date.parse(pm.lastUpdated)) / 86400000)
    : null;
  if (ageDays != null && ageDays > 120) {
    priceEl.hidden = false;
    priceEl.textContent =
      `Die Preistabelle ist vom ${dayLabelShort(pm.lastUpdated)} und damit ${num(ageDays)} Tage alt. ` +
      'Alle USD-Beträge können daneben liegen – pricing.json prüfen.';
  } else {
    priceEl.hidden = true;
  }

  // Der Hinweistext muss zur tatsaechlichen Datenquelle passen - sonst steht
  // "Schätzung" unter echten Werten.
  const disc = $('disclaimer');
  disc.textContent = '';
  const frag = document.createDocumentFragment();
  const strong = (t) => {
    const el = document.createElement('strong');
    el.textContent = t;
    return el;
  };
  const code = (t) => {
    const el = document.createElement('code');
    el.textContent = t;
    return el;
  };
  if (s.live.source === 'anthropic') {
    frag.append(
      'Die Limit-Anteile sind ',
      strong('echte Werte aus deinem Abo'),
      ', abgerufen von Anthropic — dieselbe Quelle wie ',
      code('/usage'),
      ' in Claude Code. Tokens, Kosten und alle Aufschlüsselungen stammen aus den lokalen ' +
        'Transkripten; das Kosten-Äquivalent laut ',
      code('pricing.json'),
      ' entspricht nicht deiner Abo-Rechnung.',
    );
  } else {
    frag.append(
      'Anthropic war nicht abrufbar (',
      REASON_TEXT[s.live.reason] ?? s.live.reason ?? 'unbekannt',
      '), deshalb sind die Limit-Anteile ',
      strong('geschätzt'),
      ' und mit Vorsicht zu lesen. Einstellbar in ',
      code('config.json'),
      '. Kostenangaben sind das API-Preis-Äquivalent laut ',
      code('pricing.json'),
      '.',
    );
  }
  disc.append(frag);

  const unknownEl = $('warn-unknown');
  if (s.unknownModels?.length) {
    unknownEl.hidden = false;
    unknownEl.textContent =
      `Ohne Preisangabe in pricing.json: ${s.unknownModels.join(', ')} — ` +
      `deren Tokens zählen mit, die Kosten nicht.`;
  } else {
    unknownEl.hidden = true;
  }

  updateTabSignals(s);
  maybeNotify(s);
}

function dayLabel(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

function dayLabelShort(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  if (!y || !m || !d) return String(key);
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/* --- Warnkanaele --------------------------------------------------------- */

/**
 * Der Tab-Titel und das Favicon tragen die Auslastung mit.
 *
 * Ein Dashboard im Hintergrund-Tab wird nicht angesehen - der Tab selbst ist
 * der einzige Kanal, der ohne Zutun sichtbar bleibt.
 */
const FAVICON_COLOR = { ok: '%233987e5', warn: '%23fab219', critical: '%23d03b3b', unknown: '%236b6b68' };

function setFavicon(level) {
  const fill = FAVICON_COLOR[level] ?? FAVICON_COLOR.unknown;
  const href =
    "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'>" +
    `<rect width='16' height='16' rx='4' fill='${fill}'/></svg>`;
  let link = document.querySelector("link[rel='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.append(link);
  }
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
}

function updateTabSignals(s) {
  const w = s.live.fiveHour;
  const label = w.percent == null ? compact(w.weighted) : `${nf0.format(w.percent)} %`;
  document.title = `${label} · Claude Usage`;
  setFavicon(w.level);
}

/**
 * Desktop-Hinweis beim Erreichen einer Warnschwelle.
 *
 * Bewusst opt-in ueber einen Schalter: ungefragt nach der Berechtigung zu
 * fragen ist aufdringlich. Pro Fenster wird jede Stufe hoechstens einmal
 * gemeldet - sonst meldet ein 20-Sekunden-Polling im Minutentakt dasselbe.
 */
const notify = {
  enabled: localStorage.getItem('cud-notify') === '1',
  seen: new Set(),
};

function updateNotifyButton() {
  const btn = $('notify-toggle');
  if (typeof Notification === 'undefined') {
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  const on = notify.enabled && Notification.permission === 'granted';
  btn.textContent = on ? 'Hinweise an' : 'Hinweise aus';
  btn.dataset.on = on ? '1' : '0';
  btn.title =
    Notification.permission === 'denied'
      ? 'Der Browser hat Hinweise für diese Seite blockiert.'
      : 'Desktop-Hinweis beim Erreichen von Warn- und Kritisch-Schwelle';
}

function maybeNotify(s) {
  if (!notify.enabled || typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  for (const [key, w, name] of [
    ['5h', s.live.fiveHour, '5-Stunden-Fenster'],
    ['week', s.live.week, 'Wochenlimit'],
  ]) {
    if (w.percent == null || (w.level !== 'warn' && w.level !== 'critical')) continue;
    const id = `${key}:${w.end}:${w.level}`;
    if (notify.seen.has(id)) continue;
    notify.seen.add(id);
    try {
      new Notification(
        w.level === 'critical' ? `${name}: ${pct(w.percent)} – kritisch` : `${name}: ${pct(w.percent)}`,
        {
          body: `Reset ${dateTime(w.end, s.timezone)}`,
          tag: `cud-${key}`,
        },
      );
    } catch {
      /* Benachrichtigung nicht moeglich - kein Grund, das Rendern zu stoeren. */
    }
  }
}

/* --- Verbindung ---------------------------------------------------------- */

function setConn(state, text) {
  const el = $('conn');
  el.dataset.state = state;
  $('conn-text').textContent = text;
}

function connect() {
  const es = new EventSource('/api/events');

  es.addEventListener('snapshot', (ev) => {
    try {
      snapshot = JSON.parse(ev.data);
      render();
      setConn('live', 'live');
    } catch (err) {
      console.error('Snapshot nicht lesbar', err);
    }
  });

  es.addEventListener('open', () => setConn('live', 'live'));
  es.addEventListener('error', () => {
    setConn('off', 'getrennt – verbinde neu');
    // EventSource verbindet selbst neu (retry vom Server gesetzt).
  });
}

/* --- Start --------------------------------------------------------------- */

$('refresh').addEventListener('click', async () => {
  setConn('', 'lese neu …');
  await fetch('/api/rescan', { method: 'POST' }).catch(() => {});
});

const notifyBtn = $('notify-toggle');
notifyBtn.addEventListener('click', async () => {
  if (typeof Notification === 'undefined') return;
  if (notify.enabled && Notification.permission === 'granted') {
    notify.enabled = false;
    localStorage.setItem('cud-notify', '0');
  } else {
    const perm =
      Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission().catch(() => 'denied');
    notify.enabled = perm === 'granted';
    localStorage.setItem('cud-notify', notify.enabled ? '1' : '0');
  }
  updateNotifyButton();
});
updateNotifyButton();

const themeBtn = $('theme-toggle');
const savedTheme = localStorage.getItem('cud-theme');
if (savedTheme === 'light') document.documentElement.dataset.theme = 'light';
const syncThemeLabel = () => {
  themeBtn.textContent = document.documentElement.dataset.theme === 'light' ? 'Dunkel' : 'Hell';
};
syncThemeLabel();
themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('cud-theme', next);
  syncThemeLabel();
  render();
});

// Charts bei Groessenaenderung neu zeichnen: das SVG wird in Pixeln gerechnet,
// also muss es der tatsaechlichen Containerbreite folgen. Beobachtet werden die
// Chart-Container selbst - ein reiner window-resize-Listener verpasst
// Layoutwechsel, die nicht vom Fenster kommen (Grid klappt auf eine Spalte um).
let resizeTimer = null;
const lastWidths = new WeakMap();
const scheduleRerender = () => {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 120);
};

if (typeof ResizeObserver === 'function') {
  const ro = new ResizeObserver((records) => {
    let changed = false;
    for (const r of records) {
      const w = Math.round(r.contentRect.width);
      if (lastWidths.get(r.target) !== w) {
        lastWidths.set(r.target, w);
        changed = true;
      }
    }
    if (changed) scheduleRerender();
  });
  for (const id of ['chart-daily', 'chart-hourly', 'chart-blocks']) ro.observe($(id));
} else {
  window.addEventListener('resize', scheduleRerender);
}

// Restlaufzeiten laufen zwischen den Snapshots weiter.
setInterval(() => {
  if (!snapshot) return;
  const w = snapshot.live.fiveHour;
  if (w.idle) return;
  const left = Math.max(0, w.end - Date.now());
  $('fh-reset').textContent = `${duration(left)} (${clock(w.end, snapshot.timezone)})`;
}, 30000);

// ?static=1 laedt einmalig und oeffnet keinen SSE-Strom. Gedacht fuer
// Screenshots und eingefrorene Ansichten (ein offener Stream verhindert sonst,
// dass ein Headless-Browser den Ladevorgang je abschliesst).
const staticMode = new URLSearchParams(location.search).get('static') === '1';

fetch('/api/snapshot')
  .then((r) => r.json())
  .then((data) => {
    snapshot = data;
    render();
  })
  .catch(() => {
    $('boot').textContent = 'Server nicht erreichbar.';
  })
  .finally(() => {
    if (staticMode) setConn('', 'Standbild');
    else connect();
  });
