// Wing Remote v2.1 — Channel Settings Panel
// ═══════════════════════════════════════════════════════════════════════════
// CHANNEL SETTINGS PANEL
// ═══════════════════════════════════════════════════════════════════════════

// Current channel being edited
let _csStripType = 'ch';
let _csId        = 1;
let _csSection   = 'home';  // active nav section
let _csHomeTab   = 'overview';  // active Home sub-tab

// Wing-style channel accent colors (matches icon/color picker)
const CS_COLORS = [
  '#e8b800','#e84040','#3ddc84','#4a9eff',
  '#e8820a','#a855f7','#00d4d4','#ff69b4',
  '#8bc34a','#ff5722','#2196f3','#9c27b0',
  '#607d8b','#795548','#ff9800','#e91e63',
];

// Nav sections definition — label, icon hint, has on/off
const CS_SECTIONS = [
  { id:'home',       label:'HOME',        icon:'home',    badge:null    },
  { id:'gain',       label:'GAIN',        icon:'gain',    badge:'value' },
  { id:'gate',       label:'GATE',        icon:'gate',    badge:'on'    },
  { id:'eq',         label:'EQ',          icon:'eq',      badge:'on'    },
  { id:'dynamics',   label:'DYNAMICS',    icon:'comp',    badge:'on'    },
  { id:'insert1',    label:'INSERT 1',    icon:'fx',      badge:'on'    },
  { id:'insert2',    label:'INSERT 2',    icon:'fx',      badge:'on'    },
  { id:'mainsends',  label:'MAIN SENDS',  icon:'main',    badge:null    },
  { id:'bussends',   label:'BUS SENDS',   icon:'bus',     badge:null    },
];

function _csGetStrip() {
  const arrMap = {ch:'channels',aux:'aux',bus:'buses',main:'mains',mtx:'matrix',dca:'dca'};
  const arr = state[arrMap[_csStripType]];
  return arr ? arr[_csId - 1] : null;
}

// ── Open / Close ──────────────────────────────────────────────────────────────
function openChSettings(stripType, id) {
  _csStripType = stripType;
  _csId        = id;
  _csSection   = 'home';
  _csHomeTab   = 'overview';

  const ch = _csGetStrip();
  if (!ch) return;

  // Update header
  const layer = LAYERS[stripType];
  document.getElementById('csChId').textContent   = `${(layer?.prefix || stripType.toUpperCase())} ${id}`;
  document.getElementById('csChName').textContent = ch.name || `${stripType.toUpperCase()} ${id}`;
  const colorBar = document.getElementById('csColorBar');
  if (colorBar) colorBar.style.background = layer?.color || '#e8820a';

  // Hide mixer area, show settings panel
  document.getElementById('mixerArea').style.display   = 'none';
  document.getElementById('detailPanel').style.display  = 'none';
  document.getElementById('viewPanel').style.display    = 'none';
  document.getElementById('chSettingsPanel').classList.add('open');

  _csRenderNavRail();
  _csShowSection('home');
}

function closeChSettings() {
  document.getElementById('chSettingsPanel').classList.remove('open');
  document.getElementById('mixerArea').style.display   = '';
  document.getElementById('detailPanel').style.display = '';
  // Re-activate Home nav button
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('nav-home')?.classList.add('active');
}

// ── Nav Rail ──────────────────────────────────────────────────────────────────
function _csRenderNavRail() {
  const rail = document.getElementById('chNavRail');
  if (!rail) return;
  const ch = _csGetStrip() || {};

  rail.innerHTML = CS_SECTIONS.map(sec => {
    const isActive = sec.id === _csSection;
    let badgeHtml  = '';
    if (sec.badge === 'on') {
      const isOn = _csGetOnState(sec.id);
      badgeHtml = `<div class="nav-badge ${isOn?'on':'off'}">${isOn?'ON':'OFF'}</div>`;
    } else if (sec.badge === 'value' && sec.id === 'gain') {
      const g = typeof ch.gain === 'number' ? ch.gain.toFixed(1)+' dB' : '—';
      badgeHtml = `<div style="font-size:8px;color:var(--amber);font-family:monospace">${g}</div>`;
    }

    const thumbHtml = `<div class="ch-nav-thumb"><canvas id="nav-thumb-${sec.id}" width="72" height="36"></canvas></div>`;

    return `<div class="ch-nav-item${isActive?' active':''}" onclick="_csShowSection('${sec.id}')">
      ${thumbHtml}
      <div class="nav-label">${sec.label}</div>
      ${badgeHtml}
    </div>`;
  }).join('');

  // Draw mini thumbnails after DOM settles
  requestAnimationFrame(_csDrawNavThumbs);
}

function _csGetOnState(section) {
  const ch = _csGetStrip() || {};
  if (section === 'gate')     return ch.gate?.on || false;
  if (section === 'eq')       return ch.eq?.on   || false;
  if (section === 'dynamics') return ch.dyn?.on  || false;
  if (section === 'insert1')  return ch.ins1?.on  || false;
  if (section === 'insert2')  return ch.ins2?.on  || false;
  return false;
}

function _csDrawNavThumbs() {
  const ch = _csGetStrip() || {};
  // EQ thumb
  const eqC = document.getElementById('nav-thumb-eq');
  if (eqC) { drawEqMini(eqC, ch.eq?.bands || [], LAYERS[_csStripType]?.color || '#e8820a'); }
  // Gate thumb — draw transfer curve
  const gateC = document.getElementById('nav-thumb-gate');
  if (gateC) _csDrawGateThumb(gateC, ch.gate);
  // Dynamics thumb
  const dynC = document.getElementById('nav-thumb-dynamics');
  if (dynC) _csDrawDynThumb(dynC, ch.dyn);
  // Home thumb — mini strip icon
  const homeC = document.getElementById('nav-thumb-home');
  if (homeC) _csDrawHomeThumb(homeC, ch);
  // Gain thumb — bar
  const gainC = document.getElementById('nav-thumb-gain');
  if (gainC) _csDrawGainThumb(gainC, ch);
  // Bus sends thumb
  const busC = document.getElementById('nav-thumb-bussends');
  if (busC) _csDrawBusThumb(busC, ch);
  // Main sends thumb
  const mainC = document.getElementById('nav-thumb-mainsends');
  if (mainC) _csDrawMainThumb(mainC, ch);
  // Insert thumbs
  ['insert1','insert2'].forEach(k => {
    const c = document.getElementById(`nav-thumb-${k}`);
    if (c) _csDrawInsertThumb(c, k==='insert1' ? ch.ins1 : ch.ins2);
  });
}

function _csDrawHomeThumb(c, ch) {
  const ctx = c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);
  const color = LAYERS[_csStripType]?.color || '#e8820a';
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.7;
  ctx.fillRect(0, 0, c.width, 4);
  ctx.globalAlpha = 0.15;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'var(--text-dim)';
  ctx.font = 'bold 9px Barlow Condensed, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('HOME', c.width/2, c.height/2 + 4);
}
function _csDrawGainThumb(c, ch) {
  const ctx = c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);
  const val = typeof ch.gain === 'number' ? Math.min(1, (ch.gain + 10) / 75) : 0.5;
  ctx.fillStyle = '#3a2800';
  ctx.fillRect(0,0,c.width,c.height);
  ctx.fillStyle = '#e8b800';
  ctx.fillRect(4, c.height - (c.height-4)*val - 2, c.width-8, (c.height-4)*val);
}
function _csDrawGateThumb(c, gate) {
  const ctx = c.getContext('2d');
  const W=c.width, H=c.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = '#0e0f11'; ctx.fillRect(0,0,W,H);
  const on = gate?.on;
  ctx.strokeStyle = on ? '#4a9eff' : '#3a3d45';
  ctx.lineWidth = 1.5; ctx.beginPath();
  const thr = gate?.thr ?? -40;
  const tx  = W * (1 - Math.abs(thr)/80);
  ctx.moveTo(0, H); ctx.lineTo(tx, H*0.2); ctx.lineTo(W, 0);
  ctx.stroke();
  if (on) { ctx.strokeStyle='rgba(74,158,255,.2)'; ctx.lineWidth=4; ctx.stroke(); }
}
function _csDrawDynThumb(c, dyn) {
  const ctx = c.getContext('2d');
  const W=c.width, H=c.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = '#0e0f11'; ctx.fillRect(0,0,W,H);
  const on = dyn?.on;
  const thr = dyn?.thr ?? -20;
  const ratio = parseFloat(dyn?.ratio) || 4;
  const tx = W * (1 + thr/60);
  ctx.strokeStyle = on ? '#e8820a' : '#3a3d45';
  ctx.lineWidth = 1.5; ctx.beginPath();
  ctx.moveTo(0,H); ctx.lineTo(tx, H-tx); ctx.lineTo(W, H-tx-(W-tx)/ratio);
  ctx.stroke();
}
function _csDrawBusThumb(c, ch) {
  const ctx = c.getContext('2d');
  const W=c.width, H=c.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = '#0e0f11'; ctx.fillRect(0,0,W,H);
  const sends = ch.sends || {};
  const bw = (W-8)/16;
  for (let i=1; i<=16; i++) {
    const s = sends[String(i)] || {lvl:0, on:false};
    const h = (H-6) * (s.lvl || 0);
    ctx.fillStyle = s.on ? '#e8820a' : '#2a2d34';
    ctx.fillRect(4+(i-1)*bw, H-3-h, bw-1, h);
  }
}
function _csDrawMainThumb(c, ch) {
  const ctx = c.getContext('2d');
  const W=c.width, H=c.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = '#0e0f11'; ctx.fillRect(0,0,W,H);
  // Pan puck
  const pan = ch.pan || 0;  // -1..1
  const px = W/2 + pan * (W/2 - 6);
  ctx.beginPath();
  ctx.arc(px, H/2, 5, 0, Math.PI*2);
  ctx.fillStyle = '#4a9eff'; ctx.fill();
  ctx.strokeStyle = '#2a2d34'; ctx.lineWidth=1; ctx.stroke();
}
function _csDrawInsertThumb(c, ins) {
  const ctx = c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);
  ctx.fillStyle = '#0e0f11'; ctx.fillRect(0,0,c.width,c.height);
  const on = ins?.on;
  ctx.fillStyle = on ? '#a855f7' : '#2a2d34';
  ctx.fillRect(4, 4, c.width-8, c.height-8);
  ctx.fillStyle = '#e8eaf0';
  ctx.font = 'bold 8px Barlow Condensed';
  ctx.textAlign = 'center';
  ctx.fillText(ins?.type || 'NONE', c.width/2, c.height/2+3);
}

