import { Logger, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { mock, mockDeep } from 'jest-mock-extended';
import type { Env } from '../config/env';
import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { OdooClient } from './odoo-client';
import { OdooOrdersService } from './odoo-orders.service';
import { nextAttemptAt, OdooMappingError, partnerDomain, partnerValues, saleOrderValues } from './odoo-sale-order';
import type { OdooWriter } from './odoo-writer';

// The mapping functions are stubs until Task 9 lands; OdooMappingError is a real class and stays real.
jest.mock('./odoo-sale-order', () => ({
  ...jest.requireActual<typeof import('./odoo-sale-order')>('./odoo-sale-order'),
  partnerDomain: jest.fn(),
  partnerValues: jest.fn(),
  saleOrderValues: jest.fn(),
  nextAttemptAt: jest.fn(),
}));

/** The test decides what the writing connection is; the real one reads ODOO_WRITE_* from the environment. */
class TestableOdooOrdersService extends OdooOrdersService {
  fakeWriter: OdooWriter | null = null;

  protected override writer(): OdooWriter | null {
    return this.fakeWriter;
  }
}

/** The real writer(), reachable from a test. */
class ExposedWriter extends OdooOrdersService {
  w(): OdooWriter | null {
    return this.writer();
  }
}

/** Every Odoo setting present: the read-only sync user and the dedicated sales (write) user. */
const cfg = (o: Record<string, unknown>) =>
  ({
    get: (k: string) =>
      ({
        NODE_ENV: 'test',
        ODOO_URL: 'https://odoo.test',
        ODOO_DB: 'db1',
        ODOO_LOGIN: 'reader',
        ODOO_API_KEY: 'read-key',
        ODOO_WRITE_LOGIN: 'sales@wolfcar.qa',
        ODOO_WRITE_API_KEY: 'write-key',
        ...o,
      })[k],
  }) as unknown as ConfigService<Env, true>;

const outboxRow = (over: Record<string, unknown> = {}) => ({
  id: 'ob-1',
  orderId: 'o-1',
  status: 'PENDING',
  attempts: 0,
  nextAttemptAt: new Date('2026-10-18T10:05:00.000Z'),
  lastError: null,
  odooPartnerId: null,
  odooSaleOrderId: null,
  createdAt: new Date('2026-10-18T10:05:00.000Z'),
  updatedAt: new Date('2026-10-18T10:05:00.000Z'),
  ...over,
});

const orderRow = () => ({
  id: 'o-1',
  code: 'BO-000001',
  customerName: 'Sara Al Thani',
  customerPhone: '+97455123456',
  customerEmail: 'sara@example.qa',
  total: new Prisma.Decimal('619.50'),
  currency: 'QAR',
  paidAt: new Date('2026-10-18T10:05:00.000Z'),
  items: [
    { productName: 'Dash Cam', quantity: 1, unitPrice: new Prisma.Decimal('499.00'), product: { odooId: 11 } },
    { productName: 'Floor Mats', quantity: 1, unitPrice: new Prisma.Decimal('120.50'), product: { odooId: null } },
  ],
  payments: [{ id: 'pay-1', chargeId: 'chg_1', status: 'CAPTURED', amount: new Prisma.Decimal('619.50'), currency: 'QAR' }],
});

describe('OdooOrdersService', () => {
  const prisma = mockDeep<PrismaService>();
  const config = { get: (key: string) => ({ NODE_ENV: 'test' })[key] } as unknown as ConfigService<Env, true>;
  const service = new TestableOdooOrdersService(prisma, config);
  const writer = mock<OdooWriter>();

  const outboxWrites = () =>
    [...prisma.odooOutbox.update.mock.calls, ...prisma.odooOutbox.updateMany.mock.calls].map((c) => c[0] as { where: Record<string, unknown>; data: Record<string, unknown> });
  const lastWrite = () => outboxWrites().at(-1)?.data ?? {};
  const near = (value: unknown, expectedMs: number) => {
    expect(value).toBeInstanceOf(Date);
    expect(Math.abs((value as Date).getTime() - expectedMs)).toBeLessThanOrEqual(2_000);
  };

  beforeEach(() => {
    jest.resetAllMocks();
    service.fakeWriter = writer;
    jest.mocked(partnerDomain).mockReturnValue(['dom']);
    jest.mocked(partnerValues).mockReturnValue({ name: 'Sara Al Thani' });
    jest.mocked(saleOrderValues).mockReturnValue({ partner_id: 7, client_order_ref: 'BO-000001' });
    jest.mocked(nextAttemptAt).mockImplementation((attempts: number, now: Date) => (attempts >= 24 ? null : new Date(now.getTime() + 60_000)));
    prisma.$transaction.mockImplementation((arg: unknown) =>
      (typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as unknown[])) as never,
    );
    const row = outboxRow();
    prisma.odooOutbox.findUnique.mockResolvedValue({ ...row, order: orderRow() } as never);
    prisma.odooOutbox.findUniqueOrThrow.mockResolvedValue({ ...row, order: orderRow() } as never);
    prisma.odooOutbox.findFirst.mockResolvedValue({ ...row, order: orderRow() } as never);
    prisma.odooOutbox.update.mockResolvedValue(row as never);
    prisma.odooOutbox.updateMany.mockResolvedValue({ count: 1 });
    prisma.order.findUnique.mockResolvedValue(orderRow() as never);
    prisma.order.findUniqueOrThrow.mockResolvedValue(orderRow() as never);
    prisma.order.findFirst.mockResolvedValue(orderRow() as never);
    prisma.payment.findFirst.mockResolvedValue(orderRow().payments[0] as never);
    writer.searchRead.mockResolvedValue([]);
    writer.create.mockResolvedValueOnce(7).mockResolvedValueOnce(42);
    writer.call.mockResolvedValue(true as never);
  });

  describe('enqueue', () => {
    it('upserts the outbox row of the order as PENDING, due now', async () => {
      const tx = mockDeep<PrismaService>();
      const before = Date.now();
      await service.enqueue(tx as never, 'o-1');
      const upsert = tx.odooOutbox.upsert.mock.calls[0][0];
      expect(upsert.where).toEqual({ orderId: 'o-1' });
      expect(upsert.create).toMatchObject({ orderId: 'o-1', status: 'PENDING' });
      // Plan Task 6: create only; a row that exists (DONE, FAILED or PENDING) is left as it is.
      expect(upsert.update).toEqual({});
      near((upsert.create as { nextAttemptAt: Date }).nextAttemptAt, before);
    });
  });

  describe('processOne', () => {
    it('finds or creates the partner, creates and confirms the sale order, and marks the row DONE', async () => {
      await service.processOne('ob-1');

      expect(writer.searchRead.mock.calls[0].slice(0, 3)).toEqual(['res.partner', ['dom'], ['id']]);
      expect(partnerDomain).toHaveBeenCalledWith('+97455123456');
      expect(writer.create).toHaveBeenNthCalledWith(1, 'res.partner', { name: 'Sara Al Thani' });
      expect(saleOrderValues).toHaveBeenCalledTimes(1);
      expect(jest.mocked(saleOrderValues).mock.calls[0][0]).toMatchObject({
        id: 'o-1',
        code: 'BO-000001',
        customerPhone: '+97455123456',
        total: '619.50',
        chargeId: 'chg_1',
        items: [
          { productName: 'Dash Cam', quantity: 1, unitPrice: '499.00', odooId: 11 },
          { productName: 'Floor Mats', quantity: 1, unitPrice: '120.50', odooId: null },
        ],
      });
      expect(jest.mocked(saleOrderValues).mock.calls[0][1]).toBe(7);
      // nothing configured: no warehouse and no fallback product reach the mapping
      expect(jest.mocked(saleOrderValues).mock.calls[0][2] ?? {}).toEqual({});
      expect(writer.create).toHaveBeenNthCalledWith(2, 'sale.order', { partner_id: 7, client_order_ref: 'BO-000001' });
      expect(writer.call.mock.calls[0].slice(0, 3)).toEqual(['sale.order', 'action_confirm', [42]]);

      expect(lastWrite()).toMatchObject({ status: 'DONE', odooPartnerId: 7, odooSaleOrderId: 42 });
      expect(outboxWrites().at(-1)?.where).toMatchObject({ id: 'ob-1' });
    });

    it('reuses an existing partner', async () => {
      writer.searchRead.mockResolvedValue([{ id: 5 }]);
      writer.create.mockReset().mockResolvedValueOnce(42);
      await service.processOne('ob-1');
      expect(writer.create).toHaveBeenCalledTimes(1);
      expect(writer.create).toHaveBeenCalledWith('sale.order', expect.anything());
      expect(jest.mocked(saleOrderValues).mock.calls[0][1]).toBe(5);
      expect(lastWrite()).toMatchObject({ status: 'DONE', odooPartnerId: 5, odooSaleOrderId: 42 });
    });

    it('passes the configured warehouse and fallback product to the mapping', async () => {
      const configured = { get: (k: string) => ({ NODE_ENV: 'test', ODOO_WEB_WAREHOUSE_ID: 3, ODOO_FALLBACK_PRODUCT_ID: 99 })[k] } as unknown as ConfigService<Env, true>;
      const s = new TestableOdooOrdersService(prisma, configured);
      s.fakeWriter = writer;
      await s.processOne('ob-1');
      expect(jest.mocked(saleOrderValues).mock.calls[0][2]).toEqual({ warehouseId: 3, fallbackProductId: 99 });
    });

    it('measures the backoff and the no-writer wait from the given now', async () => {
      const at = new Date('2026-10-18T12:00:00.000Z');
      writer.create.mockReset().mockRejectedValue(new Error('boom'));
      await service.processOne('ob-1', at);
      expect(nextAttemptAt).toHaveBeenCalledWith(1, at);
      expect(lastWrite().nextAttemptAt).toEqual(new Date(at.getTime() + 60_000));
      service.fakeWriter = null;
      await service.processOne('ob-1', at);
      expect(lastWrite().nextAttemptAt).toEqual(new Date(at.getTime() + 60 * 60_000));
    });

    it('waits an hour with ODOO_WRITE_NOT_CONFIGURED when there is no writing connection', async () => {
      service.fakeWriter = null;
      const before = Date.now();
      await service.processOne('ob-1');
      const data = lastWrite();
      expect(data.lastError).toBe('ODOO_WRITE_NOT_CONFIGURED');
      expect([undefined, 0]).toContain(data.attempts);
      expect(data.status ?? 'PENDING').toBe('PENDING');
      near(data.nextAttemptAt, before + 60 * 60_000);
      expect(writer.create).not.toHaveBeenCalled();
    });

    it('backs off after an error, keeping the message', async () => {
      writer.create.mockReset().mockRejectedValue(new Error('boom'));
      const before = Date.now();
      await service.processOne('ob-1');
      const data = lastWrite();
      expect(data).toMatchObject({ attempts: 1, lastError: 'boom' });
      expect(data.status ?? 'PENDING').toBe('PENDING');
      expect(nextAttemptAt).toHaveBeenCalledWith(1, expect.any(Date));
      near(data.nextAttemptAt, before + 60_000);
    });

    it('gives up (FAILED) when the last allowed attempt fails', async () => {
      const row = { ...outboxRow({ attempts: 23 }), order: orderRow() };
      prisma.odooOutbox.findUnique.mockResolvedValue(row as never);
      prisma.odooOutbox.findUniqueOrThrow.mockResolvedValue(row as never);
      prisma.odooOutbox.findFirst.mockResolvedValue(row as never);
      writer.create.mockReset().mockRejectedValue(new Error('boom'));
      await service.processOne('ob-1');
      expect(nextAttemptAt).toHaveBeenCalledWith(24, expect.any(Date));
      expect(lastWrite()).toMatchObject({ attempts: 24, status: 'FAILED', lastError: 'boom' });
    });

    it('keeps the API key out of lastError and cuts it at 600 characters', async () => {
      const keyedConfig = {
        get: (key: string) => ({ NODE_ENV: 'test', ODOO_WRITE_LOGIN: 'sales@wolfcar.qa', ODOO_WRITE_API_KEY: 'write-secret-key' })[key],
      } as unknown as ConfigService<Env, true>;
      const keyed = new TestableOdooOrdersService(prisma, keyedConfig);
      keyed.fakeWriter = writer;
      writer.create.mockReset().mockRejectedValue(new Error(`Odoo error: Access Denied for write-secret-key ${'x'.repeat(1000)}`));
      await keyed.processOne('ob-1');
      const lastError = String(lastWrite().lastError);
      expect(lastError).toMatch(/^Odoo error: Access Denied/);
      expect(lastError).not.toContain('write-secret-key');
      expect(lastError.length).toBeLessThanOrEqual(600);
    });

    it('never sells a refunded order in Odoo: the row fails with ORDER_REFUNDED, Odoo untouched', async () => {
      // a cancel that lost the race with settle refunded the card after the order was queued
      const row = { ...outboxRow({ attempts: 2 }), order: { ...orderRow(), paymentStatus: 'REFUNDED' } };
      prisma.odooOutbox.findUnique.mockResolvedValue(row as never);
      await service.processOne('ob-1');
      expect(lastWrite()).toEqual({ status: 'FAILED', lastError: 'ORDER_REFUNDED' });
      expect(writer.searchRead).not.toHaveBeenCalled();
      expect(writer.create).not.toHaveBeenCalled();
      expect(writer.call).not.toHaveBeenCalled();
    });

    it('stores the sale order as soon as Odoo creates it, so a failed confirmation keeps it', async () => {
      writer.call.mockRejectedValue(new Error('confirm refused'));
      await service.processOne('ob-1');
      expect(outboxWrites().map((w) => w.data)).toEqual([
        { odooPartnerId: 7, odooSaleOrderId: 42 },
        expect.objectContaining({ attempts: 1, lastError: 'confirm refused' }),
      ]);
    });

    it('a later try confirms the sale order it already created instead of creating another', async () => {
      const row = { ...outboxRow({ attempts: 1, odooPartnerId: 7, odooSaleOrderId: 42 }), order: orderRow() };
      prisma.odooOutbox.findUnique.mockResolvedValue(row as never);
      writer.searchRead.mockResolvedValue([{ state: 'draft' }]);
      await service.processOne('ob-1');
      expect(writer.searchRead.mock.calls[0].slice(0, 3)).toEqual(['sale.order', [['id', '=', 42]], ['state']]);
      expect(writer.create).not.toHaveBeenCalled();
      expect(writer.call.mock.calls[0].slice(0, 3)).toEqual(['sale.order', 'action_confirm', [42]]);
      expect(lastWrite()).toMatchObject({ status: 'DONE', odooPartnerId: 7, odooSaleOrderId: 42, lastError: null });
    });

    it('does not confirm twice a sale order an earlier try already confirmed', async () => {
      const row = { ...outboxRow({ attempts: 1, odooPartnerId: 7, odooSaleOrderId: 42 }), order: orderRow() };
      prisma.odooOutbox.findUnique.mockResolvedValue(row as never);
      writer.searchRead.mockResolvedValue([{ state: 'sale' }]);
      await service.processOne('ob-1');
      expect(writer.create).not.toHaveBeenCalled();
      expect(writer.call).not.toHaveBeenCalled();
      expect(lastWrite()).toMatchObject({ status: 'DONE', odooSaleOrderId: 42 });
    });

    it('leaves a row that is no longer PENDING alone', async () => {
      prisma.odooOutbox.findUnique.mockResolvedValue({ ...outboxRow({ status: 'DONE' }), order: orderRow() } as never);
      await service.processOne('ob-1');
      expect(outboxWrites()).toHaveLength(0);
      expect(writer.searchRead).not.toHaveBeenCalled();
    });

    it('fails for good when a product is not in Odoo', async () => {
      jest.mocked(saleOrderValues).mockImplementation(() => {
        throw new OdooMappingError('PRODUCT_NOT_IN_ODOO', ['Floor Mats']);
      });
      await service.processOne('ob-1');
      const data = lastWrite();
      expect(data.status).toBe('FAILED');
      expect(String(data.lastError)).toMatch(/^PRODUCT_NOT_IN_ODOO/);
      expect(String(data.lastError)).toContain('Floor Mats');
      expect(writer.call).not.toHaveBeenCalled();
    });
  });

  describe('processDue', () => {
    afterEach(() => jest.restoreAllMocks());

    it('tries up to 20 due PENDING rows, oldest first, one at a time, and answers how many', async () => {
      const now = new Date('2026-10-18T11:00:00.000Z');
      prisma.odooOutbox.findMany.mockResolvedValue([outboxRow({ id: 'ob-1' }), outboxRow({ id: 'ob-2' })] as never);
      const seen: string[] = [];
      let active = 0;
      let maxActive = 0;
      jest.spyOn(service, 'processOne').mockImplementation(async (id: string) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        seen.push(id);
        await new Promise((r) => setImmediate(r));
        active -= 1;
      });

      expect(await service.processDue(now)).toBe(2);

      const args = prisma.odooOutbox.findMany.mock.calls[0][0];
      expect(args?.where).toMatchObject({ status: 'PENDING', nextAttemptAt: { lte: now } });
      expect(args?.take).toBe(20);
      expect(JSON.stringify(args?.orderBy)).toMatch(/"(nextAttemptAt|createdAt)":"asc"/);
      expect(seen).toEqual(['ob-1', 'ob-2']);
      // every row's backoff is measured from the tick's own now
      expect(service.processOne).toHaveBeenNthCalledWith(1, 'ob-1', now);
      expect(service.processOne).toHaveBeenNthCalledWith(2, 'ob-2', now);
      expect(maxActive).toBe(1);
    });

    it('never runs two ticks at once', async () => {
      prisma.odooOutbox.findMany.mockResolvedValue([outboxRow()] as never);
      let release: () => void = () => undefined;
      jest.spyOn(service, 'processOne').mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      const first = service.processDue();
      await new Promise((r) => setImmediate(r));
      expect(await service.processDue()).toBe(0);
      release();
      expect(await first).toBe(1);
      expect(prisma.odooOutbox.findMany).toHaveBeenCalledTimes(1);
    });

    it('keeps ticking after a row throws', async () => {
      prisma.odooOutbox.findMany.mockResolvedValue([outboxRow()] as never);
      const one = jest.spyOn(service, 'processOne').mockRejectedValueOnce(new Error('db down')).mockResolvedValue(undefined);
      await service.processDue().catch(() => undefined);
      expect(await service.processDue()).toBe(1);
      expect(one).toHaveBeenCalledTimes(2);
    });
  });

  describe('retry', () => {
    it('puts the row back to PENDING, due now, with the error cleared', async () => {
      const before = Date.now();
      await service.retry('o-1');
      const write = outboxWrites().at(-1);
      expect(write?.where).toEqual({ orderId: 'o-1' });
      expect(write?.data).toMatchObject({ status: 'PENDING', lastError: null });
      near(write?.data.nextAttemptAt, before);
    });

    it('is 404 when the order has no outbox row', async () => {
      prisma.odooOutbox.findUnique.mockResolvedValue(null);
      prisma.odooOutbox.findFirst.mockResolvedValue(null);
      prisma.odooOutbox.updateMany.mockResolvedValue({ count: 0 });
      prisma.odooOutbox.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('No record', { code: 'P2025', clientVersion: 'test' }));
      await expect(service.retry('o-9')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('leaves a row Odoo already took as it is', async () => {
      prisma.odooOutbox.findUnique.mockResolvedValue(outboxRow({ status: 'DONE', odooSaleOrderId: 42 }) as never);
      await service.retry('o-1');
      expect(outboxWrites()).toHaveLength(0);
    });
  });

  describe('statusFor', () => {
    it('maps the row for the order detail', async () => {
      prisma.odooOutbox.findUnique.mockResolvedValue(
        outboxRow({ status: 'DONE', odooSaleOrderId: 42, odooPartnerId: 7, attempts: 1, nextAttemptAt: new Date('2026-10-18T10:06:00.000Z') }) as never,
      );
      expect(await service.statusFor('o-1')).toEqual({ status: 'DONE', saleOrderId: 42, attempts: 1, lastError: null, nextAttemptAt: '2026-10-18T10:06:00.000Z' });
      expect(prisma.odooOutbox.findUnique.mock.calls[0][0].where).toEqual({ orderId: 'o-1' });
    });

    it('has no next attempt once the row FAILED', async () => {
      prisma.odooOutbox.findUnique.mockResolvedValue(outboxRow({ status: 'FAILED', attempts: 24, lastError: 'boom' }) as never);
      expect(await service.statusFor('o-1')).toEqual({ status: 'FAILED', saleOrderId: null, attempts: 24, lastError: 'boom', nextAttemptAt: null });
    });

    it('is null for an order that was never queued (showroom orders)', async () => {
      prisma.odooOutbox.findUnique.mockResolvedValue(null);
      expect(await service.statusFor('o-2')).toBeNull();
    });
  });

  describe('writer', () => {
    it('is an Odoo client when the URL, database and write user are all set', () => {
      expect(new ExposedWriter(prisma, cfg({})).w()).toBeInstanceOf(OdooClient);
    });

    it('is null when any of ODOO_URL, ODOO_DB, ODOO_WRITE_LOGIN or ODOO_WRITE_API_KEY is missing', () => {
      for (const k of ['ODOO_URL', 'ODOO_DB', 'ODOO_WRITE_LOGIN', 'ODOO_WRITE_API_KEY']) expect(new ExposedWriter(prisma, cfg({ [k]: undefined })).w()).toBeNull();
    });

    it('logs in with the sales user, not the read-only one', async () => {
      const text = (body: unknown): string => (typeof body === 'string' ? body : '');
      const urlOf = (input: string | URL | Request): string => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        const body = JSON.parse(text(init?.body)) as { params: { service: string } };
        return new Response(JSON.stringify({ result: body.params.service === 'common' ? 9 : [] }));
      });
      try {
        await new ExposedWriter(prisma, cfg({})).w()?.searchRead('res.partner', [], ['id']);
        const bodies = fetchSpy.mock.calls.map((c) => JSON.parse(text(c[1]?.body)) as { params: { args: unknown[] } });
        expect(urlOf(fetchSpy.mock.calls[0][0])).toBe('https://odoo.test/jsonrpc');
        expect(bodies[0].params.args.slice(0, 3)).toEqual(['db1', 'sales@wolfcar.qa', 'write-key']);
        expect(bodies[1].params.args.slice(0, 3)).toEqual(['db1', 9, 'write-key']);
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  describe('timer', () => {
    it('ticks every minute outside tests and stops on destroy', () => {
      const unref = jest.fn();
      const set = jest.spyOn(global, 'setInterval').mockReturnValue({ unref } as unknown as NodeJS.Timeout);
      const clear = jest.spyOn(global, 'clearInterval').mockImplementation(() => undefined);
      try {
        const prod = new TestableOdooOrdersService(prisma, { get: (k: string) => ({ NODE_ENV: 'production' })[k] } as unknown as ConfigService<Env, true>);
        prod.onModuleInit();
        expect(set).toHaveBeenCalledWith(expect.any(Function), 60_000);
        expect(unref).toHaveBeenCalled();
        prod.onModuleDestroy();
        expect(clear).toHaveBeenCalled();
      } finally {
        set.mockRestore();
        clear.mockRestore();
      }
    });

    it('a tick that fails, at once or later, is logged without the key and never thrown', async () => {
      const keyed = { get: (k: string) => ({ NODE_ENV: 'production', ODOO_WRITE_API_KEY: 'write-secret-key' })[k] } as unknown as ConfigService<Env, true>;
      const set = jest.spyOn(global, 'setInterval').mockReturnValue({ unref: jest.fn() } as unknown as NodeJS.Timeout);
      const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      try {
        const prod = new TestableOdooOrdersService(prisma, keyed);
        prod.onModuleInit();
        const tick = set.mock.calls[0][0] as () => void;

        jest.spyOn(prod, 'processDue').mockRejectedValueOnce(new Error('db down for write-secret-key'));
        expect(() => tick()).not.toThrow();
        await new Promise((r) => setImmediate(r));
        expect(logged).toHaveBeenCalledTimes(1);
        expect(String(logged.mock.calls[0][0])).toContain('db down');
        expect(String(logged.mock.calls[0][0])).not.toContain('write-secret-key');

        jest.spyOn(prod, 'processDue').mockImplementationOnce(() => {
          throw new Error('sync failure');
        });
        expect(() => tick()).not.toThrow();
        expect(String(logged.mock.calls[1][0])).toContain('sync failure');
        prod.onModuleDestroy();
      } finally {
        set.mockRestore();
        logged.mockRestore();
      }
    });

    it('does not start a timer under NODE_ENV=test', () => {
      const set = jest.spyOn(global, 'setInterval');
      try {
        service.onModuleInit();
        expect(set).not.toHaveBeenCalled();
        service.onModuleDestroy();
      } finally {
        set.mockRestore();
      }
    });
  });
});
