import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Calendar as CalendarIcon,
  Check,
  Crosshair,
  ExternalLink,
  Layers,
  MapPin,
  Navigation,
  Plus,
  Radio,
  X,
} from 'lucide-react';
import type { MusicEvent, Venue } from './App';

interface VenueMapProps {
  venues: Venue[];
  wardCenter: {
    name: string;
    lat: number;
    lng: number;
    maxRadiusMiles: number;
  };
  selectedVenueIds: string[];
  venueCounts: Record<string, number>;
  events: MusicEvent[];
  selectedDate: string;
  maxDistance: number;
  onToggleVenue: (venueId: string) => void;
  onFocusVenueCalendar: (venueId: string) => void;
}

type BasemapStyle = 'dark' | 'streets';

const TILE_LAYERS: Record<BasemapStyle, { url: string; attribution: string }> = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>',
  },
  streets: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>',
  },
};

const MILES_TO_METERS = 1609.344;

function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatShortDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

// Slightly separate venues that share the exact same building coordinates
// (e.g. Salt Shed / Three Top Lounge, Concord / Smoke & Mirrors, Radius / Cermak Hall)
function computeDisplayCoords(venues: Venue[]): Map<string, [number, number]> {
  const groups = new Map<string, Venue[]>();
  for (const v of venues) {
    const key = `${v.lat.toFixed(4)},${v.lng.toFixed(4)}`;
    const list = groups.get(key) || [];
    list.push(v);
    groups.set(key, list);
  }

  const coords = new Map<string, [number, number]>();
  for (const list of groups.values()) {
    if (list.length === 1) {
      coords.set(list[0].id, [list[0].lat, list[0].lng]);
    } else {
      const spread = 0.00085;
      list.forEach((v, idx) => {
        const angle = (idx / list.length) * Math.PI * 2 + Math.PI / 4;
        coords.set(v.id, [
          v.lat + Math.sin(angle) * spread * 0.75,
          v.lng + Math.cos(angle) * spread,
        ]);
      });
    }
  }
  return coords;
}

