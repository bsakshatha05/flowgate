// FlowGate campus configuration.
//
// MIXED SOURCES. Read the tags before quoting anything:
//   [RNSIT]    published by the college itself (rnsit.ac.in): student and faculty
//              strength, year established, programme counts.
//   [MEASURED] counted from our own gate footage, 13 Nov 2026 (see docs/measured/).
//   [ASSUMED]  still an estimate. Replace with figures from the admin office,
//              security or the transport desk before quoting as fact.

const CAMPUS = {
  name: 'RNSIT, Channasandra, Bengaluru',
  dayStart: '07:30',
};

// Gates. capacityPerMin = vehicles a gate can clear per minute with one guard.
const GATES = [
  // THE CAMPUS HAS ONE VEHICLE GATE. There is no second gate to open, so every
  // scooter, car and staff vehicle for all six institutions passes through this one
  // mouth. That is the whole problem in one line, and it rules out the easy answer.
  //
  // [MEASURED] 33 vehicles passed in the busiest minute while still flowing freely,
  // so its real capacity is at least that. 35 is a conservative read of our footage.
  //
  // lanes: what the gate mouth is doing. Today it is one mixed queue, where a car
  // waiting to turn holds up the twenty scooters behind it. 82% of the vehicles are
  // two-wheelers (measured), so separating them is the cheapest capacity we can buy:
  // paint, two barriers and a guard, not construction. See LANE_SPLIT below.
  { id: 'G1', name: 'Main Gate', types: ['2W', '4W'], capacityPerMin: 35, lanesToday: 1 },
  { id: 'G3', name: 'Bus Bay Gate', types: ['BUS'], capacityPerMin: 2 },
];

// The one capacity lever available without building anything: give two-wheelers
// their own lane through the same gate, staffed across the morning peak.
// [ASSUMED] +12 a minute. This is the number to challenge first; it should be
// measured by marking out a second lane for one morning and counting again.
const LANE_SPLIT = { extraPerMin: 12, from: '07:45', to: '09:20' };

// Parking zones. gate = nearest gate (used for routing).
const ZONES = [
  { id: 'Z2N', name: '2W Zone North', type: '2W', capacity: 900, gate: 'G1' },
  { id: 'Z2S', name: '2W Zone South', type: '2W', capacity: 700, gate: 'G1' },
  { id: 'Z4S', name: '4W Student', type: '4W', capacity: 150, gate: 'G1' },
  { id: 'Z4F', name: '4W Faculty', type: '4W', capacity: 200, gate: 'G1' },
  { id: 'ZCP', name: 'Carpool Priority', type: '4W', capacity: 40, gate: 'G1' },
  { id: 'ZBUS', name: 'Bus Bay', type: 'BUS', capacity: 25, gate: 'G3' },
];

// Branches with fresh intake. These build the simulated cohorts.
const DEPARTMENTS = ['CSE', 'ECE', 'EEE', 'ME', 'CV', 'AIML', 'CSD', 'CY'];

// [AICTE] Branches the Oct 2025 disclosure shows at an intake of 00. That means no
// new admissions, NOT that the branch is empty: the students already in years 2 to 4
// are on campus every morning until they graduate. So they can be added as real
// people, even though they add no new cohort to the model.
const TEACH_OUT_DEPARTMENTS = ['ISE', 'EIE', 'AIDS'];

// The short codes are what USNs and cohort ids are built from, so they stay. These
// are what a human should actually read. AIDS in particular is a terrible thing to
// put in a dropdown; the programme is AI and Data Science.
const DEPARTMENT_NAMES = {
  CSE: 'Computer Science',
  ECE: 'Electronics & Communication',
  EEE: 'Electrical & Electronics',
  ME: 'Mechanical',
  CV: 'Civil',
  AIML: 'CSE (AI & Machine Learning)',
  CSD: 'CSE (Data Science)',
  CY: 'CSE (Cyber Security)',
  ISE: 'Information Science',
  EIE: 'Electronics & Instrumentation',
  AIDS: 'AI & Data Science',
};
const ALL_DEPARTMENTS = [...DEPARTMENTS, ...TEACH_OUT_DEPARTMENTS];

