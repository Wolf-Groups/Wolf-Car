# Email, guest checkout and pay at the branch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SMS sign-in with email (Brevo), let anyone order without an account, add "pay at the branch", and send order emails.

**Architecture:** A new `EmailModule` (console or Brevo sender behind `EMAIL_SENDER`) is used by the shop's code sign-in and by `OrderEmailsService`. Customers are identified by email. Web orders are reached either by the customer cookie or by a stateless order key (HMAC of the order id). Pay-at-branch orders are web orders with `paymentStatus NONE`.

**Tech Stack:** NestJS 11 + Prisma 7 (api/), Next.js 16 + next-intl + react-hook-form/zod (web), Jest, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-04-email-guest-checkout-design.md`

## Global Constraints

- Brevo endpoint `https://api.brevo.com/v3/smtp/email`, header `api-key`, body `{ sender: { name, email }, to: [{ email }], subject, htmlContent, textContent }`; request timeout 10 s.
- Env: `EMAIL_PROVIDER` (`console` | `brevo`, default `console`), `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME` (default `Wolf Car`), `SHOP_NOTIFY_EMAIL` (comma list, optional), `OTP_PER_EMAIL_PER_15_MIN` (default 3). `SMS_PROVIDER` and `OTP_PER_PHONE_PER_15_MIN` are removed. `brevo` requires `BREVO_API_KEY` and `EMAIL_FROM` (startup error otherwise).
- Order key: `orderKey(id) = base64url(HMAC-SHA256(JWT_ACCESS_SECRET, "order-link:" + id)).slice(0, 32)`; compared with `timingSafeEqual`.
- Payment method values: `'card' | 'branch'` (`shared/shop.ts` `PAYMENT_METHODS`).
- Open pay-at-branch orders per customer: `BRANCH_ORDERS_OPEN_MAX = 3`.
- Locales: `'ar' | 'en'`; stored on the order as `customerLocale` (default `ar`).
- All customer-facing copy exists in both `messages/ar.json` and `messages/en.json`.
- Order emails never throw into the request; the code email does (the customer must know it failed).

## Review Focus

1. A guest typing an email that belongs to an existing account: the order is linked, but the account's saved name/phone stay unchanged (test in Task 4).
2. Signed-in customer whose old cookie belongs to a phone-only customer (no email): treated as signed out (test in Task 3).
3. A card order paid via webhook AND reconcile: exactly one receipt email (test in Task 5, settle outcome `already_paid` sends nothing).
4. Wrong or missing order key: 404, same as a foreign order (test in Task 4).
5. Build without the Tap key: checkout offers only "pay at the branch" and works end to end (tests in Tasks 7 and 11).

---

### Task 1: Database: email identity, codes by email, order language

**Files:**
- Modify: `api/prisma/schema.prisma` (Customer, CustomerOtp, Order)
- Create: `api/prisma/migrations/20261104100000_email_customers/migration.sql`

- [ ] Customer: `phone String? @db.VarChar(20)` (no longer unique), `email String? @unique @db.VarChar(254)`; doc comment says identified by email.
- [ ] CustomerOtp: `email String @db.VarChar(254)` replaces `phone`; index `[email, createdAt]`.
- [ ] Order: `customerLocale String @default("ar") @map("customer_locale") @db.VarChar(2)`.
- [ ] Migration SQL: delete all `customer_otps`; rename column; lower-case existing customer emails; null out duplicates keeping the most recently updated; drop the phone unique index; make phone nullable; add the email unique index; add `orders.customer_locale`.
- [ ] `npx prisma migrate deploy` against `TEST_DATABASE_URL` succeeds; `npm --prefix api run prisma:generate`.

### Task 2: Email module

**Files:**
- Create: `api/src/email/email-sender.ts`, `api/src/email/brevo-email-sender.ts`, `api/src/email/email.module.ts`, `api/src/email/email-html.ts`, specs next to them.
- Modify: `api/src/config/env.ts` (+ `env.spec.ts`), `api/.env.example`, `api/test/setup/test-env.ts`, `deploy/api.prod.env.example`.

**Interfaces (Produces):**
- `interface EmailMessage { to: string[]; subject: string; html: string; text: string }`
- `interface EmailSender { send(message: EmailMessage): Promise<void> }`, token `EMAIL_SENDER`.
- `class ConsoleEmailSender` (logs; `lastTo(address): EmailMessage | undefined`; in production logs only recipients and subject).
- `class BrevoEmailSender` (`constructor({ apiKey, from: { email, name }, fetch? })`; throws `EmailSendError(status, code)` on non-2xx or network error).
- `emailSenderFactory(config): EmailSender`; `EmailModule` (global) exports `EMAIL_SENDER`.
- `email-html.ts`: `escapeHtml(s)`, `emailLayout({ locale, title, body }): string` (RTL wrapper for `ar`), `button(href, label)`.

