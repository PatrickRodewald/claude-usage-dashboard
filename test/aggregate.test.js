import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPricing } from '../src/pricing.js';
import {
  buildSnapshot,
  rollup,
  rollupBuckets,
  bucketsFromEntries,
  resolveLimit,
  projectLabels,
} from '../src/aggregate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pricing = createPricing(
  JSON.parse(fs.readFileSync(path.join(here, '..', 'pricing.json'), 'utf8')),
);

const iso = (s) => Date.parse(s);
const HOUR = 3600_000;

const baseConfig = {
  timezone: 'Europe/Berlin',
  locale: 'de-DE',
  plan: 'max5x',
  limits: {
    mode: 'fixed',
    autoMinSamples: 3,
    plans: { max5x: { fiveHourTokens: 88000, weeklyTokens: 1760000 } },
  },
  counting: { weights: { input: 1, output: 1, cacheWrite: 1, cacheRead: 0 } },
  window: { fiveHourBlockHours: 5, anchorToFullHour: true },
  week: { resetWeekday: 1, resetHour: 0, resetMinute: 0 },
  warnings: { warnPercent: 70, criticalPercent: 90 },
};

function entry(isoTs, over = {}) {
  return {
    key: `k-${isoTs}-${over.tag ?? ''}`,
    ts: iso(isoTs),
    model: 'claude-opus-5',
    speed: 'standard',
    sessionId: 'sess-1',
    project: 'projekt-a',
    input: 0,
    output: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0,
    ...over,
  };
}

// --- rollup ---------------------------------------------------------------

test('rollup gruppiert und summiert Tokens plus Kosten', () => {
  const entries = [
    entry('2026-07-31T09:00:00Z', { project: 'a', output: 1_000_000 }),
    entry('2026-07-31T10:00:00Z', { project: 'a', output: 1_000_000, tag: '2' }),
    entry('2026-07-31T11:00:00Z', { project: 'b', output: 1_000_000 }),
  ];
  const map = rollup(entries, (e) => e.project, pricing);
  assert.equal(map.size, 2);
  assert.equal(map.get('a').tokens.output, 2_000_000);
  assert.equal(map.get('a').count, 2);
  assert.ok(Math.abs(map.get('a').cost - 50) < 1e-9, 'Opus 5: 2 Mio. Output = 50 USD');
  assert.equal(map.get('b').costKnown, true);
});

test('rollup markiert Gruppen mit unbekanntem Modell', () => {
  const map = rollup(
    [entry('2026-07-31T09:00:00Z', { model: 'claude-phantasie-1', output: 100 })],
    (e) => e.model,
    pricing,
  );
  assert.equal(map.get('claude-phantasie-1').costKnown, false);
  assert.equal(map.get('claude-phantasie-1').cost, 0);
});

test('rollup ueberspringt Eintraege mit null-Schluessel', () => {
  const map = rollup(
    [entry('2026-07-31T09:00:00Z', { sessionId: null }), entry('2026-07-31T10:00:00Z', { tag: 'x' })],
    (e) => e.sessionId,
    pricing,
  );
  assert.equal(map.size, 1);
});

// --- Limit-Aufloesung -----------------------------------------------------

test('fixed nutzt den Planwert', () => {
  const r = resolveLimit({ mode: 'fixed', planLimit: 88000, history: [1, 2, 3] });
  assert.equal(r.limit, 88000);
  assert.equal(r.source, 'plan');
});

test('auto kalibriert gegen das hoechste historische Fenster', () => {
  const r = resolveLimit({ mode: 'auto', planLimit: 88000, history: [100, 900, 400], minSamples: 3 });
  assert.equal(r.limit, 900);
  assert.equal(r.source, 'auto');
  assert.equal(r.samples, 3);
});

