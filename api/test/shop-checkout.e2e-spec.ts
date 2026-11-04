import { FAKE_TOKENS } from '../../shared/shop';
import { Prisma } from '../src/generated/prisma/client';
import { EMAIL_SENDER, type EmailSender } from '../src/email/email-sender';
import { CheckoutExpiryService } from '../src/shop/checkout/checkout-expiry.service';
import { createTestApp, type TestApp } from './utils/app';
import { bearer, csrf, login } from './utils/auth';
import { PW, seedWorld, type World } from './utils/fixtures';
import {
  chargeIdOf,
  createWebOrder,
  CUSTOMER_EMAIL,
  CUSTOMER_PHONE,
  defaultBasket,
  fakeGateway,
  getWebOrder,
  lastEmailTo,
  OTHER_CUSTOMER_EMAIL,
  payWebOrder,
  reconcileWebOrder,
  SHOP_ENV,
  signedWebhook,
  signInCustomer,
} from './utils/shop';

const MINUTE = 60_000;
/** Tap sends the customer back here; the key lets a guest (or a lapsed session) see the order. */
const RETURN_URL = (orderId: string, locale = 'en') =>
  new RegExp(`^${SHOP_ENV.WEB_PUBLIC_URL}/${locale}/checkout/return\\?order=${orderId}&key=[A-Za-z0-9_-]{32}$`.replace(/\//g, '\\/'));

describe('Online checkout (e2e)', () => {
  let t: TestApp;
  let world: World;
  let sara: string;
  let other: string;

  beforeAll(async () => {
    t = await createTestApp({ ...SHOP_ENV, SHOP_NOTIFY_EMAIL: 'shop@wolfcar.qa' });
  });
  beforeEach(async () => {
    world = await seedWorld(t.prisma);
    sara = await signInCustomer(t, CUSTOMER_EMAIL);
    other = await signInCustomer(t, OTHER_CUSTOMER_EMAIL);
  });
  afterAll(async () => {
    await t.close();
  });

  const create = (cookie = sara, over: Partial<ReturnType<typeof defaultBasket>> = {}, key?: string) => createWebOrder(t, cookie, { ...defaultBasket(world), ...over }, key);
  const createOk = async (cookie = sara, over: Partial<ReturnType<typeof defaultBasket>> = {}) => {
    const res = await create(cookie, over);
    expect(res.status).toBe(201);
    return res.body as { id: string; code: string; total: string; key: string };
  };
  const cancel = (cookie: string, id: string) => t.http().post(`/api/shop/orders/${id}/cancel`).set('Cookie', cookie).set(csrf);
  const dbOrder = (id: string) => t.prisma.order.findUniqueOrThrow({ where: { id }, include: { createdBy: true, confirmedBy: true, cancelledBy: true, payments: true, odooOutbox: true } });
  const expire = (id: string, minutesAgo = 1) => t.prisma.order.update({ where: { id }, data: { expiresAt: new Date(Date.now() - minutesAgo * MINUTE) } });
  const capturedCharge = async (orderId: string) => fakeGateway(t).settle(await chargeIdOf(t, orderId), 'CAPTURED');
  const logOf = (action: string) => t.prisma.activityLog.findMany({ where: { action }, orderBy: { id: 'asc' } });

  describe('web order', () => {
    it('refuses a product that is not on the Bin Omran list, naming it', async () => {
      const offList = await t.prisma.product.create({
        data: { name: 'GH Only', imageKey: '00000000-0000-4000-8000-000000000000', price: new Prisma.Decimal('10.00'), createdById: world.gh.managerId },
      });
      await t.prisma.branchProduct.create({ data: { branchId: world.gh.id, productId: offList.id, position: 10 } });
      const res = await create(sara, { items: [{ productId: world.products[0].id, quantity: 1 }, { productId: offList.id, quantity: 1 }] });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PRODUCT_UNAVAILABLE');
      expect(res.body.productIds).toEqual([offList.id]);
      expect(await t.prisma.order.count()).toBe(0);
    });

    it('refuses an unpriced product and a switched-off one', async () => {
      const unpriced = await create(sara, { items: [{ productId: world.products[2].id, quantity: 1 }] });
      expect(unpriced.status).toBe(400);
      expect(unpriced.body.code).toBe('PRODUCT_UNAVAILABLE');
      expect(unpriced.body.productIds).toEqual([world.products[2].id]);

      await t.prisma.product.update({ where: { id: world.products[1].id }, data: { isActive: false } });
      const inactive = await create();
      expect(inactive.status).toBe(400);
      expect(inactive.body.productIds).toEqual([world.products[1].id]);
      expect(await t.prisma.order.count()).toBe(0);
    });

    it('validates the basket and the contact details', async () => {
      const cases: [object, string][] = [
        [{ items: [] }, 'items'],
        [{ items: [{ productId: world.products[0].id, quantity: 0 }] }, 'items.0.quantity'],
        [{ items: [{ productId: world.products[0].id, quantity: 1 }, { productId: world.products[0].id, quantity: 2 }] }, 'items'],
        [{ name: ' ' }, 'name'],
        [{ name: '<script>alert(1)</script>' }, 'name'],
        [{ email: 'not-an-email' }, 'email'],
        [{ email: '' }, 'email'],
        [{ phone: '44123456' }, 'phone'],
        [{ phone: '' }, 'phone'],
        [{ paymentMethod: 'cash' as 'card' }, 'paymentMethod'],
        [{ locale: 'fr' as 'en' }, 'locale'],
      ];
      for (const [over, field] of cases) {
        const res = await create(sara, over);
        expect(res.status).toBe(400);
        expect(res.body.errors.map((e: { field: string }) => e.field)).toContain(field);
      }
      expect((await create(sara, {}, 'bad key!')).body.code).toBe('BAD_IDEMPOTENCY_KEY');
      expect(await t.prisma.order.count()).toBe(0);
    });

    it('needs the CSRF header, signed in or not', async () => {
      for (const request of [() => t.http().post('/api/shop/orders').set('Cookie', sara), () => t.http().post('/api/shop/orders')]) {
        const noCsrf = await request().send(defaultBasket(world));
        expect(noCsrf.status).toBe(403);
        expect(noCsrf.body.code).toBe('CSRF');
      }
      expect(await t.prisma.order.count()).toBe(0);
    });

    it('creates the order with the server prices, for pickup at Bin Omran, expiring in 30 minutes', async () => {
      const before = Date.now();
      const res = await create();
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        code: 'BO-000001',
        status: 'PENDING',
        paymentStatus: 'PENDING',
        total: '619.50',
        currency: 'QAR',
        paidAt: null,
        replayed: false,
        branch: { code: 'BO', name: 'BO Branch', nameAr: 'فرع BO' },
        customer: { name: 'Sara Al-Mansouri', email: CUSTOMER_EMAIL, phone: CUSTOMER_PHONE },
        paymentMethod: 'card',
        lastPayment: null,
        key: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/) as string,
      });
      expect(res.body.items.map((i: { productName: string; unitPrice: string; quantity: number; lineTotal: string }) => [i.productName, i.unitPrice, i.quantity, i.lineTotal])).toEqual([
        ['Dash Cam', '499.00', 1, '499.00'],
        ['Floor Mats', '120.50', 1, '120.50'],
      ]);
      expect(res.body.items[0].thumbUrl).toMatch(/-sm\.webp$/);
      const expiresIn = new Date(res.body.expiresAt as string).getTime() - before;
      expect(expiresIn).toBeGreaterThan(29 * MINUTE);
      expect(expiresIn).toBeLessThan(31 * MINUTE);
      // nothing internal reaches the website
      const text = JSON.stringify(res.body);
      for (const leak of ['barcode', 'system.web', 'createdBy', 'customerId']) expect(text).not.toContain(leak);

      const row = await dbOrder(res.body.id);
      expect(row).toMatchObject({
        source: 'WEB',
        customerPhone: CUSTOMER_PHONE,
        customerEmail: CUSTOMER_EMAIL,
        customerName: 'Sara Al-Mansouri',
        customerLocale: 'en',
        paymentStatus: 'PENDING',
        branchId: world.bo.id,
      });
      expect(row.createdBy).toMatchObject({ username: 'system.web', isActive: false });
      const customer = await t.prisma.customer.findUniqueOrThrow({ where: { email: CUSTOMER_EMAIL } });
      expect(row.customerId).toBe(customer.id);
      // what she typed fills the form next time
      expect(customer).toMatchObject({ name: 'Sara Al-Mansouri', phone: CUSTOMER_PHONE });

      const log = await t.prisma.activityLog.findFirstOrThrow({ where: { action: 'shop.order.create', entityId: res.body.id } });
      expect(log).toMatchObject({ outcome: 'SUCCESS', actorId: null, actorUsername: CUSTOMER_EMAIL, actorRole: null, entityType: 'Order', branchId: world.bo.id });
    });

    it('a signed-in customer orders under the email they signed in with, whatever the form says', async () => {
      const res = await create(other, { email: 'someone-else@example.com' });
      expect(res.status).toBe(201);
      expect(res.body.customer.email).toBe(OTHER_CUSTOMER_EMAIL);
      expect(await t.prisma.customer.findUnique({ where: { email: 'someone-else@example.com' } })).toBeNull();
    });

    it('numbers web orders in the branch sequence, next to showroom ones', async () => {
      expect((await createOk()).code).toBe('BO-000001');
      expect((await createOk(other)).code).toBe('BO-000002');
    });

    it('treats a repeated Idempotency-Key as the same checkout, per customer', async () => {
      const first = await create(sara, {}, 'checkout-abc12345');
      const second = await create(sara, {}, 'checkout-abc12345');
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body.id).toBe(first.body.id);
      expect(second.body.replayed).toBe(true);
      expect(await t.prisma.order.count()).toBe(1);
      // the same key from another customer never replays Sara's order: the key is taken (unique on created_by_id = system.web,
      // idempotency_key), the customer-scoped lookup finds nothing, so the insert's P2002 is rethrown (409 DUPLICATE via AllExceptionsFilter)
      const theirs = await create(other, {}, 'checkout-abc12345');
      expect(theirs.status).toBe(409);
      expect(theirs.body.code).toBe('DUPLICATE');
      expect(theirs.body.id).toBeUndefined();
      expect(await t.prisma.order.count()).toBe(1);
    });

    it("shows the customer their own order only; another customer's cookie gets 404", async () => {
      const order = await createOk();
      const mine = await getWebOrder(t, sara, order.id);
      expect(mine.status).toBe(200);
      expect(mine.body).toMatchObject({ id: order.id, code: 'BO-000001', total: '619.50' });
      expect((await getWebOrder(t, other, order.id)).status).toBe(404);
      expect((await cancel(other, order.id)).status).toBe(404);
      // without a cookie or the order's key it does not exist
      expect((await getWebOrder(t, '', order.id)).status).toBe(404);
      expect((await t.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PENDING');
    });

    it('cancels an unpaid order once', async () => {
      const order = await createOk();
      const res = await cancel(sara, order.id);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: order.id, status: 'CANCELLED', paymentStatus: 'PENDING' });
      expect((await dbOrder(order.id)).cancelledAt).not.toBeNull();

      const again = await cancel(sara, order.id);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('ORDER_NOT_CANCELLABLE');

      const log = await t.prisma.activityLog.findFirstOrThrow({ where: { action: 'shop.order.cancel', entityId: order.id, outcome: 'SUCCESS' } });
      expect(log).toMatchObject({ actorUsername: CUSTOMER_EMAIL, before: { status: 'PENDING' }, after: { status: 'CANCELLED' } });
    });

    it('the cashier of Bin Omran sees it as a web order', async () => {
      const order = await createOk();
      const cashier = (await login(t, 'bo.cashier', PW.cashier)).token;
      const res = await t.http().get('/api/orders').set(bearer(cashier));
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({ id: order.id, code: 'BO-000001', source: 'WEB', paymentStatus: 'PENDING', customerPhone: CUSTOMER_PHONE, total: '619.50' });
    });
  });

  describe('guest checkout and pay at the branch', () => {
    const guest = (over: Partial<ReturnType<typeof defaultBasket>> = {}, key?: string) =>
      createWebOrder(t, '', { ...defaultBasket(world), email: 'guest@example.com', name: 'Khalid Al-Kuwari', ...over }, key);

    it('a guest orders to pay at the branch: no cookie, no expiry, nothing to pay online', async () => {
      const res = await guest({ paymentMethod: 'branch', locale: 'ar' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: 'PENDING',
        paymentStatus: 'NONE',
        paymentMethod: 'branch',
        expiresAt: null,
        customer: { name: 'Khalid Al-Kuwari', email: 'guest@example.com', phone: CUSTOMER_PHONE },
        key: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/) as string,
      });
      // a guest gets no session
      expect(res.headers['set-cookie']).toBeUndefined();

      const row = await dbOrder(res.body.id);
      expect(row).toMatchObject({ customerLocale: 'ar', paymentStatus: 'NONE', expiresAt: null });
      const customer = await t.prisma.customer.findUniqueOrThrow({ where: { email: 'guest@example.com' } });
      expect(row.customerId).toBe(customer.id);
      expect(customer).toMatchObject({ name: 'Khalid Al-Kuwari', phone: CUSTOMER_PHONE, lastLoginAt: null });

      const log = await t.prisma.activityLog.findFirstOrThrow({ where: { action: 'shop.order.create', entityId: res.body.id } });
      expect(log).toMatchObject({ outcome: 'SUCCESS', actorId: null, actorUsername: 'guest@example.com' });
    });

    it("the order's key opens it; a wrong key, or another order's, does not", async () => {
      const mine = (await guest({ paymentMethod: 'branch' })).body as { id: string; key: string };
      const theirs = (await guest({ paymentMethod: 'branch', email: 'other-guest@example.com' })).body as { id: string; key: string };
      const res = await getWebOrder(t, '', mine.id, mine.key);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: mine.id, paymentMethod: 'branch' });
      expect(res.body.key).toBeUndefined();
      expect((await getWebOrder(t, '', mine.id, theirs.key)).status).toBe(404);
      expect((await getWebOrder(t, '', mine.id, 'x'.repeat(32))).status).toBe(404);
      expect((await getWebOrder(t, '', mine.id)).status).toBe(404);
      // a signed-in customer who does not own it gets nothing either, but the key still works next to any cookie
      expect((await getWebOrder(t, other, mine.id)).status).toBe(404);
      expect((await getWebOrder(t, other, mine.id, mine.key)).status).toBe(200);
    });

    it('a guest pays by card with the key, and comes back to a return page that carries it', async () => {
      const order = (await guest()).body as { id: string; key: string; expiresAt: string };
      expect(order.expiresAt).not.toBeNull();
      expect((await payWebOrder(t, '', order.id)).status).toBe(404);
      const paid = await payWebOrder(t, '', order.id, FAKE_TOKENS.ok, 'en', order.key);
      expect(paid.status).toBe(200);
      expect(paid.body.redirectUrl).toMatch(RETURN_URL(order.id));
      expect(paid.body.redirectUrl).toContain(`key=${order.key}`);

      fakeGateway(t).settle(await chargeIdOf(t, order.id), 'CAPTURED');
      const back = await reconcileWebOrder(t, '', order.id, order.key);
      expect(back.status).toBe(200);
      expect(back.body).toMatchObject({ paymentStatus: 'PAID', status: 'CONFIRMED' });
    });

    it("a guest order under an account's email shows up in that account, and leaves its saved details alone", async () => {
      await t.prisma.customer.update({ where: { email: OTHER_CUSTOMER_EMAIL }, data: { name: 'Omar Saleh', phone: '+97466123456' } });
      const res = await guest({ email: 'Omar@Example.com', name: 'Somebody Else', phone: '77123456', paymentMethod: 'branch' });
      expect(res.status).toBe(201);
      expect(res.body.customer).toMatchObject({ email: OTHER_CUSTOMER_EMAIL, name: 'Somebody Else', phone: '+97477123456' });

      const omar = await t.prisma.customer.findUniqueOrThrow({ where: { email: OTHER_CUSTOMER_EMAIL } });
      expect(omar).toMatchObject({ name: 'Omar Saleh', phone: '+97466123456' });
      const list = await t.http().get('/api/shop/orders').set('Cookie', other);
      expect(list.body.map((o: { id: string }) => o.id)).toEqual([res.body.id]);
    });

    it('a guest replays a checkout by its Idempotency-Key and the same email', async () => {
      const first = await guest({ paymentMethod: 'branch' }, 'guest-checkout-1');
      const again = await guest({ paymentMethod: 'branch' }, 'guest-checkout-1');
      expect(first.status).toBe(201);
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ id: first.body.id, replayed: true, key: first.body.key });
      expect(await t.prisma.order.count()).toBe(1);
    });

    it('one customer may hold three open pay-at-branch orders, not a fourth', async () => {
      for (let i = 0; i < 3; i++) expect((await guest({ paymentMethod: 'branch' })).status).toBe(201);
      const fourth = await guest({ paymentMethod: 'branch' });
      expect(fourth.status).toBe(409);
      expect(fourth.body.code).toBe('TOO_MANY_OPEN_ORDERS');
      // a card order is still fine, and another customer is not affected
      expect((await guest()).status).toBe(201);
      expect((await guest({ paymentMethod: 'branch', email: 'other-guest@example.com' })).status).toBe(201);
    });

    it('a pay-at-branch order is not paid by card, not cancelled by the customer and never expires', async () => {
      const order = (await guest({ paymentMethod: 'branch' })).body as { id: string; key: string };
      const pay = await payWebOrder(t, '', order.id, FAKE_TOKENS.ok, 'en', order.key);
      expect(pay.status).toBe(409);
      expect(pay.body.code).toBe('ORDER_NOT_PAYABLE');
      const cancelled = await t.http().post(`/api/shop/orders/${order.id}/cancel`).set('X-Order-Key', order.key).set(csrf);
      expect(cancelled.status).toBe(409);
      expect(cancelled.body.code).toBe('ORDER_NOT_CANCELLABLE');

      await t.app.get(CheckoutExpiryService).sweep(new Date(Date.now() + 24 * 60 * MINUTE));
      expect(await dbOrder(order.id)).toMatchObject({ status: 'PENDING', paymentStatus: 'NONE' });
      // nothing was charged, so the return page's reconcile just answers the order
      const back = await reconcileWebOrder(t, '', order.id, order.key);
      expect(back.status).toBe(200);
      expect(back.body).toMatchObject({ id: order.id, paymentMethod: 'branch' });
    });

    it('emails the guest the order (with the link that opens it) and alerts the shop', async () => {
      const order = (await guest({ paymentMethod: 'branch', locale: 'ar' })).body as { id: string; code: string; key: string };
      const mail = lastEmailTo(t, 'guest@example.com');
      expect(mail?.subject).toContain(order.code);
      expect(mail?.html).toContain('dir="rtl"');
      expect(mail?.text).toContain(`${SHOP_ENV.WEB_PUBLIC_URL}/ar/checkout/return?order=${order.id}&key=${order.key}`);
      expect(lastEmailTo(t, 'shop@wolfcar.qa')?.subject).toContain(order.code);
    });

    it('the cashier sees a pay-at-branch order next to the paid ones', async () => {
      const order = (await guest({ paymentMethod: 'branch' })).body as { id: string };
      const cashier = (await login(t, 'bo.cashier', PW.cashier)).token;
      const res = await t.http().get('/api/orders').set(bearer(cashier));
      expect(res.body.items).toEqual([expect.objectContaining({ id: order.id, source: 'WEB', status: 'PENDING', paymentStatus: 'NONE', customerPhone: CUSTOMER_PHONE })]);
    });
  });

  describe('payment', () => {
    it('pays with the test token: the answer is the return page and the attempt is open', async () => {
      const order = await createOk();
      const res = await payWebOrder(t, sara, order.id, FAKE_TOKENS.ok, 'en');
      expect(res.status).toBe(200);
      expect(res.body.redirectUrl).toMatch(RETURN_URL(order.id));
      expect(res.body.redirectUrl).toContain(`key=${order.key}`);
      expect(res.body.order).toMatchObject({ id: order.id, status: 'PENDING', paymentStatus: 'PENDING', lastPayment: { status: 'INITIATED', failureCode: null } });

      const payment = await t.prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
      expect(payment).toMatchObject({ provider: 'tap', status: 'INITIATED', currency: 'QAR', failureCode: null });
      expect(payment.amount.toFixed(2)).toBe('619.50');
      expect(payment.chargeId).toMatch(/^chg_fake_/);
      expect(payment.rawLast).toMatchObject({ id: payment.chargeId, status: 'INITIATED' });
      // the Arabic site gets the Arabic return page
      const second = await createOk(other);
      expect((await payWebOrder(t, other, second.id, FAKE_TOKENS.ok, 'ar')).body.redirectUrl).toMatch(RETURN_URL(second.id, 'ar'));
    });

    it('a token the provider refuses answers 402 and leaves the order payable', async () => {
      const order = await createOk();
      const res = await payWebOrder(t, sara, order.id, 'tok_fake_nope');
      expect(res.status).toBe(402);
      expect(res.body.code).toBe('PAYMENT_FAILED');
      expect(res.body.reason).toBe('INVALID_TOKEN');
      const payment = await t.prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
      expect(payment).toMatchObject({ status: 'FAILED', failureCode: 'INVALID_TOKEN', chargeId: null });
      expect((await dbOrder(order.id)).status).toBe('PENDING');
      expect((await payWebOrder(t, sara, order.id)).status).toBe(200);
    });

    it('validates the token and the locale', async () => {
      const order = await createOk();
      for (const body of [{ tokenId: 'nope', locale: 'en' }, { tokenId: FAKE_TOKENS.ok, locale: 'fr' }, { locale: 'en' }, {}]) {
        const res = await t.http().post(`/api/shop/orders/${order.id}/pay`).set('Cookie', sara).set(csrf).send(body);
        expect(res.status).toBe(400);
      }
      expect(await t.prisma.payment.count()).toBe(0);
    });

    it('a declined card leaves the order open for another card', async () => {
      const order = await createOk();
      expect((await payWebOrder(t, sara, order.id, FAKE_TOKENS.declined)).status).toBe(200);
      const after = await reconcileWebOrder(t, sara, order.id);
      expect(after.status).toBe(200);
      expect(after.body).toMatchObject({ status: 'PENDING', paymentStatus: 'PENDING', lastPayment: { status: 'FAILED', failureCode: 'DECLINED' } });

      expect((await payWebOrder(t, sara, order.id, FAKE_TOKENS.ok)).status).toBe(200);
      const paid = await reconcileWebOrder(t, sara, order.id);
      expect(paid.body).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID', lastPayment: { status: 'CAPTURED', failureCode: null } });
      expect(paid.body.paidAt).toEqual(expect.any(String));
      expect(await t.prisma.payment.count({ where: { orderId: order.id } })).toBe(2);
    });

    it('a pending card stays pending through reconcile', async () => {
      const order = await createOk();
      expect((await payWebOrder(t, sara, order.id, FAKE_TOKENS.pending)).status).toBe(200);
      const res = await reconcileWebOrder(t, sara, order.id);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'PENDING', paymentStatus: 'PENDING', paidAt: null, lastPayment: { status: 'INITIATED', failureCode: null } });
      expect(await t.prisma.odooOutbox.count()).toBe(0);
    });

    it('reconcile on an order never paid returns it unchanged, and never for another customer', async () => {
      const order = await createOk();
      const res = await reconcileWebOrder(t, sara, order.id);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: order.id, status: 'PENDING', lastPayment: null });
      expect((await reconcileWebOrder(t, other, order.id)).status).toBe(404);
      expect((await payWebOrder(t, other, order.id)).status).toBe(404);
    });

    it('a paid order cannot be paid again or cancelled by the customer', async () => {
      const order = await createOk();
      await payWebOrder(t, sara, order.id);
      await reconcileWebOrder(t, sara, order.id);
      const again = await payWebOrder(t, sara, order.id);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('ALREADY_PAID');
      const cancelled = await cancel(sara, order.id);
      expect(cancelled.status).toBe(409);
      expect(cancelled.body.code).toBe('ORDER_NOT_CANCELLABLE');
      expect(await t.prisma.payment.count({ where: { orderId: order.id } })).toBe(1);
    });

    it('an expired or cancelled order cannot be paid', async () => {
      const expired = await createOk();
      await expire(expired.id);
      const res = await payWebOrder(t, sara, expired.id);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ORDER_NOT_PAYABLE');

      const cancelled = await createOk();
      await cancel(sara, cancelled.id);
      expect((await payWebOrder(t, sara, cancelled.id)).body.code).toBe('ORDER_NOT_PAYABLE');
      expect(await t.prisma.payment.count()).toBe(0);
    });

    it('names the customer on the payment in the activity log', async () => {
      const order = await createOk();
      await payWebOrder(t, sara, order.id);
      const pay = await logOf('shop.order.pay');
      expect(pay).toHaveLength(1);
      expect(pay[0]).toMatchObject({ outcome: 'SUCCESS', actorUsername: CUSTOMER_EMAIL, actorId: null, entityType: 'Order', entityId: order.id, branchId: world.bo.id });
      const text = JSON.stringify(pay, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
      expect(text).not.toContain(SHOP_ENV.TAP_SECRET_KEY);
    });
  });

  describe('webhook', () => {
    it('a signed CAPTURED webhook confirms and pays the order, and a second delivery changes nothing', async () => {
      const order = await createOk();
      await payWebOrder(t, sara, order.id);
      const charge = await capturedCharge(order.id);
      const sent = jest.spyOn(t.app.get<EmailSender>(EMAIL_SENDER), 'send');

      const res = await signedWebhook(t, charge);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: true });

      const view = await getWebOrder(t, sara, order.id);
      expect(view.body).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID', lastPayment: { status: 'CAPTURED', failureCode: null } });
      expect(view.body.paidAt).toEqual(expect.any(String));
      const row = await dbOrder(order.id);
      expect(row.confirmedAt).not.toBeNull();
      expect(row.confirmedBy?.username).toBe('system.web');
      expect(row.payments[0]).toMatchObject({ status: 'CAPTURED', failureCode: null });
      expect(row.odooOutbox).toMatchObject({ status: 'PENDING', attempts: 0 });

      const again = await signedWebhook(t, charge);
      expect(again.status).toBe(200);
      expect(again.body).toEqual({ received: true });
      const after = await dbOrder(order.id);
      expect(after.paidAt).toEqual(row.paidAt);
      expect(after.updatedAt).toEqual(row.updatedAt);
      expect(await t.prisma.odooOutbox.count({ where: { orderId: order.id } })).toBe(1);
      expect(await t.prisma.payment.count({ where: { orderId: order.id } })).toBe(1);
      // one receipt to Sara and one alert to the shop, not one per delivery
      const subjects = sent.mock.calls.map(([m]) => [m.to.join(','), m.subject]);
      sent.mockRestore();
      expect(subjects).toEqual([
        [CUSTOMER_EMAIL, expect.stringContaining(`Receipt for your order ${order.code}`)],
        ['shop@wolfcar.qa', expect.stringContaining(order.code)],
      ]);

      const log = await logOf('shop.payment.webhook');
      expect(log.map((l) => [l.outcome, (l.metadata as { outcome: string }).outcome])).toEqual([
        ['SUCCESS', 'paid'],
        ['SUCCESS', 'already_paid'],
      ]);
      expect(log[0]).toMatchObject({ actorUsername: null, actorId: null, entityId: order.id, branchId: world.bo.id, metadata: { via: 'webhook', chargeId: charge.id } });
    });

    it('a webhook with a wrong or missing signature is refused and changes nothing', async () => {
      const order = await createOk();
      await payWebOrder(t, sara, order.id);
      const charge = await capturedCharge(order.id);

      const forged = await t.http().post('/api/shop/payments/tap/webhook').set('hashstring', 'deadbeef'.repeat(8)).send(charge);
      expect(forged.status).toBe(401);
      expect(forged.body.code).toBe('BAD_SIGNATURE');
      expect((await t.http().post('/api/shop/payments/tap/webhook').send(charge)).status).toBe(401);
      expect((await signedWebhook(t, charge, 'another-secret')).status).toBe(401);
      expect((await t.http().post('/api/shop/payments/tap/webhook').set('hashstring', 'x').send({})).status).toBe(401);

      const row = await dbOrder(order.id);
      expect(row).toMatchObject({ status: 'PENDING', paymentStatus: 'PENDING', paidAt: null });
      expect(row.payments[0].status).toBe('INITIATED');
      expect(await t.prisma.odooOutbox.count()).toBe(0);
      expect((await logOf('shop.payment.webhook')).every((l) => l.outcome === 'FAILURE')).toBe(true);
    });

    it('a captured charge for the wrong amount is recorded but pays nothing', async () => {
      const order = await createOk();
      await payWebOrder(t, sara, order.id);
      const charge = { ...(await capturedCharge(order.id)), amount: 100 };

      const res = await signedWebhook(t, charge);
      expect(res.status).toBe(200);
      const row = await dbOrder(order.id);
      expect(row).toMatchObject({ status: 'PENDING', paymentStatus: 'PENDING', paidAt: null });
      expect(row.payments[0]).toMatchObject({ status: 'CAPTURED', failureCode: 'AMOUNT_MISMATCH' });
      expect(row.odooOutbox).toBeNull();
      expect((await getWebOrder(t, sara, order.id)).body.lastPayment).toEqual({ status: 'CAPTURED', failureCode: 'AMOUNT_MISMATCH' });

      const log = await logOf('shop.payment.webhook');
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ outcome: 'FAILURE', entityId: order.id, metadata: { outcome: 'amount_mismatch', chargeId: charge.id } });
      // the mismatch is final: the customer cannot pay again, staff must refund through a cancel
      expect((await payWebOrder(t, sara, order.id)).body.code).toBe('ALREADY_PAID');
      expect((await cancel(sara, order.id)).body.code).toBe('ORDER_NOT_CANCELLABLE');
    });

    it('a charge nobody here created is refused as unknown', async () => {
      const order = await createOk();
      await payWebOrder(t, sara, order.id);
      const charge = { ...(await capturedCharge(order.id)), id: 'chg_fake_unknown' };
      const res = await signedWebhook(t, charge);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('UNKNOWN_CHARGE');
      expect((await logOf('shop.payment.webhook')).at(-1)).toMatchObject({ outcome: 'FAILURE' });
      expect((await dbOrder(order.id)).status).toBe('PENDING');
    });

    it('a webhook that says DECLINED closes the attempt; the order can be paid again', async () => {
      const order = await createOk();
      await payWebOrder(t, sara, order.id);
      const charge = fakeGateway(t).settle(await chargeIdOf(t, order.id), 'DECLINED');
      expect((await signedWebhook(t, charge)).status).toBe(200);
      expect((await getWebOrder(t, sara, order.id)).body).toMatchObject({ status: 'PENDING', lastPayment: { status: 'FAILED', failureCode: 'DECLINED' } });
      expect((await payWebOrder(t, sara, order.id)).status).toBe(200);
    });

    it('after a staff refund, a re-delivered CAPTURED webhook leaves the order CANCELLED/REFUNDED and queues nothing new', async () => {
      const order = await createOk();
      await payWebOrder(t, sara, order.id);
      const charge = await capturedCharge(order.id);
      expect((await signedWebhook(t, charge)).status).toBe(200);
      const outbox = await t.prisma.odooOutbox.findUniqueOrThrow({ where: { orderId: order.id } });

      // the Super Admin's cancel with refund (the orders route, Task 8), written directly so this block does not wait for it
      const refundedAt = new Date();
      await t.prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED', cancelledAt: refundedAt, paymentStatus: 'REFUNDED' } });
      await t.prisma.payment.update({ where: { chargeId: charge.id }, data: { refundId: 'rf_fake_staff', refundedAt } });
      const refunded = await dbOrder(order.id);

      // Tap delivers the CAPTURED charge again (or keeps reporting it CAPTURED): a captured payment never changes again
      const again = await signedWebhook(t, charge);
      expect(again.status).toBe(200);
      expect(again.body).toEqual({ received: true });
      const after = await dbOrder(order.id);
      expect(after).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUNDED' });
      expect(after.paidAt).toEqual(refunded.paidAt);
      expect(after.confirmedAt).toEqual(refunded.confirmedAt);
      expect(after.updatedAt).toEqual(refunded.updatedAt);
      expect(after.payments).toHaveLength(1);
      expect(after.payments[0]).toMatchObject({ status: 'CAPTURED', failureCode: null, refundId: 'rf_fake_staff' });
      expect(await t.prisma.odooOutbox.count({ where: { orderId: order.id } })).toBe(1);
      expect(after.odooOutbox).toMatchObject({ id: outbox.id, status: outbox.status, attempts: outbox.attempts });

      const log = await logOf('shop.payment.webhook');
      expect(log.map((l) => [l.outcome, (l.metadata as { outcome: string }).outcome])).toEqual([
        ['SUCCESS', 'paid'],
        ['SUCCESS', 'already_paid'],
      ]);
      expect((await getWebOrder(t, sara, order.id)).body).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUNDED' });
    });

    it('a second attempt that captures on an order already PAID (two tabs) is recorded as DUPLICATE_CAPTURE and leaves the order alone', async () => {
      const order = await createOk();
      await payWebOrder(t, sara, order.id);
      const first = await capturedCharge(order.id);
      expect((await signedWebhook(t, first)).status).toBe(200);
      const paid = await dbOrder(order.id);
      expect(paid).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' });
      expect(paid.paidAt).not.toBeNull();

      // the other tab's attempt was opened before the first one captured (pay answers ALREADY_PAID from now on), so it is written directly
      const secondChargeId = 'chg_fake_second_tab';
      const second = await t.prisma.payment.create({
        data: { orderId: order.id, chargeId: secondChargeId, status: 'INITIATED', amount: new Prisma.Decimal(order.total), currency: 'QAR' },
      });
      const res = await signedWebhook(t, { ...first, id: secondChargeId });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: true });

      const after = await dbOrder(order.id);
      expect(after).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' });
      expect(after.paidAt).toEqual(paid.paidAt);
      expect(after.updatedAt).toEqual(paid.updatedAt);
      expect(await t.prisma.payment.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({ status: 'CAPTURED', failureCode: 'DUPLICATE_CAPTURE', refundId: null });
      expect(await t.prisma.payment.findUniqueOrThrow({ where: { chargeId: first.id } })).toMatchObject({ status: 'CAPTURED', failureCode: null });
      expect(await t.prisma.odooOutbox.count({ where: { orderId: order.id } })).toBe(1);

      const log = await logOf('shop.payment.webhook');
      expect(log).toHaveLength(2);
      expect(log[1]).toMatchObject({
        outcome: 'FAILURE',
        entityType: 'Order',
        entityId: order.id,
        branchId: world.bo.id,
        metadata: { via: 'webhook', outcome: 'duplicate_capture', chargeId: secondChargeId, reason: 'DUPLICATE_CAPTURE' },
      });
    });
  });

  // flipped to describe in Task 7
  describe('expiry', () => {
    const sweep = (now?: Date) => t.app.get(CheckoutExpiryService).sweep(now);

    it('cancels an unpaid order past its expiry and writes one activity entry', async () => {
      const order = await createOk();
      const fresh = await createOk(other);
      await expire(order.id);

      expect(await sweep()).toBe(1);
      const row = await dbOrder(order.id);
      expect(row).toMatchObject({ status: 'CANCELLED', paymentStatus: 'PENDING' });
      expect(row.cancelledAt).not.toBeNull();
      expect(row.cancelledBy?.username).toBe('system.web');
      expect((await dbOrder(fresh.id)).status).toBe('PENDING');
      expect((await getWebOrder(t, sara, order.id)).body.status).toBe('CANCELLED');

      const log = await logOf('shop.order.expire');
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ outcome: 'SUCCESS', entityType: 'Order', entityId: order.id, branchId: world.bo.id, actorId: null, actorUsername: 'system.web' });

      expect(await sweep()).toBe(0);
      expect(await logOf('shop.order.expire')).toHaveLength(1);
    });

    it('leaves an expired order alone while a card attempt is in flight', async () => {
      const order = await createOk();
      await payWebOrder(t, sara, order.id, FAKE_TOKENS.pending);
      await expire(order.id);
      expect(await sweep()).toBe(0);
      expect((await dbOrder(order.id)).status).toBe('PENDING');

      // the 3-D Secure page is long closed: now it goes
      await t.prisma.payment.updateMany({ where: { orderId: order.id }, data: { createdAt: new Date(Date.now() - 20 * MINUTE) } });
      expect(await sweep()).toBe(1);
      expect((await dbOrder(order.id)).status).toBe('CANCELLED');
    });

    it('never touches an order with a captured attempt, nor a showroom order', async () => {
      const mismatch = await createOk();
      await payWebOrder(t, sara, mismatch.id);
      expect((await signedWebhook(t, { ...(await capturedCharge(mismatch.id)), amount: 100 })).status).toBe(200);
      await expire(mismatch.id, 60);
      await t.prisma.payment.updateMany({ where: { orderId: mismatch.id }, data: { createdAt: new Date(Date.now() - 60 * MINUTE) } });
      // differs from a sweepable web order only by source (SHOWROOM, the default): unpaid, expired, no attempts
      const showroom = await t.prisma.order.create({
        data: {
          branchId: world.bo.id,
          number: 99,
          code: 'BO-000099',
          customerName: 'Walk In',
          total: new Prisma.Decimal('1.00'),
          createdById: world.bo.cashierId,
          paymentStatus: 'PENDING',
          expiresAt: new Date(Date.now() - 60 * MINUTE),
        },
      });
      expect(await sweep()).toBe(0);
      expect((await dbOrder(mismatch.id))).toMatchObject({ status: 'PENDING', paymentStatus: 'PENDING' });
      expect(await dbOrder(showroom.id)).toMatchObject({ status: 'PENDING', cancelledAt: null });
    });

    it('a captured webhook after expiry still pays the order (afterExpiry)', async () => {
      const order = await createOk();
      await payWebOrder(t, sara, order.id);
      await expire(order.id);
      await t.prisma.payment.updateMany({ where: { orderId: order.id }, data: { createdAt: new Date(Date.now() - 20 * MINUTE) } });
      expect(await sweep()).toBe(1);
      expect((await dbOrder(order.id)).status).toBe('CANCELLED');

      const res = await signedWebhook(t, await capturedCharge(order.id));
      expect(res.status).toBe(200);
      const row = await dbOrder(order.id);
      expect(row).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' });
      expect(row.paidAt).not.toBeNull();
      expect(row.odooOutbox).toMatchObject({ status: 'PENDING' });
      const log = await logOf('shop.payment.webhook');
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ outcome: 'SUCCESS', metadata: { outcome: 'paid', afterExpiry: true } });
      expect((await getWebOrder(t, sara, order.id)).body).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' });
    });
  });
});
