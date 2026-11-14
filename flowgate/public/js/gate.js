topbar('/gate');
// Two choices, so two buttons rather than a dropdown. A guard holding a phone can
// see which one is active and switch it with a thumb, without opening a menu first.
let gateId = 'G1';
function setGate(id) {
  gateId = id;
  $$('#gate button').forEach((b) => {
    const on = b.dataset.gate === id;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
  try { localStorage.setItem('fg-gate', id); } catch (_) { /* private mode */ }
}
try { const g = localStorage.getItem('fg-gate'); if (g === 'G1' || g === 'G3') gateId = g; } catch {}
setGate(gateId);
$('#gate').addEventListener('click', (e) => {
  const b = e.target.closest('[data-gate]');
  if (b) setGate(b.dataset.gate);
});

let lastCode = ''; let lastAt = 0;
async function scan(code) {
  code = code.trim().toUpperCase();
  if (!code) return;
  if (code === lastCode && Date.now() - lastAt < 4000) return; // ignore repeat camera reads
  lastCode = code; lastAt = Date.now();
  let r;
  try { r = await api('/api/gate/scan', { code, gateId }); } catch (e) { r = { result: 'denied', message: e.message }; }
  showResult(r);
}

async function plateRead() {
  let r;
  try { r = await api('/api/gate/plate', { plate: $('#plateSel').value, gateId }); } catch (e) { r = { result: 'denied', message: e.message }; }
  showResult(r);
}
$('#plateBtn').onclick = plateRead;
async function loadPlates() {
  const list = await api('/api/plates');
  const cur = $('#plateSel').value;
  $('#plateSel').innerHTML = list.map((p) => `<option value="${p.plate}">${esc(p.display)} · ${esc(p.name)}${p.status ? ` (${p.status === 'booked' ? 'reserved' : 'inside'})` : ' (no booking)'}</option>`).join('')
    + '<option value="XX99ZZ0000">XX 99 ZZ 0000 · unregistered vehicle</option>';
  if (cur) $('#plateSel').value = cur;
}
loadPlates();

function showResult(r) {
  const icon = r.result === 'entry' ? '✅' : r.result === 'exit' ? '👋' : '⛔';
  const title = r.result === 'entry' ? 'LET THEM IN' : r.result === 'exit' ? 'EXIT RECORDED' : 'DO NOT LET THEM IN';

  // A guard glances at this for about a second. The big line is the DECISION and
  // nothing else. Anything that is merely worth knowing (early, booked for another
  // gate) goes in a separate amber note, so a pass is never green and red at once.
  const notes = [];
  if (r.wrongGate) notes.push(`Booked for the ${esc(r.gateName || r.gate)}, not this one. Still fine to let through.`);
  if (r.timing && r.timing !== 'on time') notes.push(`Arriving ${esc(r.timing)}.`);

  $('#result').innerHTML = `
    <div class="scan-result ${r.result}">
      <div class="big">${icon} ${title}</div>
      <div style="margin-top:6px">${esc(r.message)}</div>
      ${r.result === 'entry' ? `<div class="row" style="justify-content:center;margin-top:10px;gap:6px">
        <span class="pill auto">${esc(r.usn)}</span><span class="pill auto">${r.vehicle}</span>
        ${r.plate ? `<span class="pill auto brand">plate ${esc(r.plate)}</span>` : ''}
        ${r.earned ? `<span class="pill auto ok">+${r.earned} green credits</span>` : ''}</div>` : ''}
    </div>
    ${notes.length ? `<div class="scan-note">${notes.map((n) => `<div>${n}</div>`).join('')}</div>` : ''}`;
  if (navigator.vibrate) navigator.vibrate(r.result === 'denied' ? [80, 60, 80] : 60);
  loadPasses();
}

$('#manual').addEventListener('submit', (e) => { e.preventDefault(); scan($('#code').value); $('#code').value = ''; });

async function loadPasses() {
  const passes = await api('/api/passes');
  const lbl = { booked: ['Reserved', 'brand'], checked_in: ['Inside', 'ok'] };
  $('#passes').innerHTML = passes.map((p) => `<tr>
    <td>${esc(p.name)}</td><td class="mono">${p.code}</td><td>${p.gate_id}</td>
    <td><span class="pill ${lbl[p.status][1]}">${lbl[p.status][0]}</span></td>
    <td><button class="btn sm ${p.status === 'booked' ? '' : 'secondary'}" data-code="${p.code}">${p.status === 'booked' ? 'Scan in' : 'Scan out'}</button></td></tr>`).join('')
    || '<tr><td colspan="5" class="muted">No passes yet. Book one in the Student App.</td></tr>';
  $$('[data-code]').forEach((b) => b.onclick = () => { lastCode = ''; scan(b.dataset.code); });
}
loadPasses();
stream({ live: () => { loadPasses(); loadPlates(); } });

// camera scanning with jsQR (works offline, no BarcodeDetector needed)
let stream_ = null;
$('#camBtn').onclick = async () => {
  const video = $('#cam');
  if (stream_) { stream_.getTracks().forEach((t) => t.stop()); stream_ = null; video.classList.add('hidden'); $('#camBtn').textContent = 'Start camera'; return; }
  try {
    stream_ = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (e) {
    $('#camMsg').textContent = 'Camera not available here. Use the code box or the pass list instead.'; return;
  }
  video.srcObject = stream_; video.classList.remove('hidden'); await video.play();
  $('#camBtn').textContent = 'Stop camera';
  const canvas = $('#frame'); const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const tick = () => {
    if (!stream_) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const qr = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (qr && /^FG-/.test(qr.data)) scan(qr.data);
    }
    requestAnimationFrame(tick);
  };
  tick();
};