export function VenueMap({
  venues,
  wardCenter,
  selectedVenueIds,
  venueCounts,
  events,
  selectedDate,
  maxDistance,
  onToggleVenue,
  onFocusVenueCalendar,
}: VenueMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const ringsLayerRef = useRef<L.LayerGroup | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const hasFittedRef = useRef(false);

  const [basemap, setBasemap] = useState<BasemapStyle>('dark');
  const [showRings, setShowRings] = useState(true);
  const [focusedVenueId, setFocusedVenueId] = useState<string | null>(null);

  const displayCoords = useMemo(() => computeDisplayCoords(venues), [venues]);

  const showsByVenue = useMemo(() => {
    const map = new Map<string, MusicEvent[]>();
    for (const ev of events) {
      const list = map.get(ev.venueId);
      if (list) list.push(ev);
      else map.set(ev.venueId, [ev]);
    }
    return map;
  }, [events]);

  const selectedDayVenueIds = useMemo(() => {
    const set = new Set<string>();
    for (const ev of events) {
      if (ev.date === selectedDate) set.add(ev.venueId);
    }
    return set;
  }, [events, selectedDate]);

  const focusedVenue = useMemo(
    () => (focusedVenueId ? venues.find((v) => v.id === focusedVenueId) || null : null),
    [venues, focusedVenueId]
  );

  // Clear focused card if venue gets filtered out
  useEffect(() => {
    if (focusedVenueId && !venues.some((v) => v.id === focusedVenueId)) {
      setFocusedVenueId(null);
    }
  }, [venues, focusedVenueId]);

  function fitVenuesInView(animate = true) {
    const map = mapRef.current;
    if (!map) return;
    if (venues.length === 0) {
      map.setView([wardCenter.lat, wardCenter.lng], 12, { animate });
      return;
    }
    const pts: L.LatLngExpression[] = [
      [wardCenter.lat, wardCenter.lng],
      ...venues.map((v) => displayCoords.get(v.id) || ([v.lat, v.lng] as [number, number])),
    ];
    const bounds = L.latLngBounds(pts);
    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 14, animate });
  }

  // Initialize Leaflet map once
  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, {
      center: [wardCenter.lat, wardCenter.lng],
      zoom: 12,
      minZoom: 10,
      maxZoom: 18,
      zoomControl: false,
      preferCanvas: false,
    });

    L.control.zoom({ position: 'topright' }).addTo(map);

    ringsLayerRef.current = L.layerGroup().addTo(map);
    markersLayerRef.current = L.layerGroup().addTo(map);

    map.on('click', () => {
      setFocusedVenueId(null);
    });

    mapRef.current = map;

    // Ensure proper tile sizing if container settles after layout
    const timer = window.setTimeout(() => map.invalidateSize(), 60);

    return () => {
      window.clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      ringsLayerRef.current = null;
      markersLayerRef.current = null;
      hasFittedRef.current = false;
    };
  }, [wardCenter.lat, wardCenter.lng]);

  // Swap basemap tile layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }
    const spec = TILE_LAYERS[basemap];
    tileLayerRef.current = L.tileLayer(spec.url, {
      attribution: spec.attribution,
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);
  }, [basemap]);

  // Render Ward 1 center + optional distance rings
  useEffect(() => {
    const layer = ringsLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    if (showRings) {
      const ringMiles = [2, 4, 6, 8, 10].filter((m) => m <= Math.max(maxDistance, 2));
      if (!ringMiles.includes(maxDistance)) ringMiles.push(maxDistance);

      for (const mi of ringMiles) {
        const isMax = Math.abs(mi - maxDistance) < 0.01;
        L.circle([wardCenter.lat, wardCenter.lng], {
          radius: mi * MILES_TO_METERS,
          color: isMax
            ? basemap === 'dark'
              ? 'rgba(255, 122, 26, 0.48)'
              : 'rgba(234, 88, 12, 0.5)'
            : basemap === 'dark'
            ? 'rgba(255, 255, 255, 0.14)'
            : 'rgba(15, 23, 42, 0.16)',
          weight: isMax ? 1.75 : 1,
          dashArray: isMax ? '6 5' : '4 6',
          fillColor: isMax ? '#ff7a1a' : 'transparent',
          fillOpacity: isMax ? 0.035 : 0,
          interactive: false,
        }).addTo(layer);

        // North-edge distance label on the ring
        const latOffset = mi / 69.05;
        L.marker([wardCenter.lat + latOffset, wardCenter.lng], {
          interactive: false,
          icon: L.divIcon({
            className: `map-ring-label ${basemap === 'streets' ? 'light' : ''} ${isMax ? 'is-max' : ''}`,
            html: `<span>${mi} mi</span>`,
            iconSize: [44, 18],
            iconAnchor: [22, 9],
          }),
        }).addTo(layer);
      }
    }

    // Ward 1 center pulse marker
    const wardIcon = L.divIcon({
      className: 'map-ward-marker',
      html: `<span class="map-ward-pulse"></span><span class="map-ward-dot"></span>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
    L.marker([wardCenter.lat, wardCenter.lng], { icon: wardIcon, zIndexOffset: 200 })
      .bindTooltip('<strong>Ward 1 Center</strong><br/>Wicker Park / Logan Square', {
        direction: 'top',
        offset: [0, -10],
        className: 'map-tooltip',
      })
      .addTo(layer);
  }, [wardCenter, maxDistance, showRings, basemap]);

  // Render venue markers
  useEffect(() => {
    const layer = markersLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    for (const v of venues) {
      const pos = displayCoords.get(v.id) || ([v.lat, v.lng] as [number, number]);
      const isSelected = selectedVenueIds.includes(v.id);
      const isFocused = focusedVenueId === v.id;
      const hasShowOnDay = selectedDayVenueIds.has(v.id);
      const count = venueCounts[v.id] || 0;

      const size = isSelected || isFocused ? 18 : hasShowOnDay ? 15 : 13;
      const icon = L.divIcon({
        className: 'map-venue-pin-wrap',
        html: `
          <span
            class="map-venue-pin ${isSelected ? 'is-selected' : ''} ${isFocused ? 'is-focused' : ''} ${hasShowOnDay ? 'has-today' : ''}"
            style="--pin-color:${v.color};width:${size}px;height:${size}px;"
          ></span>
          <span class="map-venue-tag ${basemap === 'streets' ? 'light' : ''} ${isSelected || isFocused ? 'is-active' : ''}">
            ${escapeHtml(v.shortName)}
          </span>
        `,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });

      const marker = L.marker(pos, {
        icon,
        zIndexOffset: isFocused ? 900 : isSelected ? 600 : hasShowOnDay ? 400 : 300,
      });

      marker.bindTooltip(
        `<strong>${escapeHtml(v.name)}</strong><br/>${escapeHtml(v.neighborhood)} · ${v.distanceMiles} mi · ${count} ${count === 1 ? 'show' : 'shows'}`,
        {
          direction: 'top',
          offset: [0, -10],
          className: 'map-tooltip',
        }
      );

      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        setFocusedVenueId(v.id);
      });

      marker.addTo(layer);
    }

    if (!hasFittedRef.current && venues.length > 0) {
      hasFittedRef.current = true;
      fitVenuesInView(false);
    }
  }, [venues, displayCoords, selectedVenueIds, focusedVenueId, selectedDayVenueIds, venueCounts, basemap]);

  const focusedShows = focusedVenue ? showsByVenue.get(focusedVenue.id) || [] : [];
  const focusedDayCount = focusedVenue
    ? focusedShows.filter((e) => e.date === selectedDate).length
    : 0;
  const focusedNextShows = focusedShows.slice(0, 3);
  const isFocusedSelected = focusedVenue ? selectedVenueIds.includes(focusedVenue.id) : false;

  return (
    <div className="map-view">
      <div className="map-header">
        <div>
          <h3>Chicago Venue Map</h3>
          <p>
            Showing <strong>{venues.length}</strong> {venues.length === 1 ? 'stage' : 'stages'} within{' '}
            <strong>{maxDistance} mi</strong> of Ward 1. Tap any pin to preview shows or filter.
          </p>
        </div>

        <div className="map-controls">
          <button
            type="button"
            className={`pill pill-sm ${showRings ? 'active' : ''}`}
            onClick={() => setShowRings((r) => !r)}
            title="Toggle distance rings from Ward 1"
          >
            <Radio size={13} /> Rings
          </button>
          <button
            type="button"
            className="pill pill-sm"
            onClick={() => setBasemap((b) => (b === 'dark' ? 'streets' : 'dark'))}
            title="Switch between Dark and Street map"
          >
            <Layers size={13} /> {basemap === 'dark' ? 'Streets' : 'Dark'}
          </button>
          <button
            type="button"
            className="pill pill-sm"
            onClick={() => fitVenuesInView(true)}
            title="Fit all venues in view"
          >
            <Crosshair size={13} /> Fit all
          </button>
        </div>
      </div>

      <div className="map-stage">
        <div
          ref={containerRef}
          className={`venue-leaflet-map ${basemap === 'streets' ? 'is-streets' : 'is-dark'}`}
          role="region"
          aria-label="Interactive Chicago concert venue map"
        />

        {focusedVenue && (
          <div
            className="map-venue-card"
            style={{ '--venue-color': focusedVenue.color } as React.CSSProperties}
          >
            <div className="map-venue-card-head">
              <div className="map-venue-card-title">
                <span className="dot" style={{ backgroundColor: focusedVenue.color }} />
                <div>
                  <h4>{focusedVenue.name}</h4>
                  <p>
                    {focusedVenue.neighborhood} · {focusedVenue.distanceMiles} mi from Ward 1
                    {focusedVenue.capacity ? ` · Cap ${focusedVenue.capacity.toLocaleString()}` : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-icon map-card-close"
                onClick={() => setFocusedVenueId(null)}
                aria-label="Close venue details"
              >
                <X size={16} />
              </button>
            </div>

            <div className="map-venue-card-meta">
              <span>
                <MapPin size={12} /> {focusedVenue.address}
              </span>
              <span className="map-venue-card-count">
                {venueCounts[focusedVenue.id] || 0} upcoming
                {focusedDayCount > 0 ? ` · ${focusedDayCount} on ${formatShortDate(selectedDate)}` : ''}
              </span>
            </div>

            {focusedNextShows.length > 0 && (
              <ul className="map-next-shows">
                {focusedNextShows.map((ev) => (
                  <li key={ev.id}>
                    <span className="map-next-date">{formatShortDate(ev.date)}</span>
                    <span className="map-next-artist">{ev.headliner}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="map-venue-card-actions">
              <button
                type="button"
                className={`btn ${isFocusedSelected ? 'btn-primary' : ''}`}
                onClick={() => onToggleVenue(focusedVenue.id)}
              >
                {isFocusedSelected ? <Check size={14} /> : <Plus size={14} />}
                {isFocusedSelected ? 'Filtered' : 'Filter venue'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => onFocusVenueCalendar(focusedVenue.id)}
              >
                <CalendarIcon size={14} /> View calendar
              </button>
              <a
                className="btn"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                  `${focusedVenue.name}, ${focusedVenue.address}`
                )}`}
                target="_blank"
                rel="noreferrer"
              >
                <Navigation size={14} /> Directions
              </a>
              {focusedVenue.website && (
                <a className="btn" href={focusedVenue.website} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} /> Site
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="map-legend">
        <span className="map-legend-item">
          <span className="map-legend-ward" /> Ward 1 Center
        </span>
        <span className="map-legend-item">
          <span className="dot" style={{ backgroundColor: '#f97316' }} /> Salt Shed / Elston
        </span>
        <span className="map-legend-item">
          <span className="dot" style={{ backgroundColor: '#10b981' }} /> Milwaukee Ave
        </span>
        <span className="map-legend-item">
          <span className="dot" style={{ backgroundColor: '#ec4899' }} /> West Town / Fulton
        </span>
        <span className="map-legend-item">
          <span className="dot" style={{ backgroundColor: '#8b5cf6' }} /> Pilsen / South
        </span>
        <span className="map-legend-item">
          <span className="dot" style={{ backgroundColor: '#3b82f6' }} /> North Side / Lakefront
        </span>
      </div>
    </div>
  );
}
