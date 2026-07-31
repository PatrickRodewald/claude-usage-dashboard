import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createStore } from '../src/store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const pricingTable = JSON.parse(fs.readFileSync(path.join(root, 'pricing.json'), 'utf8'));

/**
 * Store ohne Transkript-Quellen, damit nur die Abruf-Logik geprueft wird.
 * Archiv aus: sonst laese der Test das echte data/history.json des Rechners
 * und haenge von dessen Inhalt ab.
 */
function makeStore(liveCfg = {}) {
  return createStore({
    config: {
      timezone: 'Europe/Berlin',
      plan: 'max5x',
      history: { enabled: false },
      limits: { mode: 'auto', autoMinSamples: 3, plans: {} },
      counting: { weights: {} },
      window: {},
      week: {},
      warnings: {},
      dataDirs: { only: [path.join(here, 'gibt-es-nicht')] },
      liveUsage: { enabled: true, minIntervalMs: 60000, maxBackoffMs: 900000, ...liveCfg },
    },
    pricingTable,
  });
}

test('Live-Abruf laesst sich vollstaendig abschalten', async () => {
  const store = createStore({
    config: {
      timezone: 'Europe/Berlin',
      history: { enabled: false },
      limits: { plans: {} },
      counting: {},
      window: {},
      week: {},
      warnings: {},
      dataDirs: { only: [path.join(here, 'gibt-es-nicht')] },
      liveUsage: { enabled: false },
    },
    pricingTable,
  });
  const r = await store.refreshLiveUsage({ now: 1000 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'disabled');
  assert.equal(store.snapshot(1000).live.source, 'estimate');
});

test('erfolgreicher Abruf wird bis zum Mindestintervall wiederverwendet', async () => {
  // Kein Netzzugriff: der Store greift auf die echten Zugangsdaten zu, wenn
  // vorhanden - deshalb pruefen wir hier nur die Drosselung ueber die Zeit.
  const store = makeStore();
  const t0 = Date.now();
  const first = await store.refreshLiveUsage({ now: t0 });
  const second = await store.refreshLiveUsage({ now: t0 + 5000 });
  assert.equal(second, first, 'innerhalb des Intervalls kein zweiter Abruf');
});

test('nach einem Fehler wird nicht sofort erneut angeklopft', async () => {
  // Genau dieser Fall hat in der Praxis eine 429-Drosselung verlaengert:
  // bei 20-Sekunden-Polling waere sonst alle 20 Sekunden ein Versuch erfolgt.
  const store = makeStore();
  const t0 = Date.now();
  const first = await store.refreshLiveUsage({ now: t0 });

  if (first.ok) {
    // Zugangsdaten vorhanden und Abruf erfolgreich - dieser Testfall greift
    // nur ohne funktionierenden Abruf.
    return;
  }
  assert.ok(first.nextAttemptAt > t0, 'Wartezeit gesetzt');
  assert.equal(first.failures, 1);

  const during = await store.refreshLiveUsage({ now: t0 + 1000 });
  assert.equal(during, first, 'waehrend der Wartezeit kein neuer Abruf');

  const forced = await store.refreshLiveUsage({ now: t0 + 1000, force: true });
  assert.equal(forced, first, 'auch "force" respektiert die Fehler-Wartezeit');
});

test('Wartezeit waechst exponentiell und ist gedeckelt', async () => {
  const store = makeStore({ minIntervalMs: 1000, maxBackoffMs: 8000 });
  let now = Date.now();
  const waits = [];
  for (let i = 0; i < 6; i++) {
    const r = await store.refreshLiveUsage({ now });
    if (r.ok) return; // funktionierender Abruf - Testfall nicht anwendbar
    waits.push(r.nextAttemptAt - now);
    now = r.nextAttemptAt; // Wartezeit abwarten
  }
  for (let i = 1; i < waits.length; i++) {
    assert.ok(waits[i] >= waits[i - 1], `Wartezeit ${i} nicht kuerzer als vorherige`);
  }
  assert.ok(Math.max(...waits) <= 8000, 'Deckel eingehalten');
});

test('Snapshot funktioniert auch ohne jede Live-Verbindung', async () => {
  const store = makeStore();
  await store.scan();
  const snap = store.snapshot();
  assert.ok(snap.live);
  assert.ok(snap.daily.length === 30);
  assert.equal(snap.totals.requests, 0, 'keine Transkripte gefunden - trotzdem kein Absturz');
});
