# syntax=docker/dockerfile:1
# awdio: one container serving the API and the built web app on :8000.
# Data (uploads, parsed documents, audio cache, SQLite and the Kokoro weights) lives in the /data volume.

FROM node:20-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.12-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app/server
COPY server/pyproject.toml server/uv.lock server/README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY server/awdio ./awdio
RUN uv sync --frozen --no-dev
COPY --from=web /app/web/dist /app/web/dist

ENV PATH=/app/server/.venv/bin:$PATH \
    AWDIO_DATA_DIR=/data \
    HF_HOME=/data/huggingface \
    HF_HUB_DISABLE_TELEMETRY=1 \
    AWDIO_HOST=0.0.0.0 \
    AWDIO_PORT=8000
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/config')"
CMD ["python", "-m", "awdio"]
