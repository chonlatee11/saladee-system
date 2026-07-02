# Deploy the Saladee API to DigitalOcean (Ubuntu droplet + Caddy + sslip.io)

Closes the deferred Phase-0 host work (00-07 Criteria 1 & 4). Cloud services
(Neon C2, R2 C3) are already provisioned + verified. This runbook stands up the
always-on host so the API is live over HTTPS.

**Chosen config:** Basic droplet **$6/mo (1GB / 1 vCPU)**, region **SGP1 (Singapore)**
(closest to TH + same region as Neon `ap-southeast-1`), HTTPS via a free **sslip.io**
hostname (`<ip>.sslip.io`, real Let's Encrypt cert — LINE-webhook compatible).

---

## 1. Create the droplet

**Dashboard:** DigitalOcean → Create → Droplets → Ubuntu 24.04 LTS → Basic → Regular
$6/mo (1GB) → Region **Singapore** → add your SSH key → Create. Note the public IP.

**Or CLI (`doctl`):**
```bash
doctl compute droplet create saladee-api \
  --region sgp1 --size s-1vcpu-1gb --image ubuntu-24-04-x64 \
  --ssh-keys <YOUR_SSH_KEY_FINGERPRINT> --wait
```

## 2. Run the provisioning script (as root, on the droplet)

```bash
ssh root@<DROPLET_IP>
# grab the script (works once main has the code; otherwise scp it up first):
curl -fsSLO https://raw.githubusercontent.com/chonlatee11/saladee-system/main/deploy/provision-droplet.sh
bash provision-droplet.sh
```
It: creates the `saladee` user, installs Bun 1.3.14 + Caddy, generates a **GitHub
deploy key** (prints the public key — add it under repo → Settings → Deploy keys,
then **re-run the script** to finish the clone), installs the systemd unit + Caddyfile
(domain auto-set to `<ip>.sslip.io`), opens the firewall, and enables passwordless
`systemctl restart saladee-api` for CI.

> Using branch `develop` instead of `main` for now? Run with `DEPLOY_BRANCH=develop bash provision-droplet.sh`.

## 3. Place the runtime secrets on the droplet

The systemd service reads **all** env vars from `/opt/saladee/api/.env` (mode 600).
The CI workflow does *not* create this file, so copy your verified local one up:
```bash
# from your laptop, in the repo root:
scp api/.env root@<DROPLET_IP>:/opt/saladee/api/.env
# on the droplet:
chown saladee:saladee /opt/saladee/api/.env && chmod 600 /opt/saladee/api/.env
```
(Ensure `.env` has the pooled `DATABASE_URL` for runtime + all R2_/LINE_/JWT vars.
`R2_ENDPOINT` must NOT be set — prod uses the real R2 endpoint.)

## 4. Start + verify (Criterion 1)

```bash
systemctl start saladee-api && systemctl status saladee-api --no-pager
curl -sSf https://<ip>.sslip.io/health        # {"status":"ok"}  ✅ Criterion 1 (HTTPS)
curl -sSf https://<ip>.sslip.io/health/ready   # {"status":"ready"} (prod Neon)
```

## 5. Wire LINE + verify echo (Criterion 4)

- LINE Developers Console → Messaging API channel → Webhook URL =
  `https://<ip>.sslip.io/webhook` → enable **Use webhook**.
- Send a message to the OA → expect an echo reply. ✅ Criterion 4.
- Forgery check: `curl -X POST https://<ip>.sslip.io/webhook -d '{}' -H 'x-line-signature: bad'`
  → expect **401**.

## 6. (Optional) Enable CI auto-deploy on push

The `deploy-api.yml` workflow SSHes in on push to **`main`** touching `api/**`, then
`git pull` → `db:migrate` (DIRECT url) → `systemctl restart saladee-api`.

1. Generate a CI keypair and authorize it on the droplet:
   ```bash
   ssh-keygen -t ed25519 -f saladee-ci -N ""          # local
   ssh-copy-id -i saladee-ci.pub saladee@<DROPLET_IP>  # or append .pub to saladee's authorized_keys
   ```
2. Add GitHub → Settings → Secrets and variables → Actions:
   `VPS_HOST=<DROPLET_IP>`, `VPS_USER=saladee`, `VPS_SSH_KEY=<contents of saladee-ci>`,
   `DATABASE_URL_DIRECT=…` (+ the rest already listed in 00-07-SUMMARY deferred items).
3. **Get the code onto `main`:** the foundation currently lives on
   `gsd/phase-00-foundation-platform` / `develop`. Merge it to `main` and push to
   trigger the first deploy (or set `DEPLOY_BRANCH=develop` in step 2 and change the
   workflow's `on.push.branches` to `develop`).

---

### What this closes
- ✅ Criterion 1 — live HTTPS `/health` with a valid cert
- ✅ Criterion 4 — real LINE echo + 401 on forged signature
- Criteria 2 (Neon) & 3 (R2) already verified via `bun run smoke:neon` / `smoke:r2`.

Then Phase 0 is fully done — update ROADMAP `00-07` to `[x]` and clear the STATE
deferred items.
