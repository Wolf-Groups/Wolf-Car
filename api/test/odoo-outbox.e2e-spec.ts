import { OdooOrdersService } from '../src/odoo/odoo-orders.service';
import type { OdooWriter } from '../src/odoo/odoo-writer';
import { createTestApp, type TestApp } from './utils/app';
import { bearer, login, showroomLogin } from './utils/auth';
import { PW, seedWorld, type World } from './utils/fixtures';
import { CUSTOMER_PHONE, paidWebOrder, SHOP_ENV, signInCustomer } from './utils/shop';

const MINUTE = 60_000;
const PARTNER_ID = 77;
const SALE_ORDER_ID = 501;

/** A stand-in for Odoo's sales user that records what is written. */
class FakeOdooWriter implements OdooWriter {
  /** Ids an res.partner search answers with (none: the partner is created). */
  partners: number[] = [];
  /** Thrown by every write when set. */
  fail: Error | null = null;
  readonly searches: { model: string; domain: unknown[]; fields: readonly string[] }[] = [];
  readonly creates: { model: string; values: Record<string, unknown> }[] = [];
  readonly calls: { model: string; method: string; ids: number[]; kwargs: Record<string, unknown> | undefined }[] = [];

  searchRead<T>(model: string, domain: unknown[], fields: readonly string[]): Promise<T[]> {
    if (this.fail) return Promise.reject(this.fail);
    this.searches.push({ model, domain, fields });
    return Promise.resolve((model === 'res.partner' ? this.partners.map((id) => ({ id })) : []) as T[]);
  }

  create(model: string, values: Record<string, unknown>): Promise<number> {
    if (this.fail) return Promise.reject(this.fail);
    this.creates.push({ model, values });
    return Promise.resolve(model === 'res.partner' ? PARTNER_ID : SALE_ORDER_ID);
  }

  call<T>(model: string, method: string, ids: number[], kwargs?: Record<string, unknown>): Promise<T> {
    if (this.fail) return Promise.reject(this.fail);
    this.calls.push({ model, method, ids, kwargs });
    return Promise.resolve(true as T);
  }
}

type OrderLine = [number, number, { product_id: number; name: string; product_uom_qty: number; price_unit: number }];

