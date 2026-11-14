// Campus map: a clean diagram of RNSIT with live occupancy and gate status.
//
// The layout is not invented. Building names, road names and the relative
// positions were read off OpenStreetMap tiles covering the campus, so
// Dr. Vishnuvardhan Road really is the arterial to the north, 23rd Cross Road
// really runs along the east side, and the central garden really is in the
// middle. Parking zones and gates are our proposed placement, not a survey.

const MAP_W = 780, MAP_H = 680;

// Where each parking zone is drawn. Ids come from src/config.js, which owns the
// names and capacities; only the geometry lives here.
const ZONE_AT = {
  Z2N: [545, 72, 186, 70],
  Z4F: [600, 372, 130, 58],
  Z2S: [430, 518, 158, 80],
  Z4S: [262, 540, 126, 58],
  ZCP: [262, 452, 126, 56],
  ZBUS: [92, 520, 136, 46],
};

// The campus is entered from RNS Farms Road, which leaves Dr. Vishnuvardhan Road
// (signed Uttarahalli Main Road) and runs south into the campus. The Main Gate sits
// at the TOP of this map, near the arterial. It is the ONLY vehicle gate: everything
// else here is internal road.
const GATE_AT = { G1: [400, 84], G3: [176, 608] };

// Real buildings, named from OpenStreetMap and Google Maps.
const BUILDINGS = [
  { r: [118, 64, 150, 54], t: 'RNSIT Admin', fill: 'var(--bld-violet)', line: 'var(--bld-violet-line)', bar: '#7c5cd6' },
  { r: [112, 150, 166, 62], t: 'CSE · ISE · CSDS', fill: 'var(--bld-navy)', line: 'var(--bld-navy-line)', bar: '#5b4bff' },
  { r: [116, 236, 152, 58], t: 'Civil & AIML', fill: 'var(--bld-teal)', line: 'var(--bld-teal-line)', bar: '#0f8f83' },
  { r: [104, 318, 142, 50], t: 'Hostel', fill: 'var(--bld-plain)', line: 'var(--bld-plain-line)' },
  { r: [596, 172, 142, 60], t: 'Mech & EEE', fill: 'var(--bld-violet)', line: 'var(--bld-violet-line)', bar: '#7c5cd6' },
  { r: [598, 296, 126, 54], t: 'MBA block', fill: 'var(--bld-plain)', line: 'var(--bld-plain-line)' },
  { r: [432, 418, 132, 54], t: 'Auditorium', fill: 'var(--bld-plain)', line: 'var(--bld-plain-line)' },
  { r: [88, 428, 152, 58], t: 'RNS Int. School', fill: 'var(--bld-amber)', line: 'var(--bld-amber-line)' },
];

function occColor(r) { return r < 0.6 ? 'var(--ok)' : r < 0.85 ? 'var(--warn)' : 'var(--bad)'; }

// Draw a zone as a grid of parking bays, filled in proportion to occupancy, so
// you can read how full it is from across the room without reading the number.
function bays(x, y, w, h, type, occupied, capacity) {
  const pad = 7, labelH = 26;
  const innerW = w - pad * 2, innerH = h - pad - labelH;
  if (innerW < 10 || innerH < 6) return '';
  const bayW = type === 'BUS' ? 26 : 11;
  const cols = Math.max(1, Math.floor(innerW / bayW));
  const rows = Math.max(1, Math.min(3, Math.floor(innerH / 9)));
  const total = cols * rows;
  const filled = Math.round(Math.max(0, Math.min(1, occupied / capacity)) * total);
  const cw = innerW / cols, ch = innerH / rows;
  const col = occColor(occupied / capacity);
  let out = '';
  for (let i = 0; i < total; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    out += `<rect x="${(x + pad + c * cw).toFixed(1)}" y="${(y + labelH + r * ch).toFixed(1)}"
      width="${(cw - 2).toFixed(1)}" height="${(ch - 2).toFixed(1)}" rx="1.5"
      fill="${i < filled ? col : 'var(--map-bay-empty)'}" opacity="${i < filled ? 0.95 : 0.5}" stroke="var(--border)" stroke-width="0.4"/>`;
  }
  return out;
}

