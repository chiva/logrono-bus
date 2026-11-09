# logrono-bus: the API (cache shared by every screen in the house) plus the web app, in one image.
# Build from the repository root:  docker build -f docker/Dockerfile -t logrono-bus .

# --- Web app ------------------------------------------------------------------------------------
# $BUILDPLATFORM: the bundle is architecture-independent, so never build it under QEMU.
FROM --platform=$BUILDPLATFORM node:24-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS web
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /build/web
# Manifests first so the dependency layer is cached until a lockfile changes.
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
COPY web/packages/core/package.json packages/core/package.json
COPY web/packages/board/package.json packages/board/package.json
COPY web/apps/pwa/package.json apps/pwa/package.json
RUN pnpm install --frozen-lockfile --filter @logrono-bus/pwa...
COPY web/ ./
RUN pnpm --filter @logrono-bus/pwa build

# --- Python environment ---------------------------------------------------------------------------
FROM ghcr.io/astral-sh/uv:python3.13-trixie-slim@sha256:6ff812e34a0e14b4b8bc9ddf25e77b3e16bac6e0c4d9b67641f40366fa382d4c AS builder
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY packages/logrono-bus packages/logrono-bus
COPY services/api services/api
# Only the service and its runtime dependencies: no dev groups, no editable installs.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-default-groups --no-editable --package logrono-bus-api

# --- Runtime --------------------------------------------------------------------------------------
# Same Debian release (trixie) and Python minor as the builder: the venv is built against it.
FROM python:3.13-slim-trixie@sha256:2d44738ebf4ce5f63b9d9ea871e9c7cfdc0426f7b0c97cac915fd88ded1d86bb

ARG VERSION=dev
LABEL org.opencontainers.image.title="logrono-bus" \
      org.opencontainers.image.description="Estimaciones de paso de los autobuses de Logroño: API con caché y web" \
      org.opencontainers.image.source="https://github.com/chiva/logrono-bus" \
      org.opencontainers.image.documentation="https://chiva.github.io/logrono-bus/guia/" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}"

RUN groupadd --gid 1000 app \
 && useradd --uid 1000 --gid app --no-create-home --shell /usr/sbin/nologin app

COPY --from=builder /app/.venv /app/.venv
COPY --from=web /build/web/apps/pwa/dist /app/web

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    LOGRONO_BUS_WEB_DIR=/app/web \
    LOGRONO_BUS_PORT=8000

# Nothing is written at runtime: the service keeps its cache in memory.
USER 1000:1000
EXPOSE 8000

# /livez, not /readyz: if the Ayuntamiento's service is down the container is still healthy (it
# serves cached data and explains the outage); restarting it would only lose that cache.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/livez', timeout=4)"]

# One process on purpose: cache, single-flight and the upstream rate limit are per process.
CMD ["logrono-bus-api"]
