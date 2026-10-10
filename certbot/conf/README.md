# Certbot Directory Structure

This directory is managed by certbot for SSL certificate storage.

## Structure
```
certbot/
├── conf/
│   ├── live/          # Current certificates (symlinks)
│   │   └── parez.yourdomain.com/
│   │       ├── fullchain.pem -> ../../archive/parez.yourdomain.com/fullchain1.pem
│   │       ├── privkey.pem -> ../../archive/parez.yourdomain.com/privkey1.pem
│   │       ├── chain.pem -> ../../archive/parez.yourdomain.com/chain1.pem
│   │       └── cert.pem -> ../../archive/parez.yourdomain.com/cert1.pem
│   ├── archive/       # Historical certificates
│   │   └── parez.yourdomain.com/
│   │       ├── fullchain1.pem
│   │       ├── privkey1.pem
│   │       ├── chain1.pem
│   │       └── cert1.pem
│   └── renewal/       # Renewal configs
│       └── parez.yourdomain.com.conf
└── www/
    └── .well-known/
        └── acme-challenge/  # ACME challenge files (temp)
```

## Important Notes

1. **Never commit** the `conf/live/`, `conf/archive/`, or `conf/renewal/` directories to git
2. These are managed by certbot automatically
3. The `www/` directory is used for ACME HTTP-01 challenges
4. Certificates auto-renew via certbot container (daily check)

## First-time Setup

On first deployment, certbot will:
1. Create challenge file in `www/.well-known/acme-challenge/`
2. Let's Encrypt verifies domain ownership
3. Issues certificate, stores in `conf/archive/`
4. Creates symlinks in `conf/live/`
5. Nginx reloads to use new certs

## Renewal

Certificates auto-renew via certbot container (runs daily at random time).
Check renewal status:
```bash
docker logs parez-certbot
```

## Manual Renewal (if needed)

```bash
docker compose run --rm certbot renew --force-renewal
docker compose exec nginx nginx -s reload
```

## Backup

Include `certbot/conf/` in your backup strategy (encrypted).
The private keys in `archive/` are the most critical.