topbar('/admin');
let CFG = null;
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
Chart.defaults.font.family = '-apple-system, Segoe UI, Inter, sans-serif';
Chart.defaults.color = css('--muted');
Chart.defaults.borderColor = css('--border');

// ---------- tabs ----------
$$('.tab').forEach((t) => t.onclick = () => {
  $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
  ['live', 'sim', 'opt', 'people'].forEach((id) => $(`#tab-${id}`).classList.toggle('hidden', id !== t.dataset.tab));
  try { localStorage.setItem('fg-tab', t.dataset.tab); } catch {}
  if (t.dataset.tab === 'opt' && (!optLoaded || !$('#csv').value)) loadOptimizer();
  if (t.dataset.tab === 'sim') loadCompare();
  if (t.dataset.tab === 'people') loadPeople();
});

function kpi(label, value, sub, cls = '') {
  return `<div class="card kpi"><div class="label">${label}</div><div class="value ${cls}">${value}</div><div class="sub">${sub}</div></div>`;
}

// ---------- LIVE OPS ----------
// How this entry reached us. "Demo" means it came with the sample data, not from
// a real scan: judges ask, so the screen says so rather than hiding it.
const SRC = { qr: ['QR', 'brand'], camera: ['Camera', 'ok'], simulated: ['Sim feed', 'warn'], seed: ['Demo', ''] };
function renderLive(s) {
  setServerNow(s.serverNow); // keep ages on the server's clock, demo or real
  const flowIn = s.gateFlow.filter((g) => g.direction === 'in').reduce((a, g) => a + g.n, 0);
  const passes = (s.bookings.booked || 0) + (s.bookings.checked_in || 0) + (s.bookings.checked_out || 0);
  const camAge = s.lastCameraAt ? (clockNow() - new Date(s.lastCameraAt)) / 1000 : Infinity;
  // One glance: is anything wrong, and how full are we?
  const full = Math.round((s.onCampus / s.capacity) * 100);
  const tight = s.zones.map((z) => ({ ...z, r: (z.occupied + z.reserved) / z.capacity })).sort((a, b) => b.r - a.r)[0];
  let state = 'ok', msg = 'All clear';
  if (tight && tight.r > 0.95) { state = 'bad'; msg = `${tight.name} is full`; }
  else if (tight && tight.r > 0.85) { state = 'warn'; msg = `${tight.name} is nearly full`; }
  if (s.emergency) { state = 'bad'; msg = `Emergency lane active at ${s.emergency.gate}`; }
  $('#stDot').className = `st-dot ${state}`;
  $('#stText').textContent = msg;
  $('#stStats').innerHTML = [
    [`${s.onCampus}`, `vehicles on campus · ${full}% full`],
    [`${flowIn}`, 'entries, last 15 min'],
    [`${s.bookings.checked_in || 0}`, `inside · ${s.bookings.booked || 0} on the way`],
    [`${s.carpools.n}`, `carpool${s.carpools.n === 1 ? '' : 's'} · ${s.carpools.riders} fewer vehicle${s.carpools.riders === 1 ? '' : 's'}`],
  ].map(([n, l]) => `<div class="st-stat"><b>${n}</b><span>${l}</span></div>`).join('');

  // Per-gate status, the thing a guard acts on.
  $('#gateCards').innerHTML = CFG.gates.map((g) => {
    const n = s.gateFlow.filter((f) => f.gate_id === g.id && f.direction === 'in').reduce((a, f) => a + f.n, 0);
    const per = (n / 15).toFixed(1);
    const em = s.emergency && s.emergency.gate === g.id;
    return `<div class="gate-card${em ? ' alert' : ''}">
      <div class="gc-top"><b>${esc(g.name)}</b><span class="pill ${em ? 'bad' : 'ok'}">${em ? 'Emergency' : 'Open'}</span></div>
      <div class="gc-n">${n}<small>entries, last 15 min</small></div>
      <div class="gc-sub">about ${per} a minute · ${g.types.join(', ')}</div>
    </div>`;
  }).join('');

  const simFeed = s.lastFeedSource === 'simulated';
  $('#feedSrc').textContent = camAge < 120 ? (simFeed ? 'Simulated feed live' : 'Camera feed live') : 'Camera feed idle';
  $('#feedSrc').className = `pill ${camAge < 120 ? (simFeed ? 'warn' : 'ok') : ''}`;

  const zones = Object.fromEntries(s.zones.map((z) => [z.id, z]));
  const gates = {};
  for (const g of CFG.gates) {
    const n = s.gateFlow.filter((f) => f.gate_id === g.id && f.direction === 'in').reduce((a, f) => a + f.n, 0);
    // Short, because this sits in a pin on the map. The gate cards above carry the full wording.
    gates[g.id] = { queue: 0, label: `${n} in` };
  }
  $('#liveMap').innerHTML = campusMap(CFG, { zones, gates });

  $('#zoneBars').innerHTML = s.zones.map((z) => {
    const r = z.occupied / z.capacity;
    return `<div><div class="row small" style="justify-content:space-between"><b>${z.name}</b><span class="auto muted">${z.occupied}/${z.capacity}${z.reserved ? ` · +${z.reserved} reserved` : ''}</span></div>
      <div class="bar ${r > 0.85 ? 'bad' : r > 0.6 ? 'warn' : ''}"><div style="width:${Math.min(100, r * 100)}%"></div></div>
      <div class="small muted">${z.camera} counted at gates · ${z.checkedIn} via app</div></div>`;
  }).join('');

  $('#events').innerHTML = s.events.map((e) => {
    const [l, c] = SRC[e.source] || [e.source, ''];
    const who = e.name ? esc(e.name) : `${e.count} × ${e.vehicle_type}`;
    return `<li><span class="t">${hhmm(e.ts)}</span><div style="flex:1">${e.direction === 'in' ? '⬇ In' : '⬆ Out'} · <b>${who}</b><br><span class="small muted">${e.gate_id} · ${e.vehicle_type}</span></div><span class="pill ${c}">${l}</span></li>`;
  }).join('') || '<li class="muted">No gate activity yet.</li>';
}

