#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
for tool in node npm pnpm uv; do
  command -v "$tool" >/dev/null || { echo "Missing tool: $tool" >&2; exit 1; }
done
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major !== 22 || minor < 12) { console.error("Use Node 22.22.1 (supported: >=22.12 <23)"); process.exit(1); }'
if [[ "$(pnpm --version)" != "11.25.0" ]]; then
  echo 'Use pnpm 11.25.0 for the Lunhui workspace.' >&2
  exit 1
fi
download() {
  if command -v get-dep >/dev/null; then get-dep "$@"; else "$@"; fi
}
download uv sync --locked --python 3.12 --default-index https://pypi.org/simple
download npm ci
(cd integrations/lunhui/lunhui-engine && download pnpm install --frozen-lockfile)
