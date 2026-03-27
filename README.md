# WING Remote v2.1

A self-hosted web application for remotely controlling a **Behringer Wing** digital
mixer and recording multitrack audio — all from your browser, running in Docker.

> Implements the official **Wing Remote Protocols V3.1.0** by Patrick-Gilles Maillot
> (authorized by Behringer/Music Tribe).

---

## Features

| | Feature | Detail |
|---|---|---|
| 🎚 | **Full Mixer Control** | All 40 channels, 8 aux, 16 buses, 4 mains, 8 matrix, 16 DCA |
| 📊 | **Real Hardware VU Meters** | Live levels via Wing binary TCP protocol (port 2222, Channel 3) |
| 🎛 | **Channel Settings** | Full per-channel editor: EQ, Dynamics, Gate, Gain, Inserts, Bus/Main Sends |
| 🔄 | **Bidirectional Sync** | Wing→browser push via `/*S` subscription; bulk query on connect |
| 💡 | **Gate / Dyn LEDs** | Per-strip G and D indicators lit from hardware meter gate_key / dyn_key |
| 🌙 | **Dark & Light Mode** | Toggle with Material Design SVG icons; preference persisted |
| ⚙ | **Setup Wizard** | In-app OSC test, audio detection, live IP change — no restart required |
| 🎙 | **Multitrack Recording** | Up to 32 channels @ 44.1 / 48 / 96 kHz WAV via USB audio |
| 🐳 | **Docker** | Single `docker compose up --build` deployment |
| 🔌 | **Auto-Connect** | Status indicators update within 500 ms of page load |

---

## Quick Start

```bash
# 1. Copy and edit config
cp .env.example .env
nano .env          # set WING_IP to your mixer's IP address

# 2. Build and run
docker compose up --build -d

# 3. Open in browser
open http://localhost:8000
```

The **Setup Wizard** launches automatically on first load. It walks through
network config, tests the OSC connection to your Wing, and configures audio
passthrough — all without leaving the browser.

---

## Wing Network Setup

On the Wing console itself:

1. **SETUP → Network** — note or assign a static IP address
2. **Remote Control → OSC** — enable it
3. Wing OSC port is **fixed at 2223** — do not change it on the console side

In `.env`:
```ini
WING_IP=192.168.1.x   # your Wing's IP
WING_OSC_PORT=2223     # always 2223
LOCAL_OSC_PORT=2224    # port this server listens on for Wing push events
METER_UDP_PORT=2225    # port Wing sends hardware meter data to
```

IP changes made through the Setup Wizard take effect **immediately** — no
container restart required.

---

## Channel Settings

Click any channel name strip to open the full channel settings panel. The
mixer strips slide away and a Wing-style editor takes over the center area.
All changes are sent to the Wing via OSC as you make them — there is no
Save button.

### Left nav rail

Nine sections with mini-thumbnail canvas previews:

| Section | What it shows |
|---|---|
| **Home** | Tabs: Overview · Icon/Color · Name · Tags |
| **Gain** | Channel Input (gain, +48V, Pad, Invert) · Trim & Balance · Filter |
| **Gate** | ON/OFF · Transfer curve · Threshold / Range / Attack / Release |
| **EQ** | ON/OFF · Frequency graph · Band tabs with per-band Gain / Freq / Q |
| **Dynamics** | ON/OFF · Transfer curve · Envelope (Attack / Hold / Release) |
| **Insert 1 / 2** | FX processor ON/OFF and type display |
| **Main Sends** | Four vertical faders · Pan bar visualiser |
| **Bus Sends** | 16 vertical strips with TAP / ON / PAN LNK per bus |

### EQ — per-band detail

Band tabs across the top (Low Shelf, PEQ 1–4, High Shelf), colour-coded
green for boost and red for cut. Each band shows:

- **Low Shelf**: Lo-Cut enable/disable · Gain L · Frequency L
- **PEQ 1–4**: Gain · Frequency (log scale 20 Hz–20 kHz) · Q
- **High Shelf**: Hi-Cut enable/disable · Gain H · Frequency H

The EQ graph redraws on every slider movement.

### Dynamics — dual graph

**Left**: compressor transfer curve (threshold, ratio, knee).
**Right**: envelope graph — attack sets the left rising slope, hold sets
the flat top width, release sets the right falling slope. Control-point
circles sit at each vertex.

### Bus Sends — vertical strips

16 vertical strips (scroll horizontally), each showing:
- **TAP** — PRE (amber) or POST (blue)
- Fixed-width dB level display
- Vertical fader
- ON/OFF
- **PAN LNK** — link send pan to channel pan

---

## Wing OSC Protocol (V3.1.0)

| | X32 (wrong) | Wing (correct) |
|---|---|---|
| OSC port | 2222 | **2223** (fixed) |
| Channel fader | /ch/01/mix/fader | /ch/1/fdr |
| Channel mute | /ch/01/mix/on | /ch/1/mute |
| Mute value | 1=muted | **0=unmuted, 1=muted** |
| Master fader | /lr/mix/fader | /main/1/fdr |
| Solo | /ch/1/solo | /ch/1/$solo |
| Subscription | /xinfo | `/*S` every 8 s |

### Fader value encoding

Wing encodes fader values differently depending on context:

- **GET reply** (`,sff`): `args = (label_str, raw_0_to_1, dB_value)` — use `args[1]`
- **`/*S` push** (`,f`): `args = (dB_value,)` — convert with piecewise formula:

```
dB < -3   → raw = 0.675 × (1 + (dB + 3) / 57)
-3…+4 dB  → raw = 0.75 + dB × 0.025
+4…+10 dB → raw = 0.85 + (dB − 4) × (0.9233 − 0.85) / 6
```

Verified data points from V3.1.0 docs:
`0.675@-3dB · 0.750@0dB · 0.850@+4dB · 0.923@+10dB`

### OSC Command Reference

**Channels (1–40) / Aux (1–8)**

| Path | Type | Range | Description |
|---|---|---|---|
| /ch/{n}/fdr | F | -144..10 dB | Fader (raw 0–1 on wire) |
| /ch/{n}/mute | I | 0..1 | Mute (0=on, 1=muted) |
| /ch/{n}/pan | F | -100..100 | Pan |
| /ch/{n}/$solo | I | 0..1 | Solo |
| /ch/{n}/name | S | 16 chars | Name |
| /ch/{n}/eq/on | I | 0..1 | EQ enable |
| /ch/{n}/eq/{1-4}g | F | -15..15 dB | EQ band gain |
| /ch/{n}/eq/{1-4}f | F | 20–20000 Hz | EQ band frequency |
| /ch/{n}/dyn/on | I | 0..1 | Compressor enable |
| /ch/{n}/dyn/thr | F | -60..0 dB | Compressor threshold |
| /ch/{n}/dyn/ratio | S | 1.1..100 | Compressor ratio |
| /ch/{n}/dyn/att | F | 0..200 ms | Attack |
| /ch/{n}/dyn/hld | F | 0..2000 ms | Hold |
| /ch/{n}/dyn/rel | F | 4..3000 ms | Release |
| /ch/{n}/gate/on | I | 0..1 | Gate enable |
| /ch/{n}/gate/thr | F | -80..0 dB | Gate threshold |
| /ch/{n}/gate/range | F | 3..60 dB | Gate range |
| /ch/{n}/send/{1-16}/lvl | F | -144..10 dB | Bus send level |
| /ch/{n}/send/{1-16}/on | I | 0..1 | Bus send on/off |

**Buses (1–16) / Mains (1–4) / Matrix (1–8)**

| Path | Type | Description |
|---|---|---|
| /bus/{n}/fdr | F | Fader |
| /bus/{n}/mute | I | Mute |
| /bus/{n}/pan | F | Pan |
| /main/{n}/fdr | F | Main fader (main 1 = L/R stereo) |
| /mtx/{n}/fdr | F | Matrix fader |

**DCAs (1–16) / Mute Groups (1–8)**

| Path | Type | Description |
|---|---|---|
| /dca/{n}/fdr | F | DCA fader |
| /dca/{n}/mute | I | DCA mute |
| /mgrp/{n}/mute | I | Mute group |

---

## Hardware VU Meters

Meter data uses the Wing **native binary TCP protocol** (port 2222, Channel 3):

1. Opens TCP connection to Wing port 2222
2. Sends meter subscription packet for all strip types
3. Listens on UDP port 2225 for Wing meter pushes (~50 ms cadence)
4. Parses 8 × int16 words per strip (in/out L/R, gate key/gain, dyn key/gain)
5. Converts to 0.0–1.0 and broadcasts to browsers via WebSocket
6. Renews subscription every 4 seconds

Each strip shows left/right VU bars (post-fader output), **G** indicator
(gate active), and **D** indicator (dynamics active).

---

## Audio Recording

Wing USB audio registers as an ALSA device. The container uses `privileged: true`
and an `entrypoint.sh` that detects `/dev/snd` at startup automatically.

```bash
# Connect Wing USB cable, then:
docker compose restart wing-remote
```

Recordings are saved as timestamped WAV files in the Docker-managed
`recordings` volume. Configuration in `.env`:

```ini
SAMPLE_RATE=48000      # 44100, 48000, or 96000
BIT_DEPTH=32           # 16, 24, or 32 (float)
RECORD_CHANNELS=32     # 1–32
```

---

## REST API

| Method | Endpoint | Description |
|---|---|---|
| GET | /api/status | Server + Wing connection status |
| GET | /api/mixer | Full mixer state snapshot |
| POST | /api/osc | Send a raw OSC message to the Wing |
| GET | /api/recordings | List recorded WAV files |
| GET | /api/recordings/{file} | Download a recording |
| DELETE | /api/recordings/{file} | Delete a recording |
| GET | /api/audio-devices | List available audio devices |
| GET | /api/setup/detect | Environment detection |
| POST | /api/setup/test-osc | Test Wing OSC connectivity |
| POST | /api/setup/apply | Apply configuration (live) |
| POST | /api/setup/restart | Restart container via Docker socket |

---

## WebSocket Protocol

Connect to `ws://localhost:8000/ws`

### Browser → Server

```json
{ "type": "fader",        "strip": "ch",  "ch": 1, "value": 0.75 }
{ "type": "mute_toggle",  "strip": "ch",  "ch": 1 }
{ "type": "pan",          "strip": "bus", "ch": 3, "value": -0.5  }
{ "type": "osc",          "path": "/ch/1/eq/on", "value": 1 }
{ "type": "record_start", "channels": [1,2,3,4] }
{ "type": "record_stop" }
```

Strip types: `ch` `aux` `bus` `main` `mtx` `dca` `mgrp`

### Server → Browser

```json
{ "type": "snapshot",     "mixer": { "channels": {}, "buses": {}, ... } }
{ "type": "wing_status",  "connected": true, "wing_ip": "192.168.1.x" }
{ "type": "fader",        "strip": "ch", "ch": "1", "value": 0.75 }
{ "type": "mute",         "strip": "ch", "ch": "1", "value": true  }
{ "type": "name",         "strip": "ch", "ch": "1", "value": "KICK" }
{ "type": "eq_band",      "strip": "ch", "ch": "1", "band": 2, "attr": "g", "value": 3.0 }
{ "type": "meters",       "levels": { "ch-1": 0.72, "ch-1-gate": 1 } }
{ "type": "record_status","status": "recording", "file": "session_....wav" }
```

---

## Project Structure

```
wing-remote/
├── backend/
│   ├── main.py              FastAPI, OSC bridge, binary meter engine, recording
│   ├── setup.py             Setup wizard: env detection, OSC probe, config apply
│   └── requirements.txt
├── frontend/
│   └── static/
│       ├── index.html       HTML structure (728 lines)
│       ├── css/
│       │   ├── main.css     Mixer UI, strips, meters, panels, channel settings
│       │   └── wizard.css   Setup wizard overlay
│       └── js/
│           ├── state.js     Shared state, LAYERS config, constants
│           ├── strips.js    Mixer model init, layer nav, strip rendering
│           ├── meters.js    Meter animation, EQ canvas helpers
│           ├── faders.js    Fader/knob drag, touch, mute/solo/rec
│           ├── detail.js    Channel selection, detail panel
│           ├── recording.js Recording transport, waveform, param updaters
│           ├── views.js     View switching, all view builders, theme toggle
│           ├── osc.js       WebSocket, OSC, Wing status, message handler, init
│           ├── wizard.js    Setup wizard
│           └── ch-settings.js  Channel settings panel (all 9 sections)
├── entrypoint.sh            Runtime audio device detection
├── Dockerfile               Multi-stage build (static Docker CLI binary)
├── docker-compose.yml
├── .env.example
├── .npmrc                   Suppresses spurious npm warnings during build
├── CHANGELOG.md
└── README.md
```

---

## Troubleshooting

**"Wing did not respond to OSC"**
→ SETUP → Network on Wing → enable OSC Remote Control
→ Wing OSC port is always 2223 — confirm in `.env`
→ Firewall: `sudo ufw allow 2223/udp && sudo ufw allow 2224/udp`

**Faders don't sync from physical Wing**
→ Both send and receive use the same UDP socket on `LOCAL_OSC_PORT` (2224)
→ Confirm `LOCAL_OSC_PORT=2224` in `.env` and that port 2224/udp is open
→ Only one `/*S` subscription active — Wing Remote app may compete with
  a connected Wing Remote iOS/Android app or Wing Edit

**VU meters not showing**
→ Meter data uses TCP port 2222: `sudo ufw allow 2222/tcp`
→ Check logs: `docker compose logs wing-remote | grep -i meter`

**No audio recording**
→ Connect Wing USB, then `docker compose restart wing-remote`
→ Check logs for `[entrypoint] /dev/snd detected`
→ WSL1 and macOS Docker Desktop do not expose USB audio devices

**Port 8000 in use**
→ Edit `docker-compose.yml` — under `ports:` change `8000:8000` to `8080:8000`
  (or any free port)

---

## License

MIT
