# WING Remote — Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.3.8] — 2026-03-27

### Fixed

- **Subscription command contained a literal tilde instead of a null byte**
  — the Wing protocol documentation uses `~` to represent `\0` (null byte)
  in printed examples, e.g. `/*S~` means the OSC string `/*S\0`. This is a
  documentation convention, not a literal character. OSC requires every string
  to be null-terminated and padded to a multiple of 4 bytes — pythonosc
  handles this automatically when the address is passed without a tilde.

  Our subscription command was `/%2224/*S~` (11 chars + null + 1 pad = 12
  bytes), which sent ASCII `0x7E` (tilde) as the last address character,
  making the Wing receive an unrecognised command. The fix is `/%2224/*S`
  (9 chars + null + 2 pads = 12 bytes), which pythonosc encodes correctly
  as `2f25323232342f2a53000000` — a valid, Wing-recognised OSC address.

---

## [2.3.7] — 2026-03-27

### Changed

- **Bulk query fires only once — on Wing connect, not on every browser open**
  — `bulk_query_wing()` now has exactly two trigger points:

  1. **Startup** (`_delayed_bulk_query`) — runs 3 seconds after the container
     starts, once the OSC server is ready, to populate `app_state.mixer` with
     the Wing's initial state.
  2. **Wing (re)connect** (`wing_probe_loop`) — fires once each time the probe
     loop detects the Wing has become reachable after being unreachable,
     ensuring state is refreshed if the Wing rebooted or was disconnected.

  The previous behaviour sent ~3,500 OSC GET requests to the Wing on **every
  new browser tab or page refresh**, which is unnecessary and can flood the
  Wing's OSC server. `app_state.mixer` is kept current in real time by the
  `/*S~` subscription push events and the binary TCP parameter change receiver,
  so a new browser tab simply receives the cached snapshot already held in
  memory — no Wing queries needed.

---

## [2.3.7] — 2026-03-27

### Fixed

- **8-second meter/fader delay** — `bulk_query_wing()` was sending ~5,500 OSC
  GET requests (40 channels × ~110 params each + aux/bus/main/matrix) in batches
  of 10 with a 20ms sleep between batches. Total blocking time: ~11 seconds of
  `await asyncio.sleep()`. While the event loop technically processes other
  coroutines during sleep, the Wing's OSC server was also being flooded with
  5,500 UDP queries, causing it to queue replies for ~8–11 seconds before
  processing live push events. Meters and fader moves appeared with an 8-second
  lag as a result.

  **Fix:** Split into two tiers:
  - **Tier 1 (Essential)** — name, fader, mute, pan, solo, icon, color for all
    strips (~240 queries, batches of 20, 5ms gaps → completes in ~0.3s). Runs
    on every browser connect.
  - **Tier 2 (Deep)** — EQ, dynamics, gate, sends, input options (~800 queries,
    batches of 10, 20ms gaps → runs in background). Starts 1 second after the
    essential query, so live updates are never blocked.

- **Meter loop stalling 100ms per iteration** — `_read_binary_tcp_changes()`
  called `asyncio.wait_for(tcp_reader.read(256), timeout=0.1)` which blocked
  for 100ms waiting for TCP data that usually isn't there. With the meter loop
  running at 25ms intervals, this caused every fourth frame to take 100ms
  instead of 25ms, reducing effective meter rate to ~8fps and adding
  unpredictable latency. Fixed to `timeout=0.0` (non-blocking poll) — if no
  TCP data is buffered the call returns immediately.

---

## [2.3.6] — 2026-03-27

### Fixed — Protocol compliance review against V3.1.0 spec

- **Fader SET sends dB not raw 0–1** — the V3.1.0 doc is explicit:
  `->W /ch/2/fdr ,f [-3.0000]` sets to −3 dB. The Wing's `,sff` GET reply
  includes a raw 0–1 value at `arg1` as a convenience, but SET must use dB.
  Our code was sending raw (e.g. `0.75`) which Wing interpreted as `+0.75 dB`,
  placing every fader at the wrong position. Added `_wing_raw_to_db()` —
  the inverse of `_wing_db_to_raw()` — and the fader SET path now converts
  before transmitting.