// ── Section Renderer ──────────────────────────────────────────────────────────
function _csShowSection(sectionId) {
  _csSection = sectionId;
  _csRenderNavRail();  // updates active state
  const content = document.getElementById('chSettingsContent');
  if (!content) return;
  const ch = _csGetStrip() || {};
  content.innerHTML = '';

  switch (sectionId) {
    case 'home':       _csRenderHome(content, ch);       break;
    case 'gain':       _csRenderGain(content, ch);       break;
    case 'gate':       _csRenderGate(content, ch);       break;
    case 'eq':         _csRenderEQ(content, ch);         break;
    case 'dynamics':   _csRenderDynamics(content, ch);   break;
    case 'insert1':    _csRenderInsert(content, ch, 1);  break;
    case 'insert2':    _csRenderInsert(content, ch, 2);  break;
    case 'mainsends':  _csRenderMainSends(content, ch);  break;
    case 'bussends':   _csRenderBusSends(content, ch);   break;
    default:
      content.innerHTML = `<div style="padding:32px;color:var(--text-muted);text-align:center;font-size:13px;">${sectionId.toUpperCase()} — coming soon</div>`;
  }
}

// ── OSC helper for this panel ─────────────────────────────────────────────────
function _csOSC(subpath, value) {
  const base = _csStripType === 'ch' ? 'ch' : _csStripType;
  sendOSC(`/${base}/${_csId}/${subpath}`, value);
}
function _csSlider(subpath, val, min, max, labelId, formatter) {
  const raw   = min + (val / 100) * (max - min);
  const label = document.getElementById(labelId);
  if (label) label.textContent = formatter ? formatter(raw) : raw.toFixed(1);
  _csOSC(subpath, raw);
  // Update mirror
  const ch = _csGetStrip();
  if (ch) {
    const parts = subpath.split('/');
    if (parts.length === 1) ch[parts[0]] = raw;
    else if (parts.length === 2) { ch[parts[0]] = ch[parts[0]] || {}; ch[parts[0]][parts[1]] = raw; }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// HOME section
// ────────────────────────────────────────────────────────────────────────────
function _csRenderHome(el, ch) {
  // Tab bar
  const tabs = ['overview','icon-color','name','tags'];
  const labels = ['OVERVIEW','ICON / COLOR','NAME','TAGS'];
  el.innerHTML = `<div class="ch-home-tabs">${tabs.map((t,i)=>`
    <div class="ch-home-tab${_csHomeTab===t?' active':''}" onclick="_csHomeTab='${t}';_csRenderHome(document.getElementById('chSettingsContent'),_csGetStrip()||{})">${labels[i]}</div>
  `).join('')}</div><div id="csHomeBody"></div>`;

  const body = document.getElementById('csHomeBody');
  if (_csHomeTab === 'overview')   _csRenderHomeOverview(body, ch);
  if (_csHomeTab === 'icon-color') _csRenderHomeIconColor(body, ch);
  if (_csHomeTab === 'name')       _csRenderHomeName(body, ch);
  if (_csHomeTab === 'tags')       _csRenderHomeTags(body, ch);
}

function _csRenderHomeOverview(el, ch) {
  const dyn   = ch.dyn  || {};
  const gate  = ch.gate || {};
  const eq    = ch.eq   || {bands:[]};
  const faderDb = faderToDb(ch.fader || 0.75);
  el.innerHTML = `
    <div class="cs-section">
      <div class="cs-row" style="align-items:stretch;gap:16px;">
        <!-- INPUT summary -->
        <div style="flex:1;min-width:160px;">
          <div class="cs-section-title">INPUT</div>
          <div class="cs-row">
            <div class="cs-param">
              <div class="cs-param-label">GAIN</div>
              <div class="cs-param-val">${typeof ch.gain==='number'?ch.gain.toFixed(1)+' dB':'—'}</div>
            </div>
            <div class="cs-param">
              <div class="cs-param-label">TRIM</div>
              <div class="cs-param-val">${typeof ch.trim==='number'?ch.trim.toFixed(1)+' dB':'0.0 dB'}</div>
            </div>
            <div class="cs-param">
              <div class="cs-param-label">FADER</div>
              <div class="cs-param-val">${faderDb}</div>
            </div>
          </div>
          <div class="cs-row" style="margin-top:8px;">
            <div class="cs-param">
              <div class="cs-param-label">PAN</div>
              <div class="cs-param-val">${ch.pan?((ch.pan>0?'R':'L')+Math.abs(Math.round(ch.pan*100))):'C'}</div>
            </div>
            <div class="cs-param">
              <div class="cs-param-label">MUTE</div>
              <div class="cs-param-val" style="color:${ch.muted?'var(--red)':'var(--green)'}">${ch.muted?'MUTED':'ON'}</div>
            </div>
            <div class="cs-param">
              <div class="cs-param-label">SOLO</div>
              <div class="cs-param-val" style="color:${ch.solo?'var(--amber)':'var(--text-muted)'}">${ch.solo?'SOLO':'OFF'}</div>
            </div>
          </div>
        </div>
        <!-- GATE summary -->
        <div style="min-width:130px;">
          <div class="cs-section-title" style="display:flex;gap:6px;align-items:center;">
            GATE <span class="nav-badge ${gate.on?'on':'off'}" style="margin-top:-1px">${gate.on?'ON':'OFF'}</span>
          </div>
          <div class="cs-param"><div class="cs-param-label">THRESHOLD</div>
            <div class="cs-param-val">${typeof gate.thr==='number'?gate.thr.toFixed(1)+' dB':'—'}</div></div>
          <div class="cs-param" style="margin-top:4px;"><div class="cs-param-label">RANGE</div>
            <div class="cs-param-val">${typeof gate.range==='number'?gate.range.toFixed(1)+' dB':'—'}</div></div>
        </div>
        <!-- DYNAMICS summary -->
        <div style="min-width:130px;">
          <div class="cs-section-title" style="display:flex;gap:6px;align-items:center;">
            DYNAMICS <span class="nav-badge ${dyn.on?'on':'off'}" style="margin-top:-1px">${dyn.on?'ON':'OFF'}</span>
          </div>
          <div class="cs-param"><div class="cs-param-label">THRESHOLD</div>
            <div class="cs-param-val">${typeof dyn.thr==='number'?dyn.thr.toFixed(1)+' dB':'—'}</div></div>
          <div class="cs-param" style="margin-top:4px;"><div class="cs-param-label">RATIO</div>
            <div class="cs-param-val">${dyn.ratio||'—'}:1</div></div>
        </div>
      </div>
    </div>
    <!-- EQ graph -->
    <div class="cs-section">
      <div class="cs-section-title" style="display:flex;gap:6px;align-items:center;">
        EQ <span class="nav-badge ${eq.on?'on':'off'}">${eq.on?'ON':'OFF'}</span>
        <span style="flex:1"></span>
        <button class="cs-toggle ${eq.on?'on':''}" onclick="_csSendToggle('eq/on',${!eq.on})">${eq.on?'ON':'OFF'}</button>
      </div>
      <canvas class="cs-graph" id="cs-eq-canvas-overview" height="100"></canvas>
      <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:9px;color:var(--text-muted)">
        <span>20</span><span>100</span><span>500</span><span>1k</span><span>5k</span><span>20k</span>
      </div>
    </div>`;
  // Draw EQ on the overview canvas (not the detail panel's eqCanvas)
  requestAnimationFrame(() => {
    const c = document.getElementById('cs-eq-canvas-overview');
    if (!c) return;
    c.width = c.offsetWidth;
    const ctx = c.getContext('2d'), W = c.width, H = c.height;
    ctx.clearRect(0,0,W,H);
    const bands = eq.bands || [];
    if (bands.length === 0) {
      ctx.strokeStyle = 'rgba(0,212,212,.4)'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.moveTo(0,H/2); ctx.lineTo(W,H/2); ctx.stroke();
      return;
    }
    // Draw using getEqCurve
    const grad = ctx.createLinearGradient(0,0,0,H);
    grad.addColorStop(0,'rgba(0,212,212,.2)'); grad.addColorStop(1,'rgba(0,212,212,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    for (let x=0; x<=W; x++) {
      const freq = 20 * Math.pow(1000, x/W);
      const y = H/2 - getEqCurve(freq, bands) * (H/30);
      x===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    }
    ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.closePath(); ctx.fill();
    ctx.strokeStyle='var(--cyan,#00d4d4)'; ctx.lineWidth=1.5;
    ctx.beginPath();
    for (let x=0; x<=W; x++) {
      const freq = 20 * Math.pow(1000, x/W);
      const y = H/2 - getEqCurve(freq, bands) * (H/30);
      x===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    }
    ctx.stroke();
  });
}

function _csSendToggle(subpath, newState) {
  const ch = _csGetStrip();
  const parts = subpath.split('/');
  if (ch) {
    if (parts.length === 2) {
      ch[parts[0]] = ch[parts[0]] || {};
      ch[parts[0]][parts[1]] = newState;
    } else if (parts.length === 1) {
      ch[parts[0]] = newState;
    }
  }
  _csOSC(subpath, newState ? 1 : 0);
  // Re-render section content WITHOUT calling _csRenderNavRail again
  // (_csShowSection calls it, so calling it here too causes a flicker/race)
  const contentEl = document.getElementById('chSettingsContent');
  if (!contentEl) return;
  contentEl.innerHTML = '';
  const freshCh = _csGetStrip() || {};
  switch (_csSection) {
    case 'gate':     _csRenderGate(contentEl, freshCh);     break;
    case 'eq':       _csRenderEQ(contentEl, freshCh);       break;
    case 'dynamics': _csRenderDynamics(contentEl, freshCh); break;
    case 'insert1':  _csRenderInsert(contentEl, freshCh,1); break;
    case 'insert2':  _csRenderInsert(contentEl, freshCh,2); break;
    default: _csShowSection(_csSection); return;
  }
  _csRenderNavRail();
}

function _csRenderHomeIconColor(el, ch) {
  const current = ch.color || CS_COLORS[0];
  el.innerHTML = `
    <div class="cs-section">
      <div class="cs-section-title">CHANNEL COLOR</div>
      <div class="cs-color-grid">${CS_COLORS.map(c=>`
        <div class="cs-color-swatch${c===current?' selected':''}"
          style="background:${c}"
          onclick="_csSetColor('${c}')"></div>
      `).join('')}</div>
    </div>
    <div class="cs-section">
      <div class="cs-section-title">PREVIEW</div>
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="width:60px;height:80px;background:var(--bg-panel);border:1px solid var(--border);border-radius:3px;overflow:hidden;display:flex;flex-direction:column;align-items:center;padding:4px;gap:4px;">
          <div id="cs-color-preview-bar" style="width:100%;height:4px;border-radius:2px;background:${current}"></div>
          <div style="font-size:9px;color:var(--text-dim);text-align:center;font-weight:600">${ch.name||'CH '+_csId}</div>
        </div>
        <div style="font-size:12px;color:var(--text-dim)">Selected: <span id="cs-color-hex" style="font-family:monospace;color:var(--cyan)">${current}</span></div>
      </div>
    </div>`;
}
function _csSetColor(hex) {
  const ch = _csGetStrip();
  if (ch) ch.color = hex;
  // Update the strip in the mixer view
  const bar = document.getElementById(`strip-${_csStripType}-${_csId}`)?.querySelector('.ch-color-bar');
  if (bar) bar.style.background = hex;
  // Re-render icon/color tab
  _csRenderHomeIconColor(document.getElementById('csHomeBody'), _csGetStrip()||{});
  _csRenderNavRail();
}

function _csRenderHomeName(el, ch) {
  el.innerHTML = `
    <div class="cs-section">
      <div class="cs-section-title">CHANNEL NAME</div>
      <div style="display:flex;gap:10px;align-items:center;max-width:480px;">
        <input type="text" id="cs-name-input"
          value="${(ch.name||'').replace(/"/g,'&quot;')}"
          maxlength="16"
          style="flex:1;padding:10px 14px;background:var(--bg-deep);
            border:1px solid var(--border-hi);border-radius:3px;
            color:var(--text-primary);font-size:16px;font-weight:600;
            font-family:'Barlow Condensed',sans-serif;letter-spacing:1px;outline:none;"
          oninput="_csNameChanged(this.value)"
          onkeydown="if(event.key==='Enter')this.blur()"
          autofocus>
        <button onclick="_csNameChanged(document.getElementById('cs-name-input').value,true)"
          style="padding:10px 18px;background:var(--orange);color:#000;font-weight:700;
            border:none;border-radius:3px;cursor:pointer;font-size:12px;letter-spacing:1px;">SEND</button>
      </div>
      <div style="margin-top:6px;font-size:10px;color:var(--text-muted)">Max 16 characters. Changes are sent to Wing automatically.</div>
    </div>`;
  // Auto-focus
  requestAnimationFrame(() => document.getElementById('cs-name-input')?.focus());
}
function _csNameChanged(val, force) {
  const ch = _csGetStrip();
  if (!ch) return;
  ch.name = val;
  // Update name boxes in mixer
  const nameEl = document.getElementById(`name-${_csStripType}-${_csId}`);
  if (nameEl) nameEl.textContent = val || `${_csStripType.toUpperCase()} ${_csId}`;
  document.getElementById('csChName').textContent = val || `${_csStripType.toUpperCase()} ${_csId}`;
  // Send to Wing
  _csOSC('name', val);
}

function _csRenderHomeTags(el, ch) {
  // DCA groups as tag toggles
  const dcas = state.dca || [];
  el.innerHTML = `
    <div class="cs-section">
      <div class="cs-section-title">DCA GROUPS</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;max-width:500px;">
        ${dcas.map((dca,i) => {
          const n = i+1;
          const inGrp = ch.dcaGroups?.includes(n) || false;
          return `<div onclick="_csToggleDCA(${n})"
            style="padding:8px;background:${inGrp?'rgba(245,166,35,.15)':'var(--bg-surface)'};
            border:1px solid ${inGrp?'var(--amber)':'var(--border)'};border-radius:3px;
            cursor:pointer;text-align:center;">
            <div style="font-size:9px;color:${inGrp?'var(--amber)':'var(--text-muted)'};font-weight:700;letter-spacing:.5px">DCA ${n}</div>
            <div style="font-size:11px;color:var(--text-dim);margin-top:2px">${dca.name||'DCA '+n}</div>
          </div>`;
        }).join('')}
      </div>
    </div>
    <div class="cs-section">
      <div class="cs-section-title">MUTE GROUPS</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;max-width:320px;">
        ${[1,2,3,4,5,6,7,8].map(n => {
          const inGrp = ch.muteGroups?.includes(n) || false;
          return `<div onclick="_csToggleMuteGroup(${n})"
            style="padding:8px;background:${inGrp?'rgba(232,64,64,.15)':'var(--bg-surface)'};
            border:1px solid ${inGrp?'var(--red-dim)':'var(--border)'};border-radius:3px;
            cursor:pointer;text-align:center;">
            <div style="font-size:9px;color:${inGrp?'var(--red)':'var(--text-muted)'};font-weight:700">MGRP ${n}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}
function _csToggleDCA(n) {
  const ch = _csGetStrip(); if (!ch) return;
  ch.dcaGroups = ch.dcaGroups || [];
  const idx = ch.dcaGroups.indexOf(n);
  if (idx >= 0) ch.dcaGroups.splice(idx,1); else ch.dcaGroups.push(n);
  _csRenderHomeTags(document.getElementById('csHomeBody'), ch);
}
function _csToggleMuteGroup(n) {
  const ch = _csGetStrip(); if (!ch) return;
  ch.muteGroups = ch.muteGroups || [];
  const idx = ch.muteGroups.indexOf(n);
  if (idx >= 0) ch.muteGroups.splice(idx,1); else ch.muteGroups.push(n);
  _csRenderHomeTags(document.getElementById('csHomeBody'), ch);
}

// ────────────────────────────────────────────────────────────────────────────
// GAIN section (Channel Input, Trim & Balance, Filter)
// ────────────────────────────────────────────────────────────────────────────
function _csRenderGain(el, ch) {
  const gain  = ch.gain  ?? 0;
  const trim  = ch.trim  ?? 0;
  const pan   = ch.pan   ?? 0;
  const gainPct = Math.round(Math.max(0,Math.min(100,((gain+10)/75)*100)));
  const trimPct = Math.round(Math.max(0,Math.min(100,((trim+18)/36)*100)));
  const panPct  = Math.round((pan + 1) * 50);
  el.innerHTML = `
    <div class="cs-section">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
        <!-- CHANNEL INPUT -->
        <div>
          <div class="cs-section-title">CHANNEL INPUT</div>
          <div class="cs-param">
            <div class="cs-param-label">GAIN</div>
            <div class="cs-param-val" id="cs-gain-val">${gain.toFixed(1)} dB</div>
            <input type="range" class="cs-slider" min="0" max="100" value="${gainPct}"
              oninput="_csSlider('gain',this.value,-10,65,'cs-gain-val',v=>v.toFixed(1)+' dB')">
          </div>
          <div style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap;">
            <div class="cs-param">
              <div class="cs-param-label">48V</div>
              <button class="cs-toggle ${ch.phantom?'on':''}" onclick="_csToggleBool('phantom')">${ch.phantom?'ON':'OFF'}</button>
            </div>
            <div class="cs-param">
              <div class="cs-param-label">PAD</div>
              <button class="cs-toggle ${ch.pad?'on':''}" onclick="_csToggleBool('pad')">${ch.pad?'ON':'OFF'}</button>
            </div>
            <div class="cs-param">
              <div class="cs-param-label">INVERT</div>
              <button class="cs-toggle ${ch.invert?'on':''}" onclick="_csToggleBool('invert')">${ch.invert?'ON':'OFF'}</button>
            </div>
          </div>
        </div>
        <!-- TRIM & BALANCE -->
        <div>
          <div class="cs-section-title">TRIM &amp; BALANCE</div>
          <div class="cs-param">
            <div class="cs-param-label">TRIM</div>
            <div class="cs-param-val" id="cs-trim-val">${trim.toFixed(1)} dB</div>
            <input type="range" class="cs-slider" min="0" max="100" value="${trimPct}"
              oninput="_csSlider('trim',this.value,-18,18,'cs-trim-val',v=>v.toFixed(1)+' dB')">
          </div>
          <div class="cs-param" style="margin-top:10px;">
            <div class="cs-param-label">BALANCE / PAN</div>
            <div class="cs-param-val" id="cs-pan-val">${pan===0?'C':((pan>0?'R':'L')+Math.abs(Math.round(pan*100)))}</div>
            <input type="range" class="cs-slider" min="0" max="100" value="${panPct}"
              oninput="_csPanSlider(this.value)">
          </div>
        </div>
        <!-- FILTER -->
        <div>
          <div class="cs-section-title">FILTER</div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <button class="cs-toggle ${ch.locut?'on':''}" onclick="_csToggleBool('locut');_csShowSection('gain')">LO CUT</button>
            <button class="cs-toggle ${ch.hicut?'on':''}" onclick="_csToggleBool('hicut');_csShowSection('gain')">HI CUT</button>
            <button class="cs-toggle" style="background:var(--bg-raised);color:var(--text-muted)" disabled>TILT EQ</button>
          </div>
        </div>
      </div>
    </div>`;
}
function _csToggleBool(key) {
  const ch = _csGetStrip(); if (!ch) return;
  ch[key] = !ch[key];
}
function _csPanSlider(v) {
  const pan = (v/50 - 1);
  const ch = _csGetStrip(); if (ch) ch.pan = pan;
  const label = document.getElementById('cs-pan-val');
  if (label) label.textContent = pan===0?'C':((pan>0?'R':'L')+Math.abs(Math.round(pan*100)));
  sendPan(_csStripType, _csId, pan);
}

// ────────────────────────────────────────────────────────────────────────────
// GATE section
// ────────────────────────────────────────────────────────────────────────────
function _csRenderGate(el, ch) {
  const gate = ch.gate || {on:false, thr:-40, range:60, att:0, rel:100};
  const thrPct   = Math.round(((gate.thr+80)/80)*100);
  const rangePct = Math.round((gate.range/60)*100);
  const attPct   = Math.round((gate.att/120)*100);
  const relPct   = Math.round(Math.log10(Math.max(4,gate.rel)/4)/Math.log10(1000)*100);
  el.innerHTML = `
    <div class="cs-section">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
        <button class="cs-toggle ${gate.on?'on':''}" style="padding:6px 24px;font-size:13px;"
          onclick="_csSendToggle('gate/on',${!gate.on})">${gate.on?'ON':'OFF'}</button>
        <span style="font-size:13px;font-weight:700;color:var(--text-dim);letter-spacing:1px">GATE MODEL: WING GATE</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div>
          <canvas class="cs-graph" id="cs-gate-graph" height="180"></canvas>
        </div>
        <div>
          <div style="display:flex;flex-direction:column;gap:12px;">
            <div class="cs-param">
              <div class="cs-param-label">THRESHOLD</div>
              <div class="cs-param-val" id="cs-gate-thr-val">${gate.thr.toFixed(1)} dB</div>
              <input type="range" class="cs-slider" min="0" max="100" value="${thrPct}"
                oninput="_csGateParam('thr',this.value,-80,0,'cs-gate-thr-val',v=>v.toFixed(1)+' dB')">
            </div>
            <div class="cs-param">
              <div class="cs-param-label">RANGE</div>
              <div class="cs-param-val" id="cs-gate-range-val">${gate.range.toFixed(1)} dB</div>
              <input type="range" class="cs-slider" min="0" max="100" value="${rangePct}"
                oninput="_csGateParam('range',this.value,3,60,'cs-gate-range-val',v=>v.toFixed(1)+' dB')">
            </div>
            <div class="cs-param">
              <div class="cs-param-label">ATTACK</div>
              <div class="cs-param-val" id="cs-gate-att-val">${gate.att.toFixed(1)} ms</div>
              <input type="range" class="cs-slider" min="0" max="100" value="${attPct}"
                oninput="_csGateParam('att',this.value,0,120,'cs-gate-att-val',v=>v.toFixed(1)+' ms')">
            </div>
            <div class="cs-param">
              <div class="cs-param-label">RELEASE</div>
              <div class="cs-param-val" id="cs-gate-rel-val">${gate.rel.toFixed(0)} ms</div>
              <input type="range" class="cs-slider" min="0" max="100" value="${relPct}"
                oninput="_csGateParam('rel',this.value,4,4000,'cs-gate-rel-val',v=>v.toFixed(0)+' ms')">
            </div>
          </div>
        </div>
      </div>
    </div>`;
  requestAnimationFrame(() => _csDrawGateGraph(gate));
}
function _csDrawGateGraph(gate) {
  const c = document.getElementById('cs-gate-graph'); if (!c) return;
  c.width = c.offsetWidth;
  const ctx = c.getContext('2d'), W=c.width, H=c.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = 'var(--bg-deep)'; ctx.fillRect(0,0,W,H);
  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,.04)'; ctx.lineWidth=1;
  for (let i=1; i<4; i++) { ctx.beginPath(); ctx.moveTo(0,i*H/4); ctx.lineTo(W,i*H/4); ctx.stroke(); }
  for (let i=1; i<4; i++) { ctx.beginPath(); ctx.moveTo(i*W/4,0); ctx.lineTo(i*W/4,H); ctx.stroke(); }
  // Threshold line
  const thr = gate?.thr ?? -40;
  const tx = W * (1 - Math.abs(thr)/80);
  ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.setLineDash([3,3]);
  ctx.beginPath(); ctx.moveTo(tx,0); ctx.lineTo(tx,H); ctx.stroke();
  ctx.setLineDash([]);
  // Transfer curve
  const on = gate?.on;
  ctx.strokeStyle = on ? '#4a9eff' : '#3a3d45';
  ctx.lineWidth = 2;
  const grad = ctx.createLinearGradient(0,0,0,H);
  grad.addColorStop(0, on?'rgba(74,158,255,.2)':'rgba(58,61,69,.1)');
  grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(0, H); ctx.lineTo(tx, H*0.18); ctx.lineTo(W, 0);
  ctx.stroke();
  ctx.lineTo(W,H); ctx.closePath(); ctx.fill();
  // dB labels
  ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.font='9px Barlow Condensed';
  ctx.textAlign='left';
  [-10,-20,-30,-40,-50,-60,-70].forEach(db => {
    const y = H * (1 - (db+80)/80);
    if (y > 5 && y < H-5) ctx.fillText(`${db}`, 3, y+3);
  });
}
function _csGateParam(key, sliderVal, min, max, labelId, fmt) {
  const raw = min + (sliderVal/100)*(max-min);
  const ch  = _csGetStrip(); if (!ch) return;
  ch.gate   = ch.gate || {};
  ch.gate[key] = raw;
  const label = document.getElementById(labelId);
  if (label) label.textContent = fmt(raw);
  _csOSC(`gate/${key}`, raw);
  _csDrawGateGraph(ch.gate);
}

// ────────────────────────────────────────────────────────────────────────────
// EQ section
// ────────────────────────────────────────────────────────────────────────────
function _csRenderEQ(el, ch) {
  const eq    = ch.eq || {on:false, bands:[]};
  const bands = eq.bands || [];
  const BAND_DEFS = [
    {id:'shvL',  label:'LOW SHELF',  freqLabel:'Lo-Cut Freq',  gainLabel:'Gain L',  freqId:'fL',  gainId:'gL',  hasFilter:true},
    {id:'peq1',  label:'PEQ 1',      freqLabel:'Frequency 1',  gainLabel:'Gain 1',  freqId:'f1',  gainId:'g1',  qLabel:'Q 1',  qId:'q1'},
    {id:'peq2',  label:'PEQ 2',      freqLabel:'Frequency 2',  gainLabel:'Gain 2',  freqId:'f2',  gainId:'g2',  qLabel:'Q 2',  qId:'q2'},
    {id:'peq3',  label:'PEQ 3',      freqLabel:'Frequency 3',  gainLabel:'Gain 3',  freqId:'f3',  gainId:'g3',  qLabel:'Q 3',  qId:'q3'},
    {id:'peq4',  label:'PEQ 4',      freqLabel:'Frequency 4',  gainLabel:'Gain 4',  freqId:'f4',  gainId:'g4',  qLabel:'Q 4',  qId:'q4'},
    {id:'shvH',  label:'HIGH SHELF', freqLabel:'Hi-Cut Freq',  gainLabel:'Gain H',  freqId:'fH',  gainId:'gH',  hasFilter:true},
  ];

  // selected band index (0-5)
  if (typeof _csEQSelBand === 'undefined') window._csEQSelBand = 0;

  el.innerHTML = `
    <div style="padding:12px 18px 8px;border-bottom:1px solid var(--border);
      display:flex;align-items:center;gap:12px;flex-shrink:0;">
      <button class="cs-toggle ${eq.on?'on':''}" style="padding:5px 20px;font-size:12px;"
        onclick="_csSendToggle('eq/on',${!eq.on})">EQ ${eq.on?'ON':'OFF'}</button>
      <span style="font-size:10px;color:var(--text-muted);letter-spacing:1px">WING EQ — ${bands.length||6} BANDS</span>
    </div>
    <div style="padding:10px 18px 6px;">
      <canvas class="cs-graph" id="cs-eq-main-graph" height="130"></canvas>
      <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:9px;color:var(--text-muted);">
        <span>20</span><span>50</span><span>100</span><span>200</span><span>500</span>
        <span>1k</span><span>2k</span><span>5k</span><span>10k</span><span>20k</span>
      </div>
    </div>
    <!-- Band selector tabs -->
    <div style="display:flex;border-bottom:1px solid var(--border);padding:0 18px;gap:4px;" id="cs-eq-band-tabs"></div>
    <!-- Active band detail -->
    <div id="cs-eq-band-detail" style="padding:14px 18px;"></div>
  `;

  _csEQRenderBandTabs(bands);
  _csEQRenderBandDetail(bands, _csEQSelBand);

  requestAnimationFrame(() => {
    const c = document.getElementById('cs-eq-main-graph');
    if (c) { c.width = c.offsetWidth; drawEqMain(bands); }
  });
}

const _CS_EQ_BAND_NAMES = ['Low Shelf','PEQ 1','PEQ 2','PEQ 3','PEQ 4','High Shelf'];

function _csEQRenderBandTabs(bands) {
  const tabsEl = document.getElementById('cs-eq-band-tabs');
  if (!tabsEl) return;
  tabsEl.innerHTML = _CS_EQ_BAND_NAMES.map((name, i) => {
    const b   = bands[i] || {g:0};
    const g   = b.g || 0;
    const col = g > 0.5 ? 'var(--green)' : g < -0.5 ? 'var(--red)' : 'var(--text-muted)';
    return `<div onclick="_csEQSelBand=${i};_csEQRenderBandTabs(_csGetStrip()?.eq?.bands||[]);_csEQRenderBandDetail(_csGetStrip()?.eq?.bands||[],${i})"
      style="padding:7px 10px;font-size:9px;font-weight:700;letter-spacing:.5px;cursor:pointer;
      border-bottom:2px solid ${window._csEQSelBand===i?'var(--orange)':'transparent'};
      color:${window._csEQSelBand===i?'var(--orange)':col};transition:all .1s;white-space:nowrap">
      ${name}
    </div>`;
  }).join('');
}

function _csEQRenderBandDetail(bands, idx) {
  const el = document.getElementById('cs-eq-band-detail');
  if (!el) return;
  const b       = bands[idx] || {g:0, f:1000, q:0.7};
  const g       = typeof b.g === 'number' ? b.g : 0;
  const freq    = typeof b.f === 'number' ? b.f : 1000;
  const q       = typeof b.q === 'number' ? b.q : 0.7;
  const gPct    = Math.round(((g+15)/30)*100);
  const fPct    = Math.round(Math.log10(freq/20)/Math.log10(20000/20)*100);
  const qPct    = Math.round(((q-0.1)/(8-0.1))*100);
  const fDisp   = freq >= 1000 ? (freq/1000).toFixed(2)+'k Hz' : freq.toFixed(0)+' Hz';
  const isShelf = (idx === 0 || idx === 5);
  const isLo    = (idx === 0);
  const isHi    = (idx === 5);
  const ch      = _csGetStrip() || {};
  const gCol    = g > 0.5 ? 'var(--green)' : g < -0.5 ? 'var(--red)' : 'var(--text-dim)';
  const gLbl    = isLo ? 'GAIN L' : isHi ? 'GAIN H' : 'GAIN ' + idx;
  const fLbl    = isLo ? 'FREQ L' : isHi ? 'FREQ H' : 'FREQ ' + idx;

  const div = document.createElement('div');
  div.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:14px;max-width:680px;';

  // Filter column (lo-shelf or hi-shelf)
  if (isLo || isHi) {
    const key     = isLo ? 'locut' : 'hicut';
    const enabled = isLo ? !!ch.locut : !!ch.hicut;
    const label   = isLo ? 'LO-CUT' : 'HI-CUT';
    const desc    = isLo
      ? (enabled ? 'Cutting below ' + fDisp : 'Lo-cut filter off')
      : (enabled ? 'Cutting above ' + fDisp : 'Hi-cut filter off');
    const col  = document.createElement('div');
    col.className = 'cs-param';
    const statusSpan = document.createElement('span');
    statusSpan.style.color = enabled ? 'var(--green)' : 'var(--text-muted)';
    statusSpan.textContent = enabled ? 'ENABLED' : 'DISABLED';
    const lbl = document.createElement('div');
    lbl.className = 'cs-param-label';
    lbl.appendChild(document.createTextNode(label + ' '));
    lbl.appendChild(statusSpan);
    const btn = document.createElement('button');
    btn.className = 'cs-toggle' + (enabled ? ' on' : '');
    btn.textContent = label + (enabled ? ' ON' : ' OFF');
    btn.addEventListener('click', function() {
      const ch2 = _csGetStrip(); if (!ch2) return;
      ch2[key] = !ch2[key];
      _csShowSection('eq');
    });
    const descDiv = document.createElement('div');
    descDiv.style.cssText = 'font-size:10px;color:var(--text-muted);margin-top:4px';
    descDiv.textContent = desc;
    col.appendChild(lbl); col.appendChild(btn); col.appendChild(descDiv);
    div.appendChild(col);
  }

  // Gain column
  const gCol2 = document.createElement('div');
  gCol2.className = 'cs-param';
  gCol2.innerHTML = '<div class="cs-param-label">' + gLbl + '</div>'
    + '<div class="cs-param-val" id="cs-eq-g-disp" style="color:' + gCol + '">' + (g>=0?'+':'') + g.toFixed(1) + ' dB</div>'
    + '<input type="range" class="cs-slider" min="0" max="100" value="' + gPct + '">'
    + '<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text-muted);margin-top:2px">'
    + '<span>-15 dB</span><span>0</span><span>+15 dB</span></div>';
  gCol2.querySelector('input').addEventListener('input', function() { _csEQBand(idx,'g',this.value); });
  div.appendChild(gCol2);

  // Frequency column
  const fCol = document.createElement('div');
  fCol.className = 'cs-param';
  fCol.innerHTML = '<div class="cs-param-label">' + fLbl + '</div>'
    + '<div class="cs-param-val" id="cs-eq-f-disp" style="color:var(--cyan)">' + fDisp + '</div>'
    + '<input type="range" class="cs-slider" min="0" max="100" value="' + fPct + '">'
    + '<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text-muted);margin-top:2px">'
    + '<span>20Hz</span><span>1kHz</span><span>20kHz</span></div>';
  fCol.querySelector('input').addEventListener('input', function() { _csEQBand(idx,'f',this.value); });
  div.appendChild(fCol);

  // Q column (PEQ bands only)
  if (!isShelf) {
    const qCol = document.createElement('div');
    qCol.className = 'cs-param';
    qCol.innerHTML = '<div class="cs-param-label">Q ' + idx + '</div>'
      + '<div class="cs-param-val" id="cs-eq-q-disp" style="color:var(--amber)">' + q.toFixed(2) + '</div>'
      + '<input type="range" class="cs-slider" min="0" max="100" value="' + qPct + '">'
      + '<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text-muted);margin-top:2px">'
      + '<span>0.1</span><span>Narrow</span><span>8.0</span></div>';
    qCol.querySelector('input').addEventListener('input', function() { _csEQBand(idx,'q',this.value); });
    div.appendChild(qCol);
  }

  el.innerHTML = '';
  el.appendChild(div);
}


function _csEQBand(bandIdx, attr, sliderVal) {
  const ch = _csGetStrip(); if (!ch) return;
  ch.eq = ch.eq || {on:false, bands:[]};
  while (ch.eq.bands.length <= bandIdx) ch.eq.bands.push({g:0,f:1000,q:0.7});
  const band  = ch.eq.bands[bandIdx];
  const ranges = {g:[-15,15], f:[20,20000], q:[0.1,8]};
  const range  = ranges[attr] || [0,1];
  // Frequency uses log scale
  let raw;
  if (attr === 'f') {
    raw = 20 * Math.pow(20000/20, sliderVal/100);
  } else {
    raw = range[0] + (sliderVal/100)*(range[1]-range[0]);
  }
  band[attr] = raw;
  _csOSC(`eq/${bandIdx+1}${attr}`, raw);
  // Update detail display labels
  if (attr === 'g') {
    const el = document.getElementById('cs-eq-g-disp');
    if (el) { el.textContent = (raw>=0?'+':'')+raw.toFixed(1)+' dB'; el.style.color = raw>0?'var(--green)':raw<0?'var(--red)':'var(--text-dim)'; }
  } else if (attr === 'f') {
    const el = document.getElementById('cs-eq-f-disp');
    if (el) el.textContent = raw>=1000?(raw/1000).toFixed(2)+'k Hz':raw.toFixed(0)+' Hz';
  } else if (attr === 'q') {
    const el = document.getElementById('cs-eq-q-disp');
    if (el) el.textContent = raw.toFixed(2);
  }
  // Redraw main EQ graph
  const c = document.getElementById('cs-eq-main-graph');
  if (c) { c.width = c.offsetWidth; drawEqMain(ch.eq.bands); }
  // Refresh band tabs to update gain color
  _csEQRenderBandTabs(ch.eq.bands);
}

// ────────────────────────────────────────────────────────────────────────────
// DYNAMICS section
// ────────────────────────────────────────────────────────────────────────────
function _csRenderDynamics(el, ch) {
  const dyn   = ch.dyn || {on:false, thr:-20, ratio:'4.0', att:10, hld:20, rel:100, knee:0, gain:0};
  const thr   = typeof dyn.thr   === 'number' ? dyn.thr   : -20;
  const ratio = parseFloat(dyn.ratio) || 4;
  const att   = typeof dyn.att   === 'number' ? dyn.att   : 10;
  const hld   = typeof dyn.hld   === 'number' ? dyn.hld   : 20;
  const rel   = typeof dyn.rel   === 'number' ? dyn.rel   : 100;
  const knee  = typeof dyn.knee  === 'number' ? dyn.knee  : 0;
  const gain  = typeof dyn.gain  === 'number' ? dyn.gain  : 0;
  const thrPct  = Math.round(((thr+60)/60)*100);
  const ratioPct= Math.round(Math.log(ratio/1.1)/Math.log(100/1.1)*100);
  const attPct  = Math.round((att/200)*100);
  const hldPct  = Math.round((hld/2000)*100);
  const relPct  = Math.round(Math.log(rel/4)/Math.log(3000/4)*100);
  const kneePct = Math.round((knee/5)*100);
  el.innerHTML = `
    <div style="padding:10px 18px 8px;border-bottom:1px solid var(--border);
      display:flex;align-items:center;gap:12px;">
      <button class="cs-toggle ${dyn.on?'on':''}" style="padding:5px 20px;font-size:12px;"
        onclick="_csSendToggle('dyn/on',${!dyn.on})">COMP ${dyn.on?'ON':'OFF'}</button>
      <span style="font-size:10px;color:var(--text-muted);letter-spacing:1px">WING COMPRESSOR</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;flex:1;">
      <!-- Left: transfer curve -->
      <div style="padding:14px 18px;border-right:1px solid var(--border);">
        <div style="font-size:10px;font-weight:700;color:var(--text-muted);letter-spacing:1px;margin-bottom:8px;">TRANSFER CURVE</div>
        <canvas class="cs-graph" id="cs-dyn-graph" height="160"></canvas>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;">
          <div class="cs-param">
            <div class="cs-param-label">THRESHOLD</div>
            <div class="cs-param-val" id="cs-dyn-thr-val">${thr.toFixed(1)} dB</div>
            <input type="range" class="cs-slider" min="0" max="100" value="${thrPct}"
              oninput="_csDynParam('thr',this.value,-60,0,'cs-dyn-thr-val',v=>v.toFixed(1)+' dB')">
          </div>
          <div class="cs-param">
            <div class="cs-param-label">RATIO</div>
            <div class="cs-param-val" id="cs-dyn-ratio-val">${ratio.toFixed(1)}:1</div>
            <input type="range" class="cs-slider" min="0" max="100" value="${ratioPct}"
              oninput="_csDynParam('ratio',this.value,1.1,100,'cs-dyn-ratio-val',v=>v.toFixed(1)+':1')">
          </div>
          <div class="cs-param">
            <div class="cs-param-label">KNEE</div>
            <div class="cs-param-val" id="cs-dyn-knee-val">${knee}</div>
            <input type="range" class="cs-slider" min="0" max="100" value="${kneePct}"
              oninput="_csDynParam('knee',this.value,0,5,'cs-dyn-knee-val',v=>Math.round(v).toString())">
          </div>
          ${gain !== 0 ? `<div class="cs-param"><div class="cs-param-label">MAKE-UP GAIN</div>
            <div class="cs-param-val" style="color:var(--green)">${gain>=0?'+':''}${gain.toFixed(1)} dB</div></div>` : ''}
        </div>
      </div>
      <!-- Right: envelope -->
      <div style="padding:14px 18px;">
        <div style="font-size:10px;font-weight:700;color:var(--text-muted);letter-spacing:1px;margin-bottom:8px;">ENVELOPE</div>
        <canvas class="cs-graph" id="cs-env-graph" height="140"></canvas>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:12px;">
          <div class="cs-param">
            <div class="cs-param-label">ATTACK</div>
            <div class="cs-param-val" id="cs-dyn-att-val" style="color:var(--blue)">${att.toFixed(1)} ms</div>
            <input type="range" class="cs-slider" min="0" max="100" value="${attPct}"
              oninput="_csDynEnvParam('att',this.value,0,200,'cs-dyn-att-val',v=>v.toFixed(1)+' ms')">
          </div>
          <div class="cs-param">
            <div class="cs-param-label">HOLD</div>
            <div class="cs-param-val" id="cs-dyn-hld-val" style="color:var(--amber)">${hld.toFixed(0)} ms</div>
            <input type="range" class="cs-slider" min="0" max="100" value="${hldPct}"
              oninput="_csDynEnvParam('hld',this.value,0,2000,'cs-dyn-hld-val',v=>v.toFixed(0)+' ms')">
          </div>
          <div class="cs-param">
            <div class="cs-param-label">RELEASE</div>
            <div class="cs-param-val" id="cs-dyn-rel-val" style="color:var(--cyan)">${rel.toFixed(0)} ms</div>
            <input type="range" class="cs-slider" min="0" max="100" value="${relPct}"
              oninput="_csDynEnvParam('rel',this.value,4,3000,'cs-dyn-rel-val',v=>v.toFixed(0)+' ms')">
          </div>
        </div>
      </div>
    </div>`;

  requestAnimationFrame(() => {
    _csDrawDynGraph(dyn);
    _csDrawEnvelopeGraph(dyn);
  });
}

function _csDrawEnvelopeGraph(dyn) {
  const c = document.getElementById('cs-env-graph'); if (!c) return;
  c.width = c.offsetWidth;
  const ctx = c.getContext('2d'), W = c.width, H = c.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = 'var(--bg-deep)'; ctx.fillRect(0,0,W,H);
  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,.04)'; ctx.lineWidth = 1;
  for (let i=1;i<4;i++){ctx.beginPath();ctx.moveTo(0,i*H/4);ctx.lineTo(W,i*H/4);ctx.stroke();}

  const att = typeof dyn?.att === 'number' ? dyn.att : 10;
  const hld = typeof dyn?.hld === 'number' ? dyn.hld : 20;
  const rel = typeof dyn?.rel === 'number' ? dyn.rel : 100;
  const total = att + hld + rel;
  const aW  = (att  / total) * (W - 20);   // attack x width
  const hW  = (hld  / total) * (W - 20);   // hold x width
  const rW  = (rel  / total) * (W - 20);   // release x width
  const top = H * 0.15;
  const bot = H * 0.85;
  const mid = (bot + top) / 2;

  // Attack: rises left slope
  const x0 = 10;
  const x1 = x0 + aW;
  const x2 = x1 + hW;
  const x3 = x2 + rW;

  // Fill under the envelope
  const grad = ctx.createLinearGradient(0, top, 0, bot);
  grad.addColorStop(0, 'rgba(61,220,132,.25)');
  grad.addColorStop(1, 'rgba(61,220,132,.05)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(x0, bot);
  ctx.lineTo(x1, top);   // attack
  ctx.lineTo(x2, top);   // hold
  ctx.lineTo(x3, bot);   // release
  ctx.lineTo(x3, bot);
  ctx.closePath();
  ctx.fill();

  // Envelope line
  ctx.strokeStyle = '#3ddc84'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, bot);
  ctx.lineTo(x1, top);   // left slope = attack
  ctx.lineTo(x2, top);   // top = hold
  ctx.lineTo(x3, bot);   // right slope = release
  ctx.stroke();

  // Control point circles
  [[x0,bot],[x1,top],[x2,top],[x3,bot]].forEach(([x,y]) => {
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI*2);
    ctx.fillStyle = 'var(--bg-raised)'; ctx.fill();
    ctx.strokeStyle = '#3ddc84'; ctx.lineWidth = 2; ctx.stroke();
  });

  // Labels at bottom
  ctx.fillStyle = 'rgba(255,255,255,.4)';
  ctx.font = 'bold 8px Barlow Condensed';
  ctx.textAlign = 'center';
  ctx.fillText('ATK', x0 + aW/2, H-3);
  ctx.fillText('HLD', x1 + hW/2, H-3);
  ctx.fillText('REL', x2 + rW/2, H-3);

  // Vertical separators
  ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.lineWidth=1; ctx.setLineDash([2,2]);
  [x1,x2].forEach(x => { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); });
  ctx.setLineDash([]);
}

