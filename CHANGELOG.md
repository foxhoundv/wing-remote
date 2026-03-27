# WING Remote — Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.0.0] — 2026-03-26

### Overview
Version 2.0 is a full rewrite of the original prototype. Every layer of the
stack — OSC protocol implementation, mixer state model, strip rendering,
meter engine, and UI — was rebuilt from scratch against the official
**Behringer Wing Remote Protocols V3.1.0** documentation.

---

### Added

#### Hardware Meter Engine
- Implemented the Wing native **binary TCP protocol** (port 2222, Channel 3)
  for real hardware VU meter data
- Subscribes to all strip types simultaneously: channels 1–40, aux 1–8,
  buses 1–16, mains 1–4, matrix 1–8, DCA 1–16
- Parses 2-byte signed big-endian meter words (1/256 dB units) per strip:
  input L/R, output L/R, gate key, gate gain, dyn key, dyn gain
- Subscription renewed every 4 seconds (Wing times out after 5 s)
- Automatic TCP reconnect with exponential backoff on connection loss
- Gate (G) and Dynamics (D) LED indicators on every channel strip, lit in
  real time from hardware meter gate_key / dyn_key values

#### Full Strip Type Coverage
- All six Wing strip types now fully implemented: **CH 1–40**, **AUX 1–8**,
  **BUS 1–16**, **MAIN 1–4**, **MTX 1–8**, **DCA 1–16**
- Sidebar navigation correctly switches the strip area between all types
- Layer tabs paginate correctly within each type:
  - CH: three tabs — 1–16, 17–32, 33–40
  - BUS/DCA: two tabs of 8 each
- All strip attributes (name, fader, mute, pan, solo) pulled from Wing on
  connect and kept live via OSC subscription push

#### Detail Panel — Live Hardware Values
- Clicking any strip opens a detail panel populated with real Wing data:
  - **Parametric EQ**: band count adapts per strip type (4 for channels,
    6–8 for buses/mains); knob rotation, gain labels, frequency labels,
    and ON/OFF badge all reflect hardware state
  - **Compressor**: threshold, ratio, attack, release, make-up gain with
    live values; sliders send OSC back to Wing; transfer curve redraws
    from real threshold/ratio; ON/OFF badge lights blue
  - **Gate / Expander**: threshold, range, attack, release; shown only for
    strip types that have a gate (channels, aux); ON/OFF badge lights green
  - **Bus Sends**: all 16 sends per channel with real level (dB) and
    on/off state; tapping ON/OFF sends OSC toggle; sliders send level changes

#### Bulk State Query on Connect
- On every browser connect and container startup, queries the full parameter
  set for all strips: name, fader, mute, pan, solo, EQ (4 bands × g/f/q),
  compressor (on/thr/ratio/att/rel/gain/knee), gate (on/thr/range/att/rel),
  and all 16 bus send levels + on/off — ~3,200 OSC queries sent in batches
- OSC dispatcher registers handlers for all parameter paths so replies
  update the mixer state and re-render any currently visible strip

#### Auto-Connect & Live Status
- Backend `wing_probe_loop` probes the Wing with an OSC `/?` query every
  5 s (disconnected) or 15 s (connected) and broadcasts `wing_status`
  messages to all browsers
- `fetchAndApplyStatus()` hits `/api/status` via REST on every page load,
  WebSocket reconnect, and after wizard apply — status indicators and IP
  field update within 500 ms, no waiting for the probe cycle
- Wing IP/port changes applied live without container restart:
  `WING_IP` and `WING_OSC_PORT` are now live-mutable functions backed by
  module variables updated by `set_wing_target()`; `setup_apply` calls
  this immediately so every subsequent probe and OSC send uses the new address

#### Setup Wizard Improvements
- Audio passthrough now uses `privileged: true` in docker-compose and an
  `entrypoint.sh` that detects `/dev/snd` at runtime — container always
  starts cleanly whether or not Wing USB is connected
- `/dev/snd` passthrough toggle no longer patches docker-compose.yml
  (which caused YAML corruption and "no such file or directory" errors)
- Wizard audio step: toggle is always enabled; "NOT YET" amber badge
  instead of disabled red "NOT FOUND"; Rescan button refreshes device
  list without resetting the user's toggle choice
- Wing IP changes take effect immediately after Apply — no restart needed

#### Navigation
- Top menu matches Wing touchscreen button order:
  **Home · Effects · Meters · Routing · Library · Utility | Recording | Setup ⚙**
- Vertical dividers separate the Wing-mirroring buttons from the
  webapp-specific ones (Recording, Setup)
- Setup button is amber and tooltips "Wing Remote settings only — does not
  affect the Behringer Wing console"

#### Light / Dark Mode
- Full light theme with warm grey palette designed for bright environments
- Toggle button (Material Design outline SVG icons: crescent moon / sun
  with rays) positioned to the left of the OSC status indicator
- Preference persisted to `localStorage`; applied before first paint to
  avoid flash of wrong theme on page reload
- All hardcoded dark hex colours overridden for light mode: fader tracks,
  knobs, meter bars, strip LEDs, EQ/dynamics graphs, wizard panels

#### WebSocket Message Types
- `wing_status` — Wing connectivity state broadcast to all browsers
- `eq_on`, `eq_band` — EQ enable and per-band parameter updates
- `dyn` — compressor parameter block updates
- `gate` — gate parameter block updates
- `send` — bus send level/on updates
- `meters` — hardware VU levels keyed `"ch-1"`, `"aux-3"`, `"bus-1"` etc.
  including `"ch-1-r"` (right channel), `"ch-1-gate"`, `"ch-1-dyn"` state flags

---

### Fixed

- **OSC port**: Wing always uses port 2223 (not 2222 as originally coded)
- **OSC paths**: corrected from X32 syntax (`/ch/01/mix/fader`) to Wing
  syntax (`/ch/1/fdr`); mute from `/ch/01/mix/on` to `/ch/1/mute`
- **Master path**: `/main/1/fdr` not `/main/st/fdr`
- **Solo path**: `/ch/{n}/$solo` (dollar prefix required)
- **Subscription command**: `/*S` not `/#456/*S` (that is a native binary hash)
- **Mute semantics**: Wing `0` = unmuted, `1` = muted (was inverted)
- **Meter values**: were fader positions from software state, now real
  hardware post-fader output levels from the binary meter protocol
- **Tab labels**: CH 17–24/25–32/33–40 corrected to CH 17–32/33–40
- **Strip attribute sync**: WS handlers now call `refreshStripIfVisible()`
  when the target DOM element is not found, so tab 2+ strips update
  correctly without requiring a full re-render
- **YAML corruption**: `apply_audio_passthrough` previously used regex
  substitution on docker-compose.yml producing invalid indentation;
  replaced with exact line-by-line sentinel matching, then replaced
  entirely with `privileged: true` runtime detection approach
- **Permission denied**: container ran as non-root user; bind-mounted
  `.env` and `docker-compose.yml` were root-owned; fixed by running as root
- **Entrypoint permission**: `chmod +x entrypoint.sh` added to Dockerfile
  so the script is executable inside the image regardless of host filesystem
- **Pan response parsing**: Wing returns pan as `float -100..100`; was
  being treated as normalized `0..1`
- **Snapshot apply**: all strip attributes (mute, pan, name, solo,
  gateActive, dynActive) now applied from snapshot; previously only fader

---

### Changed

- Mixer state model expanded: each channel now stores `eq`, `dyn`, `gate`,
  and `sends` objects alongside the basic `fader/mute/pan/name/solo`
- `WING_IP` and `WING_OSC_PORT` refactored from module constants to
  callable functions backed by mutable globals (`_wing_ip`, `_wing_port`)
