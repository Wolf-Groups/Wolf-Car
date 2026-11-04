# Email instead of SMS, guest checkout and pay at the branch — design

Date: 2026-11-04. Owner request (in Arabic, paraphrased): there is no SMS provider, only a Brevo account
(free plan, 300 emails a day). Use email for sign-in codes, receipts and order updates. Let people buy
without an account. Every buyer, also one who pays at the showroom, leaves their name, mobile and email so
the order is recorded and the branch can call them. After ordering they see a thank-you page. "My account"
stays, because customers keep their cars there and get parts for their car first.

Mockups shown and accepted: `.superpowers/brainstorm/*/content/checkout-flow-v2.html`.

## Decisions

| # | Decision |
|---|----------|
| 1 | No SMS anywhere. Every message to a customer is an email sent through Brevo's transactional API (`POST https://api.brevo.com/v3/smtp/email`, header `api-key`). |
| 2 | Checkout needs no sign-in. The details step asks for full name, Qatari mobile (for calls only, nothing is sent to it) and email (receipt and updates). |
| 3 | The details step also asks how to pay: **card now** (only when the build has the Tap public key) or **pay at the branch when collecting**. Without a Tap key only "pay at the branch" is offered and the checkout still works. |
| 4 | A pay-at-branch order is a web order with `paymentStatus NONE`, `status PENDING`, `expiresAt null`. Staff confirm it after calling the customer (CONFIRMED) and mark it collected when it is paid at the till and handed over. It is never queued for Odoo (the till rings it up, like a showroom order). |
| 5 | Card orders work as today. When one becomes PAID the customer gets a receipt email. |
| 6 | "My account" signs in with the email address and a 6-digit code sent by email. The customer's identity is the email (unique, lower-cased). The phone is kept only to fill the checkout next time. |
| 7 | A guest order is linked to the customer with that email at creation (found or created). A guest request never overwrites an existing customer's saved name or phone. So guest orders show up in "My account" once that email signs in. |
| 8 | A guest reaches their order through an order key: `base64url(HMAC-SHA256(JWT_ACCESS_SECRET, "order-link:" + orderId))`, first 32 characters. It travels as `?key=` in page URLs and as the `X-Order-Key` header to the API; the email links carry it. Nothing is stored. |
| 9 | After ordering the customer lands on a thank-you page (`/checkout/return`): "Thank you, {first name}!", the order code, the next steps, "we emailed … to {email}", the branch card (call, map), continue shopping, and a link to My account. Two variants: paid by card, and placed to pay at the branch. |
| 10 | Emails: sign-in code; order placed (pay at branch); payment receipt (card); a staff alert for every new pay-at-branch order and every paid card order, to `SHOP_NOTIFY_EMAIL`. In the language the customer used (`ar`/`en`, stored on the order). Order emails are best effort: a failure is logged and never fails the order or the payment. |
| 11 | Limits: guest order creation and code requests use the per-IP auth throttle (10 per 60 s); a customer may hold at most 3 open pay-at-branch orders (409 `TOO_MANY_OPEN_ORDERS`); at most 3 codes per email per 15 minutes (`OTP_PER_EMAIL_PER_15_MIN`). |
| 12 | With `EMAIL_PROVIDER=console` under `NODE_ENV=production` (and no `ALLOW_TEST_CHECKOUT`), `POST /api/shop/otp` answers 503 `SIGN_IN_UNAVAILABLE` and no code is logged; order emails are skipped with a log line. So a deploy before the Brevo key is set is safe. |
| 13 | The account link, "My cars" on the catalogue and the checkout are no longer behind the Tap key (`cardCheckoutEnabled`). The Tap key now only switches the card option. |

## Non-goals

SMS or WhatsApp messages; PDF attachments; marketing email; emails on cancel or refund; staff editing a
pay-at-branch order; customers cancelling a pay-at-branch order themselves; sending pay-at-branch orders to
Odoo; delivery.

## Owner tasks (outside the code)

1. Brevo → SMTP & API → API keys: create a key, put it in `deploy/api.prod.env` as `BREVO_API_KEY`, with
   `EMAIL_PROVIDER=brevo`.
2. Brevo → Senders, domains & dedicated IPs → Domains: add `wolfcar.qa` and publish the DNS records Brevo
   shows (Brevo code, DKIM, DMARC). Then set `EMAIL_FROM` (suggested `orders@wolfcar.qa`).
3. `SHOP_NOTIFY_EMAIL`: the address(es) that get the new-order alerts.
