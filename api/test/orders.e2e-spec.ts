import { createTestApp, type TestApp } from './utils/app';
import { bearer, login, showroomLogin, type Login } from './utils/auth';
import { PW, seedWorld, type World } from './utils/fixtures';
import { chargeIdOf, createWebOrder, CUSTOMER_PHONE, defaultBasket, fakeGateway, paidWebOrder, payWebOrder, SHOP_ENV, signedWebhook, signInCustomer } from './utils/shop';

describe('Showroom & orders (e2e)', () => {
  let t: TestApp;
  let world: World;
  let kioskGh: Login;
  let kioskBo: Login;
  let tok: Record<'admin' | 'finance' | 'ghCashier' | 'boCashier' | 'ghManager', string>;

  beforeAll(async () => {
    // the fake payment gateway only matters for the web-order block; showroom orders behave the same
    t = await createTestApp({ ...SHOP_ENV });
  });
  beforeEach(async () => {
    world = await seedWorld(t.prisma);
    kioskGh = await showroomLogin(t, 'gh.manager', PW.showroom);
    kioskBo = await showroomLogin(t, 'bo.cashier', PW.showroom);
    tok = {
      admin: (await login(t, 'admin', PW.admin)).token,
      finance: (await login(t, 'finance', PW.finance)).token,
      ghCashier: (await login(t, 'gh.cashier', PW.cashier)).token,
      boCashier: (await login(t, 'bo.cashier', PW.cashier)).token,
      ghManager: (await login(t, 'gh.manager', PW.manager)).token,
    };
  });
  afterAll(async () => {
    await t.close();
  });

  const [dashCam, mats] = [0, 1];
  const userIdOf = (l: Login) => (l.body.user as { id: string }).id;
  const place = (kiosk: Login, body: Partial<{ items: unknown; customerName: string; userId: string }> = {}, key?: string) => {
    const req = t
      .http()
      .post('/api/showroom/orders')
      .set(bearer(kiosk.token))
      .send({
        items: [
          { productId: world.products[dashCam].id, quantity: 2 },
          { productId: world.products[mats].id, quantity: 1 },
        ],
        customerName: 'Sara Al-Mansouri',
        userId: userIdOf(kiosk),
        ...body,
      });
    return key ? req.set('Idempotency-Key', key) : req;
  };

  describe('showroom', () => {
    it("lists the branch's priced products in the manager's order with full details", async () => {
      await t.http().put('/api/products/order').set(bearer(tok.ghManager)).send({
        productIds: [world.products[2].id, world.products[1].id, world.products[0].id],
      });
      const res = await t.http().get('/api/showroom/products').set(bearer(kioskGh.token));
      expect(res.status).toBe(200);
      expect(res.body.branch.code).toBe('GH');
      expect(res.body.products.map((p: { name: string }) => p.name)).toEqual(['Floor Mats', 'Dash Cam']); // unpriced hidden
      expect(res.body.products[1]).toEqual({
        id: world.products[0].id,
        name: 'Dash Cam',
        description: 'Dash Cam description',
        barcode: '1000000000001',
        price: '499.00',
        imageUrl: expect.stringMatching(/^\/api\/uploads\//),
        thumbUrl: expect.stringMatching(/-sm\.webp$/),
      });
    });

    it('places an order: branch from the session, prices snapshotted, sequential code', async () => {
      const res = await place(kioskGh);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        code: 'GH-000001',
        status: 'PENDING',
        customerName: 'Sara Al-Mansouri',
        total: '1118.50',
        currency: 'QAR',
        branch: { code: 'GH' },
        createdBy: { username: 'gh.manager' },
      });
      expect(res.body.items.map((i: { unitPrice: string; quantity: number; lineTotal: string }) => [i.unitPrice, i.quantity, i.lineTotal])).toEqual([
        ['499.00', 2, '998.00'],
        ['120.50', 1, '120.50'],
      ]);
      expect((await place(kioskGh, { customerName: 'Rashid' })).body.code).toBe('GH-000002');
      expect((await place(kioskBo, { customerName: 'Ahmed' })).body.code).toBe('BO-000001');

      const log = await t.prisma.activityLog.findFirstOrThrow({ where: { action: 'order.create', entityId: res.body.id } });
      expect(log).toMatchObject({ actorUsername: 'gh.manager', branchId: world.gh.id, outcome: 'SUCCESS' });
    });

    it('never trusts the client with the branch or the user', async () => {
      const spoof = await place(kioskGh, { userId: world.bo.cashierId });
      expect(spoof.status).toBe(403);
      expect(spoof.body.code).toBe('USER_MISMATCH');
      const extra = await t
        .http()
        .post('/api/showroom/orders')
        .set(bearer(kioskGh.token))
        .send({ items: [{ productId: world.products[0].id, quantity: 1 }], customerName: 'Sara', userId: userIdOf(kioskGh), branchId: world.bo.id });
      expect(extra.status).toBe(400);
      expect(extra.body.errors[0].field).toBe('branchId');
      expect(await t.prisma.order.count()).toBe(0);
    });

    it('keeps existing orders unchanged when the price changes later', async () => {
      const order = (await place(kioskGh)).body;
      await t.http().patch(`/api/products/${world.products[0].id}/price`).set(bearer(tok.finance)).send({ price: '999.99' });
      await t.http().patch(`/api/products/${world.products[0].id}`).set(bearer(tok.ghManager)).field('name', 'Renamed Cam');
      const again = await t.http().get(`/api/orders/${order.id}`).set(bearer(tok.ghCashier));
      expect(again.body.total).toBe('1118.50');
      expect(again.body.items[0]).toMatchObject({ productName: 'Dash Cam', unitPrice: '499.00' });
      const next = await place(kioskGh);
      expect(next.body.items[0]).toMatchObject({ productName: 'Renamed Cam', unitPrice: '999.99' });
    });

    it('validates the cart and the customer name', async () => {
      const cases: [object, string][] = [
        [{ items: [] }, 'items'],
        [{ items: [{ productId: world.products[0].id, quantity: 0 }] }, 'items.0.quantity'],
        [{ items: [{ productId: world.products[0].id, quantity: 100 }] }, 'items.0.quantity'],
        [{ items: [{ productId: world.products[0].id, quantity: 1.5 }] }, 'items.0.quantity'],
        [{ items: [{ productId: world.products[0].id, quantity: 1 }, { productId: world.products[0].id, quantity: 2 }] }, 'items'],
        [{ customerName: ' ' }, 'customerName'],
        [{ customerName: '<script>alert(1)</script>' }, 'customerName'],
        [{ customerName: 'x'.repeat(81) }, 'customerName'],
      ];
      for (const [body, field] of cases) {
        const res = await place(kioskGh, body);
        expect(res.status).toBe(400);
        expect(res.body.errors.map((e: { field: string }) => e.field)).toContain(field);
      }
      const unpriced = await place(kioskGh, { items: [{ productId: world.products[2].id, quantity: 1 }] });
      expect(unpriced.body.code).toBe('PRODUCT_UNAVAILABLE');
      const unknown = await place(kioskGh, { items: [{ productId: '5f0e6a4e-1111-4222-8333-444455556666', quantity: 1 }] });
      expect(unknown.body.code).toBe('PRODUCT_UNAVAILABLE');
      expect(await t.prisma.order.count()).toBe(0);
    });

    it('accepts Arabic customer names', async () => {
      const res = await place(kioskGh, { customerName: '  سارة   المنصوري ' });
      expect(res.status).toBe(201);
      expect(res.body.customerName).toBe('سارة المنصوري');
    });

    it('treats a repeated Idempotency-Key as the same checkout (double tap)', async () => {
      const first = await place(kioskGh, {}, 'checkout-abc12345');
      const second = await place(kioskGh, {}, 'checkout-abc12345');
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body.id).toBe(first.body.id);
      expect(await t.prisma.order.count()).toBe(1);
      expect((await place(kioskGh, {}, 'bad key!')).status).toBe(400);
    });

    it('only accepts showroom sessions, and only with order.create', async () => {
      expect((await t.http().get('/api/showroom/products').set(bearer(tok.ghCashier))).status).toBe(403);
      expect((await t.http().get('/api/orders').set(bearer(kioskGh.token))).status).toBe(403);
      await t.prisma.userPermissionOverride.create({ data: { userId: world.gh.managerId, permissionKey: 'order.create', effect: 'REVOKE' } });
      expect((await t.http().get('/api/showroom/products').set(bearer(kioskGh.token))).status).toBe(403);
    });
  });

  describe('orders', () => {
    let ghOrder: { id: string; code: string };
    let boOrder: { id: string; code: string };
    beforeEach(async () => {
      ghOrder = (await place(kioskGh, { customerName: 'Sara Al-Mansouri' })).body;
      boOrder = (await place(kioskBo, { customerName: 'Ahmed Hassan' })).body;
    });

    it('cashiers list only their own branch, with filters', async () => {
      const own = await t.http().get('/api/orders').set(bearer(tok.ghCashier));
      expect(own.status).toBe(200);
      expect(own.body.items.map((o: { code: string }) => o.code)).toEqual(['GH-000001']);
      expect(own.body.items[0]).toMatchObject({ itemCount: 2, total: '1118.50' });

      const sneaky = await t.http().get(`/api/orders?branchId=${world.bo.id}`).set(bearer(tok.ghCashier));
      expect(sneaky.body.items.map((o: { code: string }) => o.code)).toEqual(['GH-000001']);

      const q = (s: string) => t.http().get(`/api/orders?${s}`).set(bearer(tok.ghCashier));
      expect((await q('customerName=sara')).body.total).toBe(1);
      expect((await q('customerName=ahmed')).body.total).toBe(0);
      expect((await q('orderNumber=GH-000001')).body.total).toBe(1);
      expect((await q('orderNumber=1')).body.total).toBe(1);
      expect((await q('status=CONFIRMED')).body.total).toBe(0);
      const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10); // Qatar day
      expect((await q(`from=${today}&to=${today}`)).body.total).toBe(1);
      expect((await q('from=2020-01-01&to=2020-01-02')).body.total).toBe(0);
      expect((await q('status=SHIPPED')).status).toBe(400);
      expect((await q('from=yesterday')).status).toBe(400);
    });

    it('cross-branch access is impossible, even with a known id', async () => {
      const api = (method: 'get' | 'post' | 'patch', url: string, body?: object) => {
        const r = t.http()[method](url).set(bearer(tok.ghCashier));
        return body ? r.send(body) : r;
      };
      expect((await api('get', `/api/orders/${boOrder.id}`)).status).toBe(404);
      expect((await api('patch', `/api/orders/${boOrder.id}`, { customerName: 'Hacked' })).status).toBe(404);
      expect((await api('post', `/api/orders/${boOrder.id}/confirm`)).status).toBe(404);
      expect((await api('post', `/api/orders/${boOrder.id}/cancel`)).status).toBe(404);
      const untouched = await t.prisma.order.findUniqueOrThrow({ where: { id: boOrder.id } });
      expect(untouched).toMatchObject({ status: 'PENDING', customerName: 'Ahmed Hassan' });
      // and the reverse direction
      expect((await t.http().get(`/api/orders/${ghOrder.id}`).set(bearer(tok.boCashier))).status).toBe(404);
    });

    it('cashier edits a pending order, confirms it, and then it is immutable', async () => {
      const edit = await t
        .http()
        .patch(`/api/orders/${ghOrder.id}`)
        .set(bearer(tok.ghCashier))
        .send({ customerName: 'Sara M.', items: [{ productId: world.products[0].id, quantity: 1 }] });
      expect(edit.status).toBe(200);
      expect(edit.body).toMatchObject({ customerName: 'Sara M.', total: '499.00', itemCount: 1 });

      const confirm = await t.http().post(`/api/orders/${ghOrder.id}/confirm`).set(bearer(tok.ghCashier));
      expect(confirm.status).toBe(200);
      expect(confirm.body).toMatchObject({ status: 'CONFIRMED', confirmedBy: { username: 'gh.cashier' } });

      const again = await t.http().post(`/api/orders/${ghOrder.id}/confirm`).set(bearer(tok.ghCashier));
      expect(again.status).toBe(409);
      const locked = await t.http().patch(`/api/orders/${ghOrder.id}`).set(bearer(tok.ghCashier)).send({ customerName: 'Changed' });
      expect(locked.status).toBe(409);
      expect(locked.body.code).toBe('ORDER_NOT_PENDING');
      expect((await t.http().post(`/api/orders/${ghOrder.id}/cancel`).set(bearer(tok.ghCashier))).status).toBe(409);
      expect((await t.prisma.order.findUniqueOrThrow({ where: { id: ghOrder.id } })).customerName).toBe('Sara M.');

      const log = await t.prisma.activityLog.findFirstOrThrow({ where: { action: 'order.confirm', entityId: ghOrder.id } });
      expect(log).toMatchObject({ before: { status: 'PENDING' }, after: { status: 'CONFIRMED' }, actorRole: 'CASHIER' });
      const failed = await t.prisma.activityLog.findFirstOrThrow({ where: { action: 'order.update', outcome: 'FAILURE' } });
      expect(failed.metadata).toMatchObject({ status: 409, reason: 'ORDER_NOT_PENDING' });
    });

    it('only the Super Admin can change a confirmed order (audited as an override)', async () => {
      await t.http().post(`/api/orders/${ghOrder.id}/confirm`).set(bearer(tok.ghCashier));
      const res = await t.http().patch(`/api/orders/${ghOrder.id}`).set(bearer(tok.admin)).send({ customerName: 'Corrected Name' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'CONFIRMED', customerName: 'Corrected Name' });
      const log = await t.prisma.activityLog.findFirstOrThrow({ where: { action: 'order.update', outcome: 'SUCCESS' } });
      expect(log.metadata).toMatchObject({ override: true, status: 'CONFIRMED' });
      expect((await t.http().post(`/api/orders/${ghOrder.id}/cancel`).set(bearer(tok.admin))).body.status).toBe('CANCELLED');
    });

    it('the database blocks a bad line total even if the application were bypassed', async () => {
      const item = await t.prisma.orderItem.findFirstOrThrow({ where: { orderId: ghOrder.id } });
      await expect(t.prisma.orderItem.update({ where: { id: item.id }, data: { quantity: 50 } })).rejects.toThrow(/order_items_amounts_check/);
    });

    it('Finance reads every branch (read-only) and filters by branch', async () => {
      const all = await t.http().get('/api/orders').set(bearer(tok.finance));
      expect(all.body.items.map((o: { code: string }) => o.code).sort()).toEqual(['BO-000001', 'GH-000001']);
      const bo = await t.http().get(`/api/orders?branchId=${world.bo.id}`).set(bearer(tok.finance));
      expect(bo.body.items.map((o: { code: string }) => o.code)).toEqual(['BO-000001']);
      expect((await t.http().get(`/api/orders/${ghOrder.id}`).set(bearer(tok.finance))).status).toBe(200);
      expect((await t.http().post(`/api/orders/${ghOrder.id}/confirm`).set(bearer(tok.finance))).status).toBe(403);
      expect((await t.http().patch(`/api/orders/${ghOrder.id}`).set(bearer(tok.finance)).send({ customerName: 'x y' })).status).toBe(403);
      expect((await t.http().post(`/api/orders/${ghOrder.id}/cancel`).set(bearer(tok.finance))).status).toBe(403);
    });

    it('managers read their branch but cannot confirm', async () => {
      expect((await t.http().get('/api/orders').set(bearer(tok.ghManager))).body.total).toBe(1);
      expect((await t.http().post(`/api/orders/${ghOrder.id}/confirm`).set(bearer(tok.ghManager))).status).toBe(403);
    });

    it('two cashiers confirming at once: exactly one wins', async () => {
      await t.prisma.userPermissionOverride.create({ data: { userId: world.gh.managerId, permissionKey: 'order.confirm', effect: 'GRANT' } });
      const [a, b] = await Promise.all([
        t.http().post(`/api/orders/${ghOrder.id}/confirm`).set(bearer(tok.ghCashier)),
        t.http().post(`/api/orders/${ghOrder.id}/confirm`).set(bearer(tok.ghManager)),
      ]);
      expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 409]);
    });
  });

  describe('web orders in the dashboard', () => {
    let sara: string;
    let unpaid: { id: string; code: string };
    let paid: { id: string; code: string; chargeId: string };
    let showroomBo: { id: string; code: string };

    beforeEach(async () => {
      sara = await signInCustomer(t, CUSTOMER_PHONE);
      showroomBo = (await place(kioskBo, { customerName: 'Walk In' })).body; // BO-000001
      const created = await createWebOrder(t, sara, defaultBasket(world));
      expect(created.status).toBe(201);
      unpaid = created.body; // BO-000002, 619.50
      paid = await paidWebOrder(t, sara, world); // BO-000003, 619.50
    });

    const api = (token: string) => ({
      list: (q = '') => t.http().get(`/api/orders${q}`).set(bearer(token)),
      get: (id: string) => t.http().get(`/api/orders/${id}`).set(bearer(token)),
      patch: (id: string, body: object) => t.http().patch(`/api/orders/${id}`).set(bearer(token)).send(body),
      confirm: (id: string) => t.http().post(`/api/orders/${id}/confirm`).set(bearer(token)),
      cancel: (id: string) => t.http().post(`/api/orders/${id}/cancel`).set(bearer(token)),
      collect: (id: string) => t.http().post(`/api/orders/${id}/collect`).set(bearer(token)),
    });
    const codes = (res: { body: { items: { code: string }[] } }) => res.body.items.map((o) => o.code).sort();

    it('the source filter separates web orders from showroom ones', async () => {
      const bo = api(tok.boCashier);
      expect(codes(await bo.list())).toEqual([showroomBo.code, unpaid.code, paid.code].sort());
      expect(codes(await bo.list('?source=WEB'))).toEqual([unpaid.code, paid.code].sort());
      expect(codes(await bo.list('?source=SHOWROOM'))).toEqual([showroomBo.code]);
      expect((await bo.list('?source=PHONE')).status).toBe(400);
      expect(codes(await api(tok.finance).list('?source=WEB'))).toEqual([unpaid.code, paid.code].sort());
      expect((await api(tok.ghCashier).list('?source=WEB')).body.total).toBe(0);
    });

    it('the BO cashier sees where the order came from and whether it is paid; the GH cashier sees nothing', async () => {
      const bo = api(tok.boCashier);
      // unfiltered: the showroom order is compared too (the source filter has its own case above)
      const list = await bo.list();
      const summary = (code: string) => list.body.items.find((o: { code: string }) => o.code === code);
      expect(summary(unpaid.code)).toMatchObject({ source: 'WEB', status: 'PENDING', paymentStatus: 'PENDING', paidAt: null, collectedAt: null, customerPhone: CUSTOMER_PHONE, customerName: 'Sara Al-Mansouri' });
      expect(summary(paid.code)).toMatchObject({ source: 'WEB', status: 'CONFIRMED', paymentStatus: 'PAID', paidAt: expect.any(String), collectedAt: null, customerPhone: CUSTOMER_PHONE });
      expect(summary(showroomBo.code)).toMatchObject({ source: 'SHOWROOM', paymentStatus: 'NONE', customerPhone: null });

      const detail = await bo.get(paid.id);
      expect(detail.status).toBe(200);
      expect(detail.body).toMatchObject({
        source: 'WEB',
        paymentStatus: 'PAID',
        total: '619.50',
        customerEmail: 'sara@example.com',
        customerPhone: CUSTOMER_PHONE,
        createdBy: { username: 'system.web' },
        confirmedBy: { username: 'system.web' },
        collectedBy: null,
        payment: { chargeId: paid.chargeId, status: 'CAPTURED', failureCode: null, refundId: null },
      });
      expect((await bo.get(showroomBo.id)).body).toMatchObject({ source: 'SHOWROOM', payment: null, odoo: null, customerEmail: null });

      const gh = api(tok.ghCashier);
      expect((await gh.get(paid.id)).status).toBe(404);
      expect((await gh.patch(unpaid.id, { customerName: 'Hacked' })).status).toBe(404);
      expect((await gh.confirm(unpaid.id)).status).toBe(404);
      expect((await gh.cancel(paid.id)).status).toBe(404);
      expect((await gh.collect(paid.id)).status).toBe(404);
    });

    it('the Super Admin cancels a paid web order: the card is refunded first', async () => {
      // the cashier may not cancel a confirmed order, paid or not
      expect((await api(tok.boCashier).cancel(paid.id)).status).toBe(409);

      const res = await api(tok.admin).cancel(paid.id);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUNDED', cancelledBy: { username: 'admin' } });
      expect(res.body.payment).toMatchObject({ status: 'CAPTURED', refundId: expect.stringMatching(/^rf_fake_/) });

      expect((await fakeGateway(t).getCharge(paid.chargeId)).status).toBe('REFUNDED');
      const payment = await t.prisma.payment.findUniqueOrThrow({ where: { chargeId: paid.chargeId } });
      expect(payment.refundId).toMatch(/^rf_fake_/);
      expect(payment.refundedAt).not.toBeNull();
      const log = await t.prisma.activityLog.findFirstOrThrow({ where: { action: 'order.cancel', entityId: paid.id, outcome: 'SUCCESS' } });
      expect(log.metadata).toMatchObject({ refundId: payment.refundId });
      // nothing is refunded twice
      expect((await api(tok.admin).cancel(paid.id)).status).toBe(409);
    });

    it('the BO cashier cancels an amount-mismatch order, and the customer is refunded', async () => {
      const created = await createWebOrder(t, sara, defaultBasket(world));
      await payWebOrder(t, sara, created.body.id);
      const chargeId = await chargeIdOf(t, created.body.id);
      expect((await signedWebhook(t, { ...fakeGateway(t).settle(chargeId, 'CAPTURED'), amount: 100 })).status).toBe(200);

      const bo = api(tok.boCashier);
      expect((await bo.get(created.body.id)).body).toMatchObject({ status: 'PENDING', paymentStatus: 'PENDING', payment: { chargeId, status: 'CAPTURED', failureCode: 'AMOUNT_MISMATCH' } });

      const res = await bo.cancel(created.body.id);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUNDED', payment: { failureCode: 'AMOUNT_MISMATCH', refundId: expect.stringMatching(/^rf_fake_/) } });
      expect((await fakeGateway(t).getCharge(chargeId)).status).toBe('REFUNDED');
    });

    it('a failed refund leaves the order as it was', async () => {
      await t.prisma.payment.updateMany({ where: { chargeId: paid.chargeId }, data: { chargeId: 'chg_fake_gone' } });
      const res = await api(tok.admin).cancel(paid.id);
      expect(res.status).toBe(502);
      expect(res.body.code).toBe('REFUND_FAILED');
      expect((await api(tok.admin).get(paid.id)).body).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' });
    });

    it('staff cannot edit or confirm a web order; the cashier may still cancel an unpaid one', async () => {
      const bo = api(tok.boCashier);
      const edit = await bo.patch(unpaid.id, { customerName: 'Sara M.' });
      expect(edit.status).toBe(409);
      expect(edit.body.code).toBe('WEB_ORDER_READONLY');
      const confirm = await bo.confirm(unpaid.id);
      expect(confirm.status).toBe(409);
      expect(confirm.body.code).toBe('WEB_ORDER_UNPAID');
      // not even the Super Admin, whatever the status: the total is what the card was charged
      expect((await api(tok.admin).patch(paid.id, { customerName: 'Corrected' })).body.code).toBe('WEB_ORDER_READONLY');
      expect((await api(tok.admin).confirm(unpaid.id)).body.code).toBe('WEB_ORDER_UNPAID');
      expect((await t.prisma.order.findUniqueOrThrow({ where: { id: unpaid.id } })).customerName).toBe('Sara Al-Mansouri');

      const cancelled = await bo.cancel(unpaid.id);
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.status).toBe('CANCELLED');
      expect(cancelled.body.paymentStatus).not.toBe('REFUNDED'); // nothing was captured, nothing to refund
    });

    it('the cashier marks the paid order collected, once', async () => {
      const bo = api(tok.boCashier);
      const res = await bo.collect(paid.id);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: paid.id, status: 'CONFIRMED', paymentStatus: 'PAID', collectedAt: expect.any(String), collectedBy: { username: 'bo.cashier' } });
      expect((await bo.list('?source=WEB')).body.items.find((o: { id: string }) => o.id === paid.id).collectedAt).toEqual(expect.any(String));

      const again = await bo.collect(paid.id);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('ORDER_NOT_COLLECTABLE');
      expect((await bo.collect(unpaid.id)).body.code).toBe('ORDER_NOT_COLLECTABLE');
      expect((await bo.collect(showroomBo.id)).body.code).toBe('ORDER_NOT_COLLECTABLE');
      expect((await api(tok.finance).collect(paid.id)).status).toBe(403);
      expect((await api(tok.ghManager).collect(paid.id)).status).toBe(403);

      const log = await t.prisma.activityLog.findFirstOrThrow({ where: { action: 'order.collect', entityId: paid.id, outcome: 'SUCCESS' } });
      expect(log).toMatchObject({ actorUsername: 'bo.cashier', branchId: world.bo.id });
    });
  });
});
