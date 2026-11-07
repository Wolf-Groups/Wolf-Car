import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { mock, mockDeep } from 'jest-mock-extended';
import type { AuditTrail } from '../../activity/audit-trail.service';
import type { Env } from '../../config/env';
import { Prisma } from '../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CustomerPrincipal } from '../customers/customers.service';
import type { OrderEmailsService } from '../emails/order-emails.service';
import type { PaymentGateway } from '../payments/payment-gateway';
import { CheckoutService } from './checkout.service';
import type { OrderAccess } from './order-access';
import { orderKey } from './order-key';
import { ensureSystemWebUser } from './system-web-user';
import type { WebOrderRow } from './web-order.view';

jest.mock('./system-web-user', () => ({ SYSTEM_WEB_USERNAME: 'system.web', ensureSystemWebUser: jest.fn() }));

const customer: CustomerPrincipal = { id: 'c-1', email: 'sara@example.qa', name: null, phone: '+97455123456', sessionVersion: 1 };
const signedIn: OrderAccess = { customer, key: null };
const asGuest: OrderAccess = { customer: null, key: null };
const SECRET = 'x'.repeat(40);
const dto = {
  items: [{ productId: 'p1', quantity: 1 }, { productId: 'p2', quantity: 1 }],
  name: 'Sara Al Thani',
  phone: '+97455123456',
  email: 'sara@example.qa',
  paymentMethod: 'card' as const,
  locale: 'en' as const,
};
const branchDto = { ...dto, paymentMethod: 'branch' as const };
const products = [
  { id: 'p1', name: 'Dash Cam', price: new Prisma.Decimal('499.00') },
  { id: 'p2', name: 'Floor Mats', price: new Prisma.Decimal('120.50') },
];

const webRow = (over: Partial<WebOrderRow> = {}): WebOrderRow => ({
  id: 'o-1',
  code: 'BO-000001',
  status: 'PENDING',
  paymentStatus: 'PENDING',
  total: new Prisma.Decimal('619.50'),
  currency: 'QAR',
  createdAt: new Date('2026-10-18T10:00:00.000Z'),
  expiresAt: new Date('2026-10-18T10:30:00.000Z'),
  paidAt: null,
  collectedAt: null,
  customerName: 'Sara Al Thani',
  customerEmail: 'sara@example.qa',
  customerPhone: '+97455123456',
  customerId: 'c-1',
  branch: { id: 'bo', code: 'BO', name: 'Bin Omran', nameAr: 'بن عمران' },
  items: [
    { productId: 'p1', productName: 'Dash Cam', unitPrice: new Prisma.Decimal('499.00'), quantity: 1, lineTotal: new Prisma.Decimal('499.00'), product: { imageKey: 'img-1' } },
    { productId: 'p2', productName: 'Floor Mats', unitPrice: new Prisma.Decimal('120.50'), quantity: 1, lineTotal: new Prisma.Decimal('120.50'), product: { imageKey: 'img-2' } },
  ],
  payments: [],
  ...over,
});

const hasKey = (args: unknown) => JSON.stringify((args as { where?: unknown } | undefined)?.where ?? {}).includes('idempotencyKey');

