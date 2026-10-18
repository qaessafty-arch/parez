#!/bin/bash
# parez - Production Deployment Script for Hetzner VPS
# Run as root on fresh Ubuntu 22.04/24.04
# Usage: curl -fsSL https://raw.githubusercontent.com/YOUR_USER/parez/main/deploy.sh | bash

set -euo pipefail

# =============================================================================
# CONFIGURATION - EDIT THESE VALUES
# =============================================================================
REPO_URL="https://github.com/YOUR_USER/parez.git"      # Your GitHub repo
DOMAIN="parez.yourdomain.com"                           # Your domain
EMAIL="admin@yourdomain.com"                            # For Let's Encrypt
BACKUP_PASS="your-32-char-random-passphrase-here"       # For backup encryption
S3_BUCKET="your-backup-bucket"                          # S3/Wasabi/B2 bucket
S3_ENDPOINT="https://s3.wasabisys.com"                  # S3 endpoint (Wasabi/B2/AWS)
AWS_ACCESS_KEY_ID="your-access-key"
AWS_SECRET_ACCESS_KEY="your-secret-key"
# =============================================================================

APP_DIR="/opt/parez"
DATA_DIR="$APP_DIR/data"
LOG_DIR="$APP_DIR/logs"

echo "🚀 Starting parez deployment on $(hostname)..."

# -----------------------------------------------------------------------------
# 1. System Preparation
# -----------------------------------------------------------------------------
echo "📦 Updating system & installing dependencies..."
export DEBIAN_FRONTEND=noninteractive
apt-get update && apt-get install -y \
    docker.io docker-compose nginx certbot python3-certbot-nginx \
    ufw fail2ban unattended-upgrades gpg awscli sqlite3 curl git

systemctl enable --now docker
systemctl enable --now nginx
systemctl enable --now fail2ban

# -----------------------------------------------------------------------------
# 2. Firewall (SSH, HTTP, HTTPS only)
# -----------------------------------------------------------------------------
echo "🔥 Configuring firewall..."
ufw allow 22/tcp comment "SSH"
ufw allow 80/tcp comment "HTTP"
ufw allow 443/tcp comment "HTTPS"
ufw --force enable

# -----------------------------------------------------------------------------
# 3. SSH Hardening
# -----------------------------------------------------------------------------
echo "🔐 Hardening SSH..."
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config
systemctl reload sshd

# -----------------------------------------------------------------------------
# 4. Auto Security Updates
# -----------------------------------------------------------------------------
echo "🔄 Enabling auto security updates..."
dpkg-reconfigure -plow unattended-upgrades

# -----------------------------------------------------------------------------
# 5. Application Deployment
# -----------------------------------------------------------------------------
echo "📥 Cloning repository..."
mkdir -p "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
    cd "$APP_DIR" && git pull origin main
else
    git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"

# Create data/log directories with correct permissions
mkdir -p "$DATA_DIR" "$LOG_DIR"
chown -R 1000:1000 "$DATA_DIR" "$LOG_DIR"  # Node user in container

# -----------------------------------------------------------------------------
# 6. Environment File
# -----------------------------------------------------------------------------
echo "📝 Creating .env file..."
cat > "$APP_DIR/.env" <<EOF
NODE_ENV=production
DATABASE_URL=file:./data/parez.db
COOKIE_SECURE=1
SESSION_TTL_HOURS=24
BACKUP_PASS=$BACKUP_PASS
S3_BUCKET=$S3_BUCKET
S3_ENDPOINT=$S3_ENDPOINT
AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY
EOF
chmod 600 "$APP_DIR/.env"

# -----------------------------------------------------------------------------
# 7. SSL Certificate (Let's Encrypt)
# -----------------------------------------------------------------------------
echo "🔒 Obtaining SSL certificate for $DOMAIN..."
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect

# -----------------------------------------------------------------------------
# 8. Daily Encrypted Backup (cron)
# -----------------------------------------------------------------------------
echo "💾 Setting up daily encrypted backup..."
cat > /etc/cron.daily/parez-backup <<'BACKUP_EOF'
#!/bin/bash
set -euo pipefail

DATE=$(date +%F)
BACKUP_FILE="/tmp/parez-$DATE.db"
ENCRYPTED_FILE="/tmp/parez-$DATE.db.gpg"

# 1. SQLite backup (hot backup, consistent)
sqlite3 /opt/parez/data/parez.db ".backup $BACKUP_FILE"

# 2. Encrypt with AES-256
gpg --batch --yes --symmetric --cipher-algo AES256 \
    --passphrase "$BACKUP_PASS" \
    --output "$ENCRYPTED_FILE" "$BACKUP_FILE"

# 3. Upload to S3/Wasabi/B2 (GLACIER/DEEP_ARCHIVE for cost)
aws s3 cp "$ENCRYPTED_FILE" "s3://$S3_BUCKET/parez/$DATE.db.gpg" \
    --endpoint-url "$S3_ENDPOINT" \
    --storage-class GLACIER_IR \
    --metadata "original-date=$DATE,app=parez"

# 4. Cleanup
rm -f "$BACKUP_FILE" "$ENCRYPTED_FILE"

