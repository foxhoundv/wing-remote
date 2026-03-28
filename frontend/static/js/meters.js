// Wing Remote v2.1 — Meter Animation, EQ Drawing Helpers
// ── METER STATE & ANIMATION ──────────────────────────────────────────────────
// Meter values come from the Wing via WebSocket (fader positions + subscription).
// We smooth-interpolate toward target values each animation frame.
const meterTargets = {};  // { "1": 0.75, ... } keyed by 1-based channel number

function applyMeterValues(levels) {
  // levels keys from backend:
  //   "ch-1"       → output_L VU level (0.0–1.0)
  //   "ch-1-r"     → output_R VU level
  //   "ch-1-in"    → input_L level (pre-fader)
  //   "ch-1-gate"  → gate state (0 or 1)
  //   "ch-1-dyn"   → dyn/comp state (0 or 1)
  if (!levels || Object.keys(levels).length === 0) return;

  // Mark that real hardware data is now flowing
  _metersHaveLiveData = true;

  const smap = {ch:'channels', aux:'aux', bus:'buses', main:'mains', mtx:'matrix'};

  Object.entries(levels).forEach(([key, val]) => {
    const clamped = Math.max(0, Math.min(1, val));
    const parts   = key.split('-');
    const suffix  = parts.length > 2 ? parts[parts.length - 1] : null;

    if (suffix === 'gate' || suffix === 'dyn') {
      // LED state
      const stripKey = parts[0], id = parseInt(parts[1]);
      const arr      = smap[stripKey] ? state[smap[stripKey]] : null;
      const strip    = arr ? arr[id - 1] : null;
      if (suffix === 'gate' && strip) {
        strip.gateActive = val > 0;
        document.getElementById(`led-gate-${stripKey}-${id}`)
          ?.classList.toggle('gate-active', strip.gateActive);
      } else if (suffix === 'dyn' && strip) {
        strip.dynActive = val > 0;
        document.getElementById(`led-dyn-${stripKey}-${id}`)
          ?.classList.toggle('dyn-active', strip.dynActive);
      }
    } else if (suffix === 'in') {
      // Pre-fader input level — store in meterTargets with -in suffix for future use
      meterTargets[key] = clamped;
    } else {
      // Primary output_L or output_R — both go into meterTargets
      // animateMeters reads ch-N for left and ch-N-r for right
      meterTargets[key] = clamped;
    }
  });
}

// Track whether we have received at least one real meter packet from Wing
let _metersHaveLiveData = false;

function animateMeters() {
  const layer = LAYERS[state.currentLayer];
  if (!layer) { requestAnimationFrame(animateMeters); return; }

  const allStrips  = layer.strips();
  const start      = activeTabIndex * layer.tabSize;
  const page       = allStrips.slice(start, start + layer.tabSize);
  const stripType_ = layer.stripType;
  const wingConnected = state.ws && state.ws.readyState === 1;

  page.forEach(ch => {
    const chKey = `${stripType_}-${ch.id}`;
    let target;

    if (_metersHaveLiveData && meterTargets[chKey] !== undefined) {
      // Live hardware level from Wing binary meter engine
      target = meterTargets[chKey];
    } else if (!wingConnected) {
      // Wing offline — show gentle fake animation so strips look alive
      const t = Date.now() / 1000;
      target = ch.muted ? 0 : ch.fader * (0.45 + 0.28 * Math.sin(t * 1.9 + ch.id * 0.7));
    } else {
      // Connected but meter data not yet flowing — decay to zero
      target = 0;
    }

    // Smooth interpolation: fast attack (0.45), slow release (0.12)
    const current = ch.meter[0] || 0;
    const diff    = target - current;
    ch.meter[0]   = current + diff * (diff > 0 ? 0.45 : 0.12);

    const fl = document.getElementById(`fill-l-${chKey}`);
    if (fl) fl.style.height = (ch.meter[0] * 100) + '%';

    // Right channel — smooth the same way using ch.meter[1]
    const rKey    = `${chKey}-r`;
    const rTarget = (_metersHaveLiveData && meterTargets[rKey] !== undefined)
      ? meterTargets[rKey] : ch.meter[0];
    const rCurrent = ch.meter[1] || 0;
    const rDiff    = rTarget - rCurrent;
    ch.meter[1]    = rCurrent + rDiff * (rDiff > 0 ? 0.45 : 0.12);
    const fr = document.getElementById(`fill-r-${chKey}`);
    if (fr) fr.style.height = (ch.meter[1] * 100) + '%';

    // Clip LEDs — light when either channel peaks above -1 dBFS (≈ 0.983)
    const clipping = ch.meter[0] > 0.983 || ch.meter[1] > 0.983;
    ch.clip[0] = clipping;
    document.getElementById(`clip-l-${chKey}`)?.classList.toggle('active', clipping);
    document.getElementById(`clip-r-${chKey}`)?.classList.toggle('active', clipping);

    // EQ mini canvas
    const eqC = document.getElementById(`eq-mini-${chKey}`);
    if (eqC) drawEqMini(eqC, ch.eqBands, layer.color);
  });

  // Meters view — update all visible mv-* bars directly from live targets
  if (state._metersViewActive) {
    Object.entries(meterTargets).forEach(([key, val]) => {
      const el = document.getElementById(`mv-${key}`);
      if (el) el.style.height = (Math.max(0, Math.min(1, val)) * 100) + '%';
    });
  }

  requestAnimationFrame(animateMeters);
}
// ── EQ DRAWING ───────────────────────────────────────
function drawEqMini(canvas, bands, color) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = color || 'var(--cyan)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = 0; x <= W; x++) {
    const freq = 20 * Math.pow(1000, x / W);
    const y = H/2 - getEqCurve(freq, bands) * (H / 30);
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  // Zero line
  ctx.strokeStyle = 'rgba(255,255,255,.08)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();
}

