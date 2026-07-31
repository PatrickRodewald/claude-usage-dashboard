/**
 * Integrationstests des HTTP-Servers.
 *
 * Diese Schicht war bisher nur von Hand geprueft - ausgerechnet der Schutz vor
 * dem Ausbrechen aus public/ hatte keinen einzigen Test.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startServer } from '../src/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const pricingTable = JSON.parse(fs.readFileSync(path.join(root, 'pricing.json'), 'utf8'));

const config = {
  port: 0,
  timezone: 'Europe/Berlin',
  locale: 'de-DE',
  plan: 'max5x',
  // Kein Netzzugriff aus einem Test heraus.
  liveUsage: { enabled: false },
  history: { enabled: false },
  limits: { mode: 'auto', autoMinSamples: 3, plans: {} },
  counting: { weights: {} },
  window: {},
  week: {},
  warnings: {},
  server: { pollIntervalMs: 3_600_000, sseHeartbeatMs: 60_000, watchDebounceMs: 50 },
  dataDirs: { only: [path.join(os.tmpdir(), 'cud-gibt-es-nicht-4711')] },
};

async function withServer(fn) {
  const app = await startServer({ config, pricingTable, port: 0, quiet: true });
  try {
    return await fn(app);
  } finally {
    await app.close();
  }
}

/**
 * Rohe HTTP-Anfrage ueber einen Socket.
 * Noetig, weil fetch() Pfade wie '/../x' clientseitig normalisiert - genau die
 * Angriffsform, die hier ankommen soll.
 */
function rawGet(port, rawPath) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(`GET ${rawPath} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    sock.setEncoding('utf8');
    sock.on('data', (c) => (data += c));
    sock.on('end', () => {
      const status = Number(/^HTTP\/1\.1 (\d+)/.exec(data)?.[1]);
      resolve({ status, body: data.slice(data.indexOf('\r\n\r\n') + 4) });
    });
    sock.on('error', reject);
    sock.setTimeout(5000, () => {
      sock.destroy();
      reject(new Error('Zeitueberschreitung'));
    });
  });
}

test('Server bindet nur an 127.0.0.1', async () => {
  await withServer((app) => {
    assert.equal(app.server.address().address, '127.0.0.1');
    assert.ok(app.port > 0, 'Port 0 wird zu einem echten Port aufgeloest');
  });
});

test('/api/snapshot liefert einen vollstaendigen Snapshot', async () => {
  await withServer(async (app) => {
    const res = await fetch(`${app.url}/api/snapshot`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const snap = await res.json();
    for (const key of ['live', 'daily', 'byProject', 'byModel', 'totals', 'blocks', 'subscription']) {
      assert.ok(key in snap, `Feld ${key} fehlt`);
    }
    assert.equal(snap.daily.length, 30);
    assert.equal(snap.live.source, 'estimate', 'Live-Abruf ist im Test abgeschaltet');
    assert.equal(snap.live.reason, 'disabled');
  });
});

test('/api/snapshot?refresh=1 liest neu ein', async () => {
  await withServer(async (app) => {
    const res = await fetch(`${app.url}/api/snapshot?refresh=1`);
    assert.equal(res.status, 200);
    const snap = await res.json();
    assert.ok(snap.scan.lastScanMs > 0);
  });
});

test('POST /api/rescan meldet den neuen Stand', async () => {
  await withServer(async (app) => {
    const res = await fetch(`${app.url}/api/rescan`, { method: 'POST' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(body.stats);
  });
});

test('/api/rescan ohne POST ist kein Endpunkt', async () => {
  await withServer(async (app) => {
    const res = await fetch(`${app.url}/api/rescan`);
    assert.equal(res.status, 404);
  });
});

test('/api/events schickt sofort einen Snapshot', async () => {
  await withServer(async (app) => {
    const ctrl = new AbortController();
    const res = await fetch(`${app.url}/api/events`, { signal: ctrl.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);

    const reader = res.body.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    assert.match(text, /retry: \d+/, 'setzt das Wiederverbindungs-Intervall');

    // Der erste Snapshot kann im selben oder im naechsten Chunk kommen.
    let payload = text;
    while (!payload.includes('event: snapshot')) {
      const next = await reader.read();
      if (next.done) break;
      payload += new TextDecoder().decode(next.value);
    }
    assert.match(payload, /event: snapshot/);
    const line = payload.split('\n').find((l) => l.startsWith('data: '));
    const snap = JSON.parse(line.slice(6));
    assert.ok(snap.generatedAt > 0);

    ctrl.abort();
    await reader.cancel().catch(() => {});
  });
});

test('unbekannte API-Endpunkte antworten als JSON, nicht als Datei', async () => {
  await withServer(async (app) => {
    const res = await fetch(`${app.url}/api/gibt-es-nicht`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'Unbekannter Endpunkt' });
  });
});

test('statische Dateien kommen mit passendem MIME-Typ', async () => {
  await withServer(async (app) => {
    const index = await fetch(`${app.url}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type'), /text\/html/);
    assert.match(await index.text(), /<title>Claude Usage Dashboard<\/title>/);

    const css = await fetch(`${app.url}/styles.css`);
    assert.match(css.headers.get('content-type'), /text\/css/);

    const js = await fetch(`${app.url}/app.js`);
    assert.match(js.headers.get('content-type'), /text\/javascript/);
  });
});

