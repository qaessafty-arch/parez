# Deploying Parez to a paid VPS (REGXA, or any provider)

This is the straightforward path. ~30 minutes, ~$4.50/month, no signup
frustration.

Works on **any** Ubuntu VPS — REGXA (Iraq), Dubai, Istanbul, Hetzner,
DigitalOcean, Vultr. Only the first two steps change.

---

## 1. Order the server

**REGXA** — <https://regxa.com> — pick the Cloud VPS x2 plan:

| | |
|---|---|
| Plan | **Cloud VPS x2 — $4.50/month** |
| Location | **Iraq** |
| OS | **Ubuntu 24.04** |
| Access | **SSH key** |

Other region options if you prefer:

| Provider | Price | Region |
|---|---|---|
| OliveVPS | $3.99/mo | Dubai |
| DropVPS | $5.90/mo | Istanbul |
| Hetzner | ~€3.79/mo | Germany/Finland |

**On OS image:** some panels call it "Ubuntu 24.04 LTS". If 24.04 is
unavailable, **22.04 works fine** — Parez needs Node 22 and the deploy
script installs it for you either way.

---

## 2. Generate your SSH key

Do this **before** ordering if your panel asks for a public key.

On Windows PowerShell:

```powershell
ssh-keygen -t ed25519 -C "parez-shop"
```

Press Enter for the defaults. Two files appear in `C:\Users\<you>\.ssh\`:

- `id_ed25519` — **private, never send to anyone**
- `id_ed25519.pub` — public, this is what the server gets

Display the public key:

```powershell
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub
```

Copy that single line and paste it into the provider's SSH key field.

---

## 3. Connect

```powershell
ssh root@<SERVER-IP>
```

Some providers use `ubuntu@` instead of `root@`. If it fails, try the other.

---

## 4. Prepare the server

On the server:

```bash
curl -fsSL https://raw.githubusercontent.com/qaessafty-arch/parez/master/deploy/host-setup.sh | bash
```

Installs Node 22, git, opens the firewall for 4177, and adds swap.
Takes a few minutes. Safe to re-run.

---

## 5. Deploy Parez

**On your own computer**, from the folder containing the Parez project:

```powershell
scp -r . root@<SERVER-IP>:~/parez-deploy
```

**Then back on the server:**

```bash
bash ~/parez-deploy/deploy/deploy.sh
```

This installs dependencies, builds the client, creates the systemd
service, starts it, and waits for the health check.

When it finishes you get:

```
   Network:  http://<SERVER-IP>:4177
```

Open that in a browser to complete the setup screen.

---

## 6. Public HTTPS (needed for phones)

**A bare `http://` address will not load in most mobile browsers.** You
need HTTPS.

On the server:

```bash
sudo apt-get install -y cloudflared
cloudflared tunnel --url http://127.0.0.1:4177
```

It prints something like:

```
https://random-words-here.trycloudflare.com
```

**That is your client's address.** Open it on a phone.

The URL changes when the tunnel restarts. To stop it changing, either
install the service file:

```bash
sudo cp ~/parez/deploy/parez-tunnel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now parez-tunnel
```

…or get a permanent address with a Cloudflare account and a domain you
own (~$10/year). The service file still gives a random URL, but at least
it comes back on its own after a reboot.

---

## Day-to-day

```bash
sudo systemctl status parez     # running?
sudo journalctl -u parez -f     # watch logs
sudo systemctl restart parez    # restart
```

**After changing the code:**

```bash
cd ~/parez && git pull && npm run build && sudo systemctl restart parez
```

---

## Backups

The database is one file: `~/parez/data/parez.db`. That is the entire
shop history.

1. Log in to the app → **Backup → Back up now** → download the file
2. Copy it **off the server** — your computer, USB, or cloud storage

A copy on the same server is not a backup. Check that you have one
stored elsewhere before you need it.

Quick check from the command line:

```bash
bash ~/parez/deploy/cost-guard.sh
```

Reports whether Parez is running, how full the disk is, and whether a
backup exists in the last 7 days.

---

## Security notes

- Parez is now on the open internet. It has scrypt passwords, sessions,
  CSRF guards and an audit log, and login is rate-limited (5 attempts,
  then a 15-minute lockout).
- The firewall from `host-setup.sh` allows only SSH and 4177. Everything
  else is closed.
- If you use a domain later, terminate TLS properly rather than relying
  on the quick tunnel.

---

## Troubleshooting

| Problem | Cause |
|---|---|
| `Permission denied` on ssh | Wrong username, or key not registered. Try `root@` then `ubuntu@` |
| `EADDRINUSE` | Something else on 4177. `sudo ss -tlnp \| grep 4177` |
| Health check times out | `sudo journalctl -u parez -n 50` for the real error |
| `npm ci` fails on ARM | Shouldn't happen — deps are pure JS. Check disk space: `df -h` |
| Phone won't load the URL | It's `http://` not `https://`. Run the tunnel |
| Tunnel URL won't open | Check `journalctl -u parez-tunnel -n 20` |