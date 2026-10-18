# Online Checkout Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A website visitor signs in with a phone code, pays for parts by card through Tap, collects at Bin Omran; the paid order shows in the dashboard and becomes a confirmed sale order in Odoo.

**Architecture:** New `api/src/shop/` (customer sign-in, checkout, payments) sits next to the existing modules and reuses `Order`/`OrderItem` with a few new columns, so the cashier's orders page, receipts and the activity log keep working. Payments go through a `PaymentGateway` interface with a real `TapClient` and an in-memory `FakePaymentGateway` for tests. Odoo writes happen from an outbox table processed by a timer, never in the request path. The website adds `/checkout` and `/checkout/return` pages under `features/shop/`.

**Tech Stack:** Next.js 16 (App Router, next-intl, Tailwind 4, Vitest + Testing Library + MSW), NestJS 12, Prisma 7 / PostgreSQL 17, Jest (unit `npm test`, e2e `npm run test:e2e`, both from `api/`), Playwright (`npm run test:e2e` from the root), Tap Payments (Card SDK Web v2 + Charges API v2).

**Spec:** `docs/superpowers/specs/2026-10-18-online-checkout-phase1-design.md`

## Scaffolding already in the branch

The branch `feat/online-checkout-phase1` already holds, written by the planner so every task starts from the same names:

- The Prisma schema changes and the migration (Task 1) — **done**, apply and regenerate before anything else.
- `shared/shop.ts` with the signatures below and bodies that throw `TODO`, plus every test file named in this plan with its assertions. Each task's "write the failing test" step therefore means *open the test file, read it, run it, see it fail*; the implementer edits a test only when the plan's assertion is wrong, and says so in the commit.
- Stub source files for every `Create:` entry, holding the exported signatures with `throw new Error('TODO(phase1): …')` bodies so `npm run typecheck` passes on both projects.

## Global Constraints

- Currency is `QAR`, two decimals. Money is `Prisma.Decimal` on the server and a `"1234.50"` string in JSON (`api/src/common/money.ts`); never `number` arithmetic.
- The order total is computed on the server from `products.price`; the browser never sends a price.
- An order becomes `PAID` only inside `PaymentsService.settle()` from a charge object that came from Tap (verified webhook or `getCharge`). Never from the redirect alone.
- Every new `POST`/`PUT`/`PATCH`/`DELETE` route carries `@Audit('<group>.<verb>')`, and every new route is added to `MATRIX` in `api/test/rbac-matrix.e2e-spec.ts` **in the same task**. The skip list in `api/test/audit-coverage.e2e-spec.ts` does not grow.
- Customer routes live under `/api/shop`, are `@Public()` for the JWT guard and `@UseGuards(CustomerGuard)` unless the step says otherwise. Non-GET customer routes need the CSRF header `X-Requested-With: wolfcar` (`csrf` in `api/test/utils/auth.ts`).
- Secrets (`TAP_SECRET_KEY`, `ODOO_WRITE_API_KEY`) never appear in logs, error messages or audit metadata. Card numbers never reach the API; `rawLast` stores Tap's charge object as received (it carries only `first_six`/`last_four`).
- Pickup branch: the branch whose `code` equals `WEB_ORDERS_BRANCH_CODE` (default `BO`).
- Unpaid web orders expire `CHECKOUT_TTL_MINUTES` (default `30`) after creation.
- Phone numbers are stored as E.164 `+974XXXXXXXX`; only Qatari mobiles (8 digits starting with 3, 5, 6 or 7) are accepted.
- Copy: Arabic first, English second, in the tone of the existing `Cart` / `ProductsPage` messages. Website strings go in `messages/{ar,en}.json`, dashboard strings in `messages/app/{ar,en}/orders.json`.
- Before each commit, from `api/`: `npm run lint && npm run typecheck && npm test`; from the root: `npm run lint && npm run typecheck && npm test`. e2e suites run when the task touches routes (API) or pages (Playwright).
- Commit messages follow the repo style (`feat(shop): …`, `feat(payments): …`, `feat(odoo): …`, `feat(web): …`) and end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. **A webhook arrives twice, or after `reconcile` already settled the order** → the second settle is a no-op (`already_paid`); no second outbox row, no second audit `SUCCESS` saying "paid". Pinned in Task 6 (`settle` repeat case + e2e "second delivery").
2. **The customer pays, closes the tab during 3-D Secure, and comes back an hour later** → the order expired at 30 min, the webhook then captured it: the order ends `CONFIRMED`/`PAID`, the audit metadata says `afterExpiry: true`. Pinned in Task 6 and Task 7.
3. **A product in the basket was switched off by the Odoo sync between adding and paying** → `POST /api/shop/orders` answers 400 `PRODUCT_UNAVAILABLE` with the ids; the website removes those lines and says so. Pinned in Task 5 (service spec) and Task 15 (checkout flow test).
4. **Tap charges `100.00` but our order says `120.50`** (tampered amount in a replayed request, or a currency mix-up) → payment recorded `CAPTURED` with `failureCode = AMOUNT_MISMATCH`, order stays `PENDING`, audit `FAILURE`. Pinned in Task 6.
5. **Odoo rejects the sale order because a product has no `odooId`** → the outbox row fails with `PRODUCT_NOT_IN_ODOO`, the dashboard shows it on the order, Finance presses *Retry* after fixing Odoo. Pinned in Task 9 (mapping spec) and Task 10 (e2e).

---

### Task 1: Shared rules, schema, migration, environment

**Files:**
- Modify: `shared/shop.ts` (stubbed; implement)
- Modify: `shared/permissions.ts` (`order.odoo.retry`)
- Modify: `shared/analytics.ts` (`checkout_start`, `order_paid`)
- Modify: `api/prisma/schema.prisma` — **done by the planner**
- Create: `api/prisma/migrations/20261018100000_online_checkout/migration.sql` — **done by the planner**
- Modify: `api/src/config/env.ts`
- Modify: `api/.env.example`, `deploy/api.prod.env.example`
- Modify: `api/test/utils/fixtures.ts` (`resetDatabase` table list)
- Test: `shared/shop.test.ts` (Vitest, root), `api/src/config/env.spec.ts`

**Interfaces:**
- Produces (`shared/shop.ts`, no imports, compiled into both projects):
  - `normaliseQatarPhone(input: string): string | null` — accepts Arabic-Indic digits, spaces, dashes, parentheses, a leading `+974`, `00974` or `974`, or a bare 8-digit local number; returns `+974` + 8 digits when the first local digit is 3, 5, 6 or 7, else `null`.
  - `localQatarNumber(e164: string): string` — `"+97455123456"` → `"55123456"`.
  - `OTP_LENGTH = 6`, `OTP_TTL_SECONDS = 300`, `OTP_MAX_ATTEMPTS = 5`, `OTP_RESEND_SECONDS = 60`, `OTP_CODE_PATTERN = /^\d{6}$/`.
  - `CUSTOMER_EMAIL_MAX = 254`, `EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`.
  - `ORDER_SOURCES = ['SHOWROOM', 'WEB'] as const`, `OrderSourceName`; `PAYMENT_STATUSES = ['NONE', 'PENDING', 'PAID', 'REFUNDED'] as const`, `PaymentStatusName`.
  - `CHECKOUT_POLL_MS = 3000`, `CHECKOUT_POLL_MAX_MS = 30000`.
  - `FAKE_TOKENS = { ok: 'tok_fake_ok', declined: 'tok_fake_declined', pending: 'tok_fake_pending' } as const`.
- Produces (Prisma): enums `OrderSource`, `PaymentStatus`, `PaymentAttemptStatus { INITIATED CAPTURED FAILED }`, `OutboxStatus { PENDING DONE FAILED }`; models `Customer`, `CustomerOtp`, `Payment`, `OdooOutbox`; `Order.source`, `Order.customerId`, `Order.customerPhone`, `Order.customerEmail`, `Order.paymentStatus`, `Order.paidAt`, `Order.expiresAt`, `Order.collectedAt`, `Order.collectedById`. Read `api/prisma/schema.prisma` for the exact fields.
- Produces (`Env`): `TAP_SECRET_KEY?`, `TAP_API_URL = 'https://api.tap.company/v2'`, `PAYMENTS_PROVIDER: 'tap' | 'fake' = 'tap'`, `WEB_PUBLIC_URL?`, `API_PUBLIC_URL?`, `WEB_ORDERS_BRANCH_CODE = 'BO'`, `CHECKOUT_TTL_MINUTES = 30` (1..1440), `SMS_PROVIDER: 'console' = 'console'`, `OTP_DEV_CODE_IN_RESPONSE = false` (boolean via `toBool`; `validateEnv` throws when it is true while `TAP_SECRET_KEY` starts with `sk_live_`), `OTP_PER_PHONE_PER_15_MIN = 3`, `CUSTOMER_SESSION_TTL_DAYS = 30`, `ODOO_WRITE_LOGIN?`, `ODOO_WRITE_API_KEY?`, `ODOO_WEB_WAREHOUSE_ID?: number`, `ODOO_FALLBACK_PRODUCT_ID?: number`. Empty strings become `undefined` (`emptyToUndefined`), as the `ODOO_*` ones do.
- Produces (`shared/permissions.ts`): key `'order.odoo.retry': { group: 'order', description: 'Send a paid web order to Odoo again after it failed' }`, default for `FINANCE`.

