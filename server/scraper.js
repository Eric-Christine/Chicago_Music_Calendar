import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { VENUES, WARD_1_CENTER } from './venues.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, 'events_cache.json');
const ARTIST_CACHE_FILE = path.join(__dirname, 'artist_cache.json');

const MONTHS = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12',
};

function decodeEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&#038;/g, '&')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#8217;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getChicagoToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

function getTwelveMonthHorizon() {
  const now = new Date();
  const end = new Date(now);
  end.setFullYear(end.getFullYear() + 1);
  return {
    startDate: getChicagoToday(),
    endDate: end.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }),
    startIso: now.toISOString().split('.')[0] + 'Z',
    endIso: end.toISOString().split('.')[0] + 'Z',
  };
}

export function normalizeDateString(raw, referenceDate = getChicagoToday()) {
  if (!raw) return null;
  const clean = raw.replace(/\s+/g, ' ').trim();

  const isoMatch = clean.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const urlDateMatch = clean.match(/(\d{2})-(\d{2})-(\d{4})/);
  if (urlDateMatch) return `${urlDateMatch[3]}-${urlDateMatch[1]}-${urlDateMatch[2]}`;

  const mMatch = clean.match(/([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/);
  if (mMatch) {
    const mKey = mMatch[1].toLowerCase().slice(0, 3);
    const month = MONTHS[mKey];
    if (month) {
      const day = String(mMatch[2]).padStart(2, '0');
      const refYear = Number(referenceDate.slice(0, 4));
      let year = mMatch[3] ? Number(mMatch[3]) : refYear;
      if (!mMatch[3]) {
        // Without an explicit year, any date more than 3 days before today belongs to next year
        const candidate = `${year}-${month}-${day}`;
        const cutoff = new Date(`${referenceDate}T12:00:00Z`);
        cutoff.setUTCDate(cutoff.getUTCDate() - 3);
        const cutoffStr = cutoff.toISOString().slice(0, 10);
        if (candidate < cutoffStr) {
          year = refYear + 1;
        }
      }
      return `${year}-${month}-${day}`;
    }
  }
  return null;
}

export function cleanArtistName(title) {
  if (!title) return '';
  return decodeEntities(title)
    .replace(/\s*[-–—:]\s*.*(tour|presents|live|anniversary|album|benefit|night|experience|w\/|with|feat).*$/i, '')
    .replace(/\s*\((18\+|21\+|17\+|all ages|sold out|rescheduled|late show|early show).*?\)/gi, '')
    .replace(/\s*-\s*Ages\s*\d+\+/gi, '')
    .replace(/^(Audiotree Presents|Riot Fest Presents|React Presents|Empty Bottle Presents|Collectiv Presents|1833 Presents|Kickstand Productions Presents)\s*[:\-–]?\s*/i, '')
    .split(/\s+(?:w\/|with|feat\.|featuring|\/|\+)\s+/i)[0]
    .trim();
}

function format24To12(timeStr) {
  const [hStr, mStr] = timeStr.split(':');
  let h = parseInt(hStr, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${mStr} ${ampm}`;
}

// 1. Ticketmaster & TicketWeb Discovery API (paginated across the next 12 months)
async function fetchTicketmasterEvents() {
  const events = [];
  const { startIso, endIso } = getTwelveMonthHorizon();
  const keyGroups = {};
  for (const v of VENUES) {
    if (v.tmVenueIds?.length && v.tmApiKey) {
      if (!keyGroups[v.tmApiKey]) keyGroups[v.tmApiKey] = [];
      for (const vid of v.tmVenueIds) {
        keyGroups[v.tmApiKey].push({ venue: v, tmId: vid });
      }
    }
  }

  for (const [apiKey, list] of Object.entries(keyGroups)) {
    // Smaller chunks + pagination ensure no busy venue truncates before the 12-month horizon
    const chunkSize = 4;
    for (let i = 0; i < list.length; i += chunkSize) {
      const slice = list.slice(i, i + chunkSize);
      const venueIdsParam = slice.map((s) => s.tmId).join(',');
      let page = 0;
      let totalPages = 1;

      while (page < totalPages && page < 5) {
        const url = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${apiKey}&venueId=${venueIdsParam}&startDateTime=${encodeURIComponent(startIso)}&endDateTime=${encodeURIComponent(endIso)}&size=200&page=${page}&sort=date,asc`;
        try {
          if (i > 0 || page > 0) await new Promise((r) => setTimeout(r, 220));
          const res = await fetch(url);
          if (!res.ok) break;
          const data = await res.json();
          totalPages = Math.min(data.page?.totalPages || 1, 5);
          const rawEvents = data._embedded?.events || [];
          if (rawEvents.length === 0) break;

          for (const ev of rawEvents) {
            if (ev.dates?.status?.code === 'cancelled') continue;
            const tmVenueId = ev._embedded?.venues?.[0]?.id;
            const matched = slice.find((s) => s.tmId === tmVenueId) || slice[0];
            const venue = matched.venue;
            const date = ev.dates?.start?.localDate;
            if (!date) continue;

            const attractions = ev._embedded?.attractions || [];
            const primaryAttr = attractions[0];
            const headliner = primaryAttr?.name || cleanArtistName(ev.name);
            const support = attractions.slice(1).map((a) => a.name);

            const spotifyUrl =
              primaryAttr?.externalLinks?.spotify?.[0]?.url ||
              `https://open.spotify.com/search/${encodeURIComponent(headliner)}`;

            let spotifyArtistId = null;
            const spMatch = spotifyUrl.match(/open\.spotify\.com\/artist\/([a-zA-Z0-9]+)/);
            if (spMatch) spotifyArtistId = spMatch[1];

            const imgObj =
              ev.images?.find((im) => im.ratio === '16_9' && im.width >= 600) ||
              ev.images?.[0];

            const genre =
              ev.classifications?.[0]?.subGenre?.name ||
              ev.classifications?.[0]?.genre?.name ||
              'Live Music';

            const priceRange = ev.priceRanges?.[0];
            const priceStr = priceRange
              ? `$${Math.round(priceRange.min)}${priceRange.max && priceRange.max !== priceRange.min ? `–$${Math.round(priceRange.max)}` : ''}`
              : null;

            events.push({
              id: `tm-${ev.id}`,
              title: ev.name,
              headliner,
              support,
              date,
              time: ev.dates?.start?.localTime ? format24To12(ev.dates.start.localTime) : '8:00 PM',
              venueId: venue.id,
              venueName: venue.name,
              venueShort: venue.shortName,
              corridor: venue.corridor,
              neighborhood: venue.neighborhood,
              address: venue.address,
              distanceMiles: venue.distanceMiles,
              lat: venue.lat,
              lng: venue.lng,
              venueColor: venue.color,
              ticketUrl: ev.url || venue.website,
              imageUrl: imgObj?.url || null,
              genre: genre === 'Undefined' ? 'Alternative / Indie' : genre,
              price: priceStr,
              ageRestriction: ev.ageRestrictions?.legalAgeEnforced ? '21+' : '18+ / All Ages',
              soldOut: ev.dates?.status?.code === 'offsale',
              source: 'Ticketmaster / TicketWeb',
              spotifyUrl,
              spotifyArtistId,
              spotifyTrackUrl: null,
              previewAudioUrl: null,
              previewTrackTitle: null,
            });
          }
          page += 1;
        } catch (err) {
          console.error('TM fetch error:', err.message);
          break;
        }
      }
    }
  }
  return events;
}