- **Input options OSC paths corrected** — all input option paths were wrong.
  The Wing groups input settings under `/ch/N/in/set/` and filters under
  `/ch/N/flt/`:

  | Old (wrong) | Correct per V3.1.0 |
  |---|---|
  | `/ch/N/gain` | `/ch/N/in/set/$g` |
  | `/ch/N/trim` | `/ch/N/in/set/trim` |
  | `/ch/N/phantom` | `/ch/N/in/set/$vph` |
  | `/ch/N/inv` | `/ch/N/in/set/inv` |
  | `/ch/N/dly/on` | `/ch/N/in/set/dlyon` |
  | `/ch/N/dly/time` | `/ch/N/in/set/dly` |
  | `/ch/N/hpf/on` | `/ch/N/flt/lc` |
  | `/ch/N/hpf/f` | `/ch/N/flt/lcf` |
  | `/ch/N/lpf/on` | `/ch/N/flt/hc` |
  | `/ch/N/lpf/f` | `/ch/N/flt/hcf` |
  | `/ch/N/tilt` | `/ch/N/flt/tf` |

  Corrected in both the bulk query list and the OSC dispatcher registrations
  for channels and aux strips. All corresponding handlers updated to parse
  GET replies using `args[2]` (the actual value field in `,sff` responses).

- **Added missing aux input option handlers** — `handle_aux_phantom`,
  `handle_aux_invert`, `handle_aux_hpf_on/freq`, `handle_aux_lpf_on/freq`
  were registered in the dispatcher but not defined as functions. Added.

- **Added `handle_ch_tilt_on`** — tilt filter enable handler was missing.

---

## [2.3.5] — 2026-03-27

### Fixed

- **`/*S~` subscription — missing tilde** — Wing's OSC subscription commands
  require a trailing tilde (`~`) which is the OSC null-padding character.
  The subscription was being sent as `/*S` instead of `/*S~`, which the Wing
  was silently ignoring. Fixed to send `/%2224/*S~` (port-redirect + correct
  command format). The diagnostic sniffer confirmed the Wing gave no response
  to `/*S` — it now receives `/*S~` and will begin pushing single-value OSC
  events to port 2224.

### Added

- **Binary TCP parameter change receiver** — hex dump analysis of a live
  fader move revealed that the Wing *also* sends parameter changes on the
  native binary TCP channel 2 (port 2222), interleaved with meter data.
  These arrive as `0xD7 <hash> 0xD5/D6/D4 <value>` tokens — the Wing's
  internal hash-addressed binary protocol. Added `_read_binary_tcp_changes()`
  which reads and parses these packets from the meter TCP stream on every
  loop iteration, and `_dispatch_binary_change()` which routes them through
  the same OSC dispatcher handlers so fader, mute, pan, and all other
  parameter updates update `app_state.mixer` and broadcast to browsers
  via WebSocket — regardless of whether the `/*S~` OSC subscription is
  also working. This provides a second, independent path for receiving
  real-time Wing state changes.

---

## [2.3.4] — 2026-03-27

### Changed

- **`docker-compose.yml` revised for Windows bridge networking** — switched
  from `network_mode: host` (Linux-only) to explicit bridge port mappings
  so the container works on Windows Docker Desktop and macOS. Port layout:

  | Port | Protocol | Direction | Purpose |
  |---|---|---|---|
  | 8000 | TCP | inbound | Web UI |
  | 2224 | UDP | inbound | OSC push events from Wing (matches `LOCAL_OSC_PORT`) |
  | 2225 | UDP | inbound | Binary meter data from Wing (matches `METER_UDP_PORT`) |
  | 2222 | TCP | outbound | Container → Wing meter subscription (no mapping needed) |
  | 2223 | UDP | outbound | Container → Wing OSC commands (no mapping needed) |

### Fixed in docker-compose.yml

- Port 2222 was listed as `udp` in the uploaded replacement file — corrected
  to `tcp`. The Wing binary meter interface uses a **TCP** connection (the
  container opens a persistent TCP stream to Wing port 2222 to subscribe to
  meter data). Using the wrong protocol would silently drop the connection.

- Port 2225/udp (meter UDP receiver) was missing from the uploaded file.
  Wing sends binary meter packets to this port after the TCP subscription
  is established. Without it mapped, all meter data is silently dropped
  by the Docker bridge NAT layer.

---

## [2.3.3] — 2026-03-27

### Fixed

- **Wing push events never arrived — subscription port mismatch** — the Wing
  OSC subscription command `/*S` tells Wing to push parameter change events
  back to the sender's source port. However, Wing only honours one active
  subscription at a time across the entire console. If Wing Edit or any
  other OSC client had previously subscribed from a different port, Wing
  continues pushing to that port and ignores our `/*S`. The fix uses the
  Wing port-redirect prefix: `/%PORT/*S` (e.g. `/%2224/*S`), which
  explicitly instructs Wing to send push events to a specific UDP port
  regardless of what other clients have registered. This ensures our app
  always receives live fader, mute, pan, name, EQ, and dynamics updates
  from the Wing in real time, even when Wing Edit is also running.

