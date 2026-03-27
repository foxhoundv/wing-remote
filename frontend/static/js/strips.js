// Wing Remote v2.1 — Mixer Model, Layer Navigation, Strip Rendering
// ── MIXER MODEL ──────────────────────────────────────
// Single source of truth for all strip types, mirroring the Wing's state.
// All arrays are 1-indexed via objects keyed by string channel number.

function makeStrip(n, prefix) {
  return {
    id: n, name: `${prefix} ${n}`,
    fader: 0.75, pan: 0.0, muted: false, solo: false,
    recArmed: false, meter: [0,0], clip: [false,false], eqBands: [0,0,0,0],
    gateActive: false, dynActive: false,
  };
}

// Build full Wing mixer model
state.channels = Array.from({length:40}, (_,i) => makeStrip(i+1,'CH'));
state.aux       = Array.from({length:8},  (_,i) => makeStrip(i+1,'AUX'));
state.buses     = Array.from({length:16}, (_,i) => makeStrip(i+1,'BUS'));
state.mains     = Array.from({length:4},  (_,i) => makeStrip(i+1,'MAIN'));
state.mains[0].name = 'L/R';  // Main 1 = stereo L/R master bus
state.matrix    = Array.from({length:8},  (_,i) => makeStrip(i+1,'MTX'));
state.dca       = Array.from({length:16}, (_,i) => makeStrip(i+1,'DCA'));

// Layer config: defines what each sidebar nav item shows
const LAYERS = {
  // tabSize = max strips per tab page; slice() handles the last page being smaller
  ch:     { strips: ()=>state.channels, prefix:'CH',   tabs:['CH 1–16','CH 17–32','CH 33–40'], tabSize:16, stripType:'ch',   color:'#e8820a' },
  aux:    { strips: ()=>state.aux,      prefix:'AUX',  tabs:['AUX 1–8'],                       tabSize:8,  stripType:'aux',  color:'#4a9eff' },
  bus:    { strips: ()=>state.buses,    prefix:'BUS',  tabs:['BUS 1–8','BUS 9–16'],            tabSize:8,  stripType:'bus',  color:'#00d4d4' },
  matrix: { strips: ()=>state.matrix,  prefix:'MTX',  tabs:['MTX 1–8'],                       tabSize:8,  stripType:'mtx',  color:'#3ddc84' },
  dca:    { strips: ()=>state.dca,      prefix:'DCA',  tabs:['DCA 1–8','DCA 9–16'],            tabSize:8,  stripType:'dca',  color:'#f5a623' },
  main:   { strips: ()=>state.mains,    prefix:'MAIN', tabs:['MAINS 1–4'],                     tabSize:4,  stripType:'main', color:'#e84040' },
};

let activeTabIndex = 0;

// ── INIT ─────────────────────────────────────────────
function initChannels() {
  selectLayer('ch', document.getElementById('nav-ch'));
  animateMeters();
}

// ── SELECT LAYER (sidebar click) ─────────────────────
function selectLayer(layerKey, navEl) {
  state.currentLayer = layerKey;
  activeTabIndex = 0;

  // Update sidebar active state
  document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
  if (navEl) navEl.classList.add('active');

  const layer = LAYERS[layerKey];
  if (!layer) return;

  // Build layer tabs
  const tabsEl = document.getElementById('layerTabs');
  tabsEl.innerHTML = layer.tabs.map((label, i) => `
    <div class="layer-tab ${i===0?'active':''}" onclick="selectTab(${i})">${label}</div>
  `).join('');

  renderCurrentStrips();
}

// ── SELECT TAB (page within a layer) ─────────────────
function selectTab(idx) {
  activeTabIndex = idx;
  document.querySelectorAll('.layer-tab').forEach((t,i) => t.classList.toggle('active', i===idx));
  renderCurrentStrips();
}

// ── RENDER STRIPS FOR CURRENT LAYER + TAB ────────────
function renderCurrentStrips() {
  const layer     = LAYERS[state.currentLayer];
  if (!layer) return;
  const allStrips = layer.strips();
  const start     = activeTabIndex * layer.tabSize;
  const page      = allStrips.slice(start, start + layer.tabSize);

  const container = document.getElementById('stripsScroll');
  container.innerHTML = '';

  page.forEach((ch, pageIdx) => {
    const globalIdx = start + pageIdx;
    const el = createStrip(ch, globalIdx, layer.stripType, layer.color);
    container.appendChild(el);
  });
}

// ── RENDER STRIPS (legacy alias used by snapshot handler) ──
function renderStrips() { renderCurrentStrips(); }

// Re-render a single strip if it is currently visible on screen.
// Called by WS handlers after they update the state array so the strip
// immediately reflects the new attribute without a full re-render.
function refreshStripIfVisible(stripType, id) {
  const layer = LAYERS[state.currentLayer];
  if (!layer || layer.stripType !== stripType) return;  // wrong layer shown
  const allStrips = layer.strips();
  const start     = activeTabIndex * layer.tabSize;
  const page      = allStrips.slice(start, start + layer.tabSize);
  const globalIdx = allStrips.findIndex(ch => ch.id === id);
  if (globalIdx < start || globalIdx >= start + page.length) return;  // not on this page
  const ch    = allStrips[globalIdx];
  const oldEl = document.getElementById(`strip-${stripType}-${id}`);
  if (!oldEl) return;
  const newEl = createStrip(ch, globalIdx, stripType, layer.color);
  oldEl.replaceWith(newEl);
}

