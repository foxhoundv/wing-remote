# ─────────────────────────────────────────────────────────────────────────────
# WING Remote — Production Dockerfile
# Multi-stage build: lean runtime, optimized for caching and security
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libportaudio2 \
    libportaudiocpp0 \
    portaudio19-dev \
    libsndfile1 \
    libsndfile1-dev

COPY backend/requirements.txt .

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir --prefix=/install -r requirements.txt


# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM python:3.12-slim

LABEL maintainer="WING Remote"
LABEL description="Behringer Wing OSC remote control + multitrack recording server"
LABEL version="1.0"

# Install runtime dependencies and Docker CLI in one layer
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    libportaudio2 \
    libsndfile1 \
    alsa-utils \
    ca-certificates \
    curl \
    gnupg \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
       https://download.docker.com/linux/debian bookworm stable" \
       > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli

# Copy Python packages from builder
COPY --from=builder /install /usr/local

# Create persistent data directories early (owned by root, writable by app)
RUN mkdir -p /recordings /snapshots && chmod 777 /recordings /snapshots

WORKDIR /app

# Copy application source (stable layer, rarely changes)
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Production environment defaults (override via .env in docker-compose)
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    WING_IP=192.168.1.100 \
    WING_OSC_PORT=2223 \
    LOCAL_OSC_PORT=2224 \
    SAMPLE_RATE=48000 \
    BIT_DEPTH=32 \
    RECORD_CHANNELS=32 \
    RECORDINGS_DIR=/recordings

EXPOSE 8000 2224/udp

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/status')" || exit 1

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
