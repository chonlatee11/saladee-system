#!/usr/bin/env bash
# provision-droplet.sh — one-shot provisioning for a DigitalOcean Ubuntu 24.04
# droplet that hosts the Saladee API (Bun/Elysia) behind Caddy (auto-HTTPS).
#
# Matches the committed config exactly:
#   user=saladee  repo=/opt/saladee  bun=/home/saladee/.bun/bin/bun
#   env=/opt/saladee/api/.env (mode 600)  systemd=saladee-api  caddy→localhost:3000
#
# HTTPS domain: a free sslip.io hostname derived from the droplet's public IP
# (Let's Encrypt issues a real, publicly-trusted cert for it — good enough for
# LINE webhook + temporary use; swap for a real domain later by editing Caddyfile).
#
# RUN AS ROOT on a fresh droplet. Safe to re-run (idempotent-ish):
#     # from your laptop (simplest — the script lives on the develop branch):
#     scp deploy/provision-droplet.sh root@<droplet-ip>:~/
#     ssh root@<droplet-ip> 'bash provision-droplet.sh'
#
# Override defaults via env vars, e.g.  DEPLOY_BRANCH=main DOMAIN=api.example.com bash provision-droplet.sh
set -euo pipefail

REPO_URL="${REPO_URL:-git@github.com:chonlatee11/saladee-system.git}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-develop}"   # deploy-api.yml triggers on develop (foundation lives here)
BUN_VERSION="${BUN_VERSION:-1.3.14}"
APP_USER="saladee"
APP_DIR="/opt/saladee"
API_DIR="${APP_DIR}/api"
BUN_BIN="/home/${APP_USER}/.bun/bin/bun"

if [ "$(id -u)" -ne 0 ]; then echo "ERROR: run as root." >&2; exit 1; fi

# --- public IP + sslip.io domain -------------------------------------------------
PUBLIC_IP="$(curl -fsS http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address 2>/dev/null || curl -fsS https://ifconfig.me 2>/dev/null || true)"
if [ -z "$PUBLIC_IP" ]; then echo "ERROR: could not detect public IP; set DOMAIN=… manually." >&2; exit 1; fi
DOMAIN="${DOMAIN:-${PUBLIC_IP}.sslip.io}"
echo "==> Public IP: ${PUBLIC_IP}"
echo "==> API domain (Caddy/Let's Encrypt): ${DOMAIN}"

# --- base packages --------------------------------------------------------------
echo "==> apt: base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git unzip ufw debian-keyring debian-archive-keyring apt-transport-https gnupg

# --- service account ------------------------------------------------------------
if ! id "$APP_USER" >/dev/null 2>&1; then
  echo "==> creating user ${APP_USER}"
  useradd -m -s /bin/bash "$APP_USER"
fi

# --- Bun (as the service user) --------------------------------------------------
if [ ! -x "$BUN_BIN" ]; then
  echo "==> installing Bun ${BUN_VERSION} for ${APP_USER}"
  sudo -u "$APP_USER" bash -c "curl -fsSL https://bun.sh/install | bash -s 'bun-v${BUN_VERSION}'"
else
  echo "==> Bun already present: $($BUN_BIN --version)"
fi

# --- deploy key for pulling the (private) repo ----------------------------------
KEY_PATH="/home/${APP_USER}/.ssh/id_ed25519"
if [ ! -f "$KEY_PATH" ]; then
  echo "==> generating a read-only deploy key for GitHub"
  sudo -u "$APP_USER" mkdir -p "/home/${APP_USER}/.ssh"
  sudo -u "$APP_USER" ssh-keygen -t ed25519 -N "" -f "$KEY_PATH" -C "saladee-droplet-deploy"
  sudo -u "$APP_USER" ssh-keyscan github.com >> "/home/${APP_USER}/.ssh/known_hosts" 2>/dev/null || true
fi

# --- clone the repo -------------------------------------------------------------
if [ ! -d "${APP_DIR}/.git" ]; then
  echo ""
  echo "############################################################"
  echo "# ADD THIS PUBLIC KEY AS A GITHUB DEPLOY KEY (read-only),   #"
  echo "# then re-run this script to continue the clone:            #"
  echo "#   GitHub repo → Settings → Deploy keys → Add deploy key   #"
  echo "############################################################"
  cat "${KEY_PATH}.pub"
  echo "############################################################"
  # Attempt the clone; if auth not yet set up, exit cleanly and let the user re-run.
  if sudo -u "$APP_USER" git clone --branch "$DEPLOY_BRANCH" "$REPO_URL" "$APP_DIR" 2>/tmp/clone.err; then
    echo "==> cloned ${REPO_URL} (${DEPLOY_BRANCH}) → ${APP_DIR}"
  else
    echo ""
    echo "Clone failed (likely the deploy key isn't added yet):"
    sed 's/^/    /' /tmp/clone.err
    echo "Add the key above as a GitHub deploy key, then re-run this script."
    exit 0
  fi
else
  echo "==> repo already at ${APP_DIR}; pulling latest ${DEPLOY_BRANCH}"
  sudo -u "$APP_USER" git -C "$APP_DIR" fetch origin "$DEPLOY_BRANCH"
  sudo -u "$APP_USER" git -C "$APP_DIR" checkout "$DEPLOY_BRANCH"
  sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only origin "$DEPLOY_BRANCH"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# --- install API deps -----------------------------------------------------------
echo "==> bun install (frozen)"
sudo -u "$APP_USER" bash -c "cd '$API_DIR' && '$BUN_BIN' install --frozen-lockfile"

# --- Caddy (official apt repo) --------------------------------------------------
if ! command -v caddy >/dev/null 2>&1; then
  echo "==> installing Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -y && apt-get install -y caddy
fi

# Render /etc/caddy/Caddyfile from the committed template, substituting the domain.
echo "==> writing /etc/caddy/Caddyfile for ${DOMAIN}"
sed "s/api\.saladee\.example/${DOMAIN}/" "${APP_DIR}/Caddyfile" > /etc/caddy/Caddyfile
systemctl reload caddy 2>/dev/null || systemctl restart caddy

# --- systemd unit for the API ---------------------------------------------------
echo "==> installing systemd unit saladee-api"
cp "${APP_DIR}/deploy/saladee-api.service" /etc/systemd/system/saladee-api.service
systemctl daemon-reload
systemctl enable saladee-api >/dev/null 2>&1 || true

# --- passwordless restart for the deploy user (deploy-api.yml uses sudo) --------
echo "==> sudoers: allow ${APP_USER} to restart saladee-api"
echo "${APP_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl restart saladee-api" > /etc/sudoers.d/saladee-deploy
chmod 440 /etc/sudoers.d/saladee-deploy

# --- firewall -------------------------------------------------------------------
echo "==> ufw: allow SSH/80/443"
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 80/tcp  >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
yes | ufw enable   >/dev/null 2>&1 || true

# --- final instructions ---------------------------------------------------------
ENV_PRESENT="no"; [ -f "${API_DIR}/.env" ] && ENV_PRESENT="yes"
cat <<EOF

==================== PROVISION COMPLETE ====================
Domain            : https://${DOMAIN}
Repo              : ${APP_DIR} (branch ${DEPLOY_BRANCH})
API env file      : ${API_DIR}/.env  (present: ${ENV_PRESENT})
Deploy user       : ${APP_USER}   (for GitHub secret VPS_USER)
Deploy host       : ${PUBLIC_IP}   (for GitHub secret VPS_HOST)

NEXT STEPS
1. If API env file is 'no': copy your real api/.env to the droplet, e.g. from your laptop:
     scp api/.env root@${PUBLIC_IP}:${API_DIR}/.env
   then on the droplet:
     chown ${APP_USER}:${APP_USER} ${API_DIR}/.env && chmod 600 ${API_DIR}/.env
2. Start the API:
     systemctl start saladee-api && systemctl status saladee-api --no-pager
3. Smoke test HTTPS (Criterion 1):
     curl -sSf https://${DOMAIN}/health         # -> {"status":"ok"}
     curl -sSf https://${DOMAIN}/health/ready    # -> {"status":"ready"} (prod Neon)
4. Point LINE Messaging webhook at:  https://${DOMAIN}/webhook   (enable "Use webhook")
5. For CI auto-deploy, add GitHub Actions secrets: VPS_HOST=${PUBLIC_IP}, VPS_USER=${APP_USER},
   VPS_SSH_KEY=<a private key whose public half is in the droplet's ${APP_USER} authorized_keys>,
   plus DATABASE_URL_DIRECT (and the rest). Deploy triggers on push to '${DEPLOY_BRANCH}'.
===========================================================
EOF
