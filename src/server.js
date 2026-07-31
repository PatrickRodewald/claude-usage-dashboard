/**
 * Lokaler HTTP-Server: liefert das Dashboard aus, stellt die JSON-API bereit
 * und schiebt Aktualisierungen per Server-Sent Events an den Browser.
 *
 * Bindet bewusst nur an 127.0.0.1 - kein Zugriff aus dem Netz, keine
 * Authentifizierung noetig, keine Daten verlassen den Rechner.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createStore, createWatcher } from './store.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(rootDir, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function serveStatic(res, urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    res.writeHead(400).end('Bad Request');
    return;
  }
  if (rel.includes('\0')) {
    res.writeHead(400).end('Bad Request');
    return;
  }
  rel = rel === '/' ? 'index.html' : rel.replace(/^\/+/, '');
  const target = path.resolve(publicDir, rel);
  // Kein Ausbrechen aus public/ - auch lokal nicht. Geprueft wird nach dem
  // Aufloesen, damit weder '..' noch prozentkodierte Varianten durchkommen.
  if (target !== publicDir && !target.startsWith(publicDir + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

/**
 * Standardbrowser mit der Dashboard-Adresse oeffnen.
 *
 * Bewusst ohne Shell-Umweg: unter Windows direkt explorer.exe statt
 * "cmd /c start", damit auf gehaerteten Geraeten (WDAC/AppLocker) kein
 * Skript-Interpreter angefasst wird. Schlaegt es fehl, ist das kein Grund,
 * den Serverstart abzubrechen - die Adresse steht ja in der Konsole.
 */
function openBrowser(url) {
  const byPlatform = {
    win32: ['explorer.exe', [url]],
    darwin: ['open', [url]],
  };
  const [cmd, args] = byPlatform[process.platform] ?? ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    /* Browser laesst sich nicht oeffnen - unkritisch. */
  }
}