// ---------- SIMULATION ----------
let simChart, cmpChart, fcChart, lastSim;
function renderForecast(st) {
  const f = st.forecast || [];
  const trig = st.trigger;
  const n = Math.max(f.length, trig ? trig.forecast.length : 0, 1);
  const labels = Array.from({ length: n }, (_, i) => `+${i} min`);
  const datasets = [
    { label: `Forecast now (${st.clock})`, data: f, borderColor: css('--brand'), backgroundColor: 'rgba(99, 102, 241, .18)', fill: true, tension: .3, pointRadius: 0 },
  ];
  if (trig) datasets.push({ label: `Forecast at ${trig.at}, before acting`, data: trig.forecast, borderColor: css('--bad'), borderDash: [4, 3], tension: .3, pointRadius: 0, fill: false });
  datasets.push({ label: 'Act threshold', data: labels.map(() => 15), borderColor: css('--warn'), borderDash: [6, 6], pointRadius: 0, fill: false });
  const data = { labels, datasets };
  if (!fcChart) fcChart = new Chart($('#fcChart'), { type: 'line', data, options: { animation: false, maintainAspectRatio: false, scales: { y: { beginAtZero: true, suggestedMax: 30 }, x: { ticks: { maxTicksLimit: 8 } } } } });
  else { fcChart.data = data; fcChart.update(); }
  const mp = $('#marshalPill');
  if (st.marshal) {
    const over = !st.marshal.active && st.clock >= st.marshal.to;
    mp.textContent = st.marshal.active ? `Marshal lane open until ${st.marshal.to}` : over ? `Marshal lane closed at ${st.marshal.to}` : `Marshal dispatched, lane opens ${st.marshal.from}`;
    mp.className = `pill ${st.marshal.active ? 'ok' : over ? '' : 'warn'}`;
  }
  else { mp.textContent = 'Marshal on standby'; mp.className = 'pill'; }
  if (st.scenario === 'predictive') {
    const peak = f.length ? Math.max(...f) : 0;
    $('#fcText').innerHTML = peak > 15 ? `Forecast peak <b>${Math.round(peak)}</b> vehicles. Acting now.` : `Forecast stays under the threshold.${st.metrics.nudgedPeople ? ` Riders nudged so far: ${st.metrics.nudgedPeople}.` : ''}`;
  } else {
    $('#fcText').innerHTML = st.scenario === 'flowgate' ? 'Reactive mode: the marshal is only sent once the queue reaches the road. Switch to <b>FlowGate + Predict</b> to act early.' : 'No forecasting today. Switch scenario to compare.';
  }
  $('#dayText').textContent = st.dayLabel || '';
}
function renderSim(st) {
  lastSim = st;
  if (simDay !== st.day) setDay(st.day, false);
  $('#simClock').textContent = st.clock;
  $('#simProg').style.width = `${Math.round(st.progress * 100)}%`;
  $$('[data-scn]').forEach((b) => {
    const on = b.dataset.scn === st.scenario;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
  $('#simStart').textContent = st.running ? '● Running' : st.done ? '↻ Run again' : '▶ Run';
  const m = st.metrics;
  $('#simKpis').innerHTML = [
    kpi('Peak gate queue', m.peakQueue, 'vehicles waiting at one gate', m.peakQueue > 40 ? 'bad' : ''),
    kpi('Worst wait', `${m.maxWaitMin} min`, `avg ${m.avgWaitMin} min per vehicle`),
    kpi('Queue on main road', `${m.spillbackMinutes} min`, 'minutes with spillback onto the road', m.spillbackMinutes ? 'bad' : ''),
    kpi('Pedestrian conflict', m.peakConflict, 'peak vehicle x pedestrian index'),
  ].join('').replaceAll('class="value bad"', 'class="value" style="color:var(--bad)"');

  const zones = Object.fromEntries(st.zones.map((z) => [z.id, z]));
  const gates = Object.fromEntries(st.gates.map((g) => [g.id, {
    queue: g.queue, level: g.closed ? 'bad' : undefined,
    label: g.closed ? '⛔ closed' : st.crossingHold?.[g.id] > 0 ? '🚶 crossing open' : `${g.queue} queued · ${g.waitMin ?? 0} min`,
  }]));
  $('#simMap').innerHTML = campusMap(CFG, { zones, gates });

  $('#alertCount').textContent = st.alerts.length;
  $('#alertCount').className = `pill ${st.alerts.some((a) => a.level === 'critical') ? 'bad' : st.alerts.length ? 'warn' : 'ok'}`;
  // A condition that has lasted several minutes shows the time it began and for how
  // long, instead of repeating itself once a minute down the whole panel.
  $('#alerts').innerHTML = st.alerts.map((a) => `<li><span class="t">${a.time}</span><div style="flex:1">${esc(a.text)}${
    a.minutes > 1 ? `<br><span class="small muted">ongoing ${a.minutes} min, since ${a.time}</span>` : ''
  }</div><span class="pill ${a.level === 'critical' ? 'bad' : a.level === 'info' ? 'brand' : 'warn'}">${a.level === 'info' ? 'Auto action' : a.level}</span></li>`).join('')
    || '<li class="muted">No alerts. Traffic flowing.</li>';

  const h = st.history;
  if (!simChart) {
    simChart = new Chart($('#simChart'), {
      type: 'line',
      data: { labels: [], datasets: [
        { label: 'Arrivals / min', data: [], borderColor: css('--brand'), backgroundColor: 'transparent', tension: .3, pointRadius: 0 },
        { label: 'Main Gate queue', data: [], borderColor: css('--bad'), backgroundColor: 'transparent', tension: .3, pointRadius: 0 },
      ] },
      options: { animation: false, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { x: { ticks: { maxTicksLimit: 10 } }, y: { beginAtZero: true } } },
    });
  }
  simChart.data.labels = h.labels;
  simChart.data.datasets[0].data = h.arrivals;
  simChart.data.datasets[1].data = h.queueG1;
  simChart.update();
  renderForecast(st);
}

async function loadCompare() {
  const day = simDay || 'normal';
  const c = await api(`/api/sim/compare?day=${day}`);
  const b = c.baseline, f = c.flowgate, p = c.predictive;
  const data = { labels: b.history.labels, datasets: [
    { label: 'Today', data: b.history.queueG1, borderColor: css('--bad'), backgroundColor: 'transparent', tension: .3, pointRadius: 0 },
    { label: 'FlowGate', data: f.history.queueG1, borderColor: css('--warn'), backgroundColor: 'transparent', tension: .3, pointRadius: 0 },
    { label: 'FlowGate + Predict', data: p.history.queueG1, borderColor: css('--ok'), backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderDash: [4, 3] },
  ] };
  const opts = { animation: false, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { x: { ticks: { maxTicksLimit: 10 } }, y: { beginAtZero: true, title: { display: true, text: 'vehicles queued' } } } };
  if (!cmpChart) cmpChart = new Chart($('#cmpChart'), { type: 'line', data, options: opts });
  else { cmpChart.data = data; cmpChart.update(); }
  $('#cmpNote').textContent = `${c.dayLabel}. Peak queue ${b.peakQueue} / ${f.peakQueue} / ${p.peakQueue} · worst wait ${b.maxWaitMin} / ${f.maxWaitMin} / ${p.maxWaitMin} min · road spillback ${b.spillbackMinutes} / ${f.spillbackMinutes} / ${p.spillbackMinutes} min (today / FlowGate / + Predict). Simulated with assumed figures.`;
}

// Two days, so two buttons, matching the scenario buttons beside them rather than
// hiding one of the two choices inside a dropdown.
let simDay = 'normal';
const DAY_HINT = {
  normal: 'A dry morning, 80% keeping their slot.',
  stress: 'Rain, only 60% keep their slot, and a breakdown cuts the gate to one lane at 08:15.',
};
function setDay(day, push = true) {
  simDay = day;
  $$('#day button').forEach((b) => {
    const on = b.dataset.day === day;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
  $('#dayHint').textContent = DAY_HINT[day] || '';
  if (push) api('/api/sim/reset', { day }).then(loadCompare);
}
$('#day').addEventListener('click', (e) => {
  const b = e.target.closest('[data-day]');
  if (b && b.dataset.day !== simDay) setDay(b.dataset.day);
});
$$('[data-scn]').forEach((b) => b.onclick = () => api('/api/sim/reset', { scenario: b.dataset.scn, day: simDay }));

// Speed is three fixed choices, so it is a segment like the rest of the bar.
let simSpeed = 5;
function setSpeed(v) {
  simSpeed = v;
  $$('#speed button').forEach((b) => {
    const on = Number(b.dataset.speed) === v;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
  if (lastSim?.running) api('/api/sim/start', { speed: v });
}
$('#speed').addEventListener('click', (e) => {
  const b = e.target.closest('[data-speed]');
  if (b) setSpeed(Number(b.dataset.speed));
});
$('#simStart').onclick = () => api('/api/sim/start', { scenario: lastSim?.scenario, speed: simSpeed });
$('#simPause').onclick = () => api('/api/sim/pause', {});
$('#simReset').onclick = () => api('/api/sim/reset', {});
$('#crossing').onclick = async () => { await api('/api/sim/crossing', { gateId: 'G1' }); toast('Vehicles held 2 min at Main Gate so pedestrians can cross'); };

// ---------- OPTIMIZER ----------
let optLoaded = false, optChart;
function toCsv(cs) { return ['cohort,dept,year,headcount,firstClass,lastClass', ...cs.map((c) => [c.id, c.dept, c.year, c.headcount, c.firstClass, c.lastClass].join(','))].join('\n'); }
function fromCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const head = lines.shift().split(',').map((s) => s.trim());
  return lines.map((l) => { const v = l.split(',').map((s) => s.trim()); const o = Object.fromEntries(head.map((h, i) => [h, v[i]]));
    return { id: o.cohort, dept: o.dept, year: Number(o.year), headcount: Number(o.headcount), firstClass: o.firstClass, lastClass: o.lastClass }; })
    .filter((c) => c.id && c.headcount && /^\d\d:\d\d$/.test(c.firstClass) && /^\d\d:\d\d$/.test(c.lastClass));
}
const params = () => ({ windowMin: Number($('#pWin').value), bufferMin: Number($('#pBuf').value), earliestEntry: $('#pEarly').value });

async function loadOptimizer() {
  optLoaded = true;
  const { cohorts, schedule } = await api('/api/optimizer');
  setCohorts(toCsv(cohorts));
  renderOpt(schedule);
}

// The CSV stays the single source of truth, but it lives behind a disclosure.
// What you normally look at is the table, which has a fixed height so editing
// the timetable never pushes the buttons around the page.
function setCohorts(csv) {
  $('#csv').value = csv;
  renderCohortTable();
}

function renderCohortTable() {
  let rows = [];
  try { rows = fromCsv($('#csv').value); } catch (_) { rows = []; }
  $('#cohortCount').textContent = rows.length ? `${rows.length} classes` : 'none loaded';
  $('#cohortTbl').innerHTML = rows.length
    ? rows.map((c) => `<tr>
        <td><b>${esc(c.id)}</b></td>
        <td class="mono">${c.headcount}</td>
        <td class="mono">${esc(c.firstClass)}</td>
        <td class="mono">${esc(c.lastClass)}</td>
      </tr>`).join('')
    : '<tr><td colspan="4" class="muted">No timetable loaded.</td></tr>';
}
function renderOpt(r) {
  const s = r.summary;
  $('#optSummary').innerHTML = `<span class="pill bad">Peak today ${s.peakBefore}/min</span><span class="pill ok">With slots ${s.peakAfter}/min</span><span class="pill brand">−${s.peakReductionPct}% peak</span>`;
  const cap = r.curve.labels.map(() => r.gateCapacityPerMin);
  const data = { labels: r.curve.labels, datasets: [
    { label: 'Today (everyone aims for class time)', data: r.curve.baseline, borderColor: css('--bad'), backgroundColor: 'color-mix(in srgb, #dc2626 12%, transparent)', fill: true, tension: .3, pointRadius: 0 },
    { label: 'Staggered slots', data: r.curve.staggered, borderColor: css('--ok'), backgroundColor: 'color-mix(in srgb, #16a34a 12%, transparent)', fill: true, stepped: true, pointRadius: 0 },
    { label: `Gate capacity (${r.gateCapacityPerMin}/min)`, data: cap, borderColor: css('--muted'), borderDash: [6, 6], pointRadius: 0, fill: false },
  ] };
  if (!optChart) optChart = new Chart($('#optChart'), { type: 'line', data, options: { animation: false, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { x: { ticks: { maxTicksLimit: 12 } }, y: { beginAtZero: true } } } });
  else { optChart.data = data; optChart.update(); }
  const rows = (list) => list.map((a) => `<tr><td class="mono">${a.startLabel} to ${a.endLabel}</td><td>${a.cohort}</td><td>${a.vehicles}</td></tr>`).join('');
  $('#entryTbl').innerHTML = rows(r.entry);
  $('#exitTbl').innerHTML = rows(r.exit);
}
$('#runOpt').onclick = async () => { try { renderOpt(await api('/api/optimizer/run', { cohorts: fromCsv($('#csv').value), params: params() })); } catch (e) { toast(e.message); } };
$('#applyOpt').onclick = async () => {
  try { renderOpt(await api('/api/optimizer/apply', { cohorts: fromCsv($('#csv').value), params: params() })); toast('Slots applied. Students now see their new entry window.'); cmpChart && loadCompare(); } catch (e) { toast(e.message); }
};
$('#csvFile').onchange = async (e) => { const f = e.target.files[0]; if (f) { setCohorts(await f.text()); $('#runOpt').click(); } };
$('#csv').addEventListener('input', renderCohortTable); // table follows the CSV as you type

// ---------- demo controls ----------
$('#demoTime').onchange = async () => { const r = await api('/api/admin/demo-time', { time: $('#demoTime').value }); $('#demoTime').value = r.demoTime || ''; toast(r.demoTime ? `Gate clock set to ${r.demoTime}` : 'Gate uses the real clock'); };
$('#resetDemo').onclick = async () => { if (confirm('Reset all demo bookings, carpools and gate events?')) { await api('/api/admin/reset', {}); toast('Demo data reset'); loadOptimizer(); } };

// ---------- leaderboard, emergency, copilot ----------
async function loadLeaders() {
  const { depts } = await api('/api/leaderboard');
  $('#leaders').innerHTML = depts.slice(0, 6).map((d, i) => `<tr><td>${i + 1}. <b>${esc(d.dept)}</b></td><td style="text-align:right">${d.perHead} pts</td></tr>`).join('');
}
function renderEmergency(e) {
  $('#emBtn').textContent = e ? 'Clear emergency' : 'Emergency lane';
  $('#emBtn').className = `btn sm auto ${e ? 'secondary' : 'bad'}`;
  $('#emText').innerHTML = e ? `<b style="color:var(--bad)">Active at ${e.gate}:</b> ${esc(e.message)}` : 'Shows a keep-clear warning on the gate display.';
}
$('#emBtn').onclick = async () => {
  const on = !lastSim?.emergency;
  const r = await api('/api/admin/emergency', on ? { gateId: 'G1' } : {}); // one vehicle gate, so no picker
  if (lastSim) lastSim.emergency = r.emergency;
  renderEmergency(r.emergency); toast(on ? 'Emergency lane shown on gate signage' : 'Emergency cleared');
};
async function ask(question) {
  $('#askOut').innerHTML = '<span class="muted">Thinking...</span>';
  try {
    const r = await api('/api/copilot', { question });
    $('#askOut').innerHTML = `${esc(r.answer)}${r.note ? `<div class="muted" style="margin-top:8px">${esc(r.note)}</div>` : ''}`;
    $('#aiMode').textContent = r.mode === 'claude' ? `Claude (${r.model})` : 'Offline rules';
    $('#aiMode').className = `pill ${r.mode === 'claude' ? 'brand' : ''}`;
  } catch (e) { $('#askOut').textContent = e.message; }
}
$('#askForm').addEventListener('submit', (e) => { e.preventDefault(); if ($('#askInput').value.trim()) ask($('#askInput').value); });
$('#reportBtn').onclick = () => ask('Write a short shift report for the security supervisor.');
['Which gate is busiest?', 'Where is free parking?', 'What does the forecast say?', 'Which department leads on green credits?'].forEach((q) => {
  const b = document.createElement('button');
  b.className = 'pill'; b.style.cursor = 'pointer'; b.style.border = '0'; b.textContent = q;
  b.onclick = () => { $('#askInput').value = q; ask(q); };
  $('#askChips').appendChild(b);
});
api('/api/copilot/status').then((st) => {
  $('#aiMode').textContent = st.mode === 'claude' ? `Claude (${st.model})` : 'Offline rules';
  $('#aiMode').className = `pill ${st.mode === 'claude' ? 'brand' : ''}`;
  if (st.hint) $('#askOut').innerHTML = `<span class="muted">${esc(st.hint)} Offline answers work without it.</span>`;
});

// ---------- people ----------
// Faculty have no year, so the Year control disappears for them rather than
// sitting there asking a question that has no answer.
let pRole = 'student', pVehicle = '2W';
function setSegValue(wrapId, attr, value) {
  $$(`#${wrapId} button`).forEach((b) => {
    const on = b.dataset[attr] === value;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
}
$('#pRole')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-role]'); if (!b) return;
  pRole = b.dataset.role; setSegValue('pRole', 'role', pRole);
  syncPersonForm();
});
$('#pVehicle')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-vehicle]'); if (!b) return;
  pVehicle = b.dataset.vehicle; setSegValue('pVehicle', 'vehicle', pVehicle);
});

function fillPersonOptions() {
  // Teach-out branches are marked, so nobody wonders why they take no new intake.
  const out = CFG.teachOut || [];
  $('#pDept').innerHTML = (CFG.depts || []).map((d) => `<option value="${d}">${d}${out.includes(d) ? ' (final years only)' : ''}</option>`).join('');
  $('#pArea').innerHTML = (CFG.areas || []).map((a) => `<option>${a}</option>`).join('');
  $('#pInst').innerHTML = (CFG.institutions || []).map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join('');
  syncPersonForm();
}

// Department and year only exist for the engineering college. Every other
// institution on this campus arrives for a bell FlowGate does not set, so the
// form says what that bell is instead of asking for a slot it cannot assign.
function syncPersonForm() {
  const inst = (CFG.institutions || []).find((i) => i.id === $('#pInst').value) || {};
  const isEng = inst.id === 'RNSIT';
  $('#pDeptWrap').style.display = isEng ? '' : 'none';
  $('#pYearWrap').style.display = isEng && pRole === 'student' ? '' : 'none';
  $('#pInstHint').textContent = isEng
    ? 'Gets a staggered arrival slot from the timetable.'
    : `Arrives for the ${inst.arrive} start. FlowGate does not move this one, it works around it.`;
}
$('#pInst')?.addEventListener('change', syncPersonForm);

// What to show in the Class column: engineering people have a department and a
// year, everyone else is identified by their institution.
function personWhere(p) {
  const inst = (CFG.institutions || []).find((i) => i.id === p.institution);
  if (p.institution && p.institution !== 'RNSIT') return inst ? inst.name : p.institution;
  return p.role === 'faculty' ? `Faculty · ${p.dept}` : `${p.dept} Y${p.year}`;
}

async function loadPeople() {
  const people = await api('/api/users');
  const added = people.filter((p) => p.added);
  $('#addedCount').textContent = added.length ? `${added.length} added` : 'none yet';
  $('#addedCount').className = `pill ${added.length ? 'brand' : ''}`;
  $('#addedTbl').innerHTML = added.length ? added.map((p) => `<tr>
      <td><b>${esc(p.name)}</b></td>
      <td class="mono">${esc(p.usn)}</td>
      <td>${esc(personWhere(p))}</td>
      <td>${p.vehicle === 'NONE' ? 'Walks' : p.vehicle}</td>
      <td><button class="btn sm secondary" data-remove="${p.id}">Remove</button></td>
    </tr>`).join('')
    : '<tr><td colspan="5" class="muted">Nobody added yet. The 60 demo people are still there.</td></tr>';
}

$('#personForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('/api/admin/people', {
      name: $('#pName').value, role: pRole, institution: $('#pInst').value,
      dept: $('#pDept').value, year: Number($('#pYear').value),
      vehicle: pVehicle, area: $('#pArea').value,
    });
    toast(`${r.person.name} added as ${r.person.usn}`);
    $('#pName').value = ''; $('#pName').focus();
    loadPeople();
  } catch (err) { toast(err.message); }
});

