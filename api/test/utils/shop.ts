import { FAKE_TOKENS } from '../../../shared/shop';
import type { FakePaymentGateway } from '../../src/shop/payments/fake-gateway';
import { PAYMENT_GATEWAY } from '../../src/shop/payments/payment-gateway';
import type { TapCharge } from '../../src/shop/payments/tap-charge';
import { signTapCharge } from '../../src/shop/payments/tap-signature';
import type { TestApp } from './app';
import { csrf } from './auth';
import type { World } from './fixtures';

/** The secret the fake provider verifies webhooks with (TAP_SECRET_KEY in SHOP_ENV). */
export const TAP_TEST_SECRET = 'fake-secret';

/** Documentation only: api/test/setup/test-env.ts already sets these. The gateway is chosen when providers are built, before createTestApp overrides apply. */
export const SHOP_ENV = {
  PAYMENTS_PROVIDER: 'fake',
  SMS_PROVIDER: 'console',
  WEB_PUBLIC_URL: 'http://localhost:3000',
  API_PUBLIC_URL: 'http://localhost:3000',
  TAP_SECRET_KEY: TAP_TEST_SECRET,
} as const;

export const CUSTOMER_PHONE = '+97455123456';
export const OTHER_CUSTOMER_PHONE = '+97466123456';

/** The `wc_cst=…` pair from a response's Set-Cookie headers, or '' when none was set. */
export function customerCookieOf(res: { headers: Record<string, unknown> }): string {
  const list = (res.headers['set-cookie'] as string[] | undefined) ?? [];
  return list.find((c) => c.startsWith('wc_cst='))?.split(';')[0] ?? '';
}

/** Sends a code, reads it from the body (console sender, test env), verifies it; returns the customer cookie. */
export async function signInCustomer(t: TestApp, phone: string): Promise<string> {
  const sent = await t.http().post('/api/shop/otp').set(csrf).send({ phone });
  if (sent.status !== 200 || typeof sent.body.devCode !== 'string') {
    throw new Error(`send otp ${phone} failed: ${sent.status} ${JSON.stringify(sent.body)}`);
  }
  const verified = await t.http().post('/api/shop/otp/verify').set(csrf).send({ phone, code: sent.body.devCode });
  if (verified.status !== 200) throw new Error(`verify otp ${phone} failed: ${verified.status} ${JSON.stringify(verified.body)}`);
  const cookie = customerCookieOf(verified);
  if (!cookie) throw new Error(`verify otp ${phone} set no wc_cst cookie: ${JSON.stringify(verified.headers['set-cookie'])}`);
  return cookie;
}

/** Tap's webhook as Tap would send it: the charge object, signed with the test secret in the `hashstring` header. */
export function signedWebhook(t: TestApp, charge: TapCharge, secret: string = TAP_TEST_SECRET) {
  return t.http().post('/api/shop/payments/tap/webhook').set('hashstring', signTapCharge(charge, secret)).send(charge);
}

export const fakeGateway = (t: TestApp) => t.app.get(PAYMENT_GATEWAY) as FakePaymentGateway;

export interface WebOrderBody {
  items: { productId: string; quantity: number }[];
  name: string;
  email: string;
}

/** Dash Cam ×1 + Floor Mats ×1 = 619.50. */
export const defaultBasket = (world: World): WebOrderBody => ({
  items: [
    { productId: world.products[0].id, quantity: 1 },
    { productId: world.products[1].id, quantity: 1 },
  ],
  name: 'Sara Al-Mansouri',
  email: 'sara@example.com',
});

export function createWebOrder(t: TestApp, cookie: string, body: WebOrderBody, idempotencyKey?: string) {
  const req = t.http().post('/api/shop/orders').set('Cookie', cookie).set(csrf).send(body);
  return idempotencyKey ? req.set('Idempotency-Key', idempotencyKey) : req;
}

export const payWebOrder = (t: TestApp, cookie: string, orderId: string, tokenId: string = FAKE_TOKENS.ok, locale: 'ar' | 'en' = 'en') =>
  t.http().post(`/api/shop/orders/${orderId}/pay`).set('Cookie', cookie).set(csrf).send({ tokenId, locale });

export const reconcileWebOrder = (t: TestApp, cookie: string, orderId: string) =>
  t.http().post(`/api/shop/orders/${orderId}/reconcile`).set('Cookie', cookie).set(csrf);

export const getWebOrder = (t: TestApp, cookie: string, orderId: string) => t.http().get(`/api/shop/orders/${orderId}`).set('Cookie', cookie);

/** The newest attempt's Tap charge id for an order (set by `pay`). */
export async function chargeIdOf(t: TestApp, orderId: string): Promise<string> {
  const payment = await t.prisma.payment.findFirstOrThrow({ where: { orderId }, orderBy: { createdAt: 'desc' } });
  if (!payment.chargeId) throw new Error(`payment ${payment.id} of order ${orderId} has no chargeId`);
  return payment.chargeId;
}

export interface PaidWebOrder {
  id: string;
  code: string;
  chargeId: string;
}

/**
 * A web order paid the way a real one is: created from the basket, charged
 * with tok_fake_ok, captured by a signed CAPTURED webhook. Returns the ids.
 */
export async function paidWebOrder(t: TestApp, cookie: string, world: World, body: WebOrderBody = defaultBasket(world)): Promise<PaidWebOrder> {
  const created = await createWebOrder(t, cookie, body);
  if (created.status !== 201) throw new Error(`create web order failed: ${created.status} ${JSON.stringify(created.body)}`);
  const paid = await payWebOrder(t, cookie, created.body.id);
  if (paid.status !== 200) throw new Error(`pay web order failed: ${paid.status} ${JSON.stringify(paid.body)}`);
  const chargeId = await chargeIdOf(t, created.body.id);
  const charge = fakeGateway(t).settle(chargeId, 'CAPTURED');
  const hook = await signedWebhook(t, charge);
  if (hook.status !== 200) throw new Error(`webhook failed: ${hook.status} ${JSON.stringify(hook.body)}`);
  return { id: created.body.id, code: created.body.code, chargeId };
}
