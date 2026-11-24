#!/usr/bin/env bash
# Builds everything, packages Veyra.app and replaces the installed copy in /Applications.
set -euo pipefail

cd "$(dirname "$0")/.."

APP_SRC="packages/desktop/release/mac-arm64/Veyra.app"
APP_DST="/Applications/Veyra.app"

echo "▸ Installing dependencies"
pnpm install

echo "▸ Building all packages (core, server, cli, web, desktop)"
pnpm build

echo "▸ Packaging Veyra.app (arm64)"
pnpm package:mac

if [ ! -d "$APP_SRC" ]; then
  echo "Packaged app not found at $APP_SRC" >&2
  exit 1
fi

echo "▸ Quitting running Veyra"
osascript -e 'tell application "Veyra" to quit' >/dev/null 2>&1 || true
for _ in $(seq 1 20); do
  pgrep -x Veyra >/dev/null || break
  sleep 0.5
done
pkill -x Veyra >/dev/null 2>&1 || true

echo "▸ Replacing $APP_DST"
rm -rf "$APP_DST"
ditto "$APP_SRC" "$APP_DST"
xattr -cr "$APP_DST" 2>/dev/null || true

# The hook listener (veyra hook listen) runs from packages/cli/dist, so restart it to pick up the new build.
if launchctl list 2>/dev/null | grep -q "com.veyra.hook-listener"; then
  echo "▸ Restarting hook listener"
  launchctl kickstart -k "gui/$(id -u)/com.veyra.hook-listener" || true
fi

echo "▸ Starting Veyra"
open "$APP_DST"
echo "✓ Veyra is up to date"
