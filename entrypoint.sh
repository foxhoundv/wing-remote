#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# WING Remote — entrypoint.sh
# Detects audio hardware at container start and configures access if present.
# Runs before uvicorn so the Python app always starts regardless of whether
# a Wing USB audio device is connected.
# ─────────────────────────────────────────────────────────────────────────────

echo "[entrypoint] Starting WING Remote…"

# ── Audio device detection ────────────────────────────────────────────────────
if [ -d /dev/snd ] && [ "$(ls -A /dev/snd 2>/dev/null)" ]; then
    echo "[entrypoint] /dev/snd detected: $(ls /dev/snd)"
    # Ensure the current user has access to audio devices
    # (privileged mode makes /dev/snd visible; group membership grants rw)
    if getent group audio > /dev/null 2>&1; then
        usermod -aG audio root 2>/dev/null || true
    fi
    # Set permissive mode on sound devices so PortAudio/ALSA can open them
    chmod a+rw /dev/snd/* 2>/dev/null || true
    echo "[entrypoint] Audio devices configured."
    export AUDIO_AVAILABLE=1
else
    echo "[entrypoint] /dev/snd not found — audio recording unavailable."
    echo "[entrypoint] Connect Wing USB cable and restart the container to enable recording."
    export AUDIO_AVAILABLE=0
fi

# ── Broadcast audio status so the app can report it ─────────────────────────
echo "AUDIO_AVAILABLE=${AUDIO_AVAILABLE}" >> /app/.env 2>/dev/null || true

# ── Start the application ─────────────────────────────────────────────────────
exec uvicorn backend.main:app --host 0.0.0.0 --port 8000 --workers 1
