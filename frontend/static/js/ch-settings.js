// Wing Remote v2.3.9 — Channel Settings Panel (Option C: Card Rail + Dashboard)
// ═══════════════════════════════════════════════════════════════════════════
// CHANNEL SETTINGS PANEL
// ═══════════════════════════════════════════════════════════════════════════

let _csStripType = 'ch';
let _csId        = 1;
let _csSection   = 'home';
let _csHomeTab   = 'overview';
window._csEQSelBand = 0;

const CS_COLORS = [
  '#e8b800','#e84040','#3ddc84','#4a9eff',
  '#e8820a','#a855f7','#00d4d4','#ff69b4',
  '#8bc34a','#ff5722','#2196f3','#9c27b0',
  '#607d8b','#795548','#ff9800','#e91e63',
];

const CS_SECTIONS = [
  { id:'home',       label:'HOME',        badge:null    },
  { id:'gain',       label:'INPUT',       badge:null    },
  { id:'gate',       label:'GATE',        badge:'on'    },
  { id:'eq',         label:'EQ',          badge:'on'    },
  { id:'dynamics',   label:'DYNAMICS',    badge:'on'    },
  { id:'insert1',    label:'INSERT 1',    badge:'on'    },
  { id:'insert2',    label:'INSERT 2',    badge:'on'    },
  { id:'mainsends',  label:'MAIN SENDS',  badge:null    },
  { id:'bussends',   label:'BUS SENDS',   badge:null    },
];

// Sections available per strip type.
// Channels have all sections. Aux has dyn (PSE/LA combo) but only one insert (preins).
// Buses, mains, matrix have no gate, no inserts, no input options.
// DCAs have only fader/mute — just home section.
const CS_SECTION_MAP = {
  ch:   ['home','gain','gate','eq','dynamics','insert1','insert2','mainsends','bussends'],
  aux:  ['home','gain','gate','eq','dynamics','insert1',           'mainsends','bussends'],
  bus:  ['home',             'eq','dynamics',                      'mainsends'          ],
  main: ['home',             'eq','dynamics',                      'mainsends'          ],
  mtx:  ['home',             'eq','dynamics',                      'mainsends'          ],
  dca:  ['home'                                                                         ],
};

function _csSectionsForType() {
  const allowed = CS_SECTION_MAP[_csStripType] || CS_SECTION_MAP.ch;
  return CS_SECTIONS.filter(s => allowed.includes(s.id));
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function _csGetStrip() {
  const map = {ch:'channels',aux:'aux',bus:'buses',main:'mains',mtx:'matrix',dca:'dca'};
  const arr = state[map[_csStripType]];
  return arr ? arr[_csId - 1] : null;
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
function _csOSC(subpath, value) {
  sendOSC(`/${_csStripType}/${_csId}/${subpath}`, value);
}

// ── Open / Close ──────────────────────────────────────────────────────────────
function openChSettings(stripType, id) {
  _csStripType = stripType;
  _csId        = id;
  _csSection   = 'home';
  _csHomeTab   = 'overview';
  window._csEQSelBand = 0;

  const ch    = _csGetStrip();
  const layer = LAYERS[stripType];
  if (!ch) return;

  document.getElementById('csChId').textContent   = `${(layer?.prefix || stripType.toUpperCase())} ${id}`;
  document.getElementById('csChName').textContent = ch.name || `${stripType.toUpperCase()} ${id}`;
  const colorBar = document.getElementById('csColorBar');
  if (colorBar) colorBar.style.background = layer?.color || '#e8820a';

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
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('nav-home')?.classList.add('active');
}

// ── Nav Rail (Option C: card rows) ────────────────────────────────────────────
function _csRenderNavRail() {
  const rail = document.getElementById('chNavRail');
  if (!rail) return;
  const ch = _csGetStrip() || {};

  rail.innerHTML = _csSectionsForType().map(sec => {
    const isActive = sec.id === _csSection;
    let badgeHtml  = '';
    if (sec.badge === 'on') {
      const isOn = _csGetOnState(sec.id);
      badgeHtml = `<span class="cs-rail-badge ${isOn?'on':''}">${isOn?'ON':'OFF'}</span>`;
    }
    return `<div class="cs-rail-card${isActive?' active':''}" onclick="_csShowSection('${sec.id}')">
      <canvas class="cs-rail-thumb" id="nav-thumb-${sec.id}" width="80" height="40"></canvas>
      <div class="cs-rail-label">${sec.label}</div>
      ${badgeHtml}
    </div>`;
  }).join('');

  requestAnimationFrame(_csDrawNavThumbs);
}

// ── Nav Thumbnail Drawers ─────────────────────────────────────────────────────
function _csDrawNavThumbs() {
  const ch = _csGetStrip() || {};
  const thumbs = {
    eq:        c => _csThumbEQ(c, ch.eq?.bands || []),
    gate:      c => _csThumbGate(c, ch.gate),
    dynamics:  c => _csThumbDyn(c, ch.dyn),
    home:      c => _csThumbHome(c, ch),
    gain:      c => _csThumbGain(c, ch),
    bussends:  c => _csThumbBus(c, ch),
    mainsends: c => _csThumbMain(c, ch),
    insert1:   c => _csThumbInsert(c, ch.ins1),
    insert2:   c => _csThumbInsert(c, ch.ins2),
  };
  // Only draw thumbs for sections actually present in the current nav rail
  const allowed = new Set((_csSectionsForType()).map(s => s.id));
  Object.entries(thumbs).forEach(([id, fn]) => {
    if (!allowed.has(id)) return;
    const c = document.getElementById(`nav-thumb-${id}`);
    if (c) fn(c);
  });
}

function _csThumbCtx(c) {
  const ctx = c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg-deep').trim() || '#0e0f11';
  ctx.fillStyle = bg; ctx.fillRect(0,0,c.width,c.height);
  return ctx;
}
function _csThumbHome(c, ch) {
  const ctx = _csThumbCtx(c);
  const col = LAYERS[_csStripType]?.color || '#e8820a';
  ctx.fillStyle = col; ctx.globalAlpha = .7; ctx.fillRect(0,0,c.width,3);
  ctx.globalAlpha = .12; ctx.fillRect(0,0,c.width,c.height);
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.font = 'bold 9px Barlow Condensed';
  ctx.textAlign = 'center'; ctx.fillText('HOME', c.width/2, c.height/2+4);
}
// Input Settings Rail Thumb
// Shows the six input_options pills (48V, LC, INV, HC, TILT, DLY)
// lit in accent color when enabled, dim grey when disabled.
function _csThumbGain(c, ch) {
  // Also registered as the Input Settings Rail Thumb on the backend
  const ctx = _csThumbCtx(c);
  const W = c.width, H = c.height;

  const pills = [
    { key:'phantom', label:'48V',  color:[232,184,0]   },
    { key:'locut',   label:'LC',   color:[74,158,255]  },
    { key:'invert',  label:'INV',  color:[232,64,64]   },
    { key:'hicut',   label:'HC',   color:[0,212,212]   },
    { key:'tilt',    label:'TILT', color:[61,220,132]  },
    { key:'delay',   label:'DLY',  color:[232,130,10]  },
  ];

  const cols  = 3;
  const rows  = 2;
  const pw    = Math.floor((W - 8) / cols);
  const ph    = Math.floor((H - 6) / rows);

  pills.forEach((p, i) => {
    const col   = i % cols;
    const row   = Math.floor(i / cols);
    const x     = 4 + col * pw;
    const y     = 3 + row * ph;
    const on    = !!ch[p.key];
    const [r,g,b] = p.color;

    // Pill background
    ctx.fillStyle = on
      ? `rgba(${r},${g},${b},0.25)`
      : 'rgba(255,255,255,0.04)';
    ctx.beginPath();
    ctx.roundRect(x, y, pw - 2, ph - 2, 2);
    ctx.fill();

    // Pill border
    ctx.strokeStyle = on
      ? `rgba(${r},${g},${b},0.8)`
      : 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Label
    ctx.fillStyle = on
      ? `rgb(${r},${g},${b})`
      : 'rgba(255,255,255,0.25)';
    ctx.font = `bold ${p.label.length > 3 ? 7 : 8}px Barlow Condensed, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.label, x + (pw - 2) / 2, y + (ph - 2) / 2);
  });
}
function _csThumbGate(c, gate) {
  const ctx = _csThumbCtx(c);
  const W=c.width, H=c.height, on=gate?.on;
  const thr = gate?.thr ?? -40;
  const tx  = W * (1 - Math.abs(thr)/80);
  ctx.strokeStyle = on ? '#4a9eff' : '#3a3d45'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0,H); ctx.lineTo(tx,H*0.2); ctx.lineTo(W,0); ctx.stroke();
  if (on) {
    ctx.fillStyle = 'rgba(74,158,255,.12)';
    ctx.beginPath(); ctx.moveTo(0,H); ctx.lineTo(tx,H*0.2); ctx.lineTo(W,0); ctx.lineTo(W,H); ctx.closePath(); ctx.fill();
  }
}
function _csThumbDyn(c, dyn) {
  const ctx = _csThumbCtx(c);
  const W=c.width, H=c.height, on=dyn?.on;
  const thr = dyn?.thr ?? -20;
  const ratio = parseFloat(dyn?.ratio) || 4;
  const tx = W * (1 + thr/60);
  ctx.strokeStyle = on ? '#e8820a' : '#3a3d45'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0,H); ctx.lineTo(tx,H-tx); ctx.lineTo(W,H-tx-(W-tx)/ratio); ctx.stroke();
  if (on) {
    ctx.fillStyle = 'rgba(232,130,10,.1)';
    ctx.beginPath(); ctx.moveTo(0,H); ctx.lineTo(tx,H-tx); ctx.lineTo(W,H-tx-(W-tx)/ratio); ctx.lineTo(W,H); ctx.closePath(); ctx.fill();
  }
}
function _csThumbEQ(c, bands) {
  drawEqMini(c, bands, LAYERS[_csStripType]?.color || '#e8820a');
}
function _csThumbBus(c, ch) {
  const ctx = _csThumbCtx(c);
  const sends = ch.sends || {};
  const bw = (c.width-8)/16;
  for (let i=1;i<=16;i++) {
    const s = sends[String(i)] || {lvl:0,on:false};
    const h = (c.height-6)*(s.lvl||0);
    ctx.fillStyle = s.on ? '#e8820a' : '#2a2d34';
    ctx.fillRect(4+(i-1)*bw, c.height-3-h, bw-1, h);
  }
}
function _csThumbMain(c, ch) {
  const ctx = _csThumbCtx(c);
  const pan = ch.pan || 0;
  const px  = c.width/2 + pan*(c.width/2-6);
  ctx.beginPath(); ctx.arc(px, c.height/2, 5, 0, Math.PI*2);
  ctx.fillStyle = '#4a9eff'; ctx.fill();
  ctx.strokeStyle = '#1a1c20'; ctx.lineWidth=1; ctx.stroke();
}
function _csThumbInsert(c, ins) {
  const ctx = _csThumbCtx(c);
  ctx.fillStyle = ins?.on ? '#a855f7' : '#2a2d34';
  ctx.fillRect(4, 4, c.width-8, c.height-8);
  ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = 'bold 8px Barlow Condensed';
  ctx.textAlign = 'center'; ctx.fillText(ins?.type || 'NONE', c.width/2, c.height/2+3);
}

// ── Section Router ────────────────────────────────────────────────────────────
function _csShowSection(sectionId) {
  _csSection = sectionId;
  _csRenderNavRail();
  const contentEl = document.getElementById('chSettingsContent');
  if (!contentEl) return;
  contentEl.innerHTML = '';
  const ch = _csGetStrip() || {};
  switch (sectionId) {
    case 'home':       _csRenderHome(contentEl, ch);      break;
    case 'gain':       _csRenderGain(contentEl, ch);      break;
    case 'gate':       _csRenderGate(contentEl, ch);      break;
    case 'eq':         _csRenderEQ(contentEl, ch);        break;
    case 'dynamics':   _csRenderDynamics(contentEl, ch);  break;
    case 'insert1':    _csRenderInsert(contentEl, ch, 1); break;
    case 'insert2':    _csRenderInsert(contentEl, ch, 2); break;
    case 'mainsends':  _csRenderMainSends(contentEl, ch); break;
    case 'bussends':   _csRenderBusSends(contentEl, ch);  break;
  }
}

// ── Toggle helper ─────────────────────────────────────────────────────────────
// Default values for each sub-object so toggling ON never loses existing params
const _CS_DEFAULTS = {
  gate: {on:false, thr:-40, range:60, att:0, rel:100},
  dyn:  {on:false, thr:-20, ratio:'4.0', att:10, hld:20, rel:100, knee:0, gain:0},
  eq:   {on:false, bands:[]},
  ins1: {on:false, type:'NONE'},
  ins2: {on:false, type:'NONE'},
};

function _csSendToggle(subpath, newState) {
  const ch    = _csGetStrip();
  const parts = subpath.split('/');
  if (ch) {
    if (parts.length === 2) {
      // Merge with defaults so we never lose thr/range/att/rel etc.
      const key     = parts[0];
      const defVals = _CS_DEFAULTS[key] || {};
      ch[key] = Object.assign({}, defVals, ch[key] || {});
      ch[key][parts[1]] = newState;
    } else if (parts.length === 1) {
      ch[parts[0]] = newState;
    }
  }
  _csOSC(subpath, newState ? 1 : 0);
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

// ── Tile helper ───────────────────────────────────────────────────────────────
// Returns a themed inset panel div (bg-deep, border, rounded)
function _csTile(content, extraStyle='') {
  return `<div style="background:var(--bg-deep);border:1px solid var(--border);
    border-radius:4px;padding:12px;${extraStyle}">${content}</div>`;
}
function _csTileLabel(text) {
  return `<div style="font-size:9px;font-weight:700;letter-spacing:1.2px;
    color:var(--text-muted);text-transform:uppercase;margin-bottom:8px;">${text}</div>`;
}
// Param block: label + monospace value + slider
function _csParamBlock(label, valId, valText, sliderPct, onInput, color='var(--cyan)') {
  return `<div>
    <div style="font-size:9px;font-weight:700;letter-spacing:.8px;color:var(--text-muted);
      text-transform:uppercase;margin-bottom:2px;">${label}</div>
    <div id="${valId}" style="font-size:13px;font-weight:700;color:${color};
      font-family:'Share Tech Mono',monospace;margin-bottom:4px;">${valText}</div>
    <input type="range" class="cs-slider" min="0" max="100" value="${sliderPct}"
      oninput="${onInput}">
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// HOME
// ═══════════════════════════════════════════════════════════════════════════
function _csRenderHome(el, ch) {
  const tabs   = ['overview','icon-color','name','tags'];
  const labels = ['OVERVIEW','ICON / COLOR','NAME','TAGS'];
  const tabBar = `<div style="display:flex;border-bottom:1px solid var(--border);
    background:var(--bg-panel);flex-shrink:0;">
    ${tabs.map((t,i) => `<div class="ch-home-tab${_csHomeTab===t?' active':''}"
      onclick="_csHomeTab='${t}';_csRenderHome(document.getElementById('chSettingsContent'),_csGetStrip()||{})">${labels[i]}</div>`
    ).join('')}
  </div>`;
  el.innerHTML = tabBar + '<div id="csHomeBody"></div>';
  const body   = document.getElementById('csHomeBody');
  if      (_csHomeTab === 'overview')   _csRenderHomeOverview(body, ch);
  else if (_csHomeTab === 'icon-color') _csRenderHomeIconColor(body, ch);
  else if (_csHomeTab === 'name')       _csRenderHomeName(body, ch);
  else if (_csHomeTab === 'tags')       _csRenderHomeTags(body, ch);
}

function _csRenderHomeOverview(el, ch) {
  const eq   = ch.eq   || {on:false, bands:[]};
  const gate = ch.gate || {};
  const dyn  = ch.dyn  || {};
  const fdb  = faderToDb(ch.fader || 0.75);

  // Clickable tile helper with nav arrow
  function navTile(title, badge, content, targetSection) {
    const badgeHtml = badge
      ? `<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:2px;
          background:${badge.on?'rgba(61,220,132,.15)':'var(--bg-raised)'};
          color:${badge.on?'var(--green)':'var(--text-muted)'};
          border:1px solid ${badge.on?'var(--green-dim)':'var(--border)'}">${badge.on?'ON':'OFF'}</span>`
      : '';
    return `<div onclick="_csShowSection('${targetSection}')"
      style="background:var(--bg-deep);border:1px solid var(--border);border-radius:4px;
        padding:12px;cursor:pointer;transition:border-color .1s;"
      onmouseover="this.style.borderColor='var(--border-hi)'"
      onmouseout="this.style.borderColor='var(--border)'">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
        <span style="font-size:9px;font-weight:700;letter-spacing:1.2px;color:var(--text-muted);
          text-transform:uppercase">${title}</span>
        ${badgeHtml}
        <span style="margin-left:auto;font-size:10px;color:var(--border-hi)">›</span>
      </div>
      ${content}
    </div>`;
  }

  el.innerHTML = `<div style="padding:14px 18px;display:flex;flex-direction:column;gap:12px;">
    <!-- Row 1: status pills — INPUT → gain, FILTER → eq, MAIN → mainsends -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
      ${navTile('INPUT →', null,
        `<div style="display:flex;gap:6px;flex-wrap:wrap;">
          <span style="font-size:13px;font-weight:700;color:var(--cyan);font-family:'Share Tech Mono',monospace">${fdb}</span>
          <span style="font-size:11px;color:var(--text-dim);align-self:flex-end;margin-bottom:1px">FADER</span>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">
          Gain: ${typeof ch.gain==='number'?ch.gain.toFixed(1)+' dB':'—'} &nbsp;
          Trim: ${typeof ch.trim==='number'?ch.trim.toFixed(1)+' dB':'0.0 dB'}
        </div>`, 'gain')}
      ${navTile('FILTER / EQ →', {on:eq.on},
        `<canvas id="cs-overview-eq" class="cs-graph" height="55"></canvas>`, 'eq')}
      ${navTile('MAIN SENDS →', null,
        `<div style="display:flex;gap:10px;align-items:center;">
          <span style="font-size:12px;font-weight:700;color:${ch.muted?'var(--red)':'var(--green)'};">${ch.muted?'MUTED':'LIVE'}</span>
          <span style="font-size:11px;color:var(--text-muted)">
            Pan: ${ch.pan===0?'C':((ch.pan>0?'R':'L')+Math.abs(Math.round((ch.pan||0)*100)))}
          </span>
        </div>`, 'mainsends')}
    </div>
    <!-- Row 2: EQ full graph (clickable → eq) -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div style="background:var(--bg-deep);border:1px solid var(--border);border-radius:4px;padding:12px;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
          <span style="font-size:9px;font-weight:700;letter-spacing:1px;color:var(--text-muted)">GATE</span>
          <span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:2px;
            background:${gate.on?'rgba(61,220,132,.15)':'var(--bg-raised)'};
            color:${gate.on?'var(--green)':'var(--text-muted)'};
            border:1px solid ${gate.on?'var(--green-dim)':'var(--border)'}">${gate.on?'ON':'OFF'}</span>
        </div>
        <canvas id="cs-overview-gate" class="cs-graph" height="70"
          onclick="_csShowSection('gate')" style="cursor:pointer"></canvas>
      </div>
      <div style="background:var(--bg-deep);border:1px solid var(--border);border-radius:4px;padding:12px;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
          <span style="font-size:9px;font-weight:700;letter-spacing:1px;color:var(--text-muted)">DYNAMICS</span>
          <span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:2px;
            background:${dyn.on?'rgba(232,130,10,.15)':'var(--bg-raised)'};
            color:${dyn.on?'var(--orange)':'var(--text-muted)'};
            border:1px solid ${dyn.on?'var(--orange-dim)':'var(--border)'}">${dyn.on?'ON':'OFF'}</span>
        </div>
        <canvas id="cs-overview-dyn" class="cs-graph" height="70"
          onclick="_csShowSection('dynamics')" style="cursor:pointer"></canvas>
      </div>
    </div>
  </div>`;

  requestAnimationFrame(() => {
    const eqC  = document.getElementById('cs-overview-eq');
    const gC   = document.getElementById('cs-overview-gate');
    const dC   = document.getElementById('cs-overview-dyn');
    if (eqC) { eqC.width = eqC.offsetWidth; _csDrawEQCurve(eqC, eq.bands||[]); }
    if (gC)  { gC.width  = gC.offsetWidth;  _csDrawGateGraph(gC, ch.gate||{}); }
    if (dC)  { dC.width  = dC.offsetWidth;  _csDrawDynGraph(dC, dyn); }
  });
}

// Wing channel icons — SVG paths matching the Wing console icon grid
// Sourced from visual inspection of the ChannelHome_icon_color screenshot
const CS_ICONS = [
  // Row 1
  { id:0,  label:'None',       svg: '' },
  { id:1,  label:'Input',      svg: '<circle cx="12" cy="10" r="5" stroke-width="1.5" fill="none"/><line x1="12" y1="15" x2="12" y2="20" stroke-width="1.5"/><line x1="8" y1="20" x2="16" y2="20" stroke-width="1.5"/>' },
  { id:2,  label:'Mic Stand',  svg: '<line x1="12" y1="3" x2="12" y2="18" stroke-width="1.5"/><path d="M7,8 Q12,5 17,8" fill="none" stroke-width="1.5"/><line x1="8" y1="21" x2="16" y2="21" stroke-width="1.5"/><line x1="12" y1="18" x2="12" y2="21" stroke-width="1.5"/>' },
  { id:3,  label:'DI Box',     svg: '<rect x="5" y="7" width="14" height="10" rx="2" fill="none" stroke-width="1.5"/><line x1="5" y1="12" x2="2" y2="12" stroke-width="1.5"/><line x1="19" y1="12" x2="22" y2="12" stroke-width="1.5"/>' },
  { id:4,  label:'DI Input',   svg: '<rect x="6" y="6" width="12" height="12" rx="2" fill="none" stroke-width="1.5"/><line x1="6" y1="12" x2="3" y2="12" stroke-width="1.5"/><line x1="18" y1="9" x2="21" y2="9" stroke-width="1.5"/><line x1="18" y1="15" x2="21" y2="15" stroke-width="1.5"/>' },
  // Row 2
  { id:5,  label:'Pencil',     svg: '<path d="M3 17 L8 19 L19 8 L17 6 L6 17 Z" fill="none" stroke-width="1.5"/><line x1="15" y1="8" x2="17" y2="10" stroke-width="1.5"/>' },
  { id:6,  label:'EQ',         svg: '<line x1="5" y1="18" x2="5" y2="8" stroke-width="1.5"/><line x1="10" y1="18" x2="10" y2="12" stroke-width="1.5"/><line x1="15" y1="18" x2="15" y2="6" stroke-width="1.5"/><line x1="20" y1="18" x2="20" y2="10" stroke-width="1.5"/><line x1="3" y1="11" x2="7" y2="11" stroke-width="1.5"/><line x1="8" y1="14" x2="12" y2="14" stroke-width="1.5"/><line x1="13" y1="9" x2="17" y2="9" stroke-width="1.5"/><line x1="18" y1="13" x2="22" y2="13" stroke-width="1.5"/>' },
  { id:7,  label:'FX',         svg: '<text x="4" y="16" font-size="11" font-weight="bold" font-family="Barlow Condensed,sans-serif" fill="currentColor">FX</text>' },
  { id:8,  label:'Network',    svg: '<circle cx="12" cy="12" r="2" fill="none" stroke-width="1.5"/><circle cx="6" cy="7" r="2" fill="none" stroke-width="1.5"/><circle cx="18" cy="7" r="2" fill="none" stroke-width="1.5"/><circle cx="6" cy="17" r="2" fill="none" stroke-width="1.5"/><circle cx="18" cy="17" r="2" fill="none" stroke-width="1.5"/><line x1="8" y1="8" x2="11" y2="11" stroke-width="1.5"/><line x1="16" y1="8" x2="13" y2="11" stroke-width="1.5"/><line x1="8" y1="16" x2="11" y2="13" stroke-width="1.5"/><line x1="16" y1="16" x2="13" y2="13" stroke-width="1.5"/>' },
  { id:9,  label:'Bass Clef',  svg: '<path d="M8 6 Q14 6 14 12 Q14 16 9 17" fill="none" stroke-width="1.5"/><circle cx="16" cy="9" r="1.5"/><circle cx="16" cy="13" r="1.5"/>' },
  // Row 3
  { id:10, label:'Speaker',    svg: '<rect x="4" y="9" width="5" height="6" rx="1" fill="none" stroke-width="1.5"/><path d="M9 9 L15 5 L15 19 L9 15 Z" fill="none" stroke-width="1.5"/>' },
  { id:11, label:'Guitar',     svg: '<path d="M7 17 Q5 14 7 11 L14 4 Q16 3 17 5 Q18 7 16 8 L9 15 Q10 17 9 19 Q7 20 6 19 Z" fill="none" stroke-width="1.3"/><circle cx="15" cy="6" r="2" fill="none" stroke-width="1.2"/>' },
  { id:12, label:'Piano',      svg: '<rect x="3" y="6" width="18" height="12" rx="1" fill="none" stroke-width="1.5"/><line x1="3" y1="6" x2="3" y2="18" stroke-width="1"/><line x1="7" y1="6" x2="7" y2="18" stroke-width="1"/><line x1="11" y1="6" x2="11" y2="18" stroke-width="1"/><line x1="15" y1="6" x2="15" y2="18" stroke-width="1"/><line x1="19" y1="6" x2="19" y2="18" stroke-width="1"/><rect x="5" y="6" width="2" height="7" rx="1" fill="currentColor" stroke="none" opacity=".8"/><rect x="9" y="6" width="2" height="7" rx="1" fill="currentColor" stroke="none" opacity=".8"/><rect x="13" y="6" width="2" height="7" rx="1" fill="currentColor" stroke="none" opacity=".8"/><rect x="17" y="6" width="2" height="7" rx="1" fill="currentColor" stroke="none" opacity=".8"/>' },
  { id:13, label:'Grid',       svg: '<rect x="4" y="4" width="5" height="5" rx="1" fill="none" stroke-width="1.5"/><rect x="10" y="4" width="5" height="5" rx="1" fill="none" stroke-width="1.5"/><rect x="4" y="10" width="5" height="5" rx="1" fill="none" stroke-width="1.5"/><rect x="10" y="10" width="5" height="5" rx="1" fill="none" stroke-width="1.5"/>' },
  { id:14, label:'Smile',      svg: '<circle cx="12" cy="12" r="8" fill="none" stroke-width="1.5"/><circle cx="9" cy="10" r="1.2" fill="currentColor"/><circle cx="15" cy="10" r="1.2" fill="currentColor"/><path d="M8 14 Q12 18 16 14" fill="none" stroke-width="1.5"/>' },
  // Row 4
  { id:15, label:'Wing Logo',  svg: '<path d="M4 15 Q8 5 12 10 Q16 5 20 15" fill="none" stroke-width="2"/>' },
  { id:16, label:'Strips',     svg: '<rect x="3" y="4" width="4" height="16" rx="1" fill="none" stroke-width="1.5"/><rect x="10" y="4" width="4" height="16" rx="1" fill="none" stroke-width="1.5"/><rect x="17" y="4" width="4" height="16" rx="1" fill="none" stroke-width="1.5"/>' },
  { id:17, label:'Patch',      svg: '<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke-width="1.5"/><circle cx="7" cy="10" r="1.5" fill="currentColor"/><circle cx="12" cy="10" r="1.5" fill="currentColor"/><circle cx="17" cy="10" r="1.5" fill="currentColor"/><circle cx="7" cy="15" r="1.5" fill="currentColor"/><circle cx="12" cy="15" r="1.5" fill="currentColor"/><circle cx="17" cy="15" r="1.5" fill="currentColor"/>' },
  { id:18, label:'Settings',   svg: '<circle cx="12" cy="12" r="3" fill="none" stroke-width="1.5"/><path d="M12 4 L12 6 M12 18 L12 20 M4 12 L6 12 M18 12 L20 12 M6.3 6.3 L7.8 7.8 M16.2 16.2 L17.7 17.7 M17.7 6.3 L16.2 7.8 M7.8 16.2 L6.3 17.7" stroke-width="1.5"/>' },
  { id:19, label:'Treble Clef',svg: '<path d="M11 18 Q7 16 7 12 Q7 8 11 7 Q15 6 15 10 Q15 14 11 15" fill="none" stroke-width="1.5"/><line x1="11" y1="5" x2="11" y2="20" stroke-width="1.5"/>' },
  { id:20, label:'Monitor',    svg: '<rect x="3" y="5" width="18" height="12" rx="2" fill="none" stroke-width="1.5"/><line x1="9" y1="19" x2="15" y2="19" stroke-width="1.5"/><line x1="12" y1="17" x2="12" y2="19" stroke-width="1.5"/>' },
];

function _csRenderHomeIconColor(el, ch) {
  const currentColor = ch.color || CS_COLORS[0];
  const currentIcon  = ch.iconId ?? 0;

  el.innerHTML = `<div style="padding:14px 18px;display:flex;flex-direction:column;gap:14px;">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start;">
      <!-- Icon grid -->
      <div>
        ${_csTileLabel('CHANNEL ICON')}
        <div style="display:grid;grid-template-columns:repeat(5,44px);gap:5px;">
          ${CS_ICONS.map(ic => {
            const isSelected = ic.id === currentIcon;
            return `<div onclick="_csSetIcon(${ic.id})"
              title="${ic.label}"
              style="width:44px;height:44px;border-radius:3px;cursor:pointer;
                display:flex;align-items:center;justify-content:center;
                background:${isSelected?'var(--bg-raised)':'var(--bg-surface)'};
                border:${isSelected?'2px solid var(--orange)':'1px solid var(--border)'};
                color:${isSelected?'var(--orange)':'var(--text-dim)'};
                transition:all .1s;"
              onmouseover="this.style.borderColor='var(--border-hi)'"
              onmouseout="this.style.borderColor='${isSelected?'var(--orange)':'var(--border)'}'"
              >
              ${ic.svg ? `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                ${ic.svg}</svg>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>
      <!-- Color + preview -->
      <div>
        ${_csTileLabel('CHANNEL COLOR')}
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;max-width:200px;margin-bottom:14px;">
          ${CS_COLORS.map(c => `<div style="height:34px;border-radius:3px;cursor:pointer;background:${c};
            border:2px solid ${c===currentColor?'#fff':'transparent'};transition:all .1s;"
            onclick="_csSetColor('${c}')"></div>`).join('')}
        </div>
        ${_csTileLabel('PREVIEW')}
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="width:60px;height:94px;background:var(--bg-panel);border:1px solid var(--border);
            border-radius:3px;overflow:hidden;display:flex;flex-direction:column;align-items:center;padding:4px 4px 6px;gap:4px;">
            <div style="width:100%;height:4px;border-radius:2px;background:${currentColor}"></div>
            <div style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;
              color:${currentColor};margin-top:2px;">
              ${CS_ICONS[currentIcon]?.svg
                ? `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                    ${CS_ICONS[currentIcon].svg}</svg>`
                : ''}
            </div>
            <div style="font-size:9px;color:var(--text-dim);font-weight:600;text-align:center;
              overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;">
              ${ch.name||'CH '+_csId}</div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}
function _csSetIcon(iconId) {
  const ch = _csGetStrip(); if (!ch) return;
  ch.iconId = iconId;
  _csOSC('icon', iconId);
  _csRenderHomeIconColor(document.getElementById('csHomeBody'), ch);
  _csRenderNavRail();
}
function _csSetColor(hex) {
  const ch = _csGetStrip(); if (ch) ch.color = hex;
  const bar = document.getElementById(`strip-${_csStripType}-${_csId}`)?.querySelector('.ch-color-bar');
  if (bar) bar.style.background = hex;
  _csRenderHomeIconColor(document.getElementById('csHomeBody'), _csGetStrip()||{});
  _csRenderNavRail();
}

function _csRenderHomeName(el, ch) {
  el.innerHTML = `<div style="padding:18px;">
    <div style="display:flex;gap:10px;align-items:center;max-width:480px;">
      <input type="text" id="cs-name-input" value="${(ch.name||'').replace(/"/g,'&quot;')}"
        maxlength="16"
        style="flex:1;padding:10px 14px;background:var(--bg-deep);border:1px solid var(--border-hi);
          border-radius:3px;color:var(--text-primary);font-size:16px;font-weight:600;
          font-family:'Barlow Condensed',sans-serif;letter-spacing:1px;outline:none;"
        oninput="_csNameChanged(this.value)"
        onkeydown="if(event.key==='Enter')this.blur()" autofocus>
      <button onclick="_csNameChanged(document.getElementById('cs-name-input').value,true)"
        style="padding:10px 18px;background:var(--orange);color:#000;font-weight:700;
          border:none;border-radius:3px;cursor:pointer;font-size:12px;letter-spacing:1px;">SEND</button>
    </div>
    <div style="margin-top:8px;font-size:11px;color:var(--text-muted)">
      Max 16 characters. Changes sent to Wing immediately.
    </div>
  </div>`;
  requestAnimationFrame(() => document.getElementById('cs-name-input')?.focus());
}
function _csNameChanged(val) {
  const ch = _csGetStrip(); if (!ch) return;
  ch.name = val;
  const nameEl = document.getElementById(`name-${_csStripType}-${_csId}`);
  if (nameEl) nameEl.textContent = val || `${_csStripType.toUpperCase()} ${_csId}`;
  document.getElementById('csChName').textContent = val || `${_csStripType.toUpperCase()} ${_csId}`;
  _csOSC('name', val);
}

function _csRenderHomeTags(el, ch) {
  const dcas = state.dca || [];
  el.innerHTML = `<div style="padding:14px 18px;display:flex;flex-direction:column;gap:14px;">
    <div>
      ${_csTileLabel('DCA GROUPS')}
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;max-width:500px;">
        ${dcas.map((dca,i) => {
          const n = i+1, inGrp = ch.dcaGroups?.includes(n)||false;
          return `<div onclick="_csToggleDCA(${n})" style="padding:8px;border-radius:3px;cursor:pointer;text-align:center;
            background:${inGrp?'rgba(245,166,35,.15)':'var(--bg-surface)'};
            border:1px solid ${inGrp?'var(--amber)':'var(--border)'};">
            <div style="font-size:9px;color:${inGrp?'var(--amber)':'var(--text-muted)'};font-weight:700">DCA ${n}</div>
            <div style="font-size:11px;color:var(--text-dim)">${dca.name||'DCA '+n}</div>
          </div>`;
        }).join('')}
      </div>
    </div>
    <div>
      ${_csTileLabel('MUTE GROUPS')}
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;max-width:320px;">
        ${[1,2,3,4,5,6,7,8].map(n => {
          const inGrp = ch.muteGroups?.includes(n)||false;
          return `<div onclick="_csToggleMuteGroup(${n})" style="padding:8px;border-radius:3px;cursor:pointer;text-align:center;
            background:${inGrp?'rgba(232,64,64,.15)':'var(--bg-surface)'};
            border:1px solid ${inGrp?'var(--red-dim)':'var(--border)'};">
            <div style="font-size:9px;color:${inGrp?'var(--red)':'var(--text-muted)'};font-weight:700">MGRP ${n}</div>
          </div>`;
        }).join('')}
      </div>
    </div>
  </div>`;
}
function _csToggleDCA(n) {
  const ch = _csGetStrip(); if (!ch) return;
  ch.dcaGroups = ch.dcaGroups || [];
  const i = ch.dcaGroups.indexOf(n);
  if (i>=0) ch.dcaGroups.splice(i,1); else ch.dcaGroups.push(n);
  _csRenderHomeTags(document.getElementById('csHomeBody'), ch);
}
function _csToggleMuteGroup(n) {
  const ch = _csGetStrip(); if (!ch) return;
  ch.muteGroups = ch.muteGroups || [];
  const i = ch.muteGroups.indexOf(n);
  if (i>=0) ch.muteGroups.splice(i,1); else ch.muteGroups.push(n);
  _csRenderHomeTags(document.getElementById('csHomeBody'), ch);
}

// ═══════════════════════════════════════════════════════════════════════════
// GAIN
// ═══════════════════════════════════════════════════════════════════════════
// input_options pills — the 6 status indicators shown at top-left of the Wing screen
function _csRenderInputOptions(ch) {
  const opts = [
    { key:'phantom', label:'48V',  color:'var(--amber)',  active: !!ch.phantom },
    { key:'locut',   label:'LC',   color:'var(--blue)',   active: !!ch.locut   },
    { key:'invert',  label:'INV',  color:'var(--red)',    active: !!ch.invert  },
    { key:'hicut',   label:'HC',   color:'var(--cyan)',   active: !!ch.hicut   },
    { key:'tilt',    label:'TILT', color:'var(--green)',  active: !!ch.tilt    },
    { key:'delay',   label:'DLY',  color:'var(--orange)', active: !!ch.delay   },
  ];
  return `<div style="display:flex;gap:5px;margin-bottom:12px;">
    ${opts.map(o => `<div onclick="_csToggleBool('${o.key}');_csShowSection('gain')"
      title="${o.key}"
      style="padding:3px 8px;border-radius:3px;cursor:pointer;font-size:10px;font-weight:700;
        letter-spacing:.8px;border:1px solid;transition:all .15s;
        color:${o.active?o.color:'var(--text-muted)'};
        background:${o.active?o.color.replace('var(--','rgba(').replace(')',',.15)'):'var(--bg-surface)'};
        border-color:${o.active?o.color:'var(--border)'};"
      >${o.label}</div>`).join('')}
  </div>`;
}

function _csRenderGain(el, ch) {
  const gain = ch.gain ?? 0;
  const trim = ch.trim ?? 0;
  const pan  = ch.pan  ?? 0;
  const gPct = Math.round(Math.max(0,Math.min(100,((gain+10)/75)*100)));
  const tPct = Math.round(Math.max(0,Math.min(100,((trim+18)/36)*100)));
  const pPct = Math.round((pan+1)*50);

  el.innerHTML = `<div style="padding:14px 18px;display:flex;flex-direction:column;gap:12px;">
    <!-- input_options status pill row — 48V, LC, INV, HC, TILT, DLY -->
    ${_csRenderInputOptions(ch)}
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
      <!-- Channel Input (gain + pad) -->
      <div style="background:var(--bg-deep);border:1px solid var(--border);border-radius:4px;padding:12px;">
        ${_csTileLabel('CHANNEL INPUT')}
        ${_csParamBlock('GAIN','cs-gain-val',gain.toFixed(1)+' dB',gPct,
          "_csSliderVal('gain',this.value,-10,65,'cs-gain-val',v=>v.toFixed(1)+' dB')")}
        <div style="margin-top:10px;">
          <button class="cs-toggle${ch.pad?' on':''}"
            onclick="_csToggleBool('pad');_csShowSection('gain')">PAD</button>
        </div>
      </div>
      <!-- Trim & Balance -->
      <div style="background:var(--bg-deep);border:1px solid var(--border);border-radius:4px;padding:12px;">
        ${_csTileLabel('TRIM &amp; BALANCE')}
        ${_csParamBlock('TRIM','cs-trim-val',trim.toFixed(1)+' dB',tPct,
          "_csSliderVal('trim',this.value,-18,18,'cs-trim-val',v=>v.toFixed(1)+' dB')")}
        <div style="margin-top:10px;">
          ${_csParamBlock('BALANCE / PAN','cs-pan-val',pan===0?'C':((pan>0?'R':'L')+Math.abs(Math.round(pan*100))),pPct,
            '_csPanSlider(this.value)')}
        </div>
      </div>
      <!-- Filter detail -->
      <div style="background:var(--bg-deep);border:1px solid var(--border);border-radius:4px;padding:12px;">
        ${_csTileLabel('FILTER')}
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button class="cs-toggle${ch.locut?' on':''}"
            onclick="_csToggleBool('locut');_csShowSection('gain')">LO CUT</button>
          <button class="cs-toggle${ch.hicut?' on':''}"
            onclick="_csToggleBool('hicut');_csShowSection('gain')">HI CUT</button>
          <button class="cs-toggle${ch.tilt?' on':''}"
            onclick="_csToggleBool('tilt');_csShowSection('gain')">TILT EQ</button>
          <button class="cs-toggle${ch.delay?' on':''}"
            onclick="_csToggleBool('delay');_csShowSection('gain')">DELAY</button>
        </div>
      </div>
    </div>
  </div>`;
}
function _csSliderVal(key, sliderVal, min, max, labelId, fmt) {
  const raw = min + (sliderVal/100)*(max-min);
  const ch  = _csGetStrip(); if (!ch) return;
  ch[key] = raw;
  const label = document.getElementById(labelId);
  if (label) label.textContent = fmt(raw);
  _csOSC(key, raw);
}
function _csToggleBool(key) {
  const ch = _csGetStrip(); if (!ch) return;
  ch[key] = !ch[key];
}
function _csPanSlider(v) {
  const pan = (v/50-1);
  const ch  = _csGetStrip(); if (!ch) return;
  ch.pan = pan;
  const l = document.getElementById('cs-pan-val');
  if (l) l.textContent = pan===0?'C':((pan>0?'R':'L')+Math.abs(Math.round(pan*100)));
  sendPan(_csStripType, _csId, pan);
}

// ═══════════════════════════════════════════════════════════════════════════
// GATE — graph is 50% larger than before (height 270 vs 180)
// ═══════════════════════════════════════════════════════════════════════════
function _csRenderGate(el, ch) {
  const gate   = ch.gate || {on:false, thr:-40, range:60, att:0, rel:100};
  const thrPct = Math.round(((gate.thr+80)/80)*100);
  const rngPct = Math.round((gate.range/60)*100);
  const attPct = Math.round((gate.att/120)*100);
  const relPct = Math.round(Math.log10(Math.max(4,gate.rel)/4)/Math.log10(1000)*100);

  el.innerHTML = `<div style="padding:14px 18px;display:flex;flex-direction:column;gap:12px;">
    <!-- Header -->
    <div style="display:flex;align-items:center;gap:10px;">
      <button class="cs-toggle${gate.on?' on':''}" style="padding:6px 24px;font-size:13px;"
        onclick="_csSendToggle('gate/on',${!gate.on})">${gate.on?'ON':'OFF'}</button>
      <span style="font-size:12px;font-weight:700;color:var(--text-dim);letter-spacing:1px">WING GATE</span>
    </div>
    <!-- Graph + params row -->
    <div style="display:grid;grid-template-columns:1fr auto;gap:14px;align-items:start;">
      <!-- Transfer curve — 50% larger: height 270 -->
      <div style="background:var(--bg-deep);border:1px solid var(--border);border-radius:4px;padding:10px;">
        ${_csTileLabel('TRANSFER CURVE')}
        <canvas id="cs-gate-graph" class="cs-graph" height="270"></canvas>
        <div style="display:flex;justify-content:space-between;margin-top:3px;font-size:8px;color:var(--text-muted);">
          <span>-80 dB</span><span>-60</span><span>-40</span><span>-20</span><span>0 dB</span>
        </div>
      </div>
      <!-- Params -->
      <div style="display:flex;flex-direction:column;gap:12px;min-width:160px;">
        ${_csParamBlock('THRESHOLD','cs-gate-thr-val',gate.thr.toFixed(1)+' dB',thrPct,
          "_csGateParam('thr',this.value,-80,0,'cs-gate-thr-val',v=>v.toFixed(1)+' dB')")}
        ${_csParamBlock('RANGE','cs-gate-range-val',gate.range.toFixed(1)+' dB',rngPct,
          "_csGateParam('range',this.value,3,60,'cs-gate-range-val',v=>v.toFixed(1)+' dB')")}
        ${_csParamBlock('ATTACK','cs-gate-att-val',gate.att.toFixed(1)+' ms',attPct,
          "_csGateParam('att',this.value,0,120,'cs-gate-att-val',v=>v.toFixed(1)+' ms')")}
        ${_csParamBlock('RELEASE','cs-gate-rel-val',gate.rel.toFixed(0)+' ms',relPct,
          "_csGateParam('rel',this.value,4,4000,'cs-gate-rel-val',v=>v.toFixed(0)+' ms')")}
      </div>
    </div>
  </div>`;

  requestAnimationFrame(() => {
    const c = document.getElementById('cs-gate-graph');
    if (c) { c.width = c.offsetWidth; _csDrawGateGraph(c, gate); }
  });
}

function _csDrawGateGraph(canvas, gate) {
  const c = canvas || document.getElementById('cs-gate-graph'); if (!c) return;
  if (!canvas) c.width = c.offsetWidth;
  const ctx = c.getContext('2d'), W=c.width, H=c.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-deep').trim()||'#0e0f11';
  ctx.fillRect(0,0,W,H);

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth=1;
  for (let i=1;i<5;i++) { ctx.beginPath();ctx.moveTo(0,i*H/5);ctx.lineTo(W,i*H/5);ctx.stroke(); }
  for (let i=1;i<5;i++) { ctx.beginPath();ctx.moveTo(i*W/5,0);ctx.lineTo(i*W/5,H);ctx.stroke(); }

  // 1:1 unity line
  ctx.strokeStyle='rgba(255,255,255,.12)'; ctx.setLineDash([4,4]);
  ctx.beginPath(); ctx.moveTo(0,H); ctx.lineTo(W,0); ctx.stroke(); ctx.setLineDash([]);

  // Threshold
  const thr = gate?.thr ?? -40;
  const tx  = W * (Math.abs(thr)/80);
  ctx.strokeStyle='rgba(255,255,255,.25)'; ctx.setLineDash([3,3]);
  ctx.beginPath(); ctx.moveTo(tx,0); ctx.lineTo(tx,H); ctx.stroke(); ctx.setLineDash([]);

  // Transfer curve: below threshold → range (attenuated), above → pass
  const on    = gate?.on;
  const range = gate?.range ?? 60;
  const rangeRatio = 1 - range/80;  // how far down the attenuated section goes

  // Below threshold: output is at rangeRatio
  const ty = H * (1 - rangeRatio);
  ctx.strokeStyle = on ? '#4a9eff' : '#3a3d45'; ctx.lineWidth = 2.5;
  const fillCol = on ? 'rgba(74,158,255,.15)' : 'rgba(58,61,69,.08)';

  ctx.beginPath();
  ctx.moveTo(0, H);           // bottom-left
  ctx.lineTo(tx, H);          // flat along bottom — full attenuation below threshold
  ctx.lineTo(tx, ty);         // knee — jumps up at threshold
  ctx.lineTo(W, 0);           // 1:1 above threshold
  ctx.stroke();

  ctx.fillStyle = fillCol;
  ctx.beginPath();
  ctx.moveTo(0,H); ctx.lineTo(tx,H); ctx.lineTo(tx,ty); ctx.lineTo(W,0); ctx.lineTo(W,H); ctx.closePath();
  ctx.fill();

  // Knee dot
  ctx.beginPath(); ctx.arc(tx,ty,5,0,Math.PI*2);
  ctx.fillStyle=on?'#4a9eff':'#3a3d45'; ctx.fill();

  // Axis labels
  ctx.fillStyle='rgba(255,255,255,.35)'; ctx.font='bold 10px Barlow Condensed';
  ctx.textAlign='left';
  [-10,-20,-30,-40,-50,-60,-70].forEach(db => {
    const y = H*(1-Math.abs(db)/80);
    if (y>8&&y<H-4) ctx.fillText(`${db}`, 4, y+3);
  });
  ctx.textAlign='right';
  ctx.fillStyle='rgba(255,255,255,.2)'; ctx.font='9px Barlow Condensed';
  ctx.fillText('IN →',W-4,H-4);
  ctx.textAlign='left';
  ctx.fillText('↑ OUT',4,12);
}

function _csGateParam(key, sliderVal, min, max, labelId, fmt) {
  const raw = min + (sliderVal/100)*(max-min);
  const ch  = _csGetStrip(); if (!ch) return;
  ch.gate   = ch.gate || {};
  ch.gate[key] = raw;
  const label = document.getElementById(labelId);
  if (label) label.textContent = fmt(raw);
  _csOSC(`gate/${key}`, raw);
  const c = document.getElementById('cs-gate-graph');
  if (c) { c.width=c.offsetWidth; _csDrawGateGraph(c, ch.gate); }
}

// ═══════════════════════════════════════════════════════════════════════════
// EQ — graph height 195 (50% larger than 130)
// ═══════════════════════════════════════════════════════════════════════════
function _csRenderEQ(el, ch) {
  const eq    = ch.eq || {on:false, bands:[]};
  const bands = eq.bands || [];
  if (typeof _csEQSelBand === 'undefined') window._csEQSelBand = 0;

  const headerDiv  = document.createElement('div');
  headerDiv.style.cssText = 'padding:10px 18px 8px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;flex-shrink:0;';
  const toggleBtn  = document.createElement('button');
  toggleBtn.className = 'cs-toggle' + (eq.on?' on':'');
  toggleBtn.style.cssText = 'padding:5px 20px;font-size:12px;';
  toggleBtn.textContent   = 'EQ ' + (eq.on?'ON':'OFF');
  toggleBtn.addEventListener('click', () => _csSendToggle('eq/on', !eq.on));
  const infoSpan = document.createElement('span');
  infoSpan.style.cssText = 'font-size:10px;color:var(--text-muted);letter-spacing:1px';
  infoSpan.textContent   = 'WING EQ — ' + (bands.length||6) + ' BANDS';
  headerDiv.appendChild(toggleBtn); headerDiv.appendChild(infoSpan);

  const graphDiv = document.createElement('div');
  graphDiv.style.cssText = 'padding:10px 18px 4px;';
  graphDiv.innerHTML = '<canvas class="cs-graph" id="cs-eq-main-graph" height="195"></canvas>'
    + '<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:9px;color:var(--text-muted);">'
    + '<span>20</span><span>50</span><span>100</span><span>200</span><span>500</span>'
    + '<span>1k</span><span>2k</span><span>5k</span><span>10k</span><span>20k</span></div>';

  const tabsDiv  = document.createElement('div');
  tabsDiv.style.cssText = 'display:flex;border-bottom:1px solid var(--border);padding:0 18px;gap:4px;';
  tabsDiv.id = 'cs-eq-band-tabs';

  const detailDiv = document.createElement('div');
  detailDiv.style.cssText = 'padding:14px 18px;';
  detailDiv.id = 'cs-eq-band-detail';

  el.innerHTML = '';
  el.appendChild(headerDiv); el.appendChild(graphDiv);
  el.appendChild(tabsDiv);   el.appendChild(detailDiv);

  _csEQRenderBandTabs(bands);
  _csEQRenderBandDetail(bands, window._csEQSelBand);

  requestAnimationFrame(() => {
    const c = document.getElementById('cs-eq-main-graph');
    if (c) { c.width = c.offsetWidth; _csDrawEQCurve(c, bands); }
  });
}

// Accurate EQ curve using biquad filter response calculation
function _csDrawEQCurve(canvas, bands) {
  const c = canvas; if (!c) return;
  const ctx = c.getContext('2d'), W=c.width, H=c.height;
  ctx.clearRect(0,0,W,H);
  const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--bg-deep').trim()||'#0e0f11';
  ctx.fillStyle = bgColor; ctx.fillRect(0,0,W,H);

  // Grid: dB lines at -15,-12,-9,-6,-3,0,+3,+6,+9,+12,+15
  ctx.strokeStyle='rgba(255,255,255,.05)'; ctx.lineWidth=1;
  [-12,-9,-6,-3,0,3,6,9,12].forEach(db => {
    const y = H/2 - db*(H/30);
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y);
    if (db===0) ctx.strokeStyle='rgba(255,255,255,.15)';
    ctx.stroke(); ctx.strokeStyle='rgba(255,255,255,.05)';
  });
  // Vertical freq lines
  [50,100,200,500,1000,2000,5000,10000].forEach(f => {
    const x = Math.log10(f/20)/Math.log10(20000/20)*W;
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke();
  });

  // dB labels on zero line
  ctx.fillStyle='rgba(255,255,255,.3)'; ctx.font='9px Barlow Condensed'; ctx.textAlign='right';
  [-12,-6,0,6,12].forEach(db => {
    const y = H/2 - db*(H/30);
    ctx.fillText((db>0?'+':'')+db, W-3, y+3);
  });

  // Curve
  if (!bands || bands.length===0) {
    ctx.strokeStyle='rgba(255,255,255,.15)'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(0,H/2); ctx.lineTo(W,H/2); ctx.stroke();
    return;
  }
  const color = LAYERS[_csStripType]?.color || '#e8820a';
  const grad  = ctx.createLinearGradient(0,0,0,H);
  grad.addColorStop(0,  color.replace('#','rgba(').replace(/^rgba\(/,'rgba(')+'40)'.replace('rgba(','').replace('40)','') );
  // simpler fill
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  const points = [];
  for (let px=0; px<=W; px++) {
    const freq = 20 * Math.pow(20000/20, px/W);
    let gain = 0;
    bands.forEach(b => {
      if (!b) return;
      const g = b.g||0, f = b.f||1000, q = b.q||0.7;
      if (g===0) return;
      const ratio = freq/f;
      gain += g / (1 + Math.pow(Math.log2(ratio)*Math.max(0.1,q), 2));
    });
    points.push([px, H/2 - gain*(H/30)]);
  }
  // Fill
  ctx.beginPath();
  ctx.moveTo(points[0][0], H/2);
  points.forEach(([x,y]) => ctx.lineTo(x,y));
  ctx.lineTo(W,H/2); ctx.closePath();
  ctx.fillStyle = color.replace('#','').length===6
    ? `rgba(${parseInt(color.slice(1,3),16)},${parseInt(color.slice(3,5),16)},${parseInt(color.slice(5,7),16)},0.12)`
    : 'rgba(232,130,10,0.12)';
  ctx.fill();
  // Line
  ctx.beginPath();
  points.forEach(([x,y],i) => i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y));
  ctx.stroke();

  // Band handle dots
  ctx.lineWidth=1.5;
  bands.forEach((b,i) => {
    if (!b) return;
    const f = b.f||1000, g = b.g||0;
    const x = Math.log10(f/20)/Math.log10(20000/20)*W;
    const y = H/2 - g*(H/30);
    const isSelected = i === window._csEQSelBand;
    ctx.beginPath(); ctx.arc(x,y, isSelected?7:5, 0, Math.PI*2);
    ctx.fillStyle   = isSelected ? color : 'var(--bg-raised)';
    ctx.strokeStyle = color;
    ctx.fill(); ctx.stroke();
  });
}

const _CS_EQ_BAND_NAMES = ['Low Shelf','PEQ 1','PEQ 2','PEQ 3','PEQ 4','High Shelf'];

function _csEQRenderBandTabs(bands) {
  const tabsEl = document.getElementById('cs-eq-band-tabs'); if (!tabsEl) return;
  tabsEl.innerHTML = _CS_EQ_BAND_NAMES.map((name,i) => {
    const b = bands[i]||{g:0}, g=b.g||0;
    const col = g>0.5?'var(--green)':g<-0.5?'var(--red)':'var(--text-muted)';
    const active = window._csEQSelBand===i;
    return `<div onclick="_csEQSelBand=${i};_csEQRenderBandTabs(_csGetStrip()?.eq?.bands||[]);_csEQRenderBandDetail(_csGetStrip()?.eq?.bands||[],${i});const cv=document.getElementById('cs-eq-main-graph');if(cv){cv.width=cv.offsetWidth;_csDrawEQCurve(cv,_csGetStrip()?.eq?.bands||[]);}"
      style="padding:8px 12px;font-size:9px;font-weight:700;letter-spacing:.5px;cursor:pointer;
      border-bottom:2px solid ${active?'var(--orange)':'transparent'};
      color:${active?'var(--orange)':col};transition:all .1s;white-space:nowrap">${name}</div>`;
  }).join('');
}

function _csEQRenderBandDetail(bands, idx) {
  const el = document.getElementById('cs-eq-band-detail'); if (!el) return;
  const b       = bands[idx]||{g:0,f:1000,q:0.7};
  const g       = typeof b.g==='number'?b.g:0;
  const freq    = typeof b.f==='number'?b.f:1000;
  const q       = typeof b.q==='number'?b.q:0.7;
  const gPct    = Math.round(((g+15)/30)*100);
  const fPct    = Math.round(Math.log10(freq/20)/Math.log10(20000/20)*100);
  const qPct    = Math.round(((q-0.1)/(8-0.1))*100);
  const fDisp   = freq>=1000?(freq/1000).toFixed(2)+'k Hz':freq.toFixed(0)+' Hz';
  const isShelf = (idx===0||idx===5);
  const isLo    = idx===0, isHi=idx===5;
  const ch      = _csGetStrip()||{};
  const gCol    = g>0.5?'var(--green)':g<-0.5?'var(--red)':'var(--text-dim)';
  const gLbl    = isLo?'GAIN L':isHi?'GAIN H':'GAIN '+idx;
  const fLbl    = isLo?'FREQ L':isHi?'FREQ H':'FREQ '+idx;

  const div = document.createElement('div');
  div.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:14px;max-width:680px;';

  // Filter col for shelves
  if (isLo||isHi) {
    const key     = isLo?'locut':'hicut';
    const enabled = isLo?!!ch.locut:!!ch.hicut;
    const label   = isLo?'LO-CUT':'HI-CUT';
    const desc    = isLo?(enabled?'Cutting below '+fDisp:'Lo-cut filter off')
                       :(enabled?'Cutting above '+fDisp:'Hi-cut filter off');
    const col  = document.createElement('div');
    col.className = 'cs-param';
    const statusSpan = document.createElement('span');
    statusSpan.style.color = enabled?'var(--green)':'var(--text-muted)';
    statusSpan.textContent = enabled?'ENABLED':'DISABLED';
    const lbl = document.createElement('div'); lbl.className='cs-param-label';
    lbl.appendChild(document.createTextNode(label+' '));
    lbl.appendChild(statusSpan);
    const btn = document.createElement('button');
    btn.className = 'cs-toggle'+(enabled?' on':'');
    btn.textContent = label+(enabled?' ON':' OFF');
    btn.addEventListener('click', () => { const ch2=_csGetStrip();if(!ch2)return;ch2[key]=!ch2[key];_csShowSection('eq'); });
    const descDiv = document.createElement('div');
    descDiv.style.cssText='font-size:10px;color:var(--text-muted);margin-top:4px';
    descDiv.textContent=desc;
    col.appendChild(lbl);col.appendChild(btn);col.appendChild(descDiv);
    div.appendChild(col);
  }

  // Gain col
  const gDiv = document.createElement('div'); gDiv.className='cs-param';
  gDiv.innerHTML = '<div class="cs-param-label">'+gLbl+'</div>'
    +'<div class="cs-param-val" id="cs-eq-g-disp" style="color:'+gCol+'">'+(g>=0?'+':'')+g.toFixed(1)+' dB</div>'
    +'<input type="range" class="cs-slider" min="0" max="100" value="'+gPct+'">'
    +'<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text-muted);margin-top:2px">'
    +'<span>-15 dB</span><span>0</span><span>+15 dB</span></div>';
  gDiv.querySelector('input').addEventListener('input', function(){ _csEQBand(idx,'g',this.value); });
  div.appendChild(gDiv);

  // Freq col
  const fDiv = document.createElement('div'); fDiv.className='cs-param';
  fDiv.innerHTML = '<div class="cs-param-label">'+fLbl+'</div>'
    +'<div class="cs-param-val" id="cs-eq-f-disp" style="color:var(--cyan)">'+fDisp+'</div>'
    +'<input type="range" class="cs-slider" min="0" max="100" value="'+fPct+'">'
    +'<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text-muted);margin-top:2px">'
    +'<span>20Hz</span><span>1kHz</span><span>20kHz</span></div>';
  fDiv.querySelector('input').addEventListener('input', function(){ _csEQBand(idx,'f',this.value); });
  div.appendChild(fDiv);

  // Q col (PEQ only)
  if (!isShelf) {
    const qDiv = document.createElement('div'); qDiv.className='cs-param';
    qDiv.innerHTML = '<div class="cs-param-label">Q '+idx+'</div>'
      +'<div class="cs-param-val" id="cs-eq-q-disp" style="color:var(--amber)">'+q.toFixed(2)+'</div>'
      +'<input type="range" class="cs-slider" min="0" max="100" value="'+qPct+'">'
      +'<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text-muted);margin-top:2px">'
      +'<span>0.1</span><span>Narrow</span><span>8.0</span></div>';
    qDiv.querySelector('input').addEventListener('input', function(){ _csEQBand(idx,'q',this.value); });
    div.appendChild(qDiv);
  }

  el.innerHTML=''; el.appendChild(div);
}

function _csEQBand(idx, attr, sliderVal) {
  const ch = _csGetStrip(); if (!ch) return;
  ch.eq = ch.eq||{on:false,bands:[]};
  while (ch.eq.bands.length<=idx) ch.eq.bands.push({g:0,f:1000,q:0.7});
  const band = ch.eq.bands[idx];
  let raw;
  if (attr==='f') raw = 20*Math.pow(20000/20, sliderVal/100);
  else if (attr==='g') raw = -15+(sliderVal/100)*30;
  else raw = 0.1+(sliderVal/100)*(8-0.1);
  band[attr] = raw;
  _csOSC(`eq/${idx+1}${attr}`, raw);
  if (attr==='g') {
    const el=document.getElementById('cs-eq-g-disp');
    if(el){el.textContent=(raw>=0?'+':'')+raw.toFixed(1)+' dB';el.style.color=raw>0.5?'var(--green)':raw<-0.5?'var(--red)':'var(--text-dim)';}
  } else if (attr==='f') {
    const el=document.getElementById('cs-eq-f-disp');
    if(el) el.textContent=raw>=1000?(raw/1000).toFixed(2)+'k Hz':raw.toFixed(0)+' Hz';
  } else if (attr==='q') {
    const el=document.getElementById('cs-eq-q-disp');
    if(el) el.textContent=raw.toFixed(2);
  }
  const c=document.getElementById('cs-eq-main-graph');
  if(c){c.width=c.offsetWidth;_csDrawEQCurve(c,ch.eq.bands);}
  _csEQRenderBandTabs(ch.eq.bands);
}

// ═══════════════════════════════════════════════════════════════════════════
// DYNAMICS — transfer curve height 240, envelope height 210 (50% larger)
// ═══════════════════════════════════════════════════════════════════════════
function _csRenderDynamics(el, ch) {
  const dyn    = ch.dyn||{on:false,thr:-20,ratio:'4.0',att:10,hld:20,rel:100,knee:0,gain:0};
  const thr    = typeof dyn.thr==='number'?dyn.thr:-20;
  const ratio  = parseFloat(dyn.ratio)||4;
  const att    = typeof dyn.att==='number'?dyn.att:10;
  const hld    = typeof dyn.hld==='number'?dyn.hld:20;
  const rel    = typeof dyn.rel==='number'?dyn.rel:100;
  const knee   = typeof dyn.knee==='number'?dyn.knee:0;
  const gain   = typeof dyn.gain==='number'?dyn.gain:0;
  const thrPct   = Math.round(((thr+60)/60)*100);
  const ratioPct = Math.round(Math.log(ratio/1.1)/Math.log(100/1.1)*100);
  const attPct   = Math.round((att/200)*100);
  const hldPct   = Math.round((hld/2000)*100);
  const relPct   = Math.round(Math.log(rel/4)/Math.log(3000/4)*100);
  const kneePct  = Math.round((knee/5)*100);

  el.innerHTML = `<div style="padding:14px 18px;display:flex;flex-direction:column;gap:12px;">
    <!-- Header -->
    <div style="display:flex;align-items:center;gap:10px;">
      <button class="cs-toggle${dyn.on?' on':''}" style="padding:6px 24px;font-size:13px;"
        onclick="_csSendToggle('dyn/on',${!dyn.on})">COMP ${dyn.on?'ON':'OFF'}</button>
      <span style="font-size:12px;font-weight:700;color:var(--text-dim);letter-spacing:1px">WING COMPRESSOR</span>
    </div>
    <!-- Two-column: transfer curve + envelope -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <!-- Transfer curve — height 240 -->
      <div style="background:var(--bg-deep);border:1px solid var(--border);border-radius:4px;padding:12px;">
        ${_csTileLabel('TRANSFER CURVE')}
        <canvas id="cs-dyn-graph" class="cs-graph" height="240"></canvas>
        <div style="display:flex;justify-content:space-between;margin-top:3px;font-size:8px;color:var(--text-muted);">
          <span>-60 dB IN</span><span>-40</span><span>-20</span><span>0 dB</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">
          ${_csParamBlock('THRESHOLD','cs-dyn-thr-val',thr.toFixed(1)+' dB',thrPct,
            "_csDynParam('thr',this.value,-60,0,'cs-dyn-thr-val',v=>v.toFixed(1)+' dB')")}
          ${_csParamBlock('RATIO','cs-dyn-ratio-val',ratio.toFixed(1)+':1',ratioPct,
            "_csDynParam('ratio',this.value,1.1,100,'cs-dyn-ratio-val',v=>v.toFixed(1)+':1')")}
          ${_csParamBlock('KNEE','cs-dyn-knee-val',String(knee),kneePct,
            "_csDynParam('knee',this.value,0,5,'cs-dyn-knee-val',v=>Math.round(v).toString())")}
          ${gain!==0?_csParamBlock('MAKE-UP','cs-dyn-gain-val',(gain>=0?'+':'')+gain.toFixed(1)+' dB',50,'',
            'var(--green)'):''}
        </div>
      </div>
      <!-- Envelope — height 210 -->
      <div style="background:var(--bg-deep);border:1px solid var(--border);border-radius:4px;padding:12px;">
        ${_csTileLabel('ENVELOPE')}
        <canvas id="cs-env-graph" class="cs-graph" height="210"></canvas>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:10px;">
          ${_csParamBlock('ATTACK','cs-dyn-att-val',att.toFixed(1)+' ms',attPct,
            "_csDynEnvParam('att',this.value,0,200,'cs-dyn-att-val',v=>v.toFixed(1)+' ms')","var(--blue)")}
          ${_csParamBlock('HOLD','cs-dyn-hld-val',hld.toFixed(0)+' ms',hldPct,
            "_csDynEnvParam('hld',this.value,0,2000,'cs-dyn-hld-val',v=>v.toFixed(0)+' ms')","var(--amber)")}
          ${_csParamBlock('RELEASE','cs-dyn-rel-val',rel.toFixed(0)+' ms',relPct,
            "_csDynEnvParam('rel',this.value,4,3000,'cs-dyn-rel-val',v=>v.toFixed(0)+' ms')","var(--cyan)")}
        </div>
      </div>
    </div>
  </div>`;

  requestAnimationFrame(() => {
    const dc = document.getElementById('cs-dyn-graph');
    const ec = document.getElementById('cs-env-graph');
    if (dc) { dc.width=dc.offsetWidth; _csDrawDynGraph(dc, dyn); }
    if (ec) { ec.width=ec.offsetWidth; _csDrawEnvelopeGraph(ec, dyn); }
  });
}

function _csDrawDynGraph(canvas, dyn) {
  const c = canvas; if (!c) return;
  const ctx=c.getContext('2d'), W=c.width, H=c.height;
  ctx.clearRect(0,0,W,H);
  const bg=getComputedStyle(document.documentElement).getPropertyValue('--bg-deep').trim()||'#0e0f11';
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

  // Grid
  ctx.strokeStyle='rgba(255,255,255,.05)'; ctx.lineWidth=1;
  for(let i=1;i<5;i++){ctx.beginPath();ctx.moveTo(0,i*H/5);ctx.lineTo(W,i*H/5);ctx.stroke();}
  for(let i=1;i<5;i++){ctx.beginPath();ctx.moveTo(i*W/5,0);ctx.lineTo(i*W/5,H);ctx.stroke();}

  // 1:1 unity line
  ctx.strokeStyle='rgba(255,255,255,.12)'; ctx.setLineDash([4,4]);
  ctx.beginPath(); ctx.moveTo(0,H); ctx.lineTo(W,0); ctx.stroke(); ctx.setLineDash([]);

  const thr   = dyn?.thr??-20;
  const ratio = parseFloat(dyn?.ratio)||4;
  const on    = dyn?.on;
  const tx    = W*(1+thr/60);  // x position of threshold on input axis
  const ty    = H*(1+thr/60);  // y position of threshold on output axis (1:1 below)

  // Threshold line
  ctx.strokeStyle='rgba(255,255,255,.2)'; ctx.setLineDash([3,3]);
  ctx.beginPath(); ctx.moveTo(tx,0); ctx.lineTo(tx,H); ctx.stroke(); ctx.setLineDash([]);

  const col = on?'#e8820a':'#3a3d45';

  // Transfer curve: below threshold 1:1, above threshold compressed
  // Input axis = left→right (0 dB at right, -60 dB at left)
  // Output axis = bottom→top
  // Below threshold: y = H - (x/W)*H  → 1:1 line
  // At threshold (tx,H-tx): slope changes to 1/ratio
  const outThr = H - ty; // output value at threshold = same as input (1:1 below)
  // Above threshold: output = outThr + (input-thr)/ratio
  const txOut = H - tx;  // output at threshold point
  const endOut= txOut - (W-tx)/ratio;  // output at max input (0 dB)

  ctx.strokeStyle=col; ctx.lineWidth=2.5;
  ctx.beginPath();
  ctx.moveTo(0,H);       // -60dB in → -60dB out
  ctx.lineTo(tx, H-tx);  // threshold (1:1 line)
  ctx.lineTo(W, endOut); // compressed above threshold
  ctx.stroke();

  ctx.fillStyle = on?'rgba(232,130,10,.1)':'rgba(58,61,69,.06)';
  ctx.beginPath();
  ctx.moveTo(0,H); ctx.lineTo(tx,H-tx); ctx.lineTo(W,endOut); ctx.lineTo(W,H); ctx.closePath();
  ctx.fill();

  // Knee dot
  ctx.beginPath(); ctx.arc(tx,H-tx,5,0,Math.PI*2);
  ctx.fillStyle=col; ctx.fill();

  // Y-axis output dB labels (left side)
  ctx.fillStyle='rgba(255,255,255,.3)'; ctx.font='bold 10px Barlow Condensed'; ctx.textAlign='left';
  [-10,-20,-30,-40,-50].forEach(db=>{
    const y=H*(1-(db+60)/60);
    if(y>8&&y<H-4) ctx.fillText(`${db}`,4,y+3);
  });
  // X-axis input dB labels (bottom) — these match where the threshold vertical line is drawn
  ctx.fillStyle='rgba(255,255,255,.3)'; ctx.font='9px Barlow Condensed'; ctx.textAlign='center';
  [-10,-20,-30,-40,-50].forEach(db=>{
    const x = W*(1+db/60);
    if(x>14&&x<W-4) ctx.fillText(`${db}`, x, H-3);
  });
  ctx.textAlign='right'; ctx.fillStyle='rgba(255,255,255,.2)'; ctx.font='9px Barlow Condensed';
  ctx.fillText('IN →',W-4,H-14);
  ctx.textAlign='left';
  ctx.fillText('↑ OUT',4,12);
}

function _csDrawEnvelopeGraph(canvas, dyn) {
  const c = canvas; if (!c) return;
  const ctx=c.getContext('2d'), W=c.width, H=c.height;
  ctx.clearRect(0,0,W,H);
  const bg=getComputedStyle(document.documentElement).getPropertyValue('--bg-deep').trim()||'#0e0f11';
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

  ctx.strokeStyle='rgba(255,255,255,.04)'; ctx.lineWidth=1;
  for(let i=1;i<5;i++){ctx.beginPath();ctx.moveTo(0,i*H/5);ctx.lineTo(W,i*H/5);ctx.stroke();}

  const att   = typeof dyn?.att==='number'?dyn.att:10;
  const hld   = typeof dyn?.hld==='number'?dyn.hld:20;
  const rel   = typeof dyn?.rel==='number'?dyn.rel:100;
  const total = att+hld+rel;
  const usableW = W-24;
  const aW  = (att/total)*usableW;
  const hW  = (hld/total)*usableW;
  const rW  = (rel/total)*usableW;
  const top = H*0.12;
  const bot = H*0.88;
  const x0=12, x1=x0+aW, x2=x1+hW, x3=x2+rW;

  // Fill
  const grad=ctx.createLinearGradient(0,top,0,bot);
  grad.addColorStop(0,'rgba(61,220,132,.3)'); grad.addColorStop(1,'rgba(61,220,132,.06)');
  ctx.fillStyle=grad;
  ctx.beginPath(); ctx.moveTo(x0,bot); ctx.lineTo(x1,top); ctx.lineTo(x2,top); ctx.lineTo(x3,bot); ctx.closePath(); ctx.fill();

  // Outline
  ctx.strokeStyle='#3ddc84'; ctx.lineWidth=2.5;
  ctx.beginPath(); ctx.moveTo(x0,bot); ctx.lineTo(x1,top); ctx.lineTo(x2,top); ctx.lineTo(x3,bot); ctx.stroke();

  // Control points
  [[x0,bot],[x1,top],[x2,top],[x3,bot]].forEach(([x,y])=>{
    ctx.beginPath(); ctx.arc(x,y,6,0,Math.PI*2);
    ctx.fillStyle=bg; ctx.fill();
    ctx.strokeStyle='#3ddc84'; ctx.lineWidth=2.5; ctx.stroke();
  });

  // Segment separators
  ctx.strokeStyle='rgba(255,255,255,.12)'; ctx.lineWidth=1; ctx.setLineDash([2,3]);
  [x1,x2].forEach(x=>{ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();});
  ctx.setLineDash([]);

  // Labels
  ctx.fillStyle='rgba(255,255,255,.45)'; ctx.font='bold 10px Barlow Condensed'; ctx.textAlign='center';
  ctx.fillText('ATK', x0+aW/2, H-5);
  ctx.fillText('HLD', x1+hW/2, H-5);
  ctx.fillText('REL', x2+rW/2, H-5);

  // Value labels
  ctx.fillStyle='rgba(255,255,255,.3)'; ctx.font='9px Barlow Condensed';
  ctx.fillText(att.toFixed(0)+'ms', x0+aW/2, top-4);
  ctx.fillText(hld.toFixed(0)+'ms', x1+hW/2, top-4);
  ctx.fillText(rel.toFixed(0)+'ms', x2+rW/2, top-4);
}

function _csDynParam(key, sliderVal, min, max, labelId, fmt) {
  const raw = min+(sliderVal/100)*(max-min);
  const ch  = _csGetStrip(); if (!ch) return;
  ch.dyn    = ch.dyn||{};
  ch.dyn[key] = raw;
  const label = document.getElementById(labelId);
  if (label) label.textContent = fmt(raw);
  _csOSC(`dyn/${key}`, raw);
  const dc=document.getElementById('cs-dyn-graph');
  if(dc){dc.width=dc.offsetWidth;_csDrawDynGraph(dc,ch.dyn);}
}
function _csDynEnvParam(key, sliderVal, min, max, labelId, fmt) {
  let raw;
  if (key==='rel') raw=4*Math.pow(3000/4,sliderVal/100);
  else raw=min+(sliderVal/100)*(max-min);
  const ch=_csGetStrip(); if(!ch) return;
  ch.dyn=ch.dyn||{};
  ch.dyn[key]=raw;
  const label=document.getElementById(labelId);
  if(label) label.textContent=fmt(raw);
  _csOSC(`dyn/${key}`,raw);
  const ec=document.getElementById('cs-env-graph');
  if(ec){ec.width=ec.offsetWidth;_csDrawEnvelopeGraph(ec,ch.dyn);}
}

// ═══════════════════════════════════════════════════════════════════════════
// INSERT
// ═══════════════════════════════════════════════════════════════════════════
function _csRenderInsert(el, ch, num) {
  const ins = ch[`ins${num}`]||{on:false,type:'NONE'};
  el.innerHTML = `<div style="padding:18px;display:flex;flex-direction:column;gap:12px;">
    <div style="display:flex;align-items:center;gap:12px;">
      <button class="cs-toggle${ins.on?' on':''}" style="padding:6px 24px;font-size:13px;"
        onclick="_csToggleInsert(${num})">${ins.on?'ON':'OFF'}</button>
      <span style="font-size:13px;font-weight:700;color:var(--text-dim)">FX PROCESSOR — INSERT ${num}</span>
    </div>
    <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:4px;padding:14px 18px;
      display:flex;align-items:center;gap:14px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;color:var(--text-muted);min-width:70px;">FX TYPE</div>
      <div style="font-size:15px;font-weight:700;color:var(--text-primary)">${ins.type||'NONE'}</div>
    </div>
    <div style="font-size:12px;color:var(--text-muted)">
      FX processor assignment is managed from the Wing console directly.<br>
      Enable / disable the insert point here.
    </div>
  </div>`;
}
function _csToggleInsert(num) {
  const ch=_csGetStrip(); if(!ch) return;
  const key=`ins${num}`;
  ch[key]=ch[key]||{on:false,type:'NONE'};
  ch[key].on=!ch[key].on;
  _csShowSection(`insert${num}`); _csRenderNavRail();
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN SENDS — pan scope height 210 (50% larger than 140)
// ═══════════════════════════════════════════════════════════════════════════
function _csRenderMainSends(el, ch) {
  const mains = state.mains || [];
  el.innerHTML = `<div style="padding:14px 18px;display:flex;flex-direction:column;gap:12px;">
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
      <!-- Main faders -->
      <div style="background:var(--bg-deep);border:1px solid var(--border);border-radius:4px;padding:12px;">
        ${_csTileLabel('MAIN SENDS')}
        <div style="display:flex;gap:12px;align-items:flex-end;">
          ${mains.slice(0,4).map((m,i) => {
            const n=i+1, send=ch.mainSends?.[n]||{on:true,lvl:0.75};
            const lvlPct=Math.round((send.lvl||0.75)*100), db=faderToDb(send.lvl||0.75);
            return `<div style="display:flex;flex-direction:column;align-items:center;gap:5px;width:56px;">
              <div style="font-size:9px;font-weight:700;color:var(--text-muted)">M${n}</div>
              <div id="cs-msend-val-${n}" style="font-size:10px;color:var(--cyan);font-family:monospace;
                width:52px;text-align:center;overflow:hidden;background:var(--bg-raised);
                border:1px solid var(--border);border-radius:2px;padding:2px 0;">${db}</div>
              <div style="height:140px;display:flex;justify-content:center;width:100%;">
                <input type="range" min="0" max="100" value="${lvlPct}"
                  style="writing-mode:vertical-lr;direction:rtl;width:8px;height:140px;
                  cursor:pointer;background:var(--fader-track);border-radius:4px;outline:none;"
                  oninput="_csMainSend(${n},this.value)">
              </div>
              <button class="cs-bus-on${send.on?' active':''}" id="cs-msend-on-${n}"
                style="width:52px;" onclick="_csMainSendOn(${n})">${send.on?'ON':'OFF'}</button>
              <div style="font-size:9px;color:var(--text-muted);text-align:center;
                overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:52px;">
                ${m.name||'MAIN '+n}</div>
            </div>`;
          }).join('')}
        </div>
      </div>
      <!-- Pan scope — height 210 -->
      <div style="flex:1;min-width:220px;max-width:340px;background:var(--bg-deep);
        border:1px solid var(--border);border-radius:4px;padding:12px;">
        ${_csTileLabel('STEREO PAN')}
        <canvas id="cs-pan-canvas" class="cs-graph" height="210"
          style="display:block;width:100%;"></canvas>
        <div style="margin-top:8px;">
          <div style="font-size:9px;font-weight:700;letter-spacing:.8px;color:var(--text-muted);
            text-transform:uppercase;margin-bottom:4px;">PAN —
            <span id="cs-msend-pan-val" style="color:var(--cyan)">
              ${ch.pan===0?'CENTER':((ch.pan>0?'R ':'L ')+Math.abs(Math.round((ch.pan||0)*100)))}</span></div>
          <input type="range" class="cs-slider" min="0" max="100"
            value="${Math.round(((ch.pan||0)+1)*50)}"
            oninput="_csMainPan(this.value)">
        </div>
      </div>
    </div>
  </div>`;
  requestAnimationFrame(() => _csDrawPanScope(ch.pan||0));
}

function _csMainPan(sliderVal) {
  const pan=(sliderVal/50)-1;
  const ch=_csGetStrip(); if(!ch) return;
  ch.pan=pan;
  const label=document.getElementById('cs-msend-pan-val');
  if(label) label.textContent=pan===0?'CENTER':((pan>0?'R ':'L ')+Math.abs(Math.round(pan*100)));
  sendPan(_csStripType,_csId,pan);
  _csDrawPanScope(pan);
}

function _csDrawPanScope(pan) {
  const c=document.getElementById('cs-pan-canvas'); if(!c) return;
  c.width=c.offsetWidth||300; c.height=c.offsetHeight||210;
  const ctx=c.getContext('2d'), W=c.width, H=c.height;
  ctx.clearRect(0,0,W,H);
  const bg=getComputedStyle(document.documentElement).getPropertyValue('--bg-deep').trim()||'#0e0f11';
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

  // Stereo field visualisation: a rounded arc/semicircle showing L/R balance
  const cx=W/2, cy=H*0.55, r=Math.min(cx,cy)*0.75;

  // Background semicircle
  ctx.beginPath(); ctx.arc(cx,cy,r,-Math.PI,0);
  ctx.strokeStyle='rgba(255,255,255,.08)'; ctx.lineWidth=20; ctx.stroke();

  // Filled arc from centre to pan position
  const startAngle = -Math.PI;
  const endAngle   = -Math.PI + Math.PI*(pan+1); // pan -1=left, 0=centre, +1=right
  const midAngle   = -Math.PI/2; // top = centre
  ctx.beginPath(); ctx.arc(cx,cy,r,startAngle,endAngle);
  ctx.strokeStyle='#4a9eff'; ctx.lineWidth=20; ctx.stroke();

  // Centre tick
  ctx.strokeStyle='rgba(255,255,255,.3)'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(cx,cy-r-10); ctx.lineTo(cx,cy-r+10); ctx.stroke();

  // Pan puck
  const puckAngle = -Math.PI + Math.PI*(pan+1);
  const puckX=cx+Math.cos(puckAngle)*r, puckY=cy+Math.sin(puckAngle)*r;
  ctx.beginPath(); ctx.arc(puckX,puckY,10,0,Math.PI*2);
  ctx.fillStyle='#4a9eff'; ctx.fill();
  ctx.strokeStyle=bg; ctx.lineWidth=2.5; ctx.stroke();

  // L / R / C labels
  ctx.fillStyle='rgba(255,255,255,.55)'; ctx.font='bold 13px Barlow Condensed'; ctx.textAlign='center';
  ctx.fillText('L',cx-r-16,cy+5);
  ctx.fillText('R',cx+r+16,cy+5);
  ctx.fillText('C',cx,cy-r-18);

  // Pan value
  const panLabel=pan===0?'CENTER':((pan>0?'R':'L')+Math.abs(Math.round(pan*100)));
  ctx.fillStyle='rgba(255,255,255,.7)'; ctx.font='bold 11px Barlow Condensed';
  ctx.fillText(panLabel, cx, cy+r*0.45);
}

function _csMainSend(mainNum, sliderVal) {
  const lvl=sliderVal/100, ch=_csGetStrip(); if(!ch) return;
  ch.mainSends=ch.mainSends||{};
  ch.mainSends[mainNum]=ch.mainSends[mainNum]||{on:true};
  ch.mainSends[mainNum].lvl=lvl;
  const label=document.getElementById(`cs-msend-val-${mainNum}`);
  if(label) label.textContent=faderToDb(lvl);
  _csOSC(`send/${mainNum}/lvl`,lvl);
}
function _csMainSendOn(mainNum) {
  const ch=_csGetStrip(); if(!ch) return;
  ch.mainSends=ch.mainSends||{};
  ch.mainSends[mainNum]=ch.mainSends[mainNum]||{on:true,lvl:0.75};
  ch.mainSends[mainNum].on=!ch.mainSends[mainNum].on;
  const btn=document.getElementById(`cs-msend-on-${mainNum}`);
  if(btn){btn.textContent=ch.mainSends[mainNum].on?'ON':'OFF';btn.classList.toggle('active',ch.mainSends[mainNum].on);}
  _csOSC(`send/${mainNum}/on`,ch.mainSends[mainNum].on?1:0);
}

// ═══════════════════════════════════════════════════════════════════════════
// BUS SENDS — vertical strips (unchanged layout, consistent styling)
// ═══════════════════════════════════════════════════════════════════════════
function _csRenderBusSends(el, ch) {
  const sends=ch.sends||{};
  el.innerHTML=`<div style="padding:10px 18px 6px;border-bottom:1px solid var(--border);
    display:flex;align-items:center;gap:12px;">
    <span style="font-size:10px;font-weight:700;letter-spacing:1px;color:var(--text-muted)">BUS SENDS — 16 BUSES</span>
  </div>
  <div style="display:flex;gap:2px;padding:12px 18px;overflow-x:auto;align-items:flex-end;min-height:320px;">
    ${Array.from({length:16},(_,i)=>{
      const n=String(i+1), s=sends[n]||{on:false,lvl:0,tap:'post',panLink:false};
      const lvlPct=Math.round((s.lvl||0)*100), db=faderToDb(s.lvl||0);
      const busName=(state.buses?.[i]?.name)||('BUS '+(i+1));
      const tap=s.tap||'post', panLnk=s.panLink||false;
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;
        width:60px;min-width:60px;background:var(--bg-panel);
        border:1px solid var(--border);border-radius:3px;padding:5px 3px 6px;flex-shrink:0;">
        <div style="font-size:8px;font-weight:700;color:var(--cyan);letter-spacing:.5px;
          overflow:hidden;white-space:nowrap;text-overflow:ellipsis;width:100%;text-align:center;"
          title="${busName}">${busName}</div>
        <div onclick="_csBusTap('${n}')"
          style="font-size:8px;font-weight:700;padding:2px 0;width:100%;text-align:center;
          border-radius:2px;cursor:pointer;border:1px solid var(--border);
          background:${tap==='post'?'rgba(74,158,255,.15)':'rgba(245,166,35,.15)'};
          color:${tap==='post'?'var(--blue)':'var(--amber)'}">
          ${tap.toUpperCase()}</div>
        <div id="cs-bus-val-${n}"
          style="font-size:9px;font-family:monospace;color:var(--cyan);
          width:54px;text-align:center;background:var(--bg-deep);
          border:1px solid var(--border);border-radius:2px;padding:1px 0;
          overflow:hidden;white-space:nowrap;">${db}</div>
        <div style="height:120px;display:flex;align-items:center;justify-content:center;width:100%;margin:2px 0;">
          <input type="range" min="0" max="100" value="${lvlPct}"
            style="writing-mode:vertical-lr;direction:rtl;width:8px;height:120px;
            cursor:pointer;background:var(--fader-track);border-radius:4px;outline:none;"
            oninput="_csBusSend('${n}',this.value)">
        </div>
        <div class="cs-bus-on${s.on?' active':''}" id="cs-bus-on-${n}"
          style="width:54px;text-align:center;" onclick="_csBusOn('${n}')">${s.on?'ON':'OFF'}</div>
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
  const ch=_csGetStrip(); if(!ch) return;
  ch.sends=ch.sends||{};
  ch.sends[busNum]=ch.sends[busNum]||{on:false,lvl:0,tap:'post',panLink:false};
  ch.sends[busNum].tap=ch.sends[busNum].tap==='post'?'pre':'post';
  _csShowSection('bussends');
}
function _csBusPanLink(busNum) {
  const ch=_csGetStrip(); if(!ch) return;
  ch.sends=ch.sends||{};
  ch.sends[busNum]=ch.sends[busNum]||{on:false,lvl:0,tap:'post',panLink:false};
  ch.sends[busNum].panLink=!ch.sends[busNum].panLink;
  _csShowSection('bussends');
}
function _csBusSend(busNum, sliderVal) {
  const lvl=sliderVal/100, ch=_csGetStrip(); if(!ch) return;
  ch.sends=ch.sends||{};
  ch.sends[busNum]=ch.sends[busNum]||{on:false};
  ch.sends[busNum].lvl=lvl;
  const label=document.getElementById(`cs-bus-val-${busNum}`);
  if(label) label.textContent=faderToDb(lvl);
  _csOSC(`send/${busNum}/lvl`,lvl);
}
function _csBusOn(busNum) {
  const ch=_csGetStrip(); if(!ch) return;
  ch.sends=ch.sends||{};
  ch.sends[busNum]=ch.sends[busNum]||{on:false,lvl:0};
  ch.sends[busNum].on=!ch.sends[busNum].on;
  const btn=document.getElementById(`cs-bus-on-${busNum}`);
  if(btn){btn.textContent=ch.sends[busNum].on?'ON':'OFF';btn.classList.toggle('active',ch.sends[busNum].on);}
  _csOSC(`send/${busNum}/on`,ch.sends[busNum].on?1:0);
}