function campusMap(cfg, { zones = {}, gates = {} } = {}) {
  const zoneSvg = cfg.zones.map((z) => {
    const g = ZONE_AT[z.id]; if (!g) return '';
    const [x, y, w, h] = g;
    const d = zones[z.id] || { occupied: 0, capacity: z.capacity };
    const col = occColor(d.occupied / d.capacity);
    return `<g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="var(--map-zone)" stroke="${col}" stroke-opacity=".45" stroke-width="1.2"/>
      ${bays(x, y, w, h, z.type, d.occupied, d.capacity)}
      <text x="${x + 7}" y="${y + 15}" style="font-size:10.5px">${z.name}</text>
      <text x="${x + w - 7}" y="${y + 15}" text-anchor="end" style="font-size:10px; fill:${col}; font-weight:700">${Math.round((d.occupied / d.capacity) * 100)}%</text>
    </g>`;
  }).join('');

  const gateSvg = cfg.gates.map((g) => {
    const p = GATE_AT[g.id]; if (!p) return '';
    const [x, y] = p;
    const d = gates[g.id] || {};
    const q = d.queue ?? 0;
    const closed = /closed/i.test(d.label || '');
    const color = d.level === 'bad' || closed || q > 40 ? 'var(--bad)' : q > 10 ? 'var(--warn)' : 'var(--ok)';
    const sub = d.label ?? (q ? `${q} queued` : 'clear');
    // Keep the caption inside the frame: gates near an edge label inwards.
    const anchor = x > MAP_W - 110 ? 'end' : x < 110 ? 'start' : 'middle';
    const tx = anchor === 'end' ? x + 17 : anchor === 'start' ? x - 17 : x;
    return `<g>
      ${q > 0 && !closed ? `<circle cx="${x}" cy="${y}" r="${14 + Math.min(26, Math.sqrt(q) * 2.5)}" fill="${color}" opacity=".16">
        <animate attributeName="r" values="${14 + Math.min(26, Math.sqrt(q) * 2.5)};${19 + Math.min(26, Math.sqrt(q) * 2.5)};${14 + Math.min(26, Math.sqrt(q) * 2.5)}" dur="1.8s" repeatCount="indefinite"/></circle>` : ''}
      <rect x="${x - 17}" y="${y - 13}" width="34" height="26" rx="5" fill="var(--map-gatehouse)" stroke="${color}" stroke-width="1.6"/>
      <rect x="${x - 11}" y="${y - 6}" width="22" height="3" rx="1.5" fill="${color}"/>
      <text x="${x}" y="${y + 9}" text-anchor="middle" style="font-size:9px; fill:${color}; font-weight:700">${g.id}</text>
      <text x="${tx}" y="${y - 20}" text-anchor="${anchor}" style="font-size:10.5px">${g.name}</text>
      <text x="${tx}" y="${y + 27}" text-anchor="${anchor}" style="font-size:9.5px; fill:var(--muted)">${sub}</text>
    </g>`;
  }).join('');

  const buildings = BUILDINGS.map(({ r, t, fill, line, bar }) => `<g>
    <rect x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" rx="8" fill="${fill}" stroke="${line}" stroke-width="1.2"/>
    ${bar ? `<rect x="${r[0]}" y="${r[1]}" width="${r[2]}" height="6" rx="3" fill="${bar}" opacity=".8"/>` : ''}
    <text x="${r[0] + r[2] / 2}" y="${r[1] + r[3] / 2 + 4}" text-anchor="middle" style="font-size:10.5px; fill:var(--text)">${t}</text>
  </g>`).join('');

  return `<div class="map-wrap">
  <svg viewBox="0 0 ${MAP_W} ${MAP_H}" role="img" aria-label="Campus map showing parking occupancy and gate status">
    <defs>
      <linearGradient id="grd" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--map-bg)"/><stop offset="100%" stop-color="var(--map-bg-2)"/>
      </linearGradient>
      <pattern id="lane" width="18" height="4" patternUnits="userSpaceOnUse">
        <rect width="9" height="1.4" y="1.3" fill="var(--map-road-line)" opacity=".75"/>
      </pattern>
    </defs>
    <rect width="${MAP_W}" height="${MAP_H}" fill="url(#grd)"/>

    <!-- The arterial along the north. Google signs it as both names on the same
         stretch, so both are shown. This is the road a queue spills onto. -->
    <rect x="0" y="0" width="${MAP_W}" height="34" fill="var(--map-road)"/>
    <rect x="0" y="16" width="${MAP_W}" height="4" fill="url(#lane)"/>
    <text x="12" y="13" style="font-size:9.5px; fill:var(--map-label); font-weight:600">DR. VISHNUVARDHAN ROAD</text>
    <text x="12" y="30" style="font-size:8.5px; fill:var(--map-label)">also signed UTTARAHALLI MAIN ROAD</text>

    <!-- 23rd Cross Road down the east side -->
    <rect x="${MAP_W - 28}" y="34" width="28" height="${MAP_H - 34}" fill="var(--map-road)"/>
    <text transform="translate(${MAP_W - 9}, ${MAP_H - 24}) rotate(-90)" style="font-size:9px; fill:var(--map-label); font-weight:600">23RD CROSS ROAD</text>

    <!-- campus boundary -->
    <rect x="40" y="46" width="${MAP_W - 108}" height="${MAP_H - 92}" rx="16" fill="none" stroke="var(--map-boundary)" stroke-dasharray="5 6" stroke-width="1.3"/>

    <!-- RNS Farms Road: the way in from the arterial, running south into campus -->
    <g fill="none" stroke="var(--map-road)" stroke-width="18" stroke-linecap="round" stroke-linejoin="round">
      <path d="M400 34 L400 614"/>
      <path d="M400 252 L560 252 L700 252"/>
      <path d="M400 560 L300 586 L176 608"/>
    </g>
    <g fill="none" stroke="var(--map-road-line)" stroke-width="1.1" stroke-dasharray="7 9" opacity=".5">
      <path d="M400 34 L400 614"/>
      <path d="M400 252 L700 252"/>
      <path d="M400 560 L300 586 L176 608"/>
    </g>
    <text transform="translate(392, 400) rotate(-90)" text-anchor="middle" style="font-size:9px; fill:var(--map-label); font-weight:600">RNS FARMS ROAD</text>

    <!-- the circular garden at the centre of campus, the one landmark everyone knows -->
    <circle cx="470" cy="330" r="62" fill="var(--map-garden)" stroke="var(--map-garden-line)" stroke-width="1.4" opacity=".9"/>
    <circle cx="470" cy="330" r="36" fill="none" stroke="var(--map-garden-line)" stroke-width="1" opacity=".7"/>
    <text x="470" y="333" text-anchor="middle" style="font-size:10px; fill:var(--map-garden-text)">Central garden</text>

    ${buildings}
    ${[[300, 150], [310, 330], [560, 440], [660, 500], [120, 610], [690, 120], [330, 640]]
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="var(--map-garden-line)" opacity=".5"/>`).join('')}

    ${zoneSvg}
    ${gateSvg}

    <!-- vehicles trickling in, so the map reads as alive -->
    <g opacity=".85">
      <circle r="3.2" fill="#ffd166"><animateMotion dur="10s" repeatCount="indefinite"
        path="M400 34 L400 252 L560 252 L700 252"/></circle>
      <circle r="3.2" fill="#7dd3fc"><animateMotion dur="11s" begin="3.5s" repeatCount="indefinite"
        path="M400 34 L400 614"/></circle>
      <circle r="3.2" fill="#fca5a5"><animateMotion dur="12s" begin="1.5s" repeatCount="indefinite"
        path="M400 34 L400 560 L300 586 L176 608"/></circle>
    </g>
  </svg>
  <p class="map-note small muted">Layout, building names and road names from OpenStreetMap. Parking zones and gates are our proposed placement, not a survey.</p>
  </div>`;
}