- [ ] **Step 1: Apply the migration and regenerate the client**

From the repo root: `docker compose up -d db db-test`. From `api/`: `cp .env.example .env` if missing and set the two secrets per the README; then `npm run db:migrate && npm run prisma:generate && npm run typecheck`.
Expected: migration `20261018100000_online_checkout` applied; typecheck passes.

- [ ] **Step 2: Confirm schema and migration agree**

Run from `api/`: `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --shadow-database-url "$TEST_DATABASE_URL" --exit-code`
Expected: "No difference detected".

- [ ] **Step 3: Run the shared test to see it fail**

Run from the root: `npx vitest run shared/shop.test.ts`
Expected: FAIL with `TODO(phase1)`.

- [ ] **Step 4: Implement `shared/shop.ts`**

Digits: reuse the Arabic-Indic fold from `normaliseDigits` in `shared/validation.ts` by copying the one-line regex (the file must stay import-free). Strip everything that is not a digit after folding, then strip a leading `00974` or `974`; accept exactly 8 remaining digits starting with `[3567]`.

- [ ] **Step 5: Run the shared test**

Run: `npx vitest run shared/shop.test.ts` — Expected: PASS.

- [ ] **Step 6: Add the permission and the analytics events**

`shared/permissions.ts`: add the key after `'order.receipt.download'` and `'order.odoo.retry'` to `DEFAULT_ROLE_PERMISSIONS.FINANCE`. `shared/analytics.ts`: add `'checkout_start'` and `'order_paid'` with one-line comments.

- [ ] **Step 7: Environment**

Add the variables to `Env` in `api/src/config/env.ts` with the validators listed in Interfaces; `PAYMENTS_PROVIDER` uses `@IsIn(['tap','fake'])`, `SMS_PROVIDER` uses `@IsIn(['console'])`, the URLs `@Matches(/^https?:\/\//)`, the integer ids `@Type(() => Number) @IsInt() @Min(1)` behind `emptyToUndefined`. The live-key guard is a plain `if` in `validateEnv` after `validateSync`. Document each in `api/.env.example` under a new `# ---- payments` and `# ---- odoo (writing)` block and in `deploy/api.prod.env.example`. The cases in `api/src/config/env.spec.ts` (already written): defaults (`TAP_API_URL`, `WEB_ORDERS_BRANCH_CODE = 'BO'`, `CHECKOUT_TTL_MINUTES = 30`, `OTP_DEV_CODE_IN_RESPONSE = false`), `PAYMENTS_PROVIDER=stripe` throws, `OTP_DEV_CODE_IN_RESPONSE=true` with `TAP_SECRET_KEY=sk_live_x` throws, with `sk_test_x` passes.

- [ ] **Step 8: Test fixtures**

In `resetDatabase` add, before `'order_items'`: `'odoo_outbox'`, `'payments'`; after `'orders'`: `'customer_otps'`, `'customers'`. Seed nothing new.

- [ ] **Step 9: Verify and commit**

From `api/`: `npm run lint && npm run typecheck && npm test`. From the root: `npm run lint && npm run typecheck && npm test`.

```bash
git add shared api/prisma api/src/config api/.env.example deploy/api.prod.env.example api/test/utils/fixtures.ts
git commit -m "feat(shop): shared rules, schema and settings for online checkout"
```

---

### Task 2: Tap charge facts and webhook signature (pure)

**Files:**
- Create: `api/src/shop/payments/tap-charge.ts`
- Create: `api/src/shop/payments/tap-signature.ts`
- Test: `api/src/shop/payments/tap-charge.spec.ts`, `api/src/shop/payments/tap-signature.spec.ts`

**Interfaces:**
- Produces (`tap-charge.ts`):
  - `interface TapCharge { id: string; object?: string; status: string; amount: number; currency: string; live_mode?: boolean; reference?: { gateway?: string; payment?: string; order?: string; idempotent?: string; transaction?: string }; transaction?: { created?: string | number; url?: string }; response?: { code?: string; message?: string }; metadata?: Record<string, string>; [k: string]: unknown }`
  - `type ChargeOutcome = 'captured' | 'failed' | 'pending'`
  - `chargeOutcome(status: string): ChargeOutcome` — `CAPTURED` → captured; `DECLINED | FAILED | CANCELLED | ABANDONED | RESTRICTED | TIMEDOUT | VOID | UNKNOWN` → failed; anything else (`INITIATED`, `AUTHORIZED`, `IN_PROGRESS`, unknown strings) → pending. Case-insensitive.
  - `formatTapAmount(amount: number | string, currency = 'QAR'): string` — two decimals for QAR/SAR/AED (`1` → `"1.00"`, `"120.5"` → `"120.50"`), three for KWD/BHD/OMR.
  - `sameAmount(chargeAmount: number, orderTotal: string): boolean` — compares `formatTapAmount(chargeAmount)` with `orderTotal`.
- Produces (`tap-signature.ts`):
  - `tapHashString(c: TapCharge): string` — `x_id…x_amount…x_currency…x_gateway_reference…x_payment_reference…x_status…x_created…`, missing references as empty strings, amount through `formatTapAmount`.
  - `signTapCharge(c: TapCharge, secret: string): string` — hex HMAC-SHA256.
  - `verifyTapSignature(c: TapCharge, header: string | string[] | undefined, secret: string): boolean` — `crypto.timingSafeEqual` on equal-length buffers; `false` for a missing or malformed header.

- [ ] **Step 1: Run the two specs, see them fail** — `npm test -- tap-charge tap-signature` from `api/`. Expected: FAIL with `TODO(phase1)`.
- [ ] **Step 2: Implement both files** to the signatures above. The worked example in the spec's signature test (`x_idchg_TS05A4120230736x9K22710693x_amount1.00x_currencySAR…`) must reproduce byte for byte.
- [ ] **Step 3: Run the specs** — Expected: PASS.
- [ ] **Step 4: Commit** — `git commit -m "feat(payments): Tap charge outcome and webhook signature"`

---

### Task 3: Payment gateway: Tap client and fake

**Files:**
- Create: `api/src/shop/payments/payment-gateway.ts`
- Create: `api/src/shop/payments/tap-client.ts`
- Create: `api/src/shop/payments/fake-gateway.ts`
- Create: `api/src/shop/payments/payments.module.ts` (provider only; controllers come in Task 6)
- Test: `api/src/shop/payments/tap-client.spec.ts`, `api/src/shop/payments/fake-gateway.spec.ts`

**Interfaces:**
- Produces (`payment-gateway.ts`):
  - `interface CreateChargeInput { amount: string; currency: 'QAR'; tokenId: string; customer: { name: string; email: string; phone: string }; redirectUrl: string; postUrl: string; orderId: string; orderCode: string; paymentId: string; description: string; locale: 'ar' | 'en' }`
  - `interface RefundInput { chargeId: string; amount: string; currency: 'QAR'; reason: string }`
  - `interface GatewayRefund { id: string; status: string }`
  - `interface PaymentGateway { createCharge(input: CreateChargeInput): Promise<TapCharge>; getCharge(chargeId: string): Promise<TapCharge>; refund(input: RefundInput): Promise<GatewayRefund> }`
  - `class PaymentGatewayError extends Error { constructor(message: string, readonly code: string = 'GATEWAY_ERROR', readonly status?: number) }`
  - `const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY')`
