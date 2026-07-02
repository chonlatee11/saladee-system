#!/usr/bin/env bash
# provision-droplet-docker.sh — provision a DigitalOcean Ubuntu 24.04 droplet to
# run the Saladee API as Docker (API + Caddy containers; DB external on Neon).
#
# Installs Docker Engine + compose plugin, clones the repo, and brings the stack
# up. HTTPS domain defaults to a free sslip.io hostname from the droplet's IP.
#
# RUN AS ROOT. Re-runnable (idempotent-ish):
#     scp deploy/provision-droplet-docker.sh root@<ip>:~/
#     ssh root@<ip> 'bash provision-droplet-docker.sh'
#
# Overrides: DEPLOY_BRANCH=main DOMAIN=api.example.com bash provision-droplet-docker.sh
set -euo pipefail

REPO_URL="${REPO_URL:-git@github.com:chonlatee11/saladee-system.git}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-develop}"
APP_USER="saladee"
APP_DIR="/opt/saladee"

[ "$(id -u)" -eq 0 ] || { echo "ERROR: run as root." >&2; exit 1; }

PUBLIC_IP="$(curl -fsS http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address 2>/dev/null || curl -fsS https://ifconfig.me 2>/dev/null || true)"
[ -n "$PUBLIC_IP" ] || { echo "ERROR: could not detect public IP; set DOMAIN=… manually." >&2; exit 1; }
DOMAIN="${DOMAIN:-${PUBLIC_IP}.sslip.io}"
echo "==> IP=${PUBLIC_IP}  DOMAIN=${DOMAIN}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ufw ca-certificates gnupg

# --- Docker Engine + compose plugin (official repo) -----------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "==> installing Docker Engine"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

# --- deploy user (CI SSH target; in docker group so it can run compose) ---------
id "$APP_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$APP_USER"
usermod -aG docker "$APP_USER"

# --- read-only deploy key + clone ----------------------------------------------
KEY="/home/${APP_USER}/.ssh/id_ed25519"
if [ ! -f "$KEY" ]; then
  sudo -u "$APP_USER" mkdir -p "/home/${APP_USER}/.ssh"
  sudo -u "$APP_USER" ssh-keygen -t ed25519 -N "" -f "$KEY" -C "saladee-droplet-deploy"
  sudo -u "$APP_USER" bash -c "ssh-keyscan github.com >> /home/${APP_USER}/.ssh/known_hosts 2>/dev/null" || true
fi
if [ ! -d "${APP_DIR}/.git" ]; then
  echo "#### ADD THIS PUBLIC KEY AS A GITHUB DEPLOY KEY (read-only), then re-run: ####"
  cat "${KEY}.pub"
  echo "##############################################################################"
  if sudo -u "$APP_USER" git clone --branch "$DEPLOY_BRANCH" "$REPO_URL" "$APP_DIR" 2>/tmp/clone.err; then
    echo "==> cloned ${DEPLOY_BRANCH}"
  else
    sed 's/^/    /' /tmp/clone.err
    echo "Clone failed — add the deploy key above, then re-run this script."
    exit 0
  fi
else
  sudo -u "$APP_USER" git -C "$APP_DIR" fetch origin "$DEPLOY_BRANCH"
  sudo -u "$APP_USER" git -C "$APP_DIR" checkout "$DEPLOY_BRANCH"
  sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only origin "$DEPLOY_BRANCH"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# --- compose env (API_DOMAIN for the Caddy container) ---------------------------
echo "API_DOMAIN=${DOMAIN}" > "${APP_DIR}/deploy/.env"
chown "$APP_USER:$APP_USER" "${APP_DIR}/deploy/.env"

# --- firewall -------------------------------------------------------------------
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 80/tcp  >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
yes | ufw enable  >/dev/null 2>&1 || true

ENV_PRESENT="no"; [ -f "${APP_DIR}/api/.env" ] && ENV_PRESENT="yes"
if [ "$ENV_PRESENT" = "yes" ]; then
  echo "==> api/.env present — bringing the stack up"
  ( cd "${APP_DIR}/deploy" && docker compose -f docker-compose.prod.yml up -d --build )
fi

cat <<EOF

==================== DOCKER PROVISION COMPLETE ====================
Domain     : https://${DOMAIN}
Repo       : ${APP_DIR} (${DEPLOY_BRANCH})
api/.env   : present=${ENV_PRESENT}

NEXT
$([ "$ENV_PRESENT" = "no" ] && echo "1. Copy secrets up, then launch:
     scp api/.env root@${PUBLIC_IP}:${APP_DIR}/api/.env
     ssh root@${PUBLIC_IP} 'cd ${APP_DIR}/deploy && docker compose -f docker-compose.prod.yml up -d --build'" || echo "1. Stack is starting. Give Caddy ~30s to issue the cert.")
2. Verify:
     curl -sSf https://${DOMAIN}/health         # {"status":"ok"}  (Criterion 1)
     curl -sSf https://${DOMAIN}/health/ready    # {"status":"ready"} (prod Neon)
3. LINE webhook -> https://${DOMAIN}/webhook  (Criterion 4)
==================================================================
EOF
