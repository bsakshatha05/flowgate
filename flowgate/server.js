// FlowGate server. Core needs no npm packages: run with `node server.js` (Node 22.13+).
// Optional: `npm install` adds the Claude SDK for AI copilot answers.
try { require('node:sqlite'); } catch {
  console.error(`FlowGate needs Node.js 22.13 or newer (built-in SQLite). You have ${process.version}.\nInstall the current LTS from https://nodejs.org and run again.`);
  process.exit(1);
}
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const store = require('./src/db');
const { GATES, ZONES, COHORTS, CAMPUS, DEPARTMENTS, AREAS, INSTITUTIONS } = require('./src/config');
const { runOptimizer } = require('./src/optimizer');
const { Simulator, compare, COMPLIANCE, DAYS } = require('./src/simulator');
const copilot = require('./src/copilot');

const PORT = Number(process.env.PORT) || 4000;
const PUBLIC = path.join(__dirname, 'public');
store.init({ reset: process.argv.includes('--reset') });

// ---------- live updates (Server-Sent Events) ----------
const clients = new Set();
function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
const pushLive = () => broadcast('live', store.liveStats());

// ---------- simulator ----------
let sim = null; let simTimer = null; let simSpeed = 2; let compareCache = {};
function cohorts() { return store.getSetting('cohorts', COHORTS); }
function newSim(scenario, day) { sim = new Simulator(scenario, store.getSetting('schedule'), 42, cohorts(), day || (sim && sim.dayKey) || 'normal'); }
const simState = () => ({ ...sim.state(), running: !!simTimer, speed: simSpeed, emergency: store.getSetting('emergency') });
function stopSim() { clearInterval(simTimer); simTimer = null; }
function startSim() {
  stopSim();
  simTimer = setInterval(() => {
    const r = sim.step();
    // forecast actions in the predictive scenario are pushed to student phones as notices
    for (const a of (r && r.newAlerts) || []) if (a.level === 'info' || /closed until/.test(a.text)) broadcast('notice', { time: a.time, text: a.text, simulated: true });
    if (sim.done) stopSim();
    broadcast('sim', simState());
  }, 1000 / simSpeed);
}
newSim('baseline');

// Aggregate-only snapshot for the copilot: no names, USNs or plates.
function snapshot() {
  const live = store.liveStats(); const st = sim.state();
  const fc = st.forecast && st.forecast.length ? (() => { const m = Math.max(...st.forecast); const i = st.forecast.indexOf(m); const [h, mm] = st.clock.split(':').map(Number); const t = h * 60 + mm + i; return { vehicles: Math.round(m), at: `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` }; })() : null;
  return {
    parking: live.zones.map((z) => ({ name: z.name, type: z.type, occupied: z.occupied, capacity: z.capacity, reserved: z.reserved })),
    parkingTotals: { occupied: live.onCampus, capacity: live.capacity, pct: Math.round((live.onCampus / live.capacity) * 100) },
    passes: { inside: live.bookings.checked_in || 0, onTheWay: live.bookings.booked || 0, exited: live.bookings.checked_out || 0 },
    gateEntriesLast15Min: live.gateFlow.filter((g) => g.direction === 'in').reduce((a, g) => a + g.n, 0),
    carpools: live.carpools,
    greenCredits: store.leaderboard().depts.slice(0, 5).map((d) => ({ dept: d.dept, perHead: d.perHead })),
    emergency: store.getSetting('emergency'),
    simulation: {
      note: 'simulated peak-hour model, not live sensors', scenario: st.scenario, day: st.dayLabel, clock: st.clock,
      gates: st.gates.map((g) => ({ name: g.name, queue: g.queue, waitMin: g.waitMin ?? 0, closed: !!g.closed })),
      metrics: st.metrics, alerts: st.alerts.slice(0, 6).map((a) => ({ time: a.time, level: a.level, text: a.text })),
      forecastPeak: fc, marshal: st.marshal, recommendation: st.recommendation,
    },
  };
}