- Produces (`tap-client.ts`): `class TapClient implements PaymentGateway { constructor(cfg: { apiUrl: string; secretKey: string }, fetchFn: typeof fetch = fetch) }`. Request body for a charge: `{ amount: Number(input.amount), currency, threeDSecure: true, save_card: false, description, metadata: { orderId, paymentId }, reference: { order: orderCode, idempotent: paymentId }, customer: { first_name, last_name, email, phone: { country_code: '974', number: localQatarNumber(phone) } }, source: { id: tokenId }, redirect: { url: redirectUrl }, post: { url: postUrl } }`; `first_name` is the text before the first space, `last_name` the rest or `""`. Headers `Authorization: Bearer <secret>`, `Content-Type: application/json`, `lang_code: <locale>`. Non-2xx → `PaymentGatewayError(errors[0].description ?? 'Tap error', errors[0].code ?? 'TAP_HTTP_' + status, status)` with the secret stripped from the message. `getCharge` → `GET {apiUrl}/charges/{id}`; `refund` → `POST {apiUrl}/refunds` with `{ charge_id, amount: Number(amount), currency, reason }`. 15 s timeout (`AbortSignal.timeout`).
- Produces (`fake-gateway.ts`): `class FakePaymentGateway implements PaymentGateway` with an in-memory `Map<string, { charge: TapCharge; tokenId: string }>`. `createCharge`: token not in `FAKE_TOKENS` → `PaymentGatewayError('Unknown test token', 'INVALID_TOKEN', 400)`; else charge `{ id: 'chg_fake_' + counter, status: 'INITIATED', amount: Number(amount), currency, reference: { order: orderCode, idempotent: paymentId, gateway: '', payment: '' }, transaction: { created: String(Date.now()), url: redirectUrl }, metadata: { orderId, paymentId } }`. `getCharge`: `tok_fake_ok` → status becomes `CAPTURED` (with `reference.payment = 'fakepay1'`), `tok_fake_declined` → `DECLINED`, `tok_fake_pending` → unchanged; unknown id → `PaymentGatewayError('No such charge', 'NOT_FOUND', 404)`. `settle(chargeId, status: string): TapCharge` sets the status for tests. `refund`: charge not `CAPTURED` → `PaymentGatewayError('Not captured', 'NOT_CAPTURED', 400); else `{ id: 'rf_fake_' + counter, status: 'REFUNDED' }` and the charge status becomes `REFUNDED`.
- Produces (`payments.module.ts`): `{ provide: PAYMENT_GATEWAY, inject: [ConfigService], useFactory }` → `FakePaymentGateway` when `PAYMENTS_PROVIDER === 'fake'`, else `TapClient` when `TAP_SECRET_KEY` is set, else `null` (checkout then answers `CHECKOUT_UNAVAILABLE`, Task 5). Export `PAYMENT_GATEWAY`.

- [ ] **Step 1: Run the specs, see them fail** — `npm test -- tap-client fake-gateway`.
- [ ] **Step 2: Implement the three files and the module.**
- [ ] **Step 3: Run the specs** — PASS. `npm run typecheck`.
- [ ] **Step 4: Commit** — `git commit -m "feat(payments): Tap client and fake gateway behind one interface"`

---

### Task 4: Customer sign-in by phone code

**Files:**
- Modify: `api/src/auth/cookies.ts` (customer cookie helpers)
- Modify: `api/src/auth/token.service.ts` (`signCustomer`, `verifyCustomer`)
- Create: `api/src/shop/sms/sms-sender.ts`
- Create: `api/src/shop/customers/otp.service.ts`
- Create: `api/src/shop/customers/customers.service.ts`
- Create: `api/src/shop/customers/customer.guard.ts`
- Create: `api/src/shop/customers/current-customer.decorator.ts`
- Create: `api/src/shop/customers/shop-auth.controller.ts`
- Create: `api/src/shop/dto/shop.dto.ts` (`SendOtpDto`, `VerifyOtpDto`; the order DTOs are added in Task 5)
- Create: `api/src/shop/shop.module.ts`; register in `api/src/app.module.ts` after `PublicModule`
- Test: `api/src/auth/token.service.spec.ts` (extend), `api/src/shop/sms/sms-sender.spec.ts`, `api/src/shop/customers/otp.service.spec.ts`, `api/src/shop/customers/customer.guard.spec.ts`, `api/test/shop-auth.e2e-spec.ts`, `api/test/rbac-matrix.e2e-spec.ts` (extend)

**Interfaces:**
- Produces (`cookies.ts`): `CUSTOMER_COOKIE = { name: 'wc_cst', path: '/api/shop' }`, `CUSTOMER_HINT_COOKIE = 'wc_customer'`, `setCustomerCookie(res, token, expires, secure)`, `clearCustomerCookie(res, secure)`, `readCustomerCookie(req): string | undefined` — same options as the slots cookie (httpOnly, strict, path-scoped; hint readable, lax, `/`).
- Produces (`token.service.ts`): `CUSTOMER_AUDIENCE = 'customer'`; `signCustomer(customerId: string, version: number): Promise<{ token: string; expiresAt: Date }>` with `expiresIn = CUSTOMER_SESSION_TTL_DAYS * 86400`; `verifyCustomer(token: string): Promise<{ sub: string; ver: number }>` throwing `AuthFailedException('SESSION_EXPIRED')`.
- Produces (`sms-sender.ts`): `interface SmsSender { send(phone: string, text: string): Promise<void> }`; `const SMS_SENDER = Symbol('SMS_SENDER')`; `class ConsoleSmsSender implements SmsSender` logging `SMS to +974…: <text>` with Nest `Logger` and keeping `lastMessage(phone): string | undefined`; `otpMessage(code: string, locale: 'ar' | 'en'): string` — the exact copy is the implementer's, it must contain the code and "Wolf Car".
- Produces (`otp.service.ts`): `class OtpService { issue(phone: string): Promise<{ expiresAt: Date; devCode?: string }>; verify(phone: string, code: string): Promise<{ customer: CustomerPrincipal; created: boolean }> }`. `issue`: count rows for the phone created in the last 15 min ≥ `OTP_PER_PHONE_PER_15_MIN` → `HttpException` 429 `{ code: 'OTP_TOO_MANY', retryAfterSeconds }`; otherwise create a row with `codeHash = sha256Hex(code + ':' + phone)`, `expiresAt = now + OTP_TTL_SECONDS`, send `otpMessage`; `devCode` is returned only when `SMS_PROVIDER === 'console'` and (`NODE_ENV !== 'production'` or `OTP_DEV_CODE_IN_RESPONSE`). Codes come from `crypto.randomInt(0, 1_000_000)` zero-padded. `verify`: load the newest unconsumed, unexpired row for the phone; none → 401 `OTP_INVALID`; claim one attempt with a conditional `updateMany({ where: { id, attempts: { lt: OTP_MAX_ATTEMPTS } }, data: { attempts: { increment: 1 } } })` and treat `count === 0` as 401 `OTP_INVALID`; compare hashes with `timingSafeEqual`; on success set `consumedAt`, upsert the `Customer` by phone (`lastLoginAt = now`), and return the principal.
- Produces (`customers.service.ts`): `interface CustomerPrincipal { id: string; phone: string; name: string | null; email: string | null; sessionVersion: number }`; `class CustomersService { loadFromToken(token: string | undefined): Promise<CustomerPrincipal>` (401 `SESSION_EXPIRED` when missing, invalid, unknown id or `ver !== sessionVersion`); `logoutAll(id: string): Promise<void>` (increment `sessionVersion`); `profile(id): Promise<{ phone; name; email }>` }`.
- Produces (`customer.guard.ts`): `class CustomerGuard implements CanActivate` — `req.customer = await customers.loadFromToken(readCustomerCookie(req))`; non-GET without CSRF header → 403 `CSRF`; also `trail.setActor({ id: null, username: customer.phone, role: null, branchId: null })`. `interface CustomerRequest extends Request { customer?: CustomerPrincipal }`.
- Produces (`current-customer.decorator.ts`): `@CurrentCustomer()` param decorator (401 when absent), mirrors `CurrentUser`.
- Produces (routes, controller `ShopAuthController` at `shop`, class-level `@Public()`):
  - `POST /api/shop/otp` `{ phone }` `@AuthThrottle() @Audit('shop.otp.send', { entity: 'Customer' })` → 200 `{ expiresAt, devCode? }`. The DTO transforms `phone` through `normaliseQatarPhone` and rejects `null` with 400 field error `phone`.
  - `POST /api/shop/otp/verify` `{ phone, code }` `@AuthThrottle() @Audit('shop.otp.verify', { entity: 'Customer' })` → sets the cookie, 200 `{ customer: { phone, name, email }, expiresAt }`. `trail.setEntity('Customer', id)` on success; on failure the entry has `actorUsername = phone`.
  - `GET /api/shop/me` (guard) → `{ phone, name, email }`.
  - `POST /api/shop/logout` (guard, `@Audit('shop.logout')`) → clears cookies, 204.
  - `POST /api/shop/logout-all` (guard, `@Audit('shop.logout_all')`) → bumps the version, clears cookies, 204.
- Produces (`shop.module.ts`): imports `PaymentsModule`; providers `CustomersService`, `OtpService`, `CustomerGuard`, `{ provide: SMS_SENDER, useClass: ConsoleSmsSender }` (a factory on `SMS_PROVIDER` once a second sender exists); controllers listed per task.

- [ ] **Step 1: Run the unit specs, see them fail** — `npm test -- token.service sms-sender otp.service customer.guard`.
- [ ] **Step 2: Implement cookies, token methods, SMS sender, OTP service, customers service, guard, decorator, controller, module; register `ShopModule` in `AppModule`.**
- [ ] **Step 3: Unit specs pass** — `npm test -- token.service sms-sender otp.service customer.guard`.
- [ ] **Step 4: Add the five routes to `MATRIX`** in `api/test/rbac-matrix.e2e-spec.ts`: `'POST /api/shop/otp': ALL`, `'POST /api/shop/otp/verify': ALL`, `'GET /api/shop/me': { public: 401 }`, `'POST /api/shop/logout': { public: 401 }`, `'POST /api/shop/logout-all': { public: 401 }`.
- [ ] **Step 5: Run the e2e** — `docker compose up -d db-test` (root), then from `api/`: `npm run test:e2e -- shop-auth rbac-matrix audit-coverage`. Expected: PASS (read `api/test/shop-auth.e2e-spec.ts` first; it drives: unknown phone format 400, code sent and `devCode` present in test, wrong code ×5 then the right code is refused, right code sets `wc_cst` with `Path=/api/shop; HttpOnly; SameSite=Strict`, `GET /me` works with the cookie, POST without CSRF header is 403, `logout-all` makes the old cookie 401, fourth code within 15 min is 429 with `retryAfterSeconds`).
- [ ] **Step 6: Commit** — `git commit -m "feat(shop): customer sign-in with a phone code"`

---

### Task 5: Checkout: create, read and cancel a web order

**Files:**
- Create: `api/src/shop/checkout/checkout.service.ts`
- Create: `api/src/shop/checkout/checkout.controller.ts`
- Create: `api/src/shop/checkout/web-order.view.ts`
- Create: `api/src/shop/checkout/system-web-user.ts`
- Modify: `api/src/shop/dto/shop.dto.ts` (`CreateWebOrderDto`, `PayDto`)
- Modify: `api/src/shop/shop.module.ts`
- Test: `api/src/shop/checkout/checkout.service.spec.ts`, `api/src/shop/checkout/web-order.view.spec.ts`, `api/test/shop-checkout.e2e-spec.ts` (the *order* describe block), `api/test/rbac-matrix.e2e-spec.ts`

**Interfaces:**
- Consumes: `CustomerPrincipal`, `CustomerGuard`, `CurrentCustomer` (Task 4); `PAYMENT_GATEWAY` (Task 3) only to answer `CHECKOUT_UNAVAILABLE` when it is `null`.
- Produces (`web-order.view.ts`): `WEB_ORDER_SELECT` (Prisma select: order fields + `branch { code, name, nameAr }` + `items` ordered by `position` with `product { imageKey }` + `payments` newest first, `take: 1`, `select { status, failureCode, chargeId }`); `interface WebOrderView { id; code; status: OrderStatus; paymentStatus: PaymentStatus; total: string; currency: string; createdAt: string; expiresAt: string | null; paidAt: string | null; branch: { code; name; nameAr }; customer: { name: string | null; email: string | null; phone: string }; items: { productId; productName; unitPrice: string; quantity: number; lineTotal: string; thumbUrl: string }[]; lastPayment: { status: PaymentAttemptStatus; failureCode: string | null } | null }`; `webOrderView(row): WebOrderView`.
- Produces (`system-web-user.ts`): `SYSTEM_WEB_USERNAME = 'system.web'`; `ensureSystemWebUser(db: Prisma.TransactionClient | PrismaClient): Promise<string>` — same upsert as `system.odoo` in `odoo-sync.ts` with `displayName: 'Website orders'`.
- Produces (`checkout.service.ts`): `class CheckoutService { createOrder(customer: CustomerPrincipal, dto: CreateWebOrderDto, idempotencyKey: string | undefined): Promise<{ order: WebOrderView; replayed: boolean }>; get(customer, id: string): Promise<WebOrderView>; cancelUnpaid(customer, id): Promise<WebOrderView>; pickupBranch(): Promise<{ id: string; code: string }> }`.
  - `pickupBranch`: branch with `code = WEB_ORDERS_BRANCH_CODE` and `isActive`; else 503 `CHECKOUT_UNAVAILABLE`. Also 503 when the gateway is `null`.
  - `createOrder`: update the customer's `name`/`email` from the DTO; products `where: { id in, isActive: true, price: { not: null }, serviceId: null, branchPositions: { some: { branchId } } }`; missing → 400 `PRODUCT_UNAVAILABLE` `{ productIds }`; sequence, code, snapshots and total exactly as `ShowroomService.createOrder`; plus `source: 'WEB'`, `customerId`, `customerPhone`, `customerEmail`, `customerName: dto.name`, `paymentStatus: 'PENDING'`, `expiresAt: now + CHECKOUT_TTL_MINUTES`, `createdById: ensureSystemWebUser(tx)`, `idempotencyKey`. Replay on `(createdById, idempotencyKey)` as the showroom does, **but scoped to the customer**: the lookup also requires `customerId`.
  - `get`: `findFirst({ id, customerId })` else 404.
  - `cancelUnpaid`: one conditional `updateMany({ where: { id, customerId, status: 'PENDING', paymentStatus: 'PENDING', payments: { none: { status: 'CAPTURED' } } }, data: { status: 'CANCELLED', cancelledAt } })`; `count === 0` → 409 `ORDER_NOT_CANCELLABLE`.
  - Audit: `trail.setEntity('Order', id).setBranch(branchId).setChange(null, view)` on create; `setChange(before, after)` on cancel.
- Produces (DTOs): `CreateWebOrderDto { items: OrderLineDto[] (same rules as the showroom), name: @CustomerName(), email: @IsEmail() @MaxLength(CUSTOMER_EMAIL_MAX) }`; `PayDto { tokenId: @Matches(/^tok_[A-Za-z0-9_]{3,80}$/), locale: @IsIn(['ar','en']) }`.
- Produces (routes, `CheckoutController` at `shop/orders`, `@Public() @UseGuards(CustomerGuard)`):
  - `POST /api/shop/orders` `@Audit('shop.order.create', { entity: 'Order' })` — reads `Idempotency-Key` header (same validation as the showroom controller) → 201 `{ ...order, replayed }`.
  - `GET /api/shop/orders/:id` → `WebOrderView`.
  - `POST /api/shop/orders/:id/cancel` `@Audit('shop.order.cancel', { entity: 'Order', idParam: 'id' })` → `WebOrderView`.

- [ ] **Step 1: Run the unit specs, see them fail** — `npm test -- checkout.service web-order.view`.
- [ ] **Step 2: Implement** the view, the system user helper, the service, DTOs, controller; add the controller to `ShopModule`.
- [ ] **Step 3: Unit specs pass.**
- [ ] **Step 4: Matrix**: `'POST /api/shop/orders': { public: 401 }`, `'GET /api/shop/orders/:id': { public: 401 }`, `'POST /api/shop/orders/:id/cancel': { public: 401 }`.
- [ ] **Step 5: e2e** — `npm run test:e2e -- shop-checkout rbac-matrix audit-coverage`; only the `describe('web order')` block must pass at this point (the payment blocks are `describe.skip` until Task 6 flips them). It covers: product off the Bin Omran list → 400 with its id; unpriced product → 400; a good basket → 201 with `code` `BO-000001`, `total` `"619.50"` for Dash Cam ×1 + Floor Mats ×1, `paymentStatus PENDING`, `expiresAt` ≈ now + 30 min; same `Idempotency-Key` → `replayed: true` and the same id; another customer's cookie → 404 on GET; cancel → `CANCELLED`; cancel again → 409; the cashier of BO sees it in `GET /api/orders` with `source: 'WEB'` (that field lands in Task 8; the assertion is written against it, so run Task 8 before expecting this one line to pass, or accept it red until then).
- [ ] **Step 6: Commit** — `git commit -m "feat(shop): web orders created from the basket with server prices"`

---

### Task 6: Payments: pay, settle, webhook, reconcile

**Files:**
- Create: `api/src/shop/payments/payments.service.ts`
- Create: `api/src/shop/payments/payments.controller.ts`
- Modify: `api/src/shop/payments/payments.module.ts` (controller, service, exports `PaymentsService`)
- Test: `api/src/shop/payments/payments.service.spec.ts`, `api/test/shop-checkout.e2e-spec.ts` (the *payment* describe blocks), `api/test/rbac-matrix.e2e-spec.ts`

**Interfaces:**
- Consumes: `PaymentGateway` (Task 3), `chargeOutcome`, `sameAmount`, `verifyTapSignature` (Task 2), `WebOrderView`/`webOrderView`/`WEB_ORDER_SELECT` and `ensureSystemWebUser` (Task 5), `OdooOrdersService.enqueue(tx, orderId)` (Task 10 — until then call a local no-op `enqueue` and leave a `TODO(task10)`; Task 10 replaces it).
- Produces (`payments.service.ts`):
  - `type SettleOutcome = 'paid' | 'already_paid' | 'failed' | 'pending' | 'amount_mismatch' | 'unknown_charge'`
  - `class PaymentsService { pay(customer, orderId: string, dto: PayDto): Promise<{ redirectUrl: string | null; order: WebOrderView }>; reconcile(customer, orderId): Promise<WebOrderView>; handleWebhook(body: unknown, hashHeader: string | string[] | undefined): Promise<{ received: true }>; settle(charge: TapCharge, via: 'webhook' | 'reconcile' | 'create'): Promise<{ outcome: SettleOutcome; orderId: string | null }>; refundForCancel(orderId: string, reason: string): Promise<{ refundId: string }> }`
  - `pay`: order must be the customer's, `status PENDING`, `paymentStatus PENDING`, `expiresAt > now` (else 409 `ORDER_NOT_PAYABLE`), no `CAPTURED` payment (else 409 `ALREADY_PAID`); create `Payment { status INITIATED, amount: order.total, currency }`; build `CreateChargeInput` with `redirectUrl = ${WEB_PUBLIC_URL}/${locale}/checkout/return?order=${id}`, `postUrl = ${API_PUBLIC_URL}/api/shop/payments/tap/webhook`, `description = 'Wolf Car order ' + code`; on `PaymentGatewayError` mark the payment `FAILED` with `failureCode = err.code` and throw 402 `PAYMENT_FAILED` `{ reason: err.code }`; on success store `chargeId`, `rawLast`; if `chargeOutcome(status) === 'captured'` call `settle(charge, 'create')`; return `{ redirectUrl: charge.transaction?.url ?? null, order }`.
  - `settle`: in one `$transaction`: `payment = findUnique({ chargeId })` → none: `unknown_charge`; lock the order row `FOR UPDATE`; outcome `pending` → store `rawLast`, return; `failed` → payment `FAILED` + `failureCode = charge.response?.code ?? status`; `captured` → if payment already `CAPTURED` and order `paymentStatus PAID` → `already_paid`; if `!sameAmount(charge.amount, order.total) || charge.currency !== order.currency` → payment `CAPTURED`, `failureCode 'AMOUNT_MISMATCH'`, order untouched, `amount_mismatch`; else payment `CAPTURED`, order `{ paymentStatus: 'PAID', paidAt: now, status: 'CONFIRMED', confirmedAt: now, confirmedById: ensureSystemWebUser(tx) }` (also when the order was `CANCELLED` by expiry: then `metadata.afterExpiry = true`), `enqueue(tx, orderId)`, `paid`. Audit after the transaction: `trail.setEntity('Order', orderId).setBranch(branchId).addMetadata({ via, chargeId, outcome })`; `amount_mismatch` and `unknown_charge` throw after recording so the entry is a `FAILURE` (`BadRequestException` codes `AMOUNT_MISMATCH` / `UNKNOWN_CHARGE`).
  - `handleWebhook`: body must be an object with string `id`; `verifyTapSignature(body, hashHeader, TAP_SECRET_KEY)` false → 401 `BAD_SIGNATURE` (when `PAYMENTS_PROVIDER = 'fake'` the secret used is `TAP_SECRET_KEY ?? 'fake-secret'`, so tests can sign); then `settle(body, 'webhook')`; always answer `{ received: true }` with 200 for known charges whatever the outcome.
  - `reconcile`: the customer's order, newest payment with a `chargeId` → none: return the view; `gateway.getCharge(chargeId)` → `settle(charge, 'reconcile')` → return the fresh view. Gateway errors are logged and the current view returned (the page keeps polling).
  - `refundForCancel`: newest `CAPTURED` payment of the order → `gateway.refund({ chargeId, amount: payment.amount, currency, reason })`; on success set `refundId`, `refundedAt`; on `PaymentGatewayError` throw 502 `REFUND_FAILED` `{ reason: err.code }`.
- Produces (routes):
  - `POST /api/shop/orders/:id/pay` (guard) `@Audit('shop.order.pay', { entity: 'Order', idParam: 'id' })`
  - `POST /api/shop/orders/:id/reconcile` (guard) `@Audit('shop.order.reconcile', { entity: 'Order', idParam: 'id' })`
  - `POST /api/shop/payments/tap/webhook` — `@Public()`, **no** customer guard, `@Audit('shop.payment.webhook', { entity: 'Payment' })`, `@HttpCode(200)`; reads `req.headers.hashstring`. Also `@SkipThrottle()` is **not** used: the default per-IP budget is fine.

- [ ] **Step 1: Run the spec, see it fail** — `npm test -- payments.service`.
- [ ] **Step 2: Implement** service, controller, module wiring (`PaymentsModule` imports nothing from `ShopModule`; `ShopModule` imports `PaymentsModule`; the controller needs `CustomerGuard`, so move `CustomersService`+`CustomerGuard` into a small `CustomersModule` exported to both if the circular import bites).
- [ ] **Step 3: Spec passes** — the decision table: captured→paid; captured twice→already_paid; declined→failed and order still PENDING; initiated→pending; wrong amount→amount_mismatch and order PENDING; unknown id→unknown_charge; captured after CANCELLED→paid with `afterExpiry`.
- [ ] **Step 4: Matrix**: `'POST /api/shop/orders/:id/pay': { public: 401 }`, `'POST /api/shop/orders/:id/reconcile': { public: 401 }`, `'POST /api/shop/payments/tap/webhook': { public: 401 }` (empty body has no signature).
- [ ] **Step 5: Flip the `describe.skip` blocks in `api/test/shop-checkout.e2e-spec.ts` to `describe` and run** `npm run test:e2e -- shop-checkout rbac-matrix audit-coverage`. The blocks: pay with `tok_fake_ok` → 200 with `redirectUrl` equal to the return page; signed webhook (`signTapCharge(charge, 'fake-secret')`) with `CAPTURED` → order `CONFIRMED`/`PAID`, `paidAt` set; the same webhook again → still one `odoo_outbox` row and the order unchanged; a webhook with a wrong `hashstring` → 401 and the order still `PENDING`; a webhook whose `amount` is `100` → 200, payment `failureCode AMOUNT_MISMATCH`, order `PENDING`; `tok_fake_declined` then `reconcile` → `lastPayment.status FAILED`, order `PENDING`, paying again with `tok_fake_ok` works; `tok_fake_pending` + `reconcile` → still `PENDING`; pay a paid order → 409 `ALREADY_PAID`; pay an expired order (set `expiresAt` in the past with Prisma) → 409 `ORDER_NOT_PAYABLE`; the activity log holds `shop.order.pay` SUCCESS and `shop.payment.webhook` entries with `actorUsername` = the phone (pay) and null (webhook).
- [ ] **Step 6: Commit** — `git commit -m "feat(payments): card payment through Tap with signed webhook and reconcile"`

---

### Task 7: Unpaid orders expire

**Files:**
- Create: `api/src/shop/checkout/checkout-expiry.service.ts`
- Modify: `api/src/shop/shop.module.ts`
- Test: `api/src/shop/checkout/checkout-expiry.service.spec.ts`, `api/test/shop-checkout.e2e-spec.ts` (`describe('expiry')`)

**Interfaces:**
- Produces: `class CheckoutExpiryService implements OnModuleInit, OnModuleDestroy { sweep(now?: Date): Promise<number> }` — timer every 60 s (`unref`, off when `NODE_ENV === 'test'`); `sweep` selects `{ source: 'WEB', status: 'PENDING', paymentStatus: 'PENDING', expiresAt: { lte: now }, payments: { none: { OR: [{ status: 'CAPTURED' }, { status: 'INITIATED', createdAt: { gt: now − 15 min } }] } } }` (an attempt in flight keeps the order alive), updates each to `CANCELLED` with `cancelledAt = now`, `cancelledById = ensureSystemWebUser`, and writes one `ActivityService.record({ action: 'shop.order.expire', outcome: 'SUCCESS', entityType: 'Order', entityId, branchId, actorId: null, actorUsername: 'system.web', … })` per order. Returns the count.

- [ ] **Step 1: Spec fails** — `npm test -- checkout-expiry`.
- [ ] **Step 2: Implement.** Pattern: `OdooSyncService.onModuleInit`.
- [ ] **Step 3: Spec passes.** e2e: `describe('expiry')` creates an order, back-dates `expiresAt`, calls `app.get(CheckoutExpiryService).sweep()`, expects `CANCELLED` and an activity entry; an expired order with a fresh `INITIATED` attempt is left alone; then a `CAPTURED` webhook on the cancelled one still settles it with `afterExpiry: true`.
- [ ] **Step 4: Commit** — `git commit -m "feat(shop): unpaid web orders expire after 30 minutes"`

---

### Task 8: The staff side of web orders

**Files:**
- Modify: `api/src/orders/order.view.ts`, `api/src/orders/orders.service.ts`, `api/src/orders/orders.controller.ts`, `api/src/orders/dto/orders.dto.ts`, `api/src/orders/orders.module.ts`
- Test: `api/src/orders/orders.service.spec.ts` (extend), `api/test/orders.e2e-spec.ts` (extend), `api/test/rbac-matrix.e2e-spec.ts`

**Interfaces:**
- Consumes: `PaymentsService.refundForCancel` (Task 6); `OdooOrdersService.retry` and `statusFor` (Task 10; until then the `odoo` field is `null` and the retry route is added in Task 10).
- Produces (`order.view.ts`): `OrderSummary` gains `source: OrderSource`, `paymentStatus: PaymentStatus`, `paidAt: string | null`, `collectedAt: string | null`, `customerPhone: string | null`; `OrderDetail` gains `customerEmail: string | null`, `collectedBy: PersonRef | null`, `payment: { chargeId: string | null; status: PaymentAttemptStatus; failureCode: string | null; refundId: string | null } | null` (newest payment), `odoo: { status: OutboxStatus; saleOrderId: number | null; attempts: number; lastError: string | null; nextAttemptAt: string | null } | null`.
- Produces (`ListOrdersQueryDto.source?: 'SHOWROOM' | 'WEB'`), filter `and.push({ source })`.
- Produces (`OrdersService.cancel`): when the order has a `CAPTURED` payment with `refundId = null`: `refundForCancel(id, 'Cancelled by ' + user.username)` first, then the existing `transition` with extra data `{ paymentStatus: 'REFUNDED' }`; audit metadata `{ refundId }`. Who may cancel is unchanged (cashier while `PENDING`, Super Admin also `CONFIRMED`).
- Produces (`OrdersService.update`): any web order refuses edits: 409 `WEB_ORDER_READONLY` (checked before the status check).
- Produces (`OrdersService.confirm`): a web order answers 409 `WEB_ORDER_UNPAID`.
- Produces (`OrdersService.collect(user, id): Promise<OrderDetail>`): one conditional update `{ id, ...orderWriteScope(user), source: 'WEB', paymentStatus: 'PAID', status: 'CONFIRMED', collectedAt: null }` → `{ collectedAt: now, collectedById: user.id }`; `count === 0` → 404 when the order is out of scope, else 409 `ORDER_NOT_COLLECTABLE`. Route `POST /api/orders/:id/collect` `@RequirePermissions('order.confirm') @Audit('order.collect', { entity: 'Order', idParam: 'id' }) @HttpCode(200)`; matrix `['admin', 'cashier']` (same callers as `confirm`).

- [ ] **Step 1: Specs fail** — `npm test -- orders.service` (new cases: cancel of an order with a captured attempt refunds first; refund failure leaves the order; update of a web order is 409; confirm of a web order is 409; collect of a paid web order sets `collectedAt`; collect of a showroom order is 409).
- [ ] **Step 2: Implement.** `OrdersModule` imports `PaymentsModule`.
- [ ] **Step 3: Specs pass; e2e** `npm run test:e2e -- orders shop-checkout rbac-matrix audit-coverage` — the extended `orders.e2e-spec.ts` cases: `?source=WEB` lists only web orders; the BO cashier sees `source`, `paymentStatus`, `customerPhone`; the GH cashier gets 404 on it; the Super Admin cancels a paid web order → `REFUNDED`, fake gateway charge `REFUNDED`; the BO cashier cancels an `AMOUNT_MISMATCH` order → `CANCELLED` + `REFUNDED`; a cashier editing or confirming the unpaid web order → 409; the cashier collects the paid one → `collectedAt` set; collecting it again → 409.
- [ ] **Step 4: Commit** — `git commit -m "feat(orders): web orders in the dashboard, refund on cancel"`

---

### Task 9: Odoo: write methods and the sale-order mapping (pure)

**Files:**
- Modify: `api/src/odoo/odoo-client.ts` (`create`, `call`), `api/src/odoo/odoo-client.spec.ts` (extend)
- Create: `api/src/odoo/odoo-writer.ts`
- Create: `api/src/odoo/odoo-sale-order.ts`
- Test: `api/src/odoo/odoo-sale-order.spec.ts`

**Interfaces:**
- Produces (`odoo-client.ts`): `create(model: string, values: Record<string, unknown>): Promise<number>` (`execute_kw … 'create' [[values]]`, returns the new id); `call<T>(model: string, method: string, ids: number[], kwargs: Record<string, unknown> = {}): Promise<T>` (`execute_kw … method [ids] kwargs`).
- Produces (`odoo-writer.ts`): `interface OdooWriter extends Pick<OdooReader, 'searchRead'> { create(model, values): Promise<number>; call<T>(model, method, ids, kwargs?): Promise<T> }`.
- Produces (`odoo-sale-order.ts`):
  - `interface OutboxOrder { id: string; code: string; customerName: string; customerPhone: string; customerEmail: string | null; total: string; currency: string; chargeId: string | null; paidAt: Date | null; items: { productName: string; quantity: number; unitPrice: string; odooId: number | null }[] }`
  - `partnerDomain(phone: string): unknown[]` → `['|', '|', ['phone', '=', phone], ['mobile', '=', phone], ['phone', '=', localQatarNumber(phone)]]` plus `['mobile', '=', local]` (four leaves, three `'|'`).
  - `partnerValues(o: OutboxOrder): Record<string, unknown>` → `{ name, phone, mobile: phone, email: email ?? false, customer_rank: 1, comment: 'Created by wolfcar.qa' }`.
  - `class OdooMappingError extends Error { constructor(readonly code: 'PRODUCT_NOT_IN_ODOO', readonly productNames: string[]) }`
  - `saleOrderValues(o: OutboxOrder, partnerId: number, opts: { warehouseId?: number; fallbackProductId?: number } = {}): Record<string, unknown>` → `{ partner_id, client_order_ref: code, origin: 'wolfcar.qa', note: 'Paid online · Tap charge <chargeId> · QAR <total>', ...(warehouseId && { warehouse_id }), order_line: [[0, 0, { product_id, name: productName, product_uom_qty: quantity, price_unit: Number(unitPrice) }], …] }`; a line without `odooId` uses `fallbackProductId`, and when there is none the function throws `OdooMappingError` listing every such name.
  - `nextAttemptAt(attempts: number, now: Date): Date | null` — minutes after `now` for the attempt just failed: `[1, 5, 15, 60]` by index, `60` beyond, `null` when `attempts >= 24`.
  - `OUTBOX_MAX_ATTEMPTS = 24`.

- [ ] **Step 1: Specs fail** — `npm test -- odoo-client odoo-sale-order`.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Specs pass.**
- [ ] **Step 4: Commit** — `git commit -m "feat(odoo): create partners and sale orders (mapping)"`

---

### Task 10: Odoo outbox worker and retry

**Files:**
- Create: `api/src/odoo/odoo-orders.service.ts`
- Modify: `api/src/odoo/odoo.module.ts` (provide + export), `api/src/shop/payments/payments.service.ts` (real `enqueue`), `api/src/orders/orders.service.ts` + `orders.controller.ts` (`odoo` in the detail, retry route), `api/src/orders/order.view.ts`
- Test: `api/src/odoo/odoo-orders.service.spec.ts`, `api/test/odoo-outbox.e2e-spec.ts`, `api/test/rbac-matrix.e2e-spec.ts`

**Interfaces:**
- Consumes: `OdooWriter`, `partnerDomain`, `partnerValues`, `saleOrderValues`, `nextAttemptAt`, `OdooMappingError` (Task 9).
- Produces: `class OdooOrdersService implements OnModuleInit, OnModuleDestroy { enqueue(tx: Prisma.TransactionClient, orderId: string): Promise<void>` (upsert `odoo_outbox` by `orderId`, status `PENDING`, `nextAttemptAt = now`); `processDue(now?: Date): Promise<number>` (rows `PENDING` with `nextAttemptAt <= now`, oldest first, up to 20, one at a time, never two ticks at once); `processOne(outboxId: string): Promise<void>`; `retry(orderId: string): Promise<void>` (set `PENDING`, `nextAttemptAt = now`, `lastError = null`; 404 when no row); `statusFor(orderId): Promise<OrderDetail['odoo']>`; `protected writer(): OdooWriter | null` (from `ODOO_URL`, `ODOO_DB`, `ODOO_WRITE_LOGIN`, `ODOO_WRITE_API_KEY`; `null` when any is missing) }`. `processOne`: no writer → `lastError = 'ODOO_WRITE_NOT_CONFIGURED'`, `nextAttemptAt = now + 60 min`, attempts unchanged; otherwise load the order (`OutboxOrder` shape, `odooId` through `product`), `searchRead('res.partner', partnerDomain(phone), ['id'], …)` → first id or `create('res.partner', partnerValues)`; `create('sale.order', saleOrderValues(...))`; `call('sale.order', 'action_confirm', [id])`; store `odooPartnerId`, `odooSaleOrderId`, `DONE`. On any error: `attempts + 1`, `lastError = message.slice(0, 600)` with the API key stripped, `nextAttemptAt = nextAttemptAt(attempts)` or `FAILED` when `null`. An `OdooMappingError` sets `lastError = 'PRODUCT_NOT_IN_ODOO: <names>'` and goes straight to `FAILED` (retrying cannot fix it).
- Produces (route): `POST /api/orders/:id/odoo/retry` `@RequirePermissions('order.odoo.retry') @Audit('order.odoo_retry', { entity: 'Order', idParam: 'id' }) @HttpCode(200)` → the order detail. Matrix: `['admin', 'finance']`.
- Timer: every 60 s, `unref`, off in tests.

- [ ] **Step 1: Spec fails** — `npm test -- odoo-orders.service`.
- [ ] **Step 2: Implement**; replace the Task 6 placeholder `enqueue` with the real one (inject `OdooOrdersService` into `PaymentsService`; `PaymentsModule` imports `OdooModule`).
- [ ] **Step 3: Spec passes.** e2e `npm run test:e2e -- odoo-outbox rbac-matrix audit-coverage`: the test overrides the writer with `jest.spyOn(service as never, 'writer')` returning a fake `OdooWriter` that records calls; a paid order (fake gateway, signed webhook) → `processDue()` → `res.partner` searched then created, `sale.order` created with `client_order_ref = code` and two lines, `action_confirm` called, row `DONE`, `GET /api/orders/:id` shows `odoo.status DONE` and `saleOrderId`; a writer throwing `Error('boom')` → `attempts 1`, `nextAttemptAt` ≈ now + 1 min, `lastError 'boom'`; a product without `odooId` and no fallback → `FAILED` with `PRODUCT_NOT_IN_ODOO`; Finance `POST …/odoo/retry` → `PENDING`; the cashier → 403.
- [ ] **Step 4: Commit** — `git commit -m "feat(odoo): paid web orders become confirmed sale orders through an outbox"`

---

### Task 11: Website: shop API client, types and the checkout state machine

**Files:**
- Modify: `lib/api/types.ts`
- Create: `features/shop/shop-api.ts`, `features/shop/checkout-state.ts`, `features/shop/use-customer.ts`
- Modify: `lib/track.ts` only if a typed helper is needed (events are typed from `shared/analytics.ts`)
- Test: `features/shop/checkout-state.test.ts`, `features/shop/shop-api.test.ts`

**Interfaces:**
- Produces (`lib/api/types.ts`): `CustomerProfile { phone: string; name: string | null; email: string | null }`; `WebOrder` = the API's `WebOrderView` with `createdAt/expiresAt/paidAt` as strings; `OrderSummary` gains `source: OrderSourceName`, `paymentStatus: PaymentStatusName`, `paidAt: string | null`, `customerPhone: string | null`; `OrderDetail` gains `customerEmail`, `payment`, `odoo` (shapes from Task 8).
- Produces (`shop-api.ts`): `hasCustomerHint(): boolean`; `shopApi<T>(path: string, options?: { method?: 'GET' | 'POST'; json?: unknown; headers?: Record<string, string> }): Promise<T>` (prefix `/api/shop`, CSRF header, `credentials: 'same-origin'`, throws `ApiError` via `toApiError`); `const shop = { sendOtp(phone): Promise<{ expiresAt: string; devCode?: string }>, verifyOtp(phone, code): Promise<{ customer: CustomerProfile; expiresAt: string }>, me(): Promise<CustomerProfile>, logout(): Promise<void>, createOrder(body: { items: { productId: string; quantity: number }[]; name: string; email: string }, idempotencyKey: string): Promise<WebOrder & { replayed: boolean }>, getOrder(id): Promise<WebOrder>, pay(id, tokenId, locale): Promise<{ redirectUrl: string | null; order: WebOrder }>, reconcile(id): Promise<WebOrder>, cancel(id): Promise<WebOrder> }`.
- Produces (`checkout-state.ts`, pure): `type Step = 'phone' | 'code' | 'details' | 'pay'`; `interface CheckoutState { step: Step; phone: string; customer: CustomerProfile | null; order: WebOrder | null; busy: boolean; error: string | null; resendAt: number | null }`; `initialState: CheckoutState`; `type CheckoutEvent = { type: 'SESSION_FOUND'; customer: CustomerProfile } | { type: 'NO_SESSION' } | { type: 'OTP_SENT'; phone: string; now: number } | { type: 'VERIFIED'; customer: CustomerProfile } | { type: 'CHANGE_PHONE' } | { type: 'ORDER_CREATED'; order: WebOrder } | { type: 'BACK_TO_DETAILS' } | { type: 'BUSY'; busy: boolean } | { type: 'ERROR'; code: string | null }`; `reduce(state: CheckoutState, event: CheckoutEvent): CheckoutState`. Rules: `SESSION_FOUND` → `details` with the customer; `NO_SESSION` → `phone`; `OTP_SENT` → `code`, `resendAt = now + OTP_RESEND_SECONDS * 1000`; `VERIFIED` → `details`; `CHANGE_PHONE` → `phone`, `customer null`; `ORDER_CREATED` → `pay`; `BACK_TO_DETAILS` → `details`, `order null`; every event clears `error` except `ERROR`; `BUSY` toggles `busy`.
- Produces (`use-customer.ts`): `useCustomer(): { customer: CustomerProfile | null; status: 'loading' | 'signed-in' | 'anonymous'; refresh(): Promise<void>; signOut(): Promise<void> }` — calls `shop.me()` only when `hasCustomerHint()`.

- [ ] **Step 1: Tests fail** — `npx vitest run features/shop/checkout-state.test.ts features/shop/shop-api.test.ts`.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Tests pass**; `npm run typecheck`.
- [ ] **Step 4: Commit** — `git commit -m "feat(web): shop API client and checkout state"`

---

### Task 12: Website: phone and code steps

**Files:**
- Create: `features/shop/phone-step.tsx`, `features/shop/otp-step.tsx`
- Modify: `messages/ar.json`, `messages/en.json` (namespace `Checkout`)
- Test: `features/shop/otp-step.test.tsx`, `features/shop/phone-step.test.tsx`

**Interfaces:**
- Produces: `PhoneStep({ onSent }: { onSent: (phone: string, devCode?: string) => void })` — one input (`inputMode="tel"`, `dir="ltr"`, `autoComplete="tel"`), live normalisation through `normaliseQatarPhone`, submit disabled until valid, calls `shop.sendOtp`, shows `ApiError` codes through `useErrorMessage` (`lib/api/use-error-message.ts`).
  `OtpStep({ phone, resendAt, onVerified, onChangePhone, onResent }: { phone: string; resendAt: number | null; onVerified: (c: CustomerProfile) => void; onChangePhone: () => void; onResent: (resendAt: number) => void })` — `input-otp` with `OTP_LENGTH`, auto-submit when full, "Resend" disabled until `resendAt` with a live countdown, "Change number" link; a `devCode` shown in a muted line when provided (development only; the page passes it only when `process.env.NODE_ENV !== 'production'`).
- Message keys (`Checkout`): `title`, `stepPhone`, `stepCode`, `stepDetails`, `stepPay`, `phoneLabel`, `phoneHint`, `phoneInvalid`, `sendCode`, `codeSentTo`, `codeLabel`, `resend`, `resendIn`, `changeNumber`, `devCode`, `nameLabel`, `emailLabel`, `emailHint`, `continueToPay`, `pickupAt`, `summary`, `total`, `pay`, `paying`, `payNote`, `unavailableRemoved`, `expired`, `paid`, `notPaid`, `tryAgain`, `orderCode`, `showAtBranch`, `backToCatalog`, `checking`, `signedInAs`, `signOut`, `empty`, `errors.OTP_INVALID`, `errors.OTP_TOO_MANY`, `errors.PAYMENT_FAILED`, `errors.ORDER_NOT_PAYABLE`, `errors.CHECKOUT_UNAVAILABLE`, `errors.ALREADY_PAID`.

- [ ] **Step 1: Tests fail.** - [ ] **Step 2: Implement with the messages.** - [ ] **Step 3: Tests pass.**
- [ ] **Step 4: Commit** — `git commit -m "feat(web): sign in at checkout with a phone code"`

---

### Task 13: Website: details step and the Tap card

**Files:**
- Create: `features/shop/details-step.tsx`, `features/shop/tap-sdk.ts`, `features/shop/tap-card.tsx`, `features/shop/pay-step.tsx`, `features/shop/order-lines.tsx`
- Test: `features/shop/tap-card.test.tsx`, `features/shop/details-step.test.tsx`, `features/shop/pay-step.test.tsx`

**Interfaces:**
- Produces (`tap-sdk.ts`): `TAP_SDK_URL = 'https://tap-sdks.b-cdn.net/card/1.0.2/index.js'`; `interface TapToken { id: string; card?: { last_four?: string; brand?: string } }`; `interface CardSdk { renderTapCard(containerId: string, config: Record<string, unknown>): { unmount(): void }; tokenize(): void; Currencies?: Record<string, string> }`; `declare global { interface Window { CardSDK?: CardSdk } }`; `loadTapSdk(): Promise<CardSdk>` — resolves at once when `window.CardSDK` exists (tests and Playwright inject a stub), otherwise appends the script once and resolves on `load`, rejects on `error` with `Error('TAP_SDK_LOAD')`.
- Produces (`tap-card.tsx`): `interface TapCardHandle { tokenize(): Promise<TapToken> }`; `TapCard = forwardRef<TapCardHandle, { publicKey: string; amount: string; locale: 'ar' | 'en'; onReady?: () => void; onError?: (message: string) => void }>` — renders `<div id="tap-card-sdk" />`, on mount `loadTapSdk().then(sdk => sdk.renderTapCard('tap-card-sdk', { publicKey, transaction: { amount: Number(amount), currency: 'QAR' }, acceptance: { supportedBrands: ['VISA', 'MASTERCARD'], supportedCards: 'ALL' }, fields: { cardHolder: true }, addons: { loader: true, saveCard: false, displayPaymentBrands: true }, interface: { locale, theme: 'light', edges: 'curved', direction: locale === 'ar' ? 'rtl' : 'ltr' }, onReady, onError, onSuccess }))`; `tokenize()` returns a promise resolved by the next `onSuccess` and rejected by the next `onError` (one in flight at a time); unmounts on cleanup.
- Produces (`details-step.tsx`): `DetailsStep({ customer, onCreated }: { customer: CustomerProfile; onCreated: (order: WebOrder) => void })` — react-hook-form + zod (`name` per `CUSTOMER_NAME_*`, `email` per `EMAIL_PATTERN`), prefilled from the customer, basket summary (`OrderLines`), on submit `shop.createOrder({ items: cart lines, name, email }, newIdempotencyKey())` (reuse `features/showroom/idempotency.ts`); on `PRODUCT_UNAVAILABLE` remove the ids from the cart and show `unavailableRemoved`; sends `track('checkout_start')`.
- Produces (`pay-step.tsx`): `PayStep({ order, publicKey, locale, onBack }: { order: WebOrder; publicKey: string; locale; onBack: () => void })` — shows total and pickup branch, `TapCard`, a **Pay** button that tokenizes then `shop.pay(order.id, token.id, locale)` and `window.location.assign(redirectUrl)` (or routes to `/checkout/return?order=` when `redirectUrl` is null); `PAYMENT_FAILED` shows `errors.PAYMENT_FAILED` and keeps the step; `ORDER_NOT_PAYABLE` shows `expired` with a button that calls `onBack`.
- Produces (`order-lines.tsx`): `OrderLines({ items, total, currency }: Pick<WebOrder, 'items' | 'total' | 'currency'>)` read-only list using `formatMoney`.

- [ ] **Step 1: Tests fail.** - [ ] **Step 2: Implement.** - [ ] **Step 3: Tests pass.**
- [ ] **Step 4: Commit** — `git commit -m "feat(web): order details and the Tap card step"`

---

### Task 14: Website: checkout and return pages, cart button

**Files:**
- Create: `features/shop/checkout.tsx`, `features/shop/return-status.tsx`
- Create: `app/[locale]/checkout/page.tsx`, `app/[locale]/checkout/return/page.tsx`
- Modify: `features/catalog/cart-sheet.tsx`, `messages/{ar,en}.json` (`Cart.payByCard`, `Cart.orWhatsapp`)
- Modify: `next.config.ts` (nothing unless the SDK is blocked; note the result)
- Test: `features/shop/checkout.test.tsx`, `features/shop/return-status.test.tsx`, `features/catalog/cart-sheet.test.tsx`

**Interfaces:**
- Produces (`checkout.tsx`): `Checkout({ publicKey }: { publicKey: string })` — `useReducer(reduce, initialState)`; on mount `useCustomer()` → `SESSION_FOUND` / `NO_SESSION`; an empty basket shows `empty` with a link to `/products`; renders the step components from Tasks 12–13; a signed-in line with `signOut`.
- Produces (`return-status.tsx`): `ReturnStatus({ orderId }: { orderId: string })` — calls `shop.reconcile` once, then polls `shop.getOrder` every `CHECKOUT_POLL_MS` up to `CHECKOUT_POLL_MAX_MS` while `paymentStatus === 'PENDING'` and `lastPayment?.status !== 'FAILED'`; states: *checking*, *paid* (clears the cart, `track('order_paid')`, shows `orderCode` large, `showAtBranch`, the pickup branch card from `lib/branches.ts` `binomran` with phone and map link), *not paid* (`notPaid` + `tryAgain` → `/checkout`), *expired*. No email is sent in phase 1, so no copy claims one. A 401 from the API (cookie gone) sends to `/checkout`.
- Pages: `checkout/page.tsx` — `generateMetadata` (`Checkout.title`), `setRequestLocale`, `<SubpageHeader />`, `<Checkout publicKey={process.env.NEXT_PUBLIC_TAP_PUBLIC_KEY ?? ''} />`, `<Footer />`; `checkout/return/page.tsx` reads `searchParams.order` (a UUID, else `notFound()`), renders `<ReturnStatus orderId />`. Both pages get `robots: { index: false }`.
- Cart: a primary button **Pay by card** (`Link href="/checkout"`, `data-track="checkout_start"`) above the WhatsApp button, which becomes secondary with `orWhatsapp` as a small label.

- [ ] **Step 1: Tests fail.** - [ ] **Step 2: Implement.** - [ ] **Step 3: Tests pass**; `npm run build` once to be sure the pages compile.
- [ ] **Step 4: Commit** — `git commit -m "feat(web): checkout and return pages, pay by card from the basket"`

---

### Task 15: Dashboard: web orders, payment and Odoo status

**Files:**
- Modify: `components/app/badges.tsx` (`PaymentBadge`), `features/orders/queries.ts` (`source` in the URL state and query, `retryOdoo`), `features/orders/orders-page.tsx`, `features/orders/order-detail-sheet.tsx`, `messages/app/{ar,en}/orders.json`
- Test: `features/orders/orders-page.test.tsx` (extend), `features/orders/order-detail-sheet.test.tsx` (new)

**Interfaces:**
- Produces: `PaymentBadge({ status, collected }: { status: PaymentStatusName; collected?: boolean })` (`PAID` success, or *Collected* neutral when `collected`; `PENDING` warning *Awaiting payment*; `REFUNDED` neutral; `NONE` renders nothing); `OrdersUrlState.source: OrderSourceName | ''`; a `Segmented` *All / Showroom / Web* filter; the table shows a `Web` pill and the payment badge next to the status; the detail sheet shows phone (as a `tel:` link) and email for web orders, the payment line (`chargeId` last 8 chars, `failureCode` when set, refund id when refunded), a *Collected* button (`order.confirm`, paid web orders without `collectedAt`, calls `collectOrder(id)`), and the Odoo line (`DONE` + sale order id, `PENDING` with next attempt, `FAILED` with `lastError`) with a *Retry* button visible when the user has `order.odoo.retry` (`useAuth().user.permissions`), calling `retryOdoo(id)` and invalidating `orderKeys.detail(id)`. Edit and Confirm buttons are hidden for web orders.
- Message keys (`Orders`): `sourceAll`, `sourceShowroom`, `sourceWeb`, `web`, `payment`, `paymentPaid`, `paymentPending`, `paymentRefunded`, `collected`, `markCollected`, `collectedBy`, `amountMismatch`, `customerPhone`, `customerEmail`, `odoo`, `odooDone`, `odooPending`, `odooFailed`, `odooNotConfigured`, `odooRetry`, `odooRetried`.

- [ ] **Step 1: Tests fail.** - [ ] **Step 2: Implement.** - [ ] **Step 3: Tests pass.**
- [ ] **Step 4: Commit** — `git commit -m "feat(dashboard): web orders show payment and Odoo status"`

---

### Task 16: Browser test of the whole story

**Files:**
- Create: `e2e/checkout.spec.ts`, `e2e/fixtures/tap-sdk-stub.js`
- Modify: `e2e/env.ts` (`apiEnv` adds `PAYMENTS_PROVIDER: 'fake'`, `SMS_PROVIDER: 'console'`, `OTP_DEV_CODE_IN_RESPONSE: 'true'`, `WEB_PUBLIC_URL: WEB_URL`, `API_PUBLIC_URL: API_URL`, `TAP_SECRET_KEY: 'fake-secret'`), `e2e/prepare-db.ts` only if the seed needs a BO product on the list (check `SEED_DEMO_CATALOG`)
- Test: `e2e/checkout.spec.ts`

- [ ] **Step 1: Read `e2e/checkout.spec.ts`** (written): it adds the SDK stub with `page.addInitScript({ path })` (the stub defines `window.CardSDK` whose `tokenize()` calls the stored config's `onSuccess({ id: 'tok_fake_ok' })`), opens `/en/products`, adds the first priced product, opens the cart, clicks *Pay by card*, types `55123456`, reads the code from the page's dev line, enters it, fills name and email, continues, sees the server total, clicks *Pay*, lands on `/en/checkout/return?order=…`, sees the order code (`BO-` prefix) within 10 s, then signs in as the BO cashier and finds the order with the *Web* and *Paid* badges.
- [ ] **Step 2: Run** from the root: `npm run e2e:build && npx playwright test e2e/checkout.spec.ts`. Expected: PASS. (The Playwright API runs as `NODE_ENV=production`; `OTP_DEV_CODE_IN_RESPONSE=true` from Task 1 is what makes the code visible on the page.)
- [ ] **Step 3: Commit** — `git commit -m "test(e2e): a customer pays for parts by card and the cashier sees it"`

---

### Task 17: Documentation and operations

**Files:**
- Modify: `README.md` (parts table: *Online checkout*; env tables; a *Payments (Tap)* section with the webhook URL, test cards, how to run with the fake provider), `deploy/api.prod.env.example`, `docs/superpowers/specs/2026-10-18-online-checkout-phase1-design.md` (status line → implemented, open questions kept)

- [ ] **Step 1: Write the README section**: local run with `PAYMENTS_PROVIDER=fake` and `SMS_PROVIDER=console`; with Tap test keys you need a public webhook URL (`ngrok http 3000` → `API_PUBLIC_URL`); Tap dashboard settings: webhook not needed per-charge (we pass `post.url`), domain registration for the live public key; go-live checklist (live keys, `WEB_PUBLIC_URL`, refund policy page, Odoo sales user, `ODOO_WEB_WAREHOUSE_ID`).
- [ ] **Step 2: Commit** — `git commit -m "docs: online checkout setup and go-live checklist"`

---

## Self-review notes (planner)

- Spec coverage: identity (T4), checkout (T5), payment + webhook + reconcile (T6), expiry (T7), staff view + refund (T8), Odoo write (T9–10), website (T11–14), dashboard (T15), browser story (T16), configuration/docs (T1, T17). The spec's "customer logout-all" is in T4; "`GET /api/orders/:id` includes `odoo`" is T8+T10.
- Type names used across tasks: `CustomerPrincipal`, `WebOrderView`/`WebOrder`, `TapCharge`, `PaymentGateway`, `OutboxOrder`, `SettleOutcome`, `CheckoutState` — defined once each and referenced by name afterwards.
- Builder-check rulings folded in: captured-after-cancel settles to paid (T6); amount-mismatch orders are refunded through the staff cancel (T8); staff cannot edit or confirm web orders (T8); `collectedAt` + collect route (T1, T8, T15); no email in phase 1 (T14); in-flight attempts keep an order from expiring (T7); `OTP_DEV_CODE_IN_RESPONSE` (T1, T4, T16). Odoo taxes stay an owner question in the spec.