// 2. DICE.fm Partner API (filtered to our tracked venues & paginated across all pages)
async function fetchDiceEvents() {
  const events = [];
  const apiKey = 'gc1iKklO05HOTvSuQyoH7dhPJTrWIWO3Dlhwkqc6';
  const base = 'https://partners-endpoint.dice.fm/api/v2/events';
  const diceVenues = VENUES.flatMap((v) => v.diceNames || []);
  const firstUrl = new URL(base);
  firstUrl.searchParams.set('page[size]', '100');
  firstUrl.searchParams.set('types', 'linkout,event');
  for (const name of diceVenues) {
    firstUrl.searchParams.append('filter[venues][]', name);
  }

  let nextUrl = firstUrl.toString();
  let pageCount = 0;

  while (nextUrl && pageCount < 12) {
    try {
      const res = await fetch(nextUrl, { headers: { 'x-api-key': apiKey } });
      if (!res.ok) break;
      const data = await res.json();
      const rawList = data.data || [];
      if (rawList.length === 0) break;
      pageCount += 1;

      for (const ev of rawList) {
        if (ev.status === 'cancelled') continue;
        const venue = VENUES.find(
          (v) =>
            v.diceNames?.some((dn) => dn.trim().toLowerCase() === (ev.venue || '').trim().toLowerCase()) ||
            v.name.toLowerCase() === (ev.venue || '').trim().toLowerCase()
        );
        if (!venue) continue;

        const dObj = new Date(ev.date);
        const chicagoDate = dObj.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
        const chicagoTime = dObj.toLocaleTimeString('en-US', {
          timeZone: 'America/Chicago',
          hour: 'numeric',
          minute: '2-digit',
        });

        const artists = ev.artists || [];
        const headliner = artists[0] || cleanArtistName(ev.name);
        const support = artists.slice(1);

        const spTrack = ev.spotify_tracks?.[0];
        const appleTrack = ev.apple_music_tracks?.[0];

        const genreRaw = ev.genre_tags?.[0] || ev.tags?.[0] || 'Indie / Club';
        const genre = genreRaw.replace(/^music:/i, '').replace(/-/g, ' ');

        const rawPrice =
          typeof ev.price === 'number'
            ? ev.price
            : typeof ev.price?.amount === 'number'
            ? ev.price.amount
            : typeof ev.ticket_types?.[0]?.price === 'number'
            ? ev.ticket_types[0].price
            : typeof ev.ticket_types?.[0]?.price?.total === 'number'
            ? ev.ticket_types[0].price.total
            : null;
        const priceStr =
          rawPrice != null && !Number.isNaN(rawPrice)
            ? rawPrice === 0
              ? 'Free'
              : `$${(rawPrice / 100).toFixed(0)}`
            : null;

        events.push({
          id: `dice-${ev.id || ev.hash}`,
          title: ev.name,
          headliner,
          support,
          date: chicagoDate,
          time: chicagoTime,
          venueId: venue.id,
          venueName: venue.name,
          venueShort: venue.shortName,
          corridor: venue.corridor,
          neighborhood: venue.neighborhood,
          address: venue.address,
          distanceMiles: venue.distanceMiles,
          lat: venue.lat,
          lng: venue.lng,
          venueColor: venue.color,
          ticketUrl: ev.url || `https://dice.fm/event/${ev.perm_name}`,
          imageUrl: ev.event_images?.landscape || ev.event_images?.square || ev.images?.[0] || null,
          genre: genre.charAt(0).toUpperCase() + genre.slice(1),
          price: priceStr,
          ageRestriction: ev.age_limit || '21+',
          soldOut: Boolean(ev.sold_out),
          source: 'DICE.fm',
          spotifyUrl:
            spTrack?.open_url || `https://open.spotify.com/search/${encodeURIComponent(headliner)}`,
          spotifyArtistId: null,
          spotifyTrackUrl: spTrack?.open_url || null,
          previewAudioUrl: spTrack?.preview_url || appleTrack?.preview_url || null,
          previewTrackTitle: spTrack?.title || appleTrack?.title || null,
        });
      }

      // Dice's links.next points to events-api.dice.fm; keep query string on partners-endpoint.dice.fm
      if (data.links?.next && data.links.next.includes('?')) {
        nextUrl = `${base}${data.links.next.substring(data.links.next.indexOf('?'))}`;
      } else {
        nextUrl = null;
      }
    } catch (err) {
      console.error('Dice fetch error:', err.message);
      break;
    }
  }
  return events;
}

