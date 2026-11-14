// FlowGate Copilot: answers security staff's questions about live campus traffic.
//
// Two modes:
//   claude   uses the Claude API through the official SDK (@anthropic-ai/sdk) when it is
//            installed (`npm install`) AND credentials resolve (ANTHROPIC_API_KEY, or an
//            `ant auth login` profile). Needs internet.
//   offline  rule-based answers built from the same live data. Always available.
//
// Privacy: only aggregate numbers are sent (zone counts, gate queues, alerts, department
// totals). No names, USNs or number plates ever leave the server.

let Anthropic = null;
try { const mod = require('@anthropic-ai/sdk'); Anthropic = mod.default || mod; } catch { /* optional dependency not installed */ }

const MODEL = process.env.FLOWGATE_MODEL || 'claude-opus-5-5';
let client = null;
let lastError = null;

function getClient() {
  if (!Anthropic) return null;
  if (!client) {
    try { client = new Anthropic({ timeout: 30_000, maxRetries: 1 }); } catch (e) { lastError = e.message; return null; }
  }
  return client;
}

// Credentials the SDK can resolve: an env var, or an `ant auth login` profile on disk.
function hasCredentials() {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE) return true;
  try { return require('fs').existsSync(require('path').join(require('os').homedir(), '.config', 'anthropic')); } catch { return false; }
}

function status() {
  const ready = !!Anthropic && hasCredentials();
  return {
    sdkInstalled: !!Anthropic,
    credentials: hasCredentials(),
    mode: ready ? 'claude' : 'offline',
    model: ready ? MODEL : null,
    hint: !Anthropic ? 'Run `npm install` in the flowgate folder to add the Claude SDK.'
      : !hasCredentials() ? 'Set ANTHROPIC_API_KEY (see docs/TECHNICAL.md) and restart the server.' : null,
    lastError,
  };
}

const SYSTEM = `You are FlowGate Copilot, an assistant for the security and transport team at RNSIT, an engineering college in Bengaluru.
You see a JSON snapshot of campus traffic: parking zones, gate queues from the peak-hour simulator, alerts, the 20-minute queue forecast, and green-credit totals by department.
Answer in plain English for a busy guard supervisor: 2 to 5 short sentences or a few bullets, concrete numbers, and one clear recommended action when one helps.
Say "simulated" when a number comes from the simulator. If the snapshot does not contain the answer, say so instead of guessing.
For a shift report, use short headings: Summary, Gates, Parking, Incidents, Recommendations.
Never use em dashes.`;

async function askClaude(question, snapshot) {
  if (!hasCredentials()) { lastError = 'No Claude credentials: set ANTHROPIC_API_KEY'; return null; }
  const c = getClient();
  if (!c) return null;
  try {
    const response = await c.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: SYSTEM,
      messages: [{ role: 'user', content: `Live snapshot (JSON):\n${JSON.stringify(snapshot)}\n\nQuestion: ${question}` }],
    });
    if (response.stop_reason === 'refusal') return { mode: 'claude', model: response.model, answer: 'The AI declined this request. Try rephrasing it as a question about traffic or parking.' };
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    lastError = null;
    return { mode: 'claude', model: response.model, answer: text || 'No answer returned.' };
  } catch (e) {
    if (Anthropic.AuthenticationError && e instanceof Anthropic.AuthenticationError) lastError = 'Claude API key missing or invalid';
    else if (Anthropic.RateLimitError && e instanceof Anthropic.RateLimitError) lastError = 'Claude API rate limit, try again shortly';
    else if (Anthropic.APIConnectionError && e instanceof Anthropic.APIConnectionError) lastError = 'No internet connection to the Claude API';
    else if (Anthropic.APIError && e instanceof Anthropic.APIError) lastError = `Claude API error ${e.status}`;
    else lastError = e.message || String(e);
    return null; // caller falls back to offline answers
  }
}

