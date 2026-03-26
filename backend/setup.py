"""
WING Remote — Setup & System Configuration Module
Handles auto-detection of audio devices, /dev/snd availability,
docker-compose patching, .env writing, and OSC connectivity testing.

Wing OSC protocol notes (official Patrick-Gilles Maillot documentation):
  - Paths use short names: /ch/1/fdr  (NOT /ch/01/mix/fader — that's X32)
  - Mute:  /ch/1/mute  (NOT /ch/01/mix/on)
  - Probe: send empty OSC message to /  (root node query) — Wing replies with node data
  - Subscription: /#456/*S  sent every <10s enables Wing to push changes back
  - Responses are ,sff (ascii label, raw 0-1 float, dB float) for floats
  - Wing does NOT echo sent UDP messages back to sender
"""

import asyncio
import json
import logging
import os
import re
import shutil
import socket
import struct
import subprocess
import time
from pathlib import Path
from typing import Optional

log = logging.getLogger("wing-remote.setup")

COMPOSE_FILE = Path("/app/docker-compose.yml")
ENV_FILE     = Path("/app/.env")
DEV_SND      = Path("/dev/snd")


# ─────────────────────────────────────────────────────────────────────────────
# OSC packet builder (no external lib needed for probing)
# ─────────────────────────────────────────────────────────────────────────────

def _osc_pad(b: bytes) -> bytes:
    """Pad bytes to next 4-byte boundary with null bytes."""
    rem = len(b) % 4
    return b + (b"\x00" * (4 - rem)) if rem else b + b"\x00\x00\x00\x00"


def build_osc_message(address: str, args: list = None) -> bytes:
    """
    Build a minimal OSC 1.0 message.
    args is a list of (type_char, value) tuples e.g. [('f', 0.75), ('s', 'ON')]
    Empty args = no-argument query (Wing will return current value).
    """
    args = args or []
    addr_bytes = _osc_pad(address.encode("ascii") + b"\x00")
    type_tag   = _osc_pad(b"," + bytes(t for t, _ in args) + b"\x00")
    arg_bytes  = b""
    for t, v in args:
        if t == "f":
            arg_bytes += struct.pack(">f", float(v))
        elif t == "i":
            arg_bytes += struct.pack(">i", int(v))
        elif t == "s":
            arg_bytes += _osc_pad(str(v).encode("ascii") + b"\x00")
    return addr_bytes + type_tag + arg_bytes


def parse_osc_response(data: bytes) -> dict:
    """
    Parse a raw OSC response from the Wing.
    Wing returns ,sff for float params: [label_string, raw_0_to_1, dB_value]
    Returns dict with 'address', 'type_tag', 'args'.
    """
    try:
        # Find address (null-terminated, padded to 4 bytes)
        addr_end = data.index(b"\x00")
        address  = data[:addr_end].decode("ascii", errors="replace")
        # Find type tag (starts with ,)
        tag_start = (addr_end // 4 + 1) * 4
        tag_end   = data.index(b"\x00", tag_start)
        type_tag  = data[tag_start:tag_end].decode("ascii", errors="replace")
        return {"address": address, "type_tag": type_tag, "raw": data}
    except Exception:
        return {"address": "?", "type_tag": "?", "raw": data}


# ─────────────────────────────────────────────────────────────────────────────
# 1. ENVIRONMENT DETECTION
# ─────────────────────────────────────────────────────────────────────────────

def detect_environment() -> dict:
    result = {
        "platform":               _detect_platform(),
        "dev_snd_exists":         DEV_SND.exists() and bool(list(DEV_SND.iterdir())) if DEV_SND.exists() else False,
        "dev_snd_devices":        _list_snd_devices(),
        "audio_devices":          _probe_audio_devices(),
        "docker_socket":          Path("/var/run/docker.sock").exists(),
        "compose_path":           str(COMPOSE_FILE) if COMPOSE_FILE.exists() else None,
        "env_path":               str(ENV_FILE) if ENV_FILE.exists() else None,
        "current_env":            _read_env(),
        "audio_group":            _check_audio_group(),
        "compose_audio_enabled":  _compose_audio_enabled(),
    }
    log.info(f"Environment detected: platform={result['platform']}, "
             f"dev_snd={result['dev_snd_exists']}, "
             f"audio_devices={len(result['audio_devices'])}")
    return result


def _detect_platform() -> str:
    try:
        with open("/proc/version") as f:
            v = f.read().lower()
        if "microsoft" in v or "wsl" in v:
            return "wsl"
    except Exception:
        pass
    try:
        with open("/proc/1/cgroup") as f:
            cg = f.read()
        if "docker" in cg or "containerd" in cg:
            hostname = socket.gethostname()
            if "docker-desktop" in hostname.lower():
                return "docker-desktop-mac"
    except Exception:
        pass
    return "linux"


def _list_snd_devices() -> list:
    if not DEV_SND.exists():
        return []
    try:
        return [d.name for d in DEV_SND.iterdir()]
    except Exception:
        return []


def _probe_audio_devices() -> list:
    try:
        import sounddevice as sd
        devices = sd.query_devices()
        return [
            {
                "index":        i,
                "name":         d["name"],
                "max_input_ch": d["max_input_channels"],
                "default_sr":   int(d["default_samplerate"]),
                "is_input":     d["max_input_channels"] > 0,
            }
            for i, d in enumerate(devices)
            if d["max_input_channels"] > 0
        ]
    except Exception as e:
        log.warning(f"sounddevice probe failed: {e}")
        return []


def _check_audio_group() -> bool:
    try:
        import grp
        groups = os.getgroups()
        try:
            audio_gid = grp.getgrnam("audio").gr_gid
            return audio_gid in groups
        except KeyError:
            return False
    except Exception:
        return False


def _read_env() -> dict:
    env = {}
    if not ENV_FILE.exists():
        return env
    try:
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip()
    except Exception:
        pass
    return env


def _compose_audio_enabled() -> bool:
    """Returns True if audio passthrough is enabled (AUDIO_AVAILABLE=1 in .env)."""
    try:
        env = _read_env()
        return env.get("AUDIO_AVAILABLE", "0") == "1"
    except Exception:
        return False


# ─────────────────────────────────────────────────────────────────────────────
# 2. OSC CONNECTIVITY TEST  (Wing-correct protocol)
# ─────────────────────────────────────────────────────────────────────────────

async def test_osc_connection(ip: str, port: int, timeout: float = 3.0) -> dict:
    """
    Test OSC connectivity to a Behringer Wing.

    Per official V3.1.0 docs:
      - Wing OSC port is always 2223
      - Probe: /? (4 bytes) → Wing replies with console info string
        "WING,<ip>,PGM,<build>,<serial>,<fw_version>"
      - Fallback: /ch/1/fdr query → Wing replies ,sff (label, raw, dB)
    """
    # Primary probe: /? — documented Wing console info request
    probe = build_osc_message("/?")
    response = await _udp_send_recv(ip, port, probe, timeout)

    if response:
        try:
            text = response.decode("ascii", errors="replace")
            info = ""
            if "WING" in text:
                start = text.index("WING")
                info  = text[start:start+80].split("\x00")[0]
            return {
                "success":        True,
                "reachable":      True,
                "message":        f"Wing responded at {ip}:{port} ✓  — {info or 'console info received'}",
                "response_bytes": len(response),
                "console_info":   info,
            }
        except Exception:
            return {
                "success":        True,
                "reachable":      True,
                "message":        f"Wing responded at {ip}:{port} ✓  ({len(response)} bytes)",
                "response_bytes": len(response),
            }

    # Fallback: query /ch/1/fdr
    fdr      = build_osc_message("/ch/1/fdr")
    response = await _udp_send_recv(ip, port, fdr, timeout)

    if response:
        parsed = parse_osc_response(response)
        return {
            "success":        True,
            "reachable":      True,
            "message":        f"Wing responded at {ip}:{port} ✓  (fader query: {parsed['type_tag']})",
            "response_bytes": len(response),
        }

    # UDP reachability check
    reachable = await _udp_probe(ip, port, timeout * 0.5)

    if not reachable:
        return {
            "success":   False,
            "reachable": False,
            "message": (
                f"Cannot reach {ip}:{port}. Check the Wing IP address "
                f"and that both devices are on the same network. "
                f"Wing OSC always uses port 2223."
            ),
        }

    return {
        "success":   False,
        "reachable": True,
        "message": (
            f"Reached {ip}:{port} but Wing did not respond to OSC. "
            f"On the Wing: SETUP → Network → Remote Control → enable OSC."
        ),
        "hint": (
            "1. SETUP → Network on Wing → enable OSC.\n"
            "2. Wing OSC port is fixed at 2223.\n"
            "3. Ensure UDP 2223 is not blocked by a firewall."
        ),
    }


async def _udp_probe(ip: str, port: int, timeout: float) -> bool:
    """Send a tiny UDP packet and wait briefly — if we don't get ICMP unreachable we assume reachable."""
    try:
        loop = asyncio.get_event_loop()

        class _Probe(asyncio.DatagramProtocol):
            def __init__(self):
                self.received = False
            def connection_made(self, t):
                # Send a harmless 4-byte packet
                t.sendto(b"\x00\x00\x00\x00")
            def datagram_received(self, data, addr):
                self.received = True
            def error_received(self, exc):
                pass

        p = _Probe()
        transport, _ = await loop.create_datagram_endpoint(
            lambda: p, remote_addr=(ip, port)
        )
        await asyncio.sleep(min(timeout * 0.4, 1.0))
        transport.close()
        # If no ICMP error raised by this point, the host is likely reachable
        return True
    except OSError:
        return False
    except Exception:
        return False


async def _udp_send_recv(ip: str, port: int, packet: bytes, timeout: float) -> Optional[bytes]:
    """Send a UDP packet and wait for a response."""
    loop = asyncio.get_event_loop()
    received: list = []

    class _Proto(asyncio.DatagramProtocol):
        def connection_made(self, t):
            t.sendto(packet)
        def datagram_received(self, data, addr):
            received.append(data)
        def error_received(self, exc):
            pass

    try:
        transport, _ = await loop.create_datagram_endpoint(
            lambda: _Proto(), remote_addr=(ip, port)
        )
        await asyncio.sleep(timeout)
        transport.close()
        return received[0] if received else None
    except Exception as e:
        log.warning(f"UDP send/recv error: {e}")
        return None


# ─────────────────────────────────────────────────────────────────────────────
# 3. APPLY CONFIGURATION
# ─────────────────────────────────────────────────────────────────────────────

def apply_env_config(config: dict) -> dict:
    keys_to_write = {
        "WING_IP":          config.get("wing_ip", "192.168.1.100"),
        "WING_OSC_PORT":    str(config.get("wing_osc_port", 2222)),
        "LOCAL_OSC_PORT":   str(config.get("local_osc_port", 2223)),
        "SAMPLE_RATE":      str(config.get("sample_rate", 48000)),
        "BIT_DEPTH":        str(config.get("bit_depth", 32)),
        "RECORD_CHANNELS":  str(config.get("record_channels", 32)),
    }
    try:
        existing_lines = ENV_FILE.read_text().splitlines() if ENV_FILE.exists() else []
        updated_keys   = set()
        new_lines      = []

        for line in existing_lines:
            stripped = line.strip()
            if stripped.startswith("#") or "=" not in stripped:
                new_lines.append(line)
                continue
            k = stripped.split("=", 1)[0].strip()
            if k in keys_to_write:
                new_lines.append(f"{k}={keys_to_write[k]}")
                updated_keys.add(k)
            else:
                new_lines.append(line)

        for k, v in keys_to_write.items():
            if k not in updated_keys:
                new_lines.append(f"{k}={v}")

        ENV_FILE.write_text("\n".join(new_lines) + "\n")
        log.info(f"Wrote .env: {keys_to_write}")
        return {"success": True, "written": keys_to_write}
    except Exception as e:
        log.error(f"Failed to write .env: {e}")
        return {"success": False, "message": str(e)}


def apply_audio_passthrough(enable: bool) -> dict:
    """
    Configure audio passthrough preference.

    Audio device access is now handled at runtime by entrypoint.sh using
    privileged mode — the container detects /dev/snd at startup automatically.
    This function records the user's preference in .env (AUDIO_AVAILABLE) and
    returns restart_required=False since no docker-compose.yml change is needed.

    The old approach of commenting/uncommenting a devices: block in
    docker-compose.yml caused "no such file or directory" errors on hosts where
    /dev/snd doesn't exist at compose-up time. privileged: true avoids this.
    """
    try:
        # Write preference to .env so the app knows intent
        env_lines = ENV_FILE.read_text().splitlines() if ENV_FILE.exists() else []
        new_lines = [l for l in env_lines if not l.startswith("AUDIO_AVAILABLE=")]
        new_lines.append(f"AUDIO_AVAILABLE={'1' if enable else '0'}")
        ENV_FILE.write_text("\n".join(new_lines) + "\n")
        log.info(f"Audio passthrough preference set to: {enable}")
        return {
            "success": True,
            "changed": True,
            "enabled": enable,
            # No restart needed — entrypoint.sh detects /dev/snd at runtime
            "restart_required": False,
            "message": (
                "Audio passthrough is now handled automatically at container startup. "
                "Connect the Wing USB cable and run: docker compose restart wing-remote"
                if enable else
                "Audio recording disabled."
            ),
        }
    except Exception as e:
        log.error(f"Failed to set audio passthrough preference: {e}")
        return {"success": False, "message": str(e)}


def trigger_container_restart() -> dict:
    try:
        hostname = socket.gethostname()
        result   = subprocess.run(
            ["docker", "restart", hostname],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            return {"success": True, "message": "Container restart initiated."}
        return {
            "success": False,
            "message": result.stderr.strip() or "docker restart failed",
            "hint":    "Run: docker compose restart wing-remote  from your host terminal.",
        }
    except FileNotFoundError:
        return {
            "success": False,
            "message": "docker CLI not available inside container.",
            "hint":    "Run: docker compose restart wing-remote  from your host terminal.",
        }
    except Exception as e:
        return {"success": False, "message": str(e)}
