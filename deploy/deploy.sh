#!/usr/bin/env bash
#
# Parez — one-time deployment to a Linux host (Oracle Cloud Free Tier or any VPS).
#
# Usage:
#   scp -r <this-folder> user@<server-ip>:~/parez-deploy
#   ssh user@<server-ip>
#   bash ~/parez-deploy/deploy/deploy.sh
#
# Safe to re-run: it is idempotent and never overwrites an existing database.

set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/parez}"
DATA_DIR="${DATA_DIR:-$APP_DIR/data}"
REPO_URL="${REPO_URL:-https://github.com/qaessafty-arch/parez.git}"

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m  %s\n' "$*"; }
die()  { printf '\033[1;31mxx\033[0m  %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- preflight
log "Checking prerequisites"
command -v node >/dev/null 2>&1 || die "Node.js not found. The install step below handles this, but rerun if it fails."
command -v git  >/dev/null 2>&1 || die "git not found. Install it: sudo apt-get install -y git"
command -v npm  >/dev/null 2>&1 || die "npm not found."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || die "Node 22+ required (found $(node -v))."
log "Node $(node -v), git $(git --version | awk '{print $3}')"

# ---------------------------------------------------------------- source
if [ -d "$APP_DIR/.git" ]; then
  log "Updating existing checkout in $APP_DIR"
  cd "$APP_DIR"
  git pull --ff-only || warn "git pull failed; continuing with the files already there"
else
  log "Cloning Parez into $APP_DIR"
  mkdir -p "$APP_DIR"
  cd "$APP_DIR"
  git clone "$REPO_URL" . || die "clone failed. Check the repo URL and your network."
fi

# ---------------------------------------------------------------- build
log "Installing dependencies (this takes a few minutes)"
npm ci --omit=dev --no-audit --no-fund 2>/dev/null || npm install --omit=dev --no-audit --no-fund

log "Building the client bundle"
npm install --no-audit --no-fund >/dev/null 2>&1 || true
npm run build || warn "build failed — if client/dist already exists this is fine"

[ -f client/dist/index.html ] || die "client/dist/index.html missing. Run 'npm run build' and check the output."

# ---------------------------------------------------------------- data
mkdir -p "$DATA_DIR/backups" "$DATA_DIR/uploads"

if [ -f "$DATA_DIR/parez.db" ]; then
  log "Existing database found — keeping it untouched"
else
  log "No database yet; one will be created on first start"
fi

# ---------------------------------------------------------------- service
log "Installing the parez service"
sudo tee /etc/systemd/system/parez.service >/dev/null <<EOF
[Unit]
Description=Parez Shop Accounting
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=4177
Environment=PAREZ_DATA_DIR=$DATA_DIR
Environment=HOST=0.0.0.0
ExecStart=$(command -v node) $APP_DIR/server/src/index.js
Restart=always
RestartSec=5

# The app only ever needs to read its own code and write to its data dir.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable parez >/dev/null
sudo systemctl restart parez

# ---------------------------------------------------------------- verify
log "Waiting for the service to come up"
for i in $(seq 1 20); do
  sleep 2
  if curl -fsS "http://127.0.0.1:4177/api/health" >/dev/null 2>&1; then
    log "Parez is running"
    break
  fi
  [ "$i" -eq 20 ] && { sudo systemctl status parez --no-pager -l | tail -20; die "did not start; see the log above"; }
done

# ---------------------------------------------------------------- firewall
log "Opening port 4177"
sudo ufw allow 4177/tcp >/dev/null 2>&1 || warn "ufw not configured or rule already present"

IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"

cat <<EOF

============================================================
 Parez is deployed and running.

   Local:    http://127.0.0.1:4177
   Network:  http://$IP:4177
============================================================

NEXT STEPS

1. Open http://$IP:4177 in a browser and complete the setup
   screen (creates your admin account).

2. Give it HTTPS. A bare http:// URL will NOT work in most
   mobile browsers, and browsers will warn about it. Run:

      sudo apt-get install -y cloudflared
      cloudflared tunnel --url http://127.0.0.1:4177

   It prints a https://*.trycloudflare.com URL. That changes
   every restart, but it works immediately and needs no account.

3. From your computer, open a tunnel to this server:

      ssh -R 80:localhost:4177 -R 443:localhost:4177 \\
          nokey@localhost.trycloudflare.com

USEFUL COMMANDS

  sudo systemctl status parez     # is it running?
  sudo journalctl -u parez -f     # watch the log live
  sudo systemctl restart parez    # restart after a change

BACKUP

  Parez has its own Backup page. Once you are logged in, use
  Backup -> Back up now. The database lives at:

      $DATA_DIR/parez.db

  Copy that file off the server regularly. A backup only on the
  same machine is not a backup.

EOF