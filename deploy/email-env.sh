#!/usr/bin/env bash
# Puts the Brevo email settings (a new key too) in the server's API env file.
# From the laptop: scp deploy/email-env.sh wolfadmin-ts:~/ && ssh -t wolfadmin-ts sudo bash ~/email-env.sh
# The API reads them when it next starts (a deploy, or: docker compose -f compose.prod.yml --env-file deploy/prod.env up -d api).
# Prints no secret. Keeps a copy of the file before changing it.
set -euo pipefail
ENV_FILE=/opt/wolfcar/app/deploy/api.prod.env
[[ -f "$ENV_FILE" ]] || { echo "missing $ENV_FILE" >&2; exit 1; }

backup="$ENV_FILE.bak-$(date +%Y%m%d-%H%M%S)"
cp -p "$ENV_FILE" "$backup"
echo "copy kept: $backup"

# set_var NAME VALUE: replace the NAME= line, or add it at the end
set_var() {
  local tmp
  tmp=$(mktemp "$ENV_FILE.XXXX")
  NAME="$1" VALUE="$2" awk '
    BEGIN { n = ENVIRON["NAME"]; v = ENVIRON["VALUE"]; done = 0 }
    index($0, n "=") == 1 { if (!done) print n "=" v; done = 1; next }
    { print }
    END { if (!done) print n "=" v }
  ' "$ENV_FILE" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
}

current() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }

read -r -s -p "Brevo API key (xkeysib-…, hidden): " key < /dev/tty; echo
[[ "$key" == xkeysib-* ]] || { echo "that does not start with xkeysib- — nothing changed" >&2; rm -f "$backup"; exit 1; }

read -r -p "Sender [noreply@wolf-groups.com]: " from < /dev/tty
from=${from:-noreply@wolf-groups.com}

read -r -p "Who gets the new-order alerts (emails, comma-separated): " notify < /dev/tty
notify=$(tr -d ' ' <<<"$notify")

echo
echo "Brevo from this server:"
body=$(mktemp)
# over IPv4, as the API container sends (Docker gives it no IPv6): the host's own IPv6 is not on Brevo's list
code=$(curl -4 -sS -o "$body" -w '%{http_code}' --max-time 20 https://api.brevo.com/v3/account -H "api-key: $key") || code=000
if [[ "$code" == 200 ]]; then
  echo "  OK (200): the key works and this server's IP is allowed"
else
  echo "  NOT OK ($code): $(grep -o '"message":"[^"]*"' "$body" | head -1)"
  echo "  'unrecognised IP' = add 167.172.106.106 in Brevo → Security → Authorized IPs; 'Key not found' = wrong key."
  echo "  The settings are saved anyway; run this again after fixing it in Brevo to re-check."
fi
rm -f "$body"

set_var EMAIL_PROVIDER brevo
set_var BREVO_API_KEY "$key"
set_var EMAIL_FROM "$from"
set_var EMAIL_FROM_NAME "Wolf Car"
set_var SHOP_NOTIFY_EMAIL "$notify"
set_var OTP_PER_EMAIL_PER_15_MIN 3
unset key

echo
echo "Saved. Settings the new version also needs (not secret):"
for v in WEB_PUBLIC_URL API_PUBLIC_URL TRUST_PROXY CORS_ORIGINS EMAIL_FROM SHOP_NOTIFY_EMAIL; do
  printf '  %-18s %s\n' "$v" "$(current "$v")"
done
[[ "$(current WEB_PUBLIC_URL)" == https://wolfcar.qa ]] || { set_var WEB_PUBLIC_URL https://wolfcar.qa; echo "  WEB_PUBLIC_URL was missing or different: set to https://wolfcar.qa"; }
[[ "$(current API_PUBLIC_URL)" == https://wolfcar.qa ]] || { set_var API_PUBLIC_URL https://wolfcar.qa; echo "  API_PUBLIC_URL was missing or different: set to https://wolfcar.qa"; }
[[ -n "$(current TRUST_PROXY)" ]] || { set_var TRUST_PROXY "loopback, uniquelocal"; echo "  TRUST_PROXY was missing: set to loopback, uniquelocal"; }
echo "done"
