// Wing Remote v2.3.0 — Views, View Builders, Theme Toggle
// ── VIEW SWITCHER ───────────────────────────────────
function setView(v) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`nav-${v}`);
  if (btn) btn.classList.add('active');

  // Show/hide the main content panels
  const mixerArea  = document.getElementById('mixerArea');
  const detailPanel = document.getElementById('detailPanel');
  const viewPanel  = document.getElementById('viewPanel');

  // Views that use the mixer area (home = default strip view)
  const mixerViews = ['home'];

  if (mixerViews.includes(v)) {
    state._metersViewActive = false;
    if (mixerArea)  mixerArea.style.display  = '';
    if (detailPanel) detailPanel.style.display = '';
    if (viewPanel)  viewPanel.style.display  = 'none';
  } else {
    if (mixerArea)  mixerArea.style.display  = 'none';
    if (detailPanel) detailPanel.style.display = 'none';
    if (viewPanel)  viewPanel.style.display  = '';
    renderViewPanel(v);
  }
}

function renderViewPanel(v) {
  const panel = document.getElementById('viewPanel');
  if (!panel) return;

  if (v === 'recording') {
    panel.innerHTML = _buildRecordingView();
    _recUpdateUI();
    _loadRecordingsList();
    return;
  }
  if (v === 'meters') {
    panel.innerHTML = _buildMetersView();
    renderMetersView();
    return;
  }
  if (v === 'effects' || v === 'routing' || v === 'library') {
    panel.innerHTML = _buildComingSoonView();
    return;
  }
  if (v === 'utility') {
    panel.innerHTML = _buildUtilityView();
    _loadUtilityStatus();
    return;
  }
  panel.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;
    height:100%;color:var(--text-muted);font-size:14px;">${v.toUpperCase()}</div>`;
}

// ── VIEW BUILDERS ─────────────────────────────────────────────────────────────

function _buildRecordingView() {
  return `<div style="padding:20px 28px;max-width:960px;display:flex;flex-direction:column;gap:16px;">
    <div style="font-size:13px;font-weight:700;letter-spacing:2px;color:var(--text-dim)">RECORDING</div>
    <div class="rec-panel" style="border-radius:4px;border:1px solid var(--border);">
      <div class="rec-controls">
        <button class="rec-control-btn" onclick="recTransport('rew')" title="Rewind">⏮</button>
        <button class="rec-control-btn" id="btnStop2" onclick="recTransport('stop')" title="Stop">⏹</button>
        <button class="rec-control-btn" id="btnPlay2" onclick="recTransport('play')" title="Play">▶</button>
        <button class="rec-control-btn${state.recording?' rec-armed':''}" id="btnRecord2"
          onclick="recTransport('record')" title="Record">⏺</button>
      </div>
      <div class="rec-time${state.recording?' recording':''}" id="recTimer2">00:00:00</div>
      <div class="rec-info">
        <div class="rec-info-row">
          <span class="rec-badge${state.recording?' active':''}" id="recBadge2">
            ${state.recording?'● RECORDING':'REC READY'}</span>
          <span class="rec-badge" id="formatBadge2">WAV 48k / 32bit</span>
          <span class="rec-badge" id="diskBadge2">Disk: checking…</span>
        </div>
        <div class="waveform-mini"><canvas id="waveformCanvas2"></canvas></div>
      </div>
    </div>
    <!-- Recordings list -->
    <div>
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;color:var(--text-muted);
        margin-bottom:8px;">RECORDED FILES</div>
      <div id="rec-files-list" style="display:flex;flex-direction:column;gap:4px;">
        <div style="color:var(--text-muted);font-size:12px;">Loading…</div>
      </div>
    </div>
  </div>`;
}

function _buildMetersView() {
  return `<div style="padding:20px 28px;">
    <div style="font-size:13px;font-weight:700;letter-spacing:2px;
      color:var(--text-dim);margin-bottom:14px;">METERS — LIVE HARDWARE LEVELS</div>
    <div id="metersGrid" style="display:grid;
      grid-template-columns:repeat(auto-fill,minmax(38px,1fr));gap:4px;"></div>
  </div>`;
}

function _buildComingSoonView() {
  return `<div style="
      position:relative;width:100%;height:100%;
      display:flex;align-items:center;justify-content:center;overflow:hidden;">
    <!-- Greyed-out background content (blurred mixer glimpse) -->
    <div style="position:absolute;inset:0;background:var(--bg-deep);opacity:0.5;"></div>
    <!-- Frosted overlay -->
    <div style="position:absolute;inset:0;
      background:repeating-linear-gradient(
        135deg,
        rgba(0,0,0,.08) 0px, rgba(0,0,0,.08) 1px,
        transparent 1px, transparent 8px);
      opacity:.6;pointer-events:none;"></div>
    <!-- Message card -->
    <div style="position:relative;z-index:1;
      text-align:center;padding:36px 48px;
      background:var(--bg-raised);
      border:1px solid var(--border-hi);
      border-radius:6px;
      box-shadow:0 8px 32px rgba(0,0,0,.4);
      max-width:480px;">
      <div style="font-size:28px;margin-bottom:16px;opacity:.4;">⚙</div>
      <div style="font-size:13px;font-weight:600;color:var(--text-primary);
        line-height:1.7;letter-spacing:.3px;">
        This feature is in progress as a sub-project<br>to be implemented later.
      </div>
      <div style="margin-top:10px;font-size:13px;color:var(--text-dim);
        font-style:italic;letter-spacing:.3px;">
        Thanks for stopping by!
      </div>
    </div>
  </div>`;
}

function _buildEffectsView() {
  // Show the 16 FX processors as slots
  const slots = Array.from({length:16}, (_,i) => i+1);
  return `<div style="padding:20px 28px;">
    <div style="font-size:13px;font-weight:700;letter-spacing:2px;
      color:var(--text-dim);margin-bottom:14px;">EFFECTS — FX PROCESSORS</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;max-width:800px;">
      ${slots.map(n => `<div style="background:var(--bg-panel);border:1px solid var(--border);
        border-radius:4px;padding:12px;cursor:pointer;transition:border-color .1s;"
        onmouseover="this.style.borderColor='var(--border-hi)'"
        onmouseout="this.style.borderColor='var(--border)'">
        <div style="font-size:10px;font-weight:700;color:var(--text-muted);
          letter-spacing:.8px;margin-bottom:6px;">FX ${n}</div>
        <div style="font-size:13px;font-weight:700;color:var(--text-dim)">NONE</div>
        <div style="font-size:9px;color:var(--text-muted);margin-top:4px;">— insert unused —</div>
        <div style="display:flex;gap:4px;margin-top:8px;">
          <div style="font-size:8px;padding:2px 6px;background:var(--bg-raised);
            border:1px solid var(--border);border-radius:2px;color:var(--text-muted)">OFF</div>
        </div>
      </div>`).join('')}
    </div>
    <div style="margin-top:16px;font-size:11px;color:var(--text-muted);">
      FX processor assignment is managed from the Wing console directly.<br>
      Status shown here reflects what the Wing reports.
    </div>
  </div>`;
}

function _buildRoutingView() {
  // Input routing summary — show source for each channel
  return `<div style="padding:20px 28px;">
    <div style="font-size:13px;font-weight:700;letter-spacing:2px;
      color:var(--text-dim);margin-bottom:14px;">ROUTING — CHANNEL SOURCES</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px;">
      ${state.channels.slice(0,40).map((ch,i) => `
        <div style="background:var(--bg-panel);border:1px solid var(--border);
          border-radius:3px;padding:8px;display:flex;align-items:center;gap:8px;">
          <div style="width:4px;height:28px;border-radius:2px;
            background:${LAYERS.ch.color};flex-shrink:0;"></div>
          <div>
            <div style="font-size:9px;color:var(--text-muted);font-weight:700;">CH ${i+1}</div>
            <div style="font-size:11px;font-weight:700;color:var(--text-primary);
              overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:100px;"
              title="${ch.name}">${ch.name||'CH '+(i+1)}</div>
          </div>
        </div>`).join('')}
    </div>
    <div style="margin-top:16px;font-size:11px;color:var(--text-muted);">
      Full patch routing is managed on the Wing console.<br>
      Channel names update live from Wing via OSC.
    </div>
  </div>`;
}

function _buildLibraryView() {
  return `<div style="padding:20px 28px;display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:960px;">
    <!-- Recordings -->
    <div>
      <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;
        color:var(--text-muted);margin-bottom:10px;">MULTITRACK RECORDINGS</div>
      <div id="library-rec-list" style="display:flex;flex-direction:column;gap:4px;">
        <div style="color:var(--text-muted);font-size:12px;">Loading…</div>
      </div>
    </div>
    <!-- Snapshots (Wing scenes saved to disk) -->
    <div>
      <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;
        color:var(--text-muted);margin-bottom:10px;">MIXER SNAPSHOTS</div>
      <div style="display:flex;flex-direction:column;gap:6px;" id="library-snap-list">
        ${[1,2,3].map(n => `<div style="background:var(--bg-panel);border:1px solid var(--border);
          border-radius:3px;padding:10px 14px;display:flex;align-items:center;gap:10px;cursor:pointer;"
          onmouseover="this.style.borderColor='var(--border-hi)'"
          onmouseout="this.style.borderColor='var(--border)'">
          <div style="font-size:10px;font-weight:700;color:var(--text-muted);min-width:24px;">S${n}</div>
          <div style="flex:1;font-size:12px;font-weight:600;color:var(--text-primary);">Scene ${n}</div>
          <div style="font-size:9px;color:var(--text-muted);">—</div>
        </div>`).join('')}
        <div style="margin-top:8px;font-size:11px;color:var(--text-muted);">
          Snapshot save/recall via Wing console. Import/export coming soon.
        </div>
      </div>
    </div>
  </div>`;
}

function _buildUtilityView() {
  return `<div style="padding:20px 28px;max-width:720px;display:flex;flex-direction:column;gap:16px;">
    <div style="font-size:13px;font-weight:700;letter-spacing:2px;color:var(--text-dim)">UTILITY</div>
    <!-- Connection status -->
    <div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:4px;padding:16px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;color:var(--text-muted);margin-bottom:10px;">CONNECTION STATUS</div>
      <div id="utility-status" style="display:flex;flex-direction:column;gap:6px;font-size:12px;"></div>
    </div>
    <!-- Setup Wizard shortcut -->
    <div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:4px;padding:16px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;color:var(--text-muted);margin-bottom:10px;">CONFIGURATION</div>
      <button onclick="openWizard()" style="padding:8px 20px;background:var(--amber);
        color:#000;font-weight:700;border:none;border-radius:3px;cursor:pointer;
        font-size:11px;letter-spacing:1px;">OPEN SETUP WIZARD</button>
      <div style="margin-top:8px;font-size:11px;color:var(--text-muted);">
        Configure Wing IP address, OSC ports, audio recording settings.
      </div>
    </div>
    <!-- System info -->
    <div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:4px;padding:16px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;color:var(--text-muted);margin-bottom:10px;">SYSTEM</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;" id="utility-system"></div>
    </div>
  </div>`;
}

// Load recordings list for Library and Recording views
async function _loadRecordingsList() {
  try {
    const r   = await fetch('/api/recordings');
    const recs = await r.json();
    const html = recs.length === 0
      ? '<div style="color:var(--text-muted);font-size:12px;">No recordings yet.</div>'
      : recs.map(f => `
        <div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:3px;
          padding:8px 12px;display:flex;align-items:center;gap:8px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:11px;font-weight:600;color:var(--text-primary);
              overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.name}</div>
            <div style="font-size:9px;color:var(--text-muted);">${f.size_mb} MB · ${f.modified.slice(0,16).replace('T',' ')}</div>
          </div>
          <a href="/api/recordings/${encodeURIComponent(f.name)}" download
            style="padding:3px 10px;background:var(--bg-raised);border:1px solid var(--border);
            border-radius:2px;color:var(--text-dim);font-size:9px;text-decoration:none;
            font-weight:700;letter-spacing:.5px;">DL</a>
          <button onclick="_deleteRecording('${f.name}')"
            style="padding:3px 10px;background:var(--bg-raised);border:1px solid var(--border);
            border-radius:2px;color:var(--red-dim);font-size:9px;cursor:pointer;
            font-weight:700;letter-spacing:.5px;line-height:1;">✕</button>
        </div>`).join('');
    // Update whichever container exists
    ['rec-files-list','library-rec-list'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = html;
    });
  } catch(e) {
    console.warn('Could not load recordings:', e);
  }
}

async function _deleteRecording(filename) {
  if (!confirm(`Delete ${filename}?`)) return;
  await fetch(`/api/recordings/${encodeURIComponent(filename)}`, {method:'DELETE'});
  _loadRecordingsList();
}

async function _loadUtilityStatus() {
  try {
    const r    = await fetch('/api/status');
    const data = await r.json();
    const statusEl = document.getElementById('utility-status');
    if (statusEl) {
      statusEl.innerHTML = [
        ['Wing IP',         data.wing_ip],
        ['OSC Port',        data.wing_port],
        ['Wing Connected',  data.wing_connected ? '✓ YES' : '✗ NO'],
        ['Local OSC Port',  data.local_port],
        ['Browser Clients', data.ws_clients],
        ['Sample Rate',     (data.sample_rate||48000)+' Hz'],
        ['Bit Depth',       (data.bit_depth||32)+'-bit'],
        ['Audio Available', data.audio_available ? '✓ YES' : '✗ NO'],
      ].map(([k,v]) => `
        <div style="display:contents;">
          <div style="color:var(--text-muted);font-weight:700;letter-spacing:.5px;font-size:10px;">${k}</div>
          <div style="color:var(--text-primary);font-family:monospace;font-size:11px;">${v}</div>
        </div>`).join('');
    }
    const sysEl = document.getElementById('utility-system');
    if (sysEl) {
      sysEl.innerHTML = `
        <div style="color:var(--text-muted);font-size:10px;font-weight:700">VERSION</div>
        <div style="color:var(--text-primary);font-family:monospace;font-size:11px;">2.3.0</div>
        <div style="color:var(--text-muted);font-size:10px;font-weight:700">RECORDING</div>
        <div style="color:var(--text-primary);font-family:monospace;font-size:11px;">${data.recording?'● ACTIVE':'IDLE'}</div>`;
    }
  } catch(e) {}
}

function renderMetersView() {
  const grid = document.getElementById('metersGrid');
  if (!grid) return;

  // Helper: build one VU column for any strip type
  function vuStrip(key, label, height, accent) {
    const lvl = (meterTargets[key] || 0) * 100;
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
      <div style="width:22px;height:${height}px;background:var(--meter-bg);border-radius:2px;
        border:1px solid var(--border);overflow:hidden;display:flex;align-items:flex-end;">
        <div id="mv-${key}" style="width:100%;height:${lvl}%;
          background:linear-gradient(to top,${accent} 0%,${accent} 70%,var(--amber) 85%,var(--red) 100%);
          transition:height .04s linear;"></div>
      </div>
      <div style="font-size:7px;color:var(--text-muted);text-align:center;width:22px;
        overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${label}</div>
    </div>`;
  }

  // Section header label
  function sectionLabel(text) {
    return `<div style="display:flex;align-items:flex-end;padding-bottom:4px;margin-right:6px;">
      <span style="font-size:8px;font-weight:700;letter-spacing:1px;color:var(--text-muted);
        writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;">${text}</span>
    </div>`;
  }

  const sections = [
    { strips: state.channels, key:'ch',   label:'CH',   height:140, accent:'var(--orange)' },
    { strips: state.aux,      key:'aux',  label:'AUX',  height:120, accent:'var(--blue)'   },
    { strips: state.buses,    key:'bus',  label:'BUS',  height:110, accent:'var(--cyan)'   },
    { strips: state.mains,    key:'main', label:'MAIN', height:100, accent:'var(--red)'    },
    { strips: state.matrix,   key:'mtx',  label:'MTX',  height:100, accent:'var(--green)'  },
  ];

  grid.innerHTML = sections.map(sec => {
    const strips = sec.strips.map(strip => {
      const key   = `${sec.key}-${strip.id}`;
      const label = strip.name || `${sec.label}${strip.id}`;
      return vuStrip(key, label, sec.height, sec.accent);
    }).join('');
    return `<div style="display:contents;">${strips}</div>
      <div style="width:1px;background:var(--border);margin:0 4px;align-self:stretch;"></div>`;
  }).join('');

  state._metersViewActive = true;
}

// ── THEME TOGGLE — cycles: dark → mid → light → dark ──────────────────────────
// Themes: 'dark' (default), 'mid' (medium grey), 'light'
const THEMES = ['dark', 'mid', 'light'];

function _currentTheme() {
  const root = document.documentElement;
  if (root.classList.contains('light')) return 'light';
  if (root.classList.contains('mid'))   return 'mid';
  return 'dark';
}

function toggleTheme() {
  const cur   = _currentTheme();
  const next  = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
  const root  = document.documentElement;
  root.classList.remove('dark', 'mid', 'light');
  if (next !== 'dark') root.classList.add(next);
  _applyThemeIcon(next);
  try { localStorage.setItem('wing-theme', next); } catch(e) {}
}

function _applyThemeIcon(theme) {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  // Tooltip cycles with the theme
  const labels = { dark: 'Dark  →  Switch to Mid Grey', mid: 'Mid Grey  →  Switch to Light', light: 'Light  →  Switch to Dark' };
  btn.title = labels[theme] || 'Toggle theme';
  // Highlight the active segment
  const segSun  = document.getElementById('iconSegSun');
  const segMid  = document.getElementById('iconSegMid');
  const segMoon = document.getElementById('iconSegMoon');
  if (segSun)  segSun.style.opacity  = theme === 'light' ? '1' : '0.35';
  if (segMid)  segMid.style.opacity  = theme === 'mid'   ? '1' : '0.35';
  if (segMoon) segMoon.style.opacity = theme === 'dark'  ? '1' : '0.35';
}

// Apply saved theme on load (before first paint)
(function() {
  try {
    const saved = localStorage.getItem('wing-theme');
    const root  = document.documentElement;
    if (saved === 'light') root.classList.add('light');
    else if (saved === 'mid') root.classList.add('mid');
    // dark is the default — no class needed
  } catch(e) {}
})();

// Apply icon state after DOM ready (called from init)
function initThemeIcon() {
  _applyThemeIcon(_currentTheme());
}
// selectLayer is now defined above in the mixer model section