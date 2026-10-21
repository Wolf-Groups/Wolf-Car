-- Online checkout, phase 1: website customers, card payments through Tap,
-- and the outbox that turns paid web orders into Odoo sale orders.
-- Adds only; showroom orders keep source = SHOWROOM and payment_status = NONE.

CREATE TYPE "OrderSource" AS ENUM ('SHOWROOM', 'WEB');
CREATE TYPE "PaymentStatus" AS ENUM ('NONE', 'PENDING', 'PAID', 'REFUNDED');
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('INITIATED', 'CAPTURED', 'FAILED');
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

CREATE TABLE "customers" (
    "id"              UUID NOT NULL,
    "phone"           VARCHAR(20) NOT NULL,
    "name"            VARCHAR(80),
    "email"           VARCHAR(254),
    "session_version" INTEGER NOT NULL DEFAULT 1,
    "last_login_at"   TIMESTAMPTZ(3),
    "created_at"      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

CREATE TABLE "customer_otps" (
    "id"          UUID NOT NULL,
    "phone"       VARCHAR(20) NOT NULL,
    "code_hash"   VARCHAR(64) NOT NULL,
    "expires_at"  TIMESTAMPTZ(3) NOT NULL,
    "attempts"    INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at"  TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_otps_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "customer_otps_phone_created_at_idx" ON "customer_otps"("phone", "created_at");

ALTER TABLE "orders"
    ADD COLUMN "source"          "OrderSource" NOT NULL DEFAULT 'SHOWROOM',
    ADD COLUMN "customer_id"     UUID,
    ADD COLUMN "customer_phone"  VARCHAR(20),
    ADD COLUMN "customer_email"  VARCHAR(254),
    ADD COLUMN "payment_status"  "PaymentStatus" NOT NULL DEFAULT 'NONE',
    ADD COLUMN "paid_at"         TIMESTAMPTZ(3),
    ADD COLUMN "expires_at"      TIMESTAMPTZ(3),
    ADD COLUMN "collected_by_id" UUID,
    ADD COLUMN "collected_at"    TIMESTAMPTZ(3);
CREATE INDEX "orders_customer_id_idx" ON "orders"("customer_id");
CREATE INDEX "orders_source_payment_status_expires_at_idx" ON "orders"("source", "payment_status", "expires_at");
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_collected_by_id_fkey"
    FOREIGN KEY ("collected_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payments" (
    "id"           UUID NOT NULL,
    "order_id"     UUID NOT NULL,
    "provider"     VARCHAR(16) NOT NULL DEFAULT 'tap',
    "charge_id"    VARCHAR(64),
    "status"       "PaymentAttemptStatus" NOT NULL DEFAULT 'INITIATED',
    "amount"       DECIMAL(12,2) NOT NULL,
    "currency"     CHAR(3) NOT NULL DEFAULT 'QAR',
    "failure_code" VARCHAR(64),
    "raw_last"     JSONB,
    "refund_id"    VARCHAR(64),
    "refunded_at"  TIMESTAMPTZ(3),
    "created_at"   TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payments_charge_id_key" ON "payments"("charge_id");
CREATE INDEX "payments_order_id_created_at_idx" ON "payments"("order_id", "created_at");
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "odoo_outbox" (
    "id"                 UUID NOT NULL,
    "order_id"           UUID NOT NULL,
    "status"             "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts"           INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at"    TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error"         VARCHAR(600),
    "odoo_partner_id"    INTEGER,
    "odoo_sale_order_id" INTEGER,
    "created_at"         TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "odoo_outbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "odoo_outbox_order_id_key" ON "odoo_outbox"("order_id");
CREATE INDEX "odoo_outbox_status_next_attempt_at_idx" ON "odoo_outbox"("status", "next_attempt_at");
ALTER TABLE "odoo_outbox" ADD CONSTRAINT "odoo_outbox_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
