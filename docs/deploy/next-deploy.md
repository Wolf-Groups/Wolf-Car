# Next deploy: what is still missing (written 2026-11-04)

> للمالك: هذا الملف فيه كل اللي باقي قبل وبعد رفع هالتحديث على السيرفر. Claude على أي جهاز يقرأه تلقائيًا
> (مربوط في `CLAUDE.md`). اشطب السطر لما يخلص، واحذف الملف لما يخلص كل شي.

**For Claude:** read this before any deploy or server work and help the owner through the open items, in order.
Never write a key or password into this file, the repo, or the chat; they go only into the server's env files.
Ask the owner for each value and have them paste it on the server.

## What this deploy brings

Branch `feat/email-guest-checkout` (spec: `docs/superpowers/specs/2026-11-04-email-guest-checkout-design.md`,
plan: `docs/superpowers/plans/2026-11-04-email-guest-checkout.md`, README section 11):

- No SMS. Sign-in codes, order emails and staff alerts go by email through **Brevo**.
- Guests buy without an account (name, Qatari mobile for calls only, email); **pay by card** (Tap) or **pay at the branch**.
- Thank-you page; "My account" signs in by email code; guest orders show up there under the same email.
- Dashboard orders page opens on **website orders**; showroom orders are a second tab.
- The **call center** (role Reservations) gets the new permission `order.web.handle`: it reads every order and
  confirms, cancels and hands over website orders. Granted by itself on the first start of the new API.
- Showroom kiosk grid: 2 cards per row on phones, ~6 per row on the big screen.
- DB migration `20261104100000_email_customers`: email becomes the customer identity. **Irreversible**: drops the
  phone unique index, deletes all `customer_otps`, lower-cases and de-duplicates customer emails.

## 1. Owner: Brevo (email) — needed before customers can sign in

- [ ] **New API key.** The key shared in the chat on 2026-11-04 must be replaced: Brevo → SMTP & API →
      *API keys & MCP* → *Generate a new API key* (starts with `xkeysib-`), then delete the old one.
      Also delete the SMTP key generated that day (tab *SMTP*), but **keep "WolfCarOs (Adel)"**: another system uses it.
- [ ] **Authorized IPs.** Brevo blocks unknown IPs (the API answers `401 unauthorized … unrecognised IP address`).
      Add the server's IP `167.172.106.106` (and its IPv6 if it sends over IPv6) at
      https://app.brevo.com/security/authorised_ips. Check from the server:
      `curl -s -o /dev/null -w "%{http_code}\n" https://api.brevo.com/v3/account -H "api-key: <key>"` → `200`.
- [ ] **Sender.** `wolf-groups.com` and `wolfcaros.com` are authenticated in Brevo; `wolfcar.qa` is not. Start with
      `noreply@wolf-groups.com`. Later (optional): add `wolfcar.qa` under Senders, domains & IPs → Domains, publish its
      DNS records, then switch `EMAIL_FROM` to `orders@wolfcar.qa`.
- Free plan: **300 emails a day, shared** with the account's other systems (Wolf Car OS…). When it runs out,
  sign-in answers "not available" and orders still go through. Upgrade the plan if the site gets busy.

## 2. Owner: server settings — `/opt/wolfcar/app/deploy/api.prod.env`

Safe to add before the new code is deployed (the running version ignores them). Template: `deploy/api.prod.env.example`.

- [ ] `EMAIL_PROVIDER=brevo`
- [ ] `BREVO_API_KEY=<the new key>`
- [ ] `EMAIL_FROM=noreply@wolf-groups.com`
- [ ] `EMAIL_FROM_NAME=Wolf Car`
- [ ] `SHOP_NOTIFY_EMAIL=<call center email>,<manager email>` (who hears about every new website order)
- [ ] Check `TRUST_PROXY=loopback, uniquelocal` is there (per-visitor rate limits depend on it).
- Optional clean-up: remove `SMS_PROVIDER` and `OTP_PER_PHONE_PER_15_MIN` (no longer read).

## 3. Deploy

- [ ] Check which GitHub repo the server pulls: `git -C /opt/wolfcar/app remote -v`. `deploy/server-setup.sh` clones
      `OmarElbasel/Wolf-Car`, this laptop's `origin` is `Wolf-Groups/Wolf-Car`: the branch must reach the one the server uses.
- [ ] Review and merge `feat/email-guest-checkout` into `main`, then `main` into `production`. Pushing `production`
      runs `.github/workflows/deploy.yml` → `scripts/deploy.sh` on the server.
- [ ] Before that push, take a database backup on the server: `/opt/wolfcar/app/scripts/backup.sh` (the migration cannot be undone).

## 4. After the deploy: checks (on the live site)

1. [ ] `/ar/account` → sign in with your own email: the code arrives. `503` "not available" = `EMAIL_PROVIDER` is not
       `brevo`; no email = look at the API log for `Brevo answered …` (`unauthorized` → IP allowlist or key).
2. [ ] Place an order "pay at the branch" with your own email: thank-you page, the customer email, and the staff
       alert at `SHOP_NOTIFY_EMAIL`.
3. [ ] Sign in as a call center user → Orders → *Website orders* shows it → Confirm. Then as the Bin Omran cashier →
       Mark collected. Then cancel your test orders.
4. [ ] Showroom page on a phone (2 per row) and on the big screen.
5. [ ] Logs if anything is off: `cd /opt/wolfcar/app && docker compose -f compose.prod.yml logs api --since 15m | grep -iE "email|brevo|sign-in|error"`.

## 5. Still open from before (not blocking this deploy)

- [ ] **Card payments stay off** until `NEXT_PUBLIC_TAP_PUBLIC_KEY=pk_live_…` is in `deploy/prod.env` (baked in at
      build) and `TAP_SECRET_KEY=sk_live_…` in `api.prod.env`. Tap's sandbox has answered `701 RESTRICTED` on every
      card since 2026-10-28: ask Tap (Ramy) first; questions in README section 11. Without the key the site takes
      pay-at-branch orders only.
- [ ] **SSH hardening**: port 22 is still public; run `deploy/harden-ssh.sh` as in README "Server access (SSH)".
- [ ] **Refund policy page** (`/ar/refund-policy`) is a draft: the owner confirms the terms.
- [ ] **Odoo** writing for paid card orders: `ODOO_WRITE_LOGIN`, `ODOO_WRITE_API_KEY`, `ODOO_WEB_WAREHOUSE_ID`, `ODOO_FALLBACK_PRODUCT_ID`.
- [ ] Refresh the Playwright landing screenshots (the header now shows "My account").
- Small follow-ups left on purpose: order emails are sent inside the request (a slow Brevo slows that response);
  `text-align:end` in the email tables (old Outlook ignores it); no clean-up of guest customer rows; pay/cancel by
  order key logs no actor name.
