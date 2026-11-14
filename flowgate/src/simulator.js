// Morning-peak traffic simulator (discrete, 1 tick = 1 simulated minute).
//
// Scenarios
//   baseline    today's behaviour: everyone aims at class time, 75% use the Main Gate.
//   flowgate    staggered slots + dynamic gate choice + scheduled buses. Reacts to a
//               spilling queue by sending a marshal to open a second lane.
//   predictive  flowgate + a forecast controller that looks 20 minutes ahead and acts
//               BEFORE the queue forms: dispatches the marshal early and nudges
//               students who have not left home yet to leave a little later.
//
// Days
//   normal      80% follow their slot, dry weather, nothing blocking the gate.
//   stress      60% follow their slot, rain (slower gates, more cars), and a breakdown
//               in the gate mouth from 08:15 to 08:35 that cuts the Main Gate to a
//               single lane. There is only one vehicle gate, so an incident there has
//               nowhere to divert to. That is exactly what makes seeing it early matter.
//
// Every number here is an assumption, see config.js. Runs are seeded and repeatable.

const { GATES, LANE_SPLIT, ZONES, COHORTS, MODE_SHARE, FACULTY, BUS_FLEET, SEATS_PER_BUS, ARRIVAL_SPREAD_MIN,
  DAILY_ATTENDANCE, INSTITUTIONS } = require('./config');
const { runOptimizer, toMin, toHHMM } = require('./optimizer');

const START = toMin('07:40');
const END = toMin('09:15');
const SPILLBACK_QUEUE = 40; // vehicles waiting beyond which the queue reaches the public road
const COMPLIANCE = 0.8;     // share of people who follow their FlowGate slot on a normal day (assumption)

const DAYS = {
  normal: { label: 'Normal day', compliance: COMPLIANCE, rain: false, closures: [] },
  stress: {
    label: 'Stress day: rain, 60% follow slots, gate down to one lane 08:15 to 08:35',
    compliance: 0.6, rain: true,
    // factor, not a full closure: the gate keeps working at reduced capacity. Closing
    // the only vehicle gate outright would not be a scenario, it would be a shutdown.
    closures: [{ gate: 'G1', from: toMin('08:15'), to: toMin('08:35'), factor: 0.55, reason: 'Breakdown in the gate mouth: one lane only' }],
  },
};
const RAIN = { capacityFactor: 0.8, twoWheelerToCar: 0.25 }; // assumptions
// A third, temporary lane at the Main Gate, opened by a marshal on top of the
// permanent two-wheeler lane.
// maxDeployments/restMin exist because this campus has TWO morning waves, not one:
// the school starts at 08:00 and the college at 09:00. A marshal who can only be
// sent once gets used up on the school wave and is gone when the college arrives.
// A real guard walks back and opens the lane again, so the model lets them.
const MARSHAL = { extraPerMin: 10, leadMin: 3, durationMin: 30, gate: 'G1', maxDeployments: 3, restMin: 5 };
const LANE_FROM = toMin(LANE_SPLIT.from), LANE_TO = toMin(LANE_SPLIT.to);

// When school drop-off is happening at the Main Gate, derived from the school's own
// published start times (08:00 for grades 5 to 10, 08:45 for the younger ones).
const SCHOOL_DROPOFF = [
  { from: toMin('07:40'), to: toMin('08:10') },
  { from: toMin('08:25'), to: toMin('08:55') },
];
const PREDICT = { horizon: 20, threshold: 15, nudgeShiftMin: 10, nudgeAcceptance: 0.5, nudgeCooldown: 10, nudgeSpreadMin: 8, latestArrival: toMin('08:50') }; // never push anyone past 08:50 (classes start 08:45 to 09:00)

