import { syncAllChicagoMusicEvents } from './scraper.js';

async function main() {
  console.log('Syncing Chicago music calendar (within 10 miles of Ward 1)...');
  const data = await syncAllChicagoMusicEvents();
  console.log('Sync complete!');
  console.log('Source Breakdown:', data.sourceBreakdown);
  console.log('Total Venues:', data.venues.length);
  console.log('Total Unique Upcoming Events:', data.events.length);

  // Print sample events per corridor
  const byCorridor = {};
  for (const ev of data.events) {
    byCorridor[ev.corridor] = (byCorridor[ev.corridor] || 0) + 1;
  }
  console.log('Events by Corridor:', byCorridor);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