// ---------- helpers ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.ico': 'image/x-icon' };
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let s = ''; req.on('data', (c) => { s += c; if (s.length > 2e6) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); } });
  });
}
function serveStatic(req, res, pathname) {
  let p = pathname === '/' ? '/index.html' : pathname;
  if (!path.extname(p)) p += '.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

// ---------- routes ----------
const routes = {
  'GET /api/config': () => ({ campus: CAMPUS, gates: GATES, zones: ZONES, compliance: COMPLIANCE, depts: DEPARTMENTS, areas: AREAS, demoTime: store.getSetting('demoTime'),
    institutions: INSTITUTIONS.map((i) => ({ id: i.id, name: i.name, arrive: i.arrive, kind: i.kind })) }),
  'POST /api/admin/demo-time': (q, b) => { store.setSetting('demoTime', /^\d{2}:\d{2}$/.test(b.time || '') ? b.time : null); store.syncClock(); return { demoTime: store.getSetting('demoTime') }; },
  'GET /api/users': () => store.users(),
  // Managing people from the control room. In a real deployment the college
  // imports its roster once; the single-person form covers everything after that.
  'POST /api/admin/people': (q, b) => { const u = store.addPerson(b); pushLive(); return { ok: true, person: u }; },
  'POST /api/admin/people/import': (q, b) => { const r = store.importPeople(b.csv); pushLive(); return r; },
  'POST /api/admin/people/remove': (q, b) => { const r = store.removePerson(b.id); pushLive(); return r; },
  'POST /api/admin/people/clear': () => { const r = store.clearAddedPeople(); pushLive(); return r; },
  'GET /api/me': (q) => store.me(Number(q.get('userId'))) || { error: 'Unknown user' },
  'POST /api/bookings': (q, b) => { const r = store.createBooking(Number(b.userId)); pushLive(); return r; },
  'POST /api/bookings/cancel': (q, b) => { store.cancelBooking(Number(b.id)); pushLive(); return { ok: true }; },
  'GET /api/passes': () => store.passes(),
  'POST /api/gate/scan': (q, b) => { const r = store.checkIn(String(b.code || ''), b.gateId || 'G1', 'qr'); pushLive(); broadcast('scan', { ...r, gateId: b.gateId }); return r; },
  // producer endpoint for the YOLO camera counter (yolo/counter.py)
  'POST /api/counts': (q, b) => {
    const gate = GATES.find((g) => g.id === b.gateId);
    if (!gate) throw new Error('Unknown gateId');
    const type = ['2W', '4W', 'BUS'].includes(b.vehicleType) ? b.vehicleType : '2W';
    store.cameraCount(gate.id, b.direction === 'out' ? 'out' : 'in', type, Math.max(1, Math.min(50, Number(b.count) || 1)), b.source);
    pushLive();
    return { ok: true };
  },
  'GET /api/stats': () => store.liveStats(),
  'POST /api/gate/plate': (q, b) => { const r = store.plateEntry(b.plate, b.gateId || 'G1', b.source === 'camera' ? 'plate' : 'plate-sim'); pushLive(); broadcast('scan', { ...r, gateId: b.gateId }); return r; },
  'GET /api/plates': () => store.plates(),
  'GET /api/credits': (q) => store.creditsFor(Number(q.get('userId'))),
  'GET /api/leaderboard': () => store.leaderboard(),
  'POST /api/admin/emergency': (q, b) => {
    // Stamped on the store's clock, which is the demo clock when one is set, so this
    // sorts alongside gate events rather than eleven hours away from them.
    const e = b.gateId ? { gate: b.gateId, message: String(b.message || 'Emergency vehicle approaching: keep the lane clear').slice(0, 120), since: new Date(store.nowMs()).toISOString() } : null;
    store.setSetting('emergency', e); broadcast('sim', simState()); return { emergency: e };
  },
  'GET /api/copilot/status': () => copilot.status(),
  'POST /api/copilot': (q, b) => copilot.ask(b.question, snapshot()),
  'GET /api/carpool/matches': (q) => store.carpoolMatches(Number(q.get('userId'))),
  'POST /api/carpool/offer': (q, b) => { const r = store.offerCarpool(Number(b.userId), Number(b.seats) || 3); pushLive(); return r; },
  'POST /api/carpool/join': (q, b) => { const r = store.joinCarpool(Number(b.userId), Number(b.carpoolId)); pushLive(); return r; },

  'GET /api/optimizer': () => ({ cohorts: cohorts(), schedule: store.getSetting('schedule') }),
  'POST /api/optimizer/run': (q, b) => runOptimizer(b.cohorts?.length ? b.cohorts : cohorts(), b.params || {}),
  'POST /api/optimizer/apply': (q, b) => {
    const cs = b.cohorts?.length ? b.cohorts : cohorts();
    const r = runOptimizer(cs, b.params || {});
    store.setSetting('cohorts', cs); store.setSetting('schedule', r);
    compareCache = {}; stopSim(); newSim(sim.scenario);
    broadcast('schedule', { applied: true });
    return r;
  },

  'GET /api/sim': () => simState(),
  'GET /api/sim/days': () => Object.fromEntries(Object.entries(DAYS).map(([k, d]) => [k, d.label])),
  'POST /api/sim/start': (q, b) => {
    if ((b.scenario && b.scenario !== sim.scenario) || (b.day && b.day !== sim.dayKey)) newSim(b.scenario || sim.scenario, b.day);
    if (sim.done) newSim(sim.scenario);
    simSpeed = Math.max(1, Math.min(20, Number(b.speed) || simSpeed));
    startSim(); return { ok: true };
  },
  'POST /api/sim/pause': () => { stopSim(); broadcast('sim', simState()); return { ok: true }; },
  'POST /api/sim/reset': (q, b) => { stopSim(); newSim(b.scenario || sim.scenario, b.day); broadcast('sim', simState()); return { ok: true }; },
  'POST /api/sim/crossing': (q, b) => { sim.holdForPedestrians(b.gateId || 'G1', 2); return { ok: true }; },
  'GET /api/sim/compare': (q) => {
    const day = DAYS[q.get('day')] ? q.get('day') : 'normal';
    if (!compareCache[day]) compareCache[day] = compare(store.getSetting('schedule'), 42, cohorts(), day);
    return compareCache[day];
  },

  'POST /api/admin/reset': () => { store.seed(); compareCache = {}; stopSim(); newSim('baseline', 'normal'); pushLive(); return { ok: true }; },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`event: live\ndata: ${JSON.stringify(store.liveStats())}\n\n`);
    res.write(`event: sim\ndata: ${JSON.stringify(simState())}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => { clients.delete(res); clearInterval(ping); });
    return;
  }
  const handler = routes[`${req.method} ${url.pathname}`];
  if (handler) {
    try {
      const body = req.method === 'POST' ? await readBody(req) : {};
      return send(res, 200, await handler(url.searchParams, body));
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }
  if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
  console.log(`FlowGate running:  http://localhost:${PORT}`);
  if (lan) console.log(`On your phone (same wifi):  http://${lan.address}:${PORT}`);
});
