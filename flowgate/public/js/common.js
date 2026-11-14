// Shared helpers for all FlowGate pages.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || res.statusText);
  return data;
}

function toast(msg, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Server-sent events with auto-reconnect
function stream(handlers) {
  if (/[?&]shot\b/.test(location.search)) return; // screenshot mode: no live connection
  let es;
  const open = () => {
    es = new EventSource('/api/stream');
    for (const [type, fn] of Object.entries(handlers)) es.addEventListener(type, (e) => fn(JSON.parse(e.data)));
    es.onerror = () => { es.close(); setTimeout(open, 1500); };
  };
  open();
}

function qrImg(text, cell = 6) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  return q.createImgTag(cell, 8);
}

// The server may be running on the demo clock, so pages tell us what time it
// thinks it is (CLOCK_SKEW) and we measure ages against that, not the laptop's.
let CLOCK_SKEW = 0;
function setServerNow(iso) { if (iso) CLOCK_SKEW = new Date(iso).getTime() - Date.now(); }
const clockNow = () => Date.now() + CLOCK_SKEW;

function timeAgo(iso) {
  if (!iso) return 'never';
  const s = Math.round((clockNow() - new Date(iso)) / 1000);
  if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}
const hhmm = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function topbar(active) {
  const links = [['/', 'Home'], ['/student', 'Student App'], ['/gate', 'Gate Scanner'], ['/admin', 'Control Room'], ['/sign', 'Signage']];
  document.body.insertAdjacentHTML('afterbegin', `
    <header class="topbar">
      <a class="logo" href="/"><span class="logo-mark">⇄</span> FlowGate <span class="pill brand">RNSIT</span></a>
      <nav class="nav">${links.map(([h, l]) => `<a href="${h}" class="${h === active ? 'active' : ''}">${l}</a>`).join('')}</nav>
    </header>`);
}
