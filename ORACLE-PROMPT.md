# Oracle Cloud deployment — assistant prompt

Paste everything between the lines below into any AI assistant (Claude, ChatGPT,
Gemini). It contains everything needed to guide you without extra context.

---

I need to deploy a Node.js application called **Parez** to a free, always-on
Oracle Cloud VM, and expose it over public HTTPS so a shop owner can use it from
a phone. I am not a Linux expert — give me one step at a time, tell me exactly
what to click or type, and wait for me to report back before continuing.

## The application

- **Repo:** https://github.com/qaessafty-arch/parez.git (public, branch `master`)
- **Stack:** Node 22+, Express 4, React 19 built via Vite, SQLite via Node's
  built-in `node:sqlite`. Dependencies are only `express` and `zod`, both pure
  JavaScript, so nothing needs compiling for ARM.
- **Listen port:** 4177
- **Data file:** `data/parez.db` — one SQLite file holds the entire database
- **Production build:** `npm run build` produces `client/dist`, which the
  server then serves as a single-page app

## Deployment scripts already written

The repo has a `deploy/` folder, so do not rewrite these — use them.

1. **`deploy/host-setup.sh`** — one-time server prep. Installs Node 22, git,
   configures ufw to allow SSH and 4177, and adds 2 GB swap (the free shapes
   have little RAM and SQLite writes benefit from headroom).

   ```
   curl -fsSL https://raw.githubusercontent.com/qaessafty-arch/parez/master/deploy/host-setup.sh | bash
   ```

2. **`deploy/deploy.sh`** — installs the app. Clones the repo, installs
   dependencies, builds the client, creates a systemd service, starts it, and
   polls `/api/health` to confirm it came up. It is idempotent and deliberately
   never overwrites an existing `data/parez.db`, so a redeploy cannot destroy
   records.

   ```
   scp -r <local-parez-folder> ubuntu@<SERVER-IP>:~/parez-deploy
   ssh ubuntu@<SERVER-IP>
   bash ~/parez-deploy/deploy/deploy.sh
   ```

3. **`deploy/cost-guard.sh`** — checks that the service is running, disk has
   headroom, and a backup exists within 7 days. Run: `bash ~/parez/deploy/cost-guard.sh`

There is also `deploy/deploy-to-oracle.ps1` for Windows, which automates the
whole sequence, and `deploy/parez-tunnel.service`, a systemd unit that keeps the
tunnel alive across reboots.

## What I need help with

### Part 1 — Create the VM

I have not signed up yet. Walk me through:

1. Signing up at cloud.oracle.com/free. A credit card is required for identity
   verification and is **never charged** — explain this if I am worried.
2. **Creating a $1 budget alert** in Billing & Cost Management → Budgets. I want
   this done *before* launching any instance. Why it matters: Oracle does not
   email me about free resource usage, only about exceeding it, so without this
   alert an overage would be discovered on a statement.
3. Launching a VM with these exact settings:
   - Image: **Canonical Ubuntu 24.04** (the one labelled "Always Free Eligible")
   - Shape: **VM.Standard.A1.Flex**
   - **2 OCPUs and 12 GB memory** — NOT 4/24. Oracle's Always Free allowance is
     1,500 OCPU-hours and 9,000 GB-hours per month, so 4/24 only runs about half
     the month and would bill the other half. 2/12 is the all-hours amount and is
     far more than this app needs.
   - Networking: create a VCN and **assign a public IP address**
   - SSH: generate a key pair and tell me where the private key is downloaded
4. What to do if it says **"out of host capacity"** — I understand I should
   delete the instance and retry in a different region. Please suggest regions
   that usually have free capacity and warn me about ones that usually don't.
5. Confirming the instance boots, and showing me how to find its public IP
   address and confirm the username is `ubuntu`.

### Part 2 — Deploy

Once I have the IP, walk me through running the scripts above, and help me
troubleshoot if any step fails. Common failure modes I would like explained in
advance:

- `EADDRINUSE` when starting the service
- The health check timing out after the deploy script starts the service
- `npm ci` failing on the ARM machine
- Permissions errors when systemd tries to write to `data/`

### Part 3 — Public HTTPS

I understand that a bare `http://` address **will not load in most mobile
browsers**, so I need HTTPS. Walk me through:

```bash
sudo apt-get install -y cloudflared
cloudflared tunnel --url http://127.0.0.1:4177
```

Explain that this prints a `https://*.trycloudflare.com` URL that **changes
every time the tunnel restarts**, and how to install `deploy/parez-tunnel.service`
so it survives reboots. Then explain how to get a *permanent* address using a
Cloudflare account and a domain I own, and roughly what that costs.

## Important constraints

- **Cost must stay at $0.** The free tier genuinely does not bill, but only
  while I stay within the allowance. Flag anything that could cause a charge.
- **The data must never be silently lost.** `data/parez.db` holds a shop's
  complete financial history. Backups must be copied off the server, because
  Oracle's terms allow idle Always Free accounts to be reclaimed. Explain how to
  set up off-server backups.
- **I am not confident with Linux.** Prefer copy-pasteable commands over
  explanations of concepts. If a step has several possible outcomes, tell me how
  to tell which one happened before continuing.

## What I already know

- I can reach the app locally on Windows at `http://127.0.0.1:4177`
- I have `winget`, PowerShell, `ssh` and `scp` available
- I have run Cloudflare quick tunnels successfully from Windows already
- I would rather not spend money, so free-tier limits matter

---