#!/usr/bin/env -S nix shell nixpkgs#bash nixpkgs#curl nixpkgs#rsync nixpkgs#coreutils nixpkgs#gnugrep --command bash
# Spike for workspaces slice 2: does a part file inside .caliper/workspaces/<id>/rows/
# load through Vite, and does the take overlay tag its imports?
# Usage: overlay-spike.sh <port>
set -euo pipefail
PORT=${1:-5401}
SRC=~/code/sandbox/korri/surfaces/pico
DST=/tmp/s2-pico
NODE=/nix/store/gi0p7azcixb20pddx39k5mwnkj6xl4bz-nodejs-22.22.1/bin/node

rm -rf "$DST"
mkdir -p "$DST"
rsync -a --exclude node_modules --exclude .caliper "$SRC"/ "$DST"/
ln -s "$SRC/node_modules" "$DST/node_modules"
mkdir -p "$DST/.caliper/takes"
cp -r "$SRC/.caliper/takes/1" "$SRC/.caliper/takes/1.json" "$DST/.caliper/takes/"
mkdir -p "$DST/.caliper/workspaces/1/rows"
cat > "$DST/.caliper/workspaces/1/rows/home-dpad.part.tsx" <<'EOF'
import Home from "/src/pages/PicoHome.page.part.tsx"
import { PicoHome } from "../../../../src/pages/PicoHome"

export const name = "Home, by d-pad"
export default function HomeByDpad() { return <Home /> }
export function Relative() { return <PicoHome clockLabel="1" onChooseLocation={() => undefined} onDismiss={() => undefined} mode="shelf" onOpenGame={() => undefined} onRetry={() => undefined} view={{ _tag: "Shelf", games: [] }} /> }
EOF

export CALIPER_REGISTRY=$(mktemp -d)
cd "$DST"
"$NODE" node_modules/.bin/vite --port "$PORT" --host 127.0.0.1 --strictPort > /tmp/s2-spike/vite.log 2>&1 &
VITE=$!
trap 'kill $VITE 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$PORT/" > /dev/null && break; sleep 0.5; done

ROW="/.caliper/workspaces/1/rows/home-dpad.part.tsx"
echo "== row, no take: imports"
curl -s "http://127.0.0.1:$PORT$ROW" | grep -o 'from "[^"]*"' | head -5
echo "== row, take 1: imports"
curl -s "http://127.0.0.1:$PORT$ROW?take=1" | grep -o 'from "[^"]*"' | head -5
PAGE=$(curl -s "http://127.0.0.1:$PORT$ROW?take=1" | grep -o 'from "[^"]*PicoHome.page.part.tsx[^"]*"' | head -1 | sed 's/from "//; s/"$//')
echo "== page module as the row imports it in take 1: $PAGE"
HOME_URL=$(curl -s "http://127.0.0.1:$PORT$PAGE" | grep -o 'from "[^"]*PicoHome.tsx[^"]*"' | head -1 | sed 's/from "//; s/"$//')
echo "   it imports: $HOME_URL"
echo "== PicoHome.tsx: real vs take copy vs what take 1 serves (line counts)"
wc -l < "$DST/src/pages/PicoHome.tsx"
wc -l < "$DST/.caliper/takes/1/src/pages/PicoHome.tsx"
diff <(curl -s "http://127.0.0.1:$PORT$HOME_URL" | head -c 400000 | wc -l) <(echo) > /dev/null || true
curl -s "http://127.0.0.1:$PORT$HOME_URL" | grep -c "" || true
echo "== does the take's served PicoHome differ from the real served one?"
REAL=$(curl -s "http://127.0.0.1:$PORT/src/pages/PicoHome.tsx" | sha256sum | cut -c1-12)
TAKE=$(curl -s "http://127.0.0.1:$PORT$HOME_URL" | sha256sum | cut -c1-12)
echo "real=$REAL take=$TAKE"
echo "== frame route for the row (expect a refusal today)"
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:$PORT/__caliper/frame?part=.caliper/workspaces/1/rows/home-dpad.part.tsx&state=default"
echo "== project.json lists the row as a part?"
curl -s "http://127.0.0.1:$PORT/__caliper/project.json" | grep -o '"file":"[^"]*workspaces[^"]*"' || echo "not listed"