// 3. Radius Chicago Direct HTML parser
async function scrapeRadiusDirect() {
  const events = [];
  const radiusVenue = VENUES.find((v) => v.id === 'radius');
  const cermakVenue = VENUES.find((v) => v.id === 'cermak-hall');
  try {
    const res = await fetch('https://www.radius-chicago.com/events', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
    });
    const html = await res.text();
    const blocks = html.split(/<div class="entry\s+[^"]*clearfix\s*">/i).slice(1);

    for (const block of blocks) {
      const titleMatch = block.match(/<h3 class="carousel_item_title_small">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
      const title = decodeEntities(titleMatch?.[1]);
      const supportMatch = block.match(/<h4 class="supporting[^"]*">([\s\S]*?)<\/h4>/i);
      const supporting = decodeEntities(supportMatch?.[1]);
      const dateMatch = block.match(/<span class="date">[\s\S]*?<\/span>\s*([\s\S]*?)<\/span>/i);
      const dateRaw = decodeEntities(dateMatch?.[1]);
      const timeMatch = block.match(/<span class="time">[\s\S]*?<\/span>\s*([\s\S]*?)<\/span>/i);
      const timeRaw = decodeEntities(timeMatch?.[1]);
      const imgMatch = block.match(/<img\s+src="([^"]+)"/i);
      const ticketMatch = block.match(/<a\s+href="([^"]+)"[^>]*class="btn-tickets/i);

      const date = normalizeDateString(dateRaw);
      if (!title || !date) continue;

      const isCermak = title.toLowerCase().includes('cermak hall') || block.toLowerCase().includes('cermak hall');
      const venue = isCermak && cermakVenue ? cermakVenue : radiusVenue;
      const headliner = cleanArtistName(title);
      const support = supporting
        ? supporting
            .split(/[,+]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

      events.push({
        id: `radius-${date}-${headliner.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
        title,
        headliner,
        support,
        date,
        time: timeRaw.replace(/^Doors\s*/i, '') || '9:00 PM',
        venueId: venue.id,
        venueName: venue.name,
        venueShort: venue.shortName,
        corridor: venue.corridor,
        neighborhood: venue.neighborhood,
        address: venue.address,
        distanceMiles: venue.distanceMiles,
        lat: venue.lat,
        lng: venue.lng,
        venueColor: venue.color,
        ticketUrl: ticketMatch?.[1] || venue.website,
        imageUrl: imgMatch?.[1] || null,
        genre: 'Electronic / House / Techno',
        price: null,
        ageRestriction: '18+',
        soldOut: false,
        source: 'Radius Direct / AXS',
        spotifyUrl: `https://open.spotify.com/search/${encodeURIComponent(headliner)}`,
        spotifyArtistId: null,
        spotifyTrackUrl: null,
        previewAudioUrl: null,
        previewTrackTitle: null,
      });
    }
  } catch (err) {
    console.error('Radius scrape error:', err.message);
  }
  return events;
}

