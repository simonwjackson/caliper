#!/usr/bin/env bash
# Install a packed Caliper into a new Vite + React project with npm, the way a
# user would, and check that it works with no Caliper checkout and no Nix.
#
#   npm pack --pack-destination /tmp/caliper-pack
#   scripts/verify-clean-install.sh /tmp/caliper-pack/simonwjackson-caliper-*.tgz
#
# VITE_VERSION picks the consumer's Vite major. Default: 8.
# Needs Node 24 and npm on PATH. If a Chromium is available (CHROMIUM, or the
# browser from `npx playwright-core install chromium`), it also renders the part.
# It uses its own registry folder and ports 5791 and 3791, so a running Caliper
# app does not see this project.
set -euo pipefail
tarball="$(realpath "${1:?usage: verify-clean-install.sh <caliper .tgz>}")"
vite_version="${VITE_VERSION:-8}"
work="$(mktemp -d "${TMPDIR:-/tmp}/caliper-clean-install-XXXX")"
export XDG_RUNTIME_DIR="$work/run" XDG_CONFIG_HOME="$work/config"
mkdir -p "$XDG_RUNTIME_DIR" "$XDG_CONFIG_HOME"
cd "$work"

cat > package.json <<'EOF'
{ "name": "clean-consumer", "private": true, "type": "module" }
EOF
cat > index.html <<'EOF'
<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>
EOF
mkdir -p src
cat > src/main.tsx <<'EOF'
import "./app.css"
import { createRoot } from "react-dom/client"
import Hello from "./Hello.part"
createRoot(document.getElementById("root")!).render(<Hello />)
EOF
echo 'body { margin: 0 }' > src/app.css
cat > src/Hello.part.tsx <<'EOF'
export const name = "Hello"
export default function Hello() { return <main>Hello from a clean consumer</main> }
EOF
cat > tsconfig.json <<'EOF'
{ "compilerOptions": { "jsx": "react-jsx", "module": "esnext", "moduleResolution": "bundler", "strict": true } }
EOF
cat > vite.config.js <<'EOF'
import { caliper } from "@simonwjackson/caliper"
import { defineConfig } from "vite"
export default defineConfig({ plugins: [caliper()] })
EOF

npm install --no-audit --no-fund --loglevel=error react@19 react-dom@19 "vite@$vite_version" "$tarball" > npm.log 2>&1 || { tail -30 npm.log; exit 1; }
echo "installed $(node -p 'require("@simonwjackson/caliper/package.json").version') with vite $(node -p 'require("vite/package.json").version') and node $(node --version)"

node node_modules/.bin/vite --host 127.0.0.1 --port 5791 --strictPort > vite.log 2>&1 &
vite=$!
node node_modules/.bin/caliper --port 3791 > app.log 2>&1 &
app=$!
trap 'kill $vite $app 2>/dev/null || true' EXIT

projects=""
for _ in $(seq 1 60); do
  projects="$(curl -fsS http://127.0.0.1:3791/__caliper/api/projects 2>/dev/null || true)"
  if grep -q '"clean-consumer"' <<<"$projects" && grep -q '"Ready"' <<<"$projects"; then break; fi
  sleep 1
done
grep -q '"Ready"' <<<"$projects" || { echo "FAIL: the app does not list the project as Ready: $projects"; tail -20 vite.log app.log; exit 1; }
id="$(grep -o '"id":"[0-9a-f]\{12\}"' <<<"$projects" | head -1 | cut -d'"' -f4)"
echo "project $id is Ready"

fetch() {
  local code
  code="$(curl -s -o "$work/body" -w '%{http_code}' "http://127.0.0.1:3791$1")"
  [[ "$code" == 200 ]] || { echo "FAIL: $1 answered $code"; exit 1; }
  echo "$1: 200"
}
fetch "/__caliper/p/$id/__caliper/"
fetch /__caliper/assets/chrome.js
fetch /__caliper/sw.js
fetch "/__caliper/p/$id/src/Hello.part.tsx"
grep -q 'Hello from a clean consumer' "$work/body" || { echo "FAIL: Vite did not serve the part"; exit 1; }

if [[ -n "${CHROMIUM:-}" ]] || [[ -x "$(node -p 'require("playwright-core").chromium.executablePath()' 2>/dev/null)" ]]; then
  node node_modules/.bin/caliper-render --url http://127.0.0.1:5791 --part src/Hello.part.tsx --out "$work/render" > render.json 2> render.log \
    || { echo "FAIL: caliper-render: $(tail -5 render.log)"; exit 1; }
  grep -q -E '"frame": ?"Rendered"' render.json || { echo "FAIL: render: $(head -c 800 render.json)"; exit 1; }
  echo "rendered src/Hello.part.tsx"
else
  echo "no Chromium: render skipped"
fi
echo "PASS"
