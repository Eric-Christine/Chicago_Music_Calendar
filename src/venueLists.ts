export interface VenueList {
  id: string;
  name: string;
  venueIds: string[];
  createdAt: number;
}

const STORAGE_KEY = 'cmc_venue_lists_v1';

export const DEFAULT_VENUE_LISTS: VenueList[] = [
  {
    id: 'preset-ward1-top5',
    name: 'Ward 1 Top 5',
    venueIds: ['salt-shed', 'empty-bottle', 'subterranean', 'concord-music-hall', 'radius'],
    createdAt: 1,
  },
  {
    id: 'preset-indie-5',
    name: 'Indie Club 5',
    venueIds: ['empty-bottle', 'sleeping-village', 'lincoln-hall', 'schubas', 'thalia-hall'],
    createdAt: 2,
  },
];

export function loadVenueLists(): VenueList[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VENUE_LISTS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_VENUE_LISTS;
    return parsed.filter(
      (item): item is VenueList =>
        item &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        Array.isArray(item.venueIds)
    );
  } catch {
    return DEFAULT_VENUE_LISTS;
  }
}

export function saveVenueLists(lists: VenueList[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lists));
  } catch {
    // ignore storage quota errors
  }
}

export function createVenueList(name: string, venueIds: string[]): VenueList {
  return {
    id: `vlist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim(),
    venueIds: [...new Set(venueIds)],
    createdAt: Date.now(),
  };
}

function escapeIcs(str: string): string {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

export interface IcsEventLike {
  id: string;
  headliner: string;
  support: string[];
  date: string;
  time: string;
  venueName: string;
  venueShort: string;
  address: string;
  distanceMiles: number;
  price: string | null;
  ticketUrl: string;
  spotifyUrl: string;
}

export function downloadFilteredIcs(events: IcsEventLike[], calName: string, fileName: string): void {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ward 1 Chicago Music Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcs(calName)}`,
    'X-WR-TIMEZONE:America/Chicago',
  ];

  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
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
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${dateCompact}`,
      `SUMMARY:${escapeIcs(`${ev.headliner} @ ${ev.venueShort}`)}`,
      `LOCATION:${escapeIcs(`${ev.venueName}, ${ev.address}`)}`,
      `DESCRIPTION:${desc}`,
      `URL:${ev.ticketUrl}`,
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