// 4. Lincoln Hall & Schubas Tavern Direct HTML parser
async function scrapeLhStDirect() {
  const events = [];
  const lhVenue = VENUES.find((v) => v.id === 'lincoln-hall');
  const schubasVenue = VENUES.find((v) => v.id === 'schubas');
  try {
    const res = await fetch('https://lh-st.com/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
    });
    const html = await res.text();
    const cards = html.split(/<!-- Card Body -->/i).slice(1);

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const prevChunk = html.split(/<!-- Card Body -->/i)[i] || '';
      const imgMatch = prevChunk.slice(-600).match(/<img[^>]+src="([^"]+)"/i);
      const titleMatch = card.match(/<h4 class="card-title">([\s\S]*?)<\/h4>/i);
      const title = decodeEntities(titleMatch?.[1]);
      const linkMatch = card.match(/href="(https:\/\/lh-st\.com\/shows\/[^"]+)"/i);
      const showLink = linkMatch?.[1] || '';
      const dateMatch = card.match(/<span class="date">([\s\S]*?)<\/span>/i);
      const dateSpan = decodeEntities(dateMatch?.[1]);
      const supMatch = card.match(/<div class="tessera-additionalArtists">([\s\S]*?)<\/div>/i);
      const supportText = decodeEntities(supMatch?.[1]);
      const timeMatch = card.match(/<div class="tessera-showTime">Show\s*<b>([\s\S]*?)<\/b>/i);
      const showTime = decodeEntities(timeMatch?.[1]);
      const venueMatch = card.match(/<span class="tessera-venue">([\s\S]*?)<\/span>/i);
      const venueText = decodeEntities(venueMatch?.[1]);

      const date = normalizeDateString(showLink) || normalizeDateString(dateSpan);
      if (!title || !date) continue;

      const isSchubas = venueText.toLowerCase().includes('schubas');
      const venue = isSchubas ? schubasVenue : lhVenue;
      if (!venue) return events;

      const headliner = cleanArtistName(title);
      const support = supportText
        ? supportText
            .split(/[,•\/]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

      events.push({
        id: `lhst-${venue.id}-${date}-${headliner.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
        title,
        headliner,
        support,
        date,
        time: showTime || '8:00 PM',
        venueId: venue.id,
        venueName: venue.name,
        venueShort: venue.shortName,
        corridor: venue.corridor,
        neighborhood: venue.neighborhood,
        address: venue.address,
        distanceMiles: venue.distanceMiles,
        lat: venue.lat,
        lng: venue.lng,
        venueColor: venue.color,
        ticketUrl: showLink || venue.website,
        imageUrl: imgMatch?.[1] || null,
        genre: 'Indie / Rock / Folk',
        price: null,
        ageRestriction: '18+',
        soldOut: card.toLowerCase().includes('sold out'),
        source: 'Audiotree / LH+ST Direct',
        spotifyUrl: `https://open.spotify.com/search/${encodeURIComponent(headliner)}`,
        spotifyArtistId: null,
        spotifyTrackUrl: null,
        previewAudioUrl: null,
        previewTrackTitle: null,
      });
    }
  } catch (err) {
    console.error('LH-ST scrape error:', err.message);
  }
  return events;
}

