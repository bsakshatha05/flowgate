topbar('/student');
let userId = null;
const STATUS = { booked: ['Reserved', 'brand'], checked_in: ['On campus', 'ok'], checked_out: ['Exited', ''] };
const VEH = { '2W': 'Two-wheeler', '4W': 'Car', NONE: 'No vehicle' };

async function init() {
  const users = await api('/api/users');
  const sel = $('#who');
  sel.innerHTML = users.map((u) => `<option value="${u.id}">${esc(u.name)} · ${u.role === 'faculty' ? 'Faculty' : `${u.dept} Y${u.year}`} · ${VEH[u.vehicle]}</option>`).join('');
  let saved = null; try { saved = localStorage.getItem('fg-user'); } catch {}
  userId = Number(saved && users.some((u) => u.id === Number(saved)) ? saved : users.find((u) => u.vehicle === '2W' && u.role === 'student').id);
  sel.value = userId;
  sel.onchange = () => { userId = Number(sel.value); try { localStorage.setItem('fg-user', userId); } catch {} render(); };
  render();
  stream({ live: () => render(true), notice: showNotice });
}

// Pushed by the server when the predictive controller acts (simulated in the demo).
function showNotice(n) {
  let el = $('#notice');
  if (!el) { el = document.createElement('div'); el.id = 'notice'; el.className = 'card'; el.setAttribute('role', 'status'); el.style.borderColor = 'var(--brand)'; document.querySelector('main').prepend(el); }
  el.innerHTML = `<div class="card-head" style="margin-bottom:4px"><b>📣 FlowGate update</b><span class="pill brand">${esc(n.time)}${n.simulated ? ' · simulated' : ''}</span></div><div class="small">${esc(n.text)}</div>`;
  if ('Notification' in window && Notification.permission === 'granted') { try { new Notification('FlowGate', { body: n.text }); } catch {} }
}

