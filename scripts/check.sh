#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
uv run --locked pytest
uv run --locked ruff check code
npm run app:test
npm run engine:check
npm run engine:build