function createStrip(ch, globalIdx, stripType, accentColor) {
  // globalIdx = position in the full layer array (0-based)
  // ch.id     = 1-based Wing channel number
  const stripType_ = stripType || 'ch';
  const color      = accentColor || '#e8820a';
  const isSelected = (stripType_ === state.currentLayer && globalIdx === state.selectedChannel);

  const div = document.createElement('div');
  // main strip id=1 is L/R master — give it the wider master styling
  const isMaster = (stripType_ === 'main' && ch.id === 1);
  div.className = 'channel-strip'
    + (isSelected ? ' selected' : '')
    + (ch.muted  ? ' muted'    : '')
    + (isMaster  ? ' master'   : '');
  div.id = `strip-${stripType_}-${ch.id}`;
  div.onclick = () => selectChannel(globalIdx, stripType_);

  const faderPct = Math.round(ch.fader * 100);
  const dbVal    = faderToDb(ch.fader);
  const panVal   = Math.round(ch.pan * 100);
  // Hide rec arm and EQ for strips that don't support it
  const hasPan   = stripType_ !== 'dca';
  const hasRec   = stripType_ === 'ch' || stripType_ === 'aux';
  const hasEQ    = stripType_ === 'ch' || stripType_ === 'aux' || stripType_ === 'bus';

  div.innerHTML = `
    <div class="ch-color-bar" style="background:${color}"></div>
    <div class="ch-number">${String(ch.id).padStart(2,'0')}</div>
    <div class="ch-name-box" id="name-${stripType_}-${ch.id}"
      onclick="event.stopPropagation();openChSettings('${stripType_}',${ch.id})"
      title="Click to open channel settings">${ch.name}</div>

    <div class="meter-wrap">
      <div class="meter-bar"><div class="meter-fill" id="fill-l-${stripType_}-${ch.id}"></div>
        <div class="meter-clip" id="clip-l-${stripType_}-${ch.id}"></div></div>
      <div class="meter-bar"><div class="meter-fill" id="fill-r-${stripType_}-${ch.id}"></div>
        <div class="meter-clip" id="clip-r-${stripType_}-${ch.id}"></div></div>
    </div>

    ${(hasEQ || hasPan) ? `<div class="strip-leds">
      <div class="strip-led ${ch.gateActive?'gate-active':''}" id="led-gate-${stripType_}-${ch.id}">G</div>
      <div class="strip-led ${ch.dynActive?'dyn-active':''}"  id="led-dyn-${stripType_}-${ch.id}">D</div>
    </div>` : ''}

    ${hasEQ ? `<div class="eq-thumb" onclick="event.stopPropagation();selectChannel(${globalIdx},'${stripType_}')">
      <canvas id="eq-mini-${stripType_}-${ch.id}" width="56" height="30"></canvas>
    </div>` : ''}

    ${hasPan ? `<div class="pan-section">
      <div class="pan-label">PAN</div>
      <div class="knob" id="pan-${stripType_}-${ch.id}" style="transform:rotate(${panVal*1.35}deg)"
        onmousedown="startKnobDrag(event,'pan','${stripType_}',${ch.id})"></div>
    </div>` : ''}

    <div class="ch-buttons">
      <button class="ch-btn mute-btn ${ch.muted?'active':''}"
        onclick="event.stopPropagation();toggleMute('${stripType_}',${ch.id})">M</button>
      <button class="ch-btn solo-btn ${ch.solo?'active':''}"
        onclick="event.stopPropagation();toggleSolo('${stripType_}',${ch.id})">S</button>
      ${hasRec ? `<button class="ch-btn rec-btn ${ch.recArmed?'active':''}"
        onclick="event.stopPropagation();toggleRec('${stripType_}',${ch.id})">R</button>` : ''}
    </div>

    <div class="fader-section">
      <div class="fader-track" id="fader-track-${stripType_}-${ch.id}"
        onmousedown="startFaderDrag(event,'${stripType_}',${ch.id})"
        ontouchstart="startFaderDragTouch(event,'${stripType_}',${ch.id})">
        <div class="fader-0db"></div>
        <div class="fader-fill" id="fader-fill-${stripType_}-${ch.id}" style="height:${faderPct}%"></div>
        <div class="fader-handle" id="fader-handle-${stripType_}-${ch.id}"
          style="bottom:calc(${faderPct}% - 7px)"></div>
      </div>
      <div class="fader-db" id="fader-db-${stripType_}-${ch.id}">${dbVal}</div>
    </div>
  `;
  return div;
}

function createMasterStrip() {
  const div = document.createElement('div');
  div.className = 'channel-strip master';
  div.style.marginLeft = '12px';
  div.innerHTML = `
    <div class="ch-color-bar" style="background:var(--orange)"></div>
    <div class="ch-number" style="color:var(--orange)">LR</div>
    <div class="ch-name-box" style="color:var(--orange)">MASTER</div>
    <div class="meter-wrap">
      <div class="meter-bar" id="meter-l-master"><div class="meter-fill" id="fill-l-master" style="height:65%"></div><div class="meter-clip" id="clip-l-master"></div></div>
      <div class="meter-bar" id="meter-r-master"><div class="meter-fill" id="fill-r-master" style="height:60%"></div><div class="meter-clip" id="clip-r-master"></div></div>
    </div>
    <div class="fader-section" style="min-height:140px">
      <div class="fader-track" id="fader-track-master" onmousedown="startFaderDrag(event,'master')">
        <div class="fader-0db"></div>
        <div class="fader-fill" id="fader-fill-master" style="height:75%"></div>
        <div class="fader-handle" id="fader-handle-master" style="bottom:calc(75% - 7px)"></div>
      </div>
      <div class="fader-db" id="fader-db-master">0.0 dB</div>
    </div>
  `;
  return div;
}