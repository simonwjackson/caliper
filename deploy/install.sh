#!/usr/bin/env -S nix shell nixpkgs#bash nixpkgs#coreutils nixpkgs#curl --command bash
# Install the Caliper app on this machine as user services, from this checkout's
# deploy/systemd/ units. It replaces the legacy launcher units of the same names.
#
#   deploy/install.sh            install, enable and restart both units
#   deploy/install.sh --check    only report what runs
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
settings="${XDG_CONFIG_HOME:-$HOME/.config}/caliper/config.json"

check() {
  systemctl --user --no-pager status caliper.service caliper-proxy.service | grep -E '●|Active:' || true
  echo "projects: $(curl -fsS --max-time 5 http://127.0.0.1:3132/__caliper/api/projects || echo unreachable)"
}

if [[ "${1:-}" == "--check" ]]; then check; exit 0; fi

if [[ ! -x "$HOME/.local/bin/caliper-tsnet" ]]; then
  echo "caliper-tsnet is missing at ~/.local/bin/caliper-tsnet. Install it, or skip caliper-proxy.service." >&2
  exit 1
fi
if [[ ! -f "$settings" ]]; then
  echo "No settings at $settings: the app starts with the agent off. Add { \"agent\": { \"model\": ... } } to turn it on."
fi

mkdir -p "$units"
install -m 0644 "$here/systemd/caliper.service" "$units/caliper.service"
install -m 0644 "$here/systemd/caliper-proxy.service" "$units/caliper-proxy.service"
systemctl --user daemon-reload
systemctl --user enable caliper.service caliper-proxy.service
systemctl --user restart caliper.service
systemctl --user restart caliper-proxy.service

for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 http://127.0.0.1:3132/__caliper/api/projects >/dev/null 2>&1; then break; fi
  sleep 2
done
check
