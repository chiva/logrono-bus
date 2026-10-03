# Task runner. `just` lists every recipe; `just ci` runs what CI runs.
# Install the toolchain once with `just setup` (needs uv and Node 24 with corepack).

set shell := ["bash", "-euo", "pipefail", "-c"]

web := "web"
pwa := "web/apps/pwa"

# List recipes
default:
    @just --list

# Install Python and web dependencies, the pre-commit hooks and the e2e browser
setup:
    uv sync
    corepack enable
    pnpm --dir {{web}} install --frozen-lockfile
    pnpm --dir {{pwa}} exec playwright install chromium
    uv run pre-commit install

# Lint and check formatting (Python, web, YAML)
lint:
    uv run ruff check .
    uv run ruff format --check .
    uv run yamllint .
    pnpm --dir {{web}} lint
    pnpm --dir {{web}} format:check

# Format everything in place
fmt:
    uv run ruff check --fix .
    uv run ruff format .
    pnpm --dir {{web}} format

# Static types (mypy strict, tsc)
typecheck:
    uv run mypy
    pnpm --dir {{web}} typecheck

# Unit, contract and service tests with coverage gates
test:
    uv run pytest --cov
    pnpm --dir {{web}} test:coverage

# Contract tests against the real Ayuntamiento API (a few requests; needs internet)
test-live:
    uv run pytest -m live -v

# Rewrite contracts/fixtures/expected from the Python normaliser (review the diff afterwards)
golden:
    uv run pytest packages/logrono-bus/tests/test_contract.py --update-golden -q

# Regenerate the OpenAPI contract and the TypeScript types derived from it
gen:
    uv run logrono-bus-api openapi > contracts/openapi.json
    pnpm --dir {{web}} gen:types

# Fail if generated files are out of date (CI)
gen-check: gen
    git diff --exit-code -- contracts/openapi.json web/packages/core/src/types.gen.ts

# Web app with hot reload at http://localhost:5173
web-dev:
    pnpm --dir {{web}} dev

# The API (and the built web, if present) at http://localhost:8000
api-dev:
    LOGRONO_BUS_LOG_FORMAT=text uv run logrono-bus-api

# Production build of the web app
build:
    pnpm --dir {{web}} build

# Browser tests: desktop, mobile, Echo Show, Portal (builds first)
e2e: build
    pnpm --dir {{pwa}} e2e

# Regenerate the guide's screenshots in docs/guia/img
screenshots: build
    pnpm --dir {{pwa}} screenshots

# Build the Home Assistant dashboard card and copy it into the sibling ha-logrono-bus checkout
ha-card:
    pnpm --dir {{web}} --filter @logrono-bus/ha-card build
    cp web/packages/ha-card/dist/logrono-bus-card.js ../ha-logrono-bus/custom_components/logrono_bus/frontend/logrono-bus-card.js

# Re-render the PWA icons from web/apps/pwa/public/icon.svg
icons:
    pnpm --dir {{pwa}} icons

# Documentation site with live reload at http://localhost:8001
docs:
    uv run mkdocs serve -a localhost:8001

# Build the docs strictly (broken links fail)
docs-build:
    uv run mkdocs build --strict

# Build the container image locally
image:
    docker build -f docker/Dockerfile -t logrono-bus:dev .

# Everything CI checks, in order
ci: lint typecheck test gen-check docs-build e2e