describe('Odoo outbox: paid web orders become sale orders (e2e)', () => {
  let t: TestApp;
  let world: World;
  let service: OdooOrdersService;
  let writer: FakeOdooWriter;
  let sara: string;
  let tok: Record<'admin' | 'finance' | 'boCashier' | 'ghManager', string>;

  beforeAll(async () => {
    t = await createTestApp({ ...SHOP_ENV });
    service = t.app.get(OdooOrdersService);
  });
  beforeEach(async () => {
    world = await seedWorld(t.prisma);
    sara = await signInCustomer(t, CUSTOMER_PHONE);
    tok = {
      admin: (await login(t, 'admin', PW.admin)).token,
      finance: (await login(t, 'finance', PW.finance)).token,
      boCashier: (await login(t, 'bo.cashier', PW.cashier)).token,
      ghManager: (await login(t, 'gh.manager', PW.manager)).token,
    };
    writer = new FakeOdooWriter();
    jest.spyOn(service as unknown as { writer(): OdooWriter | null }, 'writer').mockReturnValue(writer);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await t.close();
  });

  /** Dash Cam and Floor Mats exist in Odoo as variants 1001 and 1002. */
  const linkToOdoo = async () => {
    await t.prisma.product.update({ where: { id: world.products[0].id }, data: { odooId: 1001 } });
    await t.prisma.product.update({ where: { id: world.products[1].id }, data: { odooId: 1002 } });
  };
  const row = (orderId: string) => t.prisma.odooOutbox.findUniqueOrThrow({ where: { orderId } });
  const detail = (token: string, orderId: string) => t.http().get(`/api/orders/${orderId}`).set(bearer(token));
  const retry = (token: string, orderId: string) => t.http().post(`/api/orders/${orderId}/odoo/retry`).set(bearer(token));
  const minutesFromNow = (date: Date | null) => (date ? (date.getTime() - Date.now()) / MINUTE : NaN);

  it('paying queues the order once; processing writes the partner, the sale order and confirms it', async () => {
    await linkToOdoo();
    const paid = await paidWebOrder(t, sara, world);
    expect(await row(paid.id)).toMatchObject({ status: 'PENDING', attempts: 0, lastError: null, odooSaleOrderId: null });
    expect(minutesFromNow((await row(paid.id)).nextAttemptAt)).toBeLessThanOrEqual(0);
    expect((await detail(tok.admin, paid.id)).body.odoo).toMatchObject({ status: 'PENDING', saleOrderId: null, attempts: 0 });

    expect(await service.processDue()).toBe(1);

    expect(writer.searches).toHaveLength(1);
    expect(writer.searches[0].model).toBe('res.partner');
    const domain = JSON.stringify(writer.searches[0].domain);
    expect(domain).toContain(CUSTOMER_PHONE);
    expect(domain).toContain('55123456');

    expect(writer.creates.map((c) => c.model)).toEqual(['res.partner', 'sale.order']);
    expect(writer.creates[0].values).toMatchObject({ name: 'Sara Al-Mansouri', phone: CUSTOMER_PHONE, mobile: CUSTOMER_PHONE, email: 'sara@example.com', customer_rank: 1 });
    const sale = writer.creates[1].values;
    expect(sale).toMatchObject({ partner_id: PARTNER_ID, client_order_ref: paid.code, origin: 'wolfcar.qa' });
    expect(sale.note).toContain(paid.chargeId);
    expect(sale.note).toContain('619.50');
    expect(sale).not.toHaveProperty('warehouse_id');
    const lines = sale.order_line as OrderLine[];
    expect(lines).toHaveLength(2);
    expect(lines.map(([a, b, l]) => [a, b, l.product_id, l.name, l.product_uom_qty, l.price_unit])).toEqual([
      [0, 0, 1001, 'Dash Cam', 1, 499],
      [0, 0, 1002, 'Floor Mats', 1, 120.5],
    ]);
    expect(writer.calls.map((c) => [c.model, c.method, c.ids])).toEqual([['sale.order', 'action_confirm', [SALE_ORDER_ID]]]);

    expect(await row(paid.id)).toMatchObject({ status: 'DONE', odooPartnerId: PARTNER_ID, odooSaleOrderId: SALE_ORDER_ID, lastError: null });
    const res = await detail(tok.admin, paid.id);
    expect(res.status).toBe(200);
    expect(res.body.odoo).toMatchObject({ status: 'DONE', saleOrderId: SALE_ORDER_ID, lastError: null });

    // done is done: a second tick writes nothing
    expect(await service.processDue()).toBe(0);
    expect(writer.creates).toHaveLength(2);
    expect(await t.prisma.odooOutbox.count()).toBe(1);
  });

  it('reuses a partner Odoo already knows by phone', async () => {
    await linkToOdoo();
    writer.partners = [42];
    const paid = await paidWebOrder(t, sara, world);
    await service.processDue();
    expect(writer.creates.map((c) => c.model)).toEqual(['sale.order']);
    expect(writer.creates[0].values.partner_id).toBe(42);
    expect(await row(paid.id)).toMatchObject({ status: 'DONE', odooPartnerId: 42, odooSaleOrderId: SALE_ORDER_ID });
  });

  it('showroom orders never reach the outbox', async () => {
    const kiosk = await showroomLogin(t, 'bo.cashier', PW.showroom);
    const placed = await t
      .http()
      .post('/api/showroom/orders')
      .set(bearer(kiosk.token))
      .send({ items: [{ productId: world.products[0].id, quantity: 1 }], customerName: 'Walk In', userId: world.bo.cashierId });
    expect(placed.status).toBe(201);
    await t.http().post(`/api/orders/${placed.body.id}/confirm`).set(bearer(tok.boCashier));
    expect(await t.prisma.odooOutbox.count()).toBe(0);
    expect((await detail(tok.admin, placed.body.id)).body.odoo).toBeNull();
    expect((await retry(tok.finance, placed.body.id)).status).toBe(404);
  });

  it('a failing Odoo is retried a minute later, then with growing gaps', async () => {
    await linkToOdoo();
    writer.fail = new Error('boom');
    const paid = await paidWebOrder(t, sara, world);

    expect(await service.processDue()).toBe(1);
    const first = await row(paid.id);
    expect(first).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'boom', odooSaleOrderId: null });
    expect(minutesFromNow(first.nextAttemptAt)).toBeGreaterThan(0.5);
    expect(minutesFromNow(first.nextAttemptAt)).toBeLessThan(1.5);
    expect((await detail(tok.finance, paid.id)).body.odoo).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'boom', saleOrderId: null });
    expect((await detail(tok.finance, paid.id)).body.odoo.nextAttemptAt).toEqual(expect.any(String));

    // not due yet
    expect(await service.processDue()).toBe(0);
    expect((await row(paid.id)).attempts).toBe(1);

    // due: the second failure waits five minutes
    const later = new Date(Date.now() + 2 * MINUTE);
    expect(await service.processDue(later)).toBe(1);
    const second = await row(paid.id);
    expect(second.attempts).toBe(2);
    expect((second.nextAttemptAt.getTime() - later.getTime()) / MINUTE).toBeGreaterThan(4.5);
    expect((second.nextAttemptAt.getTime() - later.getTime()) / MINUTE).toBeLessThan(5.5);

    // Odoo is back
    writer.fail = null;
    expect(await service.processDue(new Date(Date.now() + 10 * MINUTE))).toBe(1);
    expect(await row(paid.id)).toMatchObject({ status: 'DONE', odooSaleOrderId: SALE_ORDER_ID, lastError: null });
  });

  it('a product Odoo does not know fails the row for good', async () => {
    const paid = await paidWebOrder(t, sara, world); // Dash Cam and Floor Mats have no odooId, and no fallback is configured
    expect(await service.processDue()).toBe(1);

    const failed = await row(paid.id);
    expect(failed.status).toBe('FAILED');
    expect(failed.lastError).toMatch(/^PRODUCT_NOT_IN_ODOO/);
    expect(failed.lastError).toContain('Dash Cam');
    expect(failed.lastError).toContain('Floor Mats');
    expect(failed.odooSaleOrderId).toBeNull();
    expect(writer.creates.map((c) => c.model)).not.toContain('sale.order');
    expect(writer.calls).toHaveLength(0);
    expect((await detail(tok.admin, paid.id)).body.odoo).toMatchObject({ status: 'FAILED', lastError: expect.stringContaining('PRODUCT_NOT_IN_ODOO') });

    // failed rows are not retried by the timer
    expect(await service.processDue(new Date(Date.now() + 120 * MINUTE))).toBe(0);
  });

  it('Finance can retry a failed row; the next tick sends it', async () => {
    const paid = await paidWebOrder(t, sara, world);
    await service.processDue();
    expect((await row(paid.id)).status).toBe('FAILED');

    const res = await retry(tok.finance, paid.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: paid.id, odoo: { status: 'PENDING', lastError: null, saleOrderId: null } });
    const pending = await row(paid.id);
    expect(pending).toMatchObject({ status: 'PENDING', lastError: null });
    expect(minutesFromNow(pending.nextAttemptAt)).toBeLessThanOrEqual(0);

    const log = await t.prisma.activityLog.findFirstOrThrow({ where: { action: 'order.odoo_retry', entityId: paid.id } });
    expect(log).toMatchObject({ outcome: 'SUCCESS', actorUsername: 'finance', entityType: 'Order' });

    await linkToOdoo();
    expect(await service.processDue()).toBe(1);
    expect(await row(paid.id)).toMatchObject({ status: 'DONE', odooSaleOrderId: SALE_ORDER_ID });
  });

  it('only those allowed to retry may do so', async () => {
    const paid = await paidWebOrder(t, sara, world);
    await service.processDue();
    expect((await retry(tok.boCashier, paid.id)).status).toBe(403);
    expect((await retry(tok.ghManager, paid.id)).status).toBe(403);
    expect((await row(paid.id)).status).toBe('FAILED');
    expect((await retry(tok.admin, paid.id)).status).toBe(200);
    expect((await row(paid.id)).status).toBe('PENDING');
  });

  it('waits, without counting an attempt, while no Odoo sales user is configured', async () => {
    await linkToOdoo();
    jest.restoreAllMocks();
    jest.spyOn(service as unknown as { writer(): OdooWriter | null }, 'writer').mockReturnValue(null);
    const paid = await paidWebOrder(t, sara, world);

    expect(await service.processDue()).toBe(1);
    const waiting = await row(paid.id);
    expect(waiting).toMatchObject({ status: 'PENDING', attempts: 0, lastError: 'ODOO_WRITE_NOT_CONFIGURED' });
    expect(minutesFromNow(waiting.nextAttemptAt)).toBeGreaterThan(55);
    expect(minutesFromNow(waiting.nextAttemptAt)).toBeLessThan(65);
    expect((await detail(tok.admin, paid.id)).body.odoo).toMatchObject({ status: 'PENDING', lastError: 'ODOO_WRITE_NOT_CONFIGURED' });
    expect(writer.creates).toHaveLength(0);
  });

  it('keeps a long error message within the column', async () => {
    await linkToOdoo();
    writer.fail = new Error(`HTTP 500 ${'x'.repeat(1000)}`);
    const paid = await paidWebOrder(t, sara, world);
    await service.processDue();
    const failed = await row(paid.id);
    expect(failed.lastError).toMatch(/^HTTP 500 x+$/);
    expect(failed.lastError?.length).toBe(600);
  });
});
