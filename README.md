# Wolf Car — website, staff dashboards and showroom ordering

This repository contains:

| Part | Where | What |
|---|---|---|
| **Website** | `app/[locale]/page.tsx`, `components/` | The public landing page (Arabic/English). Unchanged except for a **Product catalog** footer link. Staff sign in at `/login` (not linked from the site). |
| **Public catalog** | `app/[locale]/products` | Products with image, name, description, category and price. Barcodes never leave the API here. Products without a price cannot be bought online; they are ordered on WhatsApp. |
| **Online checkout** | `app/[locale]/checkout`, `features/shop/`, `api/src/shop/`, `api/src/email/` | A visitor fills a basket and orders without an account (name, mobile, email), paying by card through Tap or at the branch when collecting the parts at Bin Omran. Order emails and "My account" sign-in codes go by email through Brevo. Paid card orders are queued for Odoo. See section 11. |
| **Staff dashboards** | `app/[locale]/(app)/(staff)` | One login for everyone; the account's role decides the landing page. Products, pricing, orders, users, branches, permissions, activity log, account security. |
| **Showroom kiosk** | `app/[locale]/(app)/showroom` | Touch screen in each branch: customers pick products, staff submits the order. Own login and session. |
| **API** | `api/` | NestJS 12 + PostgreSQL (Prisma 7). Auth, RBAC, orders, online payments, Odoo sync, receipts (PDF), audit log. Swagger at `/api/docs`. |
| **Shared rules** | `shared/` | Permission keys, roles and validation rules used by both the API and the web app. |

```
browser ──► Next.js (web, :3000) ──/api/* rewrite──► NestJS API (:4000) ──► PostgreSQL
                │  landing · catalog · checkout · dashboards · showroom │  auth · RBAC · orders · PDF receipts
                                                                  ▲ │ Tap (charges, refunds) · Odoo (catalogue, sale orders)
```

The browser only ever talks to the Next.js origin; `/api/*` is proxied to the API, so the auth cookies are first‑party.

---

## 1. Requirements

- Node.js **22** (22.12 or newer) and npm
- PostgreSQL 17 — easiest with Docker (`docker compose`)
- Chromium for PDF receipts — for local development run `npx playwright install chromium` once (the Docker image ships Debian's Chromium)

## 2. Quick start (local development)

```bash
# 1. databases (dev on :5432, throwaway test DB on :5433)
docker compose up -d db db-test

# 2. API
cd api
cp .env.example .env          # then set JWT_ACCESS_SECRET and TOTP_ENCRYPTION_KEY (commands are in the file)
npm install
npx prisma migrate deploy     # create the schema
npm run db:seed               # demo accounts and branches (wipes the dev database!)
npm run db:import-legacy      # the real catalogue, from ../old products data
npm run start:dev             # http://localhost:4000/api  (Swagger: /api/docs)

# 3. web (in another terminal, repo root)
npm install
npx playwright install chromium   # also used by the API to print receipts
npm run dev                       # http://localhost:3000
```

Open http://localhost:3000/ar (Arabic, default) or http://localhost:3000/en.
Staff sign-in: `/ar/login` · Showroom: `/ar/showroom` · Catalog: `/ar/products` · Basket and checkout: `/ar/checkout`.

The checkout needs no Tap or Brevo account to try locally: see section 11 below.

### Everything in Docker

```bash
cp api/.env.example api/.env   # set the two secrets
docker compose up -d --build    # db, db-test and the API on :4000 (migrations run on start)
docker compose exec api npx tsx prisma/seed.ts   # optional demo accounts (wipes the database)
API_INTERNAL_URL=http://localhost:4000 npm run build && npm start   # web on :3000
```

### Testing from other devices (phone, laptop)

Devices on the same Wi-Fi only need to reach the web app, because Next.js proxies `/api/*` to the API on this machine.

1. In `api/.env`, set `COOKIE_SECURE=false` and restart the API. Browsers drop `Secure` cookies over plain `http://` on any host except `localhost`, so without this, signing in fails silently.
2. Run `npm run dev` and open the **Network:** URL it prints (for example `http://192.168.1.34:3000`) on the other device. `next.config.ts` adds this machine's LAN IPs to `allowedDevOrigins` when the server starts. If your IP changes, restart `npm run dev`.
3. If the page doesn't load at all, allow incoming connections for `node` in the macOS firewall.

Over `http://<LAN IP>`, copy-to-clipboard buttons don't work, because the browser allows clipboard access only on `localhost` and HTTPS.

## 3. Importing the legacy catalogue

The previous Supabase catalogue exports as two CSVs (`categories_rows.csv`,
`products_rows.csv`) whose images are inline base64 data URIs. To load them:

```bash
cd api
npm run db:import-legacy                       # reads ../old products data
npm run db:import-legacy -- --dir /path/to/csvs
npm run db:import-legacy -- --force-images     # re-encode product images that already exist
```

Category (car) images are always re-encoded, with their empty margins trimmed
so every car fills its card the same way, and get their English name for the
/en pages from `CATEGORY_NAMES_EN` in `api/src/legacy-import/legacy-rows.ts`
(add a line there for a new category).

Unlike the seed, the import **never wipes anything**. Rows are keyed on their
legacy primary keys (`cat-…`, `prod-…`) in the `legacy_id` columns, so
re-running updates what is already there instead of duplicating it. Products
are appended to every active branch's showroom order, after whatever the branch
manager has already arranged.

What it does to the data on the way in:

- **Images** are decoded and re-encoded through the same pipeline as an upload,
  producing `<uuid>.webp` and `<uuid>-sm.webp` in `UPLOAD_DIR`. The source
  pictures are small (often under 200 px), so they are never enlarged — see the
  note on `Product.imageKey` in the schema.
- **Arabic text** is NFKC-normalised. The export stores much of it as
  Presentation Forms-B (`ﻟﻴﻮﺑﺎرد`), which renders inconsistently and never
  matches what a user types into search; NFKC folds it to `ليوبارد`.
- **Barcodes** are kept as-is, including duplicates. The legacy catalogue lists
  the same part once per car model, so ~147 barcodes are shared by several
  products — `products.barcode` is therefore indexed, not unique. A value that
  is not a usable barcode is dropped with a warning.
- **Rows without a usable image are skipped**, because `image_key` is NOT NULL
  and a product with no picture is useless on the kiosk.

Every change and skip is printed as a warning at the end of the run.

## 4. Demo accounts (created by the seed — development only)

| Username | Role | Dashboard password | Showroom password |
|---|---|---|---|
| `admin` | Super Admin | `SuperWolf#2026!` | — |
| `finance` | Finance | `Ledger#Wolf2026!` | — |
| `bo.manager` | Branch Manager, Bin Omran | `Manager#Wolf2026!` | `Showroom#2026!` |
| `bo.cashier` | Cashier, Bin Omran | `Cashier#Wolf2026!` | `Showroom#2026!` |
| `gh.manager` | Branch Manager, Al Gharrafa | `Manager#Wolf2026!` | `Showroom#2026!` |
| `gh.cashier` | Cashier, Al Gharrafa | `Cashier#Wolf2026!` | `Showroom#2026!` |

The seed creates no products: the catalogue comes from `npm run db:import-legacy` (`npm run db:reset` runs both). Only the Playwright suite sets `SEED_DEMO_CATALOG=1`, which adds 13 made-up products (2 without a price, to show Finance's queue), a different showroom order per branch and a few orders. **Never run the seed in production** — it empties the database first (it refuses to run when `NODE_ENV=production`).

The seed creates no Reservations account: the Super Admin adds it on *Dashboard → Users* (role Reservations; the username is `reservations`).

There is no public registration: the Super Admin creates every account. New accounts get an auto-generated username (e.g. `wk.cashier`) and generated passwords that are shown **once** in a copyable dialog.

## 5. Environment variables

### API (`api/.env`, validated at startup — the API refuses to start with a bad value)

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | `development` \| `production` \| `test` |
| `PORT` | `4000` | HTTP port |
| `LOG_LEVEL` | `info` | pino level (`silent` … `trace`) |
| `CORS_ORIGINS` | — (required) | Comma-separated browser origins allowed by CORS |
| `TRUST_PROXY` | `loopback` | Express `trust proxy` (client IPs in the audit log). Docker: `loopback, uniquelocal` |
| `SWAGGER_ENABLED` | `false` | Serve Swagger UI at `/api/docs` |
| `DATABASE_URL` | — (required) | PostgreSQL URL |
| `TEST_DATABASE_URL` | — | API e2e tests only; its name must contain `test` |
| `E2E_DATABASE_URL` | — | Playwright tests only; its name must contain `e2e` |
| `JWT_ACCESS_SECRET` | — (required, ≥ 32 chars) | Signs access tokens |
| `JWT_ACCESS_TTL_SECONDS` | `900` | Access token lifetime (15 min) |
| `REFRESH_TTL_DAYS` | `7` | Dashboard session lifetime |
| `SHOWROOM_SESSION_TTL_HOURS` | `16` | Showroom session lifetime |
| `COOKIE_SECURE` | `true` | `Secure` flag on cookies (browsers accept it on `http://localhost`, not on a LAN IP; see "Testing from other devices") |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_LOCK_MINUTES` | `5` / `15` | Account lockout |
| `RATE_LIMIT_PER_MINUTE` | `300` | General per-IP budget |
| `AUTH_THROTTLE_LIMIT` / `AUTH_THROTTLE_TTL_SECONDS` | `10` / `60` | Per-IP budget on sign-in and security endpoints |
| `TOTP_ENCRYPTION_KEY` | — (required, 32 bytes base64) | AES-256-GCM key for 2FA secrets at rest |
| `TOTP_ISSUER` | `Wolf Car` | Name shown in authenticator apps |
| `UPLOAD_DIR` | `./storage/uploads` | Product images (processed WebP files) |
| `CHROME_PATH` | — | Chromium for receipts; empty = Playwright's browser |

Online checkout and email (all optional locally; see section 11 for what production needs):

| Variable | Default | Purpose |
|---|---|---|
| `PAYMENTS_PROVIDER` | `tap` | `tap` or `fake`. `fake` is an in-memory gateway for tests and local trials. **Never in production**: its webhook accepts signatures made with the public secret `fake-secret`. The API refuses `fake` with `NODE_ENV=production` (unless `ALLOW_TEST_CHECKOUT=true`) and always next to an `sk_live_` key |
| `TAP_SECRET_KEY` | — | Tap secret key, `sk_test_…` while testing and `sk_live_…` in production. Never logged. Required with `PAYMENTS_PROVIDER=tap` |
| `TAP_API_URL` | `https://api.tap.company/v2` | Tap's API |
| `WEB_PUBLIC_URL` | — | The website's public origin, no trailing slash. Tap sends the customer back here after 3-D Secure |
| `API_PUBLIC_URL` | — | The API's public origin, no trailing slash. Tap posts its webhook here. Locally: an ngrok URL |
| `WEB_ORDERS_BRANCH_CODE` | `BO` | Code of the branch that holds website orders for pickup (Bin Omran) |
| `CHECKOUT_TTL_MINUTES` | `30` | How long an unpaid website order is kept before it expires. An order with a payment in flight is not expired |
| `EMAIL_PROVIDER` | `console` | `console` writes every email to the API log (development); `brevo` sends them. In production with `console` the API refuses to send sign-in codes (`503 SIGN_IN_UNAVAILABLE`) and only logs order emails |
| `BREVO_API_KEY` | — | Brevo API key (`xkeysib-…`). Required with `brevo`. Never logged |
| `EMAIL_FROM` / `EMAIL_FROM_NAME` | — / `Wolf Car` | The sender; the address must be on a domain authenticated in Brevo. Required with `brevo` |
| `SHOP_NOTIFY_EMAIL` | — | Comma-separated addresses told about every new website order. Empty = nobody |
| `OTP_DEV_CODE_IN_RESPONSE` | `false` | Return the code in the API response. Development and tests only; the API refuses to start with `true` in production (unless `ALLOW_TEST_CHECKOUT=true`) and always next to an `sk_live_` key |
| `ALLOW_TEST_CHECKOUT` | `false` | Lets an API running with `NODE_ENV=production` use `PAYMENTS_PROVIDER=fake` and `OTP_DEV_CODE_IN_RESPONSE=true`. Only the browser tests set it (`e2e/env.ts`); the Docker API in `docker-compose.yml` also runs as production, so a local trial with `fake` there needs it. Never on the server, and refused next to an `sk_live_` key |
| `OTP_PER_EMAIL_PER_15_MIN` | `3` | Sign-in codes one email address may ask for in 15 minutes |
| `CUSTOMER_SESSION_TTL_DAYS` | `30` | Customer sign-in lifetime |
| `ODOO_WRITE_LOGIN` / `ODOO_WRITE_API_KEY` | — | A **separate** Odoo user that creates sale orders for paid web orders (the catalogue sync uses the read-only `ODOO_LOGIN`). Empty = paid orders wait in the queue |
| `ODOO_WEB_WAREHOUSE_ID` | — | Numeric id of the Odoo warehouse web orders ship from (Bin Omran) |
| `ODOO_FALLBACK_PRODUCT_ID` | — | Numeric id of the Odoo product used for a line that has no Odoo product of its own |

### Web

| Variable | Default | Purpose |
|---|---|---|
| `API_INTERNAL_URL` | `http://localhost:4000` | Where the Next.js server reaches the API (`/api/*` rewrite and the catalog page). Read at **build** time for the rewrite. |
| `NEXT_PUBLIC_TAP_PUBLIC_KEY` | — | Tap **public** key for the card form (`pk_test_…`, later `pk_live_…`). **Baked in at build time** (`next build` inlines every `NEXT_PUBLIC_*`), so changing it means rebuilding. It is the launch switch: built with an empty key, the basket offers WhatsApp only and `/checkout` says card payment is not available yet. Locally: `.env.local` (git-ignored); production: `deploy/prod.env`, passed to the Docker build by `compose.prod.yml`. `npm run e2e:build` uses a stand-in key when none is set |
| `NEXT_PUBLIC_TAP_MERCHANT_ID` | — | Tap merchant id (not secret). Optional, in `.env.local` |

## 6. Tests

```bash
# API — unit tests (no database)
cd api && npm test

# API — end-to-end (Supertest + real PostgreSQL on TEST_DATABASE_URL)
docker compose up -d db-test
cd api && npm run test:e2e

# Web — component/hook tests (Vitest + Testing Library + MSW)
npm test

# Browser — full flows (Playwright; production builds on :3100/:4100, database E2E_DATABASE_URL)
docker compose up -d db-test          # also creates the wolfcar_e2e database
npx playwright install chromium                                                               # once
npm run e2e:build                     # builds with API_INTERNAL_URL=http://localhost:4100 (rewrites are fixed at build time)
npm run test:e2e                      # migrates + reseeds wolfcar_e2e, starts both servers, runs the browser tests
```

Landing snapshots live in `e2e/landing.spec.ts-snapshots/`. They were checked pixel-identical to the reviewed page; only regenerate them (`npx playwright test e2e/landing.spec.ts --update-snapshots`) after an intentional, reviewed landing change.

What they cover:

- **API unit** — every service, guard, interceptor and filter (auth, tokens, lockout, 2FA, RBAC, users, branches, products, pricing, orders, showroom, receipts, activity log).
- **API e2e** — the test database's default time zone is set to Asia/Qatar, so the suite also proves timestamps are stored as true UTC instants. Every endpoint for every role: a table-driven **RBAC matrix** checks all routes × {anonymous, Super Admin, Finance, Manager, Cashier, showroom session}. Plus the online checkout (sign-in codes, checkout, webhook signatures and repeats, expiry, refunds, the Odoo queue; paid through the fake gateway, see `api/test/setup/test-env.ts`) and the forbidden paths: Finance editing name/image/barcode/description (403 on the route, 400 for smuggled fields), managers setting prices, cashiers editing confirmed orders (409), cross-branch reads/writes/receipts (404), public catalogue field leakage, 2FA (setup, login, replay, recovery codes, admin reset), rate limiting (429) and lockout (423), refresh-token reuse, upload spoofing/oversize, database constraints (second manager, branch without cashier, append-only log), PPF bookings (at most two full PPF per day, also under concurrent requests; closed days; sales requests for a full PPF or a light job), the PIN-protected sales page (cookie scope, PIN change signs phones out, lockout, no internal fields), general reservations, and an **audit-coverage** test that fails if any state-changing route is not audited.
- **Web** — forms (login/2FA, products, prices, passwords with strength meter, users, branches), permission-gated UI, the showroom cart and checkout, drag-and-drop reordering.
- **Playwright** — the checkout story in `e2e/checkout.spec.ts` (a visitor signs in with a code, pays for a part by card, a reload reopens the same order's pay step, the Bin Omran cashier sees it as paid online; the browser sends no request to Tap), the complete story (admin creates a branch and its staff → manager adds a product → finance prices it → showroom places an order → cashier confirms and downloads the receipt → admin sees it all in the activity log), the bookings story (admin creates the call-center account → she books a full PPF → sales asks for a light job and for a second full PPF → she approves them → a third full PPF is refused), role landing pages, the public catalogue (no barcodes in DOM or network), and **visual snapshots of the landing page**.

## 7. Permission model

**Roles** (`SUPER_ADMIN`, `FINANCE`, `BRANCH_MANAGER`, `CASHIER`, `RESERVATIONS`) map to **granular permissions stored in the database**. The Super Admin edits them on *Dashboard → Permissions*:

- **By role** — the default set for everyone with that role.
- **By user** — per-user exceptions: *Grant* or *Revoke* on top of the role.

Effective permissions = role permissions + user grants − user revokes, **resolved on every request**, so a revocation applies immediately. `SUPER_ADMIN` always has every permission and cannot be edited (so nobody can lock the system out). The web app hides or disables what the user can't do, but that is only for convenience: **the API is the source of truth** (`@RequirePermissions(...)` guards on every route).

| Permission | What it allows | Default roles |
|---|---|---|
| `product.create` | Create products (name, image, barcode, description — never a price) | Manager |
| `product.update.details` | Edit name, image, barcode, description | Manager |
| `product.update.price` | Set/change prices (price only; history recorded) | Finance |
| `product.read` | View products, prices (read-only) and price history | Finance, Manager |
| `product.reorder` | Drag-and-drop the branch's showroom order | Manager |
| `order.create` | Place orders from the showroom | Manager, Cashier |
| `order.read.branch` | View own branch's orders | Manager, Cashier |
| `order.read.all` | View every branch's orders | Finance |
| `order.update` | Edit pending orders | Cashier |
| `order.cancel` | Cancel pending orders | Cashier |
| `order.confirm` | Confirm orders (then immutable except for Super Admin) | Cashier |
| `order.receipt.download` | Download PDF receipts | Cashier |
| `order.odoo.retry` | Send a paid web order to Odoo again after it failed | Finance |
| `booking.ppf.read` | View the PPF calendar, bookings and light-job requests | Reservations |
| `booking.ppf.manage` | Add, edit and cancel PPF bookings; close and reopen days; answer requests; set the sales PIN | Reservations |
| `booking.general.manage` | View and manage general reservations | Reservations |
| `user.manage` | Create/manage accounts, reset passwords and 2FA | — |
| `branch.manage` | Create/manage branches, replace staff | — |
| `permission.manage` | Edit role and user permissions | — |
| `activity.read` | View the activity log | — |
| `analytics.read` | View website visitor statistics | — |
| `showroom.password.view_or_change` | Change own showroom password | Manager, Cashier |

(“—” = Super Admin only by default.)

**Branch isolation.** Branch Managers and Cashiers belong to exactly one branch. Every branch-scoped query in the API is filtered by the signed-in user's branch in the service layer, so another branch's order behaves exactly like a missing one (404), whatever ids or filters are sent. The showroom never trusts the client with the branch: it comes from the signed-in showroom user.

**Branch staffing is enforced by the database**: partial unique indexes allow at most one (non-deleted) manager and one cashier per branch, and a deferred constraint trigger requires at least one of each at commit. That's why a branch is created together with its two accounts, and staff are *replaced* (old account retired and new one created in one transaction) rather than added.

### PPF bookings and the sales page

PPF and tinting are booked for **Bin Omran only**, by the call center (role *Reservations*) on *Dashboard → PPF bookings*. One **full PPF** closes its receive day; **one more** may be added as an exception, never a third (`PPF_MAX_FULL_PER_DAY`; the API counts under a per-day advisory lock, so concurrent bookings cannot exceed it). **Light jobs** never close a day and are not limited. The delivery day is information only. The call center can also close a day by hand.

Salespeople have no accounts. They open **`/ar/slots`** (or `/en/slots`) and type a shared 6-digit PIN once per phone; the phone is remembered for 90 days. They cannot book. They can send **requests**, which stay *waiting* until the call center approves or rejects them in the dashboard: a full PPF for an open day, a second full PPF (the exception) for a day that has one, or a light job for any day not closed by hand. Approving creates the booking; a full PPF request for a day that has filled up in the meantime is refused. Changing the PIN signs every phone out. Five wrong PINs lock PIN entry for `LOGIN_LOCK_MINUTES`.

*Dashboard → General reservations* is the call center's private list of every other reservation; nothing in it reaches the sales page.

### Deploying

The droplet follows the `production` branch. Merging into `production` runs `.github/workflows/deploy.yml`, which connects to the server and runs `scripts/deploy.sh` (pull, build, health check, smoke test, automatic rollback). A green check on the commit means it is live; a red one means the previous version is still serving. To deploy by hand, as the `deploy` user so the checkout stays owned by it: `ssh wolf@<server 100.x ip> "sudo -iu deploy bash -c 'cd /opt/wolfcar/app && scripts/deploy.sh'"`.

### Server access (SSH)

The droplet accepts SSH **only over Tailscale**; port 22 is closed to the internet. Password login and direct `root` login are off. Admins sign in as a normal account (`wolf`) and use `sudo`; GitHub Actions signs in as `deploy` (docker group) with a key whose forced command can only run `scripts/deploy.sh`. All of this is set by `deploy/harden-ssh.sh`, which is safe to re-run and refuses to close the public port until it is itself being run over Tailscale by the admin user (so you cannot lock yourself out):

```bash
# 1st run (today's path, root over the public IP): users, no password login, Tailscale
ssh root@167.172.106.106 'bash /opt/wolfcar/app/deploy/harden-ssh.sh'
# 2nd run, from a laptop with Tailscale on, as the admin: closes public 22, PermitRootLogin no
ssh wolf@<server 100.x ip> 'sudo bash /opt/wolfcar/app/deploy/harden-ssh.sh'
```

Then set the GitHub secret `DEPLOY_SSH_USER=deploy` (the workflow falls back to `root` while it is unset) and re-run the Deploy workflow. Checklist, from Tap's review:

- [ ] `nc -z -w 3 167.172.106.106 22` fails from any network without Tailscale.
- [ ] `sshd -T | grep -iE 'permitrootlogin|passwordauthentication'` shows `no` and `no`.
- [ ] `ufw status` shows 22 only `on tailscale0`; 80 and 443 open; nothing else (5432, 3000, 4000 closed).
- [ ] Every key listed by the script under "authorised keys" belongs to a current admin or to GitHub; delete the rest from that user's `~/.ssh/authorized_keys`.
- [ ] `apt list --upgradable` is empty or only non-security packages; reboot if the script said so.
- [ ] Deploy workflow green, site loads, `scripts/smoke.sh https://wolfcar.qa` passes.
- [ ] Re-run the external security scan.

## 8. Security notes

- **Passwords**: argon2id (19 MiB, t=2, p=1); never stored or returned in plain text. Policy (shared by API and web): ≥ 12 characters, upper, lower, number, symbol, not containing the username; live strength meter in the UI.
- **Sessions**: 15-minute JWT access token kept in memory only; opaque refresh token (stored hashed) in an `httpOnly; Secure; SameSite=Strict` cookie scoped to `/api/auth`, rotated on every use, with reuse detection that revokes the session. Logout, password change, admin reset and deactivation revoke sessions immediately. The showroom uses a separate cookie, password and session type that cannot reach dashboard routes. The sales slots page uses neither: a PIN is exchanged for a signed 90-day cookie (`httpOnly; SameSite=Strict`, scoped to `/api/slots`) that carries the PIN's version and is rejected everywhere else.
- **2FA**: TOTP (QR setup, verified before activation), secrets AES-256-GCM encrypted, replayed codes rejected, 10 single-use recovery codes shown once; the Super Admin can reset a user's 2FA.
- **Brute force**: per-IP rate limits (strict on sign-in/security endpoints) and account lockout after 5 failures for 15 minutes — unknown usernames are locked the same way, so lockouts don't reveal which usernames exist.
- **HTTP**: Helmet (CSP, nosniff, frame-ancestors none…), strict CORS allowlist, CSRF header on cookie-authenticated endpoints, request ids on every response and log line, global validation with `whitelist` + `forbidNonWhitelisted`, error responses that never include stack traces or driver messages.
- **Uploads**: images are checked by content (magic bytes + real decode), size-limited (5 MB), re-encoded to WebP (EXIF stripped) and stored under random UUID names; served with `nosniff` and a locked-down CSP.
- **Receipts**: rendered from an escaped template by Chromium with JavaScript disabled and no network access.
- **Audit log**: an interceptor records every state-changing request (and receipt downloads, sign-ins, failed sign-ins, permission denials) with actor, role, branch, action, entity, before/after (secrets redacted), IP, user agent and request id. The table is append-only (a trigger blocks UPDATE/DELETE), and a test fails if a new state-changing route isn't audited.

## 9. Database notes

- Schema: `api/prisma/schema.prisma`. Migrations: `api/prisma/migrations/` (apply with `npx prisma migrate deploy`).
- Hand-written SQL at the end of the first migration adds what Prisma can't model: the branch staffing indexes and trigger, CHECK constraints (role ↔ branch, money, quantities, line totals), the deferrable `(branch, position)` unique constraint for reordering, and the append-only activity log. When generating a new migration, review it for accidental `DROP`s of these objects.
- Order lines snapshot the product **name and unit price** at order time; later price or name changes never alter existing orders or receipts.
- `npm run db:reset` (in `api/`) recreates the dev database, reseeds the accounts and re-imports the legacy catalogue.

## 10. Project structure

```
app/[locale]/page.tsx              landing page (unchanged)
app/[locale]/products/             public catalogue
app/[locale]/(app)/(staff)/login   staff sign-in
app/[locale]/(app)/(staff)/dashboard/…   overview, products, orders, ppf-bookings, reservations, users, branches, permissions, activity, account
app/[locale]/(app)/showroom/…      showroom sign-in + kiosk
app/[locale]/(app)/slots/           sales slots page (PIN)
components/                        landing page components (+ ui/ = shadcn/ui re-themed, app/ = shared app components)
features/                          dashboard/showroom feature code (one folder per area)
lib/                               API client, formatting, i18n helpers, motion presets
messages/{ar,en}.json              website texts · messages/app/{ar,en}/ = dashboard & showroom texts
shared/                            permissions + validation rules (web and API)
api/src/                           NestJS modules: auth, account, rbac, users, branches, products, uploads,
                                   showroom, orders, ppf, reservations, sales-access, receipts, activity, public
api/test/                          API end-to-end tests · e2e/ = Playwright tests
```


## 11. Online orders, payments (Tap) and email (Brevo)

Design: `docs/superpowers/specs/2026-11-04-email-guest-checkout-design.md`.

### How it works

1. The visitor fills the basket and opens `/ar/checkout`. **No account is needed**: they type their name, a Qatari mobile (8 digits starting with 3, 5, 6 or 7; only for the branch to call, nothing is sent to it) and an email, and choose **pay now by card** or **pay at the branch when collecting**. Without `NEXT_PUBLIC_TAP_PUBLIC_KEY` only "pay at the branch" is offered.
2. The API creates the order from the server's prices (the browser never sends a price). It belongs to the customer of that email (found or created, never changed by a guest), so it shows up in "My account" once that email signs in. The answer carries the **order key** (an HMAC of the order id with `JWT_ACCESS_SECRET`): the page keeps it in the address (`?order=…&key=…`) and sends it as `X-Order-Key`, which is how a guest reaches their own order.
3. **Pay at the branch:** the order is `paymentStatus NONE`, never expires, and the customer lands on the thank-you page (`/ar/checkout/return`). They get an email with the order; the shop (`SHOP_NOTIFY_EMAIL`) gets an alert. The cashier calls, *confirms* the order in the dashboard, takes the payment at the till, and marks it *collected*. It is never sent to Odoo as a web sale (the till rings it up).
4. **Card:** the order is held for `CHECKOUT_TTL_MINUTES`. Tap's card form (loaded from Tap's CDN with the public key) turns the card into a token; the card number never reaches our servers. The API creates the charge and the customer goes through 3-D Secure at Tap, then back to the thank-you page.
5. A card order becomes **paid** only when the API has seen the charge from Tap itself: a webhook whose `hashstring` signature checks out, or the API reading the charge back. The return page alone never pays an order. The expiry sweep reads the charge back too before it cancels an unpaid order, so a customer who paid and closed the page before coming back still gets a paid order, even if the webhook never arrives; when Tap cannot be asked, the order waits for the next minute. Then the customer gets the receipt by email, the shop an alert, and the order is queued for Odoo (a confirmed sale order with the Tap reference); the Bin Omran cashier sees it as *paid online* and marks it collected when the customer shows the order code.
6. **My account** (`/account`): sign in with the email and a 6-digit code sent there; the customer's orders (also those placed as a guest with that email) and cars. There is no SMS anywhere. Customers from the earlier phone sign-in (it never launched on the live site, so there should be none) keep their rows and orders but have no email: they cannot sign in, and ordering with an email starts a new customer (migration `20261104100000_email_customers`).

Emails go through Brevo's transactional API (`EMAIL_PROVIDER=brevo`; free plan: 300 a day). Order emails are best effort: a failure is logged and never fails the order or the payment. The sign-in code email does fail the request, so the customer knows.

Routes (all under `/api/shop`; non-GET calls carry the `X-Requested-With: wolfcar` header):

| Route | What |
|---|---|
| `POST /otp`, `POST /otp/verify` | Email a sign-in code and check it (`{ email, locale }`, `{ email, code }`) |
| `GET /me`, `POST /logout`, `POST /logout-all` | Current customer (cookie); sign out here or everywhere |
| `POST /orders` | Create an order, signed in or not (`paymentMethod: card | branch`); answers its `key` |
| `GET /orders` | The signed-in customer's orders |
| `GET /orders/:id`, `POST /orders/:id/cancel` | Read an order, cancel an unpaid card order: by the cookie, or with `X-Order-Key` |
| `POST /orders/:id/pay` | Create the Tap charge for the card token (cookie or key); Tap returns the customer to a URL with the key |
| `POST /orders/:id/reconcile` | Read the charge back from Tap (used by the return page); an order without a charge is answered as it is |
| `POST /payments/tap/webhook` | Tap's webhook; checked by its `hashstring` header, no cookie |

The dashboard's orders page opens on the **website's orders**; the showroom's are on their own tab. The **call center** (role Reservations) holds `order.web.handle`: it reads every order and confirms, cancels and hands over the website's orders of every branch (never a showroom's; refunding a paid card order stays with the Super Admin). The permission is new, so a deploy grants it to that role by itself; it can be taken away on the permissions page.

Staff side, under `/api/orders`: edit is refused for web orders; *confirm* is refused for card web orders and allowed for pay-at-branch ones; *cancel* refunds the card first; `POST /:id/collect` marks a paid, or confirmed pay-at-branch, web order collected; `POST /:id/odoo/retry` (permission `order.odoo.retry`, Finance) sends a failed order to Odoo again.

### Set up Brevo (email)

1. Brevo → **SMTP & API** → **API keys** → *Generate a new API key*. Put it in `deploy/api.prod.env` as `BREVO_API_KEY`, with `EMAIL_PROVIDER=brevo`. Never commit it.
2. Brevo → **Senders, domains & dedicated IPs** → **Domains** → add `wolfcar.qa`, then add the DNS records Brevo shows (a Brevo code TXT record, DKIM, and DMARC) where the domain's DNS is managed, and press *Authenticate*. Without this, mail from `wolfcar.qa` lands in spam or is refused.
3. Set `EMAIL_FROM` to an address on that domain (e.g. `orders@wolfcar.qa`; until `wolfcar.qa` is authenticated, `noreply@wolf-groups.com` already is) and `SHOP_NOTIFY_EMAIL` to whoever should hear about new orders.
   Brevo blocks API calls from unknown addresses: add the server's IP (`167.172.106.106`, and its IPv6 if it sends over IPv6) under **Security → Authorized IPs**, or every email fails with `unauthorized`. The free plan's 300 emails a day are shared with every other system on the same Brevo account.
4. Restart the API, then sign in at `/ar/account` with your own email: the code should arrive within a minute.

### Run it locally without a Tap account

In `api/.env`:

```
PAYMENTS_PROVIDER=fake
EMAIL_PROVIDER=console
OTP_DEV_CODE_IN_RESPONSE=true     # the sign-in code is also returned to the page, so you need not read the log
WEB_PUBLIC_URL=http://localhost:3000
API_PUBLIC_URL=http://localhost:4000
```

Restart the API. Emails (sign-in codes, order emails) appear in the API log. The fake gateway keeps charges in memory, so restarting the API forgets them. The checkout offers *Pay now by card* only when the website was started or built with a non-empty `NEXT_PUBLIC_TAP_PUBLIC_KEY` (in `.env.local`); without one it takes orders to pay at the branch only. The card form still loads Tap's script, so for a full click-through use Tap test keys (next section); the Playwright story (`e2e/checkout.spec.ts`) replaces the card form with a stub and needs neither (`npm run e2e:build` bakes a stand-in public key).

### Run it locally with Tap test keys

1. In Tap's dashboard take the **test** keys. Put the secret key in `api/.env` as `TAP_SECRET_KEY=sk_test_…` with `PAYMENTS_PROVIDER=tap`, and the public key in `.env.local` (repo root, git-ignored) as `NEXT_PUBLIC_TAP_PUBLIC_KEY=pk_test_…` (optionally `NEXT_PUBLIC_TAP_MERCHANT_ID=…`). Never commit either file.
2. Tap must reach the webhook from the internet, so expose the API: `ngrok http 4000`, then set `API_PUBLIC_URL=https://<your-tunnel>` in `api/.env` and restart the API. Keep `WEB_PUBLIC_URL=http://localhost:3000`.
3. Nothing is configured in Tap's dashboard for the webhook: the API passes the webhook URL (`post.url`) with every charge.
4. Test cards: Visa `4012000033330026` (`01/39`, CVC `100`) is **captured** (checked 2026-11-04: paid, receipt, refund). Visa `4508750015741019` and Mastercard `5123450000000008` (`01/39`, any CVC) pass 3-D Secure but end in `701 RESTRICTED` in our sandbox account (see the questions for Tap below). More cards: `developers.tap.company/reference/testing-cards`.

If the webhook never arrives (tunnel down), the return page reads the charge back from Tap, so the customer still sees *paid*.

### Going live checklist

Owner and business:

- [ ] **Tap live keys.** Ask integrations@tap.company to register `wolfcar.qa` for the live public key. Use `sk_live_…` / `pk_live_…` only on the server.
- [ ] **Refund policy page** on the website (Tap and the acquiring bank ask for it).
- [ ] **Brevo** set up as in *Set up Brevo (email)* above: API key, `wolfcar.qa` authenticated, `EMAIL_FROM`, `SHOP_NOTIFY_EMAIL`. Until then nobody can sign in to "My account" on the live site (503), orders still work, and their emails are only logged.
- [ ] **Odoo:** a dedicated sales user (`ODOO_WRITE_LOGIN`, `ODOO_WRITE_API_KEY`); the Bin Omran warehouse id (`ODOO_WEB_WAREHOUSE_ID`); `ODOO_FALLBACK_PRODUCT_ID`; check one order in the test database for product taxes (the sale order line carries the price paid, so a tax added on confirm would make Odoo's total differ from Tap's); decide whether the accountant wants invoices too.

Server (`deploy/api.prod.env`, see `deploy/api.prod.env.example`):

- [ ] `PAYMENTS_PROVIDER=tap` and `TAP_SECRET_KEY=sk_live_…`.
- [ ] `WEB_PUBLIC_URL` and `API_PUBLIC_URL` both `https://wolfcar.qa` (one origin behind Caddy). Tap must reach `POST /api/shop/payments/tap/webhook` from the internet: check that Caddy and any firewall let it through.
- [ ] `NEXT_PUBLIC_TAP_PUBLIC_KEY=pk_live_…` in `deploy/prod.env` (not `api.prod.env`). It is baked into the website when `scripts/deploy.sh` builds it, so set it **before** the deploy that launches card payments. Until it is set the checkout takes orders to pay at the branch only, which is how to keep card payment off while the rest is deployed.
- [ ] `EMAIL_PROVIDER=brevo`, `BREVO_API_KEY`, `EMAIL_FROM`, `SHOP_NOTIFY_EMAIL`.
- [ ] Run one API process. The Odoo queue and the expiry sweep run inside it.

**Must never be true in production:** `PAYMENTS_PROVIDER=fake`, `OTP_DEV_CODE_IN_RESPONSE=true`, `ALLOW_TEST_CHECKOUT=true`, `EMAIL_PROVIDER=console` with real customers. With `NODE_ENV=production` the API refuses to start with `fake` or `OTP_DEV_CODE_IN_RESPONSE=true` unless `ALLOW_TEST_CHECKOUT=true`, and refuses both next to an `sk_live_` key whatever the flag says.

Check in the Tap sandbox before launch (the fake gateway cannot tell you):

- [x] A full 3-D Secure payment with the test card lands on `/checkout/return` and shows *paid* (2026-11-04, a guest, Visa `4012000033330026`; the receipt email went out).
- [ ] The webhook arrives and is accepted (its `hashstring` checks out). Needs a public tunnel to the API (step 2 above); not tested yet. On the live site: after the first real payment, look for `shop.payment.webhook` with outcome *paid* or *already_paid* in the activity log.
- [x] Tap refuses a second refund of the same charge (2026-11-04): right after the first it answers `1202 Duplicate Request`, later `1161 Requested refund amount exceeds with available captured amount`.
- [ ] The card form's valid/invalid events: *Pay* recovers after a corrected card.
- [x] The card form works under the checkout page's headers (`X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=()`): the local site sends the same headers, and the payment above went through under them.
- [x] The refund object's `status` values: a sandbox refund answers `REFUNDED` (response `000`), which the API accepts. The API treats `INITIATED`, `PENDING`, `IN_PROGRESS` and `REFUNDED` (any case) as accepted and anything else as `502 REFUND_FAILED` with the status as the reason.
- [x] The return URL survives Tap appending `tap_id`: Tap sends the customer back to `/checkout/return?order=<id>&key=<key>&tap_id=chg_…`, and the page reads `order` and `key`.
- [x] The card SDK does not need `merchant.id` in the sandbox: the site never sends it (`NEXT_PUBLIC_TAP_MERCHANT_ID` is unused). Ask Tap whether live keys do.

Questions and reports for Tap (card SDK 1.0.2, one ticket):

- [ ] **Does our account need the cardholder name?** The card form asks for it (`fields: { cardHolder: true }` in `features/shop/tap-card.tsx`), Tap's field takes English letters only, and the page tells customers so and pre-fills the name when it is already in English letters. If Tap says it is not needed for 3-D Secure or acceptance, set `cardHolder: false` and drop the English-letters sentence from `Checkout.cardHint` and from `errors.TAP_CARD_INVALID`, `errors.PAYMENT_FAILED` and `errors.CARD_REENTER`.
- [ ] **Why do the 3-D Secure challenge test cards end in `701 RESTRICTED`** (gateway `BLOCKED`) after a successful 3-D Secure? Since 2026-11-04 Visa `4012000033330026` is captured again (it was refused the same way from 2026-10-28), but `4508750015741019` and `5123450000000008` still are. Will real cards that get a bank challenge be refused like this with live keys?
- [ ] **Can a charge end `AUTHORIZED` without capture, or `UNKNOWN`/`VOID` after the money was held?** The result page says only "The payment didn't go through" until Tap answers.
- [ ] Defects inside Tap's form to report: while the number is being corrected, the hidden expiry field stays tappable (one tap there, then Backspace, edits the date); the clear-all X has no label and touches the CVV on narrow phones; the Arabic CVV placeholder is cut when the form is wider than about 311px; the "change your keyboard to English" hint is English only and low contrast.

After any card SDK version change (`TAP_SDK_URL` in `features/shop/tap-sdk.ts`), check again what the page relies on: `interface.direction: "ltr"` keeps Arabic labels with left-to-right numbers; both validity callbacks carry a flag and `onInvalidInput` comes last; the form empties itself right after issuing a token; `resetCardInputs()`, `updateTheme()` and `customer.nameOnCard` behave as below; the frame keeps the id `tap-card-iframe` (the page gives it an Arabic title).

### Limits of phase 1

- Pickup at Bin Omran only; no delivery, no stock check; products without a price are ordered on WhatsApp.
- Refunding an order that is already in Odoo does **not** reverse the Odoo sale order; the accountant reverses it by hand. The dashboard says so in the cancel dialog and on the refunded order ("Refunded after it reached Odoo: cancel sale order N in Odoo").
- Apple Pay and Google Pay, delivery and stock come in phase 2; public PPF booking with a deposit in phase 3.
- Design and open questions: `docs/superpowers/specs/2026-10-18-online-checkout-phase1-design.md`.

---

## Landing page notes (original)

The notes below describe rules for the landing page and still apply.

## قواعد لازم تتحافظ عليها

**1. الـ hero مثبّت فيزيائيًا، مش منطقيًا.**
الكلام على **اليمين** والفان على **الشمال** بغضّ النظر عن اتجاه النص. يعني
`ml-auto` و `border-r` و `left-*` — مش `ms-auto` ولا `border-e` ولا `start-*`.
الخصائص المنطقية بتنقلب تحت `dir="rtl"` وبتودّي الكلام ناحية الشمال.
(الأقسام التانية منطقية عادي — بس الـ hero لأ.)

**2. شريط الماركات: 4 نسخ والحركة `-25%`.**
الحركة لازم تساوي عرض نسخة واحدة بالظبط. نسختين بس بتسيب **فراغ** لما المسار
يعدّي عرض الشاشة، وده بيبان كأن الشريط واقف بيستنى.
الشرط: `عرض المسار − مسافة الحركة ≥ عرض الشاشة` (دلوقتي: لحد 3539px).

**3. لوجوهات الشريط `loading="eager"`.**
`next/image` بيعمل lazy تلقائيًا. الشريط بيتحرك بـ `transform` مش scroll، فالنسخ
اللي بره الشاشة ممكن تفضل فاضية وهي بتلف.

**4. رسايل واتساب لازم تعدّي على `encodeURIComponent`.**
ده في `waLink()`. الموقع القديم كان مش بيعمل كده، وأي `&` في اسم الخدمة كان
**بيقطع الرسالة** فتوصل ناقصة.

**5. الأنيميشن CSS خالص.** مفيش مكتبات أنيميشن في صفحة الهبوط. `@keyframes` + `transform` بس. (Motion مستخدمة في لوحات التحكم والمعرض فقط، ومش بتتحمّل في صفحة الهبوط.)

**6. التباين.** لوجوهات الشريط عليها `opacity-60`، فألوان النصوص جواه مرفوعة
(`#C8C8C8`) عشان تفضل فوق 4.5:1 بعد الشفافية.

## ناقص — مش مشاكل كود

- **لوجو نيسان** — متعرض كنص لحد ما يوصل ملف PNG أبيض بخلفية شفافة (`lib/content.ts`)
- **صور حقيقية** — كل الصور دلوقتي مربعات رمادية (`<Photo/>`)
- **3 تقييمات Google** — ⛔ ممنوع تتخترع، لازم تتنسخ من جوجل
- **لوجو PayLater** — الموجود رسمة مؤقتة في `Catalog.tsx`
- **النسخة الإنجليزي** — زرار EN شكل بس
