# WING Remote — Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.2.1] — 2026-03-27

### Fixed

- **Input Settings Rail Thumb** — the nav rail card for the Gain / Input section was
  showing a plain yellow gain-bar thumbnail that did not reflect the new input_options
  pill layout. Replaced with a 3×2 grid of six labelled pill boxes drawn on the 80×40
  canvas, one for each input option: **48V**, **LC**, **INV**, **HC**, **TILT**, **DLY**.
  Each pill reads live channel state and renders lit (coloured background + border) when
  enabled or dim (near-transparent) when disabled — matching the accent colours used in
  the content area (amber / blue / red / cyan / green / orange respectively). The thumbnail
  updates every time the nav rail redraws, so toggling any option in the content area is
  immediately reflected in the rail card.

### Changed

- **Rail card label** — the Gain section rail card label changed from **GAIN** to **INPUT**
  to match the section's actual function (input signal path options) and the backend
  rename to *Input Settings Rail Thumb*.
- **Rail card badge** — the gain dB value badge that previously appeared below the GAIN
  label has been removed. The six pill states in the thumbnail now communicate input
  status at a glance without needing a separate badge.

---

## [2.2.0] — 2026-03-27

### Added

#### Medium Grey Theme
- Added a third UI theme — **Mid Grey** — sitting comfortably between the
  existing dark and light modes. Background layers use desaturated charcoal
  greys (`#2a2c31` through `#42454d`), borders are medium-dark, and text is
  slightly softer than full dark mode. All accent colours (orange, green,
  cyan, red, amber, blue) are inherited unchanged from dark mode so the
  UI chrome retains full contrast and vibrancy against the grey surface.

#### Three-State Theme Cycle Button
- Replaced the two-icon dark/light toggle with a **composite SVG pill** showing
  three segments side by side, each representing one theme:
  - **☀ Half-sun** (left) — rays and a left semicircle arc; full opacity in Light mode
  - **⬤ Circle + lines** (center) — neutral mid-point symbol; full opacity in Mid Grey mode
  - **☽ Half-crescent** (right) — right-facing moon arc; full opacity in Dark mode
- Inactive segments dim to 35% opacity; the active segment is always visually
  distinct. All transitions animate at `0.2s` via CSS.
- Clicking the button cycles **Dark → Mid Grey → Light → Dark** in order.
- `localStorage` key `wing-theme` now stores `'dark'`, `'mid'`, or `'light'`.
  The saved value is restored before the first paint to prevent a theme flash
  on page reload.
- Button tooltip text cycles with the active theme to indicate the next state:
  e.g. *"Dark → Switch to Mid Grey"*.

#### Static Asset Paths Fixed
- The JS/CSS modular refactor in v2.1 introduced relative asset paths
  (`css/main.css`, `js/state.js`) that resolved to the wrong URL against
  FastAPI's `/static/` mount point. All `<link>` and `<script>` references
  updated to absolute paths (`/static/css/main.css`, `/static/js/state.js`)
  so the browser correctly fetches all stylesheets and scripts.

---

## [2.1.0] — 2026-03-26

### Added

#### Channel Settings Panel
- Clicking any channel name strip now opens a full-screen Wing-style channel
  editor that replaces the center area. A back arrow and channel name header
  are shown at the top; all changes are sent to the Wing via OSC immediately
  with no Save button required.
- **Left nav rail** with nine sections, each showing a mini-thumbnail canvas
  preview of the current state (EQ curve, gate transfer line, compressor curve,
  bus send bars, pan puck, gain bar, color swatch):
  - **Home** — four horizontal tabs: Overview, Icon/Color, Name, Tags
  - **Gain** — Channel Input (gain slider, +48V / Pad / Invert toggles), Trim &
    Balance, Filter (Lo-Cut / Hi-Cut / Tilt EQ on/off)
  - **Gate** — ON/OFF toggle, transfer curve canvas (blue when active), threshold /
    range / attack / release sliders
  - **EQ** — ON/OFF toggle, full-width frequency response canvas, six band tabs
    (Low Shelf, PEQ 1–4, High Shelf) each with per-band gain / frequency (log-scale)
    / Q sliders; Lo-Cut and Hi-Cut filter enable toggles on shelf bands; EQ graph
    redraws on every slider movement
  - **Dynamics** — ON/OFF toggle, compressor transfer curve (threshold / ratio /
    knee), and a separate Envelope canvas showing attack (left slope) / hold (flat top)
    / release (right slope) as a trapezoid with control point circles
  - **Insert 1 / Insert 2** — FX processor ON/OFF enable, slot type display
  - **Main Sends** — four vertical faders (M1–M4) with fixed-width dB displays,
    ON/OFF per send, and a horizontal L–R pan bar visualiser with a blue puck
  - **Bus Sends** — 16 vertical channel strips with TAP toggle (PRE amber / POST blue),
    fixed-width dB display, vertical fader, ON/OFF, and PAN LNK toggle; all 16
    scroll horizontally

#### View Pages (top nav)
- **Recording view** now fully wired: Record button sends `record_start` /
  `record_stop` WebSocket messages to the backend; timer counts from real
  backend state; recorded files listed with download and delete buttons;
  list reloads automatically when a recording stops
- **Library view** — two-column layout showing recorded WAV files (with
  download and delete) and scene snapshot slots
- **Utility view** — live connection status panel (Wing IP, OSC port,
  connected state, sample rate, bit depth, audio availability) fetched from
  `/api/status`; Setup Wizard shortcut button; system version display
- **Effects, Routing, Library** — display a 50% opaque greyed-out overlay with
  the message *"This feature is in progress as a sub-project to be implemented
  later. Thanks for stopping by!"*
- **Meters view** — full-width VU grid for all 40 channels updated live from
  the hardware meter engine at ~30 fps

#### Frontend Refactor — Modular File Structure
- The single 5,029-line `index.html` (212 KB) has been split into 13 focused
  files — an 85% reduction in index.html size (now 728 lines / 32 KB):

  ```
  frontend/static/
  ├── index.html           (728 lines — HTML structure only)
  ├── css/
  │   ├── main.css         (mixer UI, strips, meters, panels, ch-settings)
  │   └── wizard.css       (setup wizard overlay)
  └── js/
      ├── state.js         (shared state, LAYERS config, constants)
      ├── strips.js        (mixer model init, layer nav, strip rendering)
      ├── meters.js        (meter animation, EQ canvas helpers)
      ├── faders.js        (fader/knob drag, touch, mute/solo/rec)
      ├── detail.js        (channel selection, detail panel)
      ├── recording.js     (recording transport, waveform, param updaters)
      ├── views.js         (setView, all view builders, theme toggle)
      ├── osc.js           (WebSocket, OSC, Wing status, message handler, clock, init)
      ├── wizard.js        (setup wizard)
      └── ch-settings.js  (channel settings panel — all 9 sections)
  ```

- All 10 JS files pass Node.js syntax validation independently

---

### Fixed

- **Fader levels not syncing from Wing hardware** — root cause: `WingOSCTransport`
  (the UDP socket used to send OSC) was binding to an ephemeral port, so Wing
  sent all GET replies and subscription push events back to that ephemeral port
  rather than to the port our server was listening on. Fixed with a single
  unified UDP socket that both sends *from* and receives *on* `LOCAL_OSC_PORT`
  (2224), so Wing always replies to the right port.

- **Fader dB conversion** — Wing's `/*S` subscription pushes fader values as
  **dB** (e.g. `-3.0`), not raw 0–1. The old code clamped these to 0.0–1.0,
  so every pushed fader read as zero. Fixed with `_wing_db_to_raw()` — a
  piecewise linear converter derived from exact data points in the V3.1.0 docs:
  `raw=0.675@-3dB`, `0.75@0dB`, `0.85@+4dB`, `0.923@+10dB`.

- **No Master strip under Mains 1–4** — the `showMaster` flag was appending a
  disconnected hardcoded strip and not rendering the real main strips. Removed
  `showMaster`; main strips now render as normal strips with `main/1` styled as
  the L/R master (wider border, orange accent).

- **Port 8000 unreachable after BoundUDPClient change** — `BoundUDPClient`
  called `sock.bind()` in `__init__`, then `AsyncIOOSCUDPServer` tried to bind
  the same port. Even with `SO_REUSEPORT`, many Linux/Docker kernels block two
  sockets sharing a UDP port. Fixed by replacing both with `WingOSCTransport` —
  a single `asyncio.DatagramProtocol` that handles send and receive on one socket.

- **Setup wizard and channel settings not loading** — a Python script used raw
  strings with `\`` and `\${}` which wrote literal backslash-backtick and
  backslash-dollar-brace sequences into the JS files. JavaScript template literals
  interpret `\`` as an invalid escape and abort parsing, preventing all JS from
  loading. Fixed by: (a) replacing `\`` occurrences with plain backticks, (b)
  rewriting `_csEQRenderBandDetail` using `document.createElement` and
  `addEventListener` instead of HTML string concatenation to avoid all quote/
  escape conflicts.

- **EQ toggle button showing literal `${eq.on?'on':''}` text** — `\\${` escaped
  template expressions in `_csRenderEQ` and `_csEQRenderBandTabs` were rendering
  as literal text. Fixed by scoped `\\${` → `${` replacement within those
  function bodies.

- **Gate ON/OFF toggle cleared section content** — `_csSendToggle` called
  `_csShowSection` (which calls `_csRenderNavRail`) and then called
  `_csRenderNavRail` again — the double render race cleared the DOM before
  re-population. Fixed by rewriting `_csSendToggle` to render section content
  directly without the cascading call chain.

- **Pan visualiser in Main Sends non-functional** — replaced a non-interactive
  circular scope with a horizontal L–R bar: a track with a blue puck that
  physically moves as the pan slider changes, with a filled region and L/C/R
  labels. The `_csMainPan` handler now calls `sendPan()` and redraws on every
  input event.

- **Main Sends dB column width shifting** — when send level showed `−∞` or a
  multi-digit value (e.g. `−12.3 dB`) the column width changed. Fixed with a
  fixed `width:52px` container and `overflow:hidden` on every dB display.

- **44.1 kHz missing from wizard** — added `44100 Hz (CD Quality)` as the
  first option in the Setup Wizard Step 4 sample rate dropdown.

---

### Changed

- `_csDynParam` split into `_csDynParam` (transfer curve: threshold, ratio,
  knee) and `_csDynEnvParam` (envelope: attack, hold, release) for clarity

---

### Infrastructure

- **Docker `inflight` memory leak warning eliminated** — replaced the `docker-ce-cli`
  apt package installation (which triggered an internal npm chain containing the
  deprecated `inflight` package) with a direct download of the static Docker CLI
  binary from Docker's release server. No npm is invoked at any point during
  the build.
- **`.npmrc` added** — sets `fund=false`, `audit=false`, `loglevel=error` as
  a belt-and-suspenders guard against spurious npm warnings from Docker Buildkit
  or Compose v2 host tooling.

---

## [2.0.0] — 2026-03-26

### Overview
Version 2.0 is a full rewrite of the original prototype. Every layer of the
stack — OSC protocol implementation, mixer state model, strip rendering,
meter engine, and UI — was rebuilt from scratch against the official
**Behringer Wing Remote Protocols V3.1.0** documentation.

### Added

#### Hardware Meter Engine
- Implemented the Wing native binary TCP protocol (port 2222, Channel 3)
  for real hardware VU meter data
- Subscribes to all strip types: channels 1–40, aux 1–8, buses 1–16,
  mains 1–4, matrix 1–8, DCA 1–16
- Parses 2-byte signed big-endian meter words (1/256 dB units) per strip
- Subscription renewed every 4 seconds
- Gate (G) and Dynamics (D) LED indicators lit in real time from hardware
  meter gate_key / dyn_key values

#### Full Strip Type Coverage
- All six Wing strip types: CH 1–40, AUX 1–8, BUS 1–16, MAIN 1–4, MTX 1–8, DCA 1–16
- Layer tabs: CH three tabs (1–16, 17–32, 33–40), BUS/DCA two tabs of 8 each

#### Detail Panel
- EQ curves, compressor, gate, bus sends reflecting actual hardware state
- Bulk state query (~3,200 OSC queries) on every browser connect

#### Other
- Auto-connect with status updates within 500 ms of page load
- Live IP/port change via Setup Wizard without container restart
- Dark and light mode with Material Design SVG icons, persisted to localStorage
- `/*S` subscription push events with correct dB→raw conversion
- Wing probe loop broadcasting `wing_status` to all connected browsers

### Fixed
- OSC port (2222→2223), paths (X32→Wing syntax), mute semantics, solo path,
  subscription command, master path, tab labels, YAML corruption, pan parsing

---

## [1.0.0] — Initial Release

- Basic FastAPI backend with OSC bridge and WebSocket hub
- Single-page HTML UI with Wing-inspired dark theme
- 16-channel strip display with placeholder VU meters
- Setup Wizard (5 steps): environment detection, OSC test, audio config,
  recording format, apply
- Multitrack WAV recording via sounddevice + soundfile
- Docker + docker-compose deployment
