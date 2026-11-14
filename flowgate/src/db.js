// SQLite store using Node's built-in node:sqlite (no npm install needed).
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { ZONES, GATES, COHORTS, AREAS, DEPARTMENTS, ALL_DEPARTMENTS, INSTITUTIONS } = require('./config');
const { runOptimizer } = require('./optimizer');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.FLOWGATE_DB || path.join(DATA_DIR, 'flowgate.db');

let db;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT, usn TEXT, role TEXT, dept TEXT, year INTEGER,
  area TEXT, vehicle TEXT, cohort TEXT, institution TEXT,
  -- "today I came on my bike instead". vehicle is what they normally use; this
  -- overrides it for one date only, so plans can change without rewriting who
  -- somebody is.
  vehicle_today TEXT, vehicle_today_date TEXT,
  -- 1 for anyone added through the control room rather than the demo seed. Reset
  -- keeps these: losing a person you added live, mid-demo, would be the worst
  -- possible moment to find that out.
  added INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY, user_id INTEGER, date TEXT, vehicle TEXT, zone_id TEXT, gate_id TEXT,
  window_start TEXT, window_end TEXT, code TEXT UNIQUE, status TEXT,
  checkin_at TEXT, checkout_at TEXT, carpool_id INTEGER, created_at TEXT
);
CREATE TABLE IF NOT EXISTS carpools (
  id INTEGER PRIMARY KEY, driver_id INTEGER, area TEXT, window_start TEXT, seats INTEGER, date TEXT
);
CREATE TABLE IF NOT EXISTS carpool_members (carpool_id INTEGER, user_id INTEGER, PRIMARY KEY (carpool_id, user_id));
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, ts TEXT, gate_id TEXT, direction TEXT, vehicle_type TEXT,
  count INTEGER, source TEXT, ref TEXT
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS credits (id INTEGER PRIMARY KEY, user_id INTEGER, points INTEGER, reason TEXT, ts TEXT);
`;

const today = () => new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD

// The demo clock. A demo normally runs in the afternoon but has to look like
// the morning rush, so when demoTime is set we move the WHOLE app onto that
// clock: seeded entries, live scans and the "last 15 minutes" counters all
// agree with the time shown in the control room. Real seconds still tick by,
// so the clock advances while you present. Unset it and everything goes back
// to the real clock.
let clockOffsetMs = 0;
const nowMs = () => Date.now() + clockOffsetMs;
const now = () => new Date(nowMs()).toISOString();

function syncClock() {
  const demo = getSetting('demoTime');
  if (!demo || !/^\d{2}:\d{2}$/.test(demo)) { clockOffsetMs = 0; return; }
  const [h, m] = demo.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  clockOffsetMs = d.getTime() - Date.now();
}

// Run fn as if it happened `mins` minutes ago on the demo clock.
function minutesAgo(mins, fn) {
  const keep = clockOffsetMs;
  clockOffsetMs -= mins * 60000;
  try { return fn(); } finally { clockOffsetMs = keep; }
}

function getSetting(key, fallback = null) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? JSON.parse(r.value) : fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
}

function code() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = 'FG-';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// ---------- demo seed data (fictional people) ----------
const FIRST = ['Aarav', 'Ananya', 'Rohan', 'Diya', 'Karthik', 'Meera', 'Vikram', 'Sneha', 'Rahul', 'Pooja', 'Arjun', 'Kavya',
  'Nikhil', 'Divya', 'Siddharth', 'Ishita', 'Pranav', 'Shreya', 'Varun', 'Nandini', 'Aditya', 'Lakshmi', 'Manoj', 'Tanvi'];
const LAST = ['Rao', 'Sharma', 'Gowda', 'Iyer', 'Reddy', 'Nair', 'Hegde', 'Shetty', 'Kulkarni', 'Patil', 'Bhat', 'Murthy'];

function seed() {
  // Everyone added through the control room is carried across a reset. Their
  // bookings and credits are not: a reset is meant to give a clean morning, and
  // they can book again in one tap.
  const kept = db.prepare('SELECT * FROM users WHERE added = 1 ORDER BY id').all();
  db.exec('DELETE FROM users; DELETE FROM bookings; DELETE FROM carpools; DELETE FROM carpool_members; DELETE FROM events; DELETE FROM settings; DELETE FROM credits;');
  const ins = db.prepare("INSERT INTO users(id, name, usn, role, dept, year, area, vehicle, cohort, institution) VALUES (?,?,?,?,?,?,?,?,?,?)");
  let id = 1;
  // 48 students
  for (let i = 0; i < 48; i++) {
    const dept = DEPARTMENTS[i % DEPARTMENTS.length];
    const year = (i % 4) + 1;
    const vehicle = i % 7 === 0 ? '4W' : i % 3 === 0 ? 'NONE' : '2W';
    const usn = `1RN${String(24 - year).padStart(2, '0')}${dept.slice(0, 2)}${String(100 + i).slice(-3)}`;
    ins.run(id++, `${FIRST[i % FIRST.length]} ${LAST[(i * 5 + Math.floor(i / FIRST.length)) % LAST.length]}`, usn, 'student', dept, year, AREAS[i % AREAS.length], vehicle, `${dept}-Y${year}`, 'RNSIT');
  }
  // 12 faculty
  for (let i = 0; i < 12; i++) {
    const dept = DEPARTMENTS[i % DEPARTMENTS.length];
    ins.run(id++, `Dr. ${FIRST[(i * 3 + 5) % FIRST.length]} ${LAST[(i * 7 + 2) % LAST.length]}`, `FAC${100 + i}`, 'faculty', dept, null, AREAS[(i * 3) % AREAS.length], i % 3 === 2 ? '2W' : '4W', 'FACULTY', 'RNSIT');
  }

  // put the kept people back, after the seeded ones so ids never collide
  const insKept = db.prepare(`INSERT INTO users(id, name, usn, role, dept, year, area, vehicle, cohort, institution, added)
    VALUES (?,?,?,?,?,?,?,?,?,?,1)`);
  for (const k of kept) insKept.run(id++, k.name, k.usn, k.role, k.dept, k.year, k.area, k.vehicle, k.cohort, k.institution || 'RNSIT');

  // fictional number plates ("KA 00" is not a real RTO code) for hands-free entry demos
  db.prepare("UPDATE users SET plate = 'KA00FG' || (1000 + id) WHERE vehicle != 'NONE'").run();
  // demo credit history from earlier in the week
  const ins2 = db.prepare('INSERT INTO credits(user_id, points, reason, ts) VALUES (?,?,?,?)');
  const earlier = new Date(Date.now() - 2 * 86400000).toISOString();
  for (const u of db.prepare('SELECT id FROM users').all()) ins2.run(u.id, 10 + ((u.id * 37) % 60), 'Earlier this week (demo data)', earlier);

  const schedule = runOptimizer(COHORTS);
  setSetting('cohorts', COHORTS);
  setSetting('demoTime', '08:25'); // the whole app runs on this clock during demos; null = real clock
  syncClock();
  setSetting('schedule', schedule);
  // vehicles already parked that came in without the app (counted by gate cameras)
  const zoneBase = {};
  for (const z of ZONES) zoneBase[z.id] = Math.round(z.capacity * (z.type === 'BUS' ? 0.3 : 0.35));
  setSetting('zoneBase', zoneBase);

  // a few existing bookings so the dashboard is not empty
  const users = db.prepare("SELECT * FROM users WHERE vehicle != 'NONE'").all();
  users.slice(0, 22).forEach((u, k) => {
    const b = createBooking(u.id, { silent: true });
    // Stagger the already-arrived entries back across the last quarter hour so the
    // feed reads like a real arrival stream instead of 11 people at the same second.
    if (b && k % 2 === 0) minutesAgo(14 - (k / 2) * 1.2, () => checkIn(b.code, b.gate_id, 'seed'));
  });
  // a carpool on offer from RR Nagar
  const driver = db.prepare("SELECT * FROM users WHERE vehicle = '4W' AND role = 'student' LIMIT 1").get();
  if (driver) offerCarpool(driver.id, 3, { silent: true });
}

function init({ reset = false } = {}) {
  db = new DatabaseSync(DB_PATH);
  db.exec(SCHEMA);
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('plate')) db.exec('ALTER TABLE users ADD COLUMN plate TEXT');
  if (!cols.includes('added')) db.exec('ALTER TABLE users ADD COLUMN added INTEGER DEFAULT 0');
  if (!cols.includes('vehicle_today')) {
    db.exec('ALTER TABLE users ADD COLUMN vehicle_today TEXT');
    db.exec('ALTER TABLE users ADD COLUMN vehicle_today_date TEXT');
  }
  if (!cols.includes('institution')) {
    db.exec("ALTER TABLE users ADD COLUMN institution TEXT");
    db.exec("UPDATE users SET institution = 'RNSIT' WHERE institution IS NULL"); // everyone seeded is the engineering college
  }
  const n = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (reset || n === 0) seed();
  syncClock(); // an existing database already has a demoTime; adopt it
  return db;
}

// ---------- domain logic ----------
const pad = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const mins = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function userWindow(u) {
  // Only the engineering college gets an optimised slot, because it is the only
  // institution whose timetable FlowGate controls. Everyone else on this campus
  // arrives for a bell someone else sets, so their window is that bell, and the
  // app says so rather than inventing a slot it has no authority to assign.
  const inst = INSTITUTIONS.find((i) => i.id === (u.institution || 'RNSIT'));
  if (inst && inst.id !== 'RNSIT') {
    const a = mins(inst.arrive), l = mins(inst.leave);
    return {
      start: pad(a - 15), end: pad(a), exitStart: inst.leave, exitEnd: pad(l + 20),
      label: `${inst.name} starts at ${inst.arrive}`, fixed: true,
    };
  }
  if (u.role === 'faculty') return { start: '08:00', end: '08:40', label: 'Faculty window' };
  const schedule = getSetting('schedule');
  const a = schedule?.entry.find((e) => e.cohort === u.cohort);
  const x = schedule?.exit.find((e) => e.cohort === u.cohort);
  // A cohort with no optimised slot: a teach-out branch, or a timetable row that
  // was never imported. Give them a sane window and say plainly why it is generic,
  // rather than showing "Default" and leaving them to guess.
  return a ? { start: a.startLabel, end: a.endLabel, exitStart: x?.startLabel, exitEnd: x?.endLabel, label: `${u.cohort} slot` }
           : { start: '08:30', end: '08:50', label: `${u.cohort} is not in the timetable, so this is a general window` };
}

function zoneOccupancy() {
  const base = getSetting('zoneBase', {});
  const live = db.prepare(`SELECT zone_id, COUNT(*) AS n FROM bookings WHERE date = ? AND status = 'checked_in' GROUP BY zone_id`).all(today());
  const booked = db.prepare(`SELECT zone_id, COUNT(*) AS n FROM bookings WHERE date = ? AND status = 'booked' GROUP BY zone_id`).all(today());
  const m = Object.fromEntries(live.map((r) => [r.zone_id, r.n]));
  const bk = Object.fromEntries(booked.map((r) => [r.zone_id, r.n]));
  return ZONES.map((z) => ({
    ...z,
    camera: base[z.id] || 0,
    checkedIn: m[z.id] || 0,
    reserved: bk[z.id] || 0,
    occupied: (base[z.id] || 0) + (m[z.id] || 0),
  }));
}

function activeCarpoolFor(userId) {
  return db.prepare(`SELECT c.* FROM carpools c LEFT JOIN carpool_members m ON m.carpool_id = c.id
    WHERE c.date = ? AND (c.driver_id = ? OR m.user_id = ?) LIMIT 1`).get(today(), userId, userId);
}

function chooseZone(u, carpool) {
  const occ = zoneOccupancy();
  const free = (z) => z.capacity - z.occupied - z.reserved;
  if (u.vehicle === '4W' && carpool && carpool.driver_id === u.id) {
    const cp = occ.find((z) => z.id === 'ZCP'); if (free(cp) > 0) return cp;
  }
  if (u.vehicle === '4W') {
    const id = u.role === 'faculty' ? 'Z4F' : 'Z4S';
    const z = occ.find((x) => x.id === id); if (free(z) > 0) return z;
    return occ.filter((x) => x.type === '4W' && free(x) > 0).sort((a, b) => free(b) - free(a))[0];
  }
  // 2W: least utilised 2W zone (spreads load across both gates)
  return occ.filter((x) => x.type === '2W' && free(x) > 0).sort((a, b) => (a.occupied + a.reserved) / a.capacity - (b.occupied + b.reserved) / b.capacity)[0];
}

function createBooking(userId, { silent = false } = {}) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!u) throw new Error('Unknown user');
  const veh = vehicleOf(u);
  if (veh === 'NONE') throw new Error('You are not driving today. Join a carpool, or switch back to your vehicle.');
  const existing = db.prepare("SELECT * FROM bookings WHERE user_id = ? AND date = ? AND status != 'cancelled'").get(userId, today());
  if (existing) return existing;
  const carpool = activeCarpoolFor(userId);
  const zone = chooseZone({ ...u, vehicle: veh }, carpool);
  if (!zone) throw new Error('All parking zones are full. Please use the college bus or a carpool.');
  const w = userWindow(u);
  const c = code();
  db.prepare(`INSERT INTO bookings(user_id, date, vehicle, zone_id, gate_id, window_start, window_end, code, status, carpool_id, created_at)
    VALUES (?,?,?,?,?,?,?,?, 'booked', ?, ?)`).run(userId, today(), veh, zone.id, zone.gate, w.start, w.end, c, carpool?.id ?? null, now());
  return db.prepare('SELECT * FROM bookings WHERE code = ?').get(c);
}

function cancelBooking(id) {
  db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ? AND status = 'booked'").run(id);
}

function logEvent(gateId, direction, vehicleType, count, source, ref = null) {
  db.prepare('INSERT INTO events(ts, gate_id, direction, vehicle_type, count, source, ref) VALUES (?,?,?,?,?,?,?)')
    .run(now(), gateId, direction, vehicleType, count, source, ref);
}

const minOf = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

function checkIn(codeStr, gateId, source = 'qr') {
  const b = db.prepare('SELECT b.*, u.name, u.usn, u.role FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.code = ?').get(codeStr.trim().toUpperCase());
  if (!b) return { ok: false, result: 'denied', message: 'Invalid pass. No booking found for this code.' };
  if (b.date !== today()) return { ok: false, result: 'denied', message: 'This pass is not valid today.' };
  if (b.status === 'cancelled') return { ok: false, result: 'denied', message: 'This booking was cancelled.' };
  const zone = ZONES.find((z) => z.id === b.zone_id);
  if (b.status === 'booked') {
    db.prepare("UPDATE bookings SET status = 'checked_in', checkin_at = ? WHERE id = ?").run(now(), b.id);
    logEvent(gateId, 'in', b.vehicle, 1, source, b.code);
    // Slot timing stays pinned to the demo time, not the ticking clock. A demo runs
    // for several minutes, and we do not want every scan to drift into "late".
    const demo = getSetting('demoTime');
    const d = new Date(nowMs());
    const nowMin = demo && /^\d{2}:\d{2}$/.test(demo) ? minOf(demo) : d.getHours() * 60 + d.getMinutes();
    let timing = 'on time';
    if (nowMin < minOf(b.window_start)) timing = `${minOf(b.window_start) - nowMin} min before slot`;
    else if (nowMin > minOf(b.window_end)) timing = `${nowMin - minOf(b.window_end)} min after slot`;
    const wrongGate = gateId !== b.gate_id;
    let earned = 0;
    if (source !== 'seed') {
      if (timing === 'on time') { award(b.user_id, 10, 'Arrived in your slot'); earned += 10; }
      if (b.carpool_id) {
        const cp = db.prepare('SELECT * FROM carpools WHERE id = ?').get(b.carpool_id);
        const riders = db.prepare('SELECT COUNT(*) AS n FROM carpool_members WHERE carpool_id = ?').get(b.carpool_id).n;
        if (cp && cp.driver_id === b.user_id && riders) { award(b.user_id, 5 * riders, `Carpool driver, ${riders} rider(s)`); earned += 5 * riders; }
      }
    }
    return {
      earned,
      ok: true, result: 'entry', name: b.name, usn: b.usn, vehicle: b.vehicle, zone: zone.name, zoneId: zone.id,
      gate: b.gate_id, gateName: GATES.find((g) => g.id === b.gate_id)?.name || b.gate_id, wrongGate, timing,
      // The guard reads this out, so it says the gate's name, not its code.
      message: `Welcome ${b.name}. Proceed to ${zone.name}.`,
    };
  }
  if (b.status === 'checked_in') {
    db.prepare("UPDATE bookings SET status = 'checked_out', checkout_at = ? WHERE id = ?").run(now(), b.id);
    logEvent(gateId, 'out', b.vehicle, 1, source, b.code);
    return { ok: true, result: 'exit', name: b.name, usn: b.usn, vehicle: b.vehicle, zone: zone.name, zoneId: zone.id, message: `Goodbye ${b.name}. Exit recorded.` };
  }
  return { ok: false, result: 'denied', message: 'This pass was already used for entry and exit today.' };
}

function award(userId, points, reason) {
  db.prepare('INSERT INTO credits(user_id, points, reason, ts) VALUES (?,?,?,?)').run(userId, points, reason, now());
}

const BADGES = [[300, 'Flow Champion'], [150, 'Gold Commuter'], [75, 'Silver Commuter'], [0, 'Bronze Commuter']];
function creditsFor(userId) {
  const total = db.prepare('SELECT COALESCE(SUM(points), 0) AS p FROM credits WHERE user_id = ?').get(userId).p;
  const recent = db.prepare('SELECT points, reason, ts FROM credits WHERE user_id = ? ORDER BY id DESC LIMIT 5').all(userId);
  const badge = BADGES.find(([min]) => total >= min)[1];
  const next = [...BADGES].reverse().find(([min]) => min > total);
  return { total, badge, next: next ? { badge: next[1], need: next[0] - total } : null, recent, perks: total >= 150 ? 'Priority parking unlocked' : `Priority parking at 150 points` };
}
function leaderboard() {
  const depts = db.prepare(`SELECT u.dept, COUNT(DISTINCT u.id) AS people, COALESCE(SUM(c.points), 0) AS points
    FROM users u LEFT JOIN credits c ON c.user_id = u.id WHERE u.role = 'student' GROUP BY u.dept`).all()
    .map((r) => ({ ...r, perHead: Math.round(r.points / Math.max(1, r.people)) }))
    .sort((a, b) => b.perHead - a.perHead);
  return { depts };
}

// Hands-free entry: a plate camera (ANPR) reads a number plate and we check in that user's booking.
const normPlate = (p) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function plateEntry(plate, gateId, source = 'plate') {
  const u = db.prepare('SELECT * FROM users WHERE plate = ?').get(normPlate(plate));
  if (!u) return { ok: false, result: 'denied', message: 'Plate not registered with FlowGate. Guard checks manually.' };
  const b = db.prepare("SELECT * FROM bookings WHERE user_id = ? AND date = ? AND status IN ('booked','checked_in') ORDER BY id DESC LIMIT 1").get(u.id, today());
  if (!b) return { ok: false, result: 'denied', message: `Plate recognised but no parking booking today. Guard checks manually.` };
  return { ...checkIn(b.code, gateId, source), plate: fmtPlate(u.plate) };
}
const fmtPlate = (p) => (p ? `${p.slice(0, 2)} ${p.slice(2, 4)} ${p.slice(4, 6)} ${p.slice(6)}` : '');

// ---------- adding people from the control room ----------
// In a real deployment the college exports its roster once and it is imported
// here. For a demo, the same form adds one person on the spot.

const VEHICLES = ['2W', '4W', 'NONE'];

// Tidy a typed name without mangling it. Only all-lowercase words get a capital,
// so "abhi" becomes "Abhi" while "McDonald" and "d'Souza" are left alone.
function tidyName(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 60)
    .split(' ')
    .map((w) => (w && w === w.toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function addPerson(p) {
  const name = tidyName(p.name);
  if (!name) throw new Error('Name is required');
  const role = p.role === 'faculty' ? 'faculty' : 'student';
  // Six institutions share this campus, so a person belongs to one of them.
  // Anything unrecognised falls back to the engineering college.
  const inst = INSTITUTIONS.find((i) => i.id === String(p.institution || '').toUpperCase()) || INSTITUTIONS[0];
  const isEng = inst.id === 'RNSIT';
  const vehicle = VEHICLES.includes(p.vehicle) ? p.vehicle : '2W';
  const area = AREAS.includes(p.area) ? p.area : AREAS[0];
  // Department and year only mean something for the engineering college, because
  // that is the only one whose cohorts the optimizer schedules.
  const dept = isEng ? (ALL_DEPARTMENTS.includes(p.dept) ? p.dept : DEPARTMENTS[0]) : null;
  const year = isEng && role === 'student' ? Math.min(4, Math.max(1, Number(p.year) || 1)) : null;
  const cohort = isEng ? (role === 'student' ? `${dept}-Y${year}` : 'FACULTY') : inst.id;

  const next = (db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM users').get().m) + 1;
  const usn = String(p.usn || '').trim().toUpperCase()
    || (isEng && role === 'student' ? `1RN${String(24 - year).padStart(2, '0')}${dept.slice(0, 2)}${String(900 + next).slice(-3)}`
      : role === 'faculty' ? `FAC${900 + next}`
      : `${inst.id.slice(0, 3)}${900 + next}`);
  if (db.prepare('SELECT 1 FROM users WHERE usn = ?').get(usn)) throw new Error(`${usn} already exists`);

  db.prepare(`INSERT INTO users(id, name, usn, role, dept, year, area, vehicle, cohort, institution, added, plate)
    VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`)
    .run(next, name, usn, role, dept, year, area, vehicle, cohort, inst.id,
      vehicle === 'NONE' ? null : `KA00FG${1000 + next}`);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(next);
}

// CSV: name,usn,institution,role,dept,year,vehicle,area  (a header row is optional)
function importPeople(text) {
  const lines = String(text || '').trim().split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error('Nothing to import');
  const head = lines[0].toLowerCase();
  const cols = /name/.test(head) && /role|dept|vehicle|institution|usn/.test(head)
    ? lines.shift().split(',').map((s) => s.trim().toLowerCase())
    : ['name', 'usn', 'institution', 'role', 'dept', 'year', 'vehicle', 'area'];
  const added = []; const failed = [];
  for (const line of lines) {
    const v = line.split(',').map((s) => s.trim());
    const row = Object.fromEntries(cols.map((c, i) => [c, v[i]]));
    try { added.push(addPerson(row)); } catch (e) { failed.push({ line, reason: e.message }); }
  }
  return { added: added.length, failed };
}

function removePerson(id) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
  if (!u) throw new Error('No such person');
  if (!u.added) throw new Error('That one came with the demo data, so it cannot be removed here');
  db.prepare('DELETE FROM bookings WHERE user_id = ?').run(u.id);
  db.prepare('DELETE FROM credits WHERE user_id = ?').run(u.id);
  db.prepare('DELETE FROM carpool_members WHERE user_id = ?').run(u.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  return { ok: true, removed: u.name };
}

function clearAddedPeople() {
  const ids = db.prepare('SELECT id FROM users WHERE added = 1').all().map((r) => r.id);
  for (const id of ids) removePerson(id);
  return { ok: true, removed: ids.length };
}
function plates() {
  return db.prepare(`SELECT u.plate, u.name, b.status FROM users u LEFT JOIN bookings b ON b.user_id = u.id AND b.date = ? AND b.status IN ('booked','checked_in')
    WHERE u.plate IS NOT NULL ORDER BY (b.status IS NULL), u.name LIMIT 40`).all(today()).map((r) => ({ ...r, display: fmtPlate(r.plate) }));
}

function cameraCount(gateId, direction, vehicleType, count, source = 'camera') {
  logEvent(gateId, direction, vehicleType, count, source === 'simulated' ? 'simulated' : 'camera');
  // attribute camera-counted vehicles to the nearest zone of that type
  const base = getSetting('zoneBase', {});
  const z = ZONES.find((x) => x.gate === gateId && x.type === vehicleType && x.id !== 'ZCP') || ZONES.find((x) => x.type === vehicleType && x.id !== 'ZCP');
  if (z) {
    base[z.id] = Math.max(0, Math.min(z.capacity, (base[z.id] || 0) + (direction === 'in' ? count : -count)));
    setSetting('zoneBase', base);
  }
}

// What this person is actually arriving in today. `vehicle` is what they normally
// use; `vehicle_today` overrides it for one date, so a plan can change without
// rewriting the person.
function vehicleOf(u) {
  return u.vehicle_today && u.vehicle_today_date === today() ? u.vehicle_today : u.vehicle;
}

// A rider changes their mind and wants their own parking back.
function leaveCarpool(userId) {
  const cp = activeCarpoolFor(userId);
  if (!cp) throw new Error('You are not in a carpool today');
  if (cp.driver_id === userId) throw new Error('You are the driver. Withdraw the offer instead.');
  db.prepare('DELETE FROM carpool_members WHERE carpool_id = ? AND user_id = ?').run(cp.id, userId);
  // The 10 points were for sharing a ride that is no longer happening.
  award(userId, -10, 'Left a carpool');
  const driver = db.prepare('SELECT name FROM users WHERE id = ?').get(cp.driver_id);
  return { ok: true, driver: driver?.name || 'the driver' };
}

// The driver cannot come after all. Riders must not silently lose their ride, so
// they are released and their bookings restored to them to redo.
function withdrawCarpool(driverId) {
  const cp = db.prepare('SELECT * FROM carpools WHERE driver_id = ? AND date = ?').get(driverId, today());
  if (!cp) throw new Error('You are not offering a carpool today');
  const riders = db.prepare(`SELECT u.id, u.name FROM carpool_members m JOIN users u ON u.id = m.user_id
    WHERE m.carpool_id = ?`).all(cp.id);
  for (const r of riders) award(r.id, -10, 'Carpool withdrawn by the driver');
  db.prepare('DELETE FROM carpool_members WHERE carpool_id = ?').run(cp.id);
  db.prepare('DELETE FROM carpools WHERE id = ?').run(cp.id);
  award(driverId, -5, 'Withdrew a carpool offer');
  // The driver loses the priority bay and goes back to an ordinary car space.
  const b = db.prepare("SELECT * FROM bookings WHERE user_id = ? AND date = ? AND status = 'booked'").get(driverId, today());
  if (b) {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(driverId);
    const z = chooseZone({ ...u, vehicle: vehicleOf(u) }, null);
    if (z) db.prepare('UPDATE bookings SET zone_id = ?, gate_id = ?, carpool_id = NULL WHERE id = ?').run(z.id, z.gate, b.id);
  }
  return { ok: true, released: riders.map((r) => r.name) };
}

// "I said I was driving, but today I am on my bike."
function setVehicleToday(userId, vehicle) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!u) throw new Error('Unknown student');
  if (!VEHICLES.includes(vehicle)) throw new Error('Pick two-wheeler, car, or not driving');
  const cp = activeCarpoolFor(userId);
  // Refuse the changes that would quietly break somebody else's morning.
  if (cp && cp.driver_id === userId && vehicle !== '4W') {
    const n = db.prepare('SELECT COUNT(*) AS n FROM carpool_members WHERE carpool_id = ?').get(cp.id).n;
    throw new Error(n ? `You are driving ${n} rider(s) today. Withdraw the carpool first.`
                      : 'You are offering a carpool. Withdraw it first.');
  }
  if (cp && cp.driver_id !== userId && vehicle !== 'NONE') {
    throw new Error('You are riding in someone else\'s carpool. Leave it first.');
  }
  db.prepare('UPDATE users SET vehicle_today = ?, vehicle_today_date = ? WHERE id = ?').run(vehicle, today(), userId);
  // The old booking was for the old vehicle, so it cannot stand.
  const b = db.prepare("SELECT * FROM bookings WHERE user_id = ? AND date = ? AND status = 'booked'").get(userId, today());
  if (b) db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(b.id);
  return { ok: true, vehicle, rebook: vehicle !== 'NONE' };
}

function offerCarpool(driverId, seats = 3, opts = {}) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(driverId);
  if (!u || vehicleOf(u) !== '4W') throw new Error('Only someone arriving by car today can offer a carpool.');
  const existing = db.prepare('SELECT * FROM carpools WHERE driver_id = ? AND date = ?').get(driverId, today());
  if (existing) return existing;
  const w = userWindow(u);
  db.prepare('INSERT INTO carpools(driver_id, area, window_start, seats, date) VALUES (?,?,?,?,?)').run(driverId, u.area, w.start, seats, today());
  const cp = db.prepare('SELECT * FROM carpools WHERE driver_id = ? AND date = ?').get(driverId, today());
  if (!opts.silent) award(driverId, 5, 'Offered a carpool');
  // move the driver's existing booking to the carpool priority zone
  db.prepare("UPDATE bookings SET zone_id = 'ZCP', gate_id = 'G1', carpool_id = ? WHERE user_id = ? AND date = ? AND status = 'booked'").run(cp.id, driverId, today());
  return cp;
}

function joinCarpool(userId, carpoolId) {
  const cp = db.prepare('SELECT * FROM carpools WHERE id = ?').get(carpoolId);
  if (!cp) throw new Error('Carpool not found');
  const n = db.prepare('SELECT COUNT(*) AS n FROM carpool_members WHERE carpool_id = ?').get(carpoolId).n;
  if (n >= cp.seats) throw new Error('This carpool is full');
  const added = db.prepare('INSERT OR IGNORE INTO carpool_members(carpool_id, user_id) VALUES (?,?)').run(carpoolId, userId);
  if (added.changes) award(userId, 10, 'Joined a carpool');
  // a rider who joins no longer needs their own parking spot
  db.prepare("UPDATE bookings SET status = 'cancelled' WHERE user_id = ? AND date = ? AND status = 'booked'").run(userId, today());
  return cp;
}

function carpoolMatches(userId) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const w = userWindow(u);
  const rows = db.prepare(`SELECT c.*, d.name AS driver, d.dept AS driver_dept,
      (SELECT COUNT(*) FROM carpool_members m WHERE m.carpool_id = c.id) AS taken
    FROM carpools c JOIN users d ON d.id = c.driver_id WHERE c.date = ? AND c.driver_id != ?`).all(today(), userId);
  const myMin = minOf(w.start);
  return rows
    .map((r) => ({ ...r, sameArea: r.area === u.area, windowDiff: Math.abs(minOf(r.window_start) - myMin), seatsLeft: r.seats - r.taken }))
    .filter((r) => r.seatsLeft > 0)
    .map((r) => ({ ...r, score: (r.sameArea ? 60 : 0) + Math.max(0, 40 - r.windowDiff * 2) }))
    .sort((a, b) => b.score - a.score);
}

function me(userId) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!u) return null;
  const booking = db.prepare("SELECT * FROM bookings WHERE user_id = ? AND date = ? AND status != 'cancelled' ORDER BY id DESC LIMIT 1").get(userId, today());
  const carpool = activeCarpoolFor(userId);
  let carpoolInfo = null;
  if (carpool) {
    const members = db.prepare('SELECT u.id, u.name, u.area FROM carpool_members m JOIN users u ON u.id = m.user_id WHERE m.carpool_id = ?').all(carpool.id);
    const driver = db.prepare('SELECT id, name, area FROM users WHERE id = ?').get(carpool.driver_id);
    carpoolInfo = { ...carpool, driver, members, isDriver: carpool.driver_id === u.id };
  }
  return { user: { ...u, plateDisplay: fmtPlate(u.plate), vehicleToday: vehicleOf(u), vehicleChanged: vehicleOf(u) !== u.vehicle }, credits: creditsFor(u.id), window: userWindow(u), booking, zone: booking && ZONES.find((z) => z.id === booking.zone_id), carpool: carpoolInfo };
}

function liveStats() {
  const zones = zoneOccupancy();
  const bookings = db.prepare(`SELECT status, COUNT(*) AS n FROM bookings WHERE date = ? GROUP BY status`).all(today());
  const events = db.prepare(`SELECT e.*, u.name FROM events e LEFT JOIN bookings b ON b.code = e.ref LEFT JOIN users u ON u.id = b.user_id
    ORDER BY e.id DESC LIMIT 25`).all();
  const since = new Date(nowMs() - 15 * 60 * 1000).toISOString();
  const gateFlow = db.prepare(`SELECT gate_id, direction, source, SUM(count) AS n FROM events WHERE ts >= ? GROUP BY gate_id, direction, source`).all(since);
  const lastCamera = db.prepare(`SELECT ts, source FROM events WHERE source IN ('camera','simulated') ORDER BY id DESC LIMIT 1`).get();
  const carpools = db.prepare(`SELECT COUNT(*) AS n, (SELECT COUNT(*) FROM carpool_members m JOIN carpools c2 ON c2.id = m.carpool_id WHERE c2.date = ?) AS riders FROM carpools WHERE date = ?`).get(today(), today());
  return {
    zones,
    bookings: Object.fromEntries(bookings.map((r) => [r.status, r.n])),
    events,
    gateFlow,
    lastCameraAt: lastCamera?.ts || null,
    lastFeedSource: lastCamera?.source || null,
    // The browser's clock is the real one; ours may be the demo clock. Send ours
    // so the page measures "how long ago" against the same clock it displays.
    serverNow: now(),
    carpools,
    onCampus: zones.reduce((s, z) => s + z.occupied, 0),
    capacity: zones.reduce((s, z) => s + z.capacity, 0),
  };
}

module.exports = {
  init, seed, getSetting, setSetting, syncClock, nowMs, createBooking, cancelBooking, checkIn, cameraCount,
  addPerson, importPeople, removePerson, clearAddedPeople,
  leaveCarpool, withdrawCarpool, setVehicleToday, vehicleOf,
  offerCarpool, joinCarpool, carpoolMatches, me, liveStats, today, creditsFor, leaderboard, plateEntry, plates,
  users: () => db.prepare('SELECT * FROM users ORDER BY role DESC, name').all(),
  passes: () => db.prepare(`SELECT b.code, b.status, b.gate_id, b.zone_id, b.vehicle, u.name FROM bookings b JOIN users u ON u.id = b.user_id
    WHERE b.date = ? AND b.status IN ('booked','checked_in') ORDER BY b.id DESC LIMIT 30`).all(today()),
};
