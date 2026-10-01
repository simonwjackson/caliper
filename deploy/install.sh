#!/usr/bin/env -S nix shell nixpkgs#bash nixpkgs#coreutils nixpkgs#curl --command bash
# Install the Caliper app on this machine as a systemd user service, from this
# checkout's deploy/systemd/ units. This is one example setup, not the only way
# to run the app: it needs systemd, and Nix at /run/current-system/sw/bin/nix.
#
#   deploy/install.sh            install, enable and restart the units
#   deploy/install.sh --check    only report what runs
#
# The service runs the checkout that this script is in. Run it from the checkout
# that the service must use, not from a worktree that you will remove.
#
# caliper-proxy.service is optional. It installs only when ~/.local/bin/caliper-tsnet
# exists. caliper-tsnet is a TLS proxy on a tailnet; it is not part of Caliper.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
checkout="$(cd "$here/.." && pwd)"
units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
settings="${XDG_CONFIG_HOME:-$HOME/.config}/caliper/config.json"
proxy="$HOME/.local/bin/caliper-tsnet"

check() {
  systemctl --user --no-pager status caliper.service caliper-proxy.service 2>/dev/null | grep -E '●|Active:' || true
  echo "projects: $(curl -fsS --max-time 5 http://127.0.0.1:3132/__caliper/api/projects || echo unreachable)"
}

if [[ "${1:-}" == "--check" ]]; then check; exit 0; fi

if [[ ! -f "$settings" ]]; then
  echo "No settings at $settings: the app starts with the agent off. Add { \"agent\": { \"model\": ... } } to turn it on."
fi

mkdir -p "$units"
sed "s|@CHECKOUT@|$checkout|g" "$here/systemd/caliper.service" > "$units/caliper.service"
chmod 0644 "$units/caliper.service"
enabled=(caliper.service)
if [[ -x "$proxy" ]]; then
  install -m 0644 "$here/systemd/caliper-proxy.service" "$units/caliper-proxy.service"
  enabled+=(caliper-proxy.service)
else
  echo "No $proxy: skipping caliper-proxy.service. The app listens on 127.0.0.1:3132 only."
fi
systemctl --user daemon-reload
systemctl --user enable "${enabled[@]}"
for unit in "${enabled[@]}"; do systemctl --user restart "$unit"; done

for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 http://127.0.0.1:3132/__caliper/api/projects >/dev/null 2>&1; then break; fi
  sleep 2
done
check