function _csDynEnvParam(key, sliderVal, min, max, labelId, fmt) {
  let raw;
  if (key === 'rel') {
    raw = 4 * Math.pow(3000/4, sliderVal/100);
  } else {
    raw = min + (sliderVal/100)*(max-min);
  }
  const ch = _csGetStrip(); if (!ch) return;
  ch.dyn = ch.dyn || {};
  ch.dyn[key] = raw;
  const label = document.getElementById(labelId);
  if (label) label.textContent = fmt(raw);
  _csOSC(`dyn/${key}`, raw);
  _csDrawEnvelopeGraph(ch.dyn);
}

function _csDrawDynGraph(dyn) {
  const c = document.getElementById('cs-dyn-graph'); if (!c) return;
  c.width = c.offsetWidth;
  const ctx = c.getContext('2d'), W=c.width, H=c.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='var(--bg-deep)'; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle='rgba(255,255,255,.04)'; ctx.lineWidth=1;
  for (let i=1; i<4; i++) { ctx.beginPath(); ctx.moveTo(0,i*H/4); ctx.lineTo(W,i*H/4); ctx.stroke(); }
  for (let i=1; i<4; i++) { ctx.beginPath(); ctx.moveTo(i*W/4,0); ctx.lineTo(i*W/4,H); ctx.stroke(); }
  const thr   = dyn?.thr ?? -20;
  const ratio = parseFloat(dyn?.ratio) || 4;
  const on    = dyn?.on;
  const tx    = W * (1 + thr/60);
  ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.setLineDash([3,3]);
  ctx.beginPath(); ctx.moveTo(tx,0); ctx.lineTo(tx,H); ctx.stroke();
  ctx.setLineDash([]);
  const col = on ? '#e8820a' : '#3a3d45';
  const grad = ctx.createLinearGradient(0,H,W,0);
  grad.addColorStop(0, on?'rgba(232,130,10,.08)':'rgba(58,61,69,.05)');
  grad.addColorStop(1, on?'rgba(232,130,10,.25)':'rgba(58,61,69,.1)');
  ctx.fillStyle = grad;
  ctx.strokeStyle = col; ctx.lineWidth=2;
  ctx.beginPath();
  ctx.moveTo(0,H); ctx.lineTo(tx, H-tx); ctx.lineTo(W, H-tx-(W-tx)/ratio);
  ctx.stroke();
  ctx.lineTo(W,H); ctx.closePath(); ctx.fill();
  ctx.fillStyle='rgba(255,255,255,.3)'; ctx.font='9px Barlow Condensed'; ctx.textAlign='left';
  [-10,-20,-30,-40,-50].forEach(db => {
    const y = H*(1-(db+60)/60);
    if(y>5&&y<H-5) ctx.fillText(`${db}`,3,y+3);
  });
}
function _csDynParam(key, sliderVal, min, max, labelId, fmt) {
  const raw = min + (sliderVal/100)*(max-min);
  const ch  = _csGetStrip(); if (!ch) return;
  ch.dyn    = ch.dyn || {};
  ch.dyn[key] = raw;
  const label = document.getElementById(labelId);
  if (label) label.textContent = fmt(raw);
  _csOSC(`dyn/${key}`, raw);
  _csDrawDynGraph(ch.dyn);
}

