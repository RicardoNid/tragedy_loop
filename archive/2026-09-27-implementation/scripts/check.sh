#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm baseline
uv run --locked tragedy-sources
uv run --locked pytest
uv run --locked ruff check python
pnpm format:check
pnpm typecheck
pnpm test
pnpm atlas:build
pnpm build
