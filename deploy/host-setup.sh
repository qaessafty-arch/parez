#!/usr/bin/env bash
#
# Parez — FIRST-TIME host preparation for Ubuntu 24.04 / Debian.
# Run this ONCE on a fresh server, before deploy.sh.
#
#   ssh user@<server-ip>
#   curl -fsSL https://raw.githubusercontent.com/qaessafty-arch/parez/master/deploy/host-setup.sh | bash
#
# Or copy host-setup.sh across and run:  bash host-setup.sh
#
# Installs Node 22, git, and opens the firewall. Safe to re-run.

set -euo pipefail

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mxx\033[0m  %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] && SUDO="" || SUDO="sudo"

log "Updating package lists"
$SUDO apt-get update -qq

log "Installing base packages"
$SUDO apt-get install -y -qq curl git ca-certificates ufw rsync >/dev/null

# ---------------------------------------------------------------- Node 22
if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]; then
  log "Node $(node -v) already present"
else
  log "Installing Node.js 22 LTS"
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash - >/dev/null
  $SUDO apt-get install -y -qq nodejs >/dev/null
  log "Installed Node $(node -v)"
fi

# ---------------------------------------------------------------- firewall
log "Configuring the firewall"
$SUDO ufw allow OpenSSH >/dev/null 2>&1 || true
$SUDO ufw allow 4177/tcp >/dev/null 2>&1 || true
$SUDO ufw --force enable >/dev/null 2>&1 || true
$SUDO ufw status | sed 's/^/    /' || true

# ---------------------------------------------------------------- swap
# Oracle's Always Free shapes have 1 GB RAM; a little swap keeps the
# SQLite write path from stalling under load.
if ! swapon --show | grep -q .; then
  log "Adding 2 GB swap (helps on the small free shapes)"
  sudo fallocate -l 2G /swapfile 2>/dev/null || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

cat <<'EOF'

============================================================
 Host is ready.

   Node:  $(node -v 2>/dev/null || echo unknown)
   User:  $USER

 Next: copy the Parez folder across and run deploy.sh

   scp -r . user@<server-ip>:~/pared-deploy
   ssh user@<server-ip>
   bash ~/pared-deploy/deploy/deploy.sh

============================================================
EOF