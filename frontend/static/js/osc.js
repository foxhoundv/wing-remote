// Wing Remote v2.1 — WebSocket, OSC, Wing Status, Message Handler, Clock, Touch, Init
// ── WEBSOCKET AUTO-CONNECT ───────────────────────────
// The WebSocket to our backend opens automatically on page load.
// The backend's wing_probe_loop() handles Wing connectivity and broadcasts
// wing_status messages which applyWingStatus() applies to the UI.
// The Connect button is kept for manual re-trigger / force reconnect.

function connectWebSocket() {
  if (state.ws && state.ws.readyState <= 1) return;  // already open/connecting
  try {
    const wsUrl = `ws://${location.host}/ws`;
    state.ws = new WebSocket(wsUrl);
    state.ws.onopen = () => {
      console.log('[WING Remote] WebSocket connected to backend');
      document.getElementById('wsDot')?.classList.remove('offline');
      const lbl = document.getElementById('wsLabel');
      if (lbl) lbl.textContent = 'Server Online';
      // Immediately fetch current Wing status — don't wait for next probe cycle
      fetchAndApplyStatus();
    };
    state.ws.onclose = () => {
      console.warn('[WING Remote] WebSocket closed — retrying in 3s');
      document.getElementById('wsDot')?.classList.add('offline');
      const lbl = document.getElementById('wsLabel');
      if (lbl) lbl.textContent = 'Server Offline';
      setTimeout(connectWebSocket, 3000);  // auto-reconnect
    };
    state.ws.onerror = (e) => console.warn('[WS error]', e);
    state.ws.onmessage = (evt) => {
      try { handleServerMessage(JSON.parse(evt.data)); }
      catch(e) { console.warn('WS parse error', e); }
    };
  } catch(e) { console.warn('WebSocket failed:', e); }
}

function toggleConnect() {
  // Manual button: override Wing IP/port from the UI fields and
  // send a re-configure request to the backend, then wait for probe result
  const ip   = document.getElementById('wingIP')?.value.trim();
  const port = parseInt(document.getElementById('wingPort')?.value) || 2223;
  if (!ip) return;

  // Push new config to backend via REST
  fetch('/api/setup/apply', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ wing_ip: ip, wing_osc_port: port }),
  }).then(r => r.json()).then(d => {
    console.log('[WING Remote] Config applied', d);
    // Immediately refresh status display — new IP takes effect right away
    setTimeout(fetchAndApplyStatus, 800);
  }).catch(e => console.warn('Config apply failed', e));

  // Show "probing…" state
  const oscLabel = document.getElementById('oscLabel');
  if (oscLabel) oscLabel.textContent = 'Probing Wing…';
}

// ── WING CONNECTION STATUS ───────────────────────────

// Poll /api/status immediately on load/reconnect — don't wait for probe loop
async function fetchAndApplyStatus() {
  try {
    const r    = await fetch('/api/status');
    const data = await r.json();
    applyWingStatus(data.wing_connected, data.wing_ip, data.wing_port);
    const ipEl   = document.getElementById('wingIP');
    const portEl = document.getElementById('wingPort');
    if (ipEl   && data.wing_ip)   ipEl.value   = data.wing_ip;
    if (portEl && data.wing_port) portEl.value = data.wing_port;
  } catch(e) {
    console.warn('[WING Remote] Could not fetch status:', e);
  }
}

function applyWingStatus(connected, ip, port) {
  state.connected = connected;

  const oscDot   = document.getElementById('oscDot');
  const oscLabel = document.getElementById('oscLabel');
  const wsDot    = document.getElementById('wsDot');
  const wsLabel  = document.getElementById('wsLabel');
  const btn      = document.getElementById('connectBtn');

  if (connected) {
    oscDot?.classList.remove('offline');
    if (oscLabel) oscLabel.textContent = `OSC Connected · ${ip}`;
    wsDot?.classList.remove('offline');
    if (wsLabel) wsLabel.textContent = 'Wing Active';
    if (btn) { btn.textContent = 'Disconnect'; btn.classList.add('connected'); }
    // Update IP/port fields to match what backend is using
    const ipEl   = document.getElementById('wingIP');
    const portEl = document.getElementById('wingPort');
    if (ipEl   && ip)   ipEl.value   = ip;
    if (portEl && port) portEl.value = port;
  } else {
    oscDot?.classList.add('offline');
    if (oscLabel) oscLabel.textContent = 'Wing Unreachable';
    wsDot?.classList.add('offline');
    if (wsLabel) wsLabel.textContent = 'Waiting for Wing…';
    if (btn) { btn.textContent = 'Connect'; btn.classList.remove('connected'); }
  }
}

// ── WING OSC PATH HELPERS (correct Wing protocol) ───
// Wing uses /ch/{n}/fdr  NOT /ch/01/mix/fader (that's X32)
// Wing uses /ch/{n}/mute NOT /ch/01/mix/on
// Wing pan: -100 to +100; mute: "ON"=unmuted "OFF"=muted
const WING = {
  fader:     (ch) => `/ch/${ch}/fdr`,
  mute:      (ch) => `/ch/${ch}/mute`,
  pan:       (ch) => `/ch/${ch}/pan`,
  busFader:  (b)  => `/bus/${b}/fdr`,
  mainFader: (n)  => `/main/${n||1}/fdr`,   // main 1 = L/R stereo
  subscribe: '/*S',   // correct Wing subscription command
};

// ── OSC SEND (via WebSocket to backend) ─────────────
function sendOSC(path, value) {
  if (!state.ws || state.ws.readyState !== 1) return;
  state.ws.send(JSON.stringify({ type: 'osc', path, value }));
  console.log(`[OSC] ${path} = ${value}`);
}
function sendFader(strip, ch, val) {
  // strip = 'ch'|'aux'|'bus'|'main'|'mtx'|'dca'
  if (!state.ws || state.ws.readyState !== 1) return;
  state.ws.send(JSON.stringify({ type: 'fader', strip: strip||'ch', ch: String(ch), value: val }));
}
function sendMute(strip, ch, muted) {
  if (!state.ws || state.ws.readyState !== 1) return;
  state.ws.send(JSON.stringify({ type: 'mute', strip: strip||'ch', ch, value: muted }));
}
function sendMuteToggle(strip, ch) {
  // Efficient toggle — Wing handles 0↔1 flip with integer -1
  if (!state.ws || state.ws.readyState !== 1) return;
  state.ws.send(JSON.stringify({ type: 'mute_toggle', strip: strip||'ch', ch }));
}
function sendPan(strip, ch, val) {
  // val = -1.0..1.0 from UI; backend sends *100 to Wing (-100..100)
  if (!state.ws || state.ws.readyState !== 1) return;
  state.ws.send(JSON.stringify({ type: 'pan', strip: strip||'ch', ch, value: val }));
}