// 5. Concord Music Hall (Milwaukee Ave) Direct HTML parser
async function scrapeConcordDirect() {
  const events = [];
  const venue = VENUES.find((v) => v.id === 'concord-music-hall');
  if (!venue) return events;
  try {
    const res = await fetch('https://concordmusichall.com/calendar/', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const html = await res.text();
    const articles = html.split(/<article class="show[^"]*">/i).slice(1);

    for (const art of articles) {
      const titleMatch = art.match(/<h1>([\s\S]*?)<\/h1>/i);
      const title = decodeEntities(titleMatch?.[1]);
      const supMatch = art.match(/<h2>([\s\S]*?)<\/h2>/i);
      const support = supMatch?.[1]
        ? supMatch[1]
            .split(/<br\s*\/?>|,/i)
            .map((s) => decodeEntities(s))
            .filter(Boolean)
        : [];
      const dateMatch = art.match(/<p class="date">([\s\S]*?)<\/p>/i);
      const doorsMatch = art.match(/<p class="doors">([\s\S]*?)<\/p>/i);
      const priceMatch = art.match(/<p class="price">([\s\S]*?)<\/p>/i);
      const linkMatch = art.match(/<a href="(https:\/\/concordmusichall\.com\/calendar\/[^"]+)"/i);
      const bgMatch = art.match(/background-image:url\(['"]?([^'")]+)['"]?\)/i);

      const date = normalizeDateString(decodeEntities(dateMatch?.[1]));
      if (!title || !date) continue;

      const headliner = cleanArtistName(title);
      events.push({
        id: `concord-${date}-${headliner.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
        title,
        headliner,
        support,
        date,
        time: decodeEntities(doorsMatch?.[1]).replace(/Doors\s*@?\s*/i, '') || '8:00 PM',
        venueId: venue.id,
        venueName: venue.name,
        venueShort: venue.shortName,
        corridor: venue.corridor,
        neighborhood: venue.neighborhood,
        address: venue.address,
        distanceMiles: venue.distanceMiles,
        lat: venue.lat,
        lng: venue.lng,
        venueColor: venue.color,
        ticketUrl: linkMatch?.[1] || venue.website,
        imageUrl: bgMatch?.[1] || null,
        genre: 'Electronic / Bass / Live',
        price: decodeEntities(priceMatch?.[1]) || null,
        ageRestriction: '18+',
        soldOut: art.toLowerCase().includes('sold out'),
        source: 'Concord Direct',
        spotifyUrl: `https://open.spotify.com/search/${encodeURIComponent(headliner)}`,
        spotifyArtistId: null,
        spotifyTrackUrl: null,
        previewAudioUrl: null,
        previewTrackTitle: null,
      });
    }
  } catch (err) {
    console.error('Concord scrape error:', err.message);
  }
  return events;
}

// 6. Cole's Bar (Milwaukee Ave) Direct HTML parser
async function scrapeColesDirect() {
  const events = [];
  const venue = VENUES.find((v) => v.id === 'coles-bar');
  if (!venue) return events;
  try {
    const res = await fetch('https://colesbarchicago.com/', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const html = await res.text();
    const cards = html.split(/<article class="evcard"/i).slice(1);

    for (const card of cards) {
      const titleMatch = card.match(/<h3 class="evcard-title"[^>]*>([\s\S]*?)<\/h3>/i);
      const title = decodeEntities(titleMatch?.[1]);
      const linkMatch = card.match(/href="(\/shows\/[^"]+)"/i);
      const link = linkMatch?.[1] || '';
      const dateMatch = card.match(/<div class="evcard-header"[^>]*>([\s\S]*?)<\/div>/i);
      const imgMatch = card.match(/<img src="([^"]+)"[^>]*class="evcard-image"/i);

      const date = normalizeDateString(link) || normalizeDateString(decodeEntities(dateMatch?.[1]));
      if (!title || !date) continue;

      const parts = title.split(/\s*\/\s*/).map((s) => s.trim()).filter(Boolean);
      const headliner = parts[0] || cleanArtistName(title);
      const support = parts.slice(1);

      events.push({
        id: `coles-${date}-${headliner.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
        title,
        headliner,
        support,
        date,
        time: '9:00 PM',
        venueId: venue.id,
        venueName: venue.name,
        venueShort: venue.shortName,
        corridor: venue.corridor,
        neighborhood: venue.neighborhood,
        address: venue.address,
        distanceMiles: venue.distanceMiles,
        lat: venue.lat,
        lng: venue.lng,
        venueColor: venue.color,
        ticketUrl: link ? `https://colesbarchicago.com${link}` : venue.website,
        imageUrl: imgMatch?.[1] || null,
        genre: 'Indie / Garage / Local',
        price: null,
        ageRestriction: '21+',
        soldOut: false,
        source: "Cole's Bar Direct",
        spotifyUrl: `https://open.spotify.com/search/${encodeURIComponent(headliner)}`,
        spotifyArtistId: null,
        spotifyTrackUrl: null,
        previewAudioUrl: null,
        previewTrackTitle: null,
      });
    }
  } catch (err) {
    console.error("Cole's Bar scrape error:", err.message);
  }
  return events;
}