- **Pan values parsed incorrectly from GET replies** — Wing's GET reply for
  pan uses tag format `,sff`: `arg0` is an ASCII string label, `arg1` is a
  normalised 0–1 raw position (0.5 = centre), and `arg2` is the actual pan
  value in Wing's −100..100 degree scale. `parse_wing_pan` was reading
  `arg1` (0.5) and dividing by 100, yielding 0.005 instead of 0.0 for a
  centred pan. Fixed to read `arg2` from GET replies (when `arg0` is a
  string) and `arg0` directly from `/*S` push events (which send the
  actual value as a single float).

---

## [2.3.2] — 2026-03-27

### Fixed

- **All Wing state ignored — root cause found and fixed** — every fader
  position, mute state, pan, name, EQ value, gate, and dynamics parameter
  received from the Wing (both GET replies and `/*S` subscription pushes)
  was being silently discarded. Root cause: the OSC message dispatcher in
  `WingOSCTransport.datagram_received` called
  `h.invoke(msg.address, msg.params)`, passing the params list as a
  **single argument**. Python-osc's `Handler.invoke` signature expects
  `(address, *args)` — individual positional arguments. Every handler
  therefore received `args = ([list_of_values],)` — a one-element tuple
  containing the whole list — so `parse_wing_float(args)` saw
  `args[0]` as a list (not a string or float) and returned `0.0` for
  every fader, `False` for every mute, `""` for every name. The fix is
  one character: `h.invoke(msg.address, *msg.params)` — unpacking the
  params list so handlers receive the values as intended.

- **Bulk query not firing on browser connect** — the guard condition
  `if not any(app_state.mixer["channels"].values())` was always `False`
  because `app_state.mixer["channels"]` is pre-populated with 40 default
  channel dicts at init time. The condition was intended to detect "mixer
  state is empty", but an empty dict is falsy and a dict with keys is
  always truthy regardless of whether those keys hold real Wing values or
  defaults. Changed to `if app_state.wing_connected:` so a fresh bulk
  query is triggered on every new browser connect while the Wing is live,
  ensuring a just-opened tab always shows the current console state.

---

## [2.3.1] — 2026-03-27

### Fixed

- **Fader handle position off by 7px** — the `.fader-handle` CSS rule used
  `transform: translate(-50%, 50%)`, where the `50%` Y component shifts the
  element downward by half its own height (7px, since the handle is 14px tall).
  Combined with `bottom: calc(X% - 7px)`, the handle centre ended up at
  `X% - 7px` instead of exactly `X%`, placing every handle 7px lower than the
  corresponding Wing console position. Fixed by changing the transform to
  `translateX(-50%)` (horizontal centring only). The `bottom: calc(X% - 7px)`
  formula is unchanged and now correctly places the handle centre at `X%`.

---

## [2.3.0] — 2026-03-27

### Overview
Full bidirectional state synchronisation between the Wing console and the
web app, matching the behaviour of Wing Edit: physical changes on the console
are immediately reflected in the app, and changes made in the app are
immediately applied to the console.

### Added

#### Full Wing → App Push Coverage
- **New OSC dispatcher handlers** registered for every parameter that was
  previously query-only (GET but no live push handler):
  - `phantom` — +48V phantom power state
  - `inv` / `invert` — signal polarity invert
  - `hpf/on` + `hpf/f` — lo-cut filter on/off and frequency
  - `lpf/on` + `lpf/f` — hi-cut filter on/off and frequency
  - `dly/on` + `dly/time` — delay on/off and time value
  - `gain` — preamp gain level
  - `trim` — trim level
  - `icon` — channel icon index
  - `col` — channel colour index
  - `preins/on` + `preins/ins` — Insert 1 enable and FX slot assignment
  - `postins/on` + `postins/ins` — Insert 2 enable and FX slot assignment
  - Aux equivalents for gain, trim, icon, col, and preins

  Any physical change to these parameters on the Wing console now immediately
  updates `app_state.mixer` and is broadcast to all connected browsers.

#### New Frontend WebSocket Message Types
- `input_options` — carries `{strip, ch, key, value}` for any input options
  change; applied to local state and re-renders the channel settings INPUT
  section if it is currently open for the affected channel
- `icon` — updates `iconId` on the affected strip; refreshes the channel
  settings nav rail thumbnail if open