// ── HANDLE SERVER → BROWSER MESSAGES ───────────────
function handleServerMessage(msg) {
  const type = msg.type;
  if (type === 'snapshot') {
    // Full mixer snapshot on connect — populate all strip arrays from Wing state
    const sectionMap = {
      channels: {arr: state.channels, type:'ch'},
      aux:      {arr: state.aux,      type:'aux'},
      buses:    {arr: state.buses,    type:'bus'},
      main:     {arr: state.mains,    type:'main'},
      matrix:   {arr: state.matrix,   type:'matrix'},
      dca:      {arr: state.dca,      type:'dca'},
    };
    Object.entries(sectionMap).forEach(([section, {arr, type:stype}]) => {
      const data = msg.mixer?.[section] || {};
      Object.entries(data).forEach(([ch, d]) => {
        const i = parseInt(ch) - 1;
        if (i < 0 || i >= arr.length) return;
        if (d.fader      !== undefined) arr[i].fader      = d.fader;
        if (d.mute       !== undefined) arr[i].muted      = d.mute;
        if (d.pan        !== undefined) arr[i].pan        = d.pan;
        if (d.name       !== undefined && d.name !== '') arr[i].name = d.name;
        if (d.solo       !== undefined) arr[i].solo       = d.solo;
        if (d.gateActive !== undefined) arr[i].gateActive = d.gateActive;
        if (d.dynActive  !== undefined) arr[i].dynActive  = d.dynActive;
        // Seed meter as initial fallback (overwritten by real Wing binary meter data)
      });
    });
    // Re-render current layer to reflect new values
    renderCurrentStrips();
  } else if (type === 'meters') {
    // Real hardware VU levels from Wing binary meter protocol
    // msg.levels: { "ch-1": 0.75, "aux-1": 0.4, "bus-1": 0.6, ... }
    applyMeterValues(msg.levels || msg.channels || {});
  } else if (type === 'fader') {
    const sectionMap = {ch:'channels',aux:'aux',bus:'buses',main:'mains',mtx:'matrix',dca:'dca'};
    const arrKey = sectionMap[msg.strip] || 'channels';
    const i = parseInt(msg.ch) - 1;
    if (i >= 0 && state[arrKey]?.[i]) {
      state[arrKey][i].fader = msg.value;
      // Fast in-place DOM update for smooth fader movement
      const key    = `${msg.strip}-${msg.ch}`;
      const fill   = document.getElementById(`fader-fill-${key}`);
      const handle = document.getElementById(`fader-handle-${key}`);
      const dbEl   = document.getElementById(`fader-db-${key}`);
      if (fill)   { fill.style.height   = (msg.value * 100) + '%'; }
      if (handle) { handle.style.bottom = `calc(${msg.value * 100}% - 7px)`; }
      if (dbEl)   { dbEl.textContent    = faderToDb(msg.value); }
      // If no DOM element found, strip isn't rendered — refresh it
      if (!fill) refreshStripIfVisible(msg.strip, parseInt(msg.ch));
    }
  } else if (type === 'mute') {
    const sectionMap = {ch:'channels',aux:'aux',bus:'buses',main:'mains',mtx:'matrix',dca:'dca'};
    const arrKey = sectionMap[msg.strip] || 'channels';
    const i = parseInt(msg.ch) - 1;
    if (i >= 0 && state[arrKey]?.[i]) {
      state[arrKey][i].muted = msg.value;
      const key     = `${msg.strip}-${msg.ch}`;
      const stripEl = document.getElementById(`strip-${key}`);
      if (stripEl) {
        stripEl.classList.toggle('muted', msg.value);
        stripEl.querySelector('.mute-btn')?.classList.toggle('active', msg.value);
      } else {
        refreshStripIfVisible(msg.strip, parseInt(msg.ch));
      }
      if (msg.value) meterTargets[key] = 0;
    }
  } else if (type === 'pan') {
    const sectionMap = {ch:'channels',aux:'aux',bus:'buses',main:'mains',mtx:'matrix'};
    const arrKey = sectionMap[msg.strip] || 'channels';
    const i = parseInt(msg.ch) - 1;
    if (i >= 0 && state[arrKey]?.[i]) {
      state[arrKey][i].pan = msg.value;
      const knob = document.getElementById(`pan-${msg.strip}-${msg.ch}`);
      if (knob) { knob.style.transform = `rotate(${msg.value * 135}deg)`; }
      else      { refreshStripIfVisible(msg.strip, parseInt(msg.ch)); }
    }
  } else if (type === 'wing_status') {
    // Auto-connection status from backend probe loop
    applyWingStatus(msg.connected, msg.wing_ip, msg.wing_port);
  } else if (type === 'main_fader') {
    const fill   = document.getElementById('fader-fill-master');
    const handle = document.getElementById('fader-handle-master');
    const dbEl   = document.getElementById('fader-db-master');
    if (fill)   fill.style.height   = (msg.value * 100) + '%';
    if (handle) handle.style.bottom = `calc(${msg.value * 100}% - 7px)`;
    if (dbEl)   dbEl.textContent    = faderToDb(msg.value);
  } else if (type === 'name') {
    const sectionMap = {ch:'channels',aux:'aux',bus:'buses',main:'mains',mtx:'matrix',dca:'dca'};
    const arrKey = sectionMap[msg.strip];
    if (arrKey) {
      const i = parseInt(msg.ch) - 1;
      if (i >= 0 && state[arrKey]?.[i]) {
        const newName = msg.value || state[arrKey][i].name;
        state[arrKey][i].name = newName;
        const nameEl = document.getElementById(`name-${msg.strip}-${msg.ch}`);
        if (nameEl) { nameEl.textContent = newName; }
        else        { refreshStripIfVisible(msg.strip, parseInt(msg.ch)); }
      }
    }
    if (msg.strip === state.selectedStripType &&
        parseInt(msg.ch) - 1 === state.selectedChannel) {
      if (msg.value) document.getElementById('detailTitle').textContent = msg.value;
    }
  } else if (type === 'solo') {
    const smap = {ch:'channels',aux:'aux',bus:'buses',main:'mains',mtx:'matrix',dca:'dca'};
    const arrKey = smap[msg.strip] || 'channels';
    const i = parseInt(msg.ch) - 1;
    if (i >= 0 && state[arrKey]?.[i]) {
      state[arrKey][i].solo = msg.value;
      const soloBtn = document.getElementById(`strip-${msg.strip}-${msg.ch}`)
                               ?.querySelector('.solo-btn');
      if (soloBtn) { soloBtn.classList.toggle('active', msg.value); }
      else         { refreshStripIfVisible(msg.strip, parseInt(msg.ch)); }
    }
  } else if (type === 'eq_on') {
    const smap = {ch:'channels',aux:'aux',bus:'buses',main:'mains'};
    const arr = state[smap[msg.strip]];
    if (arr) {
      const ch = arr[parseInt(msg.ch)-1];
      if (ch) { ch.eq = ch.eq || {}; ch.eq.on = msg.value; }
    }
    if (msg.strip===state.selectedStripType && parseInt(msg.ch)-1===state.selectedChannel) {
      const badge = document.getElementById('eq-on-badge');
      if (badge) { badge.textContent=msg.value?'ON':'OFF';
        badge.style.color=msg.value?'var(--cyan)':'var(--text-muted)'; }
    }
  } else if (type === 'eq_band') {
    const smap = {ch:'channels',aux:'aux',bus:'buses',main:'mains'};
    const arr = state[smap[msg.strip]];
    if (arr) {
      const ch = arr[parseInt(msg.ch)-1];
      if (ch) {
        ch.eq = ch.eq || {on:false, bands:[]};
        while (ch.eq.bands.length < msg.band) ch.eq.bands.push({g:0,f:1000,q:0.7});
        ch.eq.bands[msg.band-1][msg.attr] = msg.value;
      }
    }
    // Refresh detail panel if this channel is selected
    if (msg.strip===state.selectedStripType && parseInt(msg.ch)-1===state.selectedChannel) {
      const layer = LAYERS[state.selectedStripType];
      if (layer) {
        const ch = layer.strips()[state.selectedChannel];
        if (ch) populateDetailPanel(ch, state.selectedStripType);
      }
    }
  } else if (type === 'dyn') {
    const smap = {ch:'channels',aux:'aux',bus:'buses',main:'mains'};
    const arr = state[smap[msg.strip]];
    if (arr) {
      const ch = arr[parseInt(msg.ch)-1];
      if (ch) ch.dyn = msg.dyn;
    }
    if (msg.strip===state.selectedStripType && parseInt(msg.ch)-1===state.selectedChannel) {
      const layer = LAYERS[state.selectedStripType];
      if (layer) { const ch=layer.strips()[state.selectedChannel]; if(ch) populateDetailPanel(ch,msg.strip); }
    }
  } else if (type === 'gate') {
    const arr = state.channels;
    const i = parseInt(msg.ch)-1;
    if (msg.strip==='ch' && arr[i]) arr[i].gate = msg.gate;
    if (msg.strip==='aux' && state.aux[i]) state.aux[i].gate = msg.gate;
    if (msg.strip===state.selectedStripType && i===state.selectedChannel) {
      const layer = LAYERS[state.selectedStripType];
      if (layer) { const ch=layer.strips()[i]; if(ch) populateDetailPanel(ch,msg.strip); }
    }
  } else if (type === 'send') {
    const smap = {ch:'channels',aux:'aux'};
    const arr = state[smap[msg.strip]];
    if (arr) {
      const ch = arr[parseInt(msg.ch)-1];
      if (ch) { ch.sends = ch.sends||{}; ch.sends[msg.bus] = msg.send; }
    }
    if (msg.strip===state.selectedStripType && parseInt(msg.ch)-1===state.selectedChannel) {
      // Update just the specific send row
      const lvlEl = document.querySelector(`#busSends .param-item:nth-child(${msg.bus})`);
      if (!lvlEl) { // full refresh if can't find row
        const layer = LAYERS[state.selectedStripType];
        if (layer) { const ch=layer.strips()[state.selectedChannel]; if(ch) populateDetailPanel(ch,msg.strip); }
      }
    }
  } else if (type === 'record_status') {
    if (msg.status === 'recording') {
      state.recording = true;
      state.recSeconds = 0;
      clearInterval(state.recInterval);
      state.recInterval = setInterval(() => { state.recSeconds++; _recUpdateUI(); }, 1000);
    } else if (msg.status === 'stopped') {
      state.recording = false;
      clearInterval(state.recInterval);
      setTimeout(_loadRecordingsList, 500);
    }
    _recUpdateUI();
  }
}

