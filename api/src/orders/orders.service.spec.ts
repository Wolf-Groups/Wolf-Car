import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { mock, mockDeep } from 'jest-mock-extended';
import { authUser } from '../../test/unit/helpers';
import type { AuditTrail } from '../activity/audit-trail.service';
import { OrderLockedException } from '../common/errors';
import { Prisma } from '../generated/prisma/client';
import type { OdooOrdersService } from '../odoo/odoo-orders.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ListOrdersQueryDto } from './dto/orders.dto';
import type { PaymentsService } from '../shop/payments/payments.service';
import { OrdersService } from './orders.service';

const orderRow = (status = 'PENDING') => ({
  id: 'o-1',
  code: 'GH-000001',
  number: 1,
  status,
  customerName: 'Sara',
  total: new Prisma.Decimal('300'),
  currency: 'QAR',
  createdAt: new Date(),
  updatedAt: new Date(),
  confirmedAt: null,
  cancelledAt: null,
  source: 'SHOWROOM',
  paymentStatus: 'NONE',
  paidAt: null,
  customerPhone: null,
  customerEmail: null,
  customerId: null,
  collectedAt: null,
  collectedBy: null,
  payments: [],
  odooOutbox: null,
  branch: { id: 'gh', code: 'GH', name: 'GH', nameAr: 'GH' },
  createdBy: { id: 'm', username: 'gh.manager', displayName: 'M' },
  confirmedBy: null,
  cancelledBy: null,
  _count: { items: 2 },
  items: [
    { id: 'i1', productId: 'p1', productName: 'A', unitPrice: new Prisma.Decimal('100'), quantity: 2, lineTotal: new Prisma.Decimal('200'), product: { imageKey: 'k', barcode: null } },
    { id: 'i2', productId: 'p2', productName: 'B', unitPrice: new Prisma.Decimal('50'), quantity: 2, lineTotal: new Prisma.Decimal('100'), product: { imageKey: 'k', barcode: null } },
  ],
});

/** A paid web order as the detail select will read it (newest payment first). */
const webOrderRow = (over: Record<string, unknown> = {}) => ({
  ...orderRow('CONFIRMED'),
  code: 'BO-000001',
  branch: { id: 'bo', code: 'BO', name: 'Bin Omran', nameAr: 'بن عمران' },
  source: 'WEB',
  paymentStatus: 'PAID',
  paidAt: new Date(),
  customerPhone: '+97455123456',
  customerEmail: 'sara@example.qa',
  customerId: 'c-1',
  payments: [{ id: 'pay-1', status: 'CAPTURED', chargeId: 'chg_1', failureCode: null, refundId: null, amount: new Prisma.Decimal('300'), currency: 'QAR' }],
  ...over,
});

describe('OrdersService', () => {
  const prisma = mockDeep<PrismaService>();
  const trail = mock<AuditTrail>();
  const payments = mock<PaymentsService>();
  const odooOrders = mock<OdooOrdersService>();
  // Task 8 makes these real constructor parameters
  const service = new (OrdersService as unknown as new (...a: unknown[]) => OrdersService)(prisma, trail, payments, odooOrders);
  const cashier = authUser({ role: 'CASHIER', branchId: 'gh' }, ['order.read.branch', 'order.update', 'order.confirm']);
  const admin = authUser({ role: 'SUPER_ADMIN', branchId: null });

  beforeEach(() => {
    jest.resetAllMocks();
    for (const m of ['setEntity', 'setChange', 'setBranch', 'addMetadata'] as const) trail[m].mockReturnValue(trail);
    prisma.$transaction.mockImplementation((arg: unknown) =>
      (typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as unknown[])) as never,
    );
  });

  it('always applies the branch scope to lists, whatever branchId is requested', async () => {
    prisma.order.findMany.mockResolvedValue([]);
    prisma.order.count.mockResolvedValue(0);
    await service.list(cashier, { page: 1, pageSize: 20, branchId: 'bo', status: 'PENDING', orderNumber: 'gh-000042' });
    const where = prisma.order.findMany.mock.calls[0][0]?.where as { AND: unknown[] };
    expect(where.AND).toContainEqual({ branchId: 'gh' });
    expect(where.AND).not.toContainEqual({ branchId: 'bo' });
    expect(where.AND).toContainEqual({ code: 'GH-000042' });
    expect(where.AND).toContainEqual({ status: 'PENDING' });
  });

  it('filters by source when asked (Task 8: ?source=WEB)', async () => {
    prisma.order.findMany.mockResolvedValue([]);
    prisma.order.count.mockResolvedValue(0);
    // ListOrdersQueryDto gains `source` in Task 8
    const query = { page: 1, pageSize: 20, source: 'WEB' } as ListOrdersQueryDto;
    await service.list(cashier, query);
    const where = prisma.order.findMany.mock.calls[0][0]?.where as { AND: unknown[] };
    expect(where.AND).toContainEqual({ source: 'WEB' });
    expect(where.AND).toContainEqual({ branchId: 'gh' });
  });

  it('interprets date-only filters as Qatar calendar days (inclusive)', async () => {
    prisma.order.findMany.mockResolvedValue([]);
    prisma.order.count.mockResolvedValue(0);
    await service.list(admin, { page: 1, pageSize: 20, from: '2026-09-01', to: '2026-09-01' });
    const where = prisma.order.findMany.mock.calls[0][0]?.where as { AND: unknown[] };
    expect(where.AND).toContainEqual({ createdAt: { gte: new Date('2026-08-31T21:00:00.000Z') } });
    expect(where.AND).toContainEqual({ createdAt: { lt: new Date('2026-09-01T21:00:00.000Z') } });
  });

  it('404s for orders outside the scope', async () => {
    prisma.order.findFirst.mockResolvedValue(null);
    await expect(service.get(cashier, 'o-bo')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.order.findFirst.mock.calls[0][0]?.where).toEqual({ AND: [{ id: 'o-bo' }, { branchId: 'gh' }] });
  });

  it('refuses to edit confirmed orders for everyone but the Super Admin', async () => {
    prisma.order.findFirst.mockResolvedValue(orderRow('CONFIRMED') as never);
    await expect(service.update(cashier, 'o-1', { customerName: 'X' })).rejects.toBeInstanceOf(OrderLockedException);
    expect(prisma.order.update).not.toHaveBeenCalled();

    prisma.$queryRaw.mockResolvedValue([{ status: 'CONFIRMED' }] as never);
    await service.update(admin, 'o-1', { customerName: 'X' });
    expect(prisma.order.update).toHaveBeenCalled();
    expect(trail.addMetadata).toHaveBeenCalledWith({ override: true, status: 'CONFIRMED' });
  });

  it('re-checks the status under a row lock (confirm/edit race)', async () => {
    prisma.order.findFirst.mockResolvedValue(orderRow('PENDING') as never);
    prisma.$queryRaw.mockResolvedValue([{ status: 'CONFIRMED' }] as never);
    await expect(service.update(cashier, 'o-1', { customerName: 'X' })).rejects.toBeInstanceOf(OrderLockedException);
  });

  it('recomputes totals from the snapshotted unit prices and removes omitted lines', async () => {
    prisma.order.findFirst.mockResolvedValue(orderRow() as never);
    prisma.$queryRaw.mockResolvedValue([{ status: 'PENDING' }] as never);
    await service.update(cashier, 'o-1', { items: [{ productId: 'p1', quantity: 3 }] });
    expect(prisma.orderItem.deleteMany).toHaveBeenCalledWith({ where: { orderId: 'o-1', productId: { notIn: ['p1'] } } });
    expect((prisma.orderItem.update.mock.calls[0][0].data as { lineTotal: Prisma.Decimal }).lineTotal.toFixed(2)).toBe('300.00');
    expect((prisma.order.update.mock.calls[0][0].data as { total: Prisma.Decimal }).total.toFixed(2)).toBe('300.00');
  });

  it('rejects lines that are not on the order', async () => {
    prisma.order.findFirst.mockResolvedValue(orderRow() as never);
    prisma.$queryRaw.mockResolvedValue([{ status: 'PENDING' }] as never);
    await expect(service.update(cashier, 'o-1', { items: [{ productId: 'new', quantity: 1 }] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('confirms with one conditional update and reports 409 when no longer pending', async () => {
    prisma.order.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.order.findFirst.mockResolvedValue(orderRow('CONFIRMED') as never);
    await service.confirm(cashier, 'o-1');
    expect(prisma.order.updateMany.mock.calls[0][0].where).toEqual({ AND: [{ id: 'o-1' }, { branchId: 'gh' }, { status: { in: ['PENDING'] } }] });
    expect(trail.setChange).toHaveBeenCalledWith({ status: 'PENDING' }, { status: 'CONFIRMED' });

    prisma.order.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.confirm(cashier, 'o-1')).rejects.toBeInstanceOf(OrderLockedException);
  });

  it('lets only the Super Admin cancel a confirmed order', async () => {
    prisma.order.updateMany.mockResolvedValue({ count: 1 });
    // Task 8: the order is read (in the write scope) before the transition, then again after it
    prisma.order.findFirst.mockResolvedValueOnce(orderRow('CONFIRMED') as never).mockResolvedValue(orderRow('CANCELLED') as never);
    await service.cancel(admin, 'o-1');
    expect(prisma.order.updateMany.mock.calls[0][0].where).toEqual({ AND: [{ id: 'o-1' }, {}, { status: { in: ['PENDING', 'CONFIRMED'] } }] });
  });

  describe('web orders', () => {
    const boCashier = authUser({ id: 'u-bo', username: 'bo.cashier', role: 'CASHIER', branchId: 'bo' }, ['order.read.branch', 'order.update', 'order.confirm']);
    const conflict = async (promise: Promise<unknown>, code: string) => {
      const err = await promise.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(409);
      expect(((err as HttpException).getResponse() as { code: string }).code).toBe(code);
    };

    it('cancelling a paid web order refunds the captured attempt first, then cancels it as REFUNDED', async () => {
      prisma.order.findFirst.mockResolvedValue(webOrderRow() as never);
      prisma.payment.findFirst.mockResolvedValue(webOrderRow().payments[0] as never);
      payments.refundForCancel.mockResolvedValue({ refundId: 'rf_1' });
      prisma.order.updateMany.mockResolvedValue({ count: 1 });

      await service.cancel(admin, 'o-1');

      expect(payments.refundForCancel).toHaveBeenCalledWith('o-1', 'Cancelled by ' + admin.username);
      // the order was read in the caller's scope (and its status checked) before any money moved
      expect(JSON.stringify(prisma.order.findFirst.mock.calls[0][0]?.where)).toContain('"id":"o-1"');
      expect(prisma.order.findFirst.mock.invocationCallOrder[0]).toBeLessThan(payments.refundForCancel.mock.invocationCallOrder[0]);
      expect(prisma.order.updateMany).toHaveBeenCalledTimes(1);
      expect(payments.refundForCancel.mock.invocationCallOrder[0]).toBeLessThan(prisma.order.updateMany.mock.invocationCallOrder[0]);
      const call = prisma.order.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ AND: [{ id: 'o-1' }, {}, { status: { in: ['PENDING', 'CONFIRMED'] } }] });
      expect(call.data).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUNDED', cancelledById: admin.id });
      expect(trail.addMetadata).toHaveBeenCalledWith(expect.objectContaining({ refundId: 'rf_1' }));
    });

    it('a failed refund leaves the order untouched', async () => {
      prisma.order.findFirst.mockResolvedValue(webOrderRow() as never);
      prisma.payment.findFirst.mockResolvedValue(webOrderRow().payments[0] as never);
      const refused = new HttpException({ statusCode: 502, error: 'Bad Gateway', code: 'REFUND_FAILED', message: 'Tap refused the refund.' }, 502);
      payments.refundForCancel.mockRejectedValue(refused);
      prisma.order.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.cancel(admin, 'o-1')).rejects.toBe(refused);
      expect(payments.refundForCancel).toHaveBeenCalledTimes(1);
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('an attempt that was already refunded is not refunded again', async () => {
      const refunded = { ...webOrderRow().payments[0], refundId: 'rf_0' };
      prisma.order.findFirst.mockResolvedValue(webOrderRow({ paymentStatus: 'REFUNDED', payments: [refunded] }) as never);
      prisma.payment.findFirst.mockResolvedValue(null);
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      await service.cancel(admin, 'o-1');
      expect(payments.refundForCancel).not.toHaveBeenCalled();
    });

    it('who may cancel is unchanged: a cashier cannot cancel a confirmed paid web order, and no money moves', async () => {
      prisma.order.findFirst.mockResolvedValue(webOrderRow() as never);
      prisma.payment.findFirst.mockResolvedValue(webOrderRow().payments[0] as never);
      prisma.order.updateMany.mockResolvedValue({ count: 0 });
      payments.refundForCancel.mockResolvedValue({ refundId: 'rf_1' });
      await expect(service.cancel(boCashier, 'o-1')).rejects.toBeInstanceOf(OrderLockedException);
      expect(payments.refundForCancel).not.toHaveBeenCalled();
    });

    it('the cashier cancels a pending web order with a captured AMOUNT_MISMATCH attempt: refunded first, then CANCELLED as REFUNDED', async () => {
      const mismatch = { ...webOrderRow().payments[0], failureCode: 'AMOUNT_MISMATCH' };
      const pending = webOrderRow({ status: 'PENDING', paymentStatus: 'PENDING', paidAt: null, payments: [mismatch] });
      prisma.order.findFirst.mockResolvedValueOnce(pending as never).mockResolvedValue(webOrderRow({ status: 'CANCELLED', paymentStatus: 'REFUNDED', paidAt: null }) as never);
      prisma.payment.findFirst.mockResolvedValue(mismatch as never);
      payments.refundForCancel.mockResolvedValue({ refundId: 'rf_2' });
      prisma.order.updateMany.mockResolvedValue({ count: 1 });

      await service.cancel(boCashier, 'o-1');

      expect(payments.refundForCancel).toHaveBeenCalledWith('o-1', 'Cancelled by bo.cashier');
      expect(payments.refundForCancel.mock.invocationCallOrder[0]).toBeLessThan(prisma.order.updateMany.mock.invocationCallOrder[0]);
      const call = prisma.order.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ AND: [{ id: 'o-1' }, { branchId: 'bo' }, { status: { in: ['PENDING'] } }] });
      expect(call.data).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUNDED', cancelledById: 'u-bo' });
    });

    it('an order already CANCELLED is locked before any refund (a duplicate capture after a refund is refunded in Tap)', async () => {
      const duplicate = { ...webOrderRow().payments[0], id: 'pay-2', chargeId: 'chg_2', failureCode: 'DUPLICATE_CAPTURE' };
      prisma.order.findFirst.mockResolvedValue(webOrderRow({ status: 'CANCELLED', paymentStatus: 'REFUNDED', payments: [duplicate] }) as never);
      prisma.payment.findFirst.mockResolvedValue(duplicate as never);
      prisma.order.updateMany.mockResolvedValue({ count: 0 });
      payments.refundForCancel.mockResolvedValue({ refundId: 'rf_3' });
      await expect(service.cancel(admin, 'o-1')).rejects.toBeInstanceOf(OrderLockedException);
      expect(payments.refundForCancel).not.toHaveBeenCalled();
    });

    it('an order outside the branch is 404 and no money moves', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.payment.findFirst.mockResolvedValue(webOrderRow().payments[0] as never);
      prisma.order.updateMany.mockResolvedValue({ count: 0 });
      payments.refundForCancel.mockResolvedValue({ refundId: 'rf_1' });
      await expect(service.cancel(cashier, 'o-bo')).rejects.toBeInstanceOf(NotFoundException);
      expect(payments.refundForCancel).not.toHaveBeenCalled();
      // the read that found nothing was the caller's branch scope
      const read = JSON.stringify(prisma.order.findFirst.mock.calls[0][0]?.where);
      expect(read).toContain('"id":"o-bo"');
      expect(read).toContain('"branchId":"gh"');
    });

    it('a showroom order is cancelled without asking the gateway', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      prisma.order.findFirst.mockResolvedValueOnce(orderRow('PENDING') as never).mockResolvedValue(orderRow('CANCELLED') as never);
      await service.cancel(cashier, 'o-1');
      expect(payments.refundForCancel).not.toHaveBeenCalled();
      expect(prisma.order.updateMany).toHaveBeenCalledTimes(1);
    });

    it('cannot be edited by staff: 409 WEB_ORDER_READONLY', async () => {
      prisma.order.findFirst.mockResolvedValue(webOrderRow({ status: 'PENDING', paymentStatus: 'PENDING', payments: [] }) as never);
      prisma.$queryRaw.mockResolvedValue([{ status: 'PENDING' }] as never);
      await conflict(service.update(boCashier, 'o-1', { customerName: 'X' }), 'WEB_ORDER_READONLY');
      await conflict(service.update(admin, 'o-1', { items: [{ productId: 'p1', quantity: 1 }] }), 'WEB_ORDER_READONLY');
      expect(prisma.order.update).not.toHaveBeenCalled();
      expect(prisma.orderItem.update).not.toHaveBeenCalled();
    });

    it('the read-only check comes before the status check (a confirmed web order is WEB_ORDER_READONLY, not ORDER_NOT_PENDING)', async () => {
      prisma.order.findFirst.mockResolvedValue(webOrderRow() as never);
      await conflict(service.update(boCashier, 'o-1', { customerName: 'X' }), 'WEB_ORDER_READONLY');
    });

    it('cannot be confirmed by staff: 409 WEB_ORDER_UNPAID', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 0 });
      prisma.order.findFirst.mockResolvedValue(webOrderRow({ status: 'PENDING', paymentStatus: 'PENDING', payments: [] }) as never);
      await conflict(service.confirm(boCashier, 'o-1'), 'WEB_ORDER_UNPAID');
      // either no update ran, or the one that ran excludes web orders (a real database would otherwise confirm it)
      for (const [args] of prisma.order.updateMany.mock.calls) {
        expect(JSON.stringify(args?.where)).toMatch(/"source":(?:"SHOWROOM"|\{"not":"WEB"\}|\{"in":\["SHOWROOM"\]\}|\{"notIn":\["WEB"\]\})/);
      }
      expect(trail.setChange).not.toHaveBeenCalledWith({ status: 'PENDING' }, { status: 'CONFIRMED' });
    });

    it('collect: one conditional update marks a paid web order handed over', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      prisma.order.findFirst.mockResolvedValue(webOrderRow({ collectedAt: new Date() }) as never);
      await service.collect(boCashier, 'o-1');
      const call = prisma.order.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'o-1', branchId: 'bo', source: 'WEB', paymentStatus: 'PAID', status: 'CONFIRMED', collectedAt: null });
      expect(call.data).toEqual({ collectedAt: expect.any(Date) as Date, collectedById: 'u-bo' });
      expect(trail.setEntity).toHaveBeenCalledWith('Order', 'o-1');
    });

    it('collect: 409 ORDER_NOT_COLLECTABLE for a showroom order, 404 outside the branch', async () => {
      prisma.order.updateMany.mockResolvedValue({ count: 0 });
      prisma.order.findFirst.mockResolvedValue(orderRow('CONFIRMED') as never);
      await conflict(service.collect(cashier, 'o-1'), 'ORDER_NOT_COLLECTABLE');

      prisma.order.findFirst.mockResolvedValue(null);
      await expect(service.collect(cashier, 'o-bo')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
