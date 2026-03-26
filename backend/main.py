"""
WING Remote - FastAPI Backend
Bridges WebSocket (browser) <-> OSC/UDP (Behringer Wing mixer)
and handles multitrack audio recording via sounddevice.

═══════════════════════════════════════════════════════════════
WING OSC PROTOCOL — V3.1.0  (Patrick-Gilles Maillot / Behringer)
═══════════════════════════════════════════════════════════════

PORT:       Wing OSC server listens on UDP port 2223 only.
            Replies go back to the client's sending port.

PROBE:      Send /? (4 bytes) → Wing replies with console info string
            e.g. "WING,192.168.1.71,PGM,ngc-full,NO_SERIAL,1.07.2..."

GET param:  Send OSC address with NO arguments → Wing returns current value
            /ch/1/fdr  →  W replies ,sff  (ascii_label, raw_0_to_1, dB_value)
            /ch/1/mute →  W replies ,sfi  (ascii_label, raw_0_to_1, int_value)

SET float:  /ch/1/fdr  ,f  [0.75]       raw float 0.0-1.0
       or:  /ch/1/fdr  ,s  "-3"         dB string
SET int:    /ch/1/mute ,i  [0 or 1]     0=unmuted 1=muted
TOGGLE:     /ch/1/mute ,i  [-1]         toggles 0↔1 without reading first

SUBSCRIPTION (required for Wing → client push):
    /*s  or  /*S  → Wing pushes OSC change events to the client
    Must be renewed every <10 seconds or Wing silently stops sending.
    Only ONE subscription active at a time on the whole console.
    /*s  sends triplets ,sff / ,sfi
    /*S  sends single-value ,f / ,i (easiest to re-send to Wing unchanged)
    Port redirect: /%23456/*S  → Wing sends events to port 23456 instead

CHANNEL PATHS (ch: 1..40):
    /ch/{n}/fdr          F   -144..10 dB  (raw 0.0..1.0 in OSC)
    /ch/{n}/mute         I   0=unmuted, 1=muted
    /ch/{n}/pan          F   -100..100
    /ch/{n}/wid          F   -150..150 (width %)
    /ch/{n}/$solo        I   0..1
    /ch/{n}/name         S   16 chars max
    /ch/{n}/send/{b}/lvl F   channel→bus send level  (b: 1..16)
    /ch/{n}/send/{b}/on  I   channel→bus send on/off
    /ch/{n}/eq/on|{band}g|{band}f|{band}q  EQ params
    /ch/{n}/dyn/on|thr|ratio|att|hld|rel   Compressor params
    /ch/{n}/gate/on|thr|range|att|hld|rel  Gate params

AUX PATHS (aux: 1..8):
    /aux/{n}/fdr  /aux/{n}/mute  /aux/{n}/pan  — same pattern as channels

BUS PATHS (bus: 1..16):
    /bus/{n}/fdr         F   -144..10 dB
    /bus/{n}/mute        I   0..1
    /bus/{n}/pan         F   -100..100

MAIN (L/R and other mains, main: 1..4):
    /main/{n}/fdr        F   -144..10 dB
    /main/{n}/mute       I   0..1
    /main/{n}/pan        F   -100..100
    NOTE: main 1 = L/R stereo bus. NOT /main/st/fdr (that was wrong)

MATRIX (mtx: 1..8):
    /mtx/{n}/fdr  /mtx/{n}/mute  /mtx/{n}/pan

DCA (dca: 1..16):
    /dca/{n}/fdr  /dca/{n}/mute

MUTE GROUPS (mgrp: 1..8):
    /mgrp/{n}/mute       I   0..1

STATUS (read-only):
    /$stat/solo          I   global solo active
    /$stat/time          S   clock time
    /$stat/usbstate      S   USB player state
"""

import asyncio
import json
import logging
import os
import struct
import time
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

import sounddevice as sd
import soundfile as sf
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pythonosc.dispatcher import Dispatcher
from pythonosc.osc_server import AsyncIOOSCUDPServer
from pythonosc.udp_client import SimpleUDPClient

from backend.setup import (
    detect_environment,
    test_osc_connection,
    apply_env_config,
    apply_audio_passthrough,
    trigger_container_restart,
    build_osc_message,
)

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("wing-remote")

# ── Config ────────────────────────────────────────────────────────────────────
WING_IP            = os.getenv("WING_IP", "192.168.1.100")
WING_OSC_PORT      = int(os.getenv("WING_OSC_PORT", "2223"))   # Wing always uses 2223
LOCAL_OSC_PORT     = int(os.getenv("LOCAL_OSC_PORT", "2224"))   # port WE listen on
SAMPLE_RATE        = int(os.getenv("SAMPLE_RATE", "48000"))
BIT_DEPTH          = int(os.getenv("BIT_DEPTH", "32"))
CHANNELS           = int(os.getenv("RECORD_CHANNELS", "32"))
RECORDINGS_DIR     = Path(os.getenv("RECORDINGS_DIR", "/recordings"))
RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)

# Wing subscription keepalive — must be renewed every <10 seconds
SUBSCRIPTION_INTERVAL = 8.0
# Subscribe with /*S (single-value events, easiest to re-send unchanged)
WING_SUBSCRIBE = "/*S"


# ── Shared State ──────────────────────────────────────────────────────────────
class AppState:
    def __init__(self):
        self.wing_client: Optional[SimpleUDPClient] = None
        self.osc_server  = None
        self.subscription_task: Optional[asyncio.Task] = None
        self.wing_connected: bool = False   # True once Wing responds to probe

        # Recording
        self.recording        = False
        self.record_stream    = None
        self.record_file      = None
        self.record_path: Optional[Path] = None
        self.record_start_ts  = 0.0
        self.armed_channels: set = set()

        # Mixer mirror — all indices 1-based matching Wing numbering
        self.mixer: dict = {
            # channels: 1..40
            "channels": {
                str(i): {"fader": 0.75, "mute": False, "solo": False, "pan": 0.0, "name": f"CH {i}"}
                for i in range(1, 41)
            },
            # aux inputs: 1..8
            "aux": {
                str(i): {"fader": 0.75, "mute": False, "pan": 0.0, "name": f"AUX {i}"}
                for i in range(1, 9)
            },
            # mix buses: 1..16
            "buses": {
                str(i): {"fader": 0.75, "mute": False, "pan": 0.0, "name": f"BUS {i}"}
                for i in range(1, 17)
            },
            # mains: 1..4  (main 1 = L/R stereo)
            "main": {
                str(i): {"fader": 0.75, "mute": False, "pan": 0.0, "name": f"MAIN {i}"}
                for i in range(1, 5)
            },
            # matrix: 1..8
            "matrix": {
                str(i): {"fader": 0.75, "mute": False, "pan": 0.0, "name": f"MTX {i}"}
                for i in range(1, 9)
            },
            # DCAs: 1..16
            "dca": {
                str(i): {"fader": 0.75, "mute": False, "name": f"DCA {i}"}
                for i in range(1, 17)
            },
            # Mute groups: 1..8
            "mgrp": {
                str(i): {"mute": False, "name": f"MG {i}"}
                for i in range(1, 9)
            },
        }

        self.ws_clients: list = []

app_state = AppState()


# ── Lifespan ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Starting WING Remote backend…")
    log.info(f"Wing target: {WING_IP}:{WING_OSC_PORT}  |  Local OSC listen: {LOCAL_OSC_PORT}")

    try:
        app_state.wing_client = SimpleUDPClient(WING_IP, WING_OSC_PORT)
        log.info(f"OSC client ready → {WING_IP}:{WING_OSC_PORT}")
    except Exception as e:
        log.warning(f"Could not create OSC client: {e}")

    asyncio.create_task(start_osc_server())
    asyncio.create_task(subscription_keepalive())
    # Query Wing for current state after OSC server is ready
    asyncio.create_task(_delayed_bulk_query())
    # Start meter polling loop (real hardware VU levels via TCP binary protocol)
    asyncio.create_task(meter_poll_loop())
    # Auto-probe Wing connectivity and keep wing_connected status updated
    asyncio.create_task(wing_probe_loop())

    yield

    log.info("Shutting down…")
    if app_state.recording:
        await stop_recording()
    if app_state.osc_server:
        app_state.osc_server.shutdown()


app = FastAPI(title="WING Remote", lifespan=lifespan)


# ── Subscription Keepalive ────────────────────────────────────────────────────

async def subscription_keepalive():
    """
    Send /*S to the Wing every 8 seconds.
    Wing requires subscription renewal every <10s to continue pushing events.
    Only one subscription is active at a time on the entire Wing.
    /*S = single-value events (,f for floats, ,i for ints) — easiest format.
    """
    await asyncio.sleep(2)  # Wait for OSC server to start first
    while True:
        if app_state.wing_client:
            try:
                app_state.wing_client.send_message(WING_SUBSCRIBE, [])
                log.debug("[OSC] Subscription keepalive /*S sent")
            except Exception as e:
                log.warning(f"Subscription keepalive failed: {e}")
        await asyncio.sleep(SUBSCRIPTION_INTERVAL)


async def _delayed_bulk_query():
    """Wait for OSC server to be ready then query the Wing for all current state."""
    await asyncio.sleep(3)
    await bulk_query_wing()


async def wing_probe_loop():
    """
    Continuously probe the Wing with an OSC /? query.
    Updates app_state.wing_connected and broadcasts status changes to all
    browser clients so the top-bar indicators update automatically.
    Runs every 5s when disconnected, every 15s when connected.
    """
    await asyncio.sleep(1)
    last_state = None

    while True:
        connected = False
        if app_state.wing_client:
            try:
                from backend.setup import test_osc_connection
                result = await asyncio.wait_for(
                    test_osc_connection(WING_IP, WING_OSC_PORT, timeout=2.0),
                    timeout=3.0
                )
                connected = result.get("success", False)
            except Exception:
                connected = False

        app_state.wing_connected = connected

        # Broadcast status change to all browsers
        if connected != last_state:
            last_state = connected
            status_msg = {
                "type":      "wing_status",
                "connected": connected,
                "wing_ip":   WING_IP,
                "wing_port": WING_OSC_PORT,
            }
            await broadcast(status_msg)
            if connected:
                log.info(f"Wing connected at {WING_IP}:{WING_OSC_PORT}")
                # Trigger bulk query now that Wing is reachable
                asyncio.create_task(bulk_query_wing())
            else:
                log.warning(f"Wing not reachable at {WING_IP}:{WING_OSC_PORT}")

        await asyncio.sleep(5.0 if not connected else 15.0)


# ── OSC Response Parsers ──────────────────────────────────────────────────────

def parse_wing_float(args) -> float:
    """
    Wing GET response for floats is ,sff: [ascii_label, raw_0_to_1, dB_value]
    Wing PUSH event (/*S subscription) sends ,f: [raw_0_to_1]
    Returns the raw 0.0–1.0 fader position.
    """
    if not args:
        return 0.0
    # ,sff format from GET: args = (label_str, raw_float, dB_float)
    if isinstance(args[0], str) and len(args) >= 2:
        try:
            return max(0.0, min(1.0, float(args[1])))
        except (ValueError, TypeError):
            pass
    # ,f format from /*S subscription: args = (raw_float,)
    try:
        return max(0.0, min(1.0, float(args[0])))
    except (ValueError, TypeError):
        return 0.0


def parse_wing_int(args) -> int:
    """
    Wing GET response for ints is ,sfi: [ascii_label, raw_0_to_1, int_value]
    Wing PUSH event (/*S subscription) sends ,i: [int_value]
    Returns the integer value.
    """
    if not args:
        return 0
    # ,sfi format from GET: args = (label_str, raw_float, int_value)
    if isinstance(args[0], str) and len(args) >= 3:
        try:
            return int(args[2])
        except (ValueError, TypeError, IndexError):
            pass
    # ,i format from /*S subscription: args = (int_value,)
    try:
        return int(args[0])
    except (ValueError, TypeError):
        return 0


def parse_wing_pan(args) -> float:
    """
    Wing pan is -100..100 as a float.
    Returns value normalised to -1.0..1.0 for the UI.
    """
    if not args:
        return 0.0
    raw = 0.0
    if isinstance(args[0], str) and len(args) >= 2:
        try:
            raw = float(args[1])
        except Exception:
            pass
    else:
        try:
            raw = float(args[0])
        except Exception:
            pass
    return max(-1.0, min(1.0, raw / 100.0))


# ── OSC Server (receive FROM Wing) ────────────────────────────────────────────

def build_dispatcher() -> Dispatcher:
    d = Dispatcher()

    # Channels 1..40
    d.map("/ch/*/fdr",   handle_ch_fader)
    d.map("/ch/*/mute",  handle_ch_mute)
    d.map("/ch/*/pan",   handle_ch_pan)
    d.map("/ch/*/name",  handle_ch_name)
    d.map("/ch/*/$solo", handle_ch_solo)

    # Aux inputs 1..8
    d.map("/aux/*/fdr",  handle_aux_fader)
    d.map("/aux/*/mute", handle_aux_mute)
    d.map("/aux/*/pan",  handle_aux_pan)

    # Mix buses 1..16
    d.map("/bus/*/fdr",  handle_bus_fader)
    d.map("/bus/*/mute", handle_bus_mute)
    d.map("/bus/*/pan",  handle_bus_pan)

    # Mains 1..4
    d.map("/main/*/fdr",  handle_main_fader)
    d.map("/main/*/mute", handle_main_mute)
    d.map("/main/*/pan",  handle_main_pan)

    # Channel names for aux/bus/main/dca
    d.map("/aux/*/name",  handle_aux_name)
    d.map("/bus/*/name",  handle_bus_name)
    d.map("/main/*/name", handle_main_name)
    d.map("/dca/*/name",  handle_dca_name)

    # Matrix 1..8
    d.map("/mtx/*/fdr",  handle_mtx_fader)
    d.map("/mtx/*/mute", handle_mtx_mute)

    # DCA 1..16
    d.map("/dca/*/fdr",  handle_dca_fader)
    d.map("/dca/*/mute", handle_dca_mute)

    # Mute groups 1..8
    d.map("/mgrp/*/mute", handle_mgrp_mute)

    d.set_default_handler(osc_default_handler)
    return d


def _ch_num(address: str, seg: int = 2) -> Optional[str]:
    """Extract channel number from OSC address path segment."""
    try:
        return str(int(address.split("/")[seg]))
    except (IndexError, ValueError):
        return None


# Channel handlers
def handle_ch_fader(address, *args):
    ch = _ch_num(address)
    if not ch: return
    val = parse_wing_float(args)
    app_state.mixer["channels"].setdefault(ch, {})["fader"] = val
    asyncio.create_task(broadcast({"type": "fader", "strip": "ch", "ch": ch, "value": val}))

def handle_ch_mute(address, *args):
    ch = _ch_num(address)
    if not ch: return
    muted = bool(parse_wing_int(args))
    app_state.mixer["channels"].setdefault(ch, {})["mute"] = muted
    asyncio.create_task(broadcast({"type": "mute", "strip": "ch", "ch": ch, "value": muted}))

def handle_ch_pan(address, *args):
    ch = _ch_num(address)
    if not ch: return
    val = parse_wing_pan(args)
    app_state.mixer["channels"].setdefault(ch, {})["pan"] = val
    asyncio.create_task(broadcast({"type": "pan", "strip": "ch", "ch": ch, "value": val}))

def handle_ch_name(address, *args):
    ch = _ch_num(address)
    if not ch or not args: return
    name = str(args[0]) if not isinstance(args[0], str) else args[0]
    app_state.mixer["channels"].setdefault(ch, {})["name"] = name
    asyncio.create_task(broadcast({"type": "name", "strip": "ch", "ch": ch, "value": name}))

def handle_ch_solo(address, *args):
    ch = _ch_num(address)
    if not ch: return
    val = bool(parse_wing_int(args))
    app_state.mixer["channels"].setdefault(ch, {})["solo"] = val
    asyncio.create_task(broadcast({"type": "solo", "strip": "ch", "ch": ch, "value": val}))

# Aux handlers
def handle_aux_fader(address, *args):
    n = _ch_num(address)
    if not n: return
    val = parse_wing_float(args)
    app_state.mixer["aux"].setdefault(n, {})["fader"] = val
    asyncio.create_task(broadcast({"type": "fader", "strip": "aux", "ch": n, "value": val}))

def handle_aux_mute(address, *args):
    n = _ch_num(address)
    if not n: return
    muted = bool(parse_wing_int(args))
    app_state.mixer["aux"].setdefault(n, {})["mute"] = muted
    asyncio.create_task(broadcast({"type": "mute", "strip": "aux", "ch": n, "value": muted}))

def handle_aux_pan(address, *args):
    n = _ch_num(address)
    if not n: return
    val = parse_wing_pan(args)
    app_state.mixer["aux"].setdefault(n, {})["pan"] = val
    asyncio.create_task(broadcast({"type": "pan", "strip": "aux", "ch": n, "value": val}))

def handle_aux_name(address, *args):
    n = _ch_num(address)
    if not n or not args: return
    name = str(args[0]) if args else ""
    app_state.mixer["aux"].setdefault(n, {})["name"] = name
    asyncio.create_task(broadcast({"type": "name", "strip": "aux", "ch": n, "value": name}))


# Bus handlers
def handle_bus_fader(address, *args):
    n = _ch_num(address)
    if not n: return
    val = parse_wing_float(args)
    app_state.mixer["buses"].setdefault(n, {})["fader"] = val
    asyncio.create_task(broadcast({"type": "fader", "strip": "bus", "ch": n, "value": val}))

def handle_bus_mute(address, *args):
    n = _ch_num(address)
    if not n: return
    muted = bool(parse_wing_int(args))
    app_state.mixer["buses"].setdefault(n, {})["mute"] = muted
    asyncio.create_task(broadcast({"type": "mute", "strip": "bus", "ch": n, "value": muted}))

def handle_bus_pan(address, *args):
    n = _ch_num(address)
    if not n: return
    val = parse_wing_pan(args)
    app_state.mixer["buses"].setdefault(n, {})["pan"] = val
    asyncio.create_task(broadcast({"type": "pan", "strip": "bus", "ch": n, "value": val}))

def handle_bus_name(address, *args):
    n = _ch_num(address)
    if not n or not args: return
    name = str(args[0]) if args else ""
    app_state.mixer["buses"].setdefault(n, {})["name"] = name
    asyncio.create_task(broadcast({"type": "name", "strip": "bus", "ch": n, "value": name}))


# Main handlers
def handle_main_fader(address, *args):
    n = _ch_num(address)
    if not n: return
    val = parse_wing_float(args)
    app_state.mixer["main"].setdefault(n, {})["fader"] = val
    asyncio.create_task(broadcast({"type": "fader", "strip": "main", "ch": n, "value": val}))

def handle_main_mute(address, *args):
    n = _ch_num(address)
    if not n: return
    muted = bool(parse_wing_int(args))
    app_state.mixer["main"].setdefault(n, {})["mute"] = muted
    asyncio.create_task(broadcast({"type": "mute", "strip": "main", "ch": n, "value": muted}))

def handle_main_pan(address, *args):
    n = _ch_num(address)
    if not n: return
    val = parse_wing_pan(args)
    app_state.mixer["main"].setdefault(n, {})["pan"] = val
    asyncio.create_task(broadcast({"type": "pan", "strip": "main", "ch": n, "value": val}))

def handle_main_name(address, *args):
    n = _ch_num(address)
    if not n or not args: return
    name = str(args[0]) if args else ""
    app_state.mixer["main"].setdefault(n, {})["name"] = name
    asyncio.create_task(broadcast({"type": "name", "strip": "main", "ch": n, "value": name}))


# Matrix handlers
def handle_mtx_fader(address, *args):
    n = _ch_num(address)
    if not n: return
    val = parse_wing_float(args)
    app_state.mixer["matrix"].setdefault(n, {})["fader"] = val
    asyncio.create_task(broadcast({"type": "fader", "strip": "mtx", "ch": n, "value": val}))

def handle_mtx_mute(address, *args):
    n = _ch_num(address)
    if not n: return
    muted = bool(parse_wing_int(args))
    app_state.mixer["matrix"].setdefault(n, {})["mute"] = muted
    asyncio.create_task(broadcast({"type": "mute", "strip": "mtx", "ch": n, "value": muted}))

# DCA handlers
def handle_dca_fader(address, *args):
    n = _ch_num(address)
    if not n: return
    val = parse_wing_float(args)
    app_state.mixer["dca"].setdefault(n, {})["fader"] = val
    asyncio.create_task(broadcast({"type": "fader", "strip": "dca", "ch": n, "value": val}))

def handle_dca_mute(address, *args):
    n = _ch_num(address)
    if not n: return
    muted = bool(parse_wing_int(args))
    app_state.mixer["dca"].setdefault(n, {})["mute"] = muted
    asyncio.create_task(broadcast({"type": "mute", "strip": "dca", "ch": n, "value": muted}))

def handle_dca_name(address, *args):
    n = _ch_num(address)
    if not n or not args: return
    name = str(args[0]) if args else ""
    app_state.mixer["dca"].setdefault(n, {})["name"] = name
    asyncio.create_task(broadcast({"type": "name", "strip": "dca", "ch": n, "value": name}))


# Mute group handler
def handle_mgrp_mute(address, *args):
    n = _ch_num(address)
    if not n: return
    muted = bool(parse_wing_int(args))
    app_state.mixer["mgrp"].setdefault(n, {})["mute"] = muted
    asyncio.create_task(broadcast({"type": "mute", "strip": "mgrp", "ch": n, "value": muted}))

def osc_default_handler(address: str, *args):
    log.debug(f"[OSC unhandled] {address} {args}")


async def start_osc_server():
    try:
        dispatcher = build_dispatcher()
        server = AsyncIOOSCUDPServer(
            ("0.0.0.0", LOCAL_OSC_PORT), dispatcher, asyncio.get_event_loop()
        )
        transport, _ = await server.create_serve_endpoint()
        app_state.osc_server = transport
        log.info(f"OSC server listening on UDP :{LOCAL_OSC_PORT}")
    except Exception as e:
        log.error(f"OSC server failed to start: {e}")


# ── WebSocket Hub ─────────────────────────────────────────────────────────────

async def broadcast(payload: dict):
    msg  = json.dumps(payload)
    dead = []
    for ws in app_state.ws_clients:
        try:
            await ws.send_text(msg)
        except Exception:
            dead.append(ws)
    for ws in dead:
        if ws in app_state.ws_clients:
            app_state.ws_clients.remove(ws)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    app_state.ws_clients.append(websocket)
    log.info(f"Browser connected ({len(app_state.ws_clients)} total)")
    # Send current mixer state + Wing connection status on connect
    await websocket.send_text(json.dumps({"type": "snapshot", "mixer": app_state.mixer}))
    await websocket.send_text(json.dumps({
        "type": "wing_status",
        "connected": app_state.wing_connected,
        "wing_ip": WING_IP,
        "wing_port": WING_OSC_PORT,
    }))
    # Trigger a fresh query from the Wing to get latest values
    # (runs in background so the WebSocket isn't blocked)
    asyncio.create_task(bulk_query_wing())
    try:
        async for raw in websocket.iter_text():
            await handle_ws_message(raw, websocket)
    except WebSocketDisconnect:
        pass
    finally:
        if websocket in app_state.ws_clients:
            app_state.ws_clients.remove(websocket)
        log.info("Browser disconnected")


async def handle_ws_message(raw: str, ws: WebSocket):
    """Route messages from the browser to the Wing via OSC."""
    try:
        msg = json.loads(raw)
    except json.JSONDecodeError:
        return

    t = msg.get("type")

    if t == "fader":
        # Browser sends raw 0.0–1.0 fader position
        strip = msg.get("strip", "ch")
        n     = int(msg.get("ch", 1))
        val   = float(msg.get("value", 0.75))
        path  = _fader_path(strip, n)
        if path:
            send_osc(path, val)             # Wing accepts ,f raw 0..1
            _update_mirror(strip, n, "fader", val)

    elif t == "mute":
        strip = msg.get("strip", "ch")
        n     = int(msg.get("ch", 1))
        muted = bool(msg.get("value", False))
        path  = _mute_path(strip, n)
        if path:
            send_osc(path, 1 if muted else 0)  # Wing: 0=unmuted, 1=muted
            _update_mirror(strip, n, "mute", muted)

    elif t == "mute_toggle":
        # Efficient toggle without needing to read current state first
        strip = msg.get("strip", "ch")
        n     = int(msg.get("ch", 1))
        path  = _mute_path(strip, n)
        if path:
            send_osc(path, -1)              # Wing toggles 0↔1 on -1

    elif t == "pan":
        strip = msg.get("strip", "ch")
        n     = int(msg.get("ch", 1))
        val   = float(msg.get("value", 0.0))   # UI sends -1.0..1.0
        path  = _pan_path(strip, n)
        if path:
            send_osc(path, val * 100.0)        # Wing expects -100..100
            _update_mirror(strip, n, "pan", val)

    elif t == "osc":
        # Raw OSC passthrough — browser provides full Wing-style path
        path  = msg.get("path", "")
        value = msg.get("value")
        if path:
            send_osc(path, value)

    elif t == "query":
        # Request current value of a parameter from Wing
        path = msg.get("path", "")
        if path:
            send_osc(path, None)             # No args = GET request

    elif t == "record_start":
        channels = msg.get("channels", list(range(1, CHANNELS + 1)))
        result   = await start_recording(channels)
        await ws.send_text(json.dumps(result))

    elif t == "record_stop":
        result = await stop_recording()
        await ws.send_text(json.dumps(result))

    elif t == "arm":
        ch  = int(msg.get("ch", 0))
        arm = bool(msg.get("value", False))
        if arm:
            app_state.armed_channels.add(ch)
        else:
            app_state.armed_channels.discard(ch)
        await broadcast({"type": "arm", "ch": ch, "value": arm})

    elif t == "ping":
        await ws.send_text(json.dumps({"type": "pong", "ts": time.time()}))


# ── OSC Path Helpers ──────────────────────────────────────────────────────────

def _fader_path(strip: str, n: int) -> Optional[str]:
    paths = {
        "ch":   f"/ch/{n}/fdr",
        "aux":  f"/aux/{n}/fdr",
        "bus":  f"/bus/{n}/fdr",
        "main": f"/main/{n}/fdr",
        "mtx":  f"/mtx/{n}/fdr",
        "dca":  f"/dca/{n}/fdr",
    }
    return paths.get(strip)

def _mute_path(strip: str, n: int) -> Optional[str]:
    paths = {
        "ch":   f"/ch/{n}/mute",
        "aux":  f"/aux/{n}/mute",
        "bus":  f"/bus/{n}/mute",
        "main": f"/main/{n}/mute",
        "mtx":  f"/mtx/{n}/mute",
        "dca":  f"/dca/{n}/mute",
        "mgrp": f"/mgrp/{n}/mute",
    }
    return paths.get(strip)

def _pan_path(strip: str, n: int) -> Optional[str]:
    paths = {
        "ch":   f"/ch/{n}/pan",
        "aux":  f"/aux/{n}/pan",
        "bus":  f"/bus/{n}/pan",
        "main": f"/main/{n}/pan",
        "mtx":  f"/mtx/{n}/pan",
    }
    return paths.get(strip)

def _update_mirror(strip: str, n: int, param: str, value):
    section_map = {
        "ch": "channels", "aux": "aux", "bus": "buses",
        "main": "main", "mtx": "matrix", "dca": "dca", "mgrp": "mgrp",
    }
    section = section_map.get(strip)
    if section and section in app_state.mixer:
        app_state.mixer[section].setdefault(str(n), {})[param] = value


# ── OSC Send Helper ───────────────────────────────────────────────────────────

def send_osc(path: str, value):
    """
    Send an OSC message to the Wing.
    value=None  → query (no arguments, Wing returns current value)
    value=[]    → empty args list (same as query)
    value=float → ,f float32
    value=int   → ,i int32
    value=str   → ,s string
    """
    if not app_state.wing_client:
        log.debug(f"[OSC offline] {path} = {value}")
        return
    try:
        if value is None or value == []:
            app_state.wing_client.send_message(path, [])
        else:
            app_state.wing_client.send_message(path, value)
        log.debug(f"[OSC →] {path} = {repr(value)}")
    except Exception as e:
        log.warning(f"OSC send error ({path}): {e}")


# ── Recording ─────────────────────────────────────────────────────────────────

async def start_recording(channels: list) -> dict:
    if app_state.recording:
        return {"type": "record_status", "status": "already_recording"}

    timestamp   = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename    = f"session_{timestamp}.wav"
    record_path = RECORDINGS_DIR / filename
    ch_count    = max(1, min(len(channels), 64))

    try:
        try:
            device_info = sd.query_devices(kind="input")
        except Exception:
            return {
                "type":    "record_status",
                "status":  "error",
                "message": "No audio input device found. Connect Wing via USB and enable /dev/snd in the Setup Wizard.",
            }

        subtype_map = {16: "PCM_16", 24: "PCM_24", 32: "FLOAT"}
        subtype     = subtype_map.get(BIT_DEPTH, "FLOAT")

        sf_file = sf.SoundFile(
            str(record_path), mode="w",
            samplerate=SAMPLE_RATE, channels=ch_count, subtype=subtype,
        )
        app_state.record_file = sf_file
        app_state.record_path = record_path

        def audio_callback(indata, frames, time_info, status):
            if status:
                log.warning(f"Audio callback status: {status}")
            if app_state.recording and app_state.record_file:
                app_state.record_file.write(indata[:, :ch_count])

        max_hw_ch = min(ch_count, int(device_info["max_input_channels"]))
        stream = sd.InputStream(
            samplerate=SAMPLE_RATE, channels=max_hw_ch,
            dtype="float32", callback=audio_callback, blocksize=1024,
        )
        stream.start()
        app_state.record_stream   = stream
        app_state.recording       = True
        app_state.record_start_ts = time.time()

        log.info(f"Recording started → {record_path} ({ch_count}ch @ {SAMPLE_RATE}Hz)")
        await broadcast({"type": "record_status", "status": "recording", "file": filename})
        return {"type": "record_status", "status": "recording", "file": filename}

    except Exception as e:
        log.error(f"Failed to start recording: {e}")
        return {"type": "record_status", "status": "error", "message": str(e)}


async def stop_recording() -> dict:
    if not app_state.recording:
        return {"type": "record_status", "status": "not_recording"}

    app_state.recording = False

    if app_state.record_stream:
        app_state.record_stream.stop()
        app_state.record_stream.close()
        app_state.record_stream = None

    if app_state.record_file:
        app_state.record_file.close()
        app_state.record_file = None

    duration = round(time.time() - app_state.record_start_ts, 2)
    fname    = app_state.record_path.name if app_state.record_path else "unknown"

    log.info(f"Recording stopped. Duration={duration}s → {fname}")
    await broadcast({"type": "record_status", "status": "stopped", "file": fname, "duration": duration})
    return {"type": "record_status", "status": "stopped", "file": fname, "duration": duration}


# ── REST Endpoints ────────────────────────────────────────────────────────────

@app.get("/api/status")
async def get_status():
    return {
        "connected":       app_state.wing_client is not None,
        "wing_connected":  app_state.wing_connected,
        "recording":       app_state.recording,
        "ws_clients":      len(app_state.ws_clients),
        "wing_ip":         WING_IP,
        "wing_port":       WING_OSC_PORT,
        "local_port":      LOCAL_OSC_PORT,
        "sample_rate":     SAMPLE_RATE,
        "bit_depth":       BIT_DEPTH,
    }


@app.get("/api/mixer")
async def get_mixer():
    return JSONResponse(app_state.mixer)


@app.post("/api/osc")
async def post_osc(payload: dict):
    path  = payload.get("path", "")
    value = payload.get("value")
    if not path:
        raise HTTPException(400, "Missing 'path'")
    send_osc(path, value)
    return {"sent": True, "path": path, "value": value}


@app.get("/api/recordings")
async def list_recordings():
    files = sorted(RECORDINGS_DIR.glob("*.wav"), key=lambda f: f.stat().st_mtime, reverse=True)
    return [
        {
            "name":     f.name,
            "size_mb":  round(f.stat().st_size / 1_048_576, 2),
            "modified": datetime.fromtimestamp(f.stat().st_mtime).isoformat(),
        }
        for f in files
    ]


@app.get("/api/recordings/{filename}")
async def download_recording(filename: str):
    path = RECORDINGS_DIR / filename
    if not path.exists() or not path.is_file():
        raise HTTPException(404, "File not found")
    return FileResponse(str(path), media_type="audio/wav", filename=filename)


@app.delete("/api/recordings/{filename}")
async def delete_recording(filename: str):
    path = RECORDINGS_DIR / filename
    if not path.exists():
        raise HTTPException(404, "File not found")
    path.unlink()
    return {"deleted": filename}


@app.get("/api/audio-devices")
async def list_audio_devices():
    try:
        devices = sd.query_devices()
        return [
            {
                "index":        i,
                "name":         d["name"],
                "max_input_ch": d["max_input_channels"],
                "max_output_ch":d["max_output_channels"],
                "default_sr":   d["default_samplerate"],
            }
            for i, d in enumerate(devices)
        ]
    except Exception as e:
        log.warning(f"Could not query audio devices: {e}")
        return {"error": str(e), "hint": "No audio hardware detected. Mount /dev/snd in docker-compose.yml."}


# ── Setup Wizard API ──────────────────────────────────────────────────────────

@app.get("/api/setup/detect")
async def setup_detect():
    return detect_environment()


@app.post("/api/setup/test-osc")
async def setup_test_osc(payload: dict):
    ip      = payload.get("ip", WING_IP)
    port    = int(payload.get("port", WING_OSC_PORT))
    timeout = float(payload.get("timeout", 3.0))
    return await test_osc_connection(ip, port, timeout)


@app.post("/api/setup/apply")
async def setup_apply(payload: dict):
    results = {}

    env_result       = apply_env_config(payload)
    results["env"]   = env_result

    enable_audio     = payload.get("enable_audio_passthrough", False)
    audio_result     = apply_audio_passthrough(enable_audio)
    results["audio"] = audio_result

    new_ip   = payload.get("wing_ip", WING_IP)
    new_port = int(payload.get("wing_osc_port", WING_OSC_PORT))
    try:
        app_state.wing_client = SimpleUDPClient(new_ip, new_port)
        # Send initial subscription to new endpoint
        app_state.wing_client.send_message(WING_SUBSCRIBE, [])
        results["osc_client"] = {"success": True, "message": f"OSC client updated → {new_ip}:{new_port}"}
    except Exception as e:
        results["osc_client"] = {"success": False, "message": str(e)}

    results["restart_required"] = audio_result.get("restart_required", False)

    await broadcast({"type": "setup_applied", "results": results})
    return results


@app.post("/api/setup/audio-passthrough")
async def setup_audio_passthrough(payload: dict):
    enable = bool(payload.get("enable", False))
    return apply_audio_passthrough(enable)


@app.post("/api/setup/restart")
async def setup_restart():
    return trigger_container_restart()


# ── Serve Frontend ────────────────────────────────────────────────────────────
STATIC_DIR = Path(__file__).parent.parent / "frontend" / "static"
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    @app.get("/")
    async def serve_index():
        return FileResponse(str(STATIC_DIR / "index.html"))


# ── Bulk State Query (run on connect / reconnect) ─────────────────────────────

# How many channels/buses to query on startup
QUERY_CHANNELS = 40
QUERY_BUSES    = 16
QUERY_AUX      = 8
QUERY_MAINS    = 4
QUERY_DCA      = 16

# Small delay between batched OSC queries (seconds) — avoids flooding the Wing
QUERY_BATCH_DELAY = 0.02


async def bulk_query_wing():
    """
    Query all channel/bus/main/aux names, faders, mutes, and pans from the Wing
    on startup. Sends individual OSC GET requests (no args = query) and lets the
    existing OSC dispatcher handlers update app_state.mixer as replies arrive.

    We stagger requests slightly to avoid overloading Wing's OSC server with
    hundreds of UDP packets at once.
    """
    if not app_state.wing_client:
        log.warning("bulk_query_wing: no OSC client — skipping")
        return

    log.info("Querying Wing for current state (names, faders, mutes, pans)…")

    # Build list of all paths to query
    queries: list[str] = []

    # Channels 1..40
    for n in range(1, QUERY_CHANNELS + 1):
        queries += [f"/ch/{n}/name", f"/ch/{n}/fdr", f"/ch/{n}/mute", f"/ch/{n}/pan", f"/ch/{n}/$solo"]

    # Aux inputs 1..8
    for n in range(1, QUERY_AUX + 1):
        queries += [f"/aux/{n}/name", f"/aux/{n}/fdr", f"/aux/{n}/mute", f"/aux/{n}/pan"]

    # Mix buses 1..16
    for n in range(1, QUERY_BUSES + 1):
        queries += [f"/bus/{n}/name", f"/bus/{n}/fdr", f"/bus/{n}/mute", f"/bus/{n}/pan"]

    # Mains 1..4
    for n in range(1, QUERY_MAINS + 1):
        queries += [f"/main/{n}/name", f"/main/{n}/fdr", f"/main/{n}/mute", f"/main/{n}/pan"]

    # DCA 1..16
    for n in range(1, QUERY_DCA + 1):
        queries += [f"/dca/{n}/name", f"/dca/{n}/fdr", f"/dca/{n}/mute"]

    log.info(f"Sending {len(queries)} OSC queries to Wing…")

    # Send in small batches with a short sleep to avoid UDP packet storms
    BATCH = 10
    for i in range(0, len(queries), BATCH):
        batch = queries[i:i + BATCH]
        for path in batch:
            try:
                app_state.wing_client.send_message(path, [])
            except Exception as e:
                log.warning(f"Query send error ({path}): {e}")
        await asyncio.sleep(QUERY_BATCH_DELAY)

    log.info("Bulk Wing query complete — waiting for replies via OSC dispatcher")


# ── Wing Native Binary Meter Engine ──────────────────────────────────────────
#
# The Wing sends real hardware VU meter data (pre-fader input levels, post-fader
# output levels, gate/dyn state) via its native binary TCP protocol on port 2222.
#
# Binary framing (NRP protocol, from official V3.1.0 docs):
#   - TCP connection to Wing port 2222
#   - Channel select:  0xDF 0xD<ChID>  (0xDF 0xD3 = select channel 3 = meters)
#   - Escape byte 0xDF must be doubled if it appears in data
#
# Meter channel 3 token stream:
#   0xD3 <port_hi> <port_lo>         = declare UDP return port (2 bytes big-endian)
#   0xD4 <id_b3> <id_b2> <id_b1> <id_b0>  = report id (4 bytes)
#   0xDC                              = start meter collection
#     0xA0 <idx>                      = channel strip (idx 0x00=ch1, 0x01=ch2…)
#     0xA1 <idx>                      = aux strip
#     0xA2 <idx>                      = bus strip
#   0xDE                              = end collection
#
# Wing sends back UDP packets to the declared port:
#   4-byte report ID + N×2-byte signed big-endian meter words in 1/256 dB
#   Per channel: input_L, input_R, output_L, output_R, gate_key, gate_gain,
#                dyn_key, dyn_gain  (8 words = 16 bytes per strip)
#
# Level conversion: dB = raw_int16 / 256.0
# To 0.0–1.0 UI range: clamp(dB, -60, 0) mapped to 0.0–1.0
#

WING_BINARY_PORT   = 2222          # Wing native binary TCP port (fixed)
METER_UDP_PORT     = int(os.getenv("METER_UDP_PORT", "2225"))  # UDP port Wing sends meter data to
METER_REPORT_ID    = 1             # Arbitrary ID to identify our meter subscription
METER_RENEW_SEC    = 4.0           # Renew every 4s (Wing times out after 5s)
METER_CHANNELS     = 40            # Request all 40 channel strips

# Shared meter level store: {"ch-1": 0.75, "ch-2": 0.0, ...}
# Written by UDP receive loop, read by broadcast loop
_live_meters: dict = {}


def _nrp_escape(data: bytes) -> bytes:
    """Apply NRP escape encoding: 0xDF → 0xDF 0xDE."""
    out = bytearray()
    for b in data:
        out.append(b)
        if b == 0xDF:
            out.append(0xDE)
    return bytes(out)


def _build_meter_request(udp_port: int, report_id: int, num_channels: int) -> bytes:
    """
    Build the binary meter subscription packet for Wing channel 3.
    Requests output_L + output_R for all channels 1..num_channels.
    """
    # Channel select: switch to channel 3 (meters)
    select_ch3 = bytes([0xDF, 0xD3])

    # Token 0xD3: declare UDP return port (2 bytes big-endian)
    port_hi = (udp_port >> 8) & 0xFF
    port_lo = udp_port & 0xFF
    set_port = _nrp_escape(bytes([0xD3, port_hi, port_lo]))

    # Token 0xD4: report id (4 bytes big-endian)
    id_bytes = report_id.to_bytes(4, 'big')
    set_id = _nrp_escape(bytes([0xD4]) + id_bytes)

    # Meter collection: 0xDC ... 0xDE
    # 0xA0 <idx> = channel strip, idx is 0-based
    collection = bytearray([0xDC])
    for ch in range(num_channels):
        collection += bytes([0xA0, ch])
    collection += bytes([0xDE])

    return select_ch3 + set_port + set_id + _nrp_escape(bytes(collection))


def _build_meter_renew(report_id: int) -> bytes:
    """Renew packet: just resend the report_id token to reset 5s timeout."""
    select_ch3 = bytes([0xDF, 0xD3])
    id_bytes   = report_id.to_bytes(4, 'big')
    return select_ch3 + _nrp_escape(bytes([0xD4]) + id_bytes)


def _parse_meter_udp(data: bytes, num_channels: int) -> dict:
    """
    Parse a Wing meter UDP packet.
    Format: 4-byte report_id + (8 words × 2 bytes) per channel
    Words per channel: in_L, in_R, out_L, out_R, gate_key, gate_gain, dyn_key, dyn_gain
    We use out_L (word index 2) as the primary level — post-fader output.
    Returns dict {"1": 0.75, "2": 0.3, ...} in 0.0–1.0 range.
    """
    if len(data) < 4:
        return {}

    # Skip 4-byte report ID
    payload    = data[4:]
    words_per  = 8          # 8 signed int16 words per channel strip
    bytes_per  = words_per * 2
    result     = {}

    for ch in range(min(num_channels, len(payload) // bytes_per)):
        offset   = ch * bytes_per
        chunk    = payload[offset : offset + bytes_per]
        if len(chunk) < bytes_per:
            break

        # Word 2 = output_L (post-fader left level)
        raw   = int.from_bytes(chunk[4:6], 'big', signed=True)
        db    = raw / 256.0      # convert from 1/256 dB units to dB

        # Map dB to 0.0–1.0:  -60 dB → 0.0,  0 dB → 1.0  (log-linear feel)
        clamped = max(-60.0, min(0.0, db))
        level   = (clamped + 60.0) / 60.0

        result[str(ch + 1)] = round(level, 4)

    return result


async def meter_engine():
    """
    Full Wing hardware meter loop:
      1. Open TCP connection to Wing binary port 2222
      2. Subscribe to channel meter data via channel 3 token stream
      3. Listen on UDP port for meter packets from Wing (~50ms intervals)
      4. Parse and broadcast levels to browser clients
      5. Renew subscription every 4 seconds
      6. Reconnect on failure with backoff
    """
    await asyncio.sleep(4)   # Wait for OSC server and bulk query to start

    udp_sock      = None
    tcp_writer    = None
    last_renew    = 0.0
    backoff       = 2.0

    while True:
        if not app_state.wing_client:
            await asyncio.sleep(backoff)
            continue

        # ── Open UDP socket to receive meter data ─────────────────────────
        try:
            import socket as _socket
            udp_sock = _socket.socket(_socket.AF_INET, _socket.SOCK_DGRAM)
            udp_sock.bind(("0.0.0.0", METER_UDP_PORT))
            udp_sock.setblocking(False)
            log.info(f"Meter UDP listener bound on :{METER_UDP_PORT}")
        except Exception as e:
            log.warning(f"Meter UDP bind failed: {e}")
            if udp_sock:
                try: udp_sock.close()
                except: pass
            await asyncio.sleep(backoff)
            continue

        # ── Open TCP connection to Wing binary port ───────────────────────
        try:
            tcp_reader, tcp_writer = await asyncio.wait_for(
                asyncio.open_connection(WING_IP, WING_BINARY_PORT),
                timeout=5.0
            )
            log.info(f"Meter TCP connected → {WING_IP}:{WING_BINARY_PORT}")
            backoff = 2.0   # reset backoff on success
        except Exception as e:
            log.warning(f"Meter TCP connect failed ({WING_IP}:{WING_BINARY_PORT}): {e}")
            udp_sock.close()
            await asyncio.sleep(backoff)
            backoff = min(backoff * 1.5, 30.0)
            continue

        # ── Send initial meter subscription ──────────────────────────────
        try:
            req = _build_meter_request(METER_UDP_PORT, METER_REPORT_ID, METER_CHANNELS)
            tcp_writer.write(req)
            await tcp_writer.drain()
            last_renew = asyncio.get_event_loop().time()
            log.info(f"Meter subscription sent for {METER_CHANNELS} channels")
        except Exception as e:
            log.warning(f"Meter subscription send failed: {e}")
            tcp_writer.close()
            udp_sock.close()
            await asyncio.sleep(backoff)
            continue

        # ── Receive meter UDP packets ─────────────────────────────────────
        loop = asyncio.get_event_loop()
        try:
            while True:
                now = loop.time()

                # Renew subscription before it times out (every 4s)
                if now - last_renew >= METER_RENEW_SEC:
                    renew = _build_meter_renew(METER_REPORT_ID)
                    tcp_writer.write(renew)
                    await tcp_writer.drain()
                    last_renew = now

                # Non-blocking UDP read
                try:
                    data, _ = udp_sock.recvfrom(4096)
                    if data:
                        levels = _parse_meter_udp(data, METER_CHANNELS)
                        if levels:
                            _live_meters.update(levels)
                            # Broadcast to browser if clients connected
                            if app_state.ws_clients:
                                await broadcast({"type": "meters", "channels": levels})
                except BlockingIOError:
                    pass  # No data yet — normal
                except Exception as e:
                    log.warning(f"Meter UDP recv error: {e}")

                await asyncio.sleep(0.033)   # ~30 fps poll rate

        except Exception as e:
            log.warning(f"Meter loop error: {e}")
        finally:
            try: tcp_writer.close()
            except: pass
            try: udp_sock.close()
            except: pass
            log.info("Meter connection lost — reconnecting…")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 1.5, 30.0)


# Alias so lifespan can call meter_poll_loop (backward compat)
async def meter_poll_loop():
    await meter_engine()


# ── Hook bulk query into lifespan and WebSocket connect ───────────────────────
# (These are registered at the bottom via monkey-patching startup and ws handler)