- `color` — updates `colorIdx` and immediately updates the color bar on
  the strip DOM element
- `insert` — updates `ins1` / `ins2` objects; re-renders the Insert section
  in channel settings if currently open for the affected channel

#### Expanded Bulk State Query
- Added to the startup GET query for all 40 channels and 8 aux strips:
  `phantom`, `inv`, `hpf/on`, `hpf/f`, `lpf/on`, `lpf/f`, `dly/on`,
  `dly/time`, `icon`, `col`, `gain`, `trim`, `gate/hld`, `dyn/hld`,
  `preins/on`, `preins/ins`, `postins/on`, `postins/ins`, all 4 main
  sends (`main/1-4/on` + `main/1-4/lvl`), and bus send pan values

#### Expanded Snapshot Application
- Browser `snapshot` handler now applies all new fields from the Wing state
  on connect: `phantom`, `invert`, `locut`, `hicut`, `tilt`, `delay`,
  `gain`, `trim`, `locut_freq`, `hicut_freq`, `delay_time`, `iconId`,
  `colorIdx`, `ins1`, `ins2`, `eq`, `dyn`, `gate`, `sends`, `mainSends`

### Fixed

#### Meter Engine — Subscription Split into Two TCP Writes
- The Wing binary meter subscription packet was being sent as a single
  combined TCP write (port declaration + report ID + collection). The
  Wing V3.1.0 protocol docs show these as two separate writes. Splitting
  them with a 50 ms gap between the port declaration and the collection
  write resolves the issue where Wing was not sending any UDP meter data
  back to the app.

#### Meter Parser — Correct DCA Word Count
- DCA strips have 4 words (8 bytes) per strip as specified in Table 5 of
  the V3.1.0 docs (pre-fader L/R + post-fader L/R only — no gate/dyn
  words). The parser was using 16 bytes for all strips including DCA,
  misaligning the offset for everything following the DCA section in the
  packet. Fixed with `METER_WORDS_PER_STRIP` dict and a running byte
  offset instead of a flat stride.

#### Meters View — All Strip Types
- The Meters nav view was only showing the 40 channel strips. Now renders
  all five metered strip types in labelled sections with section-specific
  heights and accent colours: CH (orange), AUX (blue), BUS (cyan),
  MAIN (red), MTX (green).

#### Right Channel Meter Smoothing
- The right channel VU bar was being updated directly from `applyMeterValues`
  bypassing the attack/release smoothing loop. Both channels now go through
  the same `animateMeters` interpolation (`ch.meter[1]` for right channel).

#### Bulk Query Flooding
- `bulk_query_wing()` was called on every browser WebSocket connect,
  sending ~3,200+ OSC queries to the Wing every time a browser tab was
  opened or refreshed. It now only fires when `app_state.mixer["channels"]`
  is empty — i.e. once when Wing first connects — avoiding unnecessary
  UDP floods that could cause the Wing OSC server to become unresponsive.

---

## [2.2.2] — 2026-03-27

### Fixed

- **Auxiliary channel nav rail** — opening Channel Settings on an AUX strip was
  showing the Dynamics and Insert 2 rail cards, which do not exist on auxiliary
  channels per the Wing V3.1.0 protocol spec.

  - **Dynamics**: AUX channels have `/aux/n/dyn` (PSE/LA combo compressor) so
    the Dynamics section is correctly retained.
  - **Insert 2**: AUX channels have `/aux/n/preins` (one insert slot, equivalent
    to Insert 1) but no `/aux/n/postins` (post-insert), so Insert 2 is now
    hidden for AUX strips.

### Changed

- **`CS_SECTION_MAP`** — new per-strip-type section allowlist controls which nav
  rail cards are shown when Channel Settings opens. Sections are filtered for
  each strip type based on what the Wing hardware actually supports:

  | Strip type | Sections |
  |---|---|
  | CH 1–40 | Home · Input · Gate · EQ · Dynamics · Insert 1 · Insert 2 · Main Sends · Bus Sends |
  | AUX 1–8 | Home · Input · Gate · EQ · Dynamics · Insert 1 · Main Sends · Bus Sends |
  | BUS / MAIN / MTX | Home · EQ · Dynamics · Main Sends |
  | DCA 1–16 | Home only |

- **`_csSectionsForType()`** — returns the filtered section list for the current
  strip type; used by both `_csRenderNavRail` and `_csDrawNavThumbs` so thumbnail
  canvases are only drawn for sections actually present in the DOM.

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
