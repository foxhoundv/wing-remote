// Wing Remote v2.1 — Fader Drag, Knob Drag, Touch, Mute/Solo/Rec
// ── FADER DRAG ──────────────────────────────────────
let dragState = null;
// Tracks which fader strips are currently being dragged.
// Incoming Wing push updates are suppressed for active drags to prevent
// the server echo fighting the user's drag position.
const activeDrags = new Set();
function startFaderDrag(e, stripType, id) {
  e.preventDefault();
  const track = document.getElementById(`fader-track-${stripType}-${id}`);
  if (!track) return;
  const ch = _getStrip(stripType, id) || {fader:0.75};
  dragState = { stripType, id, track, startY: e.clientY, startFader: ch.fader };
  // Mark this strip as being dragged — suppresses incoming /*S push updates
  // that would fight the user's drag position
  dragState.key = `${stripType}-${id}`;
  activeDrags.add(dragState.key);
  document.addEventListener('mousemove', onFaderDrag);
  document.addEventListener('mouseup', endFaderDrag);
}
function onFaderDrag(e) {
  if (!dragState) return;
  const rect = dragState.track.getBoundingClientRect();
  const val  = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
  setFader(dragState.stripType, dragState.id, val);
}
function endFaderDrag() {
  if (dragState?.key) activeDrags.delete(dragState.key);
  dragState = null;
  document.removeEventListener('mousemove', onFaderDrag);
  document.removeEventListener('mouseup', endFaderDrag);
}
function setFader(stripType, id, val) {
  const ch = _getStrip(stripType, id);
  if (ch) ch.fader = val;
  const key = `${stripType}-${id}`;
  const fill   = document.getElementById(`fader-fill-${key}`);
  const handle = document.getElementById(`fader-handle-${key}`);
  const dbEl   = document.getElementById(`fader-db-${key}`);
  if (fill)   fill.style.height   = (val*100)+'%';
  if (handle) handle.style.bottom = `calc(${val*100}% - 7px)`;
  if (dbEl)   dbEl.textContent    = faderToDb(val);
  sendFader(stripType, id, val);
}
// Wing fader raw→dB using the exact piecewise formula from V3.1.0 docs.
// Segments derived from doc data points: raw=0.675@-3dB, 0.75@0dB, 0.85@+4dB, 0.9233@+10dB
function faderToDb(v) {
  if (v <= 0) return '−∞';
  let db;
  if (v < 0.675) {
    // Log region (-60...-3): raw = 0.675*(1+(db+3)/57)
    db = (v / 0.675 - 1) * 57 - 3;
    if (db < -144) return '−∞';
  } else if (v <= 0.85) {
    // Linear region (-3...+4): 0.025 raw/dB, 0dB=0.75
    db = (v - 0.75) / 0.025;
  } else {
    // Upper region (+4...+10)
    db = 4 + (v - 0.85) / ((0.9233 - 0.85) / 6);
    db = Math.min(10, db);
  }
  return (db >= 0 ? '+' : '') + db.toFixed(1) + ' dB';
}

// ── MUTE / SOLO / REC ───────────────────────────────
function _getStripArray(stripType) {
  return {ch:'channels',aux:'aux',bus:'buses',main:'mains',matrix:'matrix',dca:'dca'}[stripType] || 'channels';
}
function _getStrip(stripType, id) {
  const arr = state[_getStripArray(stripType)];
  return arr ? arr[id-1] : null;
}

function toggleMute(stripType, id) {
  const ch = _getStrip(stripType, id);
  if (!ch) return;
  ch.muted = !ch.muted;
  const stripEl = document.getElementById(`strip-${stripType}-${id}`);
  stripEl?.classList.toggle('muted', ch.muted);
  stripEl?.querySelector('.mute-btn')?.classList.toggle('active', ch.muted);
  if (ch.muted) meterTargets[`${stripType}-${id}`] = 0;
  sendMuteToggle(stripType, id);
}
function toggleSolo(stripType, id) {
  const ch = _getStrip(stripType, id);
  if (!ch) return;
  ch.solo = !ch.solo;
  const stripEl = document.getElementById(`strip-${stripType}-${id}`);
  stripEl?.querySelector('.solo-btn')?.classList.toggle('active', ch.solo);
  sendOSC(`/${stripType}/${id}/$solo`, ch.solo ? 1 : 0);
}
function toggleRec(stripType, id) {
  const ch = _getStrip(stripType, id);
  if (!ch) return;
  ch.recArmed = !ch.recArmed;
  const stripEl = document.getElementById(`strip-${stripType}-${id}`);
  stripEl?.querySelector('.rec-btn')?.classList.toggle('active', ch.recArmed);
}

// ── KNOB DRAG ───────────────────────────────────────
let knobDrag = null;
function startKnobDrag(e, type, stripType, id) {
  e.stopPropagation(); e.preventDefault();
  const ch = _getStrip(stripType, id) || {pan:0};
  knobDrag = { type, stripType, id, startY: e.clientY, startVal: ch.pan };
  document.addEventListener('mousemove', onKnobDrag);
  document.addEventListener('mouseup', endKnobDrag);
}
function onKnobDrag(e) {
  if (!knobDrag) return;
  const delta = (knobDrag.startY - e.clientY) / 100;
  if (knobDrag.type === 'pan') {
    const val = Math.max(-1, Math.min(1, knobDrag.startVal + delta));
    const ch = _getStrip(knobDrag.stripType, knobDrag.id);
    if (ch) ch.pan = val;
    const knob = document.getElementById(`pan-${knobDrag.stripType}-${knobDrag.id}`);
    if (knob) knob.style.transform = `rotate(${val*135}deg)`;
    sendPan(knobDrag.stripType, knobDrag.id, val);
  }
}
function endKnobDrag() {
  knobDrag = null;
  document.removeEventListener('mousemove', onKnobDrag);
  document.removeEventListener('mouseup', endKnobDrag);
}