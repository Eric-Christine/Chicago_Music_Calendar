function escapeIcs(str) {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

export function buildIcs(data, { venueFilter = null, corridorFilter = null } = {}) {
  let events = data.events || [];
  if (venueFilter) {
    events = events.filter((e) => venueFilter.includes(e.venueId));
  }
  if (corridorFilter && corridorFilter !== 'ALL') {
    events = events.filter((e) => e.corridor === corridorFilter);
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ward 1 Chicago Music Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Chicago Ward 1 Live Music Calendar',
    'X-WR-TIMEZONE:America/Chicago',
  ];

  for (const ev of events.slice(0, 2000)) {
    const dateCompact = ev.date.replace(/-/g, '');
    const desc = [
      `Headliner: ${ev.headliner}`,
      ev.support?.length ? `Support: ${ev.support.join(', ')}` : '',
      `Venue: ${ev.venueName} (${ev.distanceMiles} mi from Ward 1)`,
      `Showtime: ${ev.time}`,
      ev.price ? `Price: ${ev.price}` : '',
      `Tickets: ${ev.ticketUrl}`,
      `Spotify: ${ev.spotifyUrl}`,
    ]
      .filter(Boolean)
      .join('\\n');

    lines.push(
      'BEGIN:VEVENT',
      `UID:${ev.id}@chicagomusiccalendar.local`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
      `DTSTART;VALUE=DATE:${dateCompact}`,
      `SUMMARY:${escapeIcs(`${ev.headliner} @ ${ev.venueShort}`)}`,
      `LOCATION:${escapeIcs(`${ev.venueName}, ${ev.address}`)}`,
      `DESCRIPTION:${desc}`,
      `URL:${ev.ticketUrl}`,
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
