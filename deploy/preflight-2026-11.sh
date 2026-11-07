#!/usr/bin/env bash
# For the deploy of 2026-11 (email customers) only; delete with docs/deploy/next-deploy.md. Right before it,
# from the laptop: scp deploy/preflight-2026-11.sh wolfadmin-ts:~/ && ssh -t wolfadmin-ts sudo bash ~/preflight-2026-11.sh
#  1. checks the API settings the new version needs (prints no secret)
#  2. checks no failed migration is recorded (it would stop every API start)
#  3. tries this deploy's two migrations on the live data in a transaction that is
#     ROLLED BACK (nothing is kept) and says how many customers they touch
#  4. takes the database backup to restore if the deploy has to be undone
set -euo pipefail
cd /opt/wolfcar/app
source scripts/lib.sh
load_env
ENV_FILE=deploy/api.prod.env
fail=0

echo "== 1. settings in $ENV_FILE"
val() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }
for v in EMAIL_PROVIDER EMAIL_FROM EMAIL_FROM_NAME SHOP_NOTIFY_EMAIL WEB_PUBLIC_URL API_PUBLIC_URL TRUST_PROXY; do
  printf '  %-18s %s\n' "$v" "$(val "$v")"
done
[[ -n "$(val BREVO_API_KEY)" ]] && echo "  BREVO_API_KEY      set" || echo "  BREVO_API_KEY      MISSING"
[[ "$(val EMAIL_PROVIDER)" == brevo ]] || { echo "  ! EMAIL_PROVIDER is not brevo: sign-in codes will answer 'not available'"; fail=1; }
[[ "$(val EMAIL_PROVIDER)" != brevo || ( -n "$(val BREVO_API_KEY)" && "$(val EMAIL_FROM)" == *@*.* ) ]] \
  || { echo "  ! brevo needs BREVO_API_KEY and an EMAIL_FROM address, or the new API will not start"; fail=1; }
[[ "$(val WEB_PUBLIC_URL)" == https://* && "$(val API_PUBLIC_URL)" == https://* ]] || { echo "  ! WEB_PUBLIC_URL / API_PUBLIC_URL missing"; fail=1; }

echo; echo "== 2. failed migrations recorded"
failed=$(dc exec -T db psql -U wolfcar -d wolfcar -tA -c \
  "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL")
if [[ -n "$failed" ]]; then echo "  ! $failed"; fail=1; else echo "  none"; fi

echo; echo "== 3. this deploy's migrations on the live data (rolled back)"
if ! dc exec -T db psql -U wolfcar -d wolfcar -v ON_ERROR_STOP=1 -q <<'SQL'
SET lock_timeout = '5s';
BEGIN;
SELECT count(*) AS customers,
       count(*) FILTER (WHERE nullif(trim(email), '') IS NOT NULL) AS with_email,
       count(*) FILTER (WHERE nullif(trim(email), '') IS NOT NULL)
         - count(DISTINCT lower(trim(email))) FILTER (WHERE nullif(trim(email), '') IS NOT NULL) AS duplicate_emails_cleared
FROM customers;
-- ---- 20261021153321_customer_cars
-- CreateTable
CREATE TABLE "customer_cars" (
    "customer_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_cars_pkey" PRIMARY KEY ("customer_id","category_id")
);

-- CreateIndex
CREATE INDEX "customer_cars_category_id_idx" ON "customer_cars"("category_id");

-- AddForeignKey
ALTER TABLE "customer_cars" ADD CONSTRAINT "customer_cars_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_cars" ADD CONSTRAINT "customer_cars_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- ---- 20261104100000_email_customers
-- Customers sign in with their email instead of their phone (there is no SMS provider).

-- Codes sent to phones are useless now; the table keys on the email instead.
DELETE FROM "customer_otps";
DROP INDEX "customer_otps_phone_created_at_idx";
ALTER TABLE "customer_otps" RENAME COLUMN "phone" TO "email";
ALTER TABLE "customer_otps" ALTER COLUMN "email" TYPE VARCHAR(254);
CREATE INDEX "customer_otps_email_created_at_idx" ON "customer_otps"("email", "created_at");

-- The email typed at checkout becomes the identity: lower-case, and one customer per address
-- (the most recently updated keeps it; the others keep their orders but no email).
UPDATE "customers" SET "email" = lower(trim("email")) WHERE "email" IS NOT NULL;
UPDATE "customers" SET "email" = NULL WHERE "email" = '';
UPDATE "customers" c SET "email" = NULL
WHERE "email" IS NOT NULL AND EXISTS (
  SELECT 1 FROM "customers" o
  WHERE o."email" = c."email" AND (o."updated_at", o."id") > (c."updated_at", c."id")
);
DROP INDEX "customers_phone_key";
ALTER TABLE "customers" ALTER COLUMN "phone" DROP NOT NULL;
CREATE UNIQUE INDEX "customers_email_key" ON "customers"("email");

-- The language the order was placed in, for its emails.
ALTER TABLE "orders" ADD COLUMN "customer_locale" VARCHAR(2) NOT NULL DEFAULT 'ar';
SELECT count(*) AS customers_after, count(email) AS with_email_after FROM customers;
ROLLBACK;
SQL
then
  echo "  ! the migrations FAIL on the live data: do not deploy, send this output to Claude"
  exit 1
fi
echo "  ok: both migrations work on the live data (and were rolled back)"

if (( fail )); then echo; echo "fix the ! lines above first; no backup taken"; exit 1; fi

echo; echo "== 4. backup"
scripts/backup.sh
echo; df -h / | tail -1
echo "ready: tell Claude to deploy"