export async function startServer({
  config,
  pricingTable,
  historyFile,
  openInBrowser = false,
  port: portOverride,
  quiet = false,
} = {}) {
  const store = createStore({ config, pricingTable, historyFile });
  const cfg = store.config;
  // Port 0 ist gueltig ("nimm einen freien") - deshalb ?? statt ||.
  const port = portOverride ?? cfg.port ?? 7842;
  const host = '127.0.0.1';
  const log = quiet ? () => {} : (...a) => console.log(...a);

  const dirs = store.dataDirs();
  if (dirs.length === 0 && !quiet) {
    console.warn(
      '\n  ! Keine Transkript-Verzeichnisse gefunden.\n' +
        '    Gesucht wurde in $CLAUDE_CONFIG_DIR/projects, ~/.claude/projects und ~/.config/claude/projects.\n' +
        '    Eigene Pfade koennen in config.json unter dataDirs.extra eingetragen werden.\n',
    );
  }

  log('  Lese Transkripte ...');
  await store.scan();
  const s0 = store.stats;
  log(
    `  ${s0.files} Dateien (${s0.filesSkipped} bereits archiviert, uebersprungen), ` +
      `${s0.uniqueRequests} eindeutige Requests ` +
      `(${s0.duplicatesSkipped} Duplikate uebersprungen, ${s0.brokenLines} defekte Zeilen) ` +
      `in ${s0.lastScanDurationMs} ms`,
  );
  const h0 = store.historyStats();
  if (h0.enabled) {
    log(
      `  Archiv: ${h0.days} Tage aus ${h0.files} Transkripten` +
        (h0.archivedOnly ? `, davon ${h0.archivedOnly} nicht mehr auf der Platte` : '') +
        (h0.firstDay ? ` (ab ${h0.firstDay})` : '') +
        (h0.note ? ` - ${h0.note}` : ''),
    );
  }

  const live0 = await store.refreshLiveUsage({ force: true });
  if (live0?.ok) {
    log(
      `  Echte Auslastung von Anthropic: 5h-Fenster ${live0.fiveHour?.percent ?? '?'} %, ` +
        `Woche ${live0.week?.percent ?? '?'} %  (${live0.rateLimitTier ?? 'Tarif unbekannt'})`,
    );
  } else {
    log(
      `  Live-Abruf nicht verfuegbar (${live0?.reason}) - Dashboard nutzt die lokale Schaetzung.`,
    );
  }
  const cal0 = store.calibration();
  if (cal0?.fiveHour?.ok) {
    log(
      `  Gemessenes 5h-Limit: ${Math.round(cal0.fiveHour.limit).toLocaleString('de-DE')} gewichtete Tokens ` +
        `(${cal0.fiveHour.samples} Messpunkte aus ${cal0.fiveHour.windows} Fenstern)`,
    );
  }

  /** @type {Set<import('node:http').ServerResponse>} */
  const clients = new Set();
  let cached = store.snapshot();

  function broadcast() {
    cached = store.snapshot();
    const payload = `event: snapshot\ndata: ${JSON.stringify(cached)}\n\n`;
    for (const res of clients) {
      try {
        res.write(payload);
      } catch {
        clients.delete(res);
      }
    }
  }

  let scanning = false;
  let rescanQueued = false;
  async function rescan({ force = false } = {}) {
    if (scanning) {
      rescanQueued = true;
      return;
    }
    scanning = true;
    try {
      await store.scan({ force });
      // Gedrosselt: liefert den zwischengespeicherten Wert, wenn er frisch ist.
      await store.refreshLiveUsage({ force });
      broadcast();
    } catch (err) {
      if (!quiet) console.error('  ! Fehler beim Einlesen:', err.message);
    } finally {
      scanning = false;
      if (rescanQueued) {
        rescanQueued = false;
        setImmediate(() => rescan());
      }
    }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${host}:${port}`);

    if (url.pathname === '/api/snapshot') {
      const fresh = url.searchParams.get('refresh') === '1';
      if (fresh) {
        rescan().then(() => sendJson(res, 200, cached));
      } else {
        sendJson(res, 200, cached);
      }
      return;
    }

    if (url.pathname === '/api/rescan' && req.method === 'POST') {
      rescan({ force: url.searchParams.get('force') === '1' }).then(() =>
        sendJson(res, 200, { ok: true, stats: store.stats }),
      );
      return;
    }

    if (url.pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`retry: 3000\n\n`);
      res.write(`event: snapshot\ndata: ${JSON.stringify(cached)}\n\n`);
      clients.add(res);

      const hb = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          /* Verbindung weg, cleanup uebernimmt close */
        }
      }, cfg.server?.sseHeartbeatMs ?? 25000);

      req.on('close', () => {
        clearInterval(hb);
        clients.delete(res);
      });
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'Unbekannter Endpunkt' });
      return;
    }

    serveStatic(res, url.pathname);
  });

  // File-Watcher; Polling laeuft immer als Fallback mit.
  const watcher = createWatcher(dirs, () => rescan(), {
    debounceMs: cfg.server?.watchDebounceMs ?? 400,
  });
  const pollMs = cfg.server?.pollIntervalMs ?? 20000;
  const poll = setInterval(() => rescan(), pollMs);
  poll.unref?.();

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const actualPort = server.address()?.port ?? port;
  const url = `http://${host}:${actualPort}`;
  log(`\n  Claude Usage Dashboard laeuft auf  ${url}\n`);
  if (openInBrowser || cfg.openBrowserOnStart === true) {
    openBrowser(url);
  }
  log(
    `  Aktualisierung: ${watcher.active ? 'File-Watcher aktiv' : 'File-Watcher nicht verfuegbar'}` +
      ` + Polling alle ${Math.round(pollMs / 1000)} s\n`,
  );
  log('  Zum Beenden: Strg+C\n');

  /**
   * Sauber herunterfahren. Beendet bewusst NICHT den Prozess - das ist Sache
   * des Aufrufers. Der Signal-Handler unten haengt das Beenden selbst an.
   */
  let closing = null;
  function close() {
    if (closing) return closing;
    clearInterval(poll);
    watcher.close();
    // Letzter Stand des Archivs auf die Platte, bevor alles zumacht.
    try {
      store.flush();
    } catch {
      /* Archiv nicht schreibbar - kein Grund, das Beenden aufzuhalten. */
    }
    for (const res of clients) {
      try {
        res.end();
      } catch {
        /* egal */
      }
    }
    clients.clear();
    closing = new Promise((resolve) => {
      server.close(() => resolve());
      // Hartes Zeitlimit: eine haengende Verbindung darf das Beenden nicht
      // blockieren.
      setTimeout(resolve, 1000).unref?.();
    });
    return closing;
  }

  const onSignal = () => {
    close().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  return {
    server,
    store,
    rescan,
    port: actualPort,
    url,
    close: () => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      return close();
    },
  };
}

// Direkt gestartet (npm start)?
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const openInBrowser = process.argv.includes('--open');
  startServer({ openInBrowser }).catch((err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`\n  ! Port bereits belegt. Anderen Port in config.json eintragen.\n`);
    } else {
      console.error('\n  ! Start fehlgeschlagen:', err);
    }
    process.exit(1);
  });
}
