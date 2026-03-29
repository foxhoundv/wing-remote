// Wing Remote v2.3.68 — Setup Wizard
// ════════════════════════════════════════════════════════════════════════
// SETUP WIZARD JS
// ════════════════════════════════════════════════════════════════════════
const WIZ = {
  step: 0,
  totalSteps: 5,
  env: null,           // result from /api/setup/detect
  oscTested: false,
  oscOk: false,
  audioToggleUserSet: false,  // true once user has manually touched the toggle
  discoveredWing: null,       // result from /api/setup/discover
};

// Open / close
function openWizard() {
  document.getElementById('wizardOverlay').classList.add('visible');
  if (!WIZ.env) runDetection();
  // Start Wing discovery immediately — runs in parallel with detection
  runWingDiscovery();
}
function closeWizard() {
  document.getElementById('wizardOverlay').classList.remove('visible');
}

// Auto-launch if Wing IP is still default or first visit
async function checkAndLaunchWizard() {
  try {
    const r = await fetch('/api/setup/detect');
    const data = await r.json();
    WIZ.env = data;
    const ip = data.current_env?.WING_IP || '192.168.1.100';
    // Launch wizard if still on default IP or no audio configured
    if (ip === '192.168.1.100' || !data.compose_audio_enabled) {
      openWizard();   // openWizard also calls runWingDiscovery()
      populateDetection(data);
    }
  } catch(e) {
    // Server not yet reachable (demo mode) — don't open wizard
  }
}

// Nav button: add to topbar
// Setup button is now part of the static topbar HTML

// ── Detection ─────────────────────────────────────────────────────────
async function runDetection() {
  setDetCard('det-status', 'Scanning…', '');
  try {
    const r = await fetch('/api/setup/detect');
    WIZ.env = await r.json();
    populateDetection(WIZ.env);
  } catch(e) {
    setDetCard('det-status', 'Server unreachable', 'err');
  }
}

function populateDetection(d) {
  setDetCard('det-status', 'Complete', 'ok');
  setDetCard('det-platform', d.platform || 'linux', d.platform === 'wsl' ? 'warn' : 'ok');
  setDetCard('det-snd',
    d.dev_snd_exists ? `${d.dev_snd_devices.length} devices` : 'Not found',
    d.dev_snd_exists ? 'ok' : 'warn');
  setDetCard('det-audio',
    d.audio_devices.length > 0 ? `${d.audio_devices.length} input(s)` : 'None found',
    d.audio_devices.length > 0 ? 'ok' : 'warn');
  setDetCard('det-docker', d.docker_socket ? 'Available' : 'Not mounted', d.docker_socket ? 'ok' : 'warn');
  setDetCard('det-audiogrp', d.audio_group ? 'In group' : 'Not in group', d.audio_group ? 'ok' : 'warn');

  const env = d.current_env || {};
  setDetCard('cfg-ip',   env.WING_IP       || '192.168.1.100', '');
  setDetCard('cfg-port', env.WING_OSC_PORT || '2222', '');
  setDetCard('cfg-sr',   env.SAMPLE_RATE   || '48000', '');
  setDetCard('cfg-bd',   (env.BIT_DEPTH    || '32') + '-bit', '');

  // Pre-fill network step
  document.getElementById('wiz-ip').value        = env.WING_IP       || '192.168.1.100';
  document.getElementById('wiz-port').value       = env.WING_OSC_PORT || '2223';
  document.getElementById('wiz-localport').value  = env.LOCAL_OSC_PORT|| '2224';

  // Pre-fill recording step
  const srEl = document.getElementById('wiz-sr');
  if (env.SAMPLE_RATE) {
    srEl.value = env.SAMPLE_RATE;
    // If stored value doesn't match any option, default to 48000
    if (!srEl.value) srEl.value = '48000';
  }
  const bdEl = document.getElementById('wiz-bd');
  if (env.BIT_DEPTH) bdEl.value = env.BIT_DEPTH;
  const chEl = document.getElementById('wiz-ch');
  if (env.RECORD_CHANNELS) chEl.value = env.RECORD_CHANNELS;

  // Audio step
  populateAudioStep(d);
  updateDiskEstimate();
}

function setDetCard(id, text, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'detect-card-val' + (cls ? ' ' + cls : '');
}

// ── Audio step ────────────────────────────────────────────────────────
function populateAudioStep(d) {
  const tog   = document.getElementById('tog-audio');
  const badge = document.getElementById('snd-badge');
  const warn  = document.getElementById('no-snd-warning');
  const list  = document.getElementById('deviceList');

  // Always enable the toggle — user can configure passthrough even before
  // the Wing USB is connected. /dev/snd just tells us the current state.
  tog.disabled = false;

  if (d.dev_snd_exists) {
    badge.textContent  = 'DETECTED';
    badge.className    = 'wiz-toggle-badge badge-detected';
    warn.style.display = 'none';
  } else {
    badge.textContent  = 'NOT YET';
    badge.className    = 'wiz-toggle-badge badge-na';
    warn.style.display = 'block';
  }

  // Only set the toggle state on the FIRST population (initial detect).
  // On rescan we preserve whatever the user has chosen — indicated by
  // WIZ.audioToggleUserSet being true.
  if (!WIZ.audioToggleUserSet) {
    tog.checked = d.compose_audio_enabled;
  }

  // Device list
  if (d.audio_devices.length === 0) {
    list.innerHTML = `
      <div class="device-item">
        <div class="device-item-name" style="color:var(--text-muted)">
          No audio input devices detected
        </div>
        <div class="device-item-ch">Connect Wing via USB, then click ↻ Rescan</div>
      </div>`;
  } else {
    list.innerHTML = d.audio_devices.map((dev, i) => `
      <div class="device-item ${i===0?'selected':''}" onclick="selectDevice(this,${dev.index})">
        <div class="device-item-name">${dev.name}</div>
        <div class="device-item-ch">${dev.max_input_ch}ch · ${dev.default_sr/1000}kHz</div>
      </div>
    `).join('');
  }
}

async function rescanAudio() {
  const list  = document.getElementById('deviceList');
  const badge = document.getElementById('snd-badge');
  list.innerHTML = '<div class="device-item"><div class="device-item-name" style="color:var(--text-muted)"><span class="spinner"></span> Scanning…</div></div>';
  badge.textContent = '…';
  badge.className   = 'wiz-toggle-badge badge-na';
  try {
    const r    = await fetch('/api/setup/detect');
    const data = await r.json();
    WIZ.env    = data;
    populateAudioStep(data);
    // Update the detection step cards too
    populateDetection(data);
  } catch(e) {
    list.innerHTML = '<div class="device-item"><div class="device-item-name" style="color:var(--red)">Rescan failed — server unreachable</div></div>';
  }
}

function selectDevice(el, idx) {
  document.querySelectorAll('.device-item').forEach(d => d.classList.remove('selected'));
  el.classList.add('selected');
}

function onAudioToggle() {
  // Mark that the user has explicitly set this — rescan won't override it
  WIZ.audioToggleUserSet = true;
  updateDiskEstimate();
}

// ── Wing Auto-Discovery ───────────────────────────────────────────────
async function runWingDiscovery() {
  // Show spinner, hide other panels
  document.getElementById('wiz-discovery-searching').style.display = 'block';
  document.getElementById('wiz-discovery-found').style.display    = 'none';
  document.getElementById('wiz-discovery-manual').style.display   = 'none';
  WIZ.discoveredWing = null;

  try {
    // The backend uses its own configured WING_IP for unicast discovery.
    const r    = await fetch('/api/setup/discover');
    const data = await r.json();
    document.getElementById('wiz-discovery-searching').style.display = 'none';

    if (data.found) {
      WIZ.discoveredWing = data;
      // Pre-fill the hidden manual fields too (used by applyConfig)
      document.getElementById('wiz-ip').value   = data.ip;
      document.getElementById('wiz-port').value = '2223';

      // Show found panel
      const model = data.model ? ` (${data.model})` : '';
      const fw    = data.firmware ? ` · fw ${data.firmware}` : '';
      document.getElementById('wiz-found-name').textContent   = `${data.name || 'Wing'}${model}`;
      document.getElementById('wiz-found-detail').textContent = `IP: ${data.ip}${fw}`;
      document.getElementById('wiz-discovery-found').style.display = 'block';
    } else {
      // Not found — show manual entry with notice
      document.getElementById('wiz-notfound-msg').style.display    = 'block';
      document.getElementById('wiz-discovery-manual').style.display = 'block';
    }
  } catch(e) {
    document.getElementById('wiz-discovery-searching').style.display = 'none';
    document.getElementById('wiz-discovery-manual').style.display   = 'block';
  }
}

function showManualEntry() {
  // User chose to enter manually instead of using discovered Wing
  document.getElementById('wiz-discovery-found').style.display   = 'none';
  document.getElementById('wiz-notfound-msg').style.display      = 'none';
  document.getElementById('wiz-discovery-manual').style.display  = 'block';
}

async function applyDiscoveredWing() {
  if (!WIZ.discoveredWing) return;
  // Directly apply the discovered Wing without waiting for the apply step
  const payload = {
    wing_ip:       WIZ.discoveredWing.ip,
    wing_osc_port: 2223,
    local_osc_port: parseInt(document.getElementById('wiz-localport').value) || 2224,
    sample_rate:   parseInt(document.getElementById('wiz-sr')?.value) || 48000,
    bit_depth:     parseInt(document.getElementById('wiz-bd')?.value) || 32,
    record_channels: parseInt(document.getElementById('wiz-ch')?.value) || 32,
    enable_audio_passthrough: document.getElementById('tog-audio')?.checked || false,
  };
  try {
    await fetch('/api/setup/apply', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload),
    });
    // Update topbar
    const ipEl = document.getElementById('wingIP');
    if (ipEl) ipEl.value = WIZ.discoveredWing.ip;
    // Advance to next step
    wizNav(1);
  } catch(e) {
    document.getElementById('wiz-discovery-found').innerHTML +=
      '<div style="color:var(--red);font-size:12px;margin-top:8px">Apply failed — check server connection</div>';
  }
}

// ── OSC Test ──────────────────────────────────────────────────────────
async function testOSC() {
  const ip   = document.getElementById('wiz-ip').value.trim();
  const port = parseInt(document.getElementById('wiz-port').value) || 2222;
  const btn  = document.getElementById('oscTestBtn');
  const res  = document.getElementById('oscTestResult');

  btn.disabled = true;
  res.className = 'wiz-test-result';
  res.innerHTML = '<span class="spinner"></span>Testing…';

  // Update reminder
  document.getElementById('wiz-remind-ip').textContent = ip;
  document.getElementById('wiz-remind-port').textContent =
    document.getElementById('wiz-localport').value || '2223';

  try {
    const r = await fetch('/api/setup/test-osc', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ip, port}),
    });
    const data = await r.json();
    WIZ.oscTested = true;
    WIZ.oscOk = data.success;
    res.textContent = data.message;
    res.className   = 'wiz-test-result ' + (data.success ? 'ok' : 'err');
  } catch(e) {
    res.textContent = 'Could not reach backend server';
    res.className   = 'wiz-test-result err';
  }
  btn.disabled = false;
}

// ── Disk estimate ─────────────────────────────────────────────────────
function updateDiskEstimate() {
  const sr  = parseInt(document.getElementById('wiz-sr')?.value  || 48000);
  const bd  = parseInt(document.getElementById('wiz-bd')?.value  || 32);
  const ch  = parseInt(document.getElementById('wiz-ch')?.value  || 32);
  const bytesPerHour = sr * (bd / 8) * ch * 3600;
  const gb = (bytesPerHour / 1e9).toFixed(1);
  const el = document.getElementById('diskEstimate');
  if (el) el.textContent = `~${gb} GB / hour`;
}
document.getElementById('wiz-sr')?.addEventListener('change', updateDiskEstimate);
document.getElementById('wiz-bd')?.addEventListener('change', updateDiskEstimate);
document.getElementById('wiz-ch')?.addEventListener('change', updateDiskEstimate);

// ── Apply ─────────────────────────────────────────────────────────────
async function applyConfig() {
  const log = document.getElementById('applyLog');
  const restart = document.getElementById('restartNotice');
  log.innerHTML = '';

  function logLine(text, cls='') {
    log.innerHTML += `<div class="${cls?'log-'+cls:''}">${text}</div>`;
    log.scrollTop = log.scrollHeight;
  }

  logLine('Starting configuration…', 'info');

  const payload = {
    wing_ip:                document.getElementById('wiz-ip').value.trim(),
    wing_osc_port:          parseInt(document.getElementById('wiz-port').value) || 2222,
    local_osc_port:         parseInt(document.getElementById('wiz-localport').value) || 2223,
    sample_rate:            parseInt(document.getElementById('wiz-sr').value) || 48000,
    bit_depth:              parseInt(document.getElementById('wiz-bd').value) || 32,
    record_channels:        parseInt(document.getElementById('wiz-ch').value) || 32,
    enable_audio_passthrough: document.getElementById('tog-audio').checked,
  };

  logLine(`Wing IP → ${payload.wing_ip}:${payload.wing_osc_port}`);
  logLine(`Sample rate → ${payload.sample_rate} Hz / ${payload.bit_depth}-bit`);
  logLine(`Record channels → ${payload.record_channels}`);
  logLine(`Audio passthrough → ${payload.enable_audio_passthrough ? 'ENABLED' : 'DISABLED'}`);

  try {
    const r = await fetch('/api/setup/apply', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload),
    });
    const data = await r.json();

    if (data.env?.success) {
      logLine('✓ .env configuration written', 'ok');
    } else {
      logLine(`✗ .env write failed: ${data.env?.message}`, 'err');
    }

    if (data.audio?.success) {
      const changed = data.audio.changed;
      logLine(`✓ docker-compose.yml audio passthrough ${changed ? 'updated' : 'unchanged'}`, 'ok');
    } else {
      logLine(`✗ docker-compose.yml update failed: ${data.audio?.message}`, 'err');
    }

    if (data.osc_client?.success) {
      logLine(`✓ Live OSC client updated → ${payload.wing_ip}:${payload.wing_osc_port}`, 'ok');
    } else {
      logLine(`⚠ OSC client update: ${data.osc_client?.message}`, 'warn');
    }

    if (data.restart_required) {
      logLine('⚠ Container restart required to activate audio changes', 'warn');
      restart.classList.add('visible');
    } else {
      logLine('✓ All changes applied. No restart needed.', 'ok');
      logLine('Setup complete! You can close this wizard.', 'info');
    }

    // Update topbar connection fields
    document.getElementById('wingIP').value   = payload.wing_ip;
    document.getElementById('wingPort').value = payload.wing_osc_port;

  } catch(e) {
    logLine(`✗ Network error: ${e.message}`, 'err');
    logLine('Make sure the backend server is running.', 'warn');
  }
}

async function triggerRestart() {
  const btn = document.getElementById('restartBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Restarting…';

  try {
    const r = await fetch('/api/setup/restart', { method: 'POST' });
    const data = await r.json();
    const log = document.getElementById('applyLog');
    if (data.success) {
      log.innerHTML += '<div class="log-ok">✓ Restart initiated — page will reload in 8 seconds…</div>';
      setTimeout(() => location.reload(), 8000);
    } else {
      log.innerHTML += `<div class="log-warn">⚠ Auto-restart failed: ${data.message}</div>`;
      log.innerHTML += `<div class="log-info">Run manually: <code>docker compose restart wing-remote</code></div>`;
      btn.disabled = false;
      btn.textContent = '⟳ Retry Restart';
    }
  } catch(e) {
    document.getElementById('applyLog').innerHTML +=
      '<div class="log-warn">⚠ Could not contact server — the restart may be in progress. Reloading…</div>';
    setTimeout(() => location.reload(), 5000);
  }
}

// ── Step navigation ────────────────────────────────────────────────────
function wizNav(dir) {
  const newStep = WIZ.step + dir;
  if (newStep < 0 || newStep >= WIZ.totalSteps) return;

  // Trigger apply when entering step 4
  if (newStep === 4) applyConfig();

  // Leave current
  document.getElementById(`panel-${WIZ.step}`).classList.remove('active');
  document.getElementById(`tab-${WIZ.step}`).classList.remove('active');
  document.getElementById(`tab-${WIZ.step}`).classList.add('done');

  WIZ.step = newStep;

  document.getElementById(`panel-${WIZ.step}`).classList.add('active');
  document.getElementById(`tab-${WIZ.step}`).classList.add('active');
  document.getElementById(`tab-${WIZ.step}`).classList.remove('done');

  // Footer
  document.getElementById('wizBack').style.visibility = WIZ.step === 0 ? 'hidden' : 'visible';
  document.getElementById('wizStepLabel').textContent = `Step ${WIZ.step+1} of ${WIZ.totalSteps}`;

  const nextBtn = document.getElementById('wizNext');
  if (WIZ.step === WIZ.totalSteps - 1) {
    nextBtn.textContent = 'Close ✓';
    nextBtn.className = 'wiz-nav-btn wiz-btn-finish';
    nextBtn.onclick = closeWizard;
  } else {
    nextBtn.textContent = 'Next →';
    nextBtn.className = 'wiz-nav-btn wiz-btn-next';
    nextBtn.onclick = () => wizNav(1);
  }
}

// Init footer state
document.getElementById('wizBack').style.visibility = 'hidden';