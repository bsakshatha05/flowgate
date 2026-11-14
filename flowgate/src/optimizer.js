// Staggered slot optimizer.
// Takes cohorts (dept + year, headcount, class timings) and spreads their
// vehicle arrivals (and departures) over short windows so that no window
// carries more than its fair share of gate load.

const { MODE_SHARE, GATES, LANE_SPLIT, ARRIVAL_SPREAD_MIN, DAILY_ATTENDANCE } = require('./config');

const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;

const vehiclesOf = (c) => Math.round(c.headcount * DAILY_ATTENDANCE * (MODE_SHARE['2W'] + MODE_SHARE['4W']));

// Greedy "least loaded feasible window" assignment (LPT order).
function assign(cohorts, { windowMin, earliestFor, latestFor }) {
  const load = new Map();
  const out = [];
  const sorted = [...cohorts].sort((a, b) => vehiclesOf(b) - vehiclesOf(a));
  for (const c of sorted) {
    const latestStart = latestFor(c);
    const options = [];
    for (let s = earliestFor(c); s <= latestStart; s += windowMin) options.push(s);
    if (!options.length) options.push(latestStart);
    // least loaded; tie-break on the latest window (people prefer not to come early)
    let best = options[0];
    for (const s of options) {
      const l = load.get(s) || 0, lb = load.get(best) || 0;
      if (l < lb || (l === lb && s > best)) best = s;
    }
    const v = vehiclesOf(c);
    load.set(best, (load.get(best) || 0) + v);
    out.push({ cohort: c.id, dept: c.dept, year: c.year, vehicles: v, start: best, end: best + windowMin });
  }
  return { assignments: out.sort((a, b) => a.start - b.start || a.cohort.localeCompare(b.cohort)), load };
}

// Per-minute vehicle arrival curves for baseline (everyone aims at class time)
// and staggered (uniform inside the assigned window).
function curves(cohorts, entryAssign, from, to) {
  const n = to - from + 1;
  const baseline = new Array(n).fill(0);
  const staggered = new Array(n).fill(0);
  const byId = new Map(entryAssign.map((a) => [a.cohort, a]));
  for (const c of cohorts) {
    const v = vehiclesOf(c);
    // baseline: bell curve centred 8 min before first class, sd 5 min
    const mu = toMin(c.firstClass) - 8, sd = ARRIVAL_SPREAD_MIN;
    let z = 0; const w = [];
    for (let i = 0; i < n; i++) { const x = from + i; const g = Math.exp(-((x - mu) ** 2) / (2 * sd * sd)); w.push(g); z += g; }
    for (let i = 0; i < n; i++) baseline[i] += (v * w[i]) / z;
    const a = byId.get(c.id);
    const len = a.end - a.start;
    for (let m = a.start; m < a.end; m++) { const i = m - from; if (i >= 0 && i < n) staggered[i] += v / len; }
  }
  return { baseline, staggered };
}

function runOptimizer(cohorts, opts = {}) {
  const windowMin = Number(opts.windowMin) || 10;
  const bufferMin = Number(opts.bufferMin ?? 10);
  const earliestEntry = toMin(opts.earliestEntry || '07:50');
  const exitSpreadMin = Number(opts.exitSpreadMin ?? 20);

  const entry = assign(cohorts, {
    windowMin,
    earliestFor: () => earliestEntry,
    latestFor: (c) => toMin(c.firstClass) - bufferMin - windowMin,
  });
  // Exit: each cohort leaves in a window that starts at or after its own last class,
  // spread over the following exitSpreadMin minutes.
  const exit = assign(cohorts, {
    windowMin,
    earliestFor: (c) => toMin(c.lastClass),
    latestFor: (c) => toMin(c.lastClass) + exitSpreadMin,
  });

  const from = earliestEntry - 15;
  const to = Math.max(...cohorts.map((c) => toMin(c.firstClass))) + 10;
  const { baseline, staggered } = curves(cohorts, entry.assignments, from, to);
  // Two different capacities, and conflating them is how you end up with a plan that
  // only works on paper. Today the one vehicle gate runs as a single mixed queue.
  // The higher figure is that same gate with a dedicated two-wheeler lane, which is
  // the only capacity available without building anything.
  const vehGates = GATES.filter((g) => g.types.includes('2W'));
  const gateCapacityToday = vehGates.reduce((s, g) => s + g.capacityPerMin, 0);
  const gateCapacity = gateCapacityToday + LANE_SPLIT.extraPerMin;
  const peakBefore = Math.max(...baseline);
  const peakAfter = Math.max(...staggered);
  const minutesOverBefore = baseline.filter((x) => x > gateCapacityToday).length;
  const minutesOverAfter = staggered.filter((x) => x > gateCapacity).length;

  const fmt = (a) => a.map((x) => ({ ...x, startLabel: toHHMM(x.start), endLabel: toHHMM(x.end) }));
  return {
    params: { windowMin, bufferMin, earliestEntry: toHHMM(earliestEntry), exitSpreadMin },
    totalVehicles: cohorts.reduce((s, c) => s + vehiclesOf(c), 0),
    gateCapacityPerMin: gateCapacity,
    gateCapacityTodayPerMin: gateCapacityToday,
    entry: fmt(entry.assignments),
    exit: fmt(exit.assignments),
    curve: {
      labels: baseline.map((_, i) => toHHMM(from + i)),
      baseline: baseline.map((x) => +x.toFixed(1)),
      staggered: staggered.map((x) => +x.toFixed(1)),
    },
    summary: {
      peakBefore: +peakBefore.toFixed(1),
      peakAfter: +peakAfter.toFixed(1),
      peakReductionPct: Math.round((1 - peakAfter / peakBefore) * 100),
      minutesOverCapacityBefore: minutesOverBefore,
      minutesOverCapacityAfter: minutesOverAfter,
    },
  };
}

module.exports = { runOptimizer, toMin, toHHMM, vehiclesOf };
