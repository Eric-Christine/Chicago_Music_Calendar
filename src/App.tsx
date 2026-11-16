import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Compass,
  Download,
  ExternalLink,
  Headphones,
  List,
  MapPin,
  Music,
  Pause,
  Play,
  RefreshCw,
  Search,
  Ticket,
  X,
} from 'lucide-react';
import { GENRE_FAMILIES, OTHER_GENRE, genreFamily, genreFamilyIds } from './genres';
import { fetchDeezerPreviewUrl, silentClip } from './preview';

export interface Venue {
  id: string;
  name: string;
  shortName: string;
  corridor: string;
  neighborhood: string;
  address: string;
  lat: number;
  lng: number;
  capacity: number;
  color: string;
  website: string;
  distanceMiles: number;
}

export interface MusicEvent {
  id: string;
  title: string;
  headliner: string;
  support: string[];
  date: string; // YYYY-MM-DD
  time: string;
  venueId: string;
  venueName: string;
  venueShort: string;
  corridor: string;
  neighborhood: string;
  address: string;
  distanceMiles: number;
  lat: number;
  lng: number;
  venueColor: string;
  ticketUrl: string;
  imageUrl: string | null;
  genre: string;
  price: string | null;
  ageRestriction: string;
  soldOut: boolean;
  source: string;
  spotifyUrl: string;
  spotifyArtistId: string | null;
  spotifyTrackUrl: string | null;
  previewAudioUrl: string | null;
  previewTrackId?: number | null; // Deezer track, resolved to an audio URL at play time
  previewTrackTitle: string | null;
  artistFans?: number | null;
}

interface CalendarPayload {
  lastSyncedAt: string;
  wardCenter: {
    name: string;
    lat: number;
    lng: number;
    maxRadiusMiles: number;
  };
  sourceBreakdown: Record<string, number>;
  venues: Venue[];
  events: MusicEvent[];
}

type ViewMode = 'month' | 'agenda' | 'radar';
type PreviewStatus = 'idle' | 'loading' | 'playing' | 'error';

const CORRIDORS = [
  'ALL',
  'Salt Shed / Elston',
  'Milwaukee Ave Corridor',
  'Radius / Pilsen / South',
  'West Town / Fulton',
  'North Side / Lakeview',
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const AGENDA_PAGE_DAYS = 14;

// Static builds (GitHub Pages) have no API server; data comes from the snapshot refreshed by CI
const IS_STATIC = import.meta.env.VITE_STATIC === '1';
const BASE = import.meta.env.BASE_URL;

function chicagoToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

function formatDate(dateStr: string, opts: Intl.DateTimeFormatOptions) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', opts);
}

function ShowThumb({ ev }: { ev: MusicEvent }) {
  const [failed, setFailed] = useState(false);
  if (ev.imageUrl && !failed) {
    return (
      <img
        src={ev.imageUrl}
        alt=""
        className="show-thumb"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className="show-thumb show-thumb-empty">
      <Music size={22} color={ev.venueColor} />
    </div>
  );
}

interface ShowCardProps {
  ev: MusicEvent;
  previewStatus: PreviewStatus;
  embedOpen: boolean;
  activeGenres: string[];
  onTogglePreview: (ev: MusicEvent) => void;
  onToggleEmbed: (ev: MusicEvent) => void;
  onToggleGenre: (id: string) => void;
}

function ShowCard({
  ev,
  previewStatus,
  embedOpen,
  activeGenres,
  onTogglePreview,
  onToggleEmbed,
  onToggleGenre,
}: ShowCardProps) {
  return (
    <article className="show-card" style={{ '--venue-color': ev.venueColor } as React.CSSProperties}>
      <div className="show-card-top">
        <ShowThumb ev={ev} />
        <div className="show-card-text">
          <div className="show-headline">{ev.headliner}</div>
          {ev.support.length > 0 && <div className="show-support">w/ {ev.support.join(', ')}</div>}
          <div className="show-venue">
            {ev.venueName} <span>· {ev.time}</span>
          </div>
        </div>
      </div>

      <div className="show-tags">
        {genreFamilyIds(ev.genre)
          .filter((id) => id !== OTHER_GENRE.id)
          .map((id) => {
            const fam = genreFamily(id);
            return (
              <button
                key={id}
                className={`tag tag-genre ${activeGenres.includes(id) ? 'active' : ''}`}
                onClick={() => onToggleGenre(id)}
                title={`Filter by ${fam.label}`}
              >
                <span className="dot" style={{ backgroundColor: fam.color }} />
                {fam.label}
              </button>
            );
          })}
        {ev.soldOut && <span className="tag tag-soldout">Sold out</span>}
        {ev.price && <span className="tag">{ev.price}</span>}
        {ev.ageRestriction && <span className="tag">{ev.ageRestriction}</span>}
        <span className="tag">
          {ev.neighborhood} · {ev.distanceMiles} mi
        </span>
      </div>

      {ev.previewTrackTitle && (
        <div className="show-track">
          <Headphones size={12} /> {ev.previewTrackTitle}
        </div>
      )}

      {embedOpen && ev.spotifyArtistId && (
        <iframe
          title={`${ev.headliner} on Spotify`}
          src={`https://open.spotify.com/embed/artist/${ev.spotifyArtistId}?utm_source=generator&theme=0`}
          width="100%"
          height="152"
          frameBorder="0"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
          className="spotify-embed"
        />
      )}

      <div className="show-actions">
        {(ev.previewAudioUrl || ev.previewTrackId) && (
          <button
            className="btn btn-spotify"
            onClick={() => onTogglePreview(ev)}
            disabled={previewStatus === 'error'}
          >
            {previewStatus === 'playing' ? <Pause size={14} /> : <Play size={14} />}
            {previewStatus === 'playing'
              ? 'Pause'
              : previewStatus === 'loading'
              ? 'Loading…'
              : previewStatus === 'error'
              ? 'Unavailable'
              : 'Preview'}
          </button>
        )}
        {ev.spotifyArtistId ? (
          <button className="btn btn-spotify" onClick={() => onToggleEmbed(ev)}>
            <Headphones size={14} /> {embedOpen ? 'Hide player' : 'Spotify'}
          </button>
        ) : (
          <a className="btn btn-spotify" href={ev.spotifyUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> Spotify
          </a>
        )}
        <a className="btn btn-primary" href={ev.ticketUrl} target="_blank" rel="noreferrer">
          <Ticket size={14} /> Tickets
        </a>
      </div>
    </article>
  );
}

export default function App() {
  const [data, setData] = useState<CalendarPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const today = useMemo(chicagoToday, []);

  // Filters
  const [selectedCorridor, setSelectedCorridor] = useState<string>('ALL');
  const [selectedVenueIds, setSelectedVenueIds] = useState<string[]>([]);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [maxDistance, setMaxDistance] = useState<number>(10);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [venuesOpen, setVenuesOpen] = useState(false);
  const [agendaDays, setAgendaDays] = useState(AGENDA_PAGE_DAYS);

  const [currentMonth, setCurrentMonth] = useState<{ year: number; month: number }>(() => {
    const [y, m] = today.split('-').map(Number);
    return { year: y, month: m - 1 };
  });
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [activeSpotifyEmbed, setActiveSpotifyEmbed] = useState<string | null>(null);
  const lineupRef = useRef<HTMLElement | null>(null);

  // Audio player for 30s track previews. One element is reused so a tap-unlocked
  // element stays unlocked on mobile browsers.
  const [preview, setPreview] = useState<{ id: string; status: PreviewStatus } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewRequest = useRef(0);

  useEffect(() => {
    loadCalendarData();
  }, []);

  async function loadCalendarData() {
    try {
      setLoading(true);
      // Try live backend API first, fallback to bundled static snapshot
      let res = IS_STATIC ? null : await fetch(`${BASE}api/calendar`).catch(() => null);
      if (!res || !res.ok) {
        res = await fetch(`${BASE}events_snapshot.json`);
      }
      const json: CalendarPayload = await res.json();
      setData(json);
    } catch (err) {
      console.error('Failed to load calendar:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleManualSync() {
    try {
      setSyncing(true);
      const res = await fetch(`${BASE}api/sync`, { method: 'POST' });
      if (res.ok) {
        const updated = await res.json();
        setData(updated);
      }
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  }

  async function toggleAudioPreview(ev: MusicEvent) {
    const audio = audioRef.current ?? (audioRef.current = new Audio());
    const request = ++previewRequest.current;
    audio.onended = null;
    audio.pause();

    if (preview?.id === ev.id && preview.status !== 'error') {
      setPreview(null);
      return;
    }

    setPreview({ id: ev.id, status: 'loading' });
    try {
      let url = ev.previewAudioUrl;
      if (!url && ev.previewTrackId) {
        audio.src = silentClip();
        audio.play().catch(() => {});
        url = await fetchDeezerPreviewUrl(ev.previewTrackId);
      }
      if (request !== previewRequest.current) return;
      if (!url) throw new Error('No preview');
      audio.src = url;
      audio.onended = () => setPreview(null);
      await audio.play();
      if (request === previewRequest.current) setPreview({ id: ev.id, status: 'playing' });
    } catch (err) {
      console.error('Preview failed:', err);
      if (request === previewRequest.current) setPreview({ id: ev.id, status: 'error' });
    }
  }

  function toggleSpotifyEmbed(ev: MusicEvent) {
    setActiveSpotifyEmbed((prev) => (prev === ev.id ? null : ev.id));
  }

  function toggleVenueFilter(venueId: string) {
    setSelectedVenueIds((prev) =>
      prev.includes(venueId) ? prev.filter((id) => id !== venueId) : [...prev, venueId]
    );
  }

  function toggleGenreFilter(genreId: string) {
    setSelectedGenres((prev) =>
      prev.includes(genreId) ? prev.filter((id) => id !== genreId) : [...prev, genreId]
    );
  }

  function clearFilters() {
    setSelectedCorridor('ALL');
    setSelectedVenueIds([]);
    setSelectedGenres([]);
    setMaxDistance(10);
    setSearchQuery('');
  }

  function goToDate(dateStr: string) {
    const [y, m] = dateStr.split('-').map(Number);
    setCurrentMonth({ year: y, month: m - 1 });
    setSelectedDate(dateStr);
  }

  function selectDay(dateStr: string) {
    setSelectedDate(dateStr);
    // When the lineup is stacked far below a tall calendar, bring it into view
    requestAnimationFrame(() => {
      const el = lineupRef.current;
      if (el && el.getBoundingClientRect().top > window.innerHeight - 120) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  // Snapshots can be hours old and some feeds list past dates; only show today onward
  const upcomingEvents = useMemo(
    () => (data?.events || []).filter((ev) => ev.date >= today),
    [data, today]
  );

  const filteredVenues = useMemo(() => {
    if (!data?.venues) return [];
    return data.venues.filter((v) => {
      if (selectedCorridor !== 'ALL' && v.corridor !== selectedCorridor) return false;
      if (v.distanceMiles > maxDistance) return false;
      return true;
    });
  }, [data, selectedCorridor, maxDistance]);

  // Counts on genre and venue chips ignore that chip group's own selection,
  // so they show what picking another option would add
  const { filteredEvents, genreCounts, venueCounts } = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered: MusicEvent[] = [];
    const genreCounts: Record<string, number> = {};
    const venueCounts: Record<string, number> = {};

    for (const ev of upcomingEvents) {
      if (selectedCorridor !== 'ALL' && ev.corridor !== selectedCorridor) continue;
      if (ev.distanceMiles > maxDistance) continue;
      const families = genreFamilyIds(ev.genre);
      if (q) {
        const haystack = [
          ev.headliner,
          ev.title,
          ...ev.support,
          ev.venueName,
          ev.neighborhood,
          ev.genre,
          ...families.map((id) => genreFamily(id).label),
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) continue;
      }

      const venueOk = selectedVenueIds.length === 0 || selectedVenueIds.includes(ev.venueId);
      const genreOk = selectedGenres.length === 0 || families.some((id) => selectedGenres.includes(id));

      if (venueOk) for (const id of families) genreCounts[id] = (genreCounts[id] || 0) + 1;
      if (genreOk) venueCounts[ev.venueId] = (venueCounts[ev.venueId] || 0) + 1;
      if (venueOk && genreOk) filtered.push(ev);
    }
    return { filteredEvents: filtered, genreCounts, venueCounts };
  }, [upcomingEvents, selectedCorridor, selectedVenueIds, selectedGenres, maxDistance, searchQuery]);

  // Group events by YYYY-MM-DD
  const eventsByDate = useMemo(() => {
    const map: Record<string, MusicEvent[]> = {};
    for (const ev of filteredEvents) {
      if (!map[ev.date]) map[ev.date] = [];
      map[ev.date].push(ev);
    }
    return map;
  }, [filteredEvents]);

  const sortedDates = useMemo(() => Object.keys(eventsByDate).sort(), [eventsByDate]);

  // Build calendar cells for currentMonth
  const calendarDays = useMemo(() => {
    const { year, month } = currentMonth;
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);
    const startOffset = firstDayOfMonth.getDay();
    const totalDays = lastDayOfMonth.getDate();

    const cells: Array<{ dateStr: string; dayNum: number; inMonth: boolean }> = [];

    // Previous month padding
    const prevMonthLastDate = new Date(year, month, 0).getDate();
    for (let i = startOffset - 1; i >= 0; i--) {
      const d = prevMonthLastDate - i;
      const pm = month === 0 ? 12 : month;
      const py = month === 0 ? year - 1 : year;
      cells.push({
        dateStr: `${py}-${String(pm).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        dayNum: d,
        inMonth: false,
      });
    }

    // Current month days
    for (let d = 1; d <= totalDays; d++) {
      cells.push({
        dateStr: `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        dayNum: d,
        inMonth: true,
      });
    }

    // Next month padding to complete the last week row
    const remainder = (7 - (cells.length % 7)) % 7;
    for (let d = 1; d <= remainder; d++) {
      const nm = month === 11 ? 1 : month + 2;
      const ny = month === 11 ? year + 1 : year;
      cells.push({
        dateStr: `${ny}-${String(nm).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        dayNum: d,
        inMonth: false,
      });
    }

    return cells;
  }, [currentMonth]);

  const selectedDayEvents = eventsByDate[selectedDate] || [];
  const nextDateWithShows = sortedDates.find((d) => d > selectedDate) || sortedDates[0];
  const tonightCount = (eventsByDate[today] || []).length;
  const previewCount = useMemo(
    () => filteredEvents.filter((e) => e.previewAudioUrl || e.previewTrackId).length,
    [filteredEvents]
  );

  const activeFilterCount =
    selectedGenres.length +
    selectedVenueIds.length +
    (selectedCorridor !== 'ALL' ? 1 : 0) +
    (maxDistance < 10 ? 1 : 0) +
    (searchQuery.trim() ? 1 : 0);

  function changeMonth(delta: number) {
    setCurrentMonth((prev) => {
      let m = prev.month + delta;
      let y = prev.year;
      if (m < 0) {
        m = 11;
        y -= 1;
      } else if (m > 11) {
        m = 0;
        y += 1;
      }
      return { year: y, month: m };
    });
  }

  const monthLabel = new Date(currentMonth.year, currentMonth.month, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  if (loading && !data) {
    return (
      <div className="app-shell loading-screen">
        <RefreshCw size={32} className="spin" />
        <p>Loading the lineup…</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="app-shell loading-screen">
        <p>Couldn’t load the calendar. Refresh to try again.</p>
      </div>
    );
  }

  const cardProps = {
    activeGenres: selectedGenres,
    onTogglePreview: toggleAudioPreview,
    onToggleEmbed: toggleSpotifyEmbed,
    onToggleGenre: toggleGenreFilter,
  };

  return (
    <div className="app-shell">
      {/* Header */}
      <header className="hero">
        <div className="hero-main">
          <span className="hero-eyebrow">
            <MapPin size={13} /> Ward 1 · Wicker Park / Logan Square · within 10 mi
          </span>
          <h1>
            Chicago Live Music <em>Calendar</em>
          </h1>
          <p className="hero-subtitle">
            Who’s playing every night at the Salt Shed, along Milwaukee Ave, Radius, Empty Bottle,
            Thalia Hall, Metro and {Math.max(0, data.venues.length - 6)} more stages.
          </p>
          <div className="hero-actions">
            {!IS_STATIC && (
              <button className="btn btn-primary" onClick={handleManualSync} disabled={syncing}>
                <RefreshCw size={15} className={syncing ? 'spin' : ''} />
                {syncing ? 'Syncing…' : 'Sync now'}
              </button>
            )}
            <a
              className="btn"
              href={
                IS_STATIC
                  ? `${BASE}calendar.ics`
                  : `${BASE}api/calendar.ics?corridor=${encodeURIComponent(selectedCorridor)}`
              }
              download="chicago-ward1-music.ics"
            >
              <Download size={15} />
              Export .ics
            </a>
            <span className="hero-updated">
              Updated{' '}
              {new Date(data.lastSyncedAt).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
          </div>
        </div>

        <dl className="hero-stats">
          <div className="stat">
            <dt>Shows</dt>
            <dd>{filteredEvents.length}</dd>
          </div>
          <div className="stat">
            <dt>Tonight</dt>
            <dd>{tonightCount}</dd>
          </div>
          <div className="stat">
            <dt>Venues</dt>
            <dd>{filteredVenues.length}</dd>
          </div>
          <div className="stat">
            <dt>Previews</dt>
            <dd>{previewCount}</dd>
          </div>
        </dl>
      </header>

      {/* Filter Bar */}
      <section className="toolbar">
        <div className="toolbar-top">
          <div className="search-box">
            <Search size={16} className="search-icon" />
            <input
              type="search"
              placeholder="Search artist, venue or genre"
              aria-label="Search artist, venue or genre"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="search-clear" onClick={() => setSearchQuery('')} aria-label="Clear search">
                <X size={15} />
              </button>
            )}
          </div>

          <div className="view-switch" role="tablist" aria-label="View">
            <button
              role="tab"
              aria-selected={viewMode === 'month'}
              className={viewMode === 'month' ? 'active' : ''}
              onClick={() => setViewMode('month')}
            >
              <CalendarIcon size={15} /> Calendar
            </button>
            <button
              role="tab"
              aria-selected={viewMode === 'agenda'}
              className={viewMode === 'agenda' ? 'active' : ''}
              onClick={() => setViewMode('agenda')}
            >
              <List size={15} /> Lineup
            </button>
            <button
              role="tab"
              aria-selected={viewMode === 'radar'}
              className={viewMode === 'radar' ? 'active' : ''}
              onClick={() => setViewMode('radar')}
            >
              <Compass size={15} /> Map
            </button>
          </div>
        </div>

        <div className="filter-group">
          <span className="filter-label">Genre</span>
          <div className="chip-row">
            {[...GENRE_FAMILIES, OTHER_GENRE].map((g) => {
              const count = genreCounts[g.id] || 0;
              const active = selectedGenres.includes(g.id);
              if (count === 0 && !active) return null;
              return (
                <button
                  key={g.id}
                  className={`pill ${active ? 'active' : ''}`}
                  style={{ '--chip-color': g.color } as React.CSSProperties}
                  aria-pressed={active}
                  onClick={() => toggleGenreFilter(g.id)}
                >
                  <span className="dot" style={{ backgroundColor: g.color }} />
                  {g.label}
                  <span className="count">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="filter-group">
          <span className="filter-label">Area</span>
          <div className="chip-row">
            {CORRIDORS.map((corr) => (
              <button
                key={corr}
                className={`pill ${selectedCorridor === corr ? 'active' : ''}`}
                aria-pressed={selectedCorridor === corr}
                onClick={() => {
                  setSelectedCorridor(corr);
                  setSelectedVenueIds([]);
                }}
              >
                {corr === 'ALL' ? 'Everywhere' : corr}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-group">
          <span className="filter-label">Venues</span>
          <div className="venue-controls">
            <button
              className={`pill ${selectedVenueIds.length > 0 ? 'active' : ''}`}
              aria-expanded={venuesOpen}
              onClick={() => setVenuesOpen((o) => !o)}
            >
              {selectedVenueIds.length > 0
                ? `${selectedVenueIds.length} selected`
                : `All ${filteredVenues.length} venues`}
              <ChevronDown size={14} className={venuesOpen ? 'flip' : ''} />
            </button>
            <label className="distance-control">
              <span>
                Within <strong>{maxDistance} mi</strong>
              </span>
              <input
                type="range"
                min={1}
                max={10}
                step={0.5}
                value={maxDistance}
                onChange={(e) => setMaxDistance(parseFloat(e.target.value))}
              />
            </label>
          </div>
        </div>

        {venuesOpen && (
          <div className="venue-chips">
            {filteredVenues.map((v) => {
              const active = selectedVenueIds.includes(v.id);
              return (
                <button
                  key={v.id}
                  className={`venue-chip ${active ? 'active' : ''}`}
                  aria-pressed={active}
                  onClick={() => toggleVenueFilter(v.id)}
                  title={`${v.name} • ${v.address} (${v.distanceMiles} mi from Ward 1)`}
                >
                  <span className="dot" style={{ backgroundColor: v.color }} />
                  {v.shortName}
                  <span className="count">{venueCounts[v.id] || 0}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="filter-summary">
          <span>
            <strong>{filteredEvents.length}</strong> {filteredEvents.length === 1 ? 'show' : 'shows'}
            {activeFilterCount > 0 ? ' match' : ' coming up'}
          </span>
          {activeFilterCount > 0 && (
            <button className="link-btn" onClick={clearFilters}>
              <X size={13} /> Clear filters
            </button>
          )}
        </div>
      </section>

      {/* Workspace: Calendar / Agenda / Radar + Daily Lineup */}
      <div className={`main-workspace ${viewMode === 'agenda' ? 'single' : ''}`}>
        <div className="calendar-panel">
          {viewMode === 'month' && (
            <>
              <div className="calendar-nav">
                <div className="month-stepper">
                  <button className="btn btn-icon" onClick={() => changeMonth(-1)} aria-label="Previous month">
                    <ChevronLeft size={18} />
                  </button>
                  <h2 className="month-title">{monthLabel}</h2>
                  <button className="btn btn-icon" onClick={() => changeMonth(1)} aria-label="Next month">
                    <ChevronRight size={18} />
                  </button>
                </div>
                <button className="btn" onClick={() => goToDate(today)}>
                  Today
                </button>
              </div>

              <div className="weekday-header">
                {WEEKDAYS.map((d) => (
                  <div key={d} className="weekday-cell">
                    {d}
                  </div>
                ))}
              </div>

              <div className="month-grid">
                {calendarDays.map((cell) => {
                  const dayEvents = eventsByDate[cell.dateStr] || [];
                  const isSelected = selectedDate === cell.dateStr;
                  const isToday = cell.dateStr === today;
                  const visibleBadges = dayEvents.slice(0, 3);
                  const hiddenCount = dayEvents.length - visibleBadges.length;

                  return (
                    <button
                      key={cell.dateStr}
                      className={`day-cell ${!cell.inMonth ? 'outside-month' : ''} ${
                        isSelected ? 'selected-day' : ''
                      } ${isToday ? 'today' : ''} ${cell.dateStr < today ? 'past' : ''}`}
                      aria-label={`${formatDate(cell.dateStr, { month: 'long', day: 'numeric' })}, ${
                        dayEvents.length
                      } shows`}
                      aria-pressed={isSelected}
                      onClick={() => selectDay(cell.dateStr)}
                    >
                      <span className="day-cell-header">
                        <span className="day-number">{cell.dayNum}</span>
                        {dayEvents.length > 0 && (
                          <span className="day-show-count">
                            {dayEvents.length}
                            <span className="day-show-word"> {dayEvents.length === 1 ? 'show' : 'shows'}</span>
                          </span>
                        )}
                      </span>

                      {visibleBadges.map((ev) => (
                        <span
                          key={ev.id}
                          className="event-badge"
                          style={{ borderLeftColor: ev.venueColor }}
                        >
                          <span className="event-badge-artist">{ev.headliner}</span>
                          <span className="event-badge-venue">{ev.venueShort}</span>
                        </span>
                      ))}
                      {hiddenCount > 0 && <span className="more-shows-pill">+{hiddenCount} more</span>}

                      {/* Compact marker row used instead of badges on small screens */}
                      {dayEvents.length > 0 && (
                        <span className="day-dots">
                          {visibleBadges.map((ev) => (
                            <span key={ev.id} className="dot" style={{ backgroundColor: ev.venueColor }} />
                          ))}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {viewMode === 'agenda' && (
            <div className="agenda-list">
              {sortedDates.length === 0 && (
                <div className="empty-state">
                  No shows match these filters.
                  <button className="link-btn" onClick={clearFilters}>
                    Clear filters
                  </button>
                </div>
              )}
              {sortedDates.slice(0, agendaDays).map((dateStr) => {
                const dayEvs = eventsByDate[dateStr];
                return (
                  <section key={dateStr} className="agenda-day-group">
                    <h3 className="agenda-day-header">
                      <span>
                        {dateStr === today
                          ? 'Tonight · '
                          : ''}
                        {formatDate(dateStr, { weekday: 'long', month: 'short', day: 'numeric' })}
                      </span>
                      <span className="agenda-day-count">
                        {dayEvs.length} {dayEvs.length === 1 ? 'show' : 'shows'}
                      </span>
                    </h3>
                    <div className="agenda-cards-grid">
                      {dayEvs.map((ev) => (
                        <ShowCard
                          key={ev.id}
                          ev={ev}
                          previewStatus={preview?.id === ev.id ? preview.status : 'idle'}
                          embedOpen={activeSpotifyEmbed === ev.id}
                          {...cardProps}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
              {sortedDates.length > agendaDays && (
                <button className="btn load-more" onClick={() => setAgendaDays((n) => n + AGENDA_PAGE_DAYS)}>
                  Show more days
                </button>
              )}
            </div>
          )}

          {viewMode === 'radar' && (
            <div className="radar-container">
              <div className="radar-intro">
                <h3>Venues around Ward 1</h3>
                <p>Rings mark every 2 miles from Wicker Park / Logan Square. Tap a venue to filter the calendar.</p>
              </div>

              <div className="radar-scroll">
                <svg viewBox="0 0 680 520" className="radar-svg" role="img" aria-label="Map of venues by distance from Ward 1">
                  {/* Radar distance rings (2mi, 4mi, 6mi, 8mi, 10mi) */}
                  {[2, 4, 6, 8, 10].map((mi) => (
                    <g key={mi}>
                      <circle
                        cx={320}
                        cy={250}
                        r={mi * 23}
                        fill="none"
                        stroke="rgba(255,255,255,0.08)"
                        strokeDasharray="4 4"
                      />
                      <text x={324} y={250 - mi * 23 + 12} fill="#6b7280" fontSize="10">
                        {mi} mi
                      </text>
                    </g>
                  ))}

                  {/* Milwaukee Ave Diagonal Line */}
                  <line x1={140} y1={110} x2={450} y2={340} stroke="rgba(16, 185, 129, 0.25)" strokeWidth={3} />
                  <text x={150} y={102} fill="#10b981" fontSize="11" fontWeight="600">
                    Milwaukee Ave
                  </text>

                  {/* Ward 1 Center Marker */}
                  <circle cx={320} cy={250} r={6} fill="#f97316" />
                  <circle cx={320} cy={250} r={14} fill="none" stroke="#f97316" strokeOpacity={0.5} />
                  <text x={332} y={254} fill="#fdba74" fontSize="11" fontWeight="700">
                    WARD 1
                  </text>

                  {/* Venue Nodes */}
                  {filteredVenues.map((v) => {
                    const dx = (v.lng - data.wardCenter.lng) * 2400;
                    const dy = (data.wardCenter.lat - v.lat) * 3100;
                    const cx = Math.max(40, Math.min(640, 320 + dx));
                    const cy = Math.max(30, Math.min(490, 250 + dy));
                    const isSelected = selectedVenueIds.includes(v.id);

                    return (
                      <g
                        key={v.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          toggleVenueFilter(v.id);
                          setViewMode('month');
                        }}
                      >
                        <circle
                          cx={cx}
                          cy={cy}
                          r={isSelected ? 9 : 6}
                          fill={v.color}
                          stroke="#0b0b12"
                          strokeWidth={2}
                        />
                        <text x={cx + 9} y={cy + 3} fill="#e5e7eb" fontSize="10" fontWeight="600">
                          {v.shortName}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar: selected date lineup */}
        {viewMode !== 'agenda' && (
          <aside className="lineup-sidebar" ref={lineupRef}>
            <div className="lineup-header">
              <span className="filter-label">{selectedDate === today ? 'Tonight' : 'Lineup'}</span>
              <h2>{formatDate(selectedDate, { weekday: 'long', month: 'short', day: 'numeric' })}</h2>
              <p>
                {selectedDayEvents.length} {selectedDayEvents.length === 1 ? 'show' : 'shows'}
                {activeFilterCount > 0 ? ' matching your filters' : ''}
              </p>
            </div>

            {selectedDayEvents.length === 0 ? (
              <div className="empty-state">
                {activeFilterCount > 0 ? 'Nothing matches your filters on this date.' : 'No shows listed on this date.'}
                {nextDateWithShows && (
                  <button className="btn" onClick={() => goToDate(nextDateWithShows)}>
                    Jump to {formatDate(nextDateWithShows, { weekday: 'short', month: 'short', day: 'numeric' })}
                  </button>
                )}
                {activeFilterCount > 0 && (
                  <button className="link-btn" onClick={clearFilters}>
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              selectedDayEvents.map((ev) => (
                <ShowCard
                  key={ev.id}
                  ev={ev}
                  previewStatus={preview?.id === ev.id ? preview.status : 'idle'}
                  embedOpen={activeSpotifyEmbed === ev.id}
                  {...cardProps}
                />
              ))
            )}
          </aside>
        )}
      </div>

      <footer className="site-footer">
        Listings pulled from Ticketmaster, TicketWeb, DICE and venue sites. Check the venue before you
        head out.
      </footer>
    </div>
  );
}
