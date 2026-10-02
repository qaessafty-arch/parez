# Deploying Parez to a free always-on server

Oracle Cloud Free Tier is the only host I have found that is genuinely free,
has no monthly bill, and does not reclaim the machine for being idle.

**What this costs you:** a card for identity verification only. It is never
charged. If Oracle cannot provision a free VM in your chosen region, the
console will say so before you confirm anything.

---

## 1. Create the VM (about 10 minutes, in a browser)

1. Go to **cloud.oracle.com/free** → **Start for free**
2. Sign up — a card is required for verification, not billing
3. Pick a **home region**. This is permanent and cannot be changed later.
4. When asked to "Launch a VM", choose:

   | Field | Value |
   |---|---|
   | Image | **Canonical Ubuntu 24.04** (labelled "Always Free Eligible") |
   | Shape | **VM.Standard.A1.Flex** |
   | OCPUs | **4** |
   | Memory | **24 GB** |
   | Networking | **Create new VCN**, assign a public IP |
   | SSH key | **Generate a key pair** — download the private key, you will need it |

   **Note on the 4/24 figures.** Oracle's Always Free allowance is
   1,500 OCPU-hours and 9,000 GB-hours per month. That is enough for
   **4 OCPUs / 24 GB running for about half the month**, or 2/12
   running continuously. **Ask for 2 OCPUs / 12 GB** — that is the
   guaranteed all-hours amount, and Parez needs almost nothing
   (a Node process and a SQLite file). Nothing needs compiling for
   ARM: the only dependencies are `express` and `zod`, both plain
   JavaScript, and the database is Node's built-in `node:sqlite`.

   Also available on Always Free: up to two `VM.Standard.E2.1.Micro`
   instances (AMD, 1 GB each) if you want a fallback.

5. **If it says out of capacity:** this is common. Delete the instance and try
   another region. `Frankfurt`, `Amsterdam`, `Milan` and `Stockholm` usually
   have free capacity; `Ashburn` rarely does.

6. When it boots, note the **public IP address** and the **username** (usually
   `ubuntu`).

---

## 2. Prepare the server (5 minutes)

Open PowerShell or a terminal on your computer:

```bash
ssh ubuntu@<SERVER-IP>
```

Then, on the server:

```bash
curl -fsSL https://raw.githubusercontent.com/qaessafty-arch/parez/master/deploy/host-setup.sh | bash
```

This installs Node 22, git, sets up a firewall, and adds swap. Safe to re-run.

---

## 3. Deploy Parez (10 minutes)

Back on your own computer:

```bash
# send the Parez folder to the server
scp -r . ubuntu@<SERVER-IP>:~/pared-deploy
```

Then log back in and deploy:

```bash
ssh ubuntu@<SERVER-IP>
bash ~/pared-deploy/deploy/deploy.sh
```

The script installs dependencies, builds the client, installs a systemd
service, and starts Parez. It never overwrites an existing database.

When it finishes you get a URL such as `http://<SERVER-IP>:4177`.

---

## 4. Make it work on mobile (5 minutes)

**A bare `http://` address will not work properly in most mobile browsers.**
You need HTTPS. Do this on the server:

```bash
sudo apt-get install -y cloudflared
cloudflared tunnel --url http://127.0.0.1:4177
```

It prints something like:

```
https://random-words-here.trycloudflare.com
```

That is your address. Open it on a phone. Done.

**The URL changes every time you restart the tunnel.** For a permanent address
see "Making the URL permanent" below.

---

## 5. Complete the setup

Open the URL in a browser. The first screen asks for your shop name and asks
you to create an admin account. After that it works normally.

---

## Making the URL permanent

The quick tunnel above gives a random URL each time. To keep one address
forever you need a Cloudflare account and a domain you own:

```bash
# one-time, in a browser: create a tunnel at dash.cloudflare.com
cloudflared tunnel login
cloudflared tunnel create parez
cloudflared tunnel route dns parez parez.yourdomain.com
```

Then edit the tunnel config and run it as a service — the deploy folder's
README covers the exact commands. A domain costs roughly $10 per year, which
is the only recurring cost in this whole setup.

---

## Day-to-day

```bash
sudo systemctl status parez     # is it running?
sudo journalctl -u parez -f     # watch logs live
sudo systemctl restart parez    # restart
```

After changing code, push to GitHub then run on the server:

```bash
cd ~/parez && git pull && npm run build && sudo systemctl restart parez
```

---

## Before you deploy: set a billing alert

This is the single most important step, and it takes two minutes.

1. In the Oracle console go to **Billing & Cost Management → Budgets**
2. **Create a budget** with an amount of **$1**
3. Leave the email notification on

Oracle does not email you when free resources are used — only when you
exceed them. Without this alert, an overage would be discovered on a
statement. With it, you get an email while it is still a rounding error.

Do this **before** you launch the VM, not after.

## Checking on it later

```bash
bash ~/pared/deploy/cost-guard.sh
```

It reports whether Parez is running, how full the disk is, whether a
recent backup exists, and reminds you where the real cost alert lives.
To run it automatically every six hours:

```bash
crontab -e
# add:
0 */6 * * * bash ~/pared/deploy/cost-guard.sh check >> ~/cost-guard.log 2>&1
```

---

## Backups — do not skip this

The database lives at `~/pared/data/parez.db`. That single file is the entire
financial history.

Use Parez's own **Backup → Back up now** page, then copy the downloaded file
somewhere else — your own computer, not the server.

A copy stored on the same machine is not a backup.

---

## If Oracle takes the instance back

Oracle has reclaimed idle Always Free instances before. If Parez suddenly stops
responding, check whether the VM still exists in the console. If it was
released, download the `parez.db` backup you kept, create a fresh instance,
and redeploy with the steps above.

This is the main risk of the free tier, and the reason backups matter more
here than on the local install.