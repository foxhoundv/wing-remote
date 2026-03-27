// Wing Remote v2.1 — Meter Animation, EQ Drawing Helpers
// ── METER STATE & ANIMATION ──────────────────────────────────────────────────
// Meter values come from the Wing via WebSocket (fader positions + subscription).
// We smooth-interpolate toward target values each animation frame.
const meterTargets = {};  // { "1": 0.75, ... } keyed by 1-based channel number

function applyMeterValues(levels) {
  // levels keys from backend:
  //   "ch-1"       → output_L VU level (0.0-1.0)
  //   "ch-1-r"     → output_R VU level
  //   "ch-1-in"    → input_L level
  //   "ch-1-gate"  → gate state (0 or 1)
  //   "ch-1-dyn"   → dyn/comp state (0 or 1)
  const smap = {ch:'channels',aux:'aux',bus:'buses',main:'mains',mtx:'matrix'};

  Object.entries(levels).forEach(([key, val]) => {
    if (key.endsWith('-gate') || key.endsWith('-dyn') || key.endsWith('-r') || key.endsWith('-in')) {
      // State/secondary keys — update strip state and LED DOM
      const parts    = key.split('-');
      const suffix   = parts[parts.length - 1];          // 'gate','dyn','r','in'
      const stripKey = parts[0];                          // 'ch','aux', etc.
      const id       = parseInt(parts[1]);
      const arrKey   = smap[stripKey];
      const arr      = arrKey ? state[arrKey] : null;
      const strip    = arr ? arr[id-1] : null;

      if (suffix === 'gate' && strip) {
        strip.gateActive = val > 0;
        const el = document.getElementById(`led-gate-${stripKey}-${id}`);
        el?.classList.toggle('gate-active', strip.gateActive);
      } else if (suffix === 'dyn' && strip) {
        strip.dynActive = val > 0;
        const el = document.getElementById(`led-dyn-${stripKey}-${id}`);
        el?.classList.toggle('dyn-active', strip.dynActive);
      } else if (suffix === 'r') {
        // Right channel meter — update fill-r element directly
        const el = document.getElementById(`fill-r-${stripKey}-${id}`);
        if (el) el.style.height = (Math.max(0, Math.min(1, val)) * 100) + '%';
      }
      // 'in' key (input level) stored but not separately displayed yet
    } else {
      // Primary output_L level — goes into meterTargets for animation
      meterTargets[key] = Math.max(0, Math.min(1, val));
    }
  });
}

function animateMeters() {
  // Animate the currently VISIBLE strips only (whichever layer is shown)
  const layer = LAYERS[state.currentLayer];
  if (!layer) { requestAnimationFrame(animateMeters); return; }
  const allStrips  = layer.strips();
  const start      = activeTabIndex * layer.tabSize;
  const page       = allStrips.slice(start, start + layer.tabSize);
  const stripType_ = layer.stripType;

  page.forEach(ch => {
    const chKey  = `${stripType_}-${ch.id}`;
    const wingConnected = state.ws && state.ws.readyState === 1;

    // Real values from Wing when connected, fake animation when not
    let target;
    if (meterTargets[chKey] !== undefined) {
      // Real hardware value from Wing meter engine (all strip types)
      target = meterTargets[chKey];
    } else if (!wingConnected) {
      // Wing not connected — show fake animation so UI looks alive
      const t = Date.now() / 1000;
      target = ch.muted ? 0 : ch.fader * (0.5 + 0.3 * Math.sin(t * 2.1 + ch.id));
    } else {
      // Connected but no meter data yet — show nothing
      target = 0;
    }

    const current = ch.meter[0] || 0;
    const diff    = target - current;
    ch.meter[0]   = current + diff * (diff > 0 ? 0.4 : 0.15);
    ch.meter[1]   = ch.meter[0] * (0.95 + Math.random() * 0.05);

    const fl = document.getElementById(`fill-l-${chKey}`);
    if (fl) fl.style.height = (ch.meter[0] * 100) + '%';
    // fill-r is updated directly by applyMeterValues with the real R channel value

    ch.clip[0] = ch.meter[0] > 0.95;
    document.getElementById(`clip-l-${chKey}`)?.classList.toggle('active', ch.clip[0]);
    document.getElementById(`clip-r-${chKey}`)?.classList.toggle('active', ch.clip[0]);

    // EQ mini canvas (channels/aux/buses only)
    const eqC = document.getElementById(`eq-mini-${chKey}`);
    if (eqC) drawEqMini(eqC, ch.eqBands, layer.color);
  });

  // Also update the full meters view if it's open
  if (state._metersViewActive) {
    Object.entries(meterTargets).forEach(([key, val]) => {
      const el = document.getElementById(`mv-${key}`);
      if (el) el.style.height = (val * 100) + '%';
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