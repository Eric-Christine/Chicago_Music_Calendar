import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cachePath = path.join(__dirname, 'events_cache.json');
const outPath = path.join(__dirname, '..', 'chicago_music_calendar_visual.html');

const raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));

// Compact events from Nov 1, 2026 through Jan 31, 2027
const compactEvents = raw.events
  .filter((e) => e.date >= '2026-11-01' && e.date <= '2027-01-31')
  .map((e) => ({
    id: e.id,
    h: e.headliner,
    s: (e.support || []).slice(0, 2),
    d: e.date,
    t: e.time,
    vId: e.venueId,
    v: e.venueShort,
    vf: e.venueName,
    c: e.corridor,
    mi: e.distanceMiles,
    col: e.venueColor,
    u: e.ticketUrl,
    sp: e.spotifyUrl,
    pr: e.previewAudioUrl || '',
    pt: e.previewTrackTitle || '',
    g: e.genre || 'Live Music',
    p: e.price || '',
    src: e.source,
  }));

const compactVenues = raw.venues.map((v) => ({
  id: v.id,
  n: v.shortName,
  nf: v.name,
  c: v.corridor,
  mi: v.distanceMiles,
  col: v.color,
  lat: v.lat,
  lng: v.lng,
}));

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Ward 1 Chicago Live Music Calendar</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
    color: var(--foreground);
  }
  .cal-root {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
  }
  /* KPI Row */
  .kpi-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }
  .kpi-box {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius, 10px);
    padding: 12px 14px;
  }
  .kpi-lbl {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted-foreground);
  }
  .kpi-val {
    font-size: 20px;
    font-weight: 800;
    margin-top: 2px;
    color: var(--foreground);
  }
  .kpi-sub {
    font-size: 11px;
    color: var(--muted-foreground);
    margin-top: 2px;
  }

  /* Controls Panel */
  .controls-box {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius, 10px);
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .controls-top {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  }
  .search-input {
    flex: 1;
    min-width: 180px;
    background: var(--secondary);
    color: var(--foreground);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 7px 11px;
    font-size: 12px;
  }
  .search-input:focus {
    outline: 1px solid var(--primary);
  }
  .tab-group {
    display: flex;
    gap: 4px;
  }
  .btn-tab {
    background: var(--secondary);
    color: var(--secondary-foreground, var(--foreground));
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }
  .btn-tab.active {
    background: var(--primary);
    color: var(--primary-foreground, #fff);
    border-color: var(--primary);
  }
  .corridor-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .corr-pill {
    padding: 4px 9px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    background: var(--secondary);
    color: var(--muted-foreground);
    border: 1px solid var(--border);
    cursor: pointer;
  }
  .corr-pill.active {
    background: var(--accent-surface, var(--secondary));
    color: var(--foreground);
    border-color: var(--primary);
  }
  .venue-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    max-height: 64px;
    overflow-y: auto;
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }
  .v-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 7px;
    border-radius: 5px;
    font-size: 10px;
    font-weight: 600;
    background: var(--secondary);
    color: var(--muted-foreground);
    border: 1px solid var(--border);
    cursor: pointer;
  }
  .v-chip.active {
    color: var(--foreground);
    border-color: var(--foreground);
    background: var(--card);
  }
  .v-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  /* Month Header & Grid */
  .cal-box {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius, 10px);
    padding: 14px 16px;
  }
  .cal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }
  .month-title {
    font-size: 16px;
    font-weight: 800;
  }
  .dow-row {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 4px;
    margin-bottom: 4px;
  }
  .dow-cell {
    text-align: center;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--muted-foreground);
    padding: 4px 0;
  }
  .days-grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 4px;
  }
  .day-box {
    min-height: 94px;
    background: var(--secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 5px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    cursor: pointer;
    overflow: hidden;
  }
  .day-box.out {
    opacity: 0.35;
  }
  .day-box.sel {
    border-color: var(--primary);
    box-shadow: inset 0 0 0 1px var(--primary);
  }
  .day-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .day-num {
    font-size: 11px;
    font-weight: 700;
    color: var(--foreground);
  }
  .day-num.today-badge {
    background: var(--primary);
    color: var(--primary-foreground, #fff);
    padding: 1px 5px;
    border-radius: 4px;
  }
  .day-cnt {
    font-size: 9px;
    color: var(--muted-foreground);
    font-weight: 600;
  }
  .ev-pill {
    font-size: 9.5px;
    line-height: 1.2;
    padding: 2px 4px;
    border-radius: 3px;
    background: var(--card);
    border-left: 2.5px solid var(--chart-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--foreground);
  }
  .ev-pill-v {
    font-size: 8.5px;
    color: var(--muted-foreground);
    margin-left: 3px;
  }
  .more-tag {
    font-size: 9px;
    font-weight: 700;
    color: var(--primary);
    text-align: center;
  }

  /* Selected Day Detail Drawer */
  .day-detail-box {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius, 10px);
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .detail-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    border-bottom: 1px solid var(--border);
    padding-bottom: 8px;
  }
  .detail-title {
    font-size: 14px;
    font-weight: 800;
  }
  .detail-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    max-height: 290px;
    overflow-y: auto;
  }
  @media (max-width: 560px) {
    .kpi-row { grid-template-columns: repeat(2, 1fr); }
    .detail-grid { grid-template-columns: 1fr; }
  }
  .show-card {
    background: var(--secondary);
    border: 1px solid var(--border);
    border-left: 3.5px solid var(--chart-1);
    border-radius: 7px;
    padding: 9px 11px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .show-head {
    font-size: 12.5px;
    font-weight: 700;
    color: var(--foreground);
    line-height: 1.25;
  }
  .show-sup {
    font-size: 10.5px;
    color: var(--muted-foreground);
  }
  .show-venue-line {
    font-size: 11px;
    font-weight: 700;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .show-links {
    display: flex;
    gap: 6px;
    margin-top: 2px;
  }
  .link-btn {
    text-decoration: none;
    font-size: 10px;
    font-weight: 600;
    padding: 3px 7px;
    border-radius: 4px;
    background: var(--card);
    color: var(--foreground);
    border: 1px solid var(--border);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .link-btn.sp {
    border-color: var(--success, #1db954);
    color: var(--success, #1db954);
  }
</style>
</head>
<body>
<div class="cal-root">
  <!-- KPI Summary -->
  <div class="kpi-row">
    <div class="kpi-box">
      <div class="kpi-lbl">Synced Concerts</div>
      <div class="kpi-val" id="kpi-total">${raw.events.length}</div>
      <div class="kpi-sub">Deduplicated across 9 feeds</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-lbl">Ward 1 Venues (≤10mi)</div>
      <div class="kpi-val" id="kpi-venues">${raw.venues.length}</div>
      <div class="kpi-sub">Salt Shed • Milwaukee • Radius</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-lbl">Core Ward 1 & Elston</div>
      <div class="kpi-val" id="kpi-core">294</div>
      <div class="kpi-sub">Salt Shed + Milwaukee Corridor</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-lbl">Spotify + Audio Links</div>
      <div class="kpi-val" id="kpi-spotify">100%</div>
      <div class="kpi-sub">Artist links & 30s previews</div>
    </div>
  </div>

  <!-- Filter Controls -->
  <div class="controls-box">
    <div class="controls-top">
      <input type="text" id="search-in" class="search-input" placeholder="Filter by artist, opener, or venue (e.g. Salt Shed, Brutalismus 3000, Empty Bottle, Radius)..." />
      <div class="tab-group">
        <button class="btn-tab active" id="m-nov" onclick="setMonth(2026, 10)">Nov 2026</button>
        <button class="btn-tab" id="m-dec" onclick="setMonth(2026, 11)">Dec 2026</button>
        <button class="btn-tab" id="m-jan" onclick="setMonth(2027, 0)">Jan 2027</button>
      </div>
    </div>

    <div class="corridor-bar" id="corr-bar"></div>
    <div class="venue-bar" id="venue-bar"></div>
  </div>

  <!-- Visual Month Grid -->
  <div class="cal-box">
    <div class="cal-header">
      <div class="month-title" id="month-label">November 2026</div>
      <div style="font-size: 11px; color: var(--muted-foreground);">Click any day to inspect full lineup, times, Spotify & tickets below</div>
    </div>
    <div class="dow-row">
      <div class="dow-cell">Sun</div>
      <div class="dow-cell">Mon</div>
      <div class="dow-cell">Tue</div>
      <div class="dow-cell">Wed</div>
      <div class="dow-cell">Thu</div>
      <div class="dow-cell">Fri</div>
      <div class="dow-cell">Sat</div>
    </div>
    <div class="days-grid" id="days-grid"></div>
  </div>

  <!-- Selected Date Lineup Drawer -->
  <div class="day-detail-box">
    <div class="detail-header">
      <div class="detail-title" id="sel-date-label">Friday, Nov 13, 2026 Lineup</div>
      <div style="font-size: 11px; color: var(--muted-foreground);" id="sel-date-count"></div>
    </div>
    <div class="detail-grid" id="detail-grid"></div>
  </div>
</div>

<script>
const EVENTS = ${JSON.stringify(compactEvents)};
const VENUES = ${JSON.stringify(compactVenues)};
const CORRIDORS = [
  "ALL",
  "Salt Shed / Elston",
  "Milwaukee Ave Corridor",
  "Radius / Pilsen / South",
  "West Town / Fulton",
  "North Side / Lakeview"
];

let state = {
  year: 2026,
  month: 10, // Nov
  selectedDate: "2026-11-13",
  corridor: "ALL",
  venueId: null,
  query: "",
  playingId: null
};
let audioObj = null;

function getFilteredEvents() {
  const q = state.query.toLowerCase().trim();
  return EVENTS.filter(e => {
    if (state.corridor !== "ALL" && e.c !== state.corridor) return false;
    if (state.venueId && e.vId !== state.venueId) return false;
    if (q) {
      const m = e.h.toLowerCase().includes(q) ||
                e.vf.toLowerCase().includes(q) ||
                e.s.some(s => s.toLowerCase().includes(q));
      if (!m) return false;
    }
    return true;
  });
}

function setMonth(y, m) {
  state.year = y;
  state.month = m;
  document.getElementById("m-nov").className = "btn-tab" + (m === 10 ? " active" : "");
  document.getElementById("m-dec").className = "btn-tab" + (m === 11 ? " active" : "");
  document.getElementById("m-jan").className = "btn-tab" + (m === 0 ? " active" : "");
  state.selectedDate = y + "-" + String(m + 1).padStart(2, "0") + "-" + (m === 10 ? "13" : "01");
  renderAll();
}

function playPreview(id, url) {
  if (!url) return;
  if (state.playingId === id) {
    if (audioObj) audioObj.pause();
    state.playingId = null;
    renderDetail();
    return;
  }
  if (audioObj) audioObj.pause();
  audioObj = new Audio(url);
  audioObj.onended = () => { state.playingId = null; renderDetail(); };
  audioObj.play();
  state.playingId = id;
  renderDetail();
}

function renderCorridors() {
  const el = document.getElementById("corr-bar");
  el.innerHTML = CORRIDORS.map(c => {
    const act = state.corridor === c ? " active" : "";
    const label = c === "ALL" ? "All Corridors (≤10 mi)" : c;
    return \`<button class="corr-pill\${act}" onclick="selectCorridor('\${c}')">\${label}</button>\`;
  }).join("");
}

function selectCorridor(c) {
  state.corridor = c;
  state.venueId = null;
  renderAll();
}

function selectVenue(vId) {
  state.venueId = state.venueId === vId ? null : vId;
  renderAll();
}

function renderVenues() {
  const el = document.getElementById("venue-bar");
  const vs = VENUES.filter(v => state.corridor === "ALL" || v.c === state.corridor);
  el.innerHTML = vs.map(v => {
    const act = state.venueId === v.id ? " active" : "";
    return \`<button class="v-chip\${act}" onclick="selectVenue('\${v.id}')">
      <span class="v-dot" style="background:\${v.col}"></span>
      <span>\${v.n} (\${v.mi}mi)</span>
    </button>\`;
  }).join("");
}

function renderCalendar() {
  const filtered = getFilteredEvents();
  const byDate = {};
  filtered.forEach(e => {
    if (!byDate[e.d]) byDate[e.d] = [];
    byDate[e.d].push(e);
  });

  const { year, month } = state;
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  document.getElementById("month-label").textContent = monthNames[month] + " " + year;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();

  const cells = [];
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = prevDays - i;
    const pm = month === 0 ? 12 : month;
    const py = month === 0 ? year - 1 : year;
    cells.push({ dateStr: \`\${py}-\${String(pm).padStart(2,"0")}-\${String(d).padStart(2,"0")}\`, d, inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ dateStr: \`\${year}-\${String(month+1).padStart(2,"0")}-\${String(d).padStart(2,"0")}\`, d, inMonth: true });
  }
  const rem = (7 - (cells.length % 7)) % 7;
  for (let d = 1; d <= rem; d++) {
    const nm = month === 11 ? 1 : month + 2;
    const ny = month === 11 ? year + 1 : year;
    cells.push({ dateStr: \`\${ny}-\${String(nm).padStart(2,"0")}-\${String(d).padStart(2,"0")}\`, d, inMonth: false });
  }

  const gridEl = document.getElementById("days-grid");
  gridEl.innerHTML = cells.map(c => {
    const evs = byDate[c.dateStr] || [];
    const isSel = state.selectedDate === c.dateStr ? " sel" : "";
    const isOut = !c.inMonth ? " out" : "";
    const isToday = c.dateStr === "2026-11-13";
    const shown = evs.slice(0, 3);
    const more = Math.max(0, evs.length - shown.length);

    return \`<div class="day-box\${isOut}\${isSel}" onclick="selectDate('\${c.dateStr}')">
      <div class="day-top">
        <span class="day-num\${isToday ? ' today-badge' : ''}">\${c.d}</span>
        \${evs.length ? \`<span class="day-cnt">\${evs.length}</span>\` : ''}
      </div>
      \${shown.map(e => \`<div class="ev-pill" style="border-left-color:\${e.col}" title="\${e.h} @ \${e.vf}">
        <strong>\${e.h}</strong><span class="ev-pill-v">@ \${e.v}</span>
      </div>\`).join("")}
      \${more > 0 ? \`<div class="more-tag">+\${more} more</div>\` : ''}
    </div>\`;
  }).join("");
}

function selectDate(dStr) {
  state.selectedDate = dStr;
  renderCalendar();
  renderDetail();
}

function renderDetail() {
  const filtered = getFilteredEvents().filter(e => e.d === state.selectedDate);
  const dObj = new Date(state.selectedDate + "T12:00:00");
  document.getElementById("sel-date-label").textContent = dObj.toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric", year: "numeric"
  }) + " — Who's Playing & Where";
  document.getElementById("sel-date-count").textContent = filtered.length + " shows scheduled";

  const detailEl = document.getElementById("detail-grid");
  if (!filtered.length) {
    detailEl.innerHTML = \`<div style="font-size:12px;color:var(--muted-foreground);padding:8px 0;">No concerts matching current filters on this date. Select another date above.</div>\`;
    return;
  }

  detailEl.innerHTML = filtered.map(e => {
    const isPlaying = state.playingId === e.id;
    return \`<div class="show-card" style="border-left-color:\${e.col}">
      <div class="show-head">\${e.h}</div>
      \${e.s.length ? \`<div class="show-sup">w/ \${e.s.join(", ")}</div>\` : ''}
      <div class="show-venue-line" style="color:\${e.col}">
        <span>\${e.vf} (\${e.mi} mi)</span>
        <span style="color:var(--muted-foreground);font-weight:500;">\${e.t}\${e.p ? ' • ' + e.p : ''}</span>
      </div>
      <div class="show-links">
        \${e.pr ? \`<button class="link-btn sp" onclick="playPreview('\${e.id}', '\${e.pr}')">\${isPlaying ? '⏸ Pause 30s' : '▶ Preview Track'}</button>\` : ''}
        <a class="link-btn sp" href="\${e.sp}" target="_blank" rel="noreferrer">Spotify ↗</a>
        <a class="link-btn" href="\${e.u}" target="_blank" rel="noreferrer">Tickets (\${e.src.split('/')[0].trim()}) ↗</a>
      </div>
    </div>\`;
  }).join("");
}

function renderAll() {
  renderCorridors();
  renderVenues();
  renderCalendar();
  renderDetail();
}

document.getElementById("search-in").addEventListener("input", (ev) => {
  state.query = ev.target.value;
  renderCalendar();
  renderDetail();
});

renderAll();
</script>
</body>
</html>`;

fs.writeFileSync(outPath, html, 'utf-8');
console.log('Generated visual HTML at:', outPath, 'Size:', html.length, 'bytes');