test('auto meldet "kalibriert noch" statt auf den geratenen Planwert zurueckzufallen', () => {
  // Der Planwert lag in echten Daten um Faktor 3 daneben; ihn als Nenner zu
  // nehmen wuerde eine erfundene Prozentzahl als "kritisch" anzeigen.
  const r = resolveLimit({ mode: 'auto', planLimit: 88000, history: [100], minSamples: 3 });
  assert.equal(r.limit, null);
  assert.equal(r.source, 'calibrating');
  assert.equal(r.samples, 1);
  assert.equal(r.minSamples, 3);
});

test('ohne belastbares Limit gibt es keinen Prozentwert und keine Warnstufe', () => {
  const cfg = { ...baseConfig, limits: { ...baseConfig.limits, mode: 'auto', autoMinSamples: 5 } };
  const now = iso('2026-07-31T11:00:00Z');
  const snap = buildSnapshot([entry('2026-07-31T09:10:00Z', { output: 5000 })], {
    config: cfg,
    pricing,
    now,
  });
  assert.equal(snap.live.fiveHour.limit, null);
  assert.equal(snap.live.fiveHour.percent, null);
  assert.equal(snap.live.fiveHour.level, 'unknown');
  assert.equal(snap.live.fiveHour.limitSource, 'calibrating');
  assert.equal(snap.live.fiveHour.weighted, 5000, 'absoluter Wert bleibt verfuegbar');
});

test('fixed ohne Planwert laesst das Limit unbekannt', () => {
  const r = resolveLimit({ mode: 'fixed', planLimit: undefined, history: [500] });
  assert.equal(r.limit, null);
  assert.equal(r.source, 'unknown');
});

// --- Projekt-Anzeigenamen -------------------------------------------------

test('Projektname stammt vom flachsten cwd, nicht vom Unterverzeichnis', () => {
  // Genau dieser Fall liess ein Projekt in echten Daten in "src", "server"
  // und "components" zerfallen: cwd wechselt waehrend der Sitzung.
  const entries = [
    entry('2026-07-31T09:00:00Z', { project: 'c--Projekte-AcmeShop', cwd: 'c:\\Projekte\\AcmeShop\\src\\components' }),
    entry('2026-07-31T09:05:00Z', { project: 'c--Projekte-AcmeShop', cwd: 'c:\\Projekte\\AcmeShop', tag: 'b' }),
    entry('2026-07-31T09:10:00Z', { project: 'c--Projekte-AcmeShop', cwd: 'c:\\Projekte\\AcmeShop\\server', tag: 'c' }),
  ];
  assert.equal(projectLabels(entries).get('c--Projekte-AcmeShop'), 'AcmeShop');
});

test('ohne cwd faellt der Anzeigename auf den Transkript-Ordner zurueck', () => {
  const entries = [entry('2026-07-31T09:00:00Z', { project: 'c--Projekte-foo-bar', cwd: null })];
  assert.equal(projectLabels(entries).get('c--Projekte-foo-bar'), 'foo-bar');
});

test('Snapshot gruppiert Projekte stabil und zeigt den lesbaren Namen', () => {
  const now = iso('2026-07-31T11:00:00Z');
  const entries = [
    entry('2026-07-31T09:00:00Z', { project: 'c--Projekte-app', cwd: 'c:\\Projekte\\app\\src', output: 1000 }),
    entry('2026-07-31T09:05:00Z', { project: 'c--Projekte-app', cwd: 'c:\\Projekte\\app', output: 2000, tag: 'b' }),
  ];
  const snap = buildSnapshot(entries, { config: baseConfig, pricing, now });
  assert.equal(snap.byProject.length, 1, 'ein Projekt, nicht zwei');
  assert.equal(snap.byProject[0].key, 'app');
  assert.equal(snap.byProject[0].id, 'c--Projekte-app');
  assert.equal(snap.byProject[0].tokens.output, 3000);
});

// --- Snapshot -------------------------------------------------------------

test('Snapshot berechnet 5h-Fenster, Prozentanteil und Warnstufe', () => {
  const now = iso('2026-07-31T11:00:00Z');
  const entries = [
    entry('2026-07-31T09:10:00Z', { output: 40000 }),
    entry('2026-07-31T10:30:00Z', { output: 40000, tag: '2' }),
  ];
  const snap = buildSnapshot(entries, { config: baseConfig, pricing, now });

  assert.equal(snap.live.fiveHour.start, iso('2026-07-31T09:00:00Z'));
  assert.equal(snap.live.fiveHour.end, iso('2026-07-31T14:00:00Z'));
  assert.equal(snap.live.fiveHour.weighted, 80000);
  assert.equal(snap.live.fiveHour.limit, 88000);
  assert.ok(Math.abs(snap.live.fiveHour.percent - 90.909) < 0.01);
  assert.equal(snap.live.fiveHour.level, 'critical');
  assert.equal(snap.live.fiveHour.idle, false);
  assert.equal(snap.live.fiveHour.msUntilReset, 3 * HOUR);
});

test('cacheRead mit Gewicht 0 zaehlt nicht gegen das Limit, aber in die Kosten', () => {
  const now = iso('2026-07-31T11:00:00Z');
  const entries = [entry('2026-07-31T09:10:00Z', { output: 1000, cacheRead: 50_000_000 })];
  const snap = buildSnapshot(entries, { config: baseConfig, pricing, now });

  assert.equal(snap.live.fiveHour.weighted, 1000, 'Cache-Reads ausgeklammert');
  assert.equal(snap.live.fiveHour.total, 50_001_000, 'Rohsumme enthaelt sie sehr wohl');
  assert.ok(snap.live.fiveHour.cost > 25, 'Cache-Reads kosten trotzdem Geld');
});

test('Snapshot ohne Eintraege stuerzt nicht ab', () => {
  const snap = buildSnapshot([], { config: baseConfig, pricing, now: iso('2026-07-31T11:00:00Z') });
  assert.equal(snap.live.fiveHour.idle, true);
  assert.equal(snap.live.fiveHour.weighted, 0);
  assert.equal(snap.totals.requests, 0);
  assert.equal(snap.daily.length, 30);
  assert.equal(snap.today.byHour.length, 24);
  assert.equal(snap.cache.hitRate, 0);
  assert.deepEqual(snap.byProject, []);
});

test('Wochenfenster erfasst nur Eintraege der laufenden Woche', () => {
  const now = iso('2026-07-31T11:00:00Z'); // Fr, Woche ab Mo 27.07. 00:00 Berlin
  const entries = [
    entry('2026-07-26T12:00:00Z', { output: 999 }), // So, Vorwoche
    entry('2026-07-28T12:00:00Z', { output: 100, tag: 'a' }),
    entry('2026-07-31T09:00:00Z', { output: 200, tag: 'b' }),
  ];
  const snap = buildSnapshot(entries, { config: baseConfig, pricing, now });
  assert.equal(snap.live.week.start, iso('2026-07-26T22:00:00Z'));
  assert.equal(snap.live.week.weighted, 300);
  assert.equal(snap.live.week.count, 2);
});

test('Tagesreihe umfasst 30 Tage und ordnet nach Ortszeit ein', () => {
  const now = iso('2026-07-31T11:00:00Z');
  const entries = [
    entry('2026-07-30T22:30:00Z', { output: 500 }), // = 31.07. 00:30 Berlin
    entry('2026-07-30T21:30:00Z', { output: 700, tag: 'x' }), // = 30.07. 23:30 Berlin
  ];
  const snap = buildSnapshot(entries, { config: baseConfig, pricing, now });
  const byDay = Object.fromEntries(snap.daily.map((d) => [d.day, d.weighted]));
  assert.equal(byDay['2026-07-31'], 500);
  assert.equal(byDay['2026-07-30'], 700);
  assert.equal(snap.daily[snap.daily.length - 1].day, '2026-07-31');
});

test('Tagesverlauf bucketet nach lokaler Stunde und markiert die Zukunft', () => {
  const now = iso('2026-07-31T11:00:00Z'); // 13:00 Berlin
  const entries = [entry('2026-07-31T07:15:00Z', { output: 42 })]; // 09:15 Berlin
  const snap = buildSnapshot(entries, { config: baseConfig, pricing, now });
  assert.equal(snap.today.byHour[9].weighted, 42);
  assert.equal(snap.today.byHour[9].future, false);
  assert.equal(snap.today.byHour[14].future, true);
  assert.equal(snap.today.byHour[13].future, false);
});

test('Aufschluesselungen nach Projekt, Modell und Session', () => {
  const now = iso('2026-07-31T11:00:00Z');
  const entries = [
    entry('2026-07-31T09:00:00Z', { project: 'alpha', sessionId: 's1', output: 1_000_000 }),
    entry('2026-07-31T09:30:00Z', { project: 'beta', sessionId: 's2', model: 'claude-haiku-4-5', output: 1_000_000, tag: 'h' }),
  ];
  const snap = buildSnapshot(entries, { config: baseConfig, pricing, now });

  assert.deepEqual(snap.byProject.map((p) => p.key), ['alpha', 'beta'], 'teuerstes zuerst');
  assert.ok(Math.abs(snap.byProject[0].cost - 25) < 1e-9);
  assert.ok(Math.abs(snap.byProject[1].cost - 5) < 1e-9);
  assert.deepEqual(snap.byModel.map((m) => m.key), ['claude-opus-5', 'claude-haiku-4-5']);
  assert.equal(snap.byModel.every((m) => m.priced), true);
  assert.equal(snap.bySession.length, 2);
});

test('unbekannte Modelle werden gemeldet statt zu stuerzen', () => {
  const now = iso('2026-07-31T11:00:00Z');
  const entries = [
    entry('2026-07-31T09:00:00Z', { model: 'claude-zukunft-9', output: 1000 }),
    entry('2026-07-31T09:30:00Z', { output: 1000, tag: 'ok' }),
  ];
  const snap = buildSnapshot(entries, { config: baseConfig, pricing, now });
  assert.deepEqual(snap.unknownModels, ['claude-zukunft-9']);
  assert.equal(snap.totals.costKnown, false);
  assert.equal(snap.byModel.find((m) => m.key === 'claude-zukunft-9').priced, false);
  assert.ok(snap.totals.cost > 0, 'bekannte Modelle werden weiterhin bepreist');
});

test('Cache-Kennzahlen werden getrennt nach TTL ausgewiesen', () => {
  const now = iso('2026-07-31T11:00:00Z');
  const entries = [
    entry('2026-07-31T09:00:00Z', { cacheWrite1h: 1000, cacheWrite5m: 200, cacheRead: 98800, input: 0 }),
  ];
  const snap = buildSnapshot(entries, { config: baseConfig, pricing, now });
  assert.equal(snap.cache.write1h, 1000);
  assert.equal(snap.cache.write5m, 200);
  assert.equal(snap.cache.read, 98800);
  assert.ok(Math.abs(snap.cache.hitRate - 0.988) < 1e-9);
});

test('auto-Modus kalibriert das 5h-Limit gegen abgeschlossene Bloecke', () => {
  const cfg = { ...baseConfig, limits: { ...baseConfig.limits, mode: 'auto', autoMinSamples: 2 } };
  const now = iso('2026-07-31T11:00:00Z');
  const entries = [
    entry('2026-07-29T09:00:00Z', { output: 5000 }),
    entry('2026-07-30T09:00:00Z', { output: 9000, tag: 'b' }),
    entry('2026-07-31T09:10:00Z', { output: 2000, tag: 'c' }), // laufender Block
  ];
  const snap = buildSnapshot(entries, { config: cfg, pricing, now });
  assert.equal(snap.live.fiveHour.limitSource, 'auto');
  assert.equal(snap.live.fiveHour.limit, 9000, 'hoechster abgeschlossener Block');
  assert.equal(snap.live.fiveHour.weighted, 2000);
  assert.ok(Math.abs(snap.live.fiveHour.percent - 22.22) < 0.01);
});

test('Burn-Rate und Prognose landen im Snapshot', () => {
  const now = iso('2026-07-31T11:00:00Z'); // 2h nach Blockstart 09:00
  const entries = [entry('2026-07-31T09:10:00Z', { output: 12000 })];
  const snap = buildSnapshot(entries, { config: baseConfig, pricing, now });
  assert.equal(snap.live.fiveHour.burnRatePerMin, 100); // 12000 / 120 min
  assert.ok(snap.live.fiveHour.projection);
  assert.equal(snap.live.fiveHour.projection.minutesRemaining, 760); // (88000-12000)/100
  assert.equal(snap.live.fiveHour.projection.beforeReset, false, 'Reset kommt vor dem Limit');
});

test('Tarif kommt aus dem Account und ueberstimmt die config.json', () => {
  // config sagt max5x, der Account sagt max20x -> der Account gewinnt.
  const snap = buildSnapshot([], {
    config: baseConfig,
    pricing,
    now: iso('2026-07-31T11:00:00Z'),
    liveUsage: { ok: false, reason: 'network', rateLimitTier: 'default_claude_max_20x' },
  });
  assert.equal(snap.plan, 'max20x');
  assert.equal(snap.planLabel, 'Max 20×');
  assert.equal(snap.planSource, 'account');
});

test('ohne Account-Angabe faellt der Tarif auf die config.json zurueck', () => {
  const snap = buildSnapshot([], {
    config: baseConfig,
    pricing,
    now: iso('2026-07-31T11:00:00Z'),
    liveUsage: { ok: false, reason: 'no-credentials' },
  });
  assert.equal(snap.plan, 'max5x');
  assert.equal(snap.planSource, 'config', 'wird in der UI als unsicher markiert');
});

test('erkannter Tarif waehlt auch die Limits fuer die Schaetzung', () => {
  const cfg = {
    ...baseConfig,
    plan: 'pro',
    limits: {
      mode: 'fixed',
      plans: { pro: { fiveHourTokens: 1000 }, max20x: { fiveHourTokens: 999000 } },
    },
  };
  const snap = buildSnapshot([entry('2026-07-31T09:10:00Z', { output: 500 })], {
    config: cfg,
    pricing,
    now: iso('2026-07-31T11:00:00Z'),
    liveUsage: { ok: false, reason: 'network', rateLimitTier: 'default_claude_max_20x' },
  });
  assert.equal(snap.live.fiveHour.limit, 999000, 'Limit des erkannten Tarifs, nicht des config-Tarifs');
});

test('Snapshot spiegelt Konfiguration und Metadaten zurueck', () => {
  const snap = buildSnapshot([], {
    config: baseConfig,
    pricing,
    now: iso('2026-07-31T11:00:00Z'),
    scan: { files: 13, brokenLines: 0 },
  });
  assert.equal(snap.timezone, 'Europe/Berlin');
  assert.equal(snap.locale, 'de-DE');
  assert.equal(snap.plan, 'max5x');
  assert.deepEqual(snap.countingWeights, { input: 1, output: 1, cacheWrite: 1, cacheRead: 0 });
  assert.equal(snap.scan.files, 13);
  assert.equal(snap.warnings.criticalPercent, 90);
});

// --- Archiv-Buckets -------------------------------------------------------

test('Buckets fassen Eintraege nach Tag, Projekt, Modell und Geschwindigkeit zusammen', () => {
  const buckets = bucketsFromEntries(
    [
      entry('2026-07-31T09:00:00Z', { output: 100 }),
      entry('2026-07-31T10:00:00Z', { output: 200, tag: 'b' }),
      entry('2026-07-31T11:00:00Z', { output: 300, speed: 'fast', tag: 'c' }),
      entry('2026-07-30T11:00:00Z', { output: 400, tag: 'd' }),
    ],
    'Europe/Berlin',
  );
  assert.equal(buckets.length, 3);
  const std = buckets.find((b) => b.day === '2026-07-31' && b.speed === 'standard');
  assert.equal(std.tokens.output, 300);
  assert.equal(std.count, 2);
});

test('Bucket-Kosten werden mit dem Tag als Stichtag gerechnet', () => {
  // Sonnet 5 hat einen Einfuehrungspreis bis 31.08.2026: 2 statt 3 USD/Mio.
  // Input. Ein Tag davor und ein Tag danach muessen sich unterscheiden.
  const mk = (day) => [
    {
      day,
      project: 'p',
      model: 'claude-sonnet-5',
      speed: 'standard',
      tokens: { input: 1_000_000, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 },
      count: 1,
    },
  ];
  const promo = [...rollupBuckets(mk('2026-08-30'), (b) => b.project, pricing).values()][0];
  const regulaer = [...rollupBuckets(mk('2026-09-02'), (b) => b.project, pricing).values()][0];
  assert.ok(Math.abs(promo.cost - 2) < 1e-9, 'im Aktionszeitraum');
  assert.ok(Math.abs(regulaer.cost - 3) < 1e-9, 'danach zum Listenpreis');
});

test('uebergebene Buckets liefern Historie, die es in den Eintraegen nicht mehr gibt', () => {
  // Genau der Fall "Claude Code hat die alten Transkripte aufgeraeumt".
  const now = iso('2026-07-31T11:00:00Z');
  const entries = [entry('2026-07-31T09:00:00Z', { output: 1000 })];
  const buckets = [
    ...bucketsFromEntries(entries, 'Europe/Berlin'),
    {
      day: '2026-07-15',
      project: 'archiv-projekt',
      cwd: null,
      model: 'claude-opus-5',
      speed: 'standard',
      tokens: { input: 0, output: 4000, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 },
      count: 7,
      present: false,
    },
  ];
  const snap = buildSnapshot(entries, { config: baseConfig, pricing, now, buckets });

  assert.equal(snap.totals.tokens.output, 5000, 'Archiv zaehlt mit');
  assert.equal(snap.totals.requests, 8, '1 live + 7 archiviert');
  assert.equal(snap.totals.liveRequests, 1, 'belegbar sind nur die vorhandenen');
  assert.equal(snap.byProject.length, 2);
  assert.ok(snap.daily.find((d) => d.day === '2026-07-15').weighted === 4000);
  assert.equal(snap.live.fiveHour.weighted, 1000, 'das Fenster sieht nur echte Eintraege');
});

// --- Gemessenes Limit -----------------------------------------------------

test('ein gemessenes Limit sticht sowohl auto als auch den Planwert aus', () => {
  const measured = { ok: true, limit: 12345, samples: 9, windows: 4, tokensCv: 0.08 };
  const r = resolveLimit({ mode: 'auto', planLimit: 88000, history: [1, 2, 3], measured });
  assert.equal(r.limit, 12345);
  assert.equal(r.source, 'measured');
  assert.equal(r.samples, 9);
  assert.equal(r.spread, 0.08);

  const r2 = resolveLimit({ mode: 'fixed', planLimit: 88000, history: [], measured });
  assert.equal(r2.source, 'measured');
});

test('eine unfertige Messung wird ignoriert', () => {
  const r = resolveLimit({
    mode: 'auto',
    planLimit: 88000,
    history: [100, 900, 400],
    minSamples: 3,
    measured: { ok: false, limit: null, samples: 2 },
  });
  assert.equal(r.source, 'auto');
  assert.equal(r.limit, 900);
});

test('eine Messung mit unbrauchbarem Limit wird nicht uebernommen', () => {
  const r = resolveLimit({
    mode: 'auto',
    planLimit: 88000,
    history: [],
    minSamples: 3,
    measured: { ok: true, limit: 0, samples: 9 },
  });
  assert.equal(r.source, 'calibrating');
});

// --- Blockhistorie --------------------------------------------------------

test('Blockhistorie kommt chronologisch und markiert den laufenden Block', () => {
  const now = iso('2026-07-31T11:00:00Z');
  const entries = [
    entry('2026-07-29T09:00:00Z', { output: 3000 }),
    entry('2026-07-30T09:00:00Z', { output: 6000, tag: 'b' }),
    entry('2026-07-31T09:10:00Z', { output: 1000, tag: 'c' }),
  ];
  const snap = buildSnapshot(entries, { config: baseConfig, pricing, now });

  assert.equal(snap.blocks.length, 3);
  assert.ok(snap.blocks[0].start < snap.blocks[2].start, 'aeltester zuerst');
  assert.equal(snap.blocks.at(-1).active, true);
  assert.equal(snap.blocks[0].active, false);
  assert.equal(snap.blocks[1].weighted, 6000);
  assert.ok(snap.blocks[1].cost > 0);
});

test('Blockanteile beziehen sich auf das aufgeloeste Limit', () => {
  const now = iso('2026-07-31T11:00:00Z');
  const entries = [entry('2026-07-30T09:00:00Z', { output: 44000 })];
  const snap = buildSnapshot(entries, { config: baseConfig, pricing, now });
  assert.ok(Math.abs(snap.blocks[0].percent - 50) < 1e-9, '44000 von 88000');
  assert.equal(snap.blocks[0].level, 'ok');
});

test('ohne Limit bleiben die Bloecke ohne Prozentwert und ohne Warnstufe', () => {
  const cfg = { ...baseConfig, limits: { ...baseConfig.limits, mode: 'auto', autoMinSamples: 9 } };
  const now = iso('2026-07-31T11:00:00Z');
  const snap = buildSnapshot([entry('2026-07-30T09:00:00Z', { output: 44000 })], {
    config: cfg,
    pricing,
    now,
  });
  assert.equal(snap.blocks[0].percent, null);
  assert.equal(snap.blocks[0].level, 'unknown');
});

// --- Abo-Gegenwert --------------------------------------------------------

const subConfig = {
  ...baseConfig,
  subscription: { billingDay: 1, monthlyPriceUsd: { max5x: 100, pro: 20 } },
};

test('Abo-Gegenwert summiert nur den laufenden Abrechnungszeitraum', () => {
  const now = iso('2026-07-31T11:00:00Z');
  const entries = [
    entry('2026-06-20T09:00:00Z', { output: 4_000_000 }), // Vormonat
    entry('2026-07-05T09:00:00Z', { output: 1_000_000, tag: 'a' }),
    entry('2026-07-31T09:00:00Z', { output: 1_000_000, tag: 'b' }),
  ];
  const snap = buildSnapshot(entries, { config: subConfig, pricing, now });

  assert.ok(Math.abs(snap.subscription.cost - 50) < 1e-9, '2 Mio. Opus-Output = 50 USD');
  assert.equal(snap.subscription.count, 2, 'der Juni zaehlt nicht mit');
  assert.equal(snap.subscription.priceUsd, 100);
  assert.ok(Math.abs(snap.subscription.ratio - 0.5) < 1e-9);
  assert.equal(snap.subscription.start, iso('2026-06-30T22:00:00Z'));
});

test('Abo-Gegenwert nutzt den Preis des erkannten Tarifs', () => {
  const snap = buildSnapshot([entry('2026-07-05T09:00:00Z', { output: 1_000_000 })], {
    config: subConfig,
    pricing,
    now: iso('2026-07-31T11:00:00Z'),
    liveUsage: { ok: false, reason: 'network', subscriptionType: 'pro' },
  });
  assert.equal(snap.plan, 'pro');
  assert.equal(snap.subscription.priceUsd, 20);
  assert.ok(Math.abs(snap.subscription.ratio - 1.25) < 1e-9, '25 USD bei 20 USD Abo');
});

test('ohne hinterlegten Preis gibt es keine erfundene Kennzahl', () => {
  const snap = buildSnapshot([entry('2026-07-05T09:00:00Z', { output: 1_000_000 })], {
    config: baseConfig,
    pricing,
    now: iso('2026-07-31T11:00:00Z'),
  });
  assert.equal(snap.subscription.priceUsd, null);
  assert.equal(snap.subscription.ratio, null);
  assert.ok(snap.subscription.cost > 0, 'die Kosten selbst stehen trotzdem');
});
