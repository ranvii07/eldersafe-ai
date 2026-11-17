import { PoseLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
import JSZip from 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';

const C = window.ElderCore;
const $ = (id) => document.getElementById(id);
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- tabs ----------------
document.querySelectorAll('.tab').forEach((t) => t.onclick = () => {
  document.querySelectorAll('.tab, .panel').forEach((e) => e.classList.remove('active'));
  t.classList.add('active'); $(t.dataset.tab).classList.add('active');
  if (t.dataset.tab === 'contacts') loadContacts();
  if (t.dataset.tab === 'history') loadHistory();
});

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

// ---------------- model thresholds ----------------
let model = { ...C.DEFAULT_MODEL };
function showModel() {
  $('modelInfo').innerHTML = `Lying if torso angle ≥ <b>${model.angle}°</b> or box ratio ≥ <b>${model.ratio}</b><br>
    Fall if hip drop speed ≥ <b>${model.drop}</b> body-heights/s and lying ≥ <b>${model.duration}s</b><br>
    <span class="small">${model.trainedOn ? `Learned from ${model.trainedOn} UR clips` : 'Default values'}</span>`;
}
api('/api/model').then((j) => { if (j.model) model = j.model; showModel(); }).catch(showModel);

// ---------------- MediaPipe Pose ----------------
let landmarker = null, ts = 0;
async function getLandmarker() {
  if (landmarker) return landmarker;
  $('mpStatus').textContent = 'loading…';
  const vision = await FilesetResolver.forVisionTasks(WASM);
  const make = (delegate) => PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate }, runningMode: 'VIDEO', numPoses: 1,
  });
  try { landmarker = await make('GPU'); } catch { landmarker = await make('CPU'); }
  $('mpStatus').textContent = 'MediaPipe Pose ready';
  return landmarker;
}
// returns 33 landmarks as [x, y, visibility] or null
function detectPose(source, gapMs = 33) {
  ts += gapMs;
  const res = landmarker.detectForVideo(source, ts);
  const lm = res.landmarks && res.landmarks[0];
  if (!lm) return null;
  const arr = lm.map((p) => [p.x, p.y, p.visibility ?? 1]);
  if (arr.every((p) => !p[2])) arr.forEach((p) => (p[2] = 1)); // some browser builds return no visibility
  return arr;
}

