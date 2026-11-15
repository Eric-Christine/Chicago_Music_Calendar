import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar as CalendarIcon,
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
  Sparkles,
  Ticket,
} from 'lucide-react';

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

const CORRIDORS = [
  'ALL',
  'Salt Shed / Elston',
  'Milwaukee Ave Corridor',
  'Radius / Pilsen / South',
  'West Town / Fulton',
  'North Side / Lakeview',
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Static builds (GitHub Pages) have no API server; data comes from the snapshot refreshed by CI
const IS_STATIC = import.meta.env.VITE_STATIC === '1';
const BASE = import.meta.env.BASE_URL;

export default function App() {
  const [data, setData] = useState<CalendarPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Filters
  const [selectedCorridor, setSelectedCorridor] = useState<string>('ALL');
  const [selectedVenueIds, setSelectedVenueIds] = useState<string[]>([]);
  const [maxDistance, setMaxDistance] = useState<number>(10);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewMode, setViewMode] = useState<'month' | 'agenda' | 'radar'>('month');

  // Calendar Navigation (default Nov 2026 based on current date)
  const [currentMonth, setCurrentMonth] = useState<{ year: number; month: number }>({
    year: 2026,
    month: 10, // 0-indexed: 10 = November
  });
  const [selectedDate, setSelectedDate] = useState<string>('2026-11-13');
  const [activeSpotifyEmbed, setActiveSpotifyEmbed] = useState<string | null>(null);

  // Audio player for 30s track previews
  const [playingEventId, setPlayingEventId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
      if (json.events?.length) {
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
        const hasToday = json.events.some((e) => e.date === todayStr);
        const firstDate = hasToday ? todayStr : json.events[0].date;
        setSelectedDate(firstDate);
        const [y, m] = firstDate.split('-').map(Number);
        setCurrentMonth({ year: y, month: m - 1 });
      }
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

  function toggleAudioPreview(ev: MusicEvent) {
    if (!ev.previewAudioUrl) return;
    if (playingEventId === ev.id) {
      audioRef.current?.pause();
      setPlayingEventId(null);
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(ev.previewAudioUrl);
      audio.onended = () => setPlayingEventId(null);
      audio.play();
      audioRef.current = audio;
      setPlayingEventId(ev.id);
    }
  }

  function toggleVenueFilter(venueId: string) {
    setSelectedVenueIds((prev) =>
      prev.includes(venueId) ? prev.filter((id) => id !== venueId) : [...prev, venueId]
    );
  }

  const filteredVenues = useMemo(() => {
    if (!data?.venues) return [];
    return data.venues.filter((v) => {
      if (selectedCorridor !== 'ALL' && v.corridor !== selectedCorridor) return false;
      if (v.distanceMiles > maxDistance) return false;
      return true;
    });
  }, [data, selectedCorridor, maxDistance]);

  const filteredEvents = useMemo(() => {
    if (!data?.events) return [];
    const q = searchQuery.trim().toLowerCase();
    return data.events.filter((ev) => {
      if (selectedCorridor !== 'ALL' && ev.corridor !== selectedCorridor) return false;
      if (selectedVenueIds.length > 0 && !selectedVenueIds.includes(ev.venueId)) return false;
      if (ev.distanceMiles > maxDistance) return false;
      if (q) {
        const matchArtist = ev.headliner.toLowerCase().includes(q);
        const matchTitle = ev.title.toLowerCase().includes(q);
        const matchSupport = ev.support.some((s) => s.toLowerCase().includes(q));
        const matchVenue = ev.venueName.toLowerCase().includes(q);
        const matchGenre = ev.genre.toLowerCase().includes(q);
        if (!matchArtist && !matchTitle && !matchSupport && !matchVenue && !matchGenre) {
          return false;
        }
      }
      return true;
    });
  }, [data, selectedCorridor, selectedVenueIds, maxDistance, searchQuery]);

  // Group events by YYYY-MM-DD
  const eventsByDate = useMemo(() => {
    const map: Record<string, MusicEvent[]> = {};
    for (const ev of filteredEvents) {
      if (!map[ev.date]) map[ev.date] = [];
      map[ev.date].push(ev);
    }
    return map;
  }, [filteredEvents]);

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

    // Next month padding to complete 6-column or 5-column week rows
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
      <div className="app-shell" style={{ textAlign: 'center', paddingTop: 120 }}>
        <RefreshCw size={36} style={{ animation: 'spin 1s linear infinite', color: '#f97316' }} />
        <h2 style={{ marginTop: 16 }}>Syncing Ward 1 Chicago Live Music Calendar...</h2>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {/* Header */}
      <header className="hero-header">
        <div className="hero-title-group">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span className="ward-badge">
              <MapPin size={13} /> Ward 1 Center • ≤{maxDistance} Mi Radius
            </span>
            <span
              style={{
                fontSize: '0.78rem',
                color: '#94a3b8',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <Sparkles size={13} color="#f97316" /> Auto-Synced via Ticketmaster, TicketWeb, DICE, AXS &
              Venue Feeds + Spotify
            </span>
          </div>
          <h1>Chicago Live Music Calendar</h1>
          <p className="hero-subtitle">
            Tracking who is playing every day across <strong>The Salt Shed</strong>, the{' '}
            <strong>Milwaukee Ave Corridor</strong> (Subterranean, Concord, Chop Shop, Cole&apos;s, The
            Whistler, Sleeping Village), <strong>Radius</strong>, <strong>Empty Bottle</strong>,{' '}
            <strong>Thalia Hall</strong>, <strong>Metro</strong>, <strong>Lincoln Hall</strong> &amp; 25+
            stages within 10 miles of Ward 1.
          </p>
        </div>

        <div className="sync-controls">
          {!IS_STATIC && (
            <button className="btn btn-primary" onClick={handleManualSync} disabled={syncing}>
              <RefreshCw size={15} />
              {syncing ? 'Syncing Live Sources...' : 'Sync Now'}
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
            Export .ICS Calendar
          </a>
        </div>
      </header>

      {/* KPI Metrics */}
      <section className="kpi-strip">
        <div className="kpi-card">
          <span className="kpi-label">Upcoming Shows Synced</span>
          <span className="kpi-value">{filteredEvents.length}</span>
          <span className="kpi-sub">
            From {data?.sourceBreakdown?.rawTotal || filteredEvents.length} raw listings deduplicated
          </span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Venues Within {maxDistance} Mi</span>
          <span className="kpi-value">{filteredVenues.length}</span>
          <span className="kpi-sub">Centered on Ward 1 (Wicker Park / Logan Sq)</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Salt Shed + Milwaukee Ave</span>
          <span className="kpi-value">
            {
              filteredEvents.filter(
                (e) =>
                  e.corridor === 'Salt Shed / Elston' || e.corridor === 'Milwaukee Ave Corridor'
              ).length
            }
          </span>
          <span className="kpi-sub">Shows in core Ward 1 &amp; Elston corridors</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Spotify &amp; Audio Previews</span>
          <span className="kpi-value">
            {filteredEvents.filter((e) => e.previewAudioUrl || e.spotifyArtistId).length}
          </span>
          <span className="kpi-sub">Instant 30s track previews &amp; artist links</span>
        </div>
      </section>

      {/* Filter Bar */}
      <section className="filter-bar">
        <div className="filter-row">
          <div className="search-box">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Search artist, opener, venue (e.g. Salt Shed, Brutalismus 3000, Empty Bottle)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>
              Ward 1 Radius: <strong>{maxDistance} mi</strong>
            </label>
            <input
              type="range"
              min={1}
              max={10}
              step={0.5}
              value={maxDistance}
              onChange={(e) => setMaxDistance(parseFloat(e.target.value))}
              style={{ accentColor: '#f97316', cursor: 'pointer' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className={`btn ${viewMode === 'month' ? 'btn-primary' : ''}`}
              onClick={() => setViewMode('month')}
            >
              <CalendarIcon size={15} /> Month Grid
            </button>
            <button
              className={`btn ${viewMode === 'agenda' ? 'btn-primary' : ''}`}
              onClick={() => setViewMode('agenda')}
            >
              <List size={15} /> Daily Lineup
            </button>
            <button
              className={`btn ${viewMode === 'radar' ? 'btn-primary' : ''}`}
              onClick={() => setViewMode('radar')}
            >
              <Compass size={15} /> Ward 1 Radar Map
            </button>
          </div>
        </div>

        {/* Corridor Pills */}
        <div className="corridor-pills">
          {CORRIDORS.map((corr) => (
            <button
              key={corr}
              className={`pill ${selectedCorridor === corr ? 'active' : ''}`}
              onClick={() => {
                setSelectedCorridor(corr);
                setSelectedVenueIds([]);
              }}
            >
              {corr === 'ALL' ? 'All Ward 1 Corridors (≤10 mi)' : corr}
            </button>
          ))}
        </div>

        {/* Venue Filter Chips */}
        <div className="venue-chips-scroll">
          {filteredVenues.map((v) => {
            const active = selectedVenueIds.includes(v.id);
            const count = filteredEvents.filter((e) => e.venueId === v.id).length;
            return (
              <button
                key={v.id}
                className={`venue-chip ${active ? 'active' : ''}`}
                onClick={() => toggleVenueFilter(v.id)}
                title={`${v.name} • ${v.address} (${v.distanceMiles} mi from Ward 1)`}
              >
                <span className="venue-dot" style={{ backgroundColor: v.color }} />
                <span>{v.shortName}</span>
                <span style={{ opacity: 0.6, fontSize: '0.7rem' }}>
                  {v.distanceMiles}mi ({count})
                </span>
              </button>
            );
          })}
          {selectedVenueIds.length > 0 && (
            <button
              className="venue-chip"
              style={{ color: '#f97316', borderColor: '#f97316' }}
              onClick={() => setSelectedVenueIds([])}
            >
              Clear Venue Filter
            </button>
          )}
        </div>
      </section>

      {/* Workspace: Calendar / Agenda / Radar + Daily Inspector */}
      <div className="main-workspace">
        <div className="calendar-panel">
          {viewMode === 'month' && (
            <>
              <div className="calendar-nav">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button className="btn" onClick={() => changeMonth(-1)}>
                    <ChevronLeft size={16} />
                  </button>
                  <h2 className="month-title">{monthLabel}</h2>
                  <button className="btn" onClick={() => changeMonth(1)}>
                    <ChevronRight size={16} />
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn"
                    onClick={() => {
                      setCurrentMonth({ year: 2026, month: 10 });
                      setSelectedDate('2026-11-13');
                    }}
                  >
                    Today (Nov 13)
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      setCurrentMonth({ year: 2026, month: 11 });
                      setSelectedDate('2026-12-01');
                    }}
                  >
                    Dec 2026
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      setCurrentMonth({ year: 2027, month: 0 });
                      setSelectedDate('2027-01-01');
                    }}
                  >
                    Jan 2027
                  </button>
                </div>
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
                  const isToday = cell.dateStr === '2026-11-13';
                  const visibleBadges = dayEvents.slice(0, 4);
                  const hiddenCount = Math.max(0, dayEvents.length - visibleBadges.length);

                  return (
                    <div
                      key={cell.dateStr}
                      className={`day-cell ${!cell.inMonth ? 'outside-month' : ''} ${
                        isSelected ? 'selected-day' : ''
                      } ${isToday ? 'today' : ''}`}
                      onClick={() => setSelectedDate(cell.dateStr)}
                    >
                      <div className="day-cell-header">
                        <span className="day-number">{cell.dayNum}</span>
                        {dayEvents.length > 0 && (
                          <span className="day-show-count">{dayEvents.length} shows</span>
                        )}
                      </div>

                      {visibleBadges.map((ev) => (
                        <div
                          key={ev.id}
                          className="event-badge"
                          style={{ borderLeftColor: ev.venueColor }}
                          title={`${ev.headliner} @ ${ev.venueName} (${ev.time})`}
                        >
                          <div className="event-badge-artist">{ev.headliner}</div>
                          <div className="event-badge-venue">
                            <span>{ev.venueShort}</span>
                            {ev.previewAudioUrl && <Headphones size={10} color="#4ade80" />}
                          </div>
                        </div>
                      ))}

                      {hiddenCount > 0 && (
                        <div className="more-shows-pill">+{hiddenCount} more shows</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {viewMode === 'agenda' && (
            <div className="agenda-list">
              {Object.entries(eventsByDate)
                .slice(0, 45)
                .map(([dateStr, dayEvs]) => {
                  const formatted = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  });
                  return (
                    <div key={dateStr} className="agenda-day-group">
                      <div className="agenda-day-header">
                        <span>{formatted}</span>
                        <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                          {dayEvs.length} {dayEvs.length === 1 ? 'show' : 'shows'}
                        </span>
                      </div>
                      <div className="agenda-cards-grid">
                        {dayEvs.map((ev) => (
                          <div
                            key={ev.id}
                            className="sidebar-show-card"
                            onClick={() => setSelectedDate(ev.date)}
                          >
                            <div className="show-card-top">
                              {ev.imageUrl ? (
                                <img src={ev.imageUrl} alt={ev.headliner} className="show-thumb" />
                              ) : (
                                <div
                                  className="show-thumb"
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                  }}
                                >
                                  <Music size={22} color={ev.venueColor} />
                                </div>
                              )}
                              <div>
                                <div className="show-headline">{ev.headliner}</div>
                                {ev.support.length > 0 && (
                                  <div className="show-support">
                                    w/ {ev.support.slice(0, 3).join(', ')}
                                  </div>
                                )}
                                <div
                                  style={{
                                    fontSize: '0.76rem',
                                    color: ev.venueColor,
                                    fontWeight: 700,
                                    marginTop: 3,
                                  }}
                                >
                                  {ev.venueName} ({ev.distanceMiles} mi)
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}

          {viewMode === 'radar' && data && (
            <div className="radar-container">
              <div style={{ textAlign: 'center', maxWidth: 640 }}>
                <h3 style={{ fontFamily: 'Space Grotesk', fontSize: '1.3rem' }}>
                  Ward 1 Live Music Spatial Radar (10-Mile Radius)
                </h3>
                <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: 4 }}>
                  Centered at Wicker Park / Logan Square (41.9080°N, 87.6790°W). Click any venue pin
                  to filter the calendar to that stage.
                </p>
              </div>

              <svg
                width="680"
                height="520"
                viewBox="0 0 680 520"
                style={{
                  background: '#0b0f19',
                  borderRadius: 16,
                  border: '1px solid rgba(255,255,255,0.1)',
                  maxWidth: '100%',
                }}
              >
                {/* Radar distance rings (2mi, 4mi, 6mi, 8mi, 10mi) */}
                {[2, 4, 6, 8, 10].map((mi) => (
                  <g key={mi}>
                    <circle
                      cx={320}
                      cy={250}
                      r={mi * 23}
                      fill="none"
                      stroke="rgba(255,255,255,0.07)"
                      strokeDasharray="4 4"
                    />
                    <text
                      x={324}
                      y={250 - mi * 23 + 12}
                      fill="#64748b"
                      fontSize="10"
                      fontFamily="Inter"
                    >
                      {mi} mi
                    </text>
                  </g>
                ))}

                {/* Milwaukee Ave Diagonal Line */}
                <line
                  x1={140}
                  y1={110}
                  x2={450}
                  y2={340}
                  stroke="rgba(16, 185, 129, 0.25)"
                  strokeWidth={3}
                />
                <text x={150} y={102} fill="#10b981" fontSize="11" fontWeight="600">
                  Milwaukee Ave Corridor
                </text>

                {/* Ward 1 Center Marker */}
                <circle cx={320} cy={250} r={6} fill="#f97316" />
                <circle
                  cx={320}
                  cy={250}
                  r={14}
                  fill="none"
                  stroke="#f97316"
                  strokeOpacity={0.5}
                />
                <text x={332} y={254} fill="#fdba74" fontSize="11" fontWeight="700">
                  WARD 1 CENTER
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
                        stroke="#090b10"
                        strokeWidth={2}
                      />
                      <text
                        x={cx + 8}
                        y={cy + 3}
                        fill="#e2e8f0"
                        fontSize="10"
                        fontWeight="600"
                      >
                        {v.shortName} ({v.distanceMiles}m)
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </div>

        {/* Right Sidebar: Selected Date Lineup & Spotify Player */}
        <aside className="inspector-sidebar">
          <div className="sidebar-date-banner">
            <span className="kpi-label">Daily Stage Schedule</span>
            <h2>
              {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </h2>
            <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: 2 }}>
              {selectedDayEvents.length}{' '}
              {selectedDayEvents.length === 1 ? 'concert' : 'concerts'} scheduled within {maxDistance}{' '}
              miles of Ward 1
            </p>
          </div>

          {activeSpotifyEmbed && (
            <div style={{ marginBottom: 8 }}>
              <iframe
                title="Spotify Artist Player"
                src={`https://open.spotify.com/embed/artist/${activeSpotifyEmbed}?utm_source=generator&theme=0`}
                width="100%"
                height="152"
                frameBorder="0"
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                loading="lazy"
                style={{ borderRadius: 12 }}
              />
            </div>
          )}

          {selectedDayEvents.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: '0.88rem', padding: '24px 0' }}>
              No shows matching your current filter on this date. Click another date in the calendar
              or clear venue filters.
            </div>
          ) : (
            selectedDayEvents.map((ev) => {
              const isPlaying = playingEventId === ev.id;
              return (
                <div
                  key={ev.id}
                  className="sidebar-show-card"
                  style={{ borderLeft: `4px solid ${ev.venueColor}` }}
                >
                  <div className="show-card-top">
                    {ev.imageUrl ? (
                      <img src={ev.imageUrl} alt={ev.headliner} className="show-thumb" />
                    ) : (
                      <div
                        className="show-thumb"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Music size={22} color={ev.venueColor} />
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="show-headline">{ev.headliner}</div>
                      {ev.support.length > 0 && (
                        <div className="show-support">w/ {ev.support.join(', ')}</div>
                      )}
                      <div
                        style={{
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          color: ev.venueColor,
                          marginTop: 4,
                        }}
                      >
                        {ev.venueName} • {ev.distanceMiles} mi
                      </div>
                    </div>
                  </div>

                  <div className="show-meta-grid">
                    <span className="meta-tag">{ev.time}</span>
                    <span className="meta-tag">{ev.corridor}</span>
                    {ev.price && <span className="meta-tag">{ev.price}</span>}
                    <span className="meta-tag">{ev.genre}</span>
                    <span className="meta-tag">{ev.source}</span>
                  </div>

                  {ev.previewTrackTitle && (
                    <div
                      style={{
                        fontSize: '0.73rem',
                        color: '#4ade80',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <Headphones size={12} /> Top Track: {ev.previewTrackTitle}
                    </div>
                  )}

                  <div className="show-actions">
                    {ev.previewAudioUrl && (
                      <button
                        className="btn btn-spotify"
                        onClick={() => toggleAudioPreview(ev)}
                      >
                        {isPlaying ? <Pause size={13} /> : <Play size={13} />}
                        {isPlaying ? 'Pause 30s' : 'Preview 30s'}
                      </button>
                    )}

                    {ev.spotifyArtistId ? (
                      <button
                        className="btn btn-spotify"
                        onClick={() =>
                          setActiveSpotifyEmbed(
                            activeSpotifyEmbed === ev.spotifyArtistId ? null : ev.spotifyArtistId
                          )
                        }
                      >
                        <Headphones size={13} /> Spotify Embed
                      </button>
                    ) : (
                      <a
                        className="btn btn-spotify"
                        href={ev.spotifyUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink size={13} /> Spotify
                      </a>
                    )}

                    <a
                      className="btn"
                      href={ev.ticketUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Ticket size={13} /> Tickets
                    </a>
                  </div>
                </div>
              );
            })
          )}
        </aside>
      </div>
    </div>
  );
}