$('#addedTbl')?.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-remove]'); if (!b) return;
  try { const r = await api('/api/admin/people/remove', { id: Number(b.dataset.remove) }); toast(`${r.removed} removed`); loadPeople(); }
  catch (err) { toast(err.message); }
});

$('#peopleFile')?.addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (f) { $('#peopleCsv').value = await f.text(); }
});

$('#importPeople')?.addEventListener('click', async () => {
  try {
    const r = await api('/api/admin/people/import', { csv: $('#peopleCsv').value });
    // Say what failed and why, rather than a bare count: a roster usually has a
    // couple of odd rows and the person importing it needs to know which.
    $('#importMsg').textContent = r.failed.length
      ? `Added ${r.added}. Skipped ${r.failed.length}: ${r.failed.slice(0, 3).map((f) => f.reason).join('; ')}`
      : `Added ${r.added}.`;
    toast(`Imported ${r.added} people`);
    $('#peopleCsv').value = '';
    loadPeople();
  } catch (err) { toast(err.message); }
});

$('#clearAdded')?.addEventListener('click', async () => {
  const r = await api('/api/admin/people/clear', {});
  toast(r.removed ? `Removed ${r.removed}` : 'Nobody to remove');
  loadPeople();
});

// ---------- boot ----------
(async () => {
  CFG = await api('/api/config');
  fillPersonOptions();
  $('#demoTime').value = CFG.demoTime || '';
  renderLive(await api('/api/stats'));
  const st0 = await api('/api/sim');
  renderSim(st0); renderEmergency(st0.emergency); loadLeaders();
  stream({
    live: (s) => { renderLive(s); loadLeaders(); },
    sim: (s) => { renderSim(s); renderEmergency(s.emergency); },
    schedule: () => loadCompare(),
  });
  let tab = location.hash.slice(1) || null; if (!tab) { try { tab = localStorage.getItem('fg-tab'); } catch {} }
  if (tab && tab !== 'live') $(`.tab[data-tab="${tab}"]`)?.click();
})();