// Cohorts = department + year, with first class start and last class end.
// headcount is students in that cohort.
function buildCohorts() {
  // [AICTE] Sanctioned annual intake, from RNSIT's own AICTE mandatory disclosure
  // (rnsit.ac.in, dated Oct 2025). These are published, auditable numbers, not guesses:
  //   CSE 600 · ECE 180 · EEE 60 · ME 60 · Civil 60 · CSE(AI&ML) 240
  //   CSE(Data Science) 120 · CSE(Cyber Security) 60   = 1,380 a year
  // The same disclosure shows ISE, EIE and AI&DS at an intake of 00, i.e. no fresh
  // admissions, so those programmes are in teach-out and are not modelled here.
  // Four year groups at the sanctioned intake gives 5,520 UG students, which lines
  // up with the ~5,600 campus strength the college quotes elsewhere.
  const sizes = { CSE: 600, ECE: 180, EEE: 60, ME: 60, CV: 60, AIML: 240, CSD: 120, CY: 60 };
  const cohorts = [];
  for (const d of DEPARTMENTS) {
    for (let y = 1; y <= 4; y++) {
      cohorts.push({
        id: `${d}-Y${y}`,
        dept: d,
        year: y,
        headcount: sizes[d],
        // today almost everyone starts at 09:00, which is the root of the peak
        firstClass: y === 1 ? '08:45' : '09:00',
        lastClass: y >= 3 ? '16:30' : '16:00',
      });
    }
  }
  return cohorts;
}
const COHORTS = buildCohorts();

// How people get to campus. The 2W:4W ratio is pinned by measurement; the overall
// private-vehicle share is calibrated against it.
// [MEASURED] 82% of the vehicles through our gate were two-wheelers. 0.26 / 0.057
// keeps exactly that ratio.
// [CALIBRATED] The overall vehicle share was lowered from a first guess of 51% to
// 32%. At 51% the model produced a peak of 67 vehicles a minute against a 35 a
// minute gate, i.e. a queue of ~950 vehicles and a permanent jam. We filmed that
// same gate at 08:44 and counted 33 a minute flowing freely. A model that
// contradicts our own footage is wrong, so the share came down until the modelled
// peak (about 53 a minute) sits in reach of what we actually saw. The high walking
// share this implies is plausible here: the streets around the campus are full of
// student PG accommodation, so a large share of students live within walking
// distance. Worth confirming with a travel survey.
const MODE_SHARE = { '2W': 0.260, '4W': 0.057, BUS: 0.30, OTHER: 0.383 };
const FACULTY = { count: 312, share4W: 0.45, share2W: 0.35 }; // [RNSIT] 312 faculty; mode split [ASSUMED]
// [CALIBRATED] How tightly arrivals cluster around a cohort's first class, in minutes.
// This started at 5, which implied a peak of 175 vehicles a minute. Our own gate
// footage contradicts that: we counted 33 a minute at the Main Gate, flowing freely.
// Widening it to 25 brings the modelled peak into reach of what we actually filmed.
// See docs/measured/ for the full calibration and the gap that remains.
const ARRIVAL_SPREAD_MIN = 25;
// [ASSUMED] Share of enrolled students actually arriving on a given morning.
// Attendance, electives and staggered lab timetables all cut the real number.
const DAILY_ATTENDANCE = 0.75;

const BUS_FLEET = 22; // college buses
const SEATS_PER_BUS = 50;

// ---------------------------------------------------------------------------
// THE REST OF THE CAMPUS
//
// RNSIT is not alone here. The R N Shetty Trust runs several institutions on or
// beside this campus, and they all funnel through the same gates onto the same
// road. Modelling only the engineering college understates the morning badly and
// hides the single biggest free win available, which is that the school and the
// college currently start at almost the same minute.
//
// Sources:
//   [CBSE]  RNS International School, affiliation 830684. CBSE's own record gives
//           its address as "RNSIT CAMPUS, UTTARAHALLI-KENGERI MAIN ROAD,
//           CHANNASANDRA, R.R NAGAR POST, BANGALORE-98". Same campus, in writing.
//   [SCHOOL] Timings published on the school's own site (rnsischool.edu.in).
//   [AICTE] RNSIT mandatory disclosure, Oct 2025.
//   [BALLPARK] Head counts for the school and the PU college. Neither publishes a
//           total, so these are derived from published class sizes and seat counts,
//           with the working written beside each one. They are the first thing to
//           replace with a real figure from each office, and the conclusion does not
//           turn on them: the start times are what overlap, not the exact head count.
//
// mode: how people arrive. A school runs on buses and parent drop-off, which is a
// completely different gate problem from 5,000 students on two-wheelers: a parent
// car stops, unloads and turns around, occupying the gate far longer than a
// scooter that rides straight through.
const INSTITUTIONS = [
  {
    id: 'RNSIT', name: 'RNS Institute of Technology', kind: 'engineering',
    students: 5520, source: 'AICTE', // modelled in detail as COHORTS above
    arrive: '09:00', leave: '16:30', timingSource: 'CONFIRMED',
    mode: { '2W': 0.42, '4W': 0.09, BUS: 0.30, OTHER: 0.19 },
    modelled: 'cohorts',
  },
  {
    id: 'PG', name: 'RNSIT postgraduate (MBA and MCA)', kind: 'postgraduate',
    students: 720, source: 'AICTE', // MBA 240/yr and MCA 120/yr, two years each
    arrive: '09:30', leave: '17:00',
    mode: { '2W': 0.40, '4W': 0.18, BUS: 0.20, OTHER: 0.22 },
    modelled: 'block',
  },
  {
    id: 'SCHOOL_SR', name: 'RNS International School, grades 5 to 10', kind: 'school',
    // [BALLPARK] The school publishes an average class strength of about 35 and a
    // maximum of 40. Grades 5 to 10 is six year groups; at three sections each that
    // is 18 classes, so ~630. Rounded to 700 to stay on the cautious side, since
    // understating the school would understate the problem.
    students: 700, source: 'BALLPARK',
    arrive: '08:00', leave: '15:20', timingSource: 'SCHOOL',
    mode: { '2W': 0.04, '4W': 0.34, BUS: 0.60, OTHER: 0.02 },
    modelled: 'block',
  },
  {
    id: 'SCHOOL_JR', name: 'RNS International School, nursery to grade 4', kind: 'school',
    // [BALLPARK] Nursery, LKG, UKG and grades 1 to 4: seven year groups, but smaller
    // sections lower down, so ~500 on the same class-size basis.
    students: 500, source: 'BALLPARK',
    arrive: '08:45', leave: '15:20', timingSource: 'SCHOOL',
    mode: { '2W': 0.03, '4W': 0.42, BUS: 0.53, OTHER: 0.02 },
    modelled: 'block',
  },
  {
    id: 'PUC', name: 'RNS PU College', kind: 'pre-university',
    // [BALLPARK] Directory listings show roughly 100 to 120 seats per stream per year
    // across science and commerce. Two years, two or three streams: ~480.
    students: 480, source: 'BALLPARK',
    arrive: '08:30', leave: '16:00', timingSource: 'CONFIRMED',
    mode: { '2W': 0.30, '4W': 0.14, BUS: 0.40, OTHER: 0.16 },
    modelled: 'block',
  },
  {
    id: 'DEGREE', name: 'RNS First Grade College', kind: 'degree',
    students: 1018, source: 'PUBLISHED', // strength listed on college directories
    arrive: '09:00', leave: '16:00',
    mode: { '2W': 0.34, '4W': 0.10, BUS: 0.34, OTHER: 0.22 },
    modelled: 'block',
  },
];

// A parent dropping a child off holds the gate far longer than a rider going
// straight through to park. [ASSUMED] until we time it at the gate.
// Kept for reference only: our own footage shows the gate flowing at 33 a minute
// during school drop-off, so no gate penalty is applied. See src/simulator.js.
const DROPOFF_GATE_COST = 2.2;

const AREAS = [
  'RR Nagar', 'Kengeri', 'Uttarahalli', 'Banashankari', 'Jayanagar',
  'Vijayanagar', 'Mysore Road', 'Channasandra', 'BSK 3rd Stage', 'Nagarbhavi',
];

module.exports = {
  CAMPUS, GATES, LANE_SPLIT, ZONES, DEPARTMENTS, TEACH_OUT_DEPARTMENTS, ALL_DEPARTMENTS, DEPARTMENT_NAMES, COHORTS, MODE_SHARE, FACULTY, BUS_FLEET, SEATS_PER_BUS, AREAS,
  ARRIVAL_SPREAD_MIN, DAILY_ATTENDANCE, INSTITUTIONS, DROPOFF_GATE_COST,
};