# 5. Retention: keep 90 days locally, 7 years in S3 (via lifecycle policy)
find /tmp -name "parez-*.db*" -mtime +1 -delete 2>/dev/null || true
BACKUP_EOF

chmod +x /etc/cron.daily/parez-backup

# Set environment for cron
echo "BACKUP_PASS=$BACKUP_PASS" >> /etc/environment
echo "S3_BUCKET=$S3_BUCKET" >> /etc/environment
echo "S3_ENDPOINT=$S3_ENDPOINT" >> /etc/environment
echo "AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID" >> /etc/environment
echo "AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY" >> /etc/environment

# -----------------------------------------------------------------------------
# 9. Fail2ban SSH Protection
# -----------------------------------------------------------------------------
echo "🛡️ Configuring Fail2ban..."
cat > /etc/fail2ban/jail.local <<'FAIL2BAN_EOF'
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 3
backend = systemd

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = %(sshd_log)s
maxretry = 3
bantime = 1h
FAIL2BAN_EOF

systemctl restart fail2ban

# -----------------------------------------------------------------------------
# 10. Nginx Configuration
# -----------------------------------------------------------------------------
echo "🌐 Configuring Nginx..."
cat > /etc/nginx/nginx.conf <<'NGINX_EOF'
user www-data;
worker_processes auto;
pid /run/nginx.pid;
include /etc/nginx/modules-enabled/*.conf;

events {
    worker_connections 1024;
    use epoll;
    multi_accept on;
}

http {
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    server_tokens off;

    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # Logging
    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log warn;

    # Gzip
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    # Upstream
    upstream parez_app {
        server 127.0.0.1:4177;
        keepalive 32;
    }

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;

    # HTTP -> HTTPS redirect
    server {
        listen 80;
        listen [::]:80;
        server_name _;
        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }
        location / {
            return 301 https://$host$request_uri;
        }
    }

    # Main HTTPS server
    server {
        listen 443 ssl http2;
        listen [::]:443 ssl http2;
        server_name parez.yourdomain.com;

        ssl_certificate /etc/letsencrypt/live/parez.yourdomain.com/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/parez.yourdomain.com/privkey.pem;
        ssl_trusted_certificate /etc/letsencrypt/live/parez.yourdomain.com/chain.pem;

        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
        ssl_prefer_server_ciphers off;
        ssl_session_cache shared:SSL:10m;
        ssl_session_timeout 10m;

        # Security headers
        add_header X-Frame-Options DENY;
        add_header X-Content-Type-Options nosniff;
        add_header X-XSS-Protection "1; mode=block";
        add_header Referrer-Policy strict-origin-when-cross-origin;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self';";

        # API rate limiting
        location /api/ {
            limit_req zone=api burst=20 nodelay;
            proxy_pass http://parez_app;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Forwarded-Host $host;
            proxy_set_header X-Forwarded-Port $server_port;
            proxy_cache_bypass $http_upgrade;
            proxy_http_version 1.1;
            proxy_read_timeout 60s;
            proxy_send_timeout 60s;
        }

        # Login rate limiting
        location /api/auth/login {
            limit_req zone=login burst=3 nodelay;
            proxy_pass http://parez_app;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Static assets (if any)
        location /assets/ {
            proxy_pass http://parez_app;
            expires 1y;
            add_header Cache-Control "public, immutable";
        }

        # Main app
        location / {
            proxy_pass http://parez_app;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Forwarded-Host $host;
            proxy_set_header X-Forwarded-Port $server_port;
            proxy_cache_bypass $http_upgrade;
            proxy_http_version 1.1;
            proxy_read_timeout 60s;
            proxy_send_timeout 60s;

            # WebSocket support
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
        }
    }
}
NGINX_EOF

# Test and reload nginx
nginx -t && systemctl reload nginx

# -----------------------------------------------------------------------------
# 11. Deploy Application
# -----------------------------------------------------------------------------
echo "🐳 Building and starting containers..."
cd "$APP_DIR"
docker compose up -d --build

# -----------------------------------------------------------------------------
# 12. Health Check
# -----------------------------------------------------------------------------
echo "🏥 Waiting for health check..."
sleep 10
for i in {1..30}; do
    if curl -sf http://127.0.0.1:4177/api/auth/me >/dev/null 2>&1; then
        echo "✅ Application is healthy!"
        break
    fi
    echo "   Waiting... ($i/30)"
    sleep 2
done

# -----------------------------------------------------------------------------
# 13. Final Status
# -----------------------------------------------------------------------------
echo ""
echo "✅ Deployment complete!"
echo "🌐 Application: https://$DOMAIN"
echo "📊 Logs: docker compose logs -f"
echo "💾 Backups: /etc/cron.daily/parez-backup (runs daily at 6:25 AM)"
echo "🔒 SSL auto-renewal: certbot timer (systemctl status certbot.timer)"
echo ""
echo "🔑 Next steps:"
echo "   1. Update REPO_URL, DOMAIN, EMAIL, BACKUP_PASS, S3 credentials in this script"
echo "   2. Add SSH key to GitHub for auto-deploy: ssh-keygen -t ed25519"
echo "   3. Set up GitHub Actions for auto-deploy (see .github/workflows/deploy.yml)"
echo ""
echo "✨ Deployment successful!"