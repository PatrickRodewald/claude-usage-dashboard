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

function shortDay(key) {
  const [, m, d] = key.split('-');
  return `${Number(d)}.${Number(m)}.`;
}

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
    if (w.limitSource === 'auto') {
      parts.push(`100 % = höchstes bisher gemessenes Fenster (${w.limitSamples} Vergleichswerte).`);
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
    `${num(sc.files)} Transkripte · ${num(sc.uniqueRequests)} eindeutige Requests ` +
    `(${num(sc.duplicatesSkipped)} Duplikate übersprungen, ${num(sc.brokenLines)} defekte Zeilen) · ` +
    `zuletzt eingelesen ${clock(sc.lastScanMs, tz)} in ${num(sc.lastScanDurationMs)} ms`;

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
  for (const id of ['chart-daily', 'chart-hourly']) ro.observe($(id));
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
