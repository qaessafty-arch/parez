# parez - Shop Accounting & Payment Management System

**Production-ready financial management for digital wallet operators in Kurdistan/Iraq.**

Supports: FastPay, NassWallet, FIB (First Iraqi Bank), CardHouse (gift cards/vouchers), Ronaki projects, expenses, customers, daily closing, and audit trails.

---

## 🚀 Quick Start (Local Development)

```bash
# 1. Clone & install
git clone https://github.com/YOUR_USER/parez.git
cd parez
npm install

# 2. Start dev servers (frontend: 5173, backend: 4177)
npm run dev

# 3. Open http://127.0.0.1:5173
# Login: monib / 123456
```

---

## 🐳 Production Deployment (Hetzner VPS + Docker)

### Prerequisites
- Hetzner VPS (CX22: 2 vCPU, 4GB RAM, 40GB NVMe - €4.50/mo)
- Domain name (e.g., `parez.yourdomain.com`)
- S3-compatible storage for backups (Wasabi, Backblaze B2, AWS S3)

### One-Command Deploy
```bash
# On fresh Ubuntu 22.04/24.04 VPS as root
curl -fsSL https://raw.githubusercontent.com/YOUR_USER/parez/main/deploy.sh | bash
```

### What the deploy script does:
1. **System prep** - Docker, Nginx, Certbot, Fail2ban, UFW
2. **Security** - SSH hardening, auto-updates, firewall (22/80/443)
3. **SSL** - Let's Encrypt auto-renewal
4. **Backups** - Daily encrypted SQLite backup → S3/Wasabi/B2 (GLACIER)
5. **Monitoring** - Health checks, log rotation, rate limiting
6. **Application** - Docker Compose build & start

### Post-Deploy
- App: `https://parez.yourdomain.com`
- Login: `monib` / `123456`
- Logs: `docker compose logs -f`
- Manual backup: `/etc/cron.daily/parez-backup`

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  VPS (Hetzner CX22 - €4.50/mo)                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ Docker Network                                        │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │ │
│  │  │ parez-app    │  │ parez-db     │  │ nginx      │  │ │
│  │  │ (Node.js)    │  │ (SQLite vol) │  │ (SSL/Proxy)│  │ │
│  │  └──────────────┘  └──────────────┘  └────────────┘  │ │
│  └───────────────────────────────────────────────────────┘ │
│  ✅ UFW: 22/80/443 only | ✅ Fail2ban SSH | ✅ Auto SSL   │
└─────────────────────────────────────────────────────────────┘
```

### Services
| Service | Port | Description |
|---------|------|-------------|
| `parez-app` | 4177 | Node.js API + SSR frontend |
| `nginx` | 80/443 | SSL termination, rate limiting, proxy |
| `certbot` | - | Let's Encrypt auto-renewal |

---

## 🔧 Configuration

### Environment Variables (`.env`)
```bash
NODE_ENV=production
DATABASE_URL=file:./data/parez.db
COOKIE_SECURE=1
SESSION_TTL_HOURS=24

# Backup
BACKUP_PASS=your-32-char-passphrase
S3_BUCKET=your-bucket
S3_ENDPOINT=https://s3.wasabisys.com
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
```

### GitHub Actions Secrets
| Secret | Description |
|--------|-------------|
| `VPS_HOST` | VPS IP address |
| `VPS_SSH_KEY` | Private SSH key (ed25519) |
| `DOMAIN` | Your domain (e.g., `parez.yourdomain.com`) |

---

## 🔄 Update Workflow

```bash
# Local
git add . && git commit -m "feat: new feature" && git push

# Auto-deploy via GitHub Actions (on push to main)
# Or manual:
ssh root@server "cd /opt/parez && git pull && docker compose up -d --build"
```

### Zero-Downtime Deploy
```bash
docker compose up -d --build --remove-orphans
docker image prune -f
```

---

## 💾 Backup & Recovery

### Automatic (Daily at 6:25 AM)
- SQLite hot backup → AES-256 encryption → S3/Wasabi/B2 (GLACIER_IR)
- Retention: 90 days local, 7 years S3 (lifecycle policy)

### Manual Backup
```bash
/etc/cron.daily/parez-backup
```

### Restore
```bash
# 1. Download from S3
aws s3 cp s3://bucket/parez/2026-10-10.db.gpg /tmp/restore.db.gpg

# 2. Decrypt
gpg --decrypt --passphrase "$BACKUP_PASS" --output /tmp/restore.db /tmp/restore.db.gpg

# 3. Replace DB
docker compose stop app
cp /tmp/restore.db /opt/parez/data/parez.db
docker compose start app
```

---

## 🛡️ Security

- **UFW**: Only ports 22, 80, 443 open
- **Fail2ban**: SSH brute-force protection (3 tries → 1h ban)
- **SSH**: Root login disabled, password auth disabled, keys only
- **SSL**: TLS 1.2/1.3, strong ciphers, HSTS, security headers
- **Rate limiting**: API 10r/s, Login 5r/m
- **Auto-updates**: Unattended security upgrades

---

## 📊 Monitoring

```bash
# App health
curl https://parez.yourdomain.com/api/auth/me

# Logs
docker compose logs -f app
docker compose logs -f nginx

# Resources
docker stats

# Backups
ls -la /tmp/parez-*.db.gpg
aws s3 ls s3://your-bucket/parez/
```

---

## 💰 Cost Breakdown

| Component | Monthly Cost |
|-----------|--------------|
| Hetzner CX22 (2 vCPU, 4GB, 40GB) | €4.50 |
| Domain | ~€1 |
| Wasabi B2 (100GB backups) | $0.50 |
| **Total** | **~€5.50/mo** |

---

## 🆘 Troubleshooting

| Issue | Solution |
|-------|----------|
| App won't start | `docker compose logs app` |
| SSL expired | `certbot renew --force-renewal && nginx -s reload` |
| DB locked | `docker compose restart app` |
| Backup failed | Check `/var/log/syslog` & AWS credentials |
| High memory | `docker compose restart app` |

---

## 📝 License

MIT License - See LICENSE file for details.

---

## 🤝 Contributing

1. Fork the repo
2. Create feature branch
3. Commit changes
4. Push & open PR

---

**Built with ❤️ for Kurdistan's digital wallet operators.**