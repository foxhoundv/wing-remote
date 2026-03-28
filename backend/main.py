"""
WING Remote v2.2.2 - FastAPI Backend
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
import socket as _socket
from pythonosc.udp_client import SimpleUDPClient   # kept for type compat only
from pythonosc.dispatcher import Dispatcher

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
# Static config — read once at startup from environment / .env file
LOCAL_OSC_PORT = int(os.getenv("LOCAL_OSC_PORT", "2224"))
SAMPLE_RATE    = int(os.getenv("SAMPLE_RATE", "48000"))
BIT_DEPTH      = int(os.getenv("BIT_DEPTH", "32"))
CHANNELS       = int(os.getenv("RECORD_CHANNELS", "32"))
RECORDINGS_DIR = Path(os.getenv("RECORDINGS_DIR", "/recordings"))
RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
METER_RENEW_SEC    = 4.0
SUBSCRIPTION_INTERVAL = 8.0
WING_SUBSCRIBE     = "/*S"
WING_BINARY_PORT   = 2222

# Mutable Wing target — updated live by setup_apply without needing restart
_wing_ip   = os.getenv("WING_IP",       "192.168.1.100")
_wing_port = int(os.getenv("WING_OSC_PORT", "2223"))

def WING_IP() -> str:
    return _wing_ip

def WING_OSC_PORT() -> int:
    return _wing_port

def set_wing_target(ip: str, port: int):
    global _wing_ip, _wing_port
    _wing_ip   = ip
    _wing_port = port
    log.info(f"Wing target updated → {ip}:{port}")

# Wing subscription keepalive — must be renewed every <10 seconds
SUBSCRIPTION_INTERVAL = 8.0
# Subscribe with /*S (single-value events, easiest to re-send unchanged)
WING_SUBSCRIBE = "/*S"


# ── Shared State ──────────────────────────────────────────────────────────────
class WingOSCTransport:
    """
    Single UDP socket that both SENDS to and RECEIVES from the Wing.

    Why one socket matters: Wing replies to the source port of every UDP
    packet it receives. By using one socket bound to LOCAL_OSC_PORT (2224)
    for all outgoing messages, Wing sends GET replies AND subscription push
    events back to 2224 — the same socket we read from.

    Using two separate sockets (SimpleUDPClient for send, AsyncIOOSCUDPServer
    for receive) means sends go from an ephemeral port, so Wing replies to
    that ephemeral port — and our receive socket on 2224 never sees them.
    """
    def __init__(self, wing_ip: str, wing_port: int, local_port: int,
                 dispatcher):
        self._wing_ip    = wing_ip
        self._wing_port  = wing_port
        self._local_port = local_port
        self._dispatcher = dispatcher
        self._sock: Optional[_socket.socket] = None
        self._transport  = None   # asyncio transport

    async def start(self, loop):
        """Bind the socket and register it with the asyncio event loop."""
        class _Protocol(asyncio.DatagramProtocol):
            def __init__(self_, transport_ref):
                self_._ref = transport_ref
            def connection_made(self_, transport):
                self_._ref._transport = transport
            def datagram_received(self_, data, addr):
                try:
                    from pythonosc.osc_message import OscMessage
                    msg = OscMessage(data)
                    handlers = self_._ref._dispatcher.handlers_for_address(msg.address)
                    for h in handlers:
                        h.invoke(msg.address, msg.params)
                except Exception as e:
                    log.debug(f"[OSC recv] parse error from {addr}: {e}")
            def error_received(self_, exc):
                log.debug(f"[OSC recv] error: {exc}")
            def connection_lost(self_, exc):
                pass

        self._sock = _socket.socket(_socket.AF_INET, _socket.SOCK_DGRAM)
        self._sock.setsockopt(_socket.SOL_SOCKET, _socket.SO_REUSEADDR, 1)
        self._sock.bind(("0.0.0.0", self._local_port))
        self._sock.setblocking(False)

        self._transport, _ = await loop.create_datagram_endpoint(
            lambda: _Protocol(self),
            sock=self._sock,
        )
        log.info(f"OSC socket bound on UDP :{self._local_port} "
                 f"(send→receive on same port so Wing replies reach us)")

    def send_message(self, address: str, args):
        """Build and send an OSC message to the Wing."""
        from pythonosc import osc_message_builder as _mb
        builder = _mb.OscMessageBuilder(address=address)
        if args is not None and args != []:
            items = args if isinstance(args, (list, tuple)) else [args]
            for a in items:
                if   isinstance(a, bool):  builder.add_arg(int(a))
                elif isinstance(a, int):   builder.add_arg(a)
                elif isinstance(a, float): builder.add_arg(a)
                elif isinstance(a, str):   builder.add_arg(a)
        try:
            msg = builder.build()
            if self._transport:
                self._transport.sendto(msg.dgram, (self._wing_ip, self._wing_port))
            elif self._sock:
                self._sock.sendto(msg.dgram, (self._wing_ip, self._wing_port))
        except Exception as e:
            log.warning(f"[OSC send] {address}: {e}")

    def update_target(self, ip: str, port: int):
        self._wing_ip   = ip
        self._wing_port = port

    def close(self):
        if self._transport:
            self._transport.close()


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

        def _ch_defaults(i):
            return {
                "fader": 0.75, "mute": False, "solo": False, "pan": 0.0,
                "name": f"CH {i}",
                "eq":   {"on": False, "bands": [{"g":0,"f":1000,"q":0.7}]*6},
                "dyn":  {"on": False, "thr": -20.0, "ratio": "4.0", "att": 10.0, "rel": 100.0,
                         "knee": 0, "gain": 0.0},
                "gate": {"on": False, "thr": -40.0, "range": 60.0, "att": 0.0, "rel": 100.0},
                "sends": {str(b): {"on": False, "lvl": 0.75} for b in range(1, 17)},
            }
        def _bus_defaults(i):
            return {
                "fader": 0.75, "mute": False, "solo": False, "pan": 0.0,
                "name": f"BUS {i}",
                "eq":   {"on": False, "bands": [{"g":0,"f":1000,"q":0.7}]*8},
                "dyn":  {"on": False, "thr": -20.0, "ratio": 4.0, "att": 10.0, "rel": 100.0},
            }

        # Mixer mirror — all indices 1-based matching Wing numbering
        self.mixer: dict = {
            "channels": {str(i): _ch_defaults(i)  for i in range(1, 41)},
            "aux":      {str(i): {**_ch_defaults(i), "name": f"AUX {i}"} for i in range(1, 9)},
            "buses":    {str(i): _bus_defaults(i)  for i in range(1, 17)},
            "main":     {str(i): {"fader": 0.75, "mute": False, "pan": 0.0, "name": f"MAIN {i}",
                                  "eq": {"on": False, "bands": [{"g":0,"f":1000,"q":0.7}]*8},
                                  "dyn": {"on": False, "thr": -20.0, "ratio": 4.0}} for i in range(1, 5)},
            "matrix":   {str(i): {"fader": 0.75, "mute": False, "pan": 0.0, "name": f"MTX {i}"}
                         for i in range(1, 9)},
            "dca":      {str(i): {"fader": 0.75, "mute": False, "name": f"DCA {i}"}
                         for i in range(1, 17)},
            "mgrp":     {str(i): {"mute": False, "name": f"MG {i}"} for i in range(1, 9)},
        }

        self.ws_clients: list = []

app_state = AppState()


# ── Lifespan ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Starting WING Remote backend…")
    log.info(f"Wing target: {WING_IP()}:{WING_OSC_PORT()}  |  Local OSC listen: {LOCAL_OSC_PORT}")

    try:
        # WingOSCTransport uses ONE socket for both sending and receiving
        # so Wing replies always come back to LOCAL_OSC_PORT where we listen.
        # It is started inside start_osc_server() after the dispatcher is built.
        log.info(f"Wing target: {WING_IP()}:{WING_OSC_PORT()} | local OSC port: {LOCAL_OSC_PORT}")
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
        try:
            app_state.osc_server.close()
        except Exception:
            pass


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
                    test_osc_connection(WING_IP(), WING_OSC_PORT(), timeout=2.0),
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
                "wing_ip":   WING_IP(),
                "wing_port": WING_OSC_PORT(),
            }
            await broadcast(status_msg)
            if connected:
                log.info(f"Wing connected at {WING_IP()}:{WING_OSC_PORT()}")
                # Trigger bulk query now that Wing is reachable
                asyncio.create_task(bulk_query_wing())
            else:
                log.warning(f"Wing not reachable at {WING_IP()}:{WING_OSC_PORT()}")

        await asyncio.sleep(5.0 if not connected else 15.0)


# ── OSC Response Parsers ──────────────────────────────────────────────────────

def _wing_db_to_raw(db: float) -> float:
    """
    Convert Wing dB fader value to raw 0.0–1.0 position.

    Piecewise formula derived from official V3.1.0 protocol docs examples:
      raw=0.000 @ dB=-144 (−∞)   raw=0.675 @ dB=-3
      raw=0.750 @ dB=0            raw=0.850 @ dB=+4
      raw=0.923 @ dB=+10

    Segments:
      dB ≤ -3  : linear from (-60, 0.0) to (-3, 0.675)
      -3..+4   : linear at 0.025 raw/dB,  0 dB = 0.75
      +4..+10  : linear at ~0.01222 raw/dB
    """
    if db <= -144.0:
        return 0.0
    elif db < -3.0:
        raw = 0.675 * (1.0 + (db + 3.0) / 57.0)
        return max(0.0, raw)
    elif db <= 4.0:
        return 0.75 + db * 0.025
    elif db <= 10.0:
        return 0.85 + (db - 4.0) * (0.9233 - 0.85) / 6.0
    else:
        return min(1.0, 0.9233 + (db - 10.0) * 0.01)


def parse_wing_float(args) -> float:
    """
    Parse a Wing OSC float argument into a raw 0.0–1.0 fader position.

    Wing GET response (,sff): args = (ascii_label, raw_0_to_1, dB_value)
      → use args[1] directly — it IS the raw position.

    Wing PUSH event (,f via /*S subscription): args = (dB_value,)
      → the pushed value is in dB (e.g. -3.0, 0.0, +4.0), NOT raw 0–1.
      → convert using _wing_db_to_raw().

    The distinction: if args[0] is a string the response is a GET reply.
    If args[0] is a float it is a subscription push carrying a dB value.
    """
    if not args:
        return 0.0
    # ,sff GET reply: args[0] is the string label, args[1] is raw 0–1
    if isinstance(args[0], str) and len(args) >= 2:
        try:
            return max(0.0, min(1.0, float(args[1])))
        except (ValueError, TypeError):
            pass
    # ,f subscription push: args[0] is the dB value — convert to raw
    try:
        db = float(args[0])
        return _wing_db_to_raw(db)
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
    d.map("/mtx/*/pan",  handle_mtx_pan)
    d.map("/mtx/*/name", handle_mtx_name)

    # Solo for aux/bus/main/mtx (read-only state pushed by Wing)
    d.map("/aux/*/$solo",  handle_aux_solo)
    d.map("/bus/*/$solo",  handle_bus_solo)
    d.map("/main/*/$solo", handle_main_solo)
    d.map("/mtx/*/$solo",  handle_mtx_solo)
    d.map("/dca/*/$solo",  handle_dca_solo)

    # DCA 1..16
    d.map("/dca/*/fdr",  handle_dca_fader)
    d.map("/dca/*/mute", handle_dca_mute)

    # Mute groups 1..8
    d.map("/mgrp/*/mute", handle_mgrp_mute)

    # EQ (channels, aux, buses, mains)
    d.map("/ch/*/eq/*",   handle_ch_eq)
    d.map("/aux/*/eq/*",  handle_aux_eq)
    d.map("/bus/*/eq/*",  handle_bus_eq)
    d.map("/main/*/eq/*", handle_main_eq)

    # Dynamics / compressor
    d.map("/ch/*/dyn/*",   handle_ch_dyn)
    d.map("/aux/*/dyn/*",  handle_aux_dyn)
    d.map("/bus/*/dyn/*",  handle_bus_dyn)
    d.map("/main/*/dyn/*", handle_main_dyn)

    # Gate / expander (channels and aux only)
    d.map("/ch/*/gate/*",  handle_ch_gate)
    d.map("/aux/*/gate/*", handle_aux_gate)

    # Bus sends
    d.map("/ch/*/send/*/*",  handle_ch_send)
    d.map("/aux/*/send/*/*", handle_aux_send)

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
def handle_mtx_pan(address, *args):
    n = _ch_num(address)
    if not n: return
    val = parse_wing_pan(args)
    app_state.mixer["matrix"].setdefault(n, {})["pan"] = val
    asyncio.create_task(broadcast({"type": "pan", "strip": "mtx", "ch": n, "value": val}))

def handle_mtx_name(address, *args):
    n = _ch_num(address)
    if not n or not args: return
    name = str(args[0]) if args else ""
    app_state.mixer["matrix"].setdefault(n, {})["name"] = name
    asyncio.create_task(broadcast({"type": "name", "strip": "mtx", "ch": n, "value": name}))

def handle_aux_solo(address, *args):
    n = _ch_num(address)
    if not n: return
    val = bool(parse_wing_int(args))
    app_state.mixer["aux"].setdefault(n, {})["solo"] = val
    asyncio.create_task(broadcast({"type": "solo", "strip": "aux", "ch": n, "value": val}))

def handle_bus_solo(address, *args):
    n = _ch_num(address)
    if not n: return
    val = bool(parse_wing_int(args))
    app_state.mixer["buses"].setdefault(n, {})["solo"] = val
    asyncio.create_task(broadcast({"type": "solo", "strip": "bus", "ch": n, "value": val}))

def handle_main_solo(address, *args):
    n = _ch_num(address)
    if not n: return
    val = bool(parse_wing_int(args))
    app_state.mixer["main"].setdefault(n, {})["solo"] = val
    asyncio.create_task(broadcast({"type": "solo", "strip": "main", "ch": n, "value": val}))

def handle_mtx_solo(address, *args):
    n = _ch_num(address)
    if not n: return
    val = bool(parse_wing_int(args))
    app_state.mixer["matrix"].setdefault(n, {})["solo"] = val
    asyncio.create_task(broadcast({"type": "solo", "strip": "mtx", "ch": n, "value": val}))

def handle_dca_solo(address, *args):
    n = _ch_num(address)
    if not n: return
    val = bool(parse_wing_int(args))
    app_state.mixer["dca"].setdefault(n, {})["solo"] = val
    asyncio.create_task(broadcast({"type": "solo", "strip": "dca", "ch": n, "value": val}))

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

# ── EQ handlers ──────────────────────────────────────────────────────────────
# Wing EQ paths: /ch/{n}/eq/on, /ch/{n}/eq/{1-4}g, /ch/{n}/eq/{1-4}f, /ch/{n}/eq/{1-4}q
# Same pattern for /aux/, /bus/, /main/

def _eq_handler(address: str, section: str, store_key: str, args):
    """Generic EQ parameter handler. address e.g. /ch/1/eq/1g"""
    parts = address.split("/")
    try:
        n = str(int(parts[2]))
    except (IndexError, ValueError):
        return
    param = parts[4] if len(parts) > 4 else ""
    store = app_state.mixer.get(section, {}).get(n, {})
    eq    = store.setdefault("eq", {"on": False, "bands": []})

    if param == "on":
        val = bool(parse_wing_int(args))
        eq["on"] = val
        asyncio.create_task(broadcast({"type": "eq_on", "strip": store_key, "ch": n, "value": val}))
    elif len(param) >= 2 and param[-1] in "gfq":
        try:
            band_num = int(param[:-1])  # e.g. "1g" → 1
            attr     = param[-1]        # g, f, or q
            val      = parse_wing_float(args) if attr == "f" else float(args[0]) if args else 0.0
            # Ensure bands list is long enough
            while len(eq["bands"]) < band_num:
                eq["bands"].append({"g": 0, "f": 1000, "q": 0.7})
            eq["bands"][band_num - 1][attr] = val
            asyncio.create_task(broadcast({
                "type": "eq_band", "strip": store_key, "ch": n,
                "band": band_num, "attr": attr, "value": val
            }))
        except (ValueError, IndexError):
            pass

def handle_ch_eq(address, *args):   _eq_handler(address, "channels", "ch",   args)
def handle_aux_eq(address, *args):  _eq_handler(address, "aux",      "aux",  args)
def handle_bus_eq(address, *args):  _eq_handler(address, "buses",    "bus",  args)
def handle_main_eq(address, *args): _eq_handler(address, "main",     "main", args)


# ── Dynamics handlers ─────────────────────────────────────────────────────────
# Wing dyn paths: /ch/{n}/dyn/on, /thr, /ratio, /att, /hld, /rel, /gain

def _dyn_handler(address: str, section: str, store_key: str, args):
    parts = address.split("/")
    try:
        n = str(int(parts[2]))
    except (IndexError, ValueError):
        return
    param = parts[4] if len(parts) > 4 else ""
    store = app_state.mixer.get(section, {}).get(n, {})
    dyn   = store.setdefault("dyn", {"on": False})

    def float_val():
        return float(args[0]) if args else 0.0

    updated = True
    if param == "on":
        dyn["on"] = bool(parse_wing_int(args))
    elif param == "thr":
        dyn["thr"] = float_val()
    elif param == "ratio":
        dyn["ratio"] = str(args[0]) if args else "4.0"
    elif param == "att":
        dyn["att"] = float_val()
    elif param in ("rel", "hld"):
        dyn[param] = float_val()
    elif param == "gain":
        dyn["gain"] = float_val()
    elif param == "knee":
        dyn["knee"] = parse_wing_int(args)
    else:
        updated = False

    if updated:
        asyncio.create_task(broadcast({
            "type": "dyn", "strip": store_key, "ch": n, "dyn": dyn
        }))

def handle_ch_dyn(address, *args):   _dyn_handler(address, "channels", "ch",   args)
def handle_aux_dyn(address, *args):  _dyn_handler(address, "aux",      "aux",  args)
def handle_bus_dyn(address, *args):  _dyn_handler(address, "buses",    "bus",  args)
def handle_main_dyn(address, *args): _dyn_handler(address, "main",     "main", args)


# ── Gate handlers ─────────────────────────────────────────────────────────────
# Wing gate paths: /ch/{n}/gate/on, /thr, /range, /att, /hld, /rel

def _gate_handler(address: str, section: str, store_key: str, args):
    parts = address.split("/")
    try:
        n = str(int(parts[2]))
    except (IndexError, ValueError):
        return
    param = parts[4] if len(parts) > 4 else ""
    store = app_state.mixer.get(section, {}).get(n, {})
    gate  = store.setdefault("gate", {"on": False})

    def float_val():
        return float(args[0]) if args else 0.0

    if param == "on":
        gate["on"] = bool(parse_wing_int(args))
    elif param == "thr":
        gate["thr"] = float_val()
    elif param == "range":
        gate["range"] = float_val()
    elif param == "att":
        gate["att"] = float_val()
    elif param in ("rel", "hld"):
        gate[param] = float_val()

    asyncio.create_task(broadcast({
        "type": "gate", "strip": store_key, "ch": n, "gate": gate
    }))

def handle_ch_gate(address, *args):  _gate_handler(address, "channels", "ch",  args)
def handle_aux_gate(address, *args): _gate_handler(address, "aux",      "aux", args)


# ── Bus send handlers ─────────────────────────────────────────────────────────
# Wing send paths: /ch/{n}/send/{b}/lvl, /ch/{n}/send/{b}/on

def _send_handler(address: str, section: str, store_key: str, args):
    """address e.g. /ch/1/send/3/lvl"""
    parts = address.split("/")
    try:
        n     = str(int(parts[2]))   # channel number
        b     = str(int(parts[4]))   # bus number
        param = parts[5]             # lvl or on
    except (IndexError, ValueError):
        return
    store  = app_state.mixer.get(section, {}).get(n, {})
    sends  = store.setdefault("sends", {})
    send_b = sends.setdefault(b, {"on": False, "lvl": 0.75})

    if param == "lvl":
        send_b["lvl"] = parse_wing_float(args)
    elif param == "on":
        send_b["on"] = bool(parse_wing_int(args))

    asyncio.create_task(broadcast({
        "type": "send", "strip": store_key, "ch": n, "bus": b, "send": send_b
    }))

def handle_ch_send(address, *args):  _send_handler(address, "channels", "ch",  args)
def handle_aux_send(address, *args): _send_handler(address, "aux",      "aux", args)


def osc_default_handler(address: str, *args):
    log.debug(f"[OSC unhandled] {address} {args}")


async def start_osc_server():
    try:
        dispatcher = build_dispatcher()
        loop = asyncio.get_event_loop()
        transport = WingOSCTransport(
            WING_IP(), WING_OSC_PORT(), LOCAL_OSC_PORT, dispatcher
        )
        await transport.start(loop)
        app_state.wing_client = transport
        app_state.osc_server  = transport   # kept for shutdown reference
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
        "wing_ip": WING_IP(),
        "wing_port": WING_OSC_PORT(),
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
    import os as _os
    return {
        "connected":        app_state.wing_client is not None,
        "wing_connected":   app_state.wing_connected,
        "recording":        app_state.recording,
        "ws_clients":       len(app_state.ws_clients),
        "wing_ip":          WING_IP(),
        "wing_port":        WING_OSC_PORT(),
        "local_port":       LOCAL_OSC_PORT,
        "sample_rate":      SAMPLE_RATE,
        "bit_depth":        BIT_DEPTH,
        "audio_available":  _os.getenv("AUDIO_AVAILABLE", "0") == "1",
        "dev_snd_present":  Path("/dev/snd").exists() and bool(list(Path("/dev/snd").iterdir())) if Path("/dev/snd").exists() else False,
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
    ip      = payload.get("ip", WING_IP())
    port    = int(payload.get("port", WING_OSC_PORT()))
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

    new_ip   = payload.get("wing_ip", WING_IP())
    new_port = int(payload.get("wing_osc_port", WING_OSC_PORT()))
    try:
        # Update the live Wing target — takes effect immediately, no restart needed
        set_wing_target(new_ip, new_port)
        if app_state.wing_client:
            app_state.wing_client.update_target(new_ip, new_port)
        # Send initial subscription to new endpoint
        app_state.wing_client.send_message(WING_SUBSCRIBE, [])
        # Force probe loop to check connectivity right away
        app_state.wing_connected = False
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

    # Channels 1..40 — core parameters
    for n in range(1, QUERY_CHANNELS + 1):
        queries += [f"/ch/{n}/name", f"/ch/{n}/fdr", f"/ch/{n}/mute",
                    f"/ch/{n}/pan",  f"/ch/{n}/$solo",
                    # EQ
                    f"/ch/{n}/eq/on",
                    f"/ch/{n}/eq/1g", f"/ch/{n}/eq/1f", f"/ch/{n}/eq/1q",
                    f"/ch/{n}/eq/2g", f"/ch/{n}/eq/2f", f"/ch/{n}/eq/2q",
                    f"/ch/{n}/eq/3g", f"/ch/{n}/eq/3f", f"/ch/{n}/eq/3q",
                    f"/ch/{n}/eq/4g", f"/ch/{n}/eq/4f", f"/ch/{n}/eq/4q",
                    # Dynamics
                    f"/ch/{n}/dyn/on",  f"/ch/{n}/dyn/thr", f"/ch/{n}/dyn/ratio",
                    f"/ch/{n}/dyn/att", f"/ch/{n}/dyn/rel",  f"/ch/{n}/dyn/gain",
                    f"/ch/{n}/dyn/knee",
                    # Gate
                    f"/ch/{n}/gate/on",  f"/ch/{n}/gate/thr",   f"/ch/{n}/gate/range",
                    f"/ch/{n}/gate/att", f"/ch/{n}/gate/rel",
                    # Bus sends 1..16
                    *[f"/ch/{n}/send/{b}/lvl" for b in range(1, 17)],
                    *[f"/ch/{n}/send/{b}/on"  for b in range(1, 17)],
                ]

    # Aux inputs 1..8
    for n in range(1, QUERY_AUX + 1):
        queries += [f"/aux/{n}/name", f"/aux/{n}/fdr", f"/aux/{n}/mute",
                    f"/aux/{n}/pan",  f"/aux/{n}/$solo",
                    f"/aux/{n}/eq/on",
                    f"/aux/{n}/eq/1g", f"/aux/{n}/eq/1f", f"/aux/{n}/eq/1q",
                    f"/aux/{n}/eq/2g", f"/aux/{n}/eq/2f", f"/aux/{n}/eq/2q",
                    f"/aux/{n}/eq/3g", f"/aux/{n}/eq/3f", f"/aux/{n}/eq/3q",
                    f"/aux/{n}/eq/4g", f"/aux/{n}/eq/4f", f"/aux/{n}/eq/4q",
                    f"/aux/{n}/dyn/on", f"/aux/{n}/dyn/thr", f"/aux/{n}/dyn/ratio",
                    f"/aux/{n}/dyn/att", f"/aux/{n}/dyn/rel",
                    f"/aux/{n}/gate/on", f"/aux/{n}/gate/thr", f"/aux/{n}/gate/range",
                    f"/aux/{n}/gate/att", f"/aux/{n}/gate/rel",
                    *[f"/aux/{n}/send/{b}/lvl" for b in range(1, 17)],
                    *[f"/aux/{n}/send/{b}/on"  for b in range(1, 17)],
                ]

    # Mix buses 1..16
    for n in range(1, QUERY_BUSES + 1):
        queries += [f"/bus/{n}/name", f"/bus/{n}/fdr", f"/bus/{n}/mute",
                    f"/bus/{n}/pan",  f"/bus/{n}/$solo",
                    f"/bus/{n}/eq/on",
                    f"/bus/{n}/eq/1g", f"/bus/{n}/eq/1f", f"/bus/{n}/eq/1q",
                    f"/bus/{n}/eq/2g", f"/bus/{n}/eq/2f", f"/bus/{n}/eq/2q",
                    f"/bus/{n}/eq/3g", f"/bus/{n}/eq/3f", f"/bus/{n}/eq/3q",
                    f"/bus/{n}/eq/4g", f"/bus/{n}/eq/4f", f"/bus/{n}/eq/4q",
                    f"/bus/{n}/dyn/on", f"/bus/{n}/dyn/thr", f"/bus/{n}/dyn/ratio",
                    f"/bus/{n}/dyn/att", f"/bus/{n}/dyn/rel",
                ]

    # Mains 1..4
    for n in range(1, QUERY_MAINS + 1):
        queries += [f"/main/{n}/name", f"/main/{n}/fdr", f"/main/{n}/mute",
                    f"/main/{n}/pan",  f"/main/{n}/$solo",
                    f"/main/{n}/eq/on",
                    f"/main/{n}/eq/1g", f"/main/{n}/eq/1f", f"/main/{n}/eq/1q",
                    f"/main/{n}/eq/2g", f"/main/{n}/eq/2f", f"/main/{n}/eq/2q",
                    f"/main/{n}/dyn/on", f"/main/{n}/dyn/thr", f"/main/{n}/dyn/ratio",
                    f"/main/{n}/dyn/att", f"/main/{n}/dyn/rel",
                ]

    # Matrix 1..8
    QUERY_MATRIX = 8
    for n in range(1, QUERY_MATRIX + 1):
        queries += [f"/mtx/{n}/name", f"/mtx/{n}/fdr", f"/mtx/{n}/mute",
                    f"/mtx/{n}/pan",  f"/mtx/{n}/$solo"]

    # DCA 1..16
    for n in range(1, QUERY_DCA + 1):
        queries += [f"/dca/{n}/name", f"/dca/{n}/fdr", f"/dca/{n}/mute", f"/dca/{n}/$solo"]

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

METER_UDP_PORT     = int(os.getenv("METER_UDP_PORT", "2225"))  # UDP port Wing sends meter data to
METER_REPORT_ID    = 1             # Arbitrary ID to identify our meter subscription
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


# Strip type tokens and counts — from official Wing V3.1.0 docs Table 4
METER_STRIP_SPECS = [
    # (type_token, count, strip_key)  — order matters: Wing returns in request order
    (0xa0, 40, "ch"),    # channels 1..40
    (0xa1,  8, "aux"),   # aux inputs 1..8
    (0xa2, 16, "bus"),   # mix buses 1..16
    (0xa3,  4, "main"),  # mains 1..4
    (0xa4,  8, "mtx"),   # matrix 1..8
    (0xa5, 16, "dca"),   # DCA groups 1..16
]
# Pre-compute total strip count and ordered metadata for the parser
METER_STRIP_ORDER: list = []   # [(strip_key, 1-based-id), ...]
for _tok, _cnt, _key in METER_STRIP_SPECS:
    for _n in range(1, _cnt + 1):
        METER_STRIP_ORDER.append((_key, _n))
METER_TOTAL_STRIPS = len(METER_STRIP_ORDER)


def _build_meter_request(udp_port: int, report_id: int) -> tuple[bytes, bytes]:
    """
    Build the binary meter subscription for Wing channel 3.

    Returns two packets that must be sent as separate TCP writes, matching
    the two-step sequence in the Wing V3.1.0 protocol docs:
      packet1 — declare the UDP return port
      packet2 — set report ID and define the meter collection

    Wing returns meter data in exactly the order requested.
    """
    select_ch3 = bytes([0xDF, 0xD3])

    # Packet 1: declare UDP return port (token 0xD3 + 2-byte big-endian port)
    port_hi  = (udp_port >> 8) & 0xFF
    port_lo  = udp_port & 0xFF
    port_pkt = select_ch3 + _nrp_escape(bytes([0xD3, port_hi, port_lo]))

    # Packet 2: set report ID (0xD4) + meter collection (0xDC … 0xDE)
    set_id = bytes([0xD4]) + report_id.to_bytes(4, 'big')
    collection = bytearray([0xDC])
    for type_token, count, _ in METER_STRIP_SPECS:
        for idx in range(count):
            collection += bytes([type_token, idx])
    collection += bytes([0xDE])
    coll_pkt = select_ch3 + _nrp_escape(set_id + bytes(collection))

    return port_pkt, coll_pkt


def _build_meter_renew(report_id: int) -> bytes:
    """Renew packet: resend the report_id token to reset the 5 s Wing timeout."""
    select_ch3 = bytes([0xDF, 0xD3])
    id_bytes   = report_id.to_bytes(4, 'big')
    return select_ch3 + _nrp_escape(bytes([0xD4]) + id_bytes)


def _raw_to_level(chunk_bytes: bytes, word_idx: int) -> float:
    """Extract one signed int16 meter word and convert to 0.0-1.0 level."""
    offset  = word_idx * 2
    raw     = int.from_bytes(chunk_bytes[offset:offset+2], 'big', signed=True)
    db      = raw / 256.0
    clamped = max(-60.0, min(0.0, db))
    return round((clamped + 60.0) / 60.0, 4)


# Per-strip word counts from Wing V3.1.0 Table 5.
# channel/aux/bus/main/matrix: 8 words (16 bytes)
# dca: 4 words (8 bytes) — pre/post fader L+R only, no gate/dyn words
METER_WORDS_PER_STRIP = {
    "ch":   8,
    "aux":  8,
    "bus":  8,
    "main": 8,
    "mtx":  8,
    "dca":  4,   # pre-fader L/R, post-fader L/R — no gate/dyn words
}


def _parse_meter_udp(data: bytes) -> dict:
    """
    Parse a Wing meter UDP packet containing all requested strip types.
    Format: 4-byte report_id followed by strips in subscription order.

    Word layout per strip type (signed int16 big-endian, 1/256 dB):
      channel/aux/bus/main/matrix (8 words = 16 bytes):
        0: in_L   1: in_R   2: out_L  3: out_R
        4: gate_key  5: gate_gain  6: dyn_key  7: dyn_gain
      dca (4 words = 8 bytes):
        0: pre_fader_L  1: pre_fader_R  2: post_fader_L  3: post_fader_R

    Returns flat dict keyed by "stripType-id":
      "ch-1"        → 0.0–1.0 output level (VU)
      "ch-1-r"      → 0.0–1.0 right-channel output level
      "ch-1-in"     → 0.0–1.0 input level (pre-fader)
      "ch-1-gate"   → 0 or 1  gate state
      "ch-1-dyn"    → 0 or 1  compressor state
    DCA are omitted from the result (no meaningful audio metering for a VU strip).
    """
    if len(data) < 4:
        return {}

    payload = data[4:]   # skip 4-byte report ID
    offset  = 0
    result  = {}

    for strip_key, strip_num in METER_STRIP_ORDER:
        words = METER_WORDS_PER_STRIP.get(strip_key, 8)
        nbytes = words * 2
        if offset + nbytes > len(payload):
            break
        chunk  = payload[offset : offset + nbytes]
        offset += nbytes

        if strip_key == "dca":
            continue   # no meaningful VU display for DCA groups

        key = f"{strip_key}-{strip_num}"

        # Primary VU: output_L (word 2)
        result[key]         = _raw_to_level(chunk, 2)
        result[f"{key}-r"]  = _raw_to_level(chunk, 3)   # output_R
        result[f"{key}-in"] = _raw_to_level(chunk, 0)   # input_L

        # Gate/dyn state from word 4 and word 6
        gate_raw = int.from_bytes(chunk[8:10],  'big', signed=True)
        dyn_raw  = int.from_bytes(chunk[12:14], 'big', signed=True)
        result[f"{key}-gate"] = 1 if gate_raw > 0 else 0
        result[f"{key}-dyn"]  = 1 if dyn_raw  > 0 else 0

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
                asyncio.open_connection(WING_IP(), WING_BINARY_PORT),
                timeout=5.0
            )
            log.info(f"Meter TCP connected → {WING_IP()}:{WING_BINARY_PORT}")
            backoff = 2.0   # reset backoff on success
        except Exception as e:
            log.warning(f"Meter TCP connect failed ({WING_IP()}:{WING_BINARY_PORT}): {e}")
            udp_sock.close()
            await asyncio.sleep(backoff)
            backoff = min(backoff * 1.5, 30.0)
            continue

        # ── Send initial meter subscription (two writes, matching doc example) ─
        try:
            port_pkt, coll_pkt = _build_meter_request(METER_UDP_PORT, METER_REPORT_ID)
            # Step 1: declare UDP return port
            tcp_writer.write(port_pkt)
            await tcp_writer.drain()
            await asyncio.sleep(0.05)   # brief pause between declarations
            # Step 2: set report ID + collection
            tcp_writer.write(coll_pkt)
            await tcp_writer.drain()
            last_renew = asyncio.get_event_loop().time()
            log.info(
                "Meter subscription sent (%d strips) — port=%d id=%d",
                METER_TOTAL_STRIPS, METER_UDP_PORT, METER_REPORT_ID,
            )
        except Exception as e:
            log.warning(f"Meter subscription send failed: {e}")
            tcp_writer.close()
            udp_sock.close()
            await asyncio.sleep(backoff)
            continue

        # ── Receive meter UDP packets ─────────────────────────────────────
        loop = asyncio.get_event_loop()
        pkt_count      = 0      # total UDP packets received this session
        pkt_log_next   = 10.0  # log first packet count after 10 s
        last_pkt_time  = None
        try:
            while True:
                now = loop.time()

                # Renew subscription before it times out (every 4s)
                if now - last_renew >= METER_RENEW_SEC:
                    renew = _build_meter_renew(METER_REPORT_ID)
                    tcp_writer.write(renew)
                    await tcp_writer.drain()
                    last_renew = now
                    # Warn if we haven't received a single UDP packet since subscribing
                    if pkt_count == 0:
                        log.warning(
                            "Meter: no UDP packets received yet — check Wing OSC/Meter "
                            "settings and that UDP port %d is reachable from Wing",
                            METER_UDP_PORT,
                        )

                # Non-blocking UDP read
                try:
                    data, addr = udp_sock.recvfrom(8192)
                    if data:
                        pkt_count += 1
                        last_pkt_time = now
                        if pkt_count == 1:
                            log.info(
                                "Meter: first UDP packet received from %s (%d bytes) — "
                                "hardware meters now live", addr, len(data)
                            )
                        levels = _parse_meter_udp(data)
                        if levels:
                            _live_meters.update(levels)
                            if app_state.ws_clients:
                                await broadcast({"type": "meters", "levels": levels})
                        elif pkt_count <= 3:
                            log.warning(
                                "Meter: packet %d from %s parsed to empty dict "
                                "(len=%d) — possible format mismatch",
                                pkt_count, addr, len(data)
                            )
                except BlockingIOError:
                    pass  # No data yet — normal
                except Exception as e:
                    log.warning(f"Meter UDP recv error: {e}")

                # Periodic packet-count log so operator can confirm data is flowing
                if now >= pkt_log_next and pkt_count > 0:
                    elapsed = now - (loop.time() - pkt_count * 0.05)  # rough
                    log.info(
                        "Meter: %d UDP packets received this session (last from Wing ~%.1fs ago)",
                        pkt_count, now - last_pkt_time if last_pkt_time else 0,
                    )
                    pkt_log_next = now + 60.0   # log again every 60 s

                await asyncio.sleep(0.025)   # ~40 fps poll rate

        except Exception as e:
            log.warning(f"Meter loop error: {e}")
        finally:
            try: tcp_writer.close()
            except: pass
            try: udp_sock.close()
            except: pass
            log.info(
                "Meter connection lost after %d packets — reconnecting…", pkt_count
            )
            await asyncio.sleep(backoff)
            backoff = min(backoff * 1.5, 30.0)


# Alias so lifespan can call meter_poll_loop (backward compat)
async def meter_poll_loop():
    await meter_engine()


# ── Hook bulk query into lifespan and WebSocket connect ───────────────────────
# (These are registered at the bottom via monkey-patching startup and ws handler)