// ---------- offline rule-based answers ----------
function offline(question, s) {
  const q = question.toLowerCase();
  const gates = s.simulation.gates;
  const busiest = [...gates].sort((a, b) => b.queue - a.queue)[0];
  const zones = s.parking.map((z) => ({ ...z, free: z.capacity - z.occupied }));
  const fullest = [...zones].sort((a, b) => b.occupied / b.capacity - a.occupied / a.capacity)[0];
  const freest = (type) => zones.filter((z) => z.type === type).sort((a, b) => b.free - a.free)[0];
  const fc = s.simulation.forecastPeak;
  const lines = [];

  if (/report|summary|shift|brief/.test(q)) {
    lines.push(`Summary: ${s.parkingTotals.occupied} of ${s.parkingTotals.capacity} spots in use (${s.parkingTotals.pct}%). ${s.passes.inside} pass holders inside, ${s.passes.onTheWay} on the way.`);
    lines.push(`Gates (simulated ${s.simulation.clock}, ${s.simulation.day}): ${gates.map((g) => `${g.name} ${g.closed ? 'CLOSED' : `${g.queue} queued, ${g.waitMin} min`}`).join('; ')}.`);
    lines.push(`Parking: fullest is ${fullest.name} at ${Math.round((fullest.occupied / fullest.capacity) * 100)}%.`);
    lines.push(`Incidents: ${s.simulation.alerts.length ? s.simulation.alerts.slice(0, 3).map((a) => `${a.time} ${a.text.replace(/\.$/, '')}`).join(' | ') : 'none'}.`);
    lines.push(`Recommendations: ${recommend(s, busiest, fc)}`);
    return lines.join('\n');
  }
  if (/park|space|spot|full|lot|zone/.test(q)) {
    const b2 = freest('2W'), b4 = freest('4W');
    return `Most free space: ${b2.name} (${b2.free} bike spots) and ${b4.name} (${b4.free} car spots). Fullest: ${fullest.name} at ${Math.round((fullest.occupied / fullest.capacity) * 100)}%. Overall ${s.parkingTotals.pct}% full.`;
  }
  if (/forecast|predict|next|later|will/.test(q)) {
    return fc ? `Forecast (simulated): up to ${fc.vehicles} vehicles queued by ${fc.at}. ${recommend(s, busiest, fc)}`
      : 'No forecast running. Start the simulation with the "FlowGate + Predict" scenario to see the 20-minute forecast.';
  }
  if (/carpool|credit|point|leader|department|dept/.test(q)) {
    const top = s.greenCredits[0];
    return top ? `Top department on green credits is ${top.dept} with ${top.perHead} points per student. ${s.carpools.n} carpool(s) today with ${s.carpools.riders} rider(s).` : 'No credit data yet.';
  }
  if (/gate|queue|wait|busy|jam|traffic|road/.test(q) || true) {
    const closed = gates.filter((g) => g.closed).map((g) => g.name);
    return `Simulated ${s.simulation.clock}: busiest is ${busiest.name} with ${busiest.queue} queued (about ${busiest.waitMin} min).${closed.length ? ` Closed: ${closed.join(', ')}.` : ''} ${recommend(s, busiest, fc)}`;
  }
}

function recommend(s, busiest, fc) {
  if (s.emergency) return `Emergency lane active at ${s.emergency.gate}: keep it clear.`;
  if (busiest.queue > 40) return `Queue is reaching the road at ${busiest.name}: send a marshal for a second lane and switch signage to the other gate.`;
  if (fc && fc.vehicles > 15) return `Send a marshal to ${busiest.name} now, before the forecast peak at ${fc.at}.`;
  if (busiest.queue > 10) return `Point drivers to ${s.simulation.recommendation?.name || 'the other gate'} on the signage.`;
  return 'No action needed right now.';
}

async function ask(question, snapshot) {
  const q = String(question || '').slice(0, 500).trim() || 'Give me a shift report';
  const ai = await askClaude(q, snapshot);
  if (ai) return ai;
  return { mode: 'offline', answer: offline(q, snapshot), note: Anthropic ? `Offline answer (${lastError}).` : 'Offline answer. For AI answers run `npm install` and set ANTHROPIC_API_KEY.' };
}

module.exports = { ask, status };