// 7. The Whistler (Milwaukee Ave) JSON feed
async function scrapeWhistlerDirect() {
  const events = [];
  const venue = VENUES.find((v) => v.id === 'the-whistler');
  if (!venue) return events;
  try {
    const res = await fetch('https://whistlerchicago.com/events?format=json', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return events;
    const data = await res.json();
    const upcoming = data.upcoming || [];

    for (const item of upcoming) {
      const dObj = new Date(item.startDate);
      const date = dObj.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
      const time = dObj.toLocaleTimeString('en-US', {
        timeZone: 'America/Chicago',
        hour: 'numeric',
        minute: '2-digit',
      });
      const title = item.title?.trim();
      if (!title || !date) continue;

      const headliner = cleanArtistName(title);
      events.push({
        id: `whistler-${item.id || date}`,
        title,
        headliner,
        support: [],
        date,
        time,
        venueId: venue.id,
        venueName: venue.name,
        venueShort: venue.shortName,
        corridor: venue.corridor,
        neighborhood: venue.neighborhood,
        address: venue.address,
        distanceMiles: venue.distanceMiles,
        lat: venue.lat,
        lng: venue.lng,
        venueColor: venue.color,
        ticketUrl: item.fullUrl ? `https://whistlerchicago.com${item.fullUrl}` : venue.website,
        imageUrl: item.assetUrl || null,
        genre: 'DJ / Jazz / Experimental',
        price: 'Free',
        ageRestriction: '21+',
        soldOut: false,
        source: 'The Whistler Direct',
        spotifyUrl: `https://open.spotify.com/search/${encodeURIComponent(headliner)}`,
        spotifyArtistId: null,
        spotifyTrackUrl: null,
        previewAudioUrl: null,
        previewTrackTitle: null,
      });
    }
  } catch (err) {
    console.error('Whistler scrape error:', err.message);
  }
  return events;
}

// 8. Metro Chicago Direct HTML parser
async function scrapeMetroDirect() {
  const events = [];
  const venue = VENUES.find((v) => v.id === 'metro');
  if (!venue) return events;
  try {
    const res = await fetch('https://metrochicago.com/events/', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const html = await res.text();
    const cards = html.split(/class\s*=\s*"col-12 eventWrapper rhpSingleEvent/i).slice(1);

    for (const card of cards) {
      const dateMatch = card.match(/singleEventDate[^>]*>([\s\S]*?)<\/div>/i);
      const titleMatch = card.match(/id\s*=\s*"eventTitle"[^>]*title="([^"]+)"/i);
      const linkMatch = card.match(/id\s*=\s*"eventTitle"[^>]*href="([^"]+)"/i);
      const imgMatch = card.match(/<img\s+src="([^"]+)"\s+class="eventListImage/i);
      const supMatch = card.match(/id="evSubHead"[^>]*>([\s\S]*?)<\/h4>/i);

      const title = decodeEntities(titleMatch?.[1]);
      const date = normalizeDateString(decodeEntities(dateMatch?.[1]));
      if (!title || !date) continue;

      const headliner = cleanArtistName(title);
      const supportText = decodeEntities(supMatch?.[1]);
      const support = supportText
        ? supportText
            .replace(/^with\s+/i, '')
            .split(/[,•\/]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

      events.push({
        id: `metro-${date}-${headliner.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
        title,
        headliner,
        support,
        date,
        time: '8:00 PM',
        venueId: venue.id,
        venueName: venue.name,
        venueShort: venue.shortName,
        corridor: venue.corridor,
        neighborhood: venue.neighborhood,
        address: venue.address,
        distanceMiles: venue.distanceMiles,
        lat: venue.lat,
        lng: venue.lng,
        venueColor: venue.color,
        ticketUrl: linkMatch?.[1] || venue.website,
        imageUrl: imgMatch?.[1] || null,
        genre: 'Indie / Alternative / Rock',
        price: null,
        ageRestriction: '18+',
        soldOut: card.toLowerCase().includes('sold out'),
        source: 'Metro Direct',
        spotifyUrl: `https://open.spotify.com/search/${encodeURIComponent(headliner)}`,
        spotifyArtistId: null,
        spotifyTrackUrl: null,
        previewAudioUrl: null,
        previewTrackTitle: null,
      });
    }
  } catch (err) {
    console.error('Metro scrape error:', err.message);
  }
  return events;
}