describe('CheckoutService', () => {
  const prisma = mockDeep<PrismaService>();
  const trail = mock<AuditTrail>();
  const gateway = mock<PaymentGateway>();
  const emails = mock<OrderEmailsService>();
  const config = { get: (key: string) => ({ WEB_ORDERS_BRANCH_CODE: 'BO', CHECKOUT_TTL_MINUTES: 30, JWT_ACCESS_SECRET: SECRET })[key] } as unknown as ConfigService<Env, true>;
  const service = new CheckoutService(prisma, config, trail, gateway, emails);

  /** findFirst/findUnique answer the replay lookup (a where with idempotencyKey) with `replay`, anything else with `row`. */
  const orderLookups = (row: WebOrderRow | null, replay: WebOrderRow | null = null) => {
    const answer = (args: unknown) => Promise.resolve(hasKey(args) ? replay : row);
    prisma.order.findFirst.mockImplementation(answer as never);
    prisma.order.findUnique.mockImplementation(answer as never);
    prisma.order.findUniqueOrThrow.mockImplementation(answer as never);
  };
  const branchFound = () => {
    prisma.branch.findFirst.mockResolvedValue({ id: 'bo', code: 'BO' } as never);
    prisma.branch.findUnique.mockResolvedValue({ id: 'bo', code: 'BO', isActive: true } as never);
  };

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(ensureSystemWebUser).mockResolvedValue('sys-web');
    for (const m of ['setEntity', 'setChange', 'setBranch', 'addMetadata'] as const) trail[m].mockReturnValue(trail);
    prisma.$transaction.mockImplementation((arg: unknown) =>
      (typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as unknown[])) as never,
    );
    branchFound();
    prisma.product.findMany.mockResolvedValue(products as never);
    prisma.branch.update.mockResolvedValue({ orderSeq: 1, code: 'BO' } as never);
    prisma.order.create.mockResolvedValue({ id: 'o-1' } as never);
    prisma.customer.update.mockResolvedValue({} as never);
    prisma.customer.upsert.mockResolvedValue({ id: 'c-9', email: 'guest@example.qa' } as never);
    prisma.order.count.mockResolvedValue(0);
    for (const m of ['setActor'] as const) trail[m].mockReturnValue(trail);
    orderLookups(webRow());
  });

  const code = async (promise: Promise<unknown>, status: number) => {
    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(status);
    return ((err as HttpException).getResponse() as { code: string }).code;
  };

  describe('pickupBranch', () => {
    it('answers the active WEB_ORDERS_BRANCH_CODE branch', async () => {
      expect(await service.pickupBranch('card')).toEqual({ id: 'bo', code: 'BO' });
      const where = (prisma.branch.findFirst.mock.calls[0]?.[0] ?? prisma.branch.findUnique.mock.calls[0]?.[0])?.where;
      expect(where).toMatchObject({ code: 'BO' });
    });

    it('is 503 CHECKOUT_UNAVAILABLE without such a branch', async () => {
      prisma.branch.findFirst.mockResolvedValue(null);
      prisma.branch.findUnique.mockResolvedValue(null);
      expect(await code(service.pickupBranch('card'), 503)).toBe('CHECKOUT_UNAVAILABLE');
    });

    it('is 503 CHECKOUT_UNAVAILABLE when the branch is switched off', async () => {
      const off = { id: 'bo', code: 'BO', isActive: false };
      // A lookup that filters on isActive finds nothing; one that does not finds the switched-off row.
      const lookup = (args: { where?: { isActive?: unknown } }) => Promise.resolve(args.where?.isActive === undefined ? off : null);
      prisma.branch.findFirst.mockImplementation(lookup as never);
      prisma.branch.findUnique.mockImplementation(lookup as never);
      expect(await code(service.pickupBranch('branch'), 503)).toBe('CHECKOUT_UNAVAILABLE');
    });

    it('is 503 CHECKOUT_UNAVAILABLE for a card order when no payment gateway is configured', async () => {
      const unconfigured = new CheckoutService(prisma, config, trail, null, emails);
      expect(await code(unconfigured.pickupBranch('card'), 503)).toBe('CHECKOUT_UNAVAILABLE');
    });

    it('needs no payment gateway for an order paid at the branch', async () => {
      const unconfigured = new CheckoutService(prisma, config, trail, null, emails);
      expect(await unconfigured.pickupBranch('branch')).toEqual({ id: 'bo', code: 'BO' });
    });
  });

  describe('createOrder', () => {
    it('prices the basket on the server and writes a WEB order that expires in CHECKOUT_TTL_MINUTES', async () => {
      const before = Date.now();
      const result = await service.createOrder(signedIn, dto, 'key-1234567890');

      expect(prisma.product.findMany.mock.calls[0][0]?.where).toMatchObject({
        id: { in: ['p1', 'p2'] },
        isActive: true,
        price: { not: null },
        serviceId: null,
        branchPositions: { some: { branchId: 'bo' } },
      });

      const data = prisma.order.create.mock.calls[0][0].data as Record<string, unknown> & { total: Prisma.Decimal; expiresAt: Date };
      expect(data).toMatchObject({
        branchId: 'bo',
        number: 1,
        code: 'BO-000001',
        source: 'WEB',
        paymentStatus: 'PENDING',
        customerId: 'c-1',
        customerPhone: '+97455123456',
        customerEmail: 'sara@example.qa',
        customerName: 'Sara Al Thani',
        customerLocale: 'en',
        createdById: 'sys-web',
        idempotencyKey: 'key-1234567890',
      });
      expect(data.total.toFixed(2)).toBe('619.50');
      expect(data.expiresAt.getTime() - before).toBeGreaterThanOrEqual(30 * 60_000 - 2_000);
      expect(data.expiresAt.getTime() - before).toBeLessThanOrEqual(30 * 60_000 + 2_000);
      const items = (data.items as { create: { productName: string; quantity: number; unitPrice: Prisma.Decimal; lineTotal: Prisma.Decimal; position: number }[] }).create;
      expect(items.map((i) => [i.productName, i.quantity, i.unitPrice.toFixed(2), i.lineTotal.toFixed(2), i.position])).toEqual([
        ['Dash Cam', 1, '499.00', '499.00', 0],
        ['Floor Mats', 1, '120.50', '120.50', 1],
      ]);

      expect(result.replayed).toBe(false);
      expect(result.order).toMatchObject({ id: 'o-1', code: 'BO-000001', total: '619.50', paymentStatus: 'PENDING', paymentMethod: 'card', key: orderKey('o-1', SECRET) });
      expect(trail.setEntity).toHaveBeenCalledWith('Order', 'o-1');
      expect(trail.setBranch).toHaveBeenCalledWith('bo');
      expect(trail.setChange).toHaveBeenCalledWith(null, expect.objectContaining({ id: 'o-1', code: 'BO-000001' }));
    });

    it('multiplies by the quantity', async () => {
      await service.createOrder(signedIn, { ...dto, items: [{ productId: 'p1', quantity: 2 }, { productId: 'p2', quantity: 3 }] }, undefined);
      const data = prisma.order.create.mock.calls[0][0].data as { total: Prisma.Decimal; items: { create: { quantity: number; lineTotal: Prisma.Decimal }[] } };
      expect(data.total.toFixed(2)).toBe('1359.50');
      expect(data.items.create.map((i) => [i.quantity, i.lineTotal.toFixed(2)])).toEqual([
        [2, '998.00'],
        [3, '361.50'],
      ]);
    });

    it('reads the pickup branch code and the expiry from the settings', async () => {
      const ghConfig = { get: (key: string) => ({ WEB_ORDERS_BRANCH_CODE: 'GH', CHECKOUT_TTL_MINUTES: 45, JWT_ACCESS_SECRET: SECRET })[key] } as unknown as ConfigService<Env, true>;
      const gh = new CheckoutService(prisma, ghConfig, trail, gateway, emails);
      const before = Date.now();
      await gh.createOrder(signedIn, dto, undefined);
      const where = (prisma.branch.findFirst.mock.calls[0]?.[0] ?? prisma.branch.findUnique.mock.calls[0]?.[0])?.where;
      expect(where).toMatchObject({ code: 'GH' });
      const data = prisma.order.create.mock.calls[0][0].data as { expiresAt: Date };
      expect(data.expiresAt.getTime() - before).toBeGreaterThanOrEqual(45 * 60_000 - 2_000);
      expect(data.expiresAt.getTime() - before).toBeLessThanOrEqual(45 * 60_000 + 2_000);
    });

    it('is 503 CHECKOUT_UNAVAILABLE without the pickup branch, and writes nothing', async () => {
      prisma.branch.findFirst.mockResolvedValue(null);
      prisma.branch.findUnique.mockResolvedValue(null);
      expect(await code(service.createOrder(signedIn, dto, undefined), 503)).toBe('CHECKOUT_UNAVAILABLE');
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it("remembers a signed-in customer's name and phone, and orders under the account's email", async () => {
      await service.createOrder(signedIn, { ...dto, email: 'typed-else@example.qa' }, undefined);
      const update = prisma.customer.update.mock.calls[0][0];
      expect(update.where).toEqual({ id: 'c-1' });
      expect(update.data).toEqual({ name: 'Sara Al Thani', phone: '+97455123456' });
      expect(prisma.order.create.mock.calls[0][0].data).toMatchObject({ customerId: 'c-1', customerEmail: 'sara@example.qa' });
    });

    it("finds or creates a guest's customer by email, never changing an existing one", async () => {
      await service.createOrder(asGuest, { ...dto, email: 'guest@example.qa' }, undefined);
      const upsert = prisma.customer.upsert.mock.calls[0][0];
      expect(upsert.where).toEqual({ email: 'guest@example.qa' });
      expect(upsert.create).toEqual({ email: 'guest@example.qa', name: 'Sara Al Thani', phone: '+97455123456' });
      expect(upsert.update).toEqual({});
      expect(prisma.customer.update).not.toHaveBeenCalled();
      expect(prisma.order.create.mock.calls[0][0].data).toMatchObject({ customerId: 'c-9', customerEmail: 'guest@example.qa' });
      expect(trail.setActor).toHaveBeenCalledWith({ id: null, username: 'guest@example.qa', role: null, branchId: null });
    });

    it('writes an order to pay at the branch: no online payment, no expiry', async () => {
      orderLookups(webRow({ paymentStatus: 'NONE', expiresAt: null }));
      const unconfigured = new CheckoutService(prisma, config, trail, null, emails);
      const result = await unconfigured.createOrder(asGuest, branchDto, undefined);
      expect(prisma.order.create.mock.calls[0][0].data).toMatchObject({ paymentStatus: 'NONE', expiresAt: null });
      expect(result.order).toMatchObject({ paymentMethod: 'branch', expiresAt: null });
      // the customer and the shop hear about it now; a card order waits for its payment
      expect(emails.placed).toHaveBeenCalledWith('o-1');
    });

    it('emails nothing for a card order, nor for a replayed pay-at-branch checkout', async () => {
      await service.createOrder(signedIn, dto, undefined);
      expect(emails.placed).not.toHaveBeenCalled();
      orderLookups(webRow({ paymentStatus: 'NONE', expiresAt: null }), webRow({ paymentStatus: 'NONE', expiresAt: null }));
      await service.createOrder(asGuest, branchDto, 'key-1234567890');
      expect(emails.placed).not.toHaveBeenCalled();
    });

    it("holds a signed-in customer to no cap: a stranger's guest orders under their email cannot lock them out", async () => {
      prisma.order.count.mockResolvedValue(3);
      await expect(service.createOrder(signedIn, branchDto, undefined)).resolves.toMatchObject({ replayed: false });
      expect(prisma.order.create).toHaveBeenCalledTimes(1);
    });

    it('is 409 TOO_MANY_OPEN_ORDERS once the customer holds three open pay-at-branch orders', async () => {

      prisma.order.count.mockResolvedValue(3);
      expect(await code(service.createOrder(asGuest, branchDto, undefined), 409)).toBe('TOO_MANY_OPEN_ORDERS');
      expect(prisma.order.count.mock.calls[0][0]?.where).toEqual({ customerId: 'c-9', source: 'WEB', status: 'PENDING', paymentStatus: 'NONE' });
      expect(prisma.order.create).not.toHaveBeenCalled();
      // card orders do not count against it
      prisma.order.count.mockClear();
      await service.createOrder(asGuest, dto, undefined);
      expect(prisma.order.count).not.toHaveBeenCalled();
    });

    it('refuses products that are off the Bin Omran list, naming them', async () => {
      prisma.product.findMany.mockResolvedValue([products[0]] as never);
      const err = await service.createOrder(signedIn, dto, undefined).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'PRODUCT_UNAVAILABLE', productIds: ['p2'] });
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('replays the same Idempotency-Key for the same customer without creating a second order', async () => {
      orderLookups(webRow(), webRow());
      const result = await service.createOrder(signedIn, dto, 'key-1234567890');
      expect(result).toMatchObject({ replayed: true, order: { id: 'o-1', key: orderKey('o-1', SECRET) } });
      expect(prisma.order.create).not.toHaveBeenCalled();
      const lookups = [...prisma.order.findFirst.mock.calls, ...prisma.order.findUnique.mock.calls].map((c) => c[0]).filter(hasKey);
      expect(lookups).not.toHaveLength(0);
      for (const lookup of lookups) {
        const where = JSON.stringify(lookup?.where);
        expect(where).toContain('"idempotencyKey":"key-1234567890"');
        expect(where).toContain('"customerId":"c-1"');
      }
    });

    it("never hands over another customer's order when their key collides: the unique violation is rethrown", async () => {
      orderLookups(webRow(), null);
      prisma.order.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 't' }));
      await expect(service.createOrder(signedIn, dto, 'key-1234567890')).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  describe('get', () => {
    it("returns the customer's own order", async () => {
      expect(await service.get(signedIn, 'o-1')).toMatchObject({ id: 'o-1', total: '619.50' });
      expect(prisma.order.findFirst.mock.calls[0][0]?.where).toMatchObject({ id: 'o-1', customerId: 'c-1' });
    });

    it("is 404 for anyone else's order", async () => {
      orderLookups(null);
      await expect(service.get(signedIn, 'o-2')).rejects.toBeInstanceOf(NotFoundException);
    });

    it("opens any order with that order's key, and none without a key or cookie", async () => {
      await service.get({ customer: null, key: orderKey('o-1', SECRET) }, 'o-1');
      expect(prisma.order.findFirst.mock.calls[0][0]?.where).toEqual({ id: 'o-1' });
      await expect(service.get({ customer: null, key: orderKey('o-2', SECRET) }, 'o-1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.get(asGuest, 'o-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.order.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe('list', () => {
    it("returns the customer's own orders, newest first, at most 50", async () => {
      prisma.order.findMany.mockResolvedValue([webRow({ id: 'o-2', code: 'BO-000002' }), webRow()] as never);
      const views = await service.list(customer);
      expect(views.map((v) => v.id)).toEqual(['o-2', 'o-1']);
      const args = prisma.order.findMany.mock.calls[0][0];
      expect(args?.where).toMatchObject({ customerId: 'c-1', source: 'WEB' });
      expect(args?.orderBy).toEqual({ createdAt: 'desc' });
      expect(args?.take).toBe(50);
    });

    it('leaves out checkouts that were cancelled before any card was charged', async () => {
      prisma.order.findMany.mockResolvedValue([] as never);
      await service.list(customer);
      expect(prisma.order.findMany.mock.calls[0][0]?.where).toMatchObject({
        NOT: { status: 'CANCELLED', paymentStatus: 'PENDING', payments: { none: { status: 'CAPTURED' } } },
      });
    });
  });

  describe('cancelUnpaid', () => {
    it('cancels with one conditional update that spares paid orders', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      orderLookups(webRow({ status: 'CANCELLED' }));
      const view = await service.cancelUnpaid(signedIn, 'o-1');
      expect(view.status).toBe('CANCELLED');
      const call = prisma.order.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ AND: [{ id: 'o-1', customerId: 'c-1' }, { status: 'PENDING', paymentStatus: 'PENDING', payments: { none: { status: 'CAPTURED' } } }] });
      expect(call.data).toMatchObject({ status: 'CANCELLED', cancelledAt: expect.any(Date) as Date });
      expect(trail.setChange).toHaveBeenCalled();
    });

    it("is 404 for anyone else's order and cancels nothing", async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 0 });
      orderLookups(null);
      await expect(service.cancelUnpaid(signedIn, 'o-2')).rejects.toBeInstanceOf(NotFoundException);
      expect(trail.setChange).not.toHaveBeenCalled();
    });

    it('is 409 ORDER_NOT_CANCELLABLE when nothing matched', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 0 });
      expect(await code(service.cancelUnpaid(signedIn, 'o-1'), 409)).toBe('ORDER_NOT_CANCELLABLE');
    });
  });
});
