# Online checkout, phase 1: buy parts with a card — design

Date: 2026-10-18 · Status: written from the 2026-10-18 conversation; awaiting the owner's read

## Intent

Today a visitor of wolfcar.qa can see prices and fill a basket, but the only
way to buy is to send the basket to the Bin Omran branch on WhatsApp. This
phase lets the visitor **pay by card on the website** and collect the parts at
the branch. It is the first of three phases agreed on 2026-10-18:

1. **This phase.** Customer sign-in by phone, checkout, card payment through
   Tap, pickup at Bin Omran, the paid order lands in Odoo, staff see it in the
   dashboard.
2. Apple Pay and Google Pay, delivery, stock from Odoo.
3. Public PPF booking with a deposit.

Success: a customer with a Qatari phone number picks parts on the website,
types the one-time code sent to the phone, pays with a test card, and sees an
order code. The cashier at Bin Omran sees the same order marked *paid online*
in the dashboard, and the accountant finds a confirmed sale order for it in
Odoo with the Tap reference on it.

## Goals, non-goals, anti-goals

**Goals**

- A public customer can pay for parts without talking to anyone.
- The order total is computed on the server from current prices, never taken
  from the browser.
- An order is marked paid only on proof from Tap (signed webhook, or a charge
  read back from Tap's API), never from the browser's redirect alone.
- Odoo being down, slow or misconfigured never blocks a payment or makes the
  customer wait.
- Everything a customer or Tap does is in the activity log, like staff actions.

**Non-goals (later phases or never)**

- Delivery, addresses, shipping fees. Pickup at Bin Omran only.
- Stock checks. Odoo stock is not read yet; the branch resolves a missing part
  by refund.
- Apple Pay, Google Pay, saved cards, instalments.
- Email sign-in. Phase 1 signs in by phone only; email is collected at
  checkout because Tap requires it on the charge and for the receipt.
- Editing products or prices in Odoo. Odoo stays the master of the catalogue;
  the app only **creates** partners and sale orders there.
- PPF or any service purchase online.
- A customer "my orders" area beyond the confirmation page of one order.

**Anti-goals (a failure even if it works)**

- An order shown as paid that Tap did not capture, or an amount charged that
  differs from the order total.
- Card numbers passing through or being logged by our servers.
- A paid order that silently never reaches Odoo. Failures must be visible in
  the dashboard and retryable.
- The OTP endpoint usable as a free SMS cannon.

## Constraints

- Stack as is: Next.js 16 + next-intl, NestJS 12, Prisma 7, PostgreSQL 17, one
  origin (`/api/*` proxied). Deployment on the droplet behind Caddy
  (`docs/superpowers/specs/2026-09-27-production-deploy-design.md`).
- Currency QAR, two decimals. Prices come from Odoo through the existing sync.
- Tap: Card SDK Web v2 in the browser, Charges API on the server, webhook
  signed with HMAC-SHA256 over Tap's `hashstring` (see *Tap facts* below).
- The API's `audit-coverage`, `rbac-matrix` and route tests must keep passing:
  every new mutating route is audited and listed in the matrix.
- Lint (`oxlint --deny-warnings`), typecheck and the three test suites pass
  before each commit.

## Decisions already made

| Topic | Decision | Whose |
|---|---|---|
| Payment provider | Tap Payments (contact: Ramy at Tap; docs at developers.tap.company) | owner |
| Who may buy | A signed-in customer, not a guest | owner |
| Sign-in | One-time code to the phone number. The sign-in is asked at checkout, not for browsing | owner (phone), Claude (at checkout) |
| Fulfilment | Pickup at the Bin Omran branch; every web order belongs to that branch | Claude's call, from "Bin Omran handles online orders" in the current site |
| Odoo | The app creates the customer (`res.partner`) and a confirmed sale order (`sale.order`) after payment, asynchronously, with a dedicated Odoo user that has sales rights | owner ("edit on Odoo, not only read"), shape by Claude |
| Odoo invoice and payment registration | Not done by the app in phase 1. The sale order carries the Tap charge id in its notes; the accountant invoices from Odoo | Claude's call, for the accountant to confirm |
| Unpaid orders | Expire 30 minutes after creation, unless a card attempt is in flight (started in the last 15 minutes) | Claude's call |
| Cancelling a web order that has a captured charge | Refunds the charge through Tap's refund API first; the cancel happens only when the refund succeeded | Claude's call |
| Staff and web orders | Staff cannot edit or confirm a web order; it is confirmed by payment. Unpaid ones are listed with an *awaiting payment* badge and vanish on expiry | Claude's call (after the builder check) |
| Charged twice (two tabs) | The second capture is recorded as `DUPLICATE_CAPTURE`, the order is left alone, the dashboard flags it, and staff refund that charge in Tap's dashboard. Payment attempts are not blocked while another is in flight, so a customer who abandoned a 3-D Secure page is never locked out | Claude's call (after the consistency check) |
| Collection | A paid web order gets a *Collected* button for the cashier (`collectedAt`), so the branch can tell waiting from handed over | Claude's call (after the builder check) |
| Receipt | No email is sent in phase 1. The confirmation page shows the order code; the cashier prints the existing PDF receipt at pickup. Email is still collected because Tap requires it on the charge and Odoo wants it on the partner | Claude's call (after the builder check) |
| SMS provider | Not chosen. The code is written against a one-method interface; a console sender is used in development and tests | open, owner |

## Tap facts this design relies on

Checked on developers.tap.company on 2026-10-18.

- Browser: `https://tap-sdks.b-cdn.net/card/1.0.2/index.js` renders the card
  form into a `div` with `renderTapCard(containerId, config)` and the public
  key (`pk_test_…`). `window.CardSDK.tokenize()` ends in `onSuccess(token)`
  with `token.id = "tok_…"`. The live public key is tied to the registered
  domain; Tap registers it on request to integrations@tap.company.
- Server: `POST https://api.tap.company/v2/charges`, `Authorization: Bearer
  sk_…`. Required: `amount` (decimal, min 0.100), `currency` (`QAR`),
  `customer` (`first_name` and `email` required; `phone` optional),
  `source.id` (the token), `redirect.url`. Also used: `post.url` (webhook),
  `metadata` (our order id), `reference.order` (our order code) and
  `reference.idempotent` (our payment id), `threeDSecure: true`,
  `description`. The response is a charge with `id = "chg_…"`, `status`
  (`INITIATED` at first) and `transaction.url` to send the payer to.
- `GET /v2/charges/{id}` reads a charge back. `POST /v2/refunds` with
  `charge_id`, `amount`, `currency`, `reason` refunds one.
- Webhook: HTTP POST of the charge object, header `hashstring` =
  HMAC-SHA256 (hex) with the **secret key** over
  `x_id{id}x_amount{amount}x_currency{currency}x_gateway_reference{reference.gateway}x_payment_reference{reference.payment}x_status{status}x_created{transaction.created}`,
  the amount formatted to the currency's decimals (`1.00`). Missing
  references are empty strings.
- Final statuses: `CAPTURED` is paid. `DECLINED`, `FAILED`, `CANCELLED`,
  `ABANDONED`, `RESTRICTED`, `TIMEDOUT`, `VOID`, `UNKNOWN` are not paid.
  `INITIATED` and `AUTHORIZED` are not final for us (we do not authorize
  separately; `AUTHORIZED` is treated as not final).
- Test cards and keys: `developers.tap.company/reference/testing-cards`; Visa
  `4508750015741019` with expiry `01/39` approves through 3-D Secure.

## The shape of it

```
browser ──► Next.js ──/api/shop/*──► NestJS ──► PostgreSQL
   │             (customer cookie)      │
   │ Card SDK (token)                   ├──► Tap  (create charge, read charge, refund)
   │                                    ◄──  Tap  (webhook: POST /api/shop/payments/tap/webhook)
   └── 3-D Secure page at Tap ──► back to /{locale}/checkout/return?order=…
                                        │
                                        └──► Odoo (partner + sale order, from the outbox, later)
```

### Customer identity

A new `Customer` table, separate from staff `User`: phone (E.164, unique),
name, email, `sessionVersion`, timestamps. Staff accounts and permissions are
untouched.

Sign-in is a six-digit one-time code:

1. `POST /api/shop/otp` `{ phone }` → the phone is normalised (`55123456`,
   `+974 5512 3456`, Arabic digits all become `+97455123456`; only Qatari
   mobile numbers are accepted in phase 1), a code is generated, its hash and
   expiry (5 minutes) are stored in `customer_otps`, and the code is sent.
   Limits: the strict auth throttle per IP, plus at most 3 codes per phone per
   15 minutes (checked on the table). The answer is the same whether or not
   the phone is known.
2. `POST /api/shop/otp/verify` `{ phone, code }` → at most 5 wrong guesses per
   code (counted on the row with a conditional update, as the sales PIN does),
   then the code is dead. On success the customer row is created or found, and
   the API sets an httpOnly cookie `wc_cst` on path `/api/shop` holding a
   signed token (`aud: "customer"`, `sub: customer id`, `ver:
   sessionVersion`, 30 days) plus the readable hint cookie `wc_customer`. No
   refresh rotation: this is the sales-slots model, not the staff model.
3. `POST /api/shop/logout` clears the cookies. `POST /api/shop/logout-all`
   bumps `sessionVersion` (every device signed out).
4. `GET /api/shop/me` returns `{ phone, name, email }`.

Routes under `/api/shop/*` are `@Public()` for the JWT guard and protected by
a new `CustomerGuard` that verifies the cookie, loads the customer, checks the
version, requires the CSRF header on non-GET requests, and attaches
`req.customer`. The audit actor for these requests is the customer
(`actorUsername = phone`, `actorId = null`, role null).

The SMS goes through `SmsSender { send(phone, text): Promise<void> }`.
`SMS_PROVIDER=console` (default) logs the message and keeps the last code per
phone in memory so tests and local development can read it. The real provider
is one new class behind the same interface once the owner picks it.

### Checkout and the order

The existing `Order` grows rather than a second table, so the cashier's
orders page, receipts and the activity log keep working:

| Field | Meaning |
|---|---|
| `source` `OrderSource` (`SHOWROOM` default, `WEB`) | Where it was placed |
| `customerId` (nullable FK) | The web customer; null for showroom orders |
| `customerPhone`, `customerEmail` (nullable snapshots) | What the branch calls and where the receipt went |
| `paymentStatus` `PaymentStatus` (`NONE` default, `PENDING`, `PAID`, `REFUNDED`) | Showroom orders stay `NONE` |
| `paidAt` (nullable) | When Tap captured |
| `expiresAt` (nullable) | When an unpaid web order is cancelled (created + 30 min) |
| `collectedAt`, `collectedById` (nullable) | When the cashier handed the parts over, and who |

Order status keeps its three values: a web order is `PENDING` until paid,
becomes `CONFIRMED` at capture (confirmed by the inactive system user
`system.web`, created on first use like `system.odoo`), and `CANCELLED` on
expiry, by staff, or by the customer before paying.

`POST /api/shop/orders` (customer, `Idempotency-Key` header honoured as in
the showroom): `{ items: [{ productId, quantity }], name, email }`. The
server: updates the customer's name and email; loads the products that are
active, priced, not service rows and on the Bin Omran list; rejects the rest
with `PRODUCT_UNAVAILABLE` and their ids; snapshots names and prices into
`order_items`; takes the branch sequence; writes the order with `source =
WEB`, `paymentStatus = PENDING`, `expiresAt`. The web-orders branch is the
one whose code is `WEB_ORDERS_BRANCH_CODE` (default `BO`); a missing or
inactive branch makes checkout answer `CHECKOUT_UNAVAILABLE` (503).

`GET /api/shop/orders/:id` returns the customer's own order: code, status,
payment status, lines, total, pickup branch, and the latest payment's
outcome. A foreign order is a 404.

`POST /api/shop/orders/:id/cancel` cancels an order that is still unpaid.

### Payment

A `Payment` table records every attempt: `orderId`, `provider` (`tap`),
`chargeId` (unique, nullable until Tap answers), `status` (`INITIATED`,
`CAPTURED`, `FAILED`), `amount`, `currency`, `failureCode`, `rawLast` (the
last charge object, JSON, card number never present because Tap sends only
`first_six`/`last_four`), `refundId`, `refundedAt`, timestamps.

`POST /api/shop/orders/:id/pay` `{ tokenId, locale }` (customer):

1. The order must be the customer's, `PENDING`, unpaid and unexpired; an
   attempt already `CAPTURED` answers `ALREADY_PAID`.
2. A `Payment` row is created (`INITIATED`).
3. Tap `createCharge` is called with the order total, `QAR`, the token,
   customer name/email/phone, `redirect.url = {WEB_PUBLIC_URL}/{locale}/checkout/return?order={id}`,
   `post.url = {API_PUBLIC_URL}/api/shop/payments/tap/webhook`,
   `metadata.orderId`, `reference.order = code`, `reference.idempotent =
   payment id`, `threeDSecure: true`, `lang_code` from the locale.
4. The charge id and status are saved. If Tap already says `CAPTURED` (rare,
   non-3DS cards) the order is settled at once. Otherwise the answer is
   `{ redirectUrl: transaction.url }`.
5. A Tap error (declined token, network) marks the attempt `FAILED` with the
   code and answers `PAYMENT_FAILED` (402) so the customer can try another
   card. The order stays `PENDING`.

`POST /api/shop/payments/tap/webhook` (public, no cookie):

1. Read the parsed charge and the `hashstring` header. Recompute the HMAC
   over Tap's hashstring fields (not the raw body) with `TAP_SECRET_KEY`; a mismatch is a 401 and an audit `FAILURE`.
2. Find the `Payment` by `charge.id`; unknown ids are a 404 (logged).
3. **Settle** (one function shared with the reconcile path, inside one
   transaction with the order row locked): if the charge is `CAPTURED`, check
   `amount == order.total` and `currency == QAR` (a mismatch is recorded as
   `AMOUNT_MISMATCH`, the payment is marked `CAPTURED` but the order is **not**
   confirmed and the entry is an audit `FAILURE` for staff to see); otherwise
   mark the payment `CAPTURED`, the order `PAID` + `CONFIRMED` + `paidAt`, and
   add an outbox row for Odoo. A final non-captured status marks the payment
   `FAILED`. Anything else is ignored. Settling is idempotent: a second
   delivery changes nothing.
4. A `CAPTURED` webhook for an order already `CANCELLED` by expiry still
   settles it: the order becomes `CONFIRMED` + `PAID`, the Odoo row is added,
   and the audit metadata carries `afterExpiry: true`. The customer paid and
   gets the parts; the branch sees nothing unusual but the log.
5. An `AMOUNT_MISMATCH` order stays `PENDING` with a `CAPTURED` attempt. It
   never expires (the sweep skips orders with a captured attempt). Its way
   out is the staff cancel below, which refunds the captured attempt; the
   dashboard shows the mismatch on the order's payment line.

`POST /api/shop/orders/:id/reconcile` (customer): used by the return page. It
reads the latest attempt's charge from Tap and runs the same settle. So a
lost webhook never leaves a paid customer looking at "pending".

Expiry: `CheckoutExpiryService` runs every minute (same pattern as
`OdooSyncService`: `setInterval`, `unref`, off in tests) and cancels web
orders that are `PENDING`, unpaid and past `expiresAt`, with an audit entry
each. It never touches an order that has a `CAPTURED` payment, nor one with
an `INITIATED` attempt younger than 15 minutes (a 3-D Secure page may still
be open).

Staff and web orders (existing `/api/orders` routes):

- `PATCH :id` (edit lines) on a web order answers 409 `WEB_ORDER_READONLY`,
  whatever its status: the total is what the card was charged.
- `POST :id/confirm` on a web order answers 409 `WEB_ORDER_UNPAID`: payment
  confirms it.
- `POST :id/cancel`: if the order has a `CAPTURED` attempt that was not
  refunded (a paid order, or an amount mismatch), the service first asks Tap
  for a refund; only on success does it cancel the order and set
  `paymentStatus = REFUNDED`. A refund failure answers `REFUND_FAILED` (502)
  and leaves the order as it was. Who may cancel is unchanged: the cashier
  while `PENDING` (so the cashier can refund a mismatch), the Super Admin
  also when `CONFIRMED`.
- `POST :id/collect` (new, permission `order.confirm`): a paid web order gets
  `collectedAt`/`collectedById`; 409 `ORDER_NOT_COLLECTABLE` otherwise. The
  orders list shows *Collected*.

Money never touches `number`: `Prisma.Decimal` on the server, strings in
JSON, and the amount sent to Tap is `total.toFixed(2)` parsed by Tap.

### Odoo

The existing `OdooClient` gains `create(model, values)` and `call(model,
method, ids, kwargs)` (`execute_kw` with `create` and an arbitrary method). A
second, optional pair of credentials `ODOO_WRITE_LOGIN` / `ODOO_WRITE_API_KEY`
is used for writing; when they are absent the outbox stays `PENDING` with the
error `ODOO_WRITE_NOT_CONFIGURED` and the dashboard says so. The read-only
sync user keeps its read-only key.

`odoo_outbox` rows: `orderId` (unique), `status` (`PENDING`, `DONE`,
`FAILED`), `attempts`, `nextAttemptAt`, `lastError`, `odooPartnerId`,
`odooSaleOrderId`, timestamps.

`OdooOrdersService` ticks every minute (off in tests), takes due `PENDING`
rows one at a time and for each:

1. Finds the partner by normalised phone in `res.partner` (`phone` or
   `mobile`), else creates one with name, phone, email.
2. Creates `sale.order` with `partner_id`, `client_order_ref = order.code`,
   `origin = "wolfcar.qa"`, `note = "Paid online · Tap charge chg_… · QAR
   total"`, optional `warehouse_id = ODOO_WEB_WAREHOUSE_ID`, and one
   `order_line` per item: `product_id = product.odooId`, `product_uom_qty`,
   `price_unit = unitPrice` (the price the customer paid, which may differ
   from Odoo's current list price), `name = productName`.
3. Calls `action_confirm` on it.
4. Stores both ids and marks `DONE`.

A product without `odooId` (a legacy or hand-made product) is sent as a line
with `product_id` of the configurable `ODOO_FALLBACK_PRODUCT_ID`, when set;
otherwise the row fails with `PRODUCT_NOT_IN_ODOO` and the dashboard shows it.
Failures back off: 1, 5, 15, 60 minutes, then hourly up to 24 attempts, then
`FAILED`. `POST /api/orders/:id/odoo/retry` (new permission
`order.odoo.retry`, default to Finance) resets a row to `PENDING` now.
`GET /api/orders/:id` includes `odoo: { status, saleOrderId, lastError,
attempts }` for web orders.

### Website

New public pages under `app/[locale]/`:

- `checkout/page.tsx`: one client flow, `features/shop/checkout.tsx`, with
  steps **phone → code → details → pay**. The basket is the existing
  localStorage cart. Step *details* asks name and email, then creates the
  order (so the server total is shown before the card). Step *pay* renders
  the Tap card form, tokenizes on "Pay", calls `/pay`, and follows
  `redirectUrl`. A `PRODUCT_UNAVAILABLE` answer removes the named lines from
  the basket and says so.
- `checkout/return/page.tsx`: reads `?order=`, calls `/reconcile`, then shows
  **paid** (order code, pickup address, "show this code at the branch") or
  **not paid** with "try another card" back to the pay step. It polls `GET
  /orders/:id` every 3 seconds for up to 30 seconds while the state is still
  pending.
- The cart drawer gets a primary **Pay by card** button to `/checkout`; the
  WhatsApp button stays as the second option.

`features/shop/` holds: `shop-api.ts` (cookie-based fetch like
`features/bookings/slots/api.ts`), `use-customer.ts`, `checkout-state.ts`
(a pure reducer for the steps, tested without the DOM), `otp-step.tsx`,
`details-step.tsx`, `tap-card.tsx` (loads the SDK script once, renders, exposes
`tokenize()`), `return-status.tsx`. `shared/shop.ts` holds the phone
normaliser and the limits so the API and the forms agree.

The dashboard orders page shows a **Web · paid** badge on web orders, a
`source` filter, phone and email in the detail sheet, and the Odoo status
line with a *Retry* button for those who may.

### Configuration

API (`api/.env`, validated at start; all optional so the API still starts
without payments, in which case creating, paying and reconciling an order and the webhook answer `CHECKOUT_UNAVAILABLE`; sign-in still works):

| Variable | Purpose |
|---|---|
| `TAP_SECRET_KEY` | `sk_test_…` or `sk_live_…`; signs webhooks and authorises API calls |
| `TAP_API_URL` | default `https://api.tap.company/v2` |
| `PAYMENTS_PROVIDER` | `tap` (default) or `fake` (in-memory gateway for tests and local development without Tap) |
| `WEB_PUBLIC_URL` | `https://wolfcar.qa`; builds the redirect URL |
| `API_PUBLIC_URL` | `https://wolfcar.qa` (the proxy); builds the webhook URL |
| `WEB_ORDERS_BRANCH_CODE` | default `BO` |
| `CHECKOUT_TTL_MINUTES` | default `30` |
| `SMS_PROVIDER` | `console` (default) |
| `OTP_DEV_CODE_IN_RESPONSE` | `false`; `true` returns the code in the API answer (console sender only; the browser tests run the API as production and need it). The API refuses to start with it on next to a live Tap key |
| `OTP_PER_PHONE_PER_15_MIN` | default `3` |
| `ODOO_WRITE_LOGIN`, `ODOO_WRITE_API_KEY` | the sales user |
| `ODOO_WEB_WAREHOUSE_ID`, `ODOO_FALLBACK_PRODUCT_ID` | optional integers |

Web: `NEXT_PUBLIC_TAP_PUBLIC_KEY` (`pk_test_…`), read at build time.

### Security notes

- Card data never reaches our servers; the token does. PCI scope stays SAQ-A.
- Webhook: HMAC check first (over Tap's hashstring fields of the parsed charge), constant-time compare; the amount and
  currency are compared to the order, not trusted.
- The OTP endpoints carry `@AuthThrottle()`; the per-phone limit is on top.
  Codes are stored hashed and compared in constant time.
- Customer cookie: httpOnly, `SameSite=Strict`, path `/api/shop`, CSRF header
  on mutations, exactly as the sales-slots cookie.
- Secrets (`TAP_SECRET_KEY`, Odoo keys) are redacted from error messages the
  way `OdooClient` already redacts its key.
- The Content-Security-Policy of the public pages is unchanged (there is none
  beyond the API's); the Tap SDK and its 3-D Secure page load from Tap's
  domains.

### Testing

- **API unit (`*.spec.ts`)**: phone normalisation; HMAC string and signature;
  charge status interpretation; the settle function's decision table (captured
  / mismatch / failed / repeat / cancelled-then-captured); OTP issue and verify
  with limits; customer token sign and verify; checkout service (products
  filtered, total computed, idempotency replay) against a mocked Prisma as
  `orders.service.spec.ts` does; Tap client request shapes against a fake
  `fetch`; Odoo sale-order value mapping; outbox backoff schedule; expiry
  sweep selection.
- **API e2e** (`PAYMENTS_PROVIDER=fake` and the console SMS sender, set in
  `api/test/setup/test-env.ts`): `shop-auth` (sign-in), `shop-checkout` (orders,
  payment, signed webhooks including wrong signature and wrong amount, expiry),
  `orders` (the cashier's view, collect, Super Admin and cashier cancel with
  refund), `odoo-outbox` (against a fake Odoo writer). New routes are added to
  `rbac-matrix`; the audit-coverage skip list stays as it is.
- **Web (Vitest)**: phone input normalisation, the checkout reducer, the OTP
  step (resend timer, wrong code), the Tap card wrapper with a stubbed
  `window.CardSDK`, the return page's states, the cart drawer's new button, the
  orders page and detail sheet for web orders.
- **Playwright**: `checkout.spec.ts`, fake provider, API run as production with
  `OTP_DEV_CODE_IN_RESPONSE=true`: basket → phone → code (read from the
  `devCode` field of the `/otp` answer) → details → pay (the fake SDK stub
  injected by the test) → return page confirms through reconcile → the
  cashier sees it.

## What is left to the builder

- Exact copy of the pages and messages (Arabic first, English second), using
  the existing `Cart`/`ProductsPage` tone.
- Layout of the checkout steps within the current design system.
- The Prisma select shapes and view functions, following `order.view.ts`.
- Where the system user `system.web` is created (mirror `system.odoo`).

## Open questions for the owner

1. **SMS provider.** Which company sends the codes? Qatar needs a registered
   sender name; this has lead time. Until decided the console sender is used.
2. **Odoo**: does the accountant want the app to create the invoice and
   register the Tap payment too, or only the confirmed sale order? Which
   warehouse is Bin Omran in the test database?
3. **Refund policy page**: Tap and the acquiring bank ask for one before live
   keys. Who writes it?
4. **Tap account**: done on 2026-10-20. Merchant ID `68094460`; test and live
   keys are issued in Tap's dashboard. Still needed before launch: Tap must
   register `wolfcar.qa` for the live public key (email integrations@tap.company).
   Keys live only in `api/.env` / `.env.local` locally and in the server's
   env files, never in git or chat.
5. **Odoo taxes**: if the products carry a sales tax in Odoo, a sale order
   line with `price_unit` = the price paid gets that tax added on confirm and
   Odoo's total will not match the Tap amount. Phase 1 sends the paid unit
   price as is; the accountant should check one order in the test database.
