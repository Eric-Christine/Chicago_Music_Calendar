import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { buildIcs } from './ics.js';

// Writes public/calendar.ics from the snapshot so static hosts (GitHub Pages) can serve the feed
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const data = JSON.parse(await fs.readFile(path.join(PUBLIC_DIR, 'events_snapshot.json'), 'utf-8'));
await fs.writeFile(path.join(PUBLIC_DIR, 'calendar.ics'), buildIcs(data));
console.log(`Wrote calendar.ics with ${Math.min(data.events.length, 2000)} events`);