function updateFaderUI(stripType, id, val) {
  const key    = `${stripType}-${id}`;
  const fill   = document.getElementById(`fader-fill-${key}`);
  const handle = document.getElementById(`fader-handle-${key}`);
  const dbEl   = document.getElementById(`fader-db-${key}`);
  if (fill)   fill.style.height   = (val * 100) + '%';
  if (handle) handle.style.bottom = `calc(${val * 100}% - 7px)`;
  if (dbEl)   dbEl.textContent    = faderToDb(val);
}

// ── CLOCK ────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const pad = n => String(n).padStart(2,'0');
  const frames = pad(Math.floor(now.getMilliseconds() / 1000 * 30));
  document.getElementById('clockDisplay').textContent =
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}:${frames}`;
}
setInterval(updateClock, 33);

// ── TOUCH FADER ──────────────────────────────────────
function startFaderDragTouch(e, stripType, id) {
  e.preventDefault();
  const touch = e.touches[0];
  const track = document.getElementById(`fader-track-${stripType}-${id}`);
  const ch    = _getStrip(stripType, id) || {fader:0.75};
  dragState   = { stripType, id, track, startY: touch.clientY, startFader: ch.fader };
  document.addEventListener('touchmove', onTouchFader, { passive: false });
  document.addEventListener('touchend', endTouchFader);
}
function onTouchFader(e) {
  if (!dragState) return;
  e.preventDefault();
  const touch = e.touches[0];
  const rect  = dragState.track.getBoundingClientRect();
  const val   = Math.max(0, Math.min(1, 1 - (touch.clientY - rect.top) / rect.height));
  setFader(dragState.stripType, dragState.id, val);
}
function endTouchFader() {
  dragState = null;
  document.removeEventListener('touchmove', onTouchFader);
  document.removeEventListener('touchend', endTouchFader);
}

// ── INIT ─────────────────────────────────────────────
initChannels();
animateWaveform();
// Apply saved theme icon now that SVG elements exist in DOM
try {
  _applyThemeIcon(localStorage.getItem('wing-theme') === 'light');
} catch(e) {}
// Connect WebSocket to backend immediately on page load
connectWebSocket();
// Also fetch status via REST immediately — WebSocket wing_status may take 5-15s
setTimeout(fetchAndApplyStatus, 500);
setTimeout(() => {
  selectChannel(0, 'ch');
  drawDynGraph(-18, 4);
  // Set home as the active view explicitly
  setView('home');
  // Auto-launch setup wizard on first load (if Wing IP is still default)
  checkAndLaunchWizard();
}, 100);