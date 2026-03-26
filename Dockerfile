# ─────────────────────────────────────────────────────────────────────────────
# WING Remote — Dockerfile
# Multi-stage build keeps the final image lean.
# Audio device access is handled at runtime by entrypoint.sh — no devices:
# block needed in docker-compose.yml, so the container always starts cleanly
# whether or not a Wing USB cable is connected.
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Build / dependency install ──────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libportaudio2 \
    libportaudiocpp0 \
    portaudio19-dev \
    libsndfile1 \
    libsndfile1-dev \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --upgrade pip \
 && pip install --no-cache-dir --prefix=/install -r requirements.txt


# ── Stage 2: Runtime image ────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

LABEL maintainer="WING Remote"
LABEL description="Behringer Wing OSC remote control + multitrack recording server"

# Runtime audio libraries + docker CLI for Setup Wizard auto-restart
# Also install util-linux for usermod (used by entrypoint.sh)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libportaudio2 \
    libsndfile1 \
    alsa-utils \
    passwd \
    curl \
    ca-certificates \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
       https://download.docker.com/linux/debian bookworm stable" \
       > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli \
    && rm -rf /var/lib/apt/lists/*

# Copy installed Python packages from builder
COPY --from=builder /install /usr/local

WORKDIR /app

# Copy application source and entrypoint
COPY backend/      ./backend/
COPY frontend/     ./frontend/
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Create persistent data directories
RUN mkdir -p /recordings /snapshots

# ── Environment defaults (all overridden by .env via docker-compose) ──────────
ENV WING_IP=192.168.1.100
ENV WING_OSC_PORT=2223
ENV LOCAL_OSC_PORT=2224
ENV METER_UDP_PORT=2225
ENV SAMPLE_RATE=48000
ENV BIT_DEPTH=32
ENV RECORD_CHANNELS=32
ENV RECORDINGS_DIR=/recordings
ENV AUDIO_AVAILABLE=0

# HTTP (web UI + REST + WebSocket)
EXPOSE 8000
# Local OSC receive port
EXPOSE 2224/udp
# Meter UDP receive port
EXPOSE 2225/udp

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/status')" || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
