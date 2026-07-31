/**
 * Handgeschriebene SVG-Charts - keine Bibliothek, keine externen Requests.
 *
 * Mark-Spezifikation: Balken max. 24px breit, 4px abgerundete Datenkante,
 * eckig an der Grundlinie, 2px Luecke zwischen benachbarten Balken,
 * Gitterlinien als 1px-Haarlinie.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null) node.setAttribute(k, String(v));
  }
  return node;
}

/** Achsen-Obergrenze auf eine runde Zahl aufrunden (1/2/5 x 10^n). */
export function niceMax(value) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const pow = 10 ** exp;
  const frac = value / pow;
  const step = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return step * pow;
}

/**
 * Pfad fuer einen Balken mit abgerundeter Oberkante und eckiger Grundlinie.
 * Der Radius wird bei sehr flachen Balken automatisch reduziert, damit die
 * Rundung die Balkenhoehe nie uebersteigt.
 */
export function roundedTopBar(x, y, w, h, r = 4) {
  const radius = Math.max(0, Math.min(r, w / 2, h));
  if (radius === 0) return `M${x} ${y}h${w}v${h}h${-w}z`;
  return (
    `M${x} ${y + radius}` +
    `a${radius} ${radius} 0 0 1 ${radius} ${-radius}` +
    `h${w - 2 * radius}` +
    `a${radius} ${radius} 0 0 1 ${radius} ${radius}` +
    `v${h - radius}` +
    `h${-w}` +
    `z`
  );
}

/**
 * Saeulendiagramm mit einer Serie.
 *
 * Eine Serie heisst: keine Legende noetig (die Ueberschrift benennt, was
 * geplottet ist), dafuer Hover-Tooltip ueber der vollen Bandbreite.
 */
export function renderColumnChart(container, options) {
  const {
    data = [],
    color = 'var(--series-1)',
    dimColor = 'var(--series-1-dim)',
    height = 180,
    formatValue = (v) => String(v),
    formatTick = (v) => String(v),
    labelEvery = 1,
    tooltip,
    emptyText = 'Keine Daten',
  } = options;

  container.textContent = '';
  const width = Math.max(container.clientWidth || 0, 240);

  if (!data.length || data.every((d) => !d.value)) {
    const empty = document.createElement('p');
    empty.className = 'chart-empty';
    empty.textContent = emptyText;
    container.append(empty);
    return;
  }

  const padL = 52;
  const padR = 10;
  const padT = 12;
  const padB = 26;
  const plotW = Math.max(10, width - padL - padR);
  const plotH = Math.max(10, height - padT - padB);

  const max = niceMax(Math.max(...data.map((d) => d.value || 0)));
  const yOf = (v) => padT + plotH - (v / max) * plotH;

  // viewBox + max-width:100% (im CSS): sollte die gemessene Breite je von der
  // tatsaechlichen abweichen, skaliert das SVG herunter statt das Layout
  // aufzublaehen und die ganze Seite horizontal scrollen zu lassen.
  const svg = el('svg', {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: 'xMinYMin meet',
    role: 'img',
    class: 'chart-svg',
  });

  // Gitterlinien + Y-Achsenbeschriftung (rechtsbuendig, tabellarische Ziffern)
  for (const frac of [0, 0.5, 1]) {
    const v = max * frac;
    const y = yOf(v);
    svg.append(
      el('line', {
        x1: padL,
        x2: width - padR,
        y1: y,
        y2: y,
        class: frac === 0 ? 'chart-baseline' : 'chart-grid',
      }),
    );
    const t = el('text', { x: padL - 8, y: y + 4, class: 'chart-tick', 'text-anchor': 'end' });
    t.textContent = formatTick(v);
    svg.append(t);
  }

  const band = plotW / data.length;
  const barW = Math.max(1, Math.min(24, band - 2)); // 2px Luecke in Flaechenfarbe

  data.forEach((d, i) => {
    const bandX = padL + i * band;
    const value = d.value || 0;
    const h = value > 0 ? Math.max(2, plotH - (yOf(value) - padT)) : 0;
    const x = bandX + (band - barW) / 2;

    if (h > 0) {
      svg.append(
        el('path', {
          d: roundedTopBar(x, padT + plotH - h, barW, h, 4),
          fill: d.dim ? dimColor : color,
        }),
      );
    }

    // Trefferflaeche ueber die volle Bandhoehe - groesser als die Marke selbst.
    const hit = el('rect', {
      x: bandX,
      y: padT,
      width: band,
      height: plotH,
      fill: 'transparent',
      class: 'chart-hit',
    });
    if (tooltip) {
      hit.addEventListener('pointerenter', (ev) =>
        tooltip.show(ev, d.tooltip ?? `${d.label}: ${formatValue(value)}`),
      );
      hit.addEventListener('pointermove', (ev) => tooltip.move(ev));
      hit.addEventListener('pointerleave', () => tooltip.hide());
    }
    svg.append(hit);

    if (i % labelEvery === 0) {
      const label = el('text', {
        x: bandX + band / 2,
        y: height - 8,
        class: 'chart-label',
        'text-anchor': 'middle',
      });
      label.textContent = d.label;
      svg.append(label);
    }
  });

  container.append(svg);
}

/**
 * Gestapelter Einzelbalken (Anteile einer Gesamtmenge).
 * Segmente sind durch eine 2px-Luecke in Flaechenfarbe getrennt, nicht durch
 * eine Kontur - eine Kontur waere Tinte ohne Datengehalt.
 */
export function renderStackedBar(container, segments, { tooltip, height = 14 } = {}) {
  container.textContent = '';
  const total = segments.reduce((a, s) => a + (s.value || 0), 0);
  if (total <= 0) {
    const empty = document.createElement('p');
    empty.className = 'chart-empty';
    empty.textContent = 'Keine Daten';
    container.append(empty);
    return;
  }

  const bar = document.createElement('div');
  bar.className = 'stackbar';
  bar.style.height = `${height}px`;

  for (const s of segments) {
    if (!s.value) continue;
    const part = document.createElement('div');
    part.className = 'stackbar-seg';
    part.style.flexGrow = String(s.value);
    part.style.background = s.color;
    if (tooltip) {
      const share = ((s.value / total) * 100).toFixed(1).replace('.', ',');
      const text = `${s.label}: ${s.formatted ?? s.value} (${share} %)`;
      part.addEventListener('pointerenter', (ev) => tooltip.show(ev, text));
      part.addEventListener('pointermove', (ev) => tooltip.move(ev));
      part.addEventListener('pointerleave', () => tooltip.hide());
    }
    bar.append(part);
  }
  container.append(bar);
}

/** Gemeinsamer Tooltip fuer alle Charts. */
export function createTooltip() {
  const node = document.createElement('div');
  node.className = 'tooltip';
  node.setAttribute('role', 'status');
  node.hidden = true;
  document.body.append(node);

  const place = (ev) => {
    const pad = 14;
    const rect = node.getBoundingClientRect();
    let x = ev.clientX + pad;
    let y = ev.clientY + pad;
    if (x + rect.width > window.innerWidth - 8) x = ev.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - 8) y = ev.clientY - rect.height - pad;
    node.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
  };

  return {
    show(ev, text) {
      node.textContent = text;
      node.hidden = false;
      place(ev);
    },
    move(ev) {
      if (!node.hidden) place(ev);
    },
    hide() {
      node.hidden = true;
    },
  };
}