// ────────────────────────────────────────────────────────────────────────────
// INSERT 1 & 2
// ────────────────────────────────────────────────────────────────────────────
function _csRenderInsert(el, ch, num) {
  const ins  = ch[`ins${num}`] || {on:false, type:'NONE'};
  el.innerHTML = `
    <div class="cs-section">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
        <button class="cs-toggle ${ins.on?'on':''}" style="padding:6px 24px;font-size:13px;"
          onclick="_csToggleInsert(${num})">${ins.on?'ON':'OFF'}</button>
        <span style="font-size:13px;font-weight:700;color:var(--text-dim);letter-spacing:1px">FX PROCESSOR — INSERT ${num}</span>
      </div>
      <div class="cs-insert-slot">
        <div class="cs-insert-label">FX TYPE</div>
        <div class="cs-insert-val">${ins.type || 'NONE'}</div>
      </div>
      <div style="margin-top:16px;color:var(--text-muted);font-size:12px;padding:0 4px;">
        FX processor assignment and parameters are managed from the Effects view.
        Enable/disable the insert here.
      </div>
    </div>`;
}
function _csToggleInsert(num) {
  const ch = _csGetStrip(); if (!ch) return;
  const key = `ins${num}`;
  ch[key] = ch[key] || {on:false, type:'NONE'};
  ch[key].on = !ch[key].on;
  _csShowSection(`insert${num}`);
  _csRenderNavRail();
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN SENDS & PANNING
// ────────────────────────────────────────────────────────────────────────────
function _csRenderMainSends(el, ch) {
  const mains = state.mains || [];
  el.innerHTML = `
    <div class="cs-section">
      <div class="cs-section-title">MAIN SENDS &amp; PANNING</div>
      <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start;">
        <!-- Main faders — fixed column width so dB label never shifts layout -->
        <div style="display:flex;gap:10px;align-items:flex-start;flex-shrink:0;">
          ${mains.slice(0,4).map((m,i) => {
            const n    = i+1;
            const send = ch.mainSends?.[n] || {on:true, lvl:0.75};
            const lvlPct = Math.round((send.lvl||0.75)*100);
            const db   = faderToDb(send.lvl||0.75);
            return `<div style="display:flex;flex-direction:column;align-items:center;gap:5px;width:56px;">
              <div style="font-size:9px;font-weight:700;letter-spacing:.5px;color:var(--text-muted)">M${n}</div>
              <div style="font-size:10px;color:var(--cyan);font-family:monospace;
                width:52px;text-align:center;overflow:hidden;
                background:var(--bg-deep);border:1px solid var(--border);
                border-radius:2px;padding:2px 0;" id="cs-msend-val-${n}">${db}</div>
              <div style="height:130px;display:flex;justify-content:center;width:100%;">
                <input type="range" min="0" max="100" value="${lvlPct}"
                  style="writing-mode:vertical-lr;direction:rtl;width:8px;height:130px;
                  cursor:pointer;-webkit-appearance:slider-vertical;appearance:none;
                  background:var(--fader-track);border-radius:4px;outline:none;"
                  oninput="_csMainSend(${n},this.value)">
              </div>
              <button class="cs-bus-on${send.on?' active':''}" id="cs-msend-on-${n}"
                style="width:52px;" onclick="_csMainSendOn(${n})">${send.on?'ON':'OFF'}</button>
              <div style="font-size:9px;color:var(--text-muted);text-align:center;
                overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:52px;"
                title="${m.name||'MAIN '+n}">${m.name||'MAIN '+n}</div>
            </div>`;
          }).join('')}
        </div>
        <!-- Pan scope -->
        <div style="flex:1;min-width:200px;max-width:280px;">
          <div class="cs-param-label" style="margin-bottom:8px;">STEREO PAN</div>
          <canvas id="cs-pan-canvas" class="cs-graph" height="160" style="width:100%;max-width:260px;display:block;"></canvas>
          <div class="cs-param" style="margin-top:10px;max-width:260px;">
            <div class="cs-param-label">PAN —
              <span id="cs-msend-pan-val" style="color:var(--cyan)">${ch.pan===0?'CENTER':((ch.pan>0?'R ':'L ')+Math.abs(Math.round((ch.pan||0)*100)))}</span>
            </div>
            <input type="range" class="cs-slider" min="0" max="100"
              value="${Math.round(((ch.pan||0)+1)*50)}"
              oninput="_csMainPan(this.value)">
          </div>
        </div>
      </div>
    </div>`;
  // Draw pan scope after DOM settles
  requestAnimationFrame(() => _csDrawPanScope(ch.pan || 0));
}

function _csMainPan(sliderVal) {
  const pan = (sliderVal / 50) - 1;
  const ch  = _csGetStrip(); if (!ch) return;
  ch.pan    = pan;
  const label = document.getElementById('cs-msend-pan-val');
  if (label) label.textContent = pan === 0 ? 'CENTER' : ((pan > 0 ? 'R ' : 'L ') + Math.abs(Math.round(pan*100)));
  sendPan(_csStripType, _csId, pan);
  _csDrawPanScope(pan);
}

function _csDrawPanScope(pan) {
  const c = document.getElementById('cs-pan-canvas'); if (!c) return;
  c.width  = c.offsetWidth  || 260;
  c.height = c.offsetHeight || 160;
  const ctx = c.getContext('2d'), W = c.width, H = c.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = 'var(--bg-deep)'; ctx.fillRect(0,0,W,H);

  const cx = W / 2;
  const barY = H * 0.45;
  const barH = 10;
  const barX = 24;
  const barW = W - 48;

  // Track
  ctx.fillStyle = 'var(--border)';
  ctx.beginPath(); ctx.roundRect(barX, barY, barW, barH, 5); ctx.fill();

  // Filled region from center to puck
  const puckX = barX + (barW / 2) * (1 + pan);  // pan -1..+1
  const fillX  = pan >= 0 ? cx : puckX;
  const fillW  = Math.abs(puckX - cx);
  const grad   = ctx.createLinearGradient(fillX, 0, fillX + fillW, 0);
  if (pan >= 0) {
    grad.addColorStop(0, 'rgba(74,158,255,.5)');
    grad.addColorStop(1, 'rgba(74,158,255,.9)');
  } else {
    grad.addColorStop(0, 'rgba(74,158,255,.9)');
    grad.addColorStop(1, 'rgba(74,158,255,.5)');
  }
  ctx.fillStyle = grad;
  if (fillW > 0) {
    ctx.beginPath(); ctx.roundRect(fillX, barY, fillW, barH, 3); ctx.fill();
  }

  // Center tick
  ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx, barY-6); ctx.lineTo(cx, barY+barH+6); ctx.stroke();

  // Puck
  ctx.beginPath(); ctx.arc(puckX, barY + barH/2, 10, 0, Math.PI*2);
  ctx.fillStyle = '#4a9eff'; ctx.fill();
  ctx.strokeStyle = 'var(--bg-panel)'; ctx.lineWidth = 2; ctx.stroke();

  // L / R labels
  ctx.fillStyle = 'rgba(255,255,255,.5)';
  ctx.font = 'bold 11px Barlow Condensed';
  ctx.textAlign = 'center';
  ctx.fillText('L', 12, barY + barH/2 + 4);
  ctx.fillText('R', W - 12, barY + barH/2 + 4);

  // Center label
  ctx.fillStyle = 'rgba(255,255,255,.25)';
  ctx.font = '9px Barlow Condensed';
  ctx.fillText('C', cx, barY + barH + 18);

  // dB scale ticks
  ctx.fillStyle = 'rgba(255,255,255,.2)';
  ctx.font = '8px Barlow Condensed';
  [-100,-50,0,50,100].forEach(v => {
    const x = barX + (barW/2)*(1 + v/100);
    ctx.beginPath(); ctx.moveTo(x, barY+barH+2); ctx.lineTo(x, barY+barH+6); ctx.stroke();
    if (v !== 0) ctx.fillText(Math.abs(v), x, barY+barH+15);
  });
}
function _csMainSend(mainNum, sliderVal) {
  const lvl = sliderVal/100;
  const ch  = _csGetStrip(); if (!ch) return;
  ch.mainSends = ch.mainSends || {};
  ch.mainSends[mainNum] = ch.mainSends[mainNum] || {on:true};
  ch.mainSends[mainNum].lvl = lvl;
  const label = document.getElementById(`cs-msend-val-${mainNum}`);
  if (label) label.textContent = faderToDb(lvl);
  _csOSC(`send/${mainNum}/lvl`, lvl);
}
function _csMainSendOn(mainNum) {
  const ch = _csGetStrip(); if (!ch) return;
  ch.mainSends = ch.mainSends || {};
  ch.mainSends[mainNum] = ch.mainSends[mainNum] || {on:true, lvl:0.75};
  ch.mainSends[mainNum].on = !ch.mainSends[mainNum].on;
  const btn = document.getElementById(`cs-msend-on-${mainNum}`);
  if (btn) { btn.textContent = ch.mainSends[mainNum].on?'ON':'OFF'; btn.classList.toggle('active', ch.mainSends[mainNum].on); }
  _csOSC(`send/${mainNum}/on`, ch.mainSends[mainNum].on ? 1 : 0);
}

// ────────────────────────────────────────────────────────────────────────────
// BUS SENDS
// ────────────────────────────────────────────────────────────────────────────
function _csRenderBusSends(el, ch) {
  const sends  = ch.sends || {};
  el.innerHTML = `
    <div style="padding:10px 18px 6px;border-bottom:1px solid var(--border);
      display:flex;align-items:center;gap:12px;">
      <span style="font-size:10px;font-weight:700;letter-spacing:1px;color:var(--text-muted)">
        BUS SENDS — 16 BUSES
      </span>
    </div>
    <!-- Vertical strips, one per bus, scrollable horizontally -->
    <div style="display:flex;gap:1px;padding:10px 18px;overflow-x:auto;
      align-items:flex-end;min-height:340px;">
      ${Array.from({length:16},(_,i) => {
        const n      = String(i+1);
        const s      = sends[n] || {on:false, lvl:0, tap:'post', panLink:false};
        const lvlPct = Math.round((s.lvl||0)*100);
        const db     = faderToDb(s.lvl||0);
        const busName= (state.buses?.[i]?.name) || ('BUS '+(i+1));
        const tap    = s.tap || 'post';
        const panLnk = s.panLink || false;
        return `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;
          width:58px;min-width:58px;background:var(--bg-panel);
          border:1px solid var(--border);border-radius:3px;padding:5px 3px 6px;flex-shrink:0;">
          <!-- Bus name -->
          <div style="font-size:8px;font-weight:700;color:var(--cyan);letter-spacing:.5px;
            overflow:hidden;white-space:nowrap;text-overflow:ellipsis;width:100%;text-align:center;"
            title="${busName}">${busName}</div>
          <!-- Tap point toggle (PRE / POST) -->
          <div onclick="_csBusTap('${n}')"
            style="font-size:8px;font-weight:700;padding:2px 0;width:100%;text-align:center;
            border-radius:2px;cursor:pointer;border:1px solid var(--border);
            background:${tap==='post'?'rgba(74,158,255,.15)':'rgba(245,166,35,.15)'};
            color:${tap==='post'?'var(--blue)':'var(--amber)'}">
            ${tap.toUpperCase()}</div>
          <!-- DB display — fixed width -->
          <div id="cs-bus-val-${n}"
            style="font-size:9px;font-family:monospace;color:var(--cyan);
            width:52px;text-align:center;background:var(--bg-deep);
            border:1px solid var(--border);border-radius:2px;padding:1px 0;
            overflow:hidden;white-space:nowrap;">${db}</div>
          <!-- Vertical fader -->
          <div style="height:120px;display:flex;align-items:center;justify-content:center;width:100%;margin:2px 0;">
            <input type="range" min="0" max="100" value="${lvlPct}"
              style="writing-mode:vertical-lr;direction:rtl;width:8px;height:120px;
              cursor:pointer;background:var(--fader-track);border-radius:4px;outline:none;"
              oninput="_csBusSend('${n}',this.value)">
          </div>
          <!-- ON/OFF -->
          <div class="cs-bus-on${s.on?' active':''}" id="cs-bus-on-${n}"
            style="width:50px;text-align:center;" onclick="_csBusOn('${n}')">${s.on?'ON':'OFF'}</div>
          <!-- PAN LINK toggle -->
          <div onclick="_csBusPanLink('${n}')"
            style="font-size:8px;font-weight:700;padding:2px 0;width:100%;text-align:center;
            border-radius:2px;cursor:pointer;border:1px solid var(--border);margin-top:2px;
            background:${panLnk?'rgba(61,220,132,.15)':'var(--bg-raised)'};
            color:${panLnk?'var(--green)':'var(--text-muted)'}">
            PAN LNK</div>
        </div>`;
      }).join('')}
    </div>`;
}

