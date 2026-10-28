#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 droplet. Safe to re-run.
#   bash server-setup.sh you@example.com
set -euo pipefail
ACME_EMAIL="${1:?usage: server-setup.sh <email for certificate notices>}"
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get -y upgrade
apt-get install -y ca-certificates curl gnupg git ufw fail2ban unattended-upgrades \
  debian-keyring debian-archive-keyring apt-transport-https

# swap: next build needs more than 1 GB
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf
  sysctl -p /etc/sysctl.d/99-swap.conf
fi

# firewall: web only from the internet; SSH only over Tailscale (containers
# publish on 127.0.0.1, see compose.prod.yml). Public port 22 stays open only
# until deploy/harden-ssh.sh is run over Tailscale (it removes the rule itself).
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

# Tailscale: the only way in for SSH (admins and GitHub Actions)
if ! command -v tailscale >/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
systemctl enable --now tailscaled

# Docker Engine + Compose plugin (official apt repo)
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

# Caddy (official apt repo)
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

# app checkout — the server always runs the production branch
mkdir -p /opt/wolfcar
if [[ ! -d /opt/wolfcar/app/.git ]]; then
  git clone --branch production https://github.com/OmarElbasel/Wolf-Car.git /opt/wolfcar/app
fi

# Caddyfile (only if ours is not in it yet, so another project's blocks survive)
if ! grep -q 'Wolf Car' /etc/caddy/Caddyfile; then
  sed "s/__ACME_EMAIL__/$ACME_EMAIL/" /opt/wolfcar/app/deploy/Caddyfile > /etc/caddy/Caddyfile
  caddy validate --config /etc/caddy/Caddyfile
  systemctl reload caddy
fi

# nightly backup at 00:00 UTC (03:00 Qatar)
cat > /etc/cron.d/wolfcar-backup <<'CRON'
0 0 * * * root /opt/wolfcar/app/scripts/backup.sh >> /var/log/wolfcar-backup.log 2>&1
CRON

echo "setup done: $(docker --version), $(caddy version | cut -d' ' -f1), swap $(free -h | awk '/Swap/{print $2}')"

# SSH lockdown (admin + deploy users, no password login). Phase 1 here; the
# final run (close public 22, PermitRootLogin no) is done over Tailscale.
echo; echo "now join the tailnet with 'tailscale up', then: bash /opt/wolfcar/app/deploy/harden-ssh.sh"
