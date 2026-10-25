#!/usr/bin/env bash
# Locks SSH down to the Tailscale network, as asked by the Tap security review:
#   - SSH reachable only over Tailscale (ufw drops the public port 22 rule)
#   - no password login, no direct root login; admins use a normal account + sudo
#   - GitHub deploys as the unprivileged `deploy` user (docker group)
#   - OS packages updated; lists every authorised key for review
#
# Safe to re-run. It never removes the public SSH rule or forbids root login
# unless THIS session already proves the new path works: you are connected over
# Tailscale and signed in as the admin user (sudo), not as root. So run it twice:
#
#   1st run, as root over the public IP (today's path):
#        bash /opt/wolfcar/app/deploy/harden-ssh.sh
#      -> installs Tailscale if needed, creates the admin and deploy users,
#         disables password login, allows SSH on tailscale0. Public port 22 stays
#         open for now.
#   2nd run, over Tailscale as the admin user:
#        ssh <ADMIN_USER>@<100.x tailscale ip>
#        sudo bash /opt/wolfcar/app/deploy/harden-ssh.sh
#      -> closes public port 22, sets PermitRootLogin no, moves the CI key off
#         root. Then set the GitHub secret DEPLOY_SSH_USER=deploy.
#
# Settings (environment variables):
#   ADMIN_USER   admin account to create, default "wolf"
#   DEPLOY_USER  deploy account, default "deploy"
#   APP_DIR      app checkout, default /opt/wolfcar/app
set -euo pipefail
ADMIN_USER="${ADMIN_USER:-wolf}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
APP_DIR="${APP_DIR:-/opt/wolfcar/app}"
SSHD_DROPIN=/etc/ssh/sshd_config.d/00-wolfcar-hardening.conf   # 00- so it wins over 50-cloud-init.conf
export DEBIAN_FRONTEND=noninteractive

[[ $EUID -eq 0 ]] || { echo "run as root (sudo bash $0)" >&2; exit 1; }

say() { printf '\n== %s\n' "$*"; }

# ---------------------------------------------------------------- Tailscale
say "Tailscale"
if ! command -v tailscale >/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
systemctl enable --now tailscaled
TS_IP="$(tailscale ip -4 2>/dev/null || true)"
if [[ -z "$TS_IP" ]]; then
  echo "Tailscale is installed but this server is not in the tailnet yet." >&2
  echo "Run:  tailscale up      (open the printed link, sign in), then re-run this script." >&2
  exit 2
fi
echo "server tailscale ip: $TS_IP"

# Is this very session arriving over Tailscale, as a non-root sudo user?
# SSH_CONNECTION = "client_ip client_port server_ip server_port"; sudo keeps it
# for the admin (env_keep below). Fallback: the client address in utmp is a
# Tailscale one (100.64.0.0/10).
SERVER_IP="${SSH_CONNECTION:-}"; SERVER_IP="${SERVER_IP#* * }"; SERVER_IP="${SERVER_IP%% *}"
CLIENT_IP="$(who am i 2>/dev/null | sed -n 's/.*(\(.*\)).*/\1/p')"
over_tailscale=0
[[ -n "${SSH_CONNECTION:-}" && "$SERVER_IP" == "$TS_IP" ]] && over_tailscale=1
[[ "$CLIENT_IP" =~ ^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\. ]] && over_tailscale=1
as_admin=0; [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]] && as_admin=1
final=0; (( over_tailscale && as_admin )) && final=1
echo "this session: over tailscale=$over_tailscale, as admin via sudo=$as_admin -> $([[ $final == 1 ]] && echo 'FINAL lockdown' || echo 'phase 1 (public SSH kept open)')"

# ---------------------------------------------------------------- accounts
say "Admin account: $ADMIN_USER"
if ! id "$ADMIN_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$ADMIN_USER"
fi
usermod -aG sudo "$ADMIN_USER"
printf '%s ALL=(ALL) NOPASSWD:ALL\nDefaults:%s env_keep += "SSH_CONNECTION"\n' "$ADMIN_USER" "$ADMIN_USER" > "/etc/sudoers.d/90-$ADMIN_USER"
chmod 440 "/etc/sudoers.d/90-$ADMIN_USER"
visudo -cf "/etc/sudoers.d/90-$ADMIN_USER" >/dev/null
# root's personal keys (anything without a forced command) become the admin's keys
install -d -m 700 -o "$ADMIN_USER" -g "$ADMIN_USER" "/home/$ADMIN_USER/.ssh"
touch "/home/$ADMIN_USER/.ssh/authorized_keys"
if [[ -f /root/.ssh/authorized_keys ]]; then
  grep -v 'command=' /root/.ssh/authorized_keys | grep -E '^(ssh-|ecdsa-|sk-)' | while read -r key; do
    grep -qF "$key" "/home/$ADMIN_USER/.ssh/authorized_keys" || echo "$key" >> "/home/$ADMIN_USER/.ssh/authorized_keys"
  done
fi
chown "$ADMIN_USER:$ADMIN_USER" "/home/$ADMIN_USER/.ssh/authorized_keys"; chmod 600 "/home/$ADMIN_USER/.ssh/authorized_keys"
[[ -s "/home/$ADMIN_USER/.ssh/authorized_keys" ]] || echo "WARNING: $ADMIN_USER has no keys; add yours to /home/$ADMIN_USER/.ssh/authorized_keys before the final run" >&2

say "Deploy account: $DEPLOY_USER (GitHub Actions)"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
touch "/home/$DEPLOY_USER/.ssh/authorized_keys"
# the CI key is the one with a forced command; copy it now, remove it from root on the final run
if [[ -f /root/.ssh/authorized_keys ]]; then
  grep 'command=' /root/.ssh/authorized_keys | while read -r key; do
    grep -qF "$key" "/home/$DEPLOY_USER/.ssh/authorized_keys" || echo "$key" >> "/home/$DEPLOY_USER/.ssh/authorized_keys"
  done
fi
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"; chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
if [[ -d "$APP_DIR/.git" ]]; then
  chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"
  chmod 600 "$APP_DIR"/deploy/*.env 2>/dev/null || true
  git config --system --replace-all safe.directory "$APP_DIR"   # root/admin may still run git there
fi
if (( final )) && [[ -f /root/.ssh/authorized_keys ]]; then
  sed -i '/command=/d' /root/.ssh/authorized_keys
  echo "CI key removed from root; GitHub must now connect as $DEPLOY_USER (secret DEPLOY_SSH_USER=$DEPLOY_USER)"
fi

# ---------------------------------------------------------------- sshd
say "sshd"
root_login=prohibit-password; (( final )) && root_login=no
cat > "$SSHD_DROPIN" <<CONF
# Written by deploy/harden-ssh.sh. Admins sign in as a normal user and use sudo.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitEmptyPasswords no
PubkeyAuthentication yes
PermitRootLogin $root_login
MaxAuthTries 4
X11Forwarding no
CONF
sshd -t
systemctl reload ssh || systemctl restart ssh
sshd -T | grep -iE '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication) '

# ---------------------------------------------------------------- firewall
say "ufw"
ufw --force enable >/dev/null
ufw allow in on tailscale0 to any port 22 proto tcp comment 'SSH over Tailscale only' >/dev/null
if (( final )); then
  for rule in "OpenSSH" "22/tcp" "22"; do ufw delete allow "$rule" >/dev/null 2>&1 || true; done
  if ufw status | grep -E '^(22|OpenSSH)' | grep -vq 'on tailscale0'; then
    echo "ERROR: a public SSH rule is still present:" >&2; ufw status numbered >&2; exit 1
  fi
  echo "public port 22 closed; SSH only via tailscale0"
else
  echo "public port 22 left open until the final run (see header)"
fi
ufw status | grep -E '^(22|OpenSSH|80|443)'

# ---------------------------------------------------------------- fail2ban, updates
say "updates"
systemctl enable --now fail2ban >/dev/null
apt-get update -qq
apt-get -y -qq upgrade
dpkg -l openssh-server | awk '/^ii/{print "openssh-server", $3}'
[[ -f /var/run/reboot-required ]] && echo "REBOOT REQUIRED (kernel update): reboot when convenient" || echo "no reboot needed"

# ---------------------------------------------------------------- review
say "authorised keys — remove anyone who should not have access"
for f in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do
  [[ -s "$f" ]] || continue
  echo "-- $f"
  ssh-keygen -lf "$f" 2>/dev/null || true
done
say "accounts with a login shell"
awk -F: '$7 !~ /(nologin|false|sync)$/ {print "  " $1}' /etc/passwd

say "next"
if (( final )); then
  cat <<MSG
Done. From now on:
  ssh $ADMIN_USER@$TS_IP          (over Tailscale; use sudo for root tasks)
  GitHub: set secret DEPLOY_SSH_USER=$DEPLOY_USER, then re-run the Deploy workflow.
Check from a network without Tailscale:  nc -z -w 3 $(curl -4fsS https://api.ipify.org 2>/dev/null || echo '<public ip>') 22 || echo "22 closed"
MSG
else
  cat <<MSG
Phase 1 done. Keep THIS session open, then in a new terminal on your laptop (with Tailscale on):
  ssh $ADMIN_USER@$TS_IP
  sudo bash $APP_DIR/deploy/harden-ssh.sh      # final run: closes public 22, PermitRootLogin no
If that login fails, nothing is lost: fix the key in /home/$ADMIN_USER/.ssh/authorized_keys from this session.
MSG
fi