// ---------------- drawing ----------------
const ctx = $('canvas').getContext('2d');
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [0, 11], [0, 12]];
function draw(img, w, h, lm, label, isFall) {
  const cv = $('canvas');
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  ctx.drawImage(img, 0, 0, w, h);
  if (!lm) return;
  ctx.lineWidth = 3; ctx.strokeStyle = '#2563eb';
  for (const [a, b] of BONES) {
    if (lm[a][2] < 0.3 || lm[b][2] < 0.3) continue;
    ctx.beginPath(); ctx.moveTo(lm[a][0] * w, lm[a][1] * h); ctx.lineTo(lm[b][0] * w, lm[b][1] * h); ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  lm.forEach((p) => { if (p[2] >= 0.3) { ctx.beginPath(); ctx.arc(p[0] * w, p[1] * h, 3, 0, 7); ctx.fill(); } });
  const vis = lm.filter((p) => p[2] >= 0.3);
  const xs = vis.map((p) => p[0] * w), ys = vis.map((p) => p[1] * h);
  const x0 = Math.min(...xs) - 10, y0 = Math.min(...ys) - 10, x1 = Math.max(...xs) + 10, y1 = Math.max(...ys) + 10;
  const col = isFall ? '#dc2626' : '#16a34a';
  ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.fillStyle = col; ctx.fillRect(x0, y0 - 22, x1 - x0, 22);
  ctx.fillStyle = '#fff'; ctx.font = '16px system-ui'; ctx.fillText(label, x0 + 6, y0 - 6);
}

// ---------------- monitor ----------------
let running = false, runId = 0, live = null, alerted = false, frameTimes = [];
function startRun() {
  running = false; // stop anything already running
  return sleep(80).then(() => {
    running = true; runId++; alerted = false; frameTimes = [];
    live = C.createLiveDetector(model, 30);
    $('placeholder').classList.add('hidden'); $('banner').classList.add('hidden');
  });
}
function step(img, w, h, sourceName, frameNo, fps) {
  const lm = detectPose(img);
  const r = live.push(lm, w, h, fps);
  const isFall = r.fall || alerted;
  draw(img, w, h, lm, isFall ? 'FALL' : r.posture, isFall);
  $('posture').textContent = isFall ? 'FALL DETECTED' : r.posture;
  const f = r.feat || {};
  $('angle').textContent = f.torsoAngle != null ? f.torsoAngle.toFixed(0) + '°' : '–';
  $('ratio').textContent = f.boxRatio != null ? f.boxRatio.toFixed(2) : '–';
  $('frameNo').textContent = frameNo;
  if (r.fall && !alerted) { alerted = true; sendAlert(sourceName, r); }
}

async function sendAlert(source, r) {
  const b = $('banner');
  b.className = 'banner'; b.innerHTML = '<b>Possible fall detected.</b> Contacting the back end…';
  try {
    const a = await api('/api/alert', { method: 'POST', body: JSON.stringify({
      source, posture: 'lying', torsoAngle: r.feat?.torsoAngle != null ? +r.feat.torsoAngle.toFixed(1) : null,
      boxRatio: r.feat?.boxRatio != null ? +r.feat.boxRatio.toFixed(2) : null }) });
    const people = a.notified.length
      ? a.notified.map((c) => `<li>${esc(c.name)}${c.relation ? ' (' + esc(c.relation) + ')' : ''} · ${esc(c.phone)}
          · <a class="wa" target="_blank" href="https://wa.me/${esc(c.phone.replace(/\D/g, ''))}?text=${encodeURIComponent(a.message)}">Send WhatsApp</a></li>`).join('')
      : '<li>No contacts saved yet. Add one in the Contacts tab.</li>';
    b.innerHTML = `<b>Possible fall detected — alert #${esc(a.id)} saved by the back end.</b>
      <ul>${people}</ul><div class="small">Email: ${esc(a.emailStatus)}</div>
      <button id="resetAlert" class="ghost">Reset alert</button>`;
    $('resetAlert').onclick = () => { alerted = false; live && live.reset(); b.classList.add('hidden'); };
  } catch (e) { b.innerHTML = '<b>Possible fall detected</b>, but the back end could not be reached: ' + esc(e.message); }
}

$('stop').onclick = () => { running = false; const v = $('video'); if (v.srcObject) v.srcObject.getTracks().forEach((t) => t.stop()); v.pause(); };

$('srcZip').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  await getLandmarker(); await startRun();
  $('mpStatus').textContent = 'reading zip…';
  const zip = await JSZip.loadAsync(f);
  const names = Object.keys(zip.files).filter((n) => /\.(png|jpe?g)$/i.test(n)).sort();
  $('mpStatus').textContent = 'MediaPipe Pose ready';
  const id = runId;
  for (let i = 0; i < names.length && running && id === runId; i++) {
    const t0 = performance.now();
    const img = await createImageBitmap(await zip.files[names[i]].async('blob'));
    step(img, img.width, img.height, f.name, `${i + 1} / ${names.length}`, 30);
    img.close();
    await sleep(Math.max(0, 33 - (performance.now() - t0))); // play at ~30 fps like the dataset
  }
  running = false;
};

async function runVideo(name) {
  const v = $('video');
  await v.play();
  let n = 0; const id = runId;
  const loop = () => {
    if (id !== runId) return;
    if (!running || v.ended) { running = false; return; }
    if (v.readyState >= 2) {
      const now = performance.now(); frameTimes.push(now); if (frameTimes.length > 30) frameTimes.shift();
      const fps = frameTimes.length > 5 ? 1000 * (frameTimes.length - 1) / (now - frameTimes[0]) : 30;
      step(v, v.videoWidth, v.videoHeight, name, ++n, fps);
    }
    requestAnimationFrame(loop);
  };
  loop();
}
$('srcVid').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  await getLandmarker(); await startRun();
  const v = $('video'); v.srcObject = null; v.src = URL.createObjectURL(f);
  runVideo(f.name);
};
$('srcCam').onclick = async () => {
  try {
    await getLandmarker(); await startRun();
    const v = $('video'); v.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    runVideo('webcam');
  } catch (e) { $('placeholder').classList.remove('hidden'); $('placeholder').textContent = 'Camera error: ' + e.message; }
};

// ---------------- contacts ----------------
function showStorage(mode) {
  const s = $('storage');
  if (mode === 'vercel-blob') { s.className = 'pill good'; s.textContent = 'Back end storage: Vercel Blob'; }
  else { s.className = 'pill warn'; s.textContent = 'Storage: temporary (connect Vercel Blob)'; s.title = 'Data resets when the server restarts. See README.'; }
}
async function loadContacts() {
  try {
    const j = await api('/api/contacts'); showStorage(j.storage);
    $('contactList').innerHTML = j.contacts.length ? j.contacts.map((c) => `<div class="item"><div>
        <b>${esc(c.name)}</b> ${c.relation ? '· ' + esc(c.relation) : ''}
        <p class="small">📞 ${esc(c.phone)} ${c.email ? ' · ✉️ ' + esc(c.email) : ''}</p>
        ${c.address ? `<p class="small">📍 ${esc(c.address)}</p>` : ''}</div>
        <button class="ghost" data-del="${esc(c.id)}">Delete</button></div>`).join('')
      : '<p class="small">No contacts yet.</p>';
    document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      b.disabled = true; await api('/api/contacts?id=' + encodeURIComponent(b.dataset.del), { method: 'DELETE' }); loadContacts();
    });
  } catch (e) { $('contactList').textContent = 'Could not load contacts: ' + e.message; }
}
$('contactForm').onsubmit = async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  try { await api('/api/contacts', { method: 'POST', body: JSON.stringify(data) }); e.target.reset(); $('contactMsg').textContent = 'Saved.'; loadContacts(); }
  catch (err) { $('contactMsg').textContent = 'Error: ' + err.message; }
};
loadContacts();

// ---------------- history ----------------
async function loadHistory() {
  try {
    const j = await api('/api/alert');
    $('histList').innerHTML = j.alerts.length ? `<table><tr><th>Time</th><th>Source</th><th>Torso angle</th><th>Notified</th><th>Email</th></tr>
      ${j.alerts.map((a) => `<tr><td>${esc(new Date(a.createdAt).toLocaleString())}</td><td>${esc(a.source)}</td>
        <td>${a.torsoAngle != null ? esc(a.torsoAngle) + '°' : '–'}</td>
        <td>${a.notified.length ? a.notified.map((c) => esc(c.name) + ' (' + esc(c.phone) + ')').join('<br>') : 'nobody saved'}</td>
        <td>${esc(a.emailStatus)}</td></tr>`).join('')}</table>`
      : '<p class="small">No alerts yet. Run a fall clip on the Monitor tab.</p>';
  } catch (e) { $('histList').textContent = 'Could not load history: ' + e.message; }
}
$('refreshHist').onclick = loadHistory;

// ---------------- evaluate ----------------
async function runEvaluation(rawClips) {
  const clips = rawClips.map(C.preprocess).filter((c) => c.label != null);
  if (!clips.length) { $('evalStatus').textContent = 'No clips named fall-xx or adl-xx were found.'; return; }
  const totalFrames = clips.reduce((s, c) => s + c.frames.length, 0), missing = clips.reduce((s, c) => s + c.missing, 0);
  const res = await C.evaluateAsync(clips, (i, n) => { $('evalStatus').textContent = `Leave-one-clip-out: testing clip ${i} of ${n}…`; });
  const m = res.metrics, pct = (x) => (100 * x).toFixed(1) + '%', fm = res.finalModel;
  $('evalStatus').textContent = `Done: ${clips.length} clips (${clips.filter((c) => c.label).length} falls, ${clips.filter((c) => !c.label).length} daily activities), ${totalFrames} frames. ${missing} frames had no detected body and were filled by the median of nearby frames.`;
  $('evalOut').innerHTML = `
    <div class="metrics">
      <div class="metric">Accuracy<b>${pct(m.accuracy)}</b></div>
      <div class="metric">Recall (falls caught)<b>${pct(m.recall)}</b></div>
      <div class="metric">Specificity (no false alarm)<b>${pct(m.specificity)}</b></div>
      <div class="metric">Precision<b>${pct(m.precision)}</b></div>
    </div>
    <h3>Confusion matrix</h3>
    <table class="cm" style="max-width:420px"><tr><th></th><th>Predicted fall</th><th>Predicted no fall</th></tr>
      <tr><th>Actual fall</th><td>${m.tp}</td><td>${m.fn}</td></tr>
      <tr><th>Actual no fall</th><td>${m.fp}</td><td>${m.tn}</td></tr></table>
    <h3>Per clip</h3>
    <table><tr><th>Clip</th><th>Label</th><th>Prediction</th><th>Fall flagged at</th><th>Frames</th><th>Missing (median-filled)</th></tr>
      ${res.rows.map((r) => `<tr class="${r.label !== r.pred ? 'wrong' : ''}"><td>${esc(r.name)}</td><td>${r.label} (${r.label ? 'fall' : 'ADL'})</td>
        <td>${r.pred} (${r.pred ? 'fall' : 'no fall'})</td><td>${r.fallSec != null ? r.fallSec + ' s' : '–'}</td><td>${r.frames}</td><td>${r.missing}</td></tr>`).join('')}</table>
    <h3>Final model (trained on all ${fm.trainedOn} clips)</h3>
    <p class="small">Torso angle ≥ ${fm.angle}° or box ratio ≥ ${fm.ratio} → lying; fall if hip drop ≥ ${fm.drop} body-heights/s and lying ≥ ${fm.duration}s.
      Training accuracy ${pct(fm.trainAccuracy)} (the leave-one-clip-out numbers above are the honest test result).</p>
    <button id="saveModel">Use this model in Monitor (save to back end)</button> <span id="saveMsg" class="small"></span>`;
  $('saveModel').onclick = async () => {
    try {
      model = await api('/api/model', { method: 'POST', body: JSON.stringify({ ...fm, metrics: m }) });
      showModel(); $('saveMsg').textContent = 'Saved. Monitor now uses these thresholds.';
    } catch (e) { $('saveMsg').textContent = 'Error: ' + e.message; }
  };
}

$('evalBundled').onclick = async () => {
  $('evalStatus').textContent = 'Loading landmarks…'; $('evalOut').innerHTML = '';
  const j = await fetch('data/ur-landmarks.json').then((r) => r.json());
  runEvaluation(j.clips);
};

$('evalZips').onchange = async (e) => {
  const files = [...e.target.files].sort((a, b) => a.name.localeCompare(b.name)); e.target.value = '';
  if (!files.length) return;
  $('evalOut').innerHTML = '';
  await getLandmarker();
  const clips = [];
  for (const [k, f] of files.entries()) {
    const name = (f.name.match(/(fall|adl)-\d+/i) || [f.name])[0].toLowerCase();
    const zip = await JSZip.loadAsync(f);
    const names = Object.keys(zip.files).filter((n) => /\.(png|jpe?g)$/i.test(n)).sort();
    const frames = []; let w = 640, h = 480;
    ts += 5000; // new clip: jump the timeline so tracking starts fresh
    for (let i = 0; i < names.length; i++) {
      const img = await createImageBitmap(await zip.files[names[i]].async('blob'));
      w = img.width; h = img.height;
      frames.push(detectPose(img)); img.close();
      if (i % 10 === 0) { $('evalStatus').textContent = `Extracting landmarks: ${name} (${k + 1}/${files.length}) frame ${i + 1}/${names.length}`; await sleep(0); }
    }
    clips.push({ name, w, h, fps: 30, frames });
  }
  const blob = new Blob([JSON.stringify({ clips })], { type: 'application/json' });
  $('evalStatus').innerHTML = `Landmarks extracted. <a download="ur-landmarks.json" href="${URL.createObjectURL(blob)}">Download them</a>`;
  await sleep(300);
  runEvaluation(clips);
};