// 9. The Hideout Direct HTML parser
async function scrapeHideoutDirect() {
  const events = [];
  const venue = VENUES.find((v) => v.id === 'hideout');
  if (!venue) return events;
  try {
    const res = await fetch('https://hideoutchicago.com/events/', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const html = await res.text();
    const items = html.split(/class="show-collection-item/i).slice(1);

    for (const item of items) {
      const nameMatch = item.match(/<div class="show-name">([\s\S]*?)<\/div>/i);
      const dateMatch = item.match(/<div class="show-start-date">([\s\S]*?)<\/div>/i);
      const slugMatch = item.match(/<div class="show-slug">([\s\S]*?)<\/div>/i);

      const title = decodeEntities(nameMatch?.[1]);
      const date = normalizeDateString(decodeEntities(dateMatch?.[1]));
      const slug = decodeEntities(slugMatch?.[1]);
      if (!title || !date || /^closed$/i.test(title.trim())) continue;

      const headliner = cleanArtistName(title);
      events.push({
        id: `hideout-${slug || date}`,
        title,
        headliner,
        support: [],
        date,
        time: '8:00 PM',
        venueId: venue.id,
        venueName: venue.name,
        venueShort: venue.shortName,
        corridor: venue.corridor,
        neighborhood: venue.neighborhood,
        address: venue.address,
        distanceMiles: venue.distanceMiles,
        lat: venue.lat,
        lng: venue.lng,
        venueColor: venue.color,
        ticketUrl: slug ? `https://hideoutchicago.com/event/${slug}` : venue.website,
        imageUrl: null,
        genre: 'Indie / Americana / Eclectic',
        price: null,
        ageRestriction: '21+',
        soldOut: false,
        source: 'The Hideout Direct',
        spotifyUrl: `https://open.spotify.com/search/${encodeURIComponent(headliner)}`,
        spotifyArtistId: null,
        spotifyTrackUrl: null,
        previewAudioUrl: null,
        previewTrackTitle: null,
      });
    }
  } catch (err) {
    console.error('Hideout scrape error:', err.message);
  }
  return events;
}

function deduplicateEvents(allEvents) {
  const map = new Map();
  for (const ev of allEvents) {
    const normHead = ev.headliner.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14);
    const key = `${ev.venueId}|${ev.date}|${normHead}`;
    if (!map.has(key)) {
      map.set(key, ev);
    } else {
      const existing = map.get(key);
      if (!existing.previewAudioUrl && ev.previewAudioUrl) {
        existing.previewAudioUrl = ev.previewAudioUrl;
        existing.previewTrackTitle = ev.previewTrackTitle;
      }
      if (!existing.spotifyArtistId && ev.spotifyArtistId) {
        existing.spotifyArtistId = ev.spotifyArtistId;
        existing.spotifyUrl = ev.spotifyUrl;
      }
      if (!existing.imageUrl && ev.imageUrl) {
        existing.imageUrl = ev.imageUrl;
      }
      if (!existing.price && ev.price) {
        existing.price = ev.price;
      }
      if (existing.support.length === 0 && ev.support.length > 0) {
        existing.support = ev.support;
      }
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => a.date.localeCompare(b.date) || a.venueName.localeCompare(b.venueName)
  );
}

// Deezer allows 50 requests per 5 seconds; each artist lookup is two requests
const DEEZER_BATCH_SIZE = 8;
const DEEZER_BATCH_PAUSE_MS = 2000;
const ARTIST_LOOKUP_LIMIT = Number(process.env.ARTIST_LOOKUP_LIMIT) || 120;

async function deezerJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Deezer HTTP ${res.status}`);
  const data = await res.json();
  // Quota errors come back as HTTP 200 with an error body
  if (data.error) throw new Error(data.error.message || 'Deezer error');
  return data;
}

function artistNameKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]/g, '');
}

async function lookupDeezerArtist(artistName) {
  const search = await deezerJson(
    `https://api.deezer.com/search/artist?q=${encodeURIComponent(artistName)}&limit=1`
  );
  const artist = search.data?.[0];
  // Search always returns its closest guess, so require the name to actually match
  if (!artist || artistNameKey(artist.name) !== artistNameKey(artistName)) {
    return { notFound: true };
  }
  const top = await deezerJson(`https://api.deezer.com/artist/${artist.id}/top?limit=1`);
  const topTrack = top.data?.[0];
  return {
    artistImage: artist.picture_big || artist.picture_medium || null,
    fans: artist.nb_fan || 0,
    topTrackTitle: topTrack ? `${artist.name} – ${topTrack.title}` : null,
    // Deezer preview URLs are signed and expire within minutes, so only the track id is kept;
    // the browser asks Deezer for a fresh URL when someone presses play
    previewTrackId: topTrack?.preview ? topTrack.id : null,
  };
}