- [ ] Tests: Brevo sender posts the exact body and `api-key` header; 4xx → `EmailSendError` with Brevo's `code`; console sender remembers the last message per address; env refuses `brevo` without key/from.
- [ ] Implement; run `npm --prefix api test -- email env`.

### Task 3: Sign-in by email code

**Files:**
- Modify: `api/src/shop/customers/otp.service.ts` (+spec), `shop-auth.controller.ts`, `customers.service.ts`, `customer.guard.ts`, `api/src/shop/dto/shop.dto.ts`, `api/src/shop/shop.module.ts`, `api/test/utils/shop.ts`, `api/test/shop-auth.e2e-spec.ts`, `shared/shop.ts`.
- Delete: `api/src/shop/sms/`.
- Create: `api/src/shop/emails/sign-in-code.email.ts` (+spec).

**Interfaces:**
- `SendCodeDto { email; locale: 'ar' | 'en' }`, `VerifyCodeDto { email; code }` (email trimmed + lower-cased, `IsEmail`, max 254).
- `OtpService.issue(email: string, locale: 'ar' | 'en'): Promise<{ expiresAt: Date; devCode?: string }>`; `verify(email, code): Promise<{ customer: CustomerPrincipal; created: boolean }>`.
- `CustomerPrincipal { id; email: string; name: string | null; phone: string | null; sessionVersion }`; `CustomerProfileView { email; name; phone }`.
- `signInCodeEmail(code: string, locale): { subject; html; text }`.

- [ ] Tests (unit): code email holds the code and "Wolf Car" in both languages; `issue` sends to the email; 503 `SIGN_IN_UNAVAILABLE` with console + production + no ALLOW_TEST_CHECKOUT, nothing sent; `loadFromToken` refuses a customer with `email null` (SESSION_EXPIRED).
- [ ] Tests (e2e): sign-in by email sets the cookie; `/me` answers `{ email, name, phone }`; 4th code in 15 minutes → 429 `OTP_TOO_MANY`.
- [ ] Implement. Audit actor username = email.

### Task 4: Guest checkout, pay at the branch, order key

**Files:**
- Create: `api/src/shop/checkout/order-key.ts` (+spec), `api/src/shop/customers/optional-customer.guard.ts`.
- Modify: `checkout.controller.ts`, `checkout.service.ts` (+spec), `web-order.view.ts`, `payments.controller.ts`, `payments.service.ts` (+spec), `api/src/shop/dto/shop.dto.ts`, `shared/shop.ts`, `api/test/utils/shop.ts`, `api/test/shop-checkout.e2e-spec.ts`.

**Interfaces:**
- `orderKey(orderId: string, secret: string): string`; `validOrderKey(orderId, key: string | undefined, secret): boolean`.
- `OrderAccess = { customer: CustomerPrincipal | null; key: string | null }` built by the controllers from `req.customer` (OptionalCustomerGuard: cookie optional, CSRF header on non-GET) and the `x-order-key` header.
- `CreateWebOrderDto` + `phone` (Qatari mobile, normalised), `paymentMethod: 'card' | 'branch'`, `locale: 'ar' | 'en'`. For a signed-in customer the order email is the account email (the body's email is ignored).
- `CheckoutService.createOrder(access: OrderAccess, dto, idempotencyKey)` → `{ order: WebOrderView & { key: string }; replayed }`. Card needs the gateway (503 otherwise); branch does not. Branch → `paymentStatus NONE`, `expiresAt null`.
- `get(access, id)`, `cancelUnpaid(access, id)`, `PaymentsService.pay(access, id, dto)`, `reconcile(access, id)`; `pay` appends `&key=` to Tap's redirect URL. `reconcile` of an order without a charge answers the order even without a gateway.
- `WebOrderView` + `paymentMethod: 'card' | 'branch'` (`NONE` → branch) and `customer.phone: string`.

- [ ] Tests (e2e): guest creates a branch order without a cookie (201, `key` returned, status PENDING, paymentStatus NONE, expiresAt null); `GET /shop/orders/:id` with the key works, with a wrong key 404; guest card order pays with the key and Tap's redirect URL carries `key=`; guest order for an existing customer's email is listed for that customer after sign-in and the customer's name/phone are unchanged; the 4th open branch order → 409 `TOO_MANY_OPEN_ORDERS`; card order without a gateway → 503 while a branch order succeeds (unit).
- [ ] Implement; existing checkout e2e cases still pass after the helper changes.

### Task 5: Order emails

**Files:**
- Create: `api/src/shop/emails/order-emails.ts` (+spec), `api/src/shop/emails/order-emails.service.ts` (+spec).
- Modify: `checkout.service.ts`, `payments.service.ts`, `shop.module.ts`, `payments.module.ts`.

**Interfaces:**
- `orderPlacedEmail(order: WebOrderView, locale, link: string | null)`, `orderPaidEmail(order, locale, link)`, `staffOrderEmail(order, dashboardLink: string | null)` → `{ subject; html; text }`.
- `OrderEmailsService.placed(orderId: string): Promise<void>`, `paid(orderId: string): Promise<void>`; never rejects.

- [ ] Tests: subjects carry the order code; items, total and the customer's next steps appear; Arabic email is `dir="rtl"`; names are HTML-escaped; `paid` after settle `paid` only (webhook + reconcile → one receipt); staff alert goes to every `SHOP_NOTIFY_EMAIL` address and is skipped when unset; a failing sender is logged and swallowed.

### Task 6: Staff handle pay-at-branch orders

**Files:**
- Modify: `api/src/orders/orders.service.ts` (+spec), `api/test/orders.e2e-spec.ts`, `features/orders/order-detail-sheet.tsx` (+test), `features/orders/orders-page.tsx` (pill), `messages/*.json` (Orders).

- [ ] `confirm` allows a WEB order with `paymentStatus NONE` (still 409 `WEB_ORDER_UNPAID` for card orders); `collect` allows CONFIRMED web orders that are PAID or NONE; `update` stays refused for every web order.
- [ ] The sheet shows Confirm and Mark collected for pay-at-branch orders and a "Pay at branch" pill; the collect dialog says to take the payment first.

### Task 7: Web checkout without sign-in

**Files:**
- Modify: `features/shop/shop-api.ts` (+test), `lib/api/types.ts`, `features/shop/checkout-state.ts` (+test), `features/shop/checkout.tsx` (+test), `features/shop/details-step.tsx` (+test), `features/shop/pay-step.tsx` (+test), `app/[locale]/checkout/page.tsx`.
- Delete: `features/shop/phone-step.tsx`, `features/shop/otp-step.tsx` (+tests) after Task 9 moves the code step.

- [ ] Steps `details → pay`; `?order=<id>&key=<key>` kept in the address; the details step has name, mobile, email (read-only when signed in), payment method (card shown only with a public key), and a "Sign in" link for returning customers. A branch order goes straight to `/checkout/return?order=…&key=…`.
- [ ] `shop.*` order calls send `X-Order-Key` when a key is known.

### Task 8: Thank-you page

**Files:**
- Modify: `features/shop/return-status.tsx` (+test), `app/[locale]/checkout/return/page.tsx`, `messages/*.json` (Checkout).

- [ ] Outcome `placed` for `paymentStatus NONE`; paid and placed show "Thank you, {name}!", the code, three next steps, the email line, the branch card, continue shopping and My account.

### Task 9: My account by email

**Files:**
- Create: `features/shop/email-step.tsx`, `features/shop/code-step.tsx` (+tests).
- Modify: `features/account/sign-in.tsx`, `account.tsx`, `order-state.ts` (+test), `order-view.tsx`, `state-badge.tsx`, `messages/*.json` (Account).

- [ ] Sign in with email → code; "Signed in as {email}"; order states `awaitingConfirmation` (branch, PENDING) and `payAtBranch` (branch, CONFIRMED, not collected).

### Task 10: Ungate from the Tap key

**Files:** `features/catalog/cart-sheet.tsx`, `components/AccountLink.tsx`, `components/Header.tsx`, `components/SubpageHeader.tsx`, `features/catalog/your-cars.tsx`, `app/[locale]/products/page.tsx` (+ their tests).

- [ ] The basket shows "Checkout" for any priced line, with WhatsApp kept beside it; the account link and "My cars" show without a Tap key.

### Task 11: Browser test and docs

**Files:** `e2e/checkout.spec.ts`, `README.md` (env table, section 11), `api/.env.example`, `deploy/api.prod.env.example`.

- [ ] Playwright: guest pays by card (fake gateway) and sees the thank-you page; guest orders to pay at the branch; the cashier confirms and collects it.
- [ ] Verification: `npm --prefix api run lint typecheck test`, `npm --prefix api run test:e2e -- shop orders`, `npm run lint typecheck test`.
