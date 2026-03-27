// Wing Remote v2.1 — Recording Transport, Waveform, Param Updaters
// ── RECORDING TRANSPORT ─────────────────────────────
function _recUpdateUI() {
  // Update all recording UI elements wherever they are in the DOM
  ['recTimer','recTimer2'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const h = String(Math.floor(state.recSeconds/3600)).padStart(2,'0');
    const m = String(Math.floor(state.recSeconds%3600/60)).padStart(2,'0');
    const s = String(state.recSeconds%60).padStart(2,'0');
    el.textContent = `${h}:${m}:${s}`;
    el.classList.toggle('recording', state.recording);
  });
  ['recBadge','recBadge2'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = state.recording ? '● RECORDING' : 'REC READY';
    el.classList.toggle('active', state.recording);
  });
  ['btnRecord','btnRecord2'].forEach(id => {
    document.getElementById(id)?.classList.toggle('rec-armed', state.recording);
  });
  ['armBadge','armBadge2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = state.recording ? 'inline' : 'none';
  });
  ['formatBadge','formatBadge2'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !state.recording) {
      const sr = document.getElementById('sampleCount')?.textContent || '48000 Hz';
      el.textContent = `WAV ${sr} / ${BIT_DEPTH || 32}bit`;
    }
  });
}

function recTransport(action) {
  if (action === 'record') {
    if (!state.recording) {
      // Start recording — send to backend
      if (state.ws && state.ws.readyState === 1) {
        state.ws.send(JSON.stringify({type:'record_start'}));
      }
      state.recording = true;
      state.recSeconds = 0;
      clearInterval(state.recInterval);
      state.recInterval = setInterval(() => {
        state.recSeconds++;
        _recUpdateUI();
      }, 1000);
    } else {
      // Stop recording
      if (state.ws && state.ws.readyState === 1) {
        state.ws.send(JSON.stringify({type:'record_stop'}));
      }
      state.recording = false;
      clearInterval(state.recInterval);
    }
    _recUpdateUI();
  } else if (action === 'stop') {
    if (state.recording && state.ws && state.ws.readyState === 1) {
      state.ws.send(JSON.stringify({type:'record_stop'}));
    }
    state.recording = false;
    state.playing   = false;
    clearInterval(state.recInterval);
    state.recSeconds = 0;
    _recUpdateUI();
    ['btnPlay','btnPlay2'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.classList.remove('playing'); el.textContent = '▶'; }
    });
    // Refresh recordings list after stop
    setTimeout(_loadRecordingsList, 800);
  } else if (action === 'play') {
    state.playing = !state.playing;
    ['btnPlay','btnPlay2'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.classList.toggle('playing', state.playing); el.textContent = state.playing ? '⏸' : '▶'; }
    });
  } else if (action === 'rew') {
    state.recSeconds = 0;
    _recUpdateUI();
  }
}

const BIT_DEPTH = 32; // updated from status endpoint

// ── WAVEFORM ANIMATION ──────────────────────────────
function animateWaveform() {
  const canvas = document.getElementById('waveformCanvas');
  if (!canvas) { requestAnimationFrame(animateWaveform); return; }
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (state.recording) {
    ctx.strokeStyle = 'rgba(232,64,64,.7)';
  } else {
    ctx.strokeStyle = 'rgba(232,130,10,.4)';
  }
  ctx.lineWidth = 1;
  ctx.beginPath();
  const time = Date.now() / 300;
  for (let x = 0; x < W; x++) {
    const amp = state.recording ? .35 : .15;
    const y = H/2 + Math.sin(x/8 + time) * H * amp * Math.sin(x/50 + time*.3);
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  requestAnimationFrame(animateWaveform);
}

// ── PARAM UPDATERS ───────────────────────────────────
// updateParam/updateRatio replaced by populateDetailPanel live rendering

// ── BUS SENDS ───────────────────────────────────────
// renderBusSends replaced by populateDetailPanel

// LAYER TABS / VIEW LAYER HELPERS
// ── LAYER TABS ───────────────────────────────────────
// layer tab clicks are handled by selectTab() inline onclick