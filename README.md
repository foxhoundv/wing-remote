# WING Remote

A self-hosted web application for remotely controlling a **Behringer Wing** digital mixer
and recording multitrack audio — all from your browser, running in Docker.

---

## Features

| Feature | Detail |
|---|---|
| **Remote Control** | Faders, mutes, pans, solo, EQ, dynamics, bus sends — all via OSC |
| **Multitrack Recording** | Up to 32 channels @ 48 kHz / 32-bit float WAV |
| **Real-time Sync** | Wing→browser push via OSC subscription (/*S keepalive) |
| **Wing-style UI** | Dark industrial interface matching the Wing Edit app |
| **Setup Wizard** | In-app detection, OSC test, audio config, auto-restart |
| **REST API** | Programmatic control via HTTP |
| **Docker** | Single `docker compose up` deployment |

---

## Quick Start

```bash
cp .env.example .env
# Edit WING_IP to match your mixer
nano .env

docker compose up --build
# Open http://localhost:8000
```

The Setup Wizard launches automatically on first load and walks through everything.

---

## Wing OSC Protocol (V3.1.0)

This app implements the **official Wing OSC protocol** documented by Patrick-Gilles Maillot.
Key facts that differ from the X32/M32:

### Port
Wing OSC server always listens on **UDP port 2223**. This is fixed and cannot be changed.
Replies go back to the client's sending port by default.

### Probe / Info Query
```
Send:    /?  (4 bytes)
Reply:   /? ,s "WING,192.168.1.x,PGM,ngc-full,NO_SERIAL,3.1.0"
```

### Get a Parameter (no arguments = query)
```
Send:    /ch/1/fdr            (no args)
Reply:   /ch/1/fdr ,sff  "label"  0.7500  3.0000
         ─── type tag ─── ascii   raw 0-1  dB value
```

### Set a Parameter
```
Float:   /ch/1/fdr  ,f  0.75       (raw 0.0..1.0)
String:  /ch/1/fdr  ,s  "3"        (dB value as string — Wing converts)
Integer: /ch/1/mute ,i  1          (0 = unmuted, 1 = muted)
Toggle:  /ch/1/mute ,i  -1         (flips 0↔1 without reading first)
```

### Subscription (bidirectional sync)
Wing requires a subscription renewal every **<10 seconds** to push changes back.
```
Send:   /*S     every 8 seconds
Wing pushes: /ch/1/fdr ,f 0.75   (single-value format, easiest to re-send)
             /ch/1/mute ,i 1
```
Only **one subscription** is active on the Wing at any time.

### OSC Command Reference

| Path | Type | Range | Description |
|---|---|---|---|
| `/?` | — | — | Console info query |
| `/ch/{1-40}/fdr` | F | -144..10 dB | Channel fader (raw 0.0–1.0) |
| `/ch/{1-40}/mute` | I | 0..1 | Channel mute (0=on, 1=muted) |
| `/ch/{1-40}/pan` | F | -100..100 | Channel pan |
| `/ch/{1-40}/$solo` | I | 0..1 | Channel solo |
| `/ch/{1-40}/name` | S | 16 chars | Channel name |
| `/ch/{1-40}/send/{1-16}/lvl` | F | -144..10 dB | Channel→bus send level |
| `/ch/{1-40}/send/{1-16}/on` | I | 0..1 | Channel→bus send on/off |
| `/ch/{1-40}/eq/on` | I | 0..1 | EQ enable |
| `/ch/{1-40}/eq/{1-4}g` | F | -15..15 dB | EQ band gain |
| `/ch/{1-40}/eq/{1-4}f` | F | 20..20000 Hz | EQ band frequency |
| `/ch/{1-40}/dyn/on` | I | 0..1 | Compressor enable |
| `/ch/{1-40}/dyn/thr` | F | -60..0 dB | Compressor threshold |
| `/ch/{1-40}/dyn/ratio` | S | 1.1..100 | Compressor ratio |
| `/ch/{1-40}/dyn/att` | F | 0..120 ms | Compressor attack |
| `/ch/{1-40}/dyn/rel` | F | 4..4000 ms | Compressor release |
| `/ch/{1-40}/gate/on` | I | 0..1 | Gate enable |
| `/ch/{1-40}/gate/thr` | F | -80..0 dB | Gate threshold |
| `/aux/{1-8}/fdr` | F | -144..10 dB | Aux input fader |
| `/aux/{1-8}/mute` | I | 0..1 | Aux input mute |
| `/bus/{1-16}/fdr` | F | -144..10 dB | Mix bus fader |
| `/bus/{1-16}/mute` | I | 0..1 | Mix bus mute |
| `/main/{1-4}/fdr` | F | -144..10 dB | Main fader (main 1 = L/R) |
| `/main/{1-4}/mute` | I | 0..1 | Main mute |
| `/mtx/{1-8}/fdr` | F | -144..10 dB | Matrix fader |
| `/dca/{1-16}/fdr` | F | -144..10 dB | DCA fader |
| `/dca/{1-16}/mute` | I | 0..1 | DCA mute |
| `/mgrp/{1-8}/mute` | I | 0..1 | Mute group |
| `/*S` | — | — | Subscribe to push events |
| `/$stat/solo` | I | 0..1 | Global solo active [RO] |

---

## Wing Network Setup

On the Wing console:

1. Press **SETUP → Network**
2. Note the Wing's IP address (set a static IP here if needed)
3. Under **Remote Control**, ensure **OSC** is enabled
4. Wing OSC port **2223 is fixed** — you cannot change it on the Wing side

In your `.env`:
- `WING_IP` = the Wing's IP
- `WING_OSC_PORT` = `2223` (always)
- `LOCAL_OSC_PORT` = `2224` (the port this server listens on for Wing events)

---

## Audio Device Passthrough

Wing USB audio appears as an ALSA device on the host. To enable recording:

```bash
# Verify the Wing USB audio is visible on the host
ls /dev/snd

# Then uncomment in docker-compose.yml:
#   devices:
#     - /dev/snd:/dev/snd
#   group_add:
#     - audio

docker compose up -d --build
```

The **Setup Wizard** handles this automatically — it detects `/dev/snd`, patches
`docker-compose.yml`, and restarts the container for you.

---

## REST API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/status` | Server + connection status |
| `GET` | `/api/mixer` | Full mixer state snapshot |
| `POST` | `/api/osc` | Send a raw OSC message to the Wing |
| `GET` | `/api/recordings` | List recorded WAV files |
| `GET` | `/api/recordings/{file}` | Download a recording |
| `DELETE` | `/api/recordings/{file}` | Delete a recording |
| `GET` | `/api/audio-devices` | List available audio devices |
| `GET` | `/api/setup/detect` | Run environment detection |
| `POST` | `/api/setup/test-osc` | Test Wing OSC connectivity |
| `POST` | `/api/setup/apply` | Apply full configuration |
| `POST` | `/api/setup/restart` | Restart container via Docker socket |

---

## WebSocket Protocol (`ws://localhost:8000/ws`)

### Browser → Server

```json
// Move a channel fader (raw 0.0–1.0)
{ "type": "fader", "strip": "ch", "ch": 1, "value": 0.75 }

// Mute a channel
{ "type": "mute", "strip": "ch", "ch": 1, "value": true }

// Toggle mute (efficient — Wing handles 0↔1 internally)
{ "type": "mute_toggle", "strip": "ch", "ch": 1 }

// Pan a channel (-1.0 to +1.0, server converts to Wing's -100..100)
{ "type": "pan", "strip": "ch", "ch": 1, "value": -0.5 }

// Main L/R fader  (strip="main", ch=1 for L/R stereo bus)
{ "type": "fader", "strip": "main", "ch": 1, "value": 0.75 }

// Raw OSC passthrough (Wing-style path)
{ "type": "osc", "path": "/ch/1/eq/on", "value": 1 }

// Strip types: "ch" | "aux" | "bus" | "main" | "mtx" | "dca" | "mgrp"
```

### Server → Browser

```json
// Full snapshot on connect
{ "type": "snapshot", "mixer": { "channels": {...}, "buses": {...}, ... } }

// Fader update pushed from Wing physical control
{ "type": "fader", "strip": "ch", "ch": "1", "value": 0.75 }

// Mute pushed from Wing
{ "type": "mute", "strip": "ch", "ch": "1", "value": true }

// Recording status
{ "type": "record_status", "status": "recording", "file": "session_20241201_143022.wav" }
{ "type": "record_status", "status": "stopped",   "file": "...", "duration": 182.4 }
```

---

## Project Structure

```
wing-remote/
├── backend/
│   ├── main.py          # FastAPI app, OSC bridge, recording engine
│   ├── setup.py         # Setup wizard backend: detect, test, patch
│   └── requirements.txt
├── frontend/
│   └── static/
│       └── index.html   # Wing-style web UI + Setup Wizard
├── recordings/          # WAV files (Docker volume)
├── snapshots/           # Scene snapshots (Docker volume)
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Troubleshooting

**OSC test says "Wing did not respond"**
→ SETUP → Network on Wing → enable OSC Remote Control
→ Wing OSC port is fixed at **2223** — confirm this in your `.env`
→ Check firewall: `sudo ufw allow 2223/udp`

**Faders don't sync from Wing to browser**
→ The subscription keepalive (`/*S`) sends every 8 seconds
→ Check `docker compose logs wing-remote` for "Subscription keepalive /*S sent"
→ Only one subscription active at a time — if Wing Edit app is open it may compete

**No audio recording**
→ Connect Wing USB cable, run `ls /dev/snd` on host
→ Uncomment the devices block in docker-compose.yml (or use Setup Wizard)
→ Rebuild: `docker compose up -d --build`

**Port conflict**
→ If something else uses port 8000, edit the `ports:` section in docker-compose.yml

---

## License

MIT