function rng(seed) { // mulberry32, so every run of a scenario is reproducible
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function bell(mu, sd) {
  const w = []; let z = 0;
  for (let m = START; m <= END; m++) { const g = Math.exp(-((m - mu) ** 2) / (2 * sd * sd)); w.push(g); z += g; }
  return w.map((g) => g / z);
}
function uniform(a, b) {
  const w = []; const len = b - a;
  for (let m = START; m <= END; m++) w.push(m >= a && m < b ? 1 / len : 0);
  return w;
}

// Expected arrivals per minute, per vehicle type, plus walking pedestrians.
function demand(scenario, schedule, cohorts = COHORTS, day = DAYS.normal) {
  const n = END - START + 1;
  const fg = scenario !== 'baseline';
  const d = { '2W': new Array(n).fill(0), '4W': new Array(n).fill(0), BUS: new Array(n).fill(0), PED: new Array(n).fill(0) };
  const win = new Map((schedule?.entry || []).map((a) => [a.cohort, a]));
  const comp = day.compliance;
  const share2W = MODE_SHARE['2W'] * (day.rain ? 1 - RAIN.twoWheelerToCar : 1);
  const share4W = MODE_SHARE['4W'] + (day.rain ? MODE_SHARE['2W'] * RAIN.twoWheelerToCar : 0);
  for (const c of cohorts) {
    const a = win.get(c.id);
    const base = bell(toMin(c.firstClass) - 8, ARRIVAL_SPREAD_MIN);
    const w = fg && a ? uniform(a.start, a.end).map((x, k) => comp * x + (1 - comp) * base[k]) : base;
    for (let i = 0; i < n; i++) {
      const head = c.headcount * DAILY_ATTENDANCE;
      d['2W'][i] += head * share2W * w[i];
      d['4W'][i] += head * share4W * w[i] * (fg ? 0.7 : 1); // carpooling cuts cars ~30%
      d.PED[i] += head * MODE_SHARE.OTHER * w[i];
    }
  }
  const fw = fg ? uniform(toMin('08:00'), toMin('08:40')) : bell(toMin('08:40'), 7);
  const bw = fg ? uniform(toMin('07:55'), toMin('08:40')) : bell(toMin('08:45'), 4);
  for (let i = 0; i < n; i++) {
    d['4W'][i] += FACULTY.count * FACULTY.share4W * fw[i];
    d['2W'][i] += FACULTY.count * FACULTY.share2W * fw[i];
    d.BUS[i] += BUS_FLEET * bw[i];
    d.PED[i] += BUS_FLEET * SEATS_PER_BUS * bw[i] * 0.15; // bus riders crossing near the gate
  }

  // The rest of the campus. The school, the PU college and the degree college use
  // these same gates, so leaving them out would model a morning that does not exist.
  // Their start times are fixed by each institution, so FlowGate cannot stagger them
  // the way it staggers engineering cohorts; the only lever is to ask an institution
  // to move its bell, which is exactly what the campus-wide view is for.
  for (const inst of INSTITUTIONS) {
    if (inst.modelled !== 'block') continue;
    const head = inst.students * DAILY_ATTENDANCE;
    // Schools cluster harder than colleges, but not as hard as the bell suggests:
    // parents start arriving well before it and the drop-off queue trails after.
    const spread = inst.kind === 'school' ? 15 : ARRIVAL_SPREAD_MIN;
    const w = bell(toMin(inst.arrive) - 6, spread);
    for (let i = 0; i < n; i++) {
      d['2W'][i] += head * inst.mode['2W'] * w[i];
      d['4W'][i] += head * inst.mode['4W'] * w[i];
      d.BUS[i] += (head * inst.mode.BUS * w[i]) / SEATS_PER_BUS;
      d.PED[i] += head * inst.mode.OTHER * w[i];
    }
  }
  return d;
}

function poisson(lambda, r) { // Knuth for small, normal approx for large
  if (lambda <= 0) return 0;
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * (r() + r() + r() - 1.5) * 2));
  const L = Math.exp(-lambda); let k = 0, p = 1;
  do { k++; p *= r(); } while (p > L);
  return k - 1;
}

class Simulator {
  constructor(scenario = 'baseline', schedule = null, seed = 42, cohorts = COHORTS, dayKey = 'normal') {
    this.scenario = scenario;
    this.fg = scenario !== 'baseline';
    this.dayKey = DAYS[dayKey] ? dayKey : 'normal';
    this.day = DAYS[this.dayKey];
    this.schedule = schedule || runOptimizer(cohorts);
    this.r = rng(seed);
    this.d = demand(scenario, this.schedule, cohorts, this.day);
    // What the booking system expects: normal-day behaviour. The forecaster never sees the
    // true stress-day demand (lower compliance, rain mode shift), only this plan.
    this.plan = demand(scenario, this.schedule, cohorts, DAYS.normal);
    this.reactiveTrigger = SPILLBACK_QUEUE; // queue size at which the reactive scenario sends the marshal
    this.minute = START;
    this.done = false;
    this.crossingHold = {}; // gateId -> minutes of pedestrian-only crossing left
    this.gates = Object.fromEntries(GATES.map((g) => [g.id, { id: g.id, name: g.name, queue: 0, qt: { '2W': 0, '4W': 0, BUS: 0 }, arrivals: 0, processed: 0, maxQueue: 0, conflict: 0, closed: false }]));
    this.zones = Object.fromEntries(ZONES.map((z) => [z.id, { id: z.id, occupied: 0, capacity: z.capacity }]));
    this.history = { labels: [], arrivals: [], queueG1: [], queueG3: [] };
    this.totals = { processed: 0, queueMinutes: 0, spillbackMinutes: 0, peakQueue: 0, maxWaitMin: 0, peakConflict: 0, conflictSum: 0 };
    this.alerts = [];
    this.marshal = null;            // { from, to } minutes when the extra lane is open
    this.actions = { marshalAt: null, marshalTimes: [], nudges: 0, nudgedPeople: 0 };
    this.nudgedUntil = START - 1;   // minutes up to which demand has already been nudged
    this.lastNudge = -Infinity;
    this.forecast = null;           // predicted queue for the next PREDICT.horizon minutes
    this.trigger = null;            // the forecast that made the controller act: { at, forecast }
  }

  closedAt(gateId, m) { return this.day.closures.some((c) => c.gate === gateId && m >= c.from && m < c.to && !c.factor); }
  // An incident that slows the gate rather than shutting it: returns the multiplier.
  incidentFactor(gateId, m, known = false) {
    const c = this.day.closures.find((x) => x.gate === gateId && x.factor && m >= x.from && m < x.to
      && (!known || x.from <= this.minute));
    return c ? c.factor : 1;
  }

  // known=true: only incidents that have already started count (what a forecaster can know)
  capacity(g, m, known = false) {
    if (known ? this.day.closures.some((c) => c.gate === g.id && !c.factor && c.from <= this.minute && m >= c.from && m < c.to)
              : this.closedAt(g.id, m)) return 0;
    let cap = g.capacityPerMin * (this.day.rain && g.id !== 'G3' ? RAIN.capacityFactor : 1);
    // We deliberately do NOT slow the gate down for school drop-off. It would be an
    // easy assumption to make, but our own footage was shot from 08:44 to 08:54,
    // which is inside the junior school's drop-off window, and the Main Gate was
    // clearing 33 vehicles a minute and flowing freely. Our measurement beats our
    // intuition, so the penalty is not applied. See docs/measured/.

    // The only structural capacity on offer: a dedicated two-wheeler lane through the
    // same gate mouth, staffed across the peak. Four in five vehicles are scooters, so
    // taking them out from behind the turning cars is where the gain comes from.
    if (this.fg && g.id === 'G1' && m >= LANE_FROM && m < LANE_TO) cap += LANE_SPLIT.extraPerMin;
    // A marshal adds a third, temporary lane on top when a queue is coming.
    if (this.marshal && g.id === MARSHAL.gate && m >= this.marshal.from && m < this.marshal.to) cap += MARSHAL.extraPerMin;
    // An incident in the gate mouth cuts whatever is running at the time.
    return cap * this.incidentFactor(g.id, m, known);
  }

  // There is one vehicle gate, so there is nothing to choose between. Buses use the
  // bus bay. Kept as a function because the rest of the model asks per vehicle, and
  // because a second entrance, if one is ever built, belongs exactly here.
  pickGate(type) { return type === 'BUS' ? 'G3' : 'G1'; }

  park(type, gateId, n) {
    const zs = ZONES.filter((z) => z.type === type && z.id !== 'ZCP');
    const pref = this.fg
      ? [...zs].sort((a, b) => (a.gate === gateId ? -1 : 1) - (b.gate === gateId ? -1 : 1))
      : (this.r() < 0.5 ? zs : [...zs].reverse()); // no guidance: drivers pick a lot at random and circle
    for (const z of pref) {
      const s = this.zones[z.id]; const room = s.capacity - s.occupied; const k = Math.min(room, n);
      s.occupied += k; n -= k; if (!n) break;
    }
    if (type === '4W' && this.fg) { // carpools fill the priority zone
      const cp = this.zones.ZCP; cp.occupied = Math.min(cp.capacity, Math.round(cp.capacity * Math.min(1, (this.minute - START) / 60)));
    }
  }

  holdForPedestrians(gateId, minutes = 2) { this.crossingHold[gateId] = minutes; }

  dispatchMarshal(leadMin) {
    const m = this.minute;
    // Busy right now, or still walking back: cannot be sent again yet.
    if (this.marshal && m < this.marshal.to + MARSHAL.restMin) return false;
    if (this.actions.marshalTimes.length >= MARSHAL.maxDeployments) return false;
    this.marshal = { from: m + leadMin, to: m + leadMin + MARSHAL.durationMin };
    this.actions.marshalTimes.push(toHHMM(m));
    if (!this.actions.marshalAt) this.actions.marshalAt = toHHMM(m); // first time out
    return true;
  }

  // Predict the combined car/bike queue at the open gates for the next horizon minutes,
  // using the expected arrivals (what the booking system knows) and known capacity.
  predictQueue() {
    const vehGates = GATES.filter((g) => g.id !== 'G3');
    let q = vehGates.reduce((s, g) => s + this.gates[g.id].queue, 0);
    const out = [];
    for (let k = 0; k < PREDICT.horizon; k++) {
      const m = this.minute + k; const i = m - START;
      if (i >= this.d['2W'].length) break;
      const cap = vehGates.reduce((s, g) => s + this.capacity(g, m, true), 0);
      q = Math.max(0, q + this.plan['2W'][i] + this.plan['4W'][i] - cap);
      out.push(+q.toFixed(1));
    }
    return out;
  }

  // Shift a share of not-yet-departed arrivals in [from, to) later by shiftMin (app push: "leave 10 min later").
  nudge(fromMin, toMin_) {
    const n = this.d['2W'].length; let moved = 0;
    const vehGates = GATES.filter((g) => g.id !== 'G3');
    // Spare capacity AT that minute, not at the minute we happen to be standing in.
    const spareAt = (j) => Math.max(0,
      vehGates.reduce((a, g) => a + this.capacity(g, START + j, true), 0)
      - (this.plan['2W'][j] + this.plan['4W'][j]));
    const lo = Math.max(fromMin, this.nudgedUntil + 1);
    for (let m = lo; m < toMin_; m++) {
      const i = m - START;
      if (i < 0) continue;
      // Only drain a minute that is genuinely over capacity. Asking riders to shift
      // out of a minute the gate can already handle moves people for nothing, and once
      // a marshal is on the lane it actively hurts, because it pushes riders past the
      // window where that extra capacity exists.
      if (spareAt(i) > 0) continue;
      // Candidate arrival minutes with genuine room, EARLIER as well as later.
      // This campus has two waves: the school at 08:00 and the college at 09:00.
      // "Leave ten minutes later" can therefore push a rider straight into the
      // bigger wave, and the quiet stretch is often just before it. So look both
      // ways, and only move people into minutes that actually have spare capacity.
      const slots = [];
      for (let k = -PREDICT.nudgeSpreadMin; k <= PREDICT.nudgeShiftMin + PREDICT.nudgeSpreadMin; k++) {
        if (Math.abs(k) < 3) continue;            // a two-minute nudge is not worth sending
        const j = i + k, at = m + k;
        if (j < 0 || j >= n) continue;
        if (at > PREDICT.latestArrival) continue; // never ask anyone to miss their class
        if (at < this.minute + 2) continue;       // cannot move someone into the past
        const s = spareAt(j);
        if (s > 0.5) slots.push({ j, s });
      }
      if (!slots.length) continue;
      // Never move more people than the target minutes can absorb. Moving a crowd
      // into a full minute is what made this worse than doing nothing.
      const room = slots.reduce((a, x) => a + x.s, 0);
      const wanted = (this.d['2W'][i] + this.d['4W'][i]) * PREDICT.nudgeAcceptance;
      if (wanted <= 0) continue;
      const frac = Math.min(1, room / wanted) * PREDICT.nudgeAcceptance;
      for (const t of ['2W', '4W', 'PED']) {
        const x = this.d[t][i] * frac;
        const y = this.plan[t][i] * frac; // the plan learns about the nudge too
        this.d[t][i] -= x;
        this.plan[t][i] -= y;
        for (const { j, s } of slots) { this.d[t][j] += x * (s / room); this.plan[t][j] += y * (s / room); }
        if (t !== 'PED') moved += x;
      }
    }
    this.nudgedUntil = Math.max(this.nudgedUntil, toMin_ - 1);
    return Math.round(moved);
  }

  control(newAlerts) {
    if (this.scenario === 'flowgate') { // reactive: act once the queue is already on the road
      const q = this.gates.G1.queue;
      if (q > this.reactiveTrigger && this.dispatchMarshal(MARSHAL.leadMin)) {
        newAlerts.push({ level: 'warn', gate: 'G1', text: `Queue already ${q}: marshal sent to open a second lane at Main Gate (arrives in ${MARSHAL.leadMin} min)` });
      }
      return;
    }
    if (this.scenario !== 'predictive') return;
    const f = this.predictQueue();
    this.forecast = f;
    const peak = Math.max(0, ...f);
    if (peak <= PREDICT.threshold) return;
    const at = toHHMM(this.minute + f.indexOf(peak));
    if (!this.trigger) this.trigger = { at: toHHMM(this.minute), forecast: f };
    if (this.dispatchMarshal(MARSHAL.leadMin)) {
      newAlerts.push({ level: 'info', gate: 'G1', text: `Forecast: ${Math.round(peak)} vehicles queued by ${at}. Marshal sent now to open a second lane at Main Gate.` });
      this.forecast = this.predictQueue();
    }
    const peak2 = Math.max(0, ...this.forecast);
    if (peak2 > PREDICT.threshold && this.minute - this.lastNudge >= PREDICT.nudgeCooldown) {
      const people = this.nudge(this.minute + 5, this.minute + PREDICT.horizon);
      if (people > 0) {
        this.lastNudge = this.minute; this.actions.nudges++; this.actions.nudgedPeople += people;
        newAlerts.push({ level: 'info', gate: 'G1', text: `Forecast still over threshold: app asked about ${people} riders who haven't left yet to leave ${PREDICT.nudgeShiftMin} min later.` });
        this.forecast = this.predictQueue();
      }
    }
  }

  step() {
    if (this.done) return null;
    const i = this.minute - START;
    const newAlerts = [];
    // a gate that has just closed sends its waiting queue round to the Main Gate
    for (const c of this.day.closures) {
      if (c.from === this.minute) {
        const s = this.gates[c.gate]; const t = this.gates.G1;
        for (const k of Object.keys(s.qt)) { t.qt[k] += s.qt[k]; s.qt[k] = 0; }
        t.queue += s.queue; s.queue = 0;
        newAlerts.push({ level: 'critical', gate: c.gate, text: `${c.reason}: closed until ${toHHMM(c.to)}` });
      }
    }
    this.control(newAlerts);
    const arrivals = { G1: { '2W': 0, '4W': 0 }, G3: { BUS: 0 } };
    let total = 0;
    for (const type of ['2W', '4W', 'BUS']) {
      const k = poisson(this.d[type][i], this.r);
      for (let j = 0; j < k; j++) { const g = this.pickGate(type); arrivals[g][type] = (arrivals[g][type] || 0) + 1; this.gates[g].queue++; this.gates[g].qt[type]++; this.gates[g].arrivals++; }
      total += k;
    }
    const ped = this.d.PED[i];
    for (const g of GATES) {
      const s = this.gates[g.id];
      s.closed = this.closedAt(g.id, this.minute);
      const held = (this.crossingHold[g.id] || 0) > 0;
      if (held) this.crossingHold[g.id]--;
      const capNow = this.capacity(g, this.minute);
      const cap = held ? 0 : Math.floor(capNow);
      const out = Math.min(s.queue, cap);
      s.queue -= out; s.processed += out; this.totals.processed += out;
      s.lastThroughput = out;
      s.waitMin = capNow ? +(s.queue / capNow).toFixed(1) : (s.queue ? 99 : 0);
      s.maxQueue = Math.max(s.maxQueue, s.queue);
      // pedestrian-vehicle conflict: vehicles moving x pedestrians sharing the gate (per 100)
      const pedShare = g.id === 'G1' ? 0.85 : 0.15; // nearly everyone walks in past the one gate
      s.conflict = held ? 0 : +((out + s.queue * 0.3) * ped * pedShare / 100).toFixed(1);
      this.totals.peakConflict = Math.max(this.totals.peakConflict, s.conflict);
      this.totals.conflictSum += s.conflict;
      this.totals.queueMinutes += s.queue;
      this.totals.peakQueue = Math.max(this.totals.peakQueue, s.queue);
      this.totals.maxWaitMin = Math.max(this.totals.maxWaitMin, Math.min(s.waitMin, 99));
      // `key` groups an ongoing condition. A gate that has been spilling onto the
      // road for 40 minutes is ONE situation, not 40 alerts: a control room that
      // prints the same line every minute buries the thing you need to act on.
      if (s.queue > SPILLBACK_QUEUE) {
        this.totals.spillbackMinutes++;
        newAlerts.push({ level: 'critical', gate: g.id, key: `spill-${g.id}`, text: `${g.name}: queue of ${s.queue} vehicles spilling onto the main road` });
      } else if (s.waitMin > 1.5) {
        newAlerts.push({ level: 'warn', gate: g.id, key: `wait-${g.id}`, text: `${g.name}: wait ${s.waitMin} min, redirect arrivals to another gate` });
      }
      if (s.conflict > 25) newAlerts.push({ level: 'critical', gate: g.id, key: `ped-${g.id}`, text: `${g.name}: high pedestrian-vehicle conflict, deploy marshal / open crossing window` });
      // vehicles that cleared the gate go to parking, in proportion to the queue's actual mix
      const q0 = out + s.queue; let rem = out;
      const order = Object.keys(s.qt).filter((t) => s.qt[t] > 0).sort((a, b) => s.qt[b] - s.qt[a]);
      order.forEach((t, idx) => {
        const k = idx === order.length - 1 ? Math.min(rem, s.qt[t]) : Math.min(rem, s.qt[t], Math.round((out * s.qt[t]) / q0));
        if (k > 0) { s.qt[t] -= k; rem -= k; this.park(t, g.id, k); }
      });
    }
    const clock = toHHMM(this.minute);
    // Fold a continuing condition into the alert already on screen: keep the time it
    // STARTED, update the wording to the latest reading, and count the minutes it has
    // been going. One-off alerts (a gate closing, a marshal dispatched) carry no key
    // and are never folded, because each is its own event.
    for (const a of newAlerts) {
      a.time = clock;
      const prev = a.key && this.alerts.find((x) => x.key === a.key);
      if (prev) {
        prev.text = a.text; prev.level = a.level; prev.minutes = (prev.minutes || 1) + 1; prev.lastTime = clock;
      } else {
        this.alerts.unshift(a);
      }
    }
    this.alerts = this.alerts.slice(0, 30);
    this.history.labels.push(clock);
    this.history.arrivals.push(total);
    this.history.queueG1.push(this.gates.G1.queue);
    this.history.queueG3.push(this.gates.G3.queue);
    this.minute++;
    if (this.minute > END) this.done = true;
    return { newAlerts };
  }

  metrics() {
    const t = this.totals;
    return {
      processed: t.processed,
      peakQueue: t.peakQueue,
      maxWaitMin: +t.maxWaitMin.toFixed(1),
      avgWaitMin: t.processed ? +(t.queueMinutes / t.processed).toFixed(2) : 0,
      spillbackMinutes: t.spillbackMinutes,
      peakConflict: +t.peakConflict.toFixed(1),
      marshalAt: this.actions.marshalAt,
      marshalTimes: this.actions.marshalTimes,
      nudgedPeople: this.actions.nudgedPeople,
    };
  }

  // Recommended gate for drivers arriving now (used by the signage page).
  recommendation() {
    const open = GATES.filter((g) => g.id !== 'G3' && !this.closedAt(g.id, this.minute));
    let best = null, bestWait = Infinity;
    for (const g of open) { const w = this.gates[g.id].queue / this.capacity(g, this.minute); if (w < bestWait) { bestWait = w; best = g; } }
    return best ? { gate: best.id, name: best.name, waitMin: +bestWait.toFixed(1) } : null;
  }

  state() {
    return {
      scenario: this.scenario,
      day: this.dayKey,
      dayLabel: this.day.label,
      clock: toHHMM(this.minute),
      done: this.done,
      progress: (this.minute - START) / (END - START),
      gates: Object.values(this.gates),
      zones: Object.values(this.zones),
      history: this.history,
      alerts: this.alerts,
      metrics: this.metrics(),
      crossingHold: this.crossingHold,
      forecast: this.forecast,
      trigger: this.trigger,
      marshal: this.marshal && { from: toHHMM(this.marshal.from), to: toHHMM(this.marshal.to), active: this.minute >= this.marshal.from && this.minute < this.marshal.to },
      recommendation: this.recommendation(),
    };
  }
}

function compare(schedule, seed = 42, cohorts = COHORTS, dayKey = 'normal') {
  const out = { day: DAYS[dayKey] ? dayKey : 'normal', dayLabel: (DAYS[dayKey] || DAYS.normal).label };
  for (const s of ['baseline', 'flowgate', 'predictive']) {
    const sim = new Simulator(s, schedule, seed, cohorts, dayKey);
    while (!sim.done) sim.step();
    out[s] = { ...sim.metrics(), history: sim.history };
  }
  const b = out.baseline, f = out.flowgate;
  out.improvement = {
    peakQueuePct: b.peakQueue ? Math.round((1 - f.peakQueue / b.peakQueue) * 100) : 0,
    maxWaitPct: b.maxWaitMin ? Math.round((1 - f.maxWaitMin / b.maxWaitMin) * 100) : 0,
    avgWaitPct: b.avgWaitMin ? Math.round((1 - f.avgWaitMin / b.avgWaitMin) * 100) : 0,
    spillbackMinutesSaved: b.spillbackMinutes - f.spillbackMinutes,
    conflictPct: b.peakConflict ? Math.round((1 - f.peakConflict / b.peakConflict) * 100) : 0,
  };
  return out;
}

module.exports = { Simulator, compare, START, END, COMPLIANCE, DAYS };