async function render(quiet) {
  const [me, matches] = await Promise.all([api(`/api/me?userId=${userId}`), api(`/api/carpool/matches?userId=${userId}`)]);
  const { user: u, window: w, booking: b, zone: z, carpool: cp, credits: cr } = me;
  const html = [];

  // 1. The one thing that matters every morning: when to arrive.
  html.push(`
    <section class="today">
      <div class="today-label">Arrive today between</div>
      <div class="today-time">${w.start} <span>to</span> ${w.end}</div>
      ${w.exitStart ? `<div class="today-sub">Leaving: ${w.exitStart} to ${w.exitEnd}</div>` : ''}
    </section>`);

  // 2. Parking: either book it, or show where you are going.
  if (b) {
    const inside = b.status === 'checked_in';
    html.push(`
      <section class="card">
        <div class="card-head"><h2>${inside ? 'You are parked at' : 'Your parking space'}</h2>
          <span class="pill ${inside ? 'ok' : 'brand'}">${inside ? 'Checked in' : 'Reserved'}</span></div>
        <div class="place">${esc(z?.name)}</div>
        <div class="muted small">Enter by ${b.gate_id === 'G3' ? 'the Bus Bay Gate' : 'the Main Gate'} · ${VEH[b.vehicle]}</div>
        ${inside ? '' : `
        <button class="btn block" id="showPass" style="margin-top:12px">Show my pass</button>
        <button class="btn secondary block" id="cancel" style="margin-top:10px">Cancel, I am not coming</button>`}
      </section>`);
  } else if (u.vehicle !== 'NONE' && !(cp && !cp.isDriver)) {
    html.push(`
      <section class="card">
        <h2>Book your parking space</h2>
        <p class="muted small" style="margin:6px 0 12px">One tap. We pick the emptiest area and the nearest gate for you.</p>
        <button class="btn block" id="book">Book for today (${VEH[u.vehicle]})</button>
      </section>`);
  }

  // 3. Everything else is occasional, so it stays folded away.
  const carpoolBody = cp
    ? `<p style="margin:0"><b>${esc(cp.driver.name)}</b> from ${esc(cp.area)}, leaving for the ${cp.window_start} slot</p>
       <p class="muted small">${cp.isDriver ? 'You are driving' : 'You are riding'} · ${cp.members.length ? esc(cp.members.map((m) => m.name).join(', ')) : 'no riders yet'} · ${cp.seats - cp.members.length} seat(s) free</p>`
    : `${u.vehicle === '4W' ? `<button class="btn teal block" id="offer" style="margin-bottom:12px">Offer 3 seats from ${esc(u.area)}</button>` : ''}
       ${matches.length ? `<ul class="feed">${matches.map((m) => `
         <li><div style="flex:1"><b>${esc(m.driver)}</b><br><span class="small muted">${esc(m.area)} · ${m.window_start}${m.sameArea ? ' · same area' : ''}</span></div>
         <button class="btn sm" data-join="${m.id}">Join</button></li>`).join('')}</ul>`
         : '<p class="muted small" style="margin:0">Nobody is offering a ride right now.</p>'}`;

  html.push(`
    <details class="more">
      <summary>Green credits<span class="sum-right">${cr ? cr.total + ' pts · ' + esc(cr.badge) : ''}</span></summary>
      <div class="more-body">
        <p class="muted small" style="margin:0 0 8px">10 points for arriving in your slot, 10 for riding in a carpool, 5 per rider when you drive.
          ${cr && cr.next ? `${cr.next.need} more for ${esc(cr.next.badge)}.` : ''}</p>
        ${cr && cr.recent.length ? `<ul class="feed">${cr.recent.map((r) => `<li><span class="t">+${r.points}</span><div style="flex:1">${esc(r.reason)}</div></li>`).join('')}</ul>` : ''}
      </div>
    </details>
    <details class="more">
      <summary>Carpool<span class="sum-right">${cp ? 'joined' : (matches.length ? matches.length + ' nearby' : '')}</span></summary>
      <div class="more-body">${carpoolBody}</div>
    </details>`);

  $('#app').innerHTML = html.join('');
  $('#book')?.addEventListener('click', async () => {
    try { await api('/api/bookings', { userId }); toast('Space booked for today.'); render(); } catch (e) { toast(e.message); }
  });
  $('#cancel')?.addEventListener('click', async () => { await api('/api/bookings/cancel', { id: b.id }); toast('Booking cancelled'); render(); });
  $('#showPass')?.addEventListener('click', () => openPass(b, u));
  $('#offer')?.addEventListener('click', async () => {
    try { await api('/api/carpool/offer', { userId, seats: 3 }); toast('Carpool offered. You now park in Carpool Priority.'); render(); } catch (e) { toast(e.message); }
  });
  $$('[data-join]').forEach((btn) => btn.addEventListener('click', async () => {
    try { await api('/api/carpool/join', { userId, carpoolId: Number(btn.dataset.join) }); toast('Joined. One less vehicle at the gate.'); render(); } catch (e) { toast(e.message); }
  }));
}

// The pass fills the screen. A student holds the phone up at the parking area,
// often in sunlight, so the QR wants the whole display and one obvious way out.
function openPass(b, u) {
  // A double tap on a phone must not leave two passes stacked, needing two closes.
  document.querySelectorAll('.pass-modal').forEach((m) => m.remove());
  const el = document.createElement('div');
  el.className = 'pass-modal';
  el.innerHTML = `
    <div class="pass-sheet" role="dialog" aria-modal="true" aria-label="Your parking pass">
      <button class="pass-close" aria-label="Close pass">&times;</button>
      <div class="qr">${qrImg(b.code)}</div>
      <div class="code">${b.code}</div>
      <p class="small">Show this at the parking area, not at the gate.
        ${u.plateDisplay ? `Your plate <b>${esc(u.plateDisplay)}</b> is registered, so usually you will not be stopped.` : ''}</p>
    </div>`;
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  el.querySelector('.pass-close').addEventListener('click', close);
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(el);
  el.querySelector('.pass-close').focus();
}

init();
