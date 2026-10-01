#!/usr/bin/env -S nix shell nixpkgs#bash nixpkgs#curl nixpkgs#rsync nixpkgs#coreutils nixpkgs#gnugrep nixpkgs#jq --command bash
# Spike for workspaces slice 2: run a d-pad row's authored checks against
# Today and Pico's three ideas (takes 5 to 7), in a korri-shaped copy in /tmp.
# The row is a plain part file here; the frame route cannot serve a row file yet.
# Usage: check-spike.sh <port>
set -euo pipefail
PORT=${1:-5403}
KORRI=~/code/sandbox/korri
TREE=/tmp/s2-korri
PICO=$TREE/surfaces/pico
CALIPER=~/code/github/simonwjackson/caliper
NODE=/nix/store/gi0p7azcixb20pddx39k5mwnkj6xl4bz-nodejs-22.22.1/bin/node

rm -rf "$TREE"
mkdir -p "$PICO" "$TREE/clients/portal/src" "$TREE/contracts"
rsync -a --exclude node_modules --exclude .caliper "$KORRI/surfaces/pico/" "$PICO/"
ln -s "$KORRI/surfaces/pico/node_modules" "$PICO/node_modules"
rsync -a "$KORRI/clients/portal/src/input" "$TREE/clients/portal/src/"
rsync -a "$KORRI/contracts/surface" "$TREE/contracts/"
mkdir -p "$PICO/.caliper/takes" "$PICO/src/workspace-rows"
for n in 5 6 7; do cp -r "$KORRI/surfaces/pico/.caliper/takes/$n" "$KORRI/surfaces/pico/.caliper/takes/$n.json" "$PICO/.caliper/takes/"; done
cp /tmp/s2-spike/HomeByDpad.part.tsx "$PICO/src/workspace-rows/HomeByDpad.part.tsx"

export CALIPER_REGISTRY=$(mktemp -d)
cd "$PICO"
"$NODE" node_modules/.bin/vite --port "$PORT" --host 127.0.0.1 --strictPort > /tmp/s2-spike/vite-check.log 2>&1 &
VITE=$!
trap 'kill $VITE 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$PORT/" > /dev/null && break; sleep 0.5; done

echo "== portal input module served? (403 means fs.allow refuses it)"
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:$PORT/src/workspace-rows/HomeByDpad.part.tsx"
curl -s "http://127.0.0.1:$PORT/src/workspace-rows/HomeByDpad.part.tsx" | grep -o 'from "[^"]*portal[^"]*"' | head -3
BUS=$(curl -s "http://127.0.0.1:$PORT/src/workspace-rows/HomeByDpad.part.tsx" | grep -o 'from "[^"]*bus[^"]*"' | head -1 | sed 's/from "//; s/"$//')
curl -s -o /dev/null -w "bus module: %{http_code}\n" "http://127.0.0.1:$PORT$BUS"

cd "$CALIPER"
for column in today 5 6 7; do
  OUT=/tmp/s2-spike/out-$column
  rm -rf "$OUT"
  TAKE=()
  [ "$column" != today ] && TAKE=(--take "$column")
  echo "== $column"
  nix develop -c node bin/caliper-render.mjs --url "http://127.0.0.1:$PORT" --part src/workspace-rows/HomeByDpad.part.tsx --device rg353m --check --out "$OUT" "${TAKE[@]}" > "$OUT.log" 2>&1 || echo "caliper-render exited $?"
  REPORT=$(find "$OUT" -name report.json | head -1)
  if [ -z "$REPORT" ]; then tail -5 "$OUT.log"; continue; fi
  jq -c '.results[] | {frame: .frame, authored: .authored.status, checks: [.authored.checks[] | {name, status, reason, detail: (.detail[0:160]), ms: .durationMs}]}' "$REPORT"
done
