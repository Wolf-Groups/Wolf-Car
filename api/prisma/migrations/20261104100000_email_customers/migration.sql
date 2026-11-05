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