- Meter broadcast payload key renamed from `channels` to `levels` with
  typed keys (`"ch-1"`, `"aux-2"`, etc.) covering all strip types
- `docker-compose.yml` volumes: `recordings` and `snapshots` use
  Docker-managed named volumes (no host bind-mount required)
- Audio device passthrough: `devices:` block replaced by `privileged: true`
  + runtime detection in `entrypoint.sh`

---

### Removed

- Fake oscillating VU meter animation when Wing is connected (retained only
  when Wing is unreachable as a visual placeholder)
- Static `renderBusSends()`, `updateParam()`, `updateRatio()` functions
  replaced by `populateDetailPanel()` which reads live Wing state
- X32-style OSC path normalisation shim (no longer needed)
- Dynamic injection of Setup button via `insertAdjacentHTML` (now static HTML)

---

## [1.0.0] — Initial Release

- Basic FastAPI backend with OSC bridge and WebSocket hub
- Single-page HTML UI with Wing-inspired dark theme
- 16-channel strip display with fake placeholder VU meters
- Setup Wizard (5 steps): environment detection, OSC test, audio config,
  recording format, apply
- Multitrack WAV recording via sounddevice + soundfile
- Docker + docker-compose deployment
- Basic fader, mute, solo, pan controls via OSC

---

## [2.0.1] — 2026-03-26

### Fixed

- **Gate ON/OFF toggle**: Toggling gate on/off caused the section content to disappear.
  Root cause: `_csSendToggle` was calling `_csShowSection` (which itself calls `_csRenderNavRail`)
  and then calling `_csRenderNavRail` again — the double render race cleared the DOM.
  Fixed by rewriting `_csSendToggle` to render the section content directly without
  the cascading call chain.

- **EQ detail panel**: Replaced the simple 6-knob grid with full per-band detail:
  - **Low Shelf**: Lo-Cut enable/disable toggle (with status indicator), Gain L slider,
    Frequency L slider (log-scale 20 Hz–20 kHz)
  - **PEQ 1–4**: Gain, Frequency, and Q (bandwidth) sliders per band with live dB/Hz labels
  - **High Shelf**: Hi-Cut enable/disable toggle, Gain H slider, Frequency H slider
  - Band selector tabs across the top with gain colour coding (green=boost, red=cut)
  - Main EQ graph redraws on every parameter change; frequency uses proper log scale

- **Dynamics envelope graph**: Added a working `ENVELOPE` canvas panel next to the
  transfer curve. Attack adjusts the left rising slope, Hold expands/shrinks the flat
  top, Release adjusts the right falling slope. Control point circles show at each
  vertex. All three parameters are sliders connected to OSC sends.

- **Main Sends pan visualiser**: The pan knob had no visual feedback. Replaced the
  non-functional circular scope with a horizontal L–R bar: a track spanning the full
  width with a blue puck that moves left/right as pan changes, filled region showing
  the pan direction, and L/C/R labels.

- **Main Sends fader column width**: When a send level displayed −∞ or a double-digit
  dB value (e.g. −12.3 dB), the column would shift in width. Fixed by giving every
  dB display a fixed `width:52px` container with `overflow:hidden`.

- **Bus Sends layout**: Replaced the 4×4 grid with vertical channel strips (one per bus)
  matching the look of the main mixer strips. Each bus strip now shows:
  - Bus name
  - **TAP** toggle (PRE / POST) — highlighted blue for POST, amber for PRE
  - Fixed-width dB display
  - Vertical fader
  - ON/OFF toggle
  - **PAN LNK** toggle (pan link on/off) — highlighted green when linked
  All 16 buses scroll horizontally.

### Changed

- `_csDynParam` renamed to `_csDynEnvParam` for envelope-specific parameters
  (attack, hold, release) to distinguish them from transfer-curve parameters
  (threshold, ratio, knee) which use a separate handler.