test('nicht vorhandene Dateien ergeben 404', async () => {
  await withServer(async (app) => {
    const res = await fetch(`${app.url}/gibt-es-nicht.js`);
    assert.equal(res.status, 404);
  });
});

test('kein Ausbrechen aus public/ - auch nicht prozentkodiert', async () => {
  await withServer(async (app) => {
    // %2e%2e ueberlebt die URL-Normalisierung und wird erst beim Dekodieren
    // wieder zu '..' - genau deshalb wird nach dem Aufloesen geprueft.
    for (const attack of [
      '/%2e%2e/config.json',
      '/%2e%2e%2fconfig.json',
      '/%2e%2e/%2e%2e/config.json',
      '/..%2fconfig.json',
      '/%2e%2e%5cconfig.json',
    ]) {
      const res = await rawGet(app.port, attack);
      assert.ok(
        res.status === 403 || res.status === 404,
        `${attack} lieferte ${res.status}`,
      );
      assert.ok(!res.body.includes('"port"'), `${attack} hat config.json ausgeliefert`);
    }
  });
});

test('normalisierte Traversal-Pfade landen nicht ausserhalb von public/', async () => {
  await withServer(async (app) => {
    const res = await rawGet(app.port, '/../config.json');
    assert.ok(res.status === 403 || res.status === 404);
    assert.ok(!res.body.includes('"timezone"'));
  });
});

test('kaputte Prozentkodierung wird abgewiesen statt zu werfen', async () => {
  await withServer(async (app) => {
    const res = await rawGet(app.port, '/%zz');
    assert.equal(res.status, 400);
  });
});

test('close() beendet den Prozess nicht und laesst sich zweimal aufrufen', async () => {
  const app = await startServer({ config, pricingTable, port: 0, quiet: true });
  await app.close();
  await app.close();
  // Wir sind noch da - genau das ist die Aussage.
  assert.equal(typeof process.exitCode, 'undefined');
  await assert.rejects(fetch(`${app.url}/api/snapshot`), 'Server nimmt nichts mehr an');
});

test('close() haengt keine Signal-Handler an den Prozess', async () => {
  const before = process.listenerCount('SIGINT');
  const app = await startServer({ config, pricingTable, port: 0, quiet: true });
  assert.equal(process.listenerCount('SIGINT'), before + 1);
  await app.close();
  assert.equal(process.listenerCount('SIGINT'), before, 'Handler wieder abgemeldet');
});