function _csBusTap(busNum) {
  const ch = _csGetStrip(); if (!ch) return;
  ch.sends = ch.sends || {};
  ch.sends[busNum] = ch.sends[busNum] || {on:false, lvl:0, tap:'post', panLink:false};
  const cur = ch.sends[busNum].tap || 'post';
  ch.sends[busNum].tap = cur === 'post' ? 'pre' : 'post';
  _csShowSection('bussends');  // re-render to reflect new tap
}

function _csBusPanLink(busNum) {
  const ch = _csGetStrip(); if (!ch) return;
  ch.sends = ch.sends || {};
  ch.sends[busNum] = ch.sends[busNum] || {on:false, lvl:0, tap:'post', panLink:false};
  ch.sends[busNum].panLink = !ch.sends[busNum].panLink;
  _csShowSection('bussends');
}

function _csBusSend(busNum, sliderVal) {
  const lvl = sliderVal/100;
  const ch  = _csGetStrip(); if (!ch) return;
  ch.sends  = ch.sends || {};
  ch.sends[busNum] = ch.sends[busNum] || {on:false};
  ch.sends[busNum].lvl = lvl;
  const label = document.getElementById(`cs-bus-val-${busNum}`);
  if (label) label.textContent = faderToDb(lvl);
  _csOSC(`send/${busNum}/lvl`, lvl);
}
function _csBusOn(busNum) {
  const ch = _csGetStrip(); if (!ch) return;
  ch.sends = ch.sends || {};
  ch.sends[busNum] = ch.sends[busNum] || {on:false, lvl:0};
  ch.sends[busNum].on = !ch.sends[busNum].on;
  const btn = document.getElementById(`cs-bus-on-${busNum}`);
  if (btn) { btn.textContent = ch.sends[busNum].on?'ON':'OFF'; btn.classList.toggle('active', ch.sends[busNum].on); }
  _csOSC(`send/${busNum}/on`, ch.sends[busNum].on ? 1 : 0);
}