# Production deployment on the DigitalOcean droplet — design

Date: 2026-09-27 · Status: approved

## Goal

Run the whole app — Next.js site, NestJS API, PostgreSQL, uploaded photos — on
the DigitalOcean droplet at `167.172.106.106`, served at `https://wolfcar.qa`,
so that a broken piece (like the API being down, which broke every catalog
photo on 2026-09-27) is caught by the deploy itself instead of by visitors.

The droplet will also host a second, unrelated project (a friend's), so the
setup must not assume it owns ports 80/443 alone.

## Decisions already made

| Topic | Decision |
|---|---|
| Hosting | The existing droplet (Ubuntu 24.04). It is on the 1 GB / 25 GB plan today; the CTO will be asked to resize to 4 GB / 2 vCPU / 80 GB ($24/mo) plus weekly backups. Until then a 4 GB swap file lets builds finish (slowly). |
| Approach | **A**: build and run with Docker Compose on the droplet (`git pull` + one script). GitHub-built images (approach B) are a later upgrade, not part of this. |
| Domain | `wolfcar.qa` (+ `www`), today on Netlify. The live DNS is at Ooredoo (`dns1-3.qatar.net.qa`, confirmed with the .qa registry); the DNS zone inside Netlify is **not** used. Nobody has the Ooredoo portal login yet (their account manager is visiting), so until the switch the site runs at the temporary address **`wolfcar.167-172-106-106.sslip.io`** (free wildcard DNS that resolves to the droplet IP; real HTTPS via Caddy). The SSH tunnel to `http://localhost:3000` is the fallback. |
| Data | Copy the local database (1,225 products, 2,450 branch rows, price history, 6 branches, 7 users) and the 4,990 uploaded photos (36 MB) as-is. |
| Accounts after the copy | Every user gets new generated passwords (dashboard + showroom), all sessions/refresh tokens are revoked, and two-factor is reset (production uses a new `TOTP_ENCRYPTION_KEY`, so old secrets could not be decrypted anyway). |

## Architecture

```
Internet ──443/80──► Caddy (on the host, shared with the friend's project)
                      │  wolfcar.qa, www.wolfcar.qa, wolfcar.167-172-106-106.sslip.io (temporary)
                      ▼
                127.0.0.1:3000 ──► web  (Next.js standalone, container)
                                    │  /api/* rewrite + server-side fetches
                                    ▼
                                   api  (NestJS, container, not published)
                                    │
                                    ▼
                                   db   (PostgreSQL 17, container, not published)
```

### Containers — `compose.prod.yml` (new; the dev `docker-compose.yml` stays as is)

- **db** — `postgres:17-alpine`, password from `deploy/prod.env` (generated,
  never `wolfcar`), named volume `pgdata`, healthcheck `pg_isready`, **no
  published port**.
- **api** — the existing `api/Dockerfile` image. Env from `deploy/api.prod.env`:
  `NODE_ENV=production`, fresh `JWT_ACCESS_SECRET` and `TOTP_ENCRYPTION_KEY`,
  `CORS_ORIGINS=https://wolfcar.qa,https://www.wolfcar.qa,https://wolfcar.167-172-106-106.sslip.io,http://localhost:3000` (the last two removed after the DNS switch),
  `COOKIE_SECURE=true`, `SWAGGER_ENABLED=false`,
  `TRUST_PROXY=loopback, uniquelocal`. Uploads on named volume `uploads`.
  Migrations run on start (already in the image). **No published port.**
- **web** — new `Dockerfile` at the repo root: Next.js `output: "standalone"`,
  non-root user, healthcheck on `/en`. Published only on `127.0.0.1:3000`.
  `depends_on: api (service_healthy)`.
  - **Gotcha this design must handle:** Next.js bakes `rewrites()` into the
    build. `API_INTERNAL_URL=http://api:4000` must be passed as a **build arg**
    as well as a runtime env var; otherwise production proxies `/api/*` to
    `localhost:4000` and every uploaded photo 500s — today's bug again.
- All three: `restart: unless-stopped`, log rotation (`max-size 10m`, 3 files).

Code changes in the app: `output: "standalone"` in `next.config.ts`, the new
root `Dockerfile` + `.dockerignore`. Nothing else in app code.

### Front door — Caddy on the host

- Installed from Caddy's apt repo; automatic certificates. The global `email` option is set so Caddy can fall back to ZeroSSL if Let's Encrypt rate-limits the shared `sslip.io` domain.
- `/etc/caddy/Caddyfile` gets one site block per project; ours:
  `wolfcar.qa` and `wolfcar.167-172-106-106.sslip.io` → `reverse_proxy 127.0.0.1:3000`, and
  `www.wolfcar.qa` → permanent redirect to `https://wolfcar.qa`. The friend adds
  their own block (their app on a different localhost port).
- Firewall (`ufw`): allow 80 and 443 from the internet; 22 only on the
  `tailscale0` interface (changed 2026-10-25 after Tap's security review found
  public SSH; `deploy/harden-ssh.sh`). Containers publish on `127.0.0.1` only,
  because Docker's published ports bypass `ufw`.
- SSH: over Tailscale only, key-only login, `PermitRootLogin no`; admins sign in
  as a normal user and `sudo`; GitHub deploys as the `deploy` user (docker
  group) with a forced-command key. `fail2ban` installed.

### Deploying — `scripts/deploy.sh` (runs on the droplet)

1. `git pull` in `/opt/wolfcar/app`.
2. Tag the currently running images as `previous`.
3. `docker compose -f compose.prod.yml build`, then `up -d`.
4. Wait until all containers report healthy (timeout 3 min).
5. Run `scripts/smoke.sh` against the public URL from `deploy/prod.env` (`PUBLIC_URL`: the sslip.io address until the switch, then `https://wolfcar.qa`).
6. On failure: print the last 100 log lines of each service, re-tag `previous`,
   `up -d` again, re-run the smoke test, exit non-zero.

### Smoke test — `scripts/smoke.sh <base-url>`

Each must return 200 (and the right content type where noted):
`/en`, `/ar`, `/en/products`, `/en/login`, `/api/health`,
`/api/public/categories` (JSON, non-empty), and **one uploaded photo**
discovered from the categories/products response (`image/webp`). Also asserts
`/api/docs` is **not** served (Swagger off). Exit code non-zero on any failure.

Used by `deploy.sh`, runnable by hand, and the same URLs are set up as a
DigitalOcean Uptime check (free, emails on failure).

### Data move — one time, `scripts/migrate-data.sh` (runs on the laptop)

1. `pg_dump --format=custom` of the local `wolfcar` database (Postgres 16 →
   restoring into 17 is supported).
2. `scp` the dump and `rsync` `api/storage/uploads/` to the droplet.
3. On the droplet: stop `api`/`web`, `pg_restore --clean --if-exists` into
   `db`, copy photos into the `uploads` volume, start everything.
4. Run the new one-off API script `api/prisma/rotate-credentials.ts`
   (refuses to run without `--confirm`): new dashboard + showroom passwords for
   every user, revokes refresh tokens and sessions, clears two-factor fields,
   prints the new passwords **once** as a table.
5. Run the smoke test.

This doubles as the first test that a backup can actually be restored.

### Backups — cron on the droplet

- Nightly 03:00: `pg_dump` of `db` to `/var/backups/wolfcar/db-YYYYMMDD.dump`,
  keep 14.
- Weekly: tar of the `uploads` volume, keep 4.
- DigitalOcean weekly droplet backups (CTO enables; +20%).
- Restore steps written in the runbook.

### Runbook — `DEPLOY.md`

Server setup from zero, env file templates (`deploy/*.example`; the real `deploy/*.env` are git-ignored), deploy,
rollback, restore from backup, adding the friend's Caddy block, and the launch
checklist below.

## Launch plan

1. Server setup + data move while `wolfcar.qa` still points to Netlify. The
   Caddyfile only has the sslip.io block for now; the `wolfcar.qa` block is
   added at the switch (adding it earlier makes Caddy fail validation
   repeatedly, which Let's Encrypt rate-limits).
2. Pre-launch checklist on `https://wolfcar.167-172-106-106.sslip.io`
   (fallback: SSH tunnel `ssh -L 3000:127.0.0.1:3000 wolfcar`, then
   `http://localhost:3000`; browsers accept `Secure` cookies on localhost): both languages and
   themes, all images, login for each role, two-factor setup, create an order,
   print a PDF receipt (Chromium in the container), showroom kiosk.
3. A day before: lower the TTL of the two records to 300 s if the Ooredoo panel
   allows it.
4. DNS switch in the Ooredoo panel (needs the domain owner's login):
   `wolfcar.qa` A `75.2.60.5` → `167.172.106.106`;
   `www` CNAME `golden-tapioca-ef5b4b.netlify.app` → `wolfcar.qa`.
   **MX and TXT records (Microsoft 365 email) are not touched.**
5. Add the `wolfcar.qa` / `www` blocks to the Caddyfile and reload; Caddy
   obtains the certificate within about a minute. Set
   `PUBLIC_URL=https://wolfcar.qa`, remove the sslip.io and localhost entries
   from `CORS_ORIGINS` and the sslip.io block from the Caddyfile, redeploy, run the smoke test on
   `https://wolfcar.qa`, and check login throttling sees real client IPs.
6. Keep the Netlify site for a week. Rollback = point the A record back to
   `75.2.60.5`. Afterwards remove the domain from the Netlify site and delete
   its unused DNS zone.

## Out of scope

GitHub Actions / image registry (approach B), managed database, object storage
for photos, staging environment, the hero-animation change (ships only if
committed before deploy).

## Risks

- **1 GB droplet**: `next build` may take long or be killed; swap mitigates,
  resize fixes. The deploy script checks free memory and warns.
- **Two projects, one box**: port clash on 80/443 is avoided by the shared
  Caddy; resource use of the friend's app is outside our control.
- **Email outage** if the DNS editor replaces the whole zone — the checklist
  names the records that must stay.
