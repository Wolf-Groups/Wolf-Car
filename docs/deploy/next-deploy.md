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
- Landing page: **WolfOS** (our app for the BYD Leopard's screens, wolfcaros.com). A lit "تطبيقنا" button in the
  header (on phones too, and first in the menu) and a dark section under the hero; both open wolfcaros.com in a new
  tab. The header's page links now show from 1280px wide (below that they are in the menu). Dashboard → visitor
  statistics gets a "WolfOS presses" tile.
- Card orders: before the expiry sweep cancels an unpaid card order it asks Tap about the payment. A customer who
  paid and closed the page before coming back (and whose webhook never came) gets a paid order and the receipt,
  not a cancelled one. Checked against Tap's sandbox on 2026-11-04.
- Every page of the website now sends HSTS (`max-age=31536000; includeSubDomains`, as the API already did) and
  `X-Content-Type-Options: nosniff`, and no longer says `X-Powered-By: Next.js`.
- Library security updates (2026-11-05): `next` 16.4.5, NestJS 12.3.3, `multer` 2.5.0, `prisma` 7.10.1, `sharp` 0.35.5,
  `zod` 4.6.7, `vitest` 5.1.0, plus the fixed sub-packages. `npm audit`: website 0; API 5 *low*, all one package
  (`deepmerge` inside the test runner `jest`, never on the server; no fixed version exists yet).
- In production the API's CORS list keeps only `https://` origins: the `http://localhost:3000` still in the server's
  `CORS_ORIGINS` no longer counts.
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
- Optional clean-up: remove `SMS_PROVIDER` and `OTP_PER_PHONE_PER_15_MIN` (no longer read), and `http://localhost:3000`
  from `CORS_ORIGINS` (the new API ignores `http://` origins in production anyway).

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
4. [ ] Showroom page on a phone (2 per row) and on the big screen. Landing page on a phone: "تطبيقنا" in the
       header and the WolfOS section open wolfcaros.com; the press shows in Dashboard → visitor statistics.
5. [ ] Headers: `curl -sI https://wolfcar.qa/ar` shows `strict-transport-security` and no `x-powered-by`.
6. [ ] Logs if anything is off: `cd /opt/wolfcar/app && docker compose -f compose.prod.yml logs api --since 15m | grep -iE "email|brevo|sign-in|error"`.

## Security checks done on 2026-11-04 (this branch, local copy)

- **Code review** of the whole branch (security only): no exploitable finding. Checked: guest order keys (HMAC,
  constant-time, bound to the order), customer cookie scope, a guest using someone else's email (no session, no
  change to that customer, sees only their own order), email codes (random, bound to the email, 5 guesses per code,
  single use), test-only switches refused in production, email HTML escaping, the webhook signature, the expiry
  sweep, the call center permission (website orders only, no refund of a paid card order), CSRF, the migration SQL.
- **Attacks on the running API** (59 tries): all refused or handled correctly. Price/total/payment-status tampering,
  bad quantities, foreign mobiles, header breaks in the email, HTML in the name; another order's key (whole,
  one character changed, shortened, upper-cased, in the URL); guest keys and customer cookies on staff routes;
  forged and unsigned webhooks; wrong-code guessing, a code used for another email or used twice; CORS from a
  foreign origin; no stack traces, internal ids or secrets in answers. Rate limit: 10 a minute per visitor on
  placing orders and on sign-in codes.
- **Live site** (read only): no `/.env`, `/.git`, docs or metrics exposed; http redirects to https; Tap's webhook
  route answers from the internet (`503` while card payments are off), so Tap will reach it.
- [x] **Library updates** (done 2026-11-05, see "What this deploy brings"). Checked after: API unit 723/723 and
      e2e 998/999, website lint/types clean, vitest and Playwright with only the failures listed in section 5 or
      known from before, both Docker images built with `npm ci`, the 59 attacks again with the same results.
      The dev-only `minimatch`/`glob` fixes are `overrides` in `package.json` and `api/package.json`; drop them once
      `typescript-eslint`, `@nestjs/cli` and `jest` ship the fixed versions themselves.

## 5. Still open from before (not blocking this deploy)

- [ ] **Card payments stay off** until `NEXT_PUBLIC_TAP_PUBLIC_KEY=pk_live_…` is in `deploy/prod.env` (baked in at
      build) and `TAP_SECRET_KEY=sk_live_…` in `api.prod.env`. Without the key the site takes pay-at-branch orders only.
      Sandbox on 2026-11-04 (local site, guest checkout): Visa `4012000033330026` is **captured** again → paid page,
      receipt email, refund from the dashboard (`REFUNDED`), Tap refuses a second refund. The 3-D Secure challenge cards
      (`4508750015741019`, `5123450000000008`) still end in `701 RESTRICTED`: ask Tap (Ramy) whether real cards that
      get a bank challenge will be refused like this with live keys (questions in README section 11).
- [ ] **Tap's webhook** is still untested end to end (Tap must reach the API from the internet; Claude's safety check
      refuses to open a tunnel on its own). The signature check matches Tap's documented formula. Either test it
      locally with a tunnel the owner opens (README section 11, "Run it locally with Tap test keys"), or after the first live
      payment check the activity log for `shop.payment.webhook` (outcome *paid* / *already_paid*), not only
      `shop.order.reconcile`. A `401 BAD_SIGNATURE` in the API log on that route means the hashstring check is off.
- [ ] **SSH hardening**: port 22 is still public; run `deploy/harden-ssh.sh` as in README "Server access (SSH)".
- [ ] **Refund policy page** (`/ar/refund-policy`) is a draft: the owner confirms the terms.
- [ ] **Odoo** writing for paid card orders: `ODOO_WRITE_LOGIN`, `ODOO_WRITE_API_KEY`, `ODOO_WEB_WAREHOUSE_ID`, `ODOO_FALLBACK_PRODUCT_ID`.
- [ ] Refresh the Playwright landing screenshots (the header now shows "My account").
- Small follow-ups left on purpose: order emails are sent inside the request (a slow Brevo slows that response);
  `text-align:end` in the email tables (old Outlook ignores it); no clean-up of guest customer rows; pay/cancel by
  order key logs no actor name.
