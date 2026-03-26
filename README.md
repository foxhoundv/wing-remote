# WING Remote v2.0

A self-hosted web application for remotely controlling a **Behringer Wing** digital mixer
and recording multitrack audio — all from your browser, running in Docker.

> Implements the official **Wing Remote Protocols V3.1.0** by Patrick-Gilles Maillot
> (authorized by Behringer/Music Tribe).

---

## Features

| | Feature | Detail |
|---|---|---|
| 🎚 | **Full Mixer Control** | All 40 channels, 8 aux, 16 buses, 4 mains, 8 matrix, 16 DCA |
| 📊 | **Real Hardware VU Meters** | Live levels via Wing binary TCP protocol (port 2222, Channel 3) |
| 🎛 | **Live Detail Panel** | EQ curves, compressor, gate, bus sends — all reflecting actual hardware state |
| 🔄 | **Bidirectional Sync** | Wing→browser push via /*S OSC subscription; bulk query on connect |
| 💡 | **Gate / Dyn LEDs** | Per-strip G and D indicators lit from hardware meter gate_key / dyn_key |
| 🌙 | **Dark & Light Mode** | Toggle with Material Design SVG icons; preference persisted across sessions |
| ⚙ | **Setup Wizard** | In-app OSC test, audio detection, live IP change — no restart required |
| 🎙 | **Multitrack Recording** | Up to 32 channels @ 48 kHz / 32-bit float WAV via USB audio |
| 🐳 | **Docker** | Single docker compose up --build deployment |
| 🔌 | **Auto-Connect** | Status indicators update within 500 ms of page load — no button press needed |

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

IP changes made through the Setup Wizard take effect **immediately** — the
backend updates the live OSC client and restarts the probe loop without a
container restart.

---

## Wing OSC Protocol (V3.1.0)

This app implements the official Wing OSC protocol. Key differences from X32/M32:

| | X32 (wrong) | Wing (correct) |
|---|---|---|
| OSC port | 2222 | **2223** (fixed) |
| Channel fader | /ch/01/mix/fader | /ch/1/fdr |
| Channel mute | /ch/01/mix/on | /ch/1/mute |
| Mute value | 1=muted | **0=unmuted, 1=muted** |
| Master fader | /lr/mix/fader | /main/1/fdr |
| Solo | /ch/1/solo | /ch/1/$solo |
| Subscription | /xinfo | /*S every 8 s |

### Probe
```
Send:  /?
Reply: /? ,s "WING,192.168.1.x,PGM,ngc-full,NO_SERIAL,3.1.0"
```

### Get / Set
```
Get:     /ch/1/fdr            (no args)
Reply:   /ch/1/fdr ,sff  "label"  0.75  3.0   (ascii, raw 0-1, dB)

Set float:  /ch/1/fdr  ,f  0.75
Set int:    /ch/1/mute ,i  1
Toggle:     /ch/1/mute ,i  -1    (Wing flips 0-1 internally)
```

### Subscription
```
Send:  /*S   (every 8 seconds — Wing times out after 10 s)
Wing pushes single-value events:
  /ch/1/fdr  ,f  0.75
  /ch/1/mute ,i  1
Only ONE subscription active on the Wing at a time.
```

### OSC Command Reference

**Channels (1–40) / Aux (1–8)**

| Path | Type | Range | Description |
|---|---|---|---|
| /ch/{n}/fdr | F | -144..10 dB | Fader level (raw 0–1) |
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
| /ch/{n}/dyn/att | F | 0..120 ms | Compressor attack |
| /ch/{n}/dyn/rel | F | 4..4000 ms | Compressor release |
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

**Special**

| Path | Description |
|---|---|
| /? | Console info query |
| /*S | Subscribe to push events |
| /$stat/solo | Global solo active [RO] |

---

## Hardware VU Meters

Meter data uses the Wing **native binary TCP protocol** (port 2222, Channel 3),
not OSC. The app:

1. Opens a TCP connection to Wing port 2222
2. Sends a meter subscription packet requesting all strip types
3. Listens on UDP port 2225 for Wing to push meter packets (~50 ms cadence)
4. Parses 8 signed int16 words per strip (in/out L/R, gate key/gain, dyn key/gain)
5. Converts to 0.0–1.0 display range and broadcasts to browsers
6. Renews the subscription every 4 seconds

Each strip shows:
- **Left/right VU bars** from output_L / output_R (post-fader)
- **G indicator** lit green when gate_key > 0
- **D indicator** lit blue when dyn_key > 0

When the Wing is unreachable the UI shows an animated placeholder.

---

## Audio Recording

Wing USB audio registers as an ALSA device. The container uses `privileged: true`
and an `entrypoint.sh` that detects `/dev/snd` at startup automatically — no
manual docker-compose.yml edits required.

```bash
# Connect Wing USB cable, then:
docker compose restart wing-remote
# entrypoint.sh will detect /dev/snd and configure audio group access
```

Recordings are saved as timestamped WAV files in the Docker-managed
`recordings` volume:

```
/var/lib/docker/volumes/wing-remote_recordings/_data/
session_20260326_143022.wav   # 32ch, 48kHz, 32-bit float
```

Configuration in `.env`:
```ini
SAMPLE_RATE=48000      # 48000 or 96000
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
| POST | /api/setup/apply | Apply configuration (live, no restart needed) |
| POST | /api/setup/restart | Restart container via Docker socket |

---

## WebSocket Protocol

Connect to `ws://localhost:8000/ws`

### Browser to Server

```json
{ "type": "fader",       "strip": "ch",  "ch": 1, "value": 0.75 }
{ "type": "mute",        "strip": "ch",  "ch": 1, "value": true  }
{ "type": "mute_toggle", "strip": "ch",  "ch": 1 }
{ "type": "pan",         "strip": "bus", "ch": 3, "value": -0.5  }
{ "type": "osc",         "path": "/ch/1/eq/on",   "value": 1 }
{ "type": "record_start","channels": [1,2,3,4] }
{ "type": "record_stop" }
```

Strip types: "ch" "aux" "bus" "main" "mtx" "dca" "mgrp"

### Server to Browser

```json
{ "type": "snapshot",    "mixer": { "channels": {}, "buses": {}, ... } }
{ "type": "wing_status", "connected": true, "wing_ip": "192.168.1.x" }
{ "type": "fader",       "strip": "ch", "ch": "1", "value": 0.75 }
{ "type": "mute",        "strip": "ch", "ch": "1", "value": true  }
{ "type": "name",        "strip": "ch", "ch": "1", "value": "KICK" }
{ "type": "eq_band",     "strip": "ch", "ch": "1", "band": 2, "attr": "g", "value": 3.0 }
{ "type": "dyn",         "strip": "ch", "ch": "1", "dyn": { "on": true, "thr": -18 } }
{ "type": "gate",        "strip": "ch", "ch": "1", "gate": { "on": true, "thr": -40 } }
{ "type": "send",        "strip": "ch", "ch": "1", "bus": "3", "send": { "on": true, "lvl": 0.6 } }
{ "type": "meters",      "levels": { "ch-1": 0.72, "ch-1-gate": 1, "bus-1": 0.45 } }
{ "type": "record_status","status": "recording", "file": "session_20260326_143022.wav" }
```

---

## Project Structure

```
wing-remote/
├── backend/
│   ├── main.py          # FastAPI, OSC bridge, binary meter engine, recording
│   ├── setup.py         # Setup wizard: env detection, OSC probe, config apply
│   └── requirements.txt
├── frontend/
│   └── static/
│       └── index.html   # Single-page app: UI, Setup Wizard, light/dark theme
├── entrypoint.sh        # Runtime audio device detection
├── Dockerfile           # Multi-stage build
├── docker-compose.yml
├── .env.example
├── CHANGELOG.md
└── README.md
```

---

## Troubleshooting

**"Wing did not respond to OSC"**
→ SETUP → Network on Wing → enable OSC Remote Control
→ Wing OSC port is always 2223 — confirm in .env
→ Firewall: `sudo ufw allow 2223/udp && sudo ufw allow 2224/udp`

**Status shows "Wing Unreachable" after page refresh**
→ v2.0 polls /api/status immediately on load — should resolve within 500 ms
→ If persisting: `docker compose logs wing-remote` for probe errors

**Faders don't sync from physical Wing**
→ Check logs for "Subscription keepalive /*S sent" every 8 seconds
→ Only one OSC subscription active — Wing Edit app may compete for it

**VU meters not showing**
→ Meter data uses TCP port 2222: `sudo ufw allow 2222/tcp`
→ Check logs for "Meter subscription sent" and "Meter TCP connected"

**No audio recording**
→ Connect Wing USB, then `docker compose restart wing-remote`
→ Check logs for "[entrypoint] /dev/snd detected"
→ WSL1 and macOS Docker Desktop do not expose USB audio

**Port 8000 in use**
→ Change the port mapping in docker-compose.yml under ports:

---

## License

MIT
