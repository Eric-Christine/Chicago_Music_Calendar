import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { getCachedOrSyncEvents, syncAllChicagoMusicEvents } from './scraper.js';
import http from 'http';
import { buildIcs } from './ics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..', 'dist');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3088;

// Auto-sync background interval (every 30 minutes)
const AUTO_SYNC_INTERVAL_MS = 30 * 60 * 1000;
let isSyncing = false;

setInterval(async () => {
  if (isSyncing) return;
  try {
    isSyncing = true;
    console.log('[Auto-Sync] Running scheduled Chicago Music Calendar sync...');
    await syncAllChicagoMusicEvents();
    console.log('[Auto-Sync] Completed.');
  } catch (err) {
    console.error('[Auto-Sync] Error:', err.message);
  } finally {
    isSyncing = false;
  }
}, AUTO_SYNC_INTERVAL_MS);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlObj = new URL(req.url || '/', `http://localhost:${PORT}`);

  if (req.method === 'GET' && urlObj.pathname === '/api/calendar') {
    try {
      const force = urlObj.searchParams.get('force') === 'true';
      const data = await getCachedOrSyncEvents(force);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === 'POST' && urlObj.pathname === '/api/sync') {
    if (isSyncing) {
      const cached = await getCachedOrSyncEvents(false);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ...cached, syncStatus: 'already_in_progress' }));
      return;
    }
    try {
      isSyncing = true;
      const data = await syncAllChicagoMusicEvents();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ...data, syncStatus: 'synced' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    } finally {
      isSyncing = false;
    }
    return;
  }

  if (req.method === 'GET' && urlObj.pathname === '/api/calendar.ics') {
    try {
      const data = await getCachedOrSyncEvents(false);
      const venueParam = urlObj.searchParams.get('venueId');
      const ics = buildIcs(data, {
        venueFilter: venueParam ? venueParam.split(',') : null,
        corridorFilter: urlObj.searchParams.get('corridor'),
      });

      res.writeHead(200, {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="chicago-ward1-music.ics"',
      });
      res.end(ics);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(err.message);
    }
    return;
  }

  // Static Frontend Serving (dist/ + public/)
  try {
    let relPath = decodeURIComponent(urlObj.pathname);
    if (relPath === '/') relPath = '/index.html';
    const safeRel = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');

    let filePath = path.join(DIST_DIR, safeRel);
    let stat = await fs.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      filePath = path.join(PUBLIC_DIR, safeRel);
      stat = await fs.stat(filePath).catch(() => null);
    }
    if (!stat || !stat.isFile()) {
      filePath = path.join(DIST_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  }
});

server.listen(PORT, () => {
  console.log(`Chicago Music Calendar App + Auto-Sync API running on http://localhost:${PORT}`);
});