async function enrichArtistsWithPreviews(events) {
  let artistCache = {};
  try {
    const raw = await fs.readFile(ARTIST_CACHE_FILE, 'utf-8');
    artistCache = JSON.parse(raw);
  } catch {
    artistCache = {};
  }

  const uncachedHeadliners = [
    ...new Set(
      events
        .filter((e) => !e.previewAudioUrl && e.headliner && !artistCache[e.headliner.toLowerCase()])
        .map((e) => e.headliner)
    ),
  ].slice(0, ARTIST_LOOKUP_LIMIT);

  let updatedCache = false;
  for (let i = 0; i < uncachedHeadliners.length; i += DEEZER_BATCH_SIZE) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, DEEZER_BATCH_PAUSE_MS));
    await Promise.all(
      uncachedHeadliners.slice(i, i + DEEZER_BATCH_SIZE).map(async (artistName) => {
        try {
          artistCache[artistName.toLowerCase()] = await lookupDeezerArtist(artistName);
          updatedCache = true;
        } catch {
          // Leave uncached so the next sync retries
        }
      })
    );
  }

  if (updatedCache) {
    try {
      await fs.writeFile(ARTIST_CACHE_FILE, JSON.stringify(artistCache, null, 2));
    } catch {
      // ignore
    }
  }

  for (const ev of events) {
    const cached = artistCache[ev.headliner?.toLowerCase()];
    if (cached && !cached.notFound) {
      if (!ev.previewAudioUrl && cached.previewTrackId) {
        ev.previewTrackId = cached.previewTrackId;
        ev.previewTrackTitle = cached.topTrackTitle;
      }
      if (!ev.imageUrl && cached.artistImage) {
        ev.imageUrl = cached.artistImage;
      }
      ev.artistFans = cached.fans || null;
    }
  }

  return events;
}

export async function syncAllChicagoMusicEvents() {
  const startedAt = new Date().toISOString();
  const [
    tmEvents,
    diceEvents,
    radiusEvents,
    lhstEvents,
    concordEvents,
    colesEvents,
    whistlerEvents,
    metroEvents,
    hideoutEvents,
  ] = await Promise.all([
    fetchTicketmasterEvents(),
    fetchDiceEvents(),
    scrapeRadiusDirect(),
    scrapeLhStDirect(),
    scrapeConcordDirect(),
    scrapeColesDirect(),
    scrapeWhistlerDirect(),
    scrapeMetroDirect(),
    scrapeHideoutDirect(),
  ]);

  const rawTotal =
    tmEvents.length +
    diceEvents.length +
    radiusEvents.length +
    lhstEvents.length +
    concordEvents.length +
    colesEvents.length +
    whistlerEvents.length +
    metroEvents.length +
    hideoutEvents.length;

  const deduped = deduplicateEvents([
    ...tmEvents,
    ...diceEvents,
    ...radiusEvents,
    ...lhstEvents,
    ...concordEvents,
    ...colesEvents,
    ...whistlerEvents,
    ...metroEvents,
    ...hideoutEvents,
  ]);

  // Venue calendars also list closures and private rentals, which aren't shows
  const NOT_A_SHOW = /^closed\b|private (event|rental|party)|\[private\]|pop-up box office/i;
  const { startDate, endDate } = getTwelveMonthHorizon();
  const shows = deduped.filter(
    (ev) =>
      !NOT_A_SHOW.test(ev.title) &&
      !NOT_A_SHOW.test(ev.headliner) &&
      ev.date >= startDate &&
      ev.date <= endDate
  );

  const enriched = await enrichArtistsWithPreviews(shows);

  const payload = {
    lastSyncedAt: new Date().toISOString(),
    startedAt,
    horizon: { startDate, endDate, months: 12 },
    wardCenter: WARD_1_CENTER,
    sourceBreakdown: {
      ticketmasterAndTicketWeb: tmEvents.length,
      diceFm: diceEvents.length,
      radiusDirect: radiusEvents.length,
      lincolnHallSchubasDirect: lhstEvents.length,
      concordDirect: concordEvents.length,
      colesBarDirect: colesEvents.length,
      whistlerDirect: whistlerEvents.length,
      metroDirect: metroEvents.length,
      hideoutDirect: hideoutEvents.length,
      rawTotal,
      uniqueEvents: enriched.length,
    },
    // Ticketmaster keys stay server-side; the payload is published as a static snapshot
    venues: VENUES.map(({ tmApiKey, ...venue }) => venue),
    events: enriched,
  };

  if (enriched.length > 0) {
    try {
      await fs.writeFile(CACHE_FILE, JSON.stringify(payload, null, 2));
      // Also write to public/events_snapshot.json so Vite static frontend always has the latest snapshot
      const publicDir = path.join(__dirname, '..', 'public');
      await fs.mkdir(publicDir, { recursive: true });
      await fs.writeFile(path.join(publicDir, 'events_snapshot.json'), JSON.stringify(payload, null, 2));
    } catch (err) {
      console.error('Failed to write cache:', err.message);
    }
  } else {
    console.warn('Sync returned 0 events; keeping existing cache and snapshot untouched.');
  }

  return payload;
}

export async function getCachedOrSyncEvents(force = false) {
  if (!force) {
    try {
      const raw = await fs.readFile(CACHE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (data?.events?.length > 0) return data;
    } catch {
      // Cache doesn't exist yet
    }
  }
  return syncAllChicagoMusicEvents();
}
