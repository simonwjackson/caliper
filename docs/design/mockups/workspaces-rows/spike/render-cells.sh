#!/usr/bin/env -S nix shell nixpkgs#bash nixpkgs#curl nixpkgs#coreutils nixpkgs#imagemagick --command bash
# Render the cells of Pico's workspace 1 for the slice 2 mockup: three pinned
# states and the d-pad row, in Today and in ideas 5 to 7, on the RG353M.
# Needs the tree that check-spike.sh made in /tmp/s2-korri.
# Usage: render-cells.sh <port>
set -euo pipefail
PORT=${1:-5405}
PICO=/tmp/s2-korri/surfaces/pico
CALIPER=~/code/github/simonwjackson/caliper
NODE=/nix/store/gi0p7azcixb20pddx39k5mwnkj6xl4bz-nodejs-22.22.1/bin/node
OUT=/tmp/s2-spike/cells
rm -rf "$OUT"; mkdir -p "$OUT"

export CALIPER_REGISTRY=$(mktemp -d)
cd "$PICO"
"$NODE" node_modules/.bin/vite --port "$PORT" --host 127.0.0.1 --strictPort > /tmp/s2-spike/vite-cells.log 2>&1 &
VITE=$!
trap 'kill $VITE 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$PORT/" > /dev/null && break; sleep 0.5; done

cd "$CALIPER"
declare -A ROWS=([home]=src/pages/PicoHome.page.part.tsx [find]=src/pages/PicoLibrary.page.part.tsx [settings]=src/pages/PicoSettings.page.part.tsx [dpad]=src/workspace-rows/HomeByDpad.part.tsx)
for column in today 5 6 7; do
  TAKE=()
  [ "$column" != today ] && TAKE=(--take "$column")
  for row in "${!ROWS[@]}"; do
    DIR="$OUT/raw-$column-$row"
    nix develop -c node bin/caliper-render.mjs --url "http://127.0.0.1:$PORT" --part "${ROWS[$row]}" --device rg353m --out "$DIR" "${TAKE[@]}" > "$DIR.log" 2>&1 || { echo "render failed: $column $row"; tail -3 "$DIR.log"; continue; }
    PNG=$(find "$DIR" -name "*.png" | head -1)
    mkdir -p "$OUT/$column"
    magick "$PNG" -filter Lanczos -resize 279x209! "$OUT/$column/$row.png"
    echo "$column $row $(stat -c %s "$OUT/$column/$row.png")"
  done
done
# The image at the end of each d-pad check, from check-spike.sh's runs.
mkdir -p "$OUT/proof"
for column in today 6; do
  i=0
  for png in $(nix shell nixpkgs#jq --command jq -r '.results[0].authored.checks[].image' "$(find /tmp/s2-spike/out-$column -name report.json | head -1)"); do
    magick "$png" -filter Lanczos -resize 279x209! "$OUT/proof/$column-$i.png"; i=$((i+1))
  done
done
ls -la "$OUT/proof"
