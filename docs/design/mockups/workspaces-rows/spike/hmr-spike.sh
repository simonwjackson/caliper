#!/usr/bin/env -S nix shell nixpkgs#bash nixpkgs#curl nixpkgs#coreutils nixpkgs#gnugrep --command bash
# Spike for workspaces slice 2: does Vite's watcher see an edit to a row file
# in .caliper/workspaces/<id>/rows/? Run overlay-spike.sh first; it makes /tmp/s2-pico.
# Usage: hmr-spike.sh <port>
set -euo pipefail
PORT=${1:-5402}
DST=/tmp/s2-pico
NODE=/nix/store/gi0p7azcixb20pddx39k5mwnkj6xl4bz-nodejs-22.22.1/bin/node
ROW="$DST/.caliper/workspaces/1/rows/home-dpad.part.tsx"

export CALIPER_REGISTRY=$(mktemp -d)
cd "$DST"
"$NODE" node_modules/.bin/vite --port "$PORT" --host 127.0.0.1 --strictPort --debug hmr > /tmp/s2-spike/vite-hmr.log 2>&1 &
VITE=$!
trap 'kill $VITE 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$PORT/" > /dev/null && break; sleep 0.5; done
curl -s "http://127.0.0.1:$PORT/.caliper/workspaces/1/rows/home-dpad.part.tsx?take=1" > /dev/null
curl -s "http://127.0.0.1:$PORT/.caliper/workspaces/1/rows/home-dpad.part.tsx" > /dev/null
sleep 1
echo "// edited $(date +%s)" >> "$ROW"
sleep 3
echo "== Vite's log after the edit"
grep -i "hmr\|reload\|home-dpad" /tmp/s2-spike/vite-hmr.log | tail -8 || echo "nothing about the row"