function getEqCurve(freq, bands) {
  // bands can be either:
  //   array of numbers [g0, g1, ...]  (legacy from eqBands)
  //   array of objects [{g, f, q}, ...]  (from Wing EQ data)
  let gain = 0;
  bands.forEach((band, i) => {
    let g, fc, q;
    if (typeof band === 'object' && band !== null) {
      g  = band.g || 0;
      fc = band.f || [100, 400, 2000, 8000][i] || 1000;
      q  = band.q || 0.7;
    } else {
      g  = band || 0;
      fc = [100, 400, 2000, 8000][i] || 1000;
      q  = 0.7;
    }
    if (g === 0) return;
    // Parametric EQ bell curve approximation
    const ratio = freq / fc;
    const bw    = q > 0 ? 1 / q : 1;
    gain += g / (1 + Math.pow(Math.log2(ratio) * bw, 2));
  });
  return gain;
}

function drawEqMain(bands) {
  const canvas = document.getElementById('eqCanvas');
  if (!canvas) return;
  canvas.width = canvas.offsetWidth || 280;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,.04)';
  ctx.lineWidth = 1;
  [25, 50, 75].forEach(y => {
    ctx.beginPath(); ctx.moveTo(0, y/100*H); ctx.lineTo(W, y/100*H); ctx.stroke();
  });

  // Curve fill
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(0,212,212,.25)');
  grad.addColorStop(1, 'rgba(0,212,212,.0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  for (let x = 0; x <= W; x++) {
    const freq = 20 * Math.pow(1000, x / W);
    const y = H/2 - getEqCurve(freq, bands) * (H / 30);
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();

  // Curve line
  ctx.strokeStyle = 'var(--cyan,#00d4d4)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x <= W; x++) {
    const freq = 20 * Math.pow(1000, x / W);
    const y = H/2 - getEqCurve(freq, bands) * (H / 30);
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawDynGraph(thresh, ratio) {
  const canvas = document.getElementById('dynCanvas');
  if (!canvas) return;
  canvas.width = canvas.offsetWidth || 280;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const t = (thresh / -60) * W; // threshold x
  ctx.strokeStyle = 'rgba(255,255,255,.05)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(t, 0); ctx.lineTo(t, H); ctx.stroke();

  const grad = ctx.createLinearGradient(0, H, W, 0);
  grad.addColorStop(0, 'rgba(232,130,10,.1)');
  grad.addColorStop(1, 'rgba(232,130,10,.35)');
  ctx.fillStyle = grad;
  ctx.strokeStyle = 'var(--orange,#e8820a)';
  ctx.lineWidth = 2;
  // Fill
  ctx.beginPath();
  ctx.moveTo(0, H);
  ctx.lineTo(t, H - t);
  ctx.lineTo(W, H - t - (W - t) / ratio);
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();

  // Stroke line
  ctx.beginPath();
  ctx.moveTo(0, H);
  ctx.lineTo(t, H - t);
  ctx.lineTo(W, H - t - (W - t) / ratio);
  ctx.stroke();
}