// Wing Remote v2.1 — Channel Selection & Detail Panel
// ── CHANNEL SELECTION ───────────────────────────────
function selectChannel(globalIdx, stripType) {
  state.selectedChannel   = globalIdx;
  state.selectedStripType = stripType || state.currentLayer;
  document.querySelectorAll('.channel-strip').forEach(s => s.classList.remove('selected'));
  const layer = LAYERS[state.selectedStripType];
  if (!layer) return;
  const ch = layer.strips()[globalIdx];
  if (!ch) return;
  document.getElementById(`strip-${state.selectedStripType}-${ch.id}`)?.classList.add('selected');
  document.getElementById('detailTitle').textContent = ch.name;
  document.getElementById('detailBadge').textContent = `${layer.prefix} ${ch.id}`;
  populateDetailPanel(ch, state.selectedStripType);
}

// ── DETAIL PANEL — populate with real hardware values ────────────────────────
function populateDetailPanel(ch, stripType) {
  if (!ch) return;

  // ── EQ ───────────────────────────────────────────────────────────────────
  const eq = ch.eq || {on: false, bands: []};
  const eqOnBadge = document.getElementById('eq-on-badge');
  if (eqOnBadge) {
    eqOnBadge.textContent = eq.on ? 'ON' : 'OFF';
    eqOnBadge.style.color = eq.on ? 'var(--cyan)' : 'var(--text-muted)';
    eqOnBadge.style.borderColor = eq.on ? 'var(--cyan)' : 'var(--border)';
    eqOnBadge.style.background  = eq.on ? 'rgba(0,212,212,.1)' : 'var(--bg-raised)';
  }

  // Render EQ band knobs dynamically based on how many bands exist
  const bandsEl = document.getElementById('eqBandsContainer');
  if (bandsEl) {
    const bands = eq.bands || [];
    const labels = ['LF','LMF','MF','HMF','HF','HF2','HF3','HF4'].slice(0, bands.length || 4);
    bandsEl.innerHTML = labels.map((lbl, i) => {
      const band = bands[i] || {g:0, f:1000, q:0.7};
      const gain = typeof band.g === 'number' ? band.g.toFixed(1) : '0.0';
      const freq = typeof band.f === 'number'
        ? (band.f >= 1000 ? (band.f/1000).toFixed(1)+'k' : band.f.toFixed(0)+'Hz')
        : '—';
      const rot  = ((band.g||0) / 15) * 135;
      return `<div class="eq-band">
        <div class="eq-band-name">${lbl}</div>
        <div class="knob" style="transform:rotate(${rot}deg)" title="${freq}"></div>
        <div class="eq-band-val" style="color:${(band.g||0)>0?'var(--cyan)':(band.g||0)<0?'var(--amber)':'var(--text-dim)'}">${gain>0?'+':''}${gain}dB</div>
        <div style="font-size:8px;color:var(--text-muted);text-align:center">${freq}</div>
      </div>`;
    }).join('');
    drawEqMain(bands);  // pass full band objects so getEqCurve uses real f/q values
  }

  // ── Dynamics ─────────────────────────────────────────────────────────────
  const dyn = ch.dyn || {on: false, thr: -20, ratio: '4.0', att: 10, rel: 100};
  const dynOnBadge = document.getElementById('dyn-on-badge');
  if (dynOnBadge) {
    dynOnBadge.textContent = dyn.on ? 'ON' : 'OFF';
    dynOnBadge.style.color = dyn.on ? 'var(--blue)' : 'var(--text-muted)';
    dynOnBadge.style.borderColor = dyn.on ? 'var(--blue)' : 'var(--border)';
    dynOnBadge.style.background  = dyn.on ? 'rgba(74,158,255,.1)' : 'var(--bg-raised)';
  }
  const dynEl = document.getElementById('dynParams');
  if (dynEl) {
    const thr   = typeof dyn.thr === 'number' ? dyn.thr : -20;
    const ratio = dyn.ratio !== undefined ? dyn.ratio : '4.0';
    const att   = typeof dyn.att === 'number' ? dyn.att : 10;
    const rel   = typeof dyn.rel === 'number' ? dyn.rel : 100;
    const gain  = typeof dyn.gain === 'number' ? dyn.gain : 0;
    const thrPct  = Math.round(((thr + 60) / 60) * 100);
    const attPct  = Math.round((att / 200) * 100);
    const relPct  = Math.round((Math.log10(rel/4) / Math.log10(3000/4)) * 100);
    dynEl.innerHTML = `
      <div class="param-item"><div class="param-item-label">Threshold</div>
        <div class="param-item-val">${thr.toFixed(1)} dB</div>
        <input type="range" class="param-slider" min="0" max="100" value="${thrPct}"
          oninput="sendOSCfromDetail('${stripType}',${ch.id},'dyn/thr',this.value,-60,0)"></div>
      <div class="param-item"><div class="param-item-label">Ratio</div>
        <div class="param-item-val">${ratio}:1</div>
        <input type="range" class="param-slider" min="0" max="100" value="40" disabled></div>
      <div class="param-item"><div class="param-item-label">Attack</div>
        <div class="param-item-val">${att.toFixed(1)} ms</div>
        <input type="range" class="param-slider" min="0" max="100" value="${attPct}"
          oninput="sendOSCfromDetail('${stripType}',${ch.id},'dyn/att',this.value,0,200)"></div>
      <div class="param-item"><div class="param-item-label">Release</div>
        <div class="param-item-val">${rel.toFixed(0)} ms</div>
        <input type="range" class="param-slider" min="0" max="100" value="${relPct}"
          oninput="sendOSCfromDetail('${stripType}',${ch.id},'dyn/rel',this.value,4,3000)"></div>
      ${gain !== 0 ? `<div class="param-item"><div class="param-item-label">Make-up Gain</div>
        <div class="param-item-val">${gain>=0?'+':''}${gain.toFixed(1)} dB</div></div>` : ''}`;
    drawDynGraph(thr, parseFloat(ratio) || 4);
  }

  // ── Gate ─────────────────────────────────────────────────────────────────
  const gate = ch.gate || {on: false, thr: -40, range: 60, att: 0, rel: 100};
  const gateOnBadge = document.getElementById('gate-on-badge');
  const gateEl      = document.getElementById('gateParams');
  const gateSection = document.getElementById('detail-gate');
  // Only show gate for strip types that have it
  const hasGate = stripType === 'ch' || stripType === 'aux';
  if (gateSection) gateSection.style.display = hasGate ? '' : 'none';
  if (hasGate) {
    if (gateOnBadge) {
      gateOnBadge.textContent = gate.on ? 'ON' : 'OFF';
      gateOnBadge.style.color = gate.on ? 'var(--green)' : 'var(--text-muted)';
      gateOnBadge.style.borderColor = gate.on ? 'var(--green-dim)' : 'var(--border)';
      gateOnBadge.style.background  = gate.on ? 'rgba(61,220,132,.1)' : 'var(--bg-raised)';
    }
    if (gateEl) {
      const thr   = typeof gate.thr   === 'number' ? gate.thr   : -40;
      const range = typeof gate.range === 'number' ? gate.range : 60;
      const att   = typeof gate.att   === 'number' ? gate.att   : 0;
      const rel   = typeof gate.rel   === 'number' ? gate.rel   : 100;
      const thrPct   = Math.round(((thr + 80) / 80) * 100);
      const rangePct = Math.round((range / 60) * 100);
      const attPct   = Math.round((att / 120) * 100);
      const relPct   = Math.round((rel / 4000) * 100);
      gateEl.innerHTML = `
        <div class="param-item"><div class="param-item-label">Threshold</div>
          <div class="param-item-val">${thr.toFixed(1)} dB</div>
          <input type="range" class="param-slider" min="0" max="100" value="${thrPct}"
            oninput="sendOSCfromDetail('${stripType}',${ch.id},'gate/thr',this.value,-80,0)"></div>
        <div class="param-item"><div class="param-item-label">Range</div>
          <div class="param-item-val">${range.toFixed(1)} dB</div>
          <input type="range" class="param-slider" min="0" max="100" value="${rangePct}"
            oninput="sendOSCfromDetail('${stripType}',${ch.id},'gate/range',this.value,3,60)"></div>
        <div class="param-item"><div class="param-item-label">Attack</div>
          <div class="param-item-val">${att.toFixed(1)} ms</div>
          <input type="range" class="param-slider" min="0" max="100" value="${attPct}"
            oninput="sendOSCfromDetail('${stripType}',${ch.id},'gate/att',this.value,0,120)"></div>
        <div class="param-item"><div class="param-item-label">Release</div>
          <div class="param-item-val">${rel.toFixed(0)} ms</div>
          <input type="range" class="param-slider" min="0" max="100" value="${relPct}"
            oninput="sendOSCfromDetail('${stripType}',${ch.id},'gate/rel',this.value,4,4000)"></div>`;
    }
  }

  // ── Bus Sends ─────────────────────────────────────────────────────────────
  const sendsSection = document.getElementById('detail-sends');
  const sendsEl      = document.getElementById('busSends');
  // Only show sends for channels and aux
  const hasSends = stripType === 'ch' || stripType === 'aux';
  if (sendsSection) sendsSection.style.display = hasSends ? '' : 'none';
  if (hasSends && sendsEl) {
    const sends = ch.sends || {};
    sendsEl.innerHTML = Array.from({length:16}, (_,i) => {
      const b    = String(i+1);
      const send = sends[b] || {on: false, lvl: 0.75};
      const lvlPct = Math.round((send.lvl || 0) * 100);
      const db   = faderToDb(send.lvl || 0);
      return `<div class="param-item">
        <div class="param-item-label" style="display:flex;justify-content:space-between;align-items:center">
          <span>BUS ${b}</span>
          <span style="font-size:8px;padding:1px 5px;border-radius:2px;cursor:pointer;
            background:${send.on?'rgba(232,130,10,.2)':'var(--bg-raised)'};
            border:1px solid ${send.on?'var(--orange-dim)':'var(--border)'};
            color:${send.on?'var(--orange)':'var(--text-muted)'};"
            onclick="toggleSendOn('${stripType}',${ch.id},${b})">${send.on?'ON':'OFF'}</span>
        </div>
        <div class="param-item-val">${db}</div>
        <input type="range" class="param-slider" min="0" max="100" value="${lvlPct}"
          oninput="sendSendLevel('${stripType}',${ch.id},${b},this.value)"></div>`;
    }).join('');
  }
}

// Send a parameter change from the detail panel to the Wing
function sendOSCfromDetail(stripType, id, paramPath, sliderVal, min, max) {
  const val = min + (sliderVal / 100) * (max - min);
  const path = `/${stripType === 'ch' ? 'ch' : stripType}/${id}/${paramPath}`;
  sendOSC(path, val);
}

function toggleSendOn(stripType, id, bus) {
  sendOSC(`/${stripType}/${id}/send/${bus}/on`, -1);  // Wing toggle
}

function sendSendLevel(stripType, id, bus, sliderVal) {
  const val = sliderVal / 100;
  sendOSC(`/${stripType}/${id}/send/${bus}/lvl`, val);
}