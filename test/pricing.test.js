import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createPricing,
  weightedTokens,
  totalTokens,
  cacheHitRate,
  addTokens,
  newTotals,
} from '../src/pricing.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const table = JSON.parse(fs.readFileSync(path.join(here, '..', 'pricing.json'), 'utf8'));
const pricing = createPricing(table);

const AT = Date.parse('2026-07-31T12:00:00Z');
const near = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b} (Abweichung ${Math.abs(a - b)})`);

test('Opus 5: Standardpreise 5 / 25 USD pro Mio.', () => {
  const r = pricing.rateFor('claude-opus-5', { timestampMs: AT });
  assert.equal(r.input, 5);
  assert.equal(r.output, 25);
});

test('Cache-Multiplikatoren: 1,25x (5m), 2,0x (1h), 0,1x (read)', () => {
  const r = pricing.rateFor('claude-opus-5', { timestampMs: AT });
  near(r.cacheWrite5m, r.input * 1.25);
  near(r.cacheWrite1h, r.input * 2.0);
  near(r.cacheRead, r.input * 0.1);
});

test('1h-Cache-Write kostet das 1,6-fache eines 5m-Writes', () => {
  // Genau dieser Unterschied macht in echten Daten ~5 % der Gesamtkosten aus,
  // weil Claude Code praktisch ausschliesslich 1h-Cache schreibt.
  const t5 = { input: 0, output: 0, cacheWrite5m: 1_000_000, cacheWrite1h: 0, cacheRead: 0 };
  const t1h = { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 1_000_000, cacheRead: 0 };
  const a = pricing.costFor(t5, 'claude-opus-5', { timestampMs: AT }).cost;
  const b = pricing.costFor(t1h, 'claude-opus-5', { timestampMs: AT }).cost;
  near(a, 6.25);
  near(b, 10.0);
  near(b / a, 1.6);
});

test('Gesamtkosten summieren alle fuenf Kategorien korrekt', () => {
  const tokens = {
    input: 1_000_000,
    output: 1_000_000,
    cacheWrite5m: 1_000_000,
    cacheWrite1h: 1_000_000,
    cacheRead: 1_000_000,
  };
  const { cost, known } = pricing.costFor(tokens, 'claude-opus-5', { timestampMs: AT });
  assert.equal(known, true);
  near(cost, 5 + 25 + 6.25 + 10 + 0.5);
});

test('Unbekanntes Modell -> known:false statt Absturz', () => {
  const r = pricing.costFor(
    { input: 1000, output: 1000, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 },
    'claude-erfunden-9',
    { timestampMs: AT },
  );
  assert.equal(r.known, false);
  assert.equal(r.cost, 0);
  assert.equal(pricing.rateFor('claude-erfunden-9'), null);
  assert.equal(pricing.rateFor(null), null);
  assert.equal(pricing.rateFor(undefined), null);
});

test('datierte Model-IDs werden auf die Basis-ID aufgeloest', () => {
  assert.equal(pricing.resolveName('claude-haiku-4-5-20251001'), 'claude-haiku-4-5');
  assert.equal(pricing.resolveName('claude-opus-5-20260401'), 'claude-opus-5');
});

test('Fast-Mode nutzt den Fast-Tarif (Opus 5: 10 / 50)', () => {
  const std = pricing.rateFor('claude-opus-5', { speed: 'standard', timestampMs: AT });
  const fast = pricing.rateFor('claude-opus-5', { speed: 'fast', timestampMs: AT });
  assert.equal(std.input, 5);
  assert.equal(fast.input, 10);
  assert.equal(fast.output, 50);
});

test('Einfuehrungspreis gilt vor dem Stichtag und danach nicht mehr', () => {
  const before = pricing.rateFor('claude-sonnet-5', {
    timestampMs: Date.parse('2026-08-01T00:00:00Z'),
  });
  const after = pricing.rateFor('claude-sonnet-5', {
    timestampMs: Date.parse('2026-09-01T00:00:00Z'),
  });
  assert.equal(before.input, 2, 'Aktionspreis waehrend der Laufzeit');
  assert.equal(before.output, 10);
  assert.equal(after.input, 3, 'Listenpreis nach Ablauf');
  assert.equal(after.output, 15);
});

test('Modell-Tarife stehen im erwarteten Verhaeltnis zueinander', () => {
  const opus = pricing.rateFor('claude-opus-5', { timestampMs: AT });
  const haiku = pricing.rateFor('claude-haiku-4-5', { timestampMs: AT });
  const fable = pricing.rateFor('claude-fable-5', { timestampMs: AT });
  assert.ok(haiku.input < opus.input && opus.input < fable.input);
  assert.equal(haiku.input, 1);
  assert.equal(fable.output, 50);
});

test('<synthetic> ist als zu ignorierendes Modell markiert', () => {
  assert.equal(pricing.isIgnored('<synthetic>'), true);
  assert.equal(pricing.isIgnored('claude-opus-5'), false);
});

// --- Token-Kennzahlen -----------------------------------------------------

test('gewichtete Tokens: cacheRead standardmaessig ausgeschlossen', () => {
  const t = { input: 100, output: 200, cacheWrite5m: 50, cacheWrite1h: 50, cacheRead: 1_000_000 };
  const w = { input: 1, output: 1, cacheWrite: 1, cacheRead: 0 };
  assert.equal(weightedTokens(t, w), 400);
  assert.equal(totalTokens(t), 1_000_400);
});

test('gewichtete Tokens: Gewichte werden angewendet', () => {
  const t = { input: 10, output: 10, cacheWrite5m: 10, cacheWrite1h: 10, cacheRead: 10 };
  assert.equal(weightedTokens(t, { input: 1, output: 5, cacheWrite: 2, cacheRead: 0.1 }), 10 + 50 + 40 + 1);
});

test('leere Gewichte verhalten sich wie der Default', () => {
  const t = { input: 1, output: 1, cacheWrite5m: 1, cacheWrite1h: 1, cacheRead: 999 };
  assert.equal(weightedTokens(t, {}), 4);
  assert.equal(weightedTokens(t, undefined), 4);
});

test('Cache-Hit-Rate', () => {
  assert.equal(cacheHitRate({ input: 0, cacheWrite5m: 0, cacheWrite1h: 10, cacheRead: 90 }), 0.9);
  assert.equal(cacheHitRate(newTotals()), 0, 'keine Division durch 0');
});

test('addTokens summiert und toleriert fehlende Felder', () => {
  const t = newTotals();
  addTokens(t, { input: 5, output: 3 });
  addTokens(t, { cacheRead: 2 });
  assert.deepEqual(t, { input: 5, output: 3, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 2 });
});
