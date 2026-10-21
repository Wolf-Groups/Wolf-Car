import { HttpException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { mock, mockDeep } from 'jest-mock-extended';
import type { AuditTrail } from '../../activity/audit-trail.service';
import type { Env } from '../../config/env';
import { Prisma } from '../../generated/prisma/client';
import type { OdooOrdersService } from '../../odoo/odoo-orders.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { WebOrderRow } from '../checkout/web-order.view';
import { ensureSystemWebUser } from '../checkout/system-web-user';
import type { CustomerPrincipal } from '../customers/customers.service';
import { type PaymentGateway, PaymentGatewayError } from './payment-gateway';
import { PaymentsService } from './payments.service';
import { chargeOutcome, FAILED_STATUSES, formatTapAmount, sameAmount, type TapCharge } from './tap-charge';
import { verifyTapSignature } from './tap-signature';

// The pure helpers are stubs until Task 2 lands; the service's decision table is pinned against their contract.
jest.mock('./tap-charge', () => ({
  FAILED_STATUSES: ['DECLINED', 'FAILED', 'CANCELLED', 'ABANDONED', 'RESTRICTED', 'TIMEDOUT', 'VOID', 'UNKNOWN'],
  chargeOutcome: jest.fn(),
  formatTapAmount: jest.fn(),
  sameAmount: jest.fn(),
}));
jest.mock('./tap-signature', () => ({ tapHashString: jest.fn(), signTapCharge: jest.fn(), verifyTapSignature: jest.fn() }));
jest.mock('../checkout/system-web-user', () => ({ SYSTEM_WEB_USERNAME: 'system.web', ensureSystemWebUser: jest.fn() }));

const customer: CustomerPrincipal = { id: 'c-1', phone: '+97455123456', name: 'Sara Al Thani', email: 'sara@example.qa', sessionVersion: 1 };

const webRow = (over: Partial<WebOrderRow> = {}): WebOrderRow => ({
  id: 'o-1',
  code: 'BO-000001',
  status: 'PENDING',
  paymentStatus: 'PENDING',
  total: new Prisma.Decimal('619.50'),
  currency: 'QAR',
  createdAt: new Date('2026-10-18T10:00:00.000Z'),
  expiresAt: new Date(Date.now() + 20 * 60_000),
  paidAt: null,
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

const paymentRow = (over: Record<string, unknown> = {}) => ({
  id: 'pay-1',
  orderId: 'o-1',
  provider: 'tap',
  chargeId: 'chg_1',
  status: 'INITIATED',
  amount: new Prisma.Decimal('619.50'),
  currency: 'QAR',
  failureCode: null,
  rawLast: null,
  refundId: null,
  refundedAt: null,
  createdAt: new Date('2026-10-18T10:01:00.000Z'),
  updatedAt: new Date('2026-10-18T10:01:00.000Z'),
  ...over,
});

const charge = (over: Partial<TapCharge> = {}): TapCharge => ({
  id: 'chg_1',
  object: 'charge',
  status: 'CAPTURED',
  amount: 619.5,
  currency: 'QAR',
  reference: { order: 'BO-000001', idempotent: 'pay-1', gateway: 'g1', payment: 'p1' },
  transaction: { created: '1760781600000', url: 'https://tap.test/3ds' },
  metadata: { orderId: 'o-1', paymentId: 'pay-1' },
  ...over,
});

describe('PaymentsService', () => {
  const prisma = mockDeep<PrismaService>();
  const trail = mock<AuditTrail>();
  const gateway = mock<PaymentGateway>();
  const odooOrders = mock<OdooOrdersService>();
  const config = {
    get: (key: string) => ({ WEB_PUBLIC_URL: 'https://wolfcar.qa', API_PUBLIC_URL: 'https://wolfcar.qa', TAP_SECRET_KEY: 'sk_test_x', PAYMENTS_PROVIDER: 'tap' })[key],
  } as unknown as ConfigService<Env, true>;
  const service = new PaymentsService(prisma, config, trail, gateway, odooOrders);

  /** The order as every read path may see it: a plain fetch, a nested include on the payment, or the FOR UPDATE lock. */
  const setOrder = (row: WebOrderRow, payment: ReturnType<typeof paymentRow> | null = paymentRow()) => {
    const orderRow = { ...row, branchId: row.branch.id };
    prisma.order.findFirst.mockResolvedValue(orderRow as never);
    prisma.order.findUnique.mockResolvedValue(orderRow as never);
    prisma.order.findUniqueOrThrow.mockResolvedValue(orderRow as never);
    prisma.$queryRaw.mockResolvedValue([orderRow] as never);
    prisma.payment.findUnique.mockResolvedValue((payment ? { ...payment, order: orderRow } : null) as never);
    prisma.payment.findFirst.mockResolvedValue((payment ? { ...payment, order: orderRow } : null) as never);
  };

  const paymentWrites = () => prisma.payment.update.mock.calls.map((c) => c[0].data as Record<string, unknown>);
  const orderWrites = () => prisma.order.update.mock.calls.map((c) => c[0].data as Record<string, unknown>);
  /** Payment writes that change more than the stored charge object (status, failure code, refund): a CAPTURED payment never gets one again. */
  const paymentStateWrites = () =>
    [...prisma.payment.update.mock.calls.map((c) => c[0].data), ...prisma.payment.updateMany.mock.calls.map((c) => c[0].data)]
      .map((d) => d as Record<string, unknown>)
      .filter((d) => Object.keys(d).some((k) => k !== 'rawLast'));

  const failsWith = async (promise: Promise<unknown>, status: number, code: string) => {
    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(status);
    expect(((err as HttpException).getResponse() as { code: string }).code).toBe(code);
    return err as HttpException;
  };

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(ensureSystemWebUser).mockResolvedValue('sys-web');
    jest.mocked(chargeOutcome).mockImplementation((status: string) => {
      const s = status.toUpperCase();
      return s === 'CAPTURED' ? 'captured' : (FAILED_STATUSES as readonly string[]).includes(s) ? 'failed' : 'pending';
    });
    jest.mocked(sameAmount).mockImplementation((amount: number, total: string) => amount.toFixed(2) === total);
    jest.mocked(formatTapAmount).mockImplementation((amount: number | string, currency = 'QAR') =>
      Number(amount).toFixed(['KWD', 'BHD', 'OMR'].includes(currency.toUpperCase()) ? 3 : 2),
    );
    jest.mocked(verifyTapSignature).mockReturnValue(true);
    for (const m of ['setEntity', 'setChange', 'setBranch', 'addMetadata', 'markFailure'] as const) trail[m].mockReturnValue(trail);
    prisma.$transaction.mockImplementation((arg: unknown) =>
      (typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as unknown[])) as never,
    );
    prisma.payment.update.mockImplementation(((args: { data: Record<string, unknown> }) => Promise.resolve(paymentRow(args.data))) as never);
    prisma.payment.updateMany.mockResolvedValue({ count: 1 });
    prisma.order.update.mockResolvedValue(webRow() as never);
    prisma.order.updateMany.mockResolvedValue({ count: 1 });
    odooOrders.enqueue.mockResolvedValue(undefined);
    setOrder(webRow());
  });

  describe('settle', () => {
    it('captured: marks the attempt captured, the order PAID + CONFIRMED by system.web, and queues it for Odoo', async () => {
      await expect(service.settle(charge(), 'webhook')).resolves.toEqual({ outcome: 'paid', orderId: 'o-1' });

      expect(paymentWrites()).toContainEqual(expect.objectContaining({ status: 'CAPTURED' }));
      expect(orderWrites()).toHaveLength(1);
      expect(orderWrites()[0]).toMatchObject({
        paymentStatus: 'PAID',
        status: 'CONFIRMED',
        paidAt: expect.any(Date) as Date,
        confirmedAt: expect.any(Date) as Date,
        confirmedById: 'sys-web',
      });
      expect(prisma.order.update.mock.calls[0][0].where).toEqual({ id: 'o-1' });
      expect(odooOrders.enqueue).toHaveBeenCalledTimes(1);
      expect(odooOrders.enqueue.mock.calls[0][1]).toBe('o-1');
      expect(trail.setEntity).toHaveBeenCalledWith('Order', 'o-1');
      expect(trail.setBranch).toHaveBeenCalledWith('bo');
      expect(trail.addMetadata).toHaveBeenCalledWith(expect.objectContaining({ via: 'webhook', chargeId: 'chg_1', outcome: 'paid' }));
      expect(trail.addMetadata).not.toHaveBeenCalledWith(expect.objectContaining({ afterExpiry: true }));
      expect(trail.markFailure).not.toHaveBeenCalled();

      const sqlOf = (q: unknown): string =>
        Array.isArray(q)
          ? (q as readonly string[]).join('?')
          : typeof q === 'string'
            ? q
            : q !== null && typeof q === 'object' && 'sql' in q
              ? String((q as { sql: unknown }).sql)
              : '';
      // settle runs in one transaction
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // inside it, the order row is locked FOR UPDATE before anything is written
      const lockOrder = [
        ...prisma.$queryRaw.mock.calls.map((c, i) => ({ sql: sqlOf(c[0]), at: prisma.$queryRaw.mock.invocationCallOrder[i] })),
        ...prisma.$queryRawUnsafe.mock.calls.map((c, i) => ({ sql: sqlOf(c[0]), at: prisma.$queryRawUnsafe.mock.invocationCallOrder[i] })),
      ].find((q) => /orders/i.test(q.sql) && /FOR UPDATE/i.test(q.sql));
      expect(lockOrder).toBeDefined();
      const at = lockOrder?.at ?? 0;
      expect(at).toBeGreaterThan(prisma.$transaction.mock.invocationCallOrder[0]);
      expect(at).toBeLessThan(prisma.order.update.mock.invocationCallOrder[0]);
      expect(at).toBeLessThan(Math.min(...prisma.payment.update.mock.invocationCallOrder));
    });

    it.each(['webhook', 'reconcile'] as const)(
      'captured again (a re-delivered webhook, or reconcile after the webhook) via %s: already_paid and nothing changes',
      async (via) => {
        setOrder(webRow({ status: 'CONFIRMED', paymentStatus: 'PAID', paidAt: new Date() }), paymentRow({ status: 'CAPTURED' }));
        await expect(service.settle(charge(), via)).resolves.toEqual({ outcome: 'already_paid', orderId: 'o-1' });
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(prisma.order.update).not.toHaveBeenCalled();
        expect(prisma.order.updateMany).not.toHaveBeenCalled();
        // a CAPTURED payment never changes again: at most the last charge object is stored
        expect(paymentStateWrites()).toEqual([]);
        expect(odooOrders.enqueue).not.toHaveBeenCalled();
        expect(trail.addMetadata).toHaveBeenCalledWith(expect.objectContaining({ via, outcome: 'already_paid' }));
        expect(trail.markFailure).not.toHaveBeenCalled();
      },
    );

    it.each(['CAPTURED', 'REFUNDED'])(
      'after a staff refund, Tap reporting the charge %s again is already_paid: the order stays CANCELLED/REFUNDED and nothing is queued',
      async (status) => {
        setOrder(
          webRow({ status: 'CANCELLED', paymentStatus: 'REFUNDED', paidAt: new Date('2026-10-18T10:05:00.000Z') }),
          paymentRow({ status: 'CAPTURED', refundId: 'rf_1', refundedAt: new Date('2026-10-18T11:00:00.000Z') }),
        );
        await expect(service.settle(charge({ status }), 'reconcile')).resolves.toEqual({ outcome: 'already_paid', orderId: 'o-1' });
        expect(prisma.order.update).not.toHaveBeenCalled();
        expect(prisma.order.updateMany).not.toHaveBeenCalled();
        expect(paymentStateWrites()).toEqual([]);
        expect(odooOrders.enqueue).not.toHaveBeenCalled();
        expect(trail.markFailure).not.toHaveBeenCalled();
      },
    );

    it('a re-delivered capture of an AMOUNT_MISMATCH payment stays amount_mismatch without a second failure entry', async () => {
      setOrder(webRow({ total: new Prisma.Decimal('120.50') }), paymentRow({ status: 'CAPTURED', failureCode: 'AMOUNT_MISMATCH', amount: new Prisma.Decimal('120.50') }));
      await expect(service.settle(charge({ amount: 100 }), 'webhook')).resolves.toEqual({ outcome: 'amount_mismatch', orderId: 'o-1' });
      expect(prisma.order.update).not.toHaveBeenCalled();
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
      expect(paymentStateWrites()).toEqual([]);
      expect(odooOrders.enqueue).not.toHaveBeenCalled();
      expect(trail.markFailure).not.toHaveBeenCalled();
      expect(trail.addMetadata).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'amount_mismatch', chargeId: 'chg_1' }));
    });

    it('a DECLINED report for a payment already CAPTURED does not mark it FAILED', async () => {
      setOrder(webRow({ status: 'CONFIRMED', paymentStatus: 'PAID', paidAt: new Date() }), paymentRow({ status: 'CAPTURED' }));
      await expect(service.settle(charge({ status: 'DECLINED', response: { code: '301', message: 'Declined' } }), 'webhook')).resolves.toEqual({
        outcome: 'already_paid',
        orderId: 'o-1',
      });
      expect(paymentWrites()).not.toContainEqual(expect.objectContaining({ status: 'FAILED' }));
      expect(paymentStateWrites()).toEqual([]);
      expect(prisma.order.update).not.toHaveBeenCalled();
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
      expect(odooOrders.enqueue).not.toHaveBeenCalled();
    });

    it.each([
      ['PAID', 'CONFIRMED'],
      ['REFUNDED', 'CANCELLED'],
    ] as const)(
      'a second attempt that captures on an order already %s (two tabs): DUPLICATE_CAPTURE, the order is left alone, the entry is a failure',
      async (paymentStatus, status) => {
        const paidAt = new Date('2026-10-18T10:05:00.000Z');
        setOrder(webRow({ status, paymentStatus, paidAt }), paymentRow({ id: 'pay-2', chargeId: 'chg_2', status: 'INITIATED' }));
        await expect(service.settle(charge({ id: 'chg_2' }), 'webhook')).resolves.toEqual({ outcome: 'duplicate_capture', orderId: 'o-1' });
        expect(paymentWrites()).toContainEqual(expect.objectContaining({ status: 'CAPTURED', failureCode: 'DUPLICATE_CAPTURE' }));
        expect(prisma.order.update).not.toHaveBeenCalled();
        expect(prisma.order.updateMany).not.toHaveBeenCalled();
        expect(odooOrders.enqueue).not.toHaveBeenCalled();
        expect(trail.markFailure).toHaveBeenCalledWith('DUPLICATE_CAPTURE');
        expect(trail.markFailure).toHaveBeenCalledTimes(1);
        expect(trail.addMetadata).toHaveBeenCalledWith(expect.objectContaining({ via: 'webhook', chargeId: 'chg_2', outcome: 'duplicate_capture' }));
      },
    );

    it('declined: the attempt fails with the response code and the order stays as it was', async () => {
      await expect(service.settle(charge({ status: 'DECLINED', response: { code: '301', message: 'Declined' } }), 'webhook')).resolves.toEqual({
        outcome: 'failed',
        orderId: 'o-1',
      });
      expect(paymentWrites()).toContainEqual(expect.objectContaining({ status: 'FAILED', failureCode: '301' }));
      expect(prisma.order.update).not.toHaveBeenCalled();
      expect(odooOrders.enqueue).not.toHaveBeenCalled();
    });

    it('initiated: only the last charge object is kept', async () => {
      await expect(service.settle(charge({ status: 'INITIATED' }), 'reconcile')).resolves.toEqual({ outcome: 'pending', orderId: 'o-1' });
      expect(paymentWrites()).toContainEqual(expect.objectContaining({ rawLast: expect.objectContaining({ id: 'chg_1', status: 'INITIATED' }) as unknown }));
      expect(paymentWrites()).not.toContainEqual(expect.objectContaining({ status: 'CAPTURED' }));
      expect(paymentWrites()).not.toContainEqual(expect.objectContaining({ status: 'FAILED' }));
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('captured for the wrong amount: the attempt is captured with AMOUNT_MISMATCH, the order is not confirmed, the entry is a failure, and nothing throws', async () => {
      setOrder(webRow({ total: new Prisma.Decimal('120.50') }));
      // settle never throws for an outcome: the webhook still answers 200 so Tap does not retry a delivery we recorded
      await expect(service.settle(charge({ amount: 100 }), 'webhook')).resolves.toEqual({ outcome: 'amount_mismatch', orderId: 'o-1' });
      expect(paymentWrites()).toContainEqual(expect.objectContaining({ status: 'CAPTURED', failureCode: 'AMOUNT_MISMATCH' }));
      expect(prisma.order.update).not.toHaveBeenCalled();
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
      expect(odooOrders.enqueue).not.toHaveBeenCalled();
      expect(trail.markFailure).toHaveBeenCalledWith('AMOUNT_MISMATCH');
      expect(trail.addMetadata).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'amount_mismatch', chargeId: 'chg_1' }));
    });

    it('captured in another currency is also a mismatch', async () => {
      await expect(service.settle(charge({ currency: 'SAR' }), 'webhook')).resolves.toEqual({ outcome: 'amount_mismatch', orderId: 'o-1' });
      expect(paymentWrites()).toContainEqual(expect.objectContaining({ status: 'CAPTURED', failureCode: 'AMOUNT_MISMATCH' }));
      expect(prisma.order.update).not.toHaveBeenCalled();
      expect(odooOrders.enqueue).not.toHaveBeenCalled();
      expect(trail.markFailure).toHaveBeenCalledWith('AMOUNT_MISMATCH');
    });

    it('unknown charge id: unknown_charge with no order, nothing written, nothing thrown', async () => {
      setOrder(webRow(), null);
      await expect(service.settle(charge({ id: 'chg_nope' }), 'webhook')).resolves.toEqual({ outcome: 'unknown_charge', orderId: null });
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(prisma.order.update).not.toHaveBeenCalled();
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
      expect(odooOrders.enqueue).not.toHaveBeenCalled();
    });

    it.each([
      ['the sweep', new Date(Date.now() - 60_000)],
      ['the customer', new Date(Date.now() + 20 * 60_000)],
    ] as const)('captured after %s cancelled the order (never refunded): still paid, with afterExpiry in the audit metadata', async (_by, expiresAt) => {
      setOrder(webRow({ status: 'CANCELLED', paymentStatus: 'PENDING', expiresAt }));
      await expect(service.settle(charge(), 'webhook')).resolves.toEqual({ outcome: 'paid', orderId: 'o-1' });
      expect(paymentWrites()).toContainEqual(expect.objectContaining({ status: 'CAPTURED' }));
      expect(paymentWrites()).not.toContainEqual(expect.objectContaining({ failureCode: 'DUPLICATE_CAPTURE' }));
      expect(orderWrites()).toHaveLength(1);
      expect(orderWrites()[0]).toMatchObject({ paymentStatus: 'PAID', status: 'CONFIRMED', paidAt: expect.any(Date) as Date, confirmedById: 'sys-web' });
      expect(odooOrders.enqueue).toHaveBeenCalledTimes(1);
      expect(trail.addMetadata).toHaveBeenCalledWith(expect.objectContaining({ afterExpiry: true }));
      expect(trail.markFailure).not.toHaveBeenCalled();
    });
  });

  describe('pay', () => {
    const dto = { tokenId: 'tok_abc123', locale: 'ar' as const };

    beforeEach(() => {
      setOrder(webRow(), null);
      prisma.payment.create.mockResolvedValue(paymentRow({ chargeId: null }) as never);
      gateway.createCharge.mockResolvedValue(charge({ status: 'INITIATED' }));
    });

    it('creates an INITIATED attempt, asks Tap for a charge and answers the 3-D Secure URL', async () => {
      const result = await service.pay(customer, 'o-1', dto);

      const created = prisma.payment.create.mock.calls[0][0].data as { orderId: string; status: string; amount: unknown; currency: string };
      expect(created).toMatchObject({ orderId: 'o-1', status: 'INITIATED', currency: 'QAR' });
      expect(new Prisma.Decimal(created.amount as string).toFixed(2)).toBe('619.50');

      expect(gateway.createCharge).toHaveBeenCalledTimes(1);
      expect(gateway.createCharge.mock.calls[0][0]).toEqual({
        amount: '619.50',
        currency: 'QAR',
        tokenId: 'tok_abc123',
        customer: { name: 'Sara Al Thani', email: 'sara@example.qa', phone: '+97455123456' },
        redirectUrl: 'https://wolfcar.qa/ar/checkout/return?order=o-1',
        postUrl: 'https://wolfcar.qa/api/shop/payments/tap/webhook',
        orderId: 'o-1',
        orderCode: 'BO-000001',
        paymentId: 'pay-1',
        description: 'Wolf Car order BO-000001',
        locale: 'ar',
      });

      expect(paymentWrites()).toContainEqual(expect.objectContaining({ chargeId: 'chg_1' }));
      expect(result.redirectUrl).toBe('https://tap.test/3ds');
      expect(result.order).toMatchObject({ id: 'o-1', total: '619.50' });
      expect(prisma.order.update).not.toHaveBeenCalled();
      // the order is read as in CheckoutService.get: the customer's own only
      expect(prisma.order.findFirst.mock.calls[0][0]?.where).toMatchObject({ id: 'o-1', customerId: 'c-1' });
      // the activity entry belongs to the order's branch (the customer actor has none)
      expect(trail.setEntity).toHaveBeenCalledWith('Order', 'o-1');
      expect(trail.setBranch).toHaveBeenCalledWith('bo');
    });

    it('settles at once when Tap answers the create call with a captured charge', async () => {
      const captured = charge({ status: 'CAPTURED' });
      gateway.createCharge.mockResolvedValue(captured);
      const settle = jest.spyOn(service, 'settle').mockResolvedValue({ outcome: 'paid', orderId: 'o-1' });
      await service.pay(customer, 'o-1', dto);
      expect(settle).toHaveBeenCalledTimes(1);
      expect(settle).toHaveBeenCalledWith(expect.objectContaining({ id: 'chg_1', status: 'CAPTURED' }), 'create');
    });

    it('does not settle a charge that is still waiting for 3-D Secure', async () => {
      const settle = jest.spyOn(service, 'settle').mockResolvedValue({ outcome: 'pending', orderId: 'o-1' });
      await service.pay(customer, 'o-1', dto);
      expect(settle).not.toHaveBeenCalled();
    });

    it('builds the return URL for the English site when asked', async () => {
      await service.pay(customer, 'o-1', { ...dto, locale: 'en' });
      expect(gateway.createCharge.mock.calls[0][0]).toMatchObject({ redirectUrl: 'https://wolfcar.qa/en/checkout/return?order=o-1', locale: 'en' });
    });

    it('is 409 ORDER_NOT_PAYABLE for an expired order, before any attempt is made', async () => {
      setOrder(webRow({ expiresAt: new Date(Date.now() - 1_000) }), null);
      await failsWith(service.pay(customer, 'o-1', dto), 409, 'ORDER_NOT_PAYABLE');
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(gateway.createCharge).not.toHaveBeenCalled();
    });

    it('is 409 ORDER_NOT_PAYABLE for a cancelled order', async () => {
      setOrder(webRow({ status: 'CANCELLED' }), null);
      await failsWith(service.pay(customer, 'o-1', dto), 409, 'ORDER_NOT_PAYABLE');
      expect(gateway.createCharge).not.toHaveBeenCalled();
    });

    it("is 404 for anyone else's order, before any attempt is made", async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      await expect(service.pay(customer, 'o-2', dto)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(gateway.createCharge).not.toHaveBeenCalled();
    });

    it('is 409 ALREADY_PAID when a captured attempt exists', async () => {
      setOrder(webRow({ payments: [{ status: 'CAPTURED', failureCode: null, chargeId: 'chg_1' }] }), paymentRow({ status: 'CAPTURED' }));
      await failsWith(service.pay(customer, 'o-1', dto), 409, 'ALREADY_PAID');
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(gateway.createCharge).not.toHaveBeenCalled();
    });

    it('is 409 ALREADY_PAID, not ORDER_NOT_PAYABLE, for a confirmed paid order', async () => {
      setOrder(
        webRow({ status: 'CONFIRMED', paymentStatus: 'PAID', paidAt: new Date(), payments: [{ status: 'CAPTURED', failureCode: null, chargeId: 'chg_1' }] }),
        paymentRow({ status: 'CAPTURED' }),
      );
      await failsWith(service.pay(customer, 'o-1', dto), 409, 'ALREADY_PAID');
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(gateway.createCharge).not.toHaveBeenCalled();
    });

    it('marks the attempt FAILED with the gateway code and answers 402 PAYMENT_FAILED when Tap refuses', async () => {
      gateway.createCharge.mockRejectedValue(new PaymentGatewayError('Unknown test token', 'INVALID_TOKEN', 400));
      const err = await failsWith(service.pay(customer, 'o-1', dto), 402, 'PAYMENT_FAILED');
      expect(err.getResponse()).toMatchObject({ reason: 'INVALID_TOKEN' });
      expect(paymentWrites()).toContainEqual(expect.objectContaining({ status: 'FAILED', failureCode: 'INVALID_TOKEN' }));
      expect(prisma.order.update).not.toHaveBeenCalled();
    });
  });

  describe('handleWebhook', () => {
    it('is 401 BAD_SIGNATURE when the hashstring does not match, and settles nothing', async () => {
      jest.mocked(verifyTapSignature).mockReturnValue(false);
      const settle = jest.spyOn(service, 'settle').mockResolvedValue({ outcome: 'paid', orderId: 'o-1' });
      await failsWith(service.handleWebhook(charge(), 'bad'), 401, 'BAD_SIGNATURE');
      expect(verifyTapSignature).toHaveBeenCalledWith(expect.objectContaining({ id: 'chg_1' }), 'bad', 'sk_test_x');
      expect(settle).not.toHaveBeenCalled();
    });

    it('settles a signed charge and acknowledges it', async () => {
      const settle = jest.spyOn(service, 'settle').mockResolvedValue({ outcome: 'paid', orderId: 'o-1' });
      const body = charge();
      await expect(service.handleWebhook(body, 'good')).resolves.toEqual({ received: true });
      expect(verifyTapSignature).toHaveBeenCalledWith(body, 'good', 'sk_test_x');
      expect(settle).toHaveBeenCalledWith(body, 'webhook');
    });

    it('acknowledges an amount mismatch with 200: the delivery was recorded, Tap must not retry it', async () => {
      jest.spyOn(service, 'settle').mockResolvedValue({ outcome: 'amount_mismatch', orderId: 'o-1' });
      await expect(service.handleWebhook(charge({ amount: 100 }), 'good')).resolves.toEqual({ received: true });
    });

    it('acknowledges a failed or pending charge with 200', async () => {
      const settle = jest.spyOn(service, 'settle').mockResolvedValue({ outcome: 'failed', orderId: 'o-1' });
      await expect(service.handleWebhook(charge({ status: 'DECLINED' }), 'good')).resolves.toEqual({ received: true });
      settle.mockResolvedValue({ outcome: 'pending', orderId: 'o-1' });
      await expect(service.handleWebhook(charge({ status: 'INITIATED' }), 'good')).resolves.toEqual({ received: true });
    });

    it('is 404 UNKNOWN_CHARGE for a signed charge we never created', async () => {
      const settle = jest.spyOn(service, 'settle').mockResolvedValue({ outcome: 'unknown_charge', orderId: null });
      const err = await failsWith(service.handleWebhook(charge({ id: 'chg_nope' }), 'good'), 404, 'UNKNOWN_CHARGE');
      expect(err).toBeInstanceOf(NotFoundException);
      expect(settle).toHaveBeenCalledWith(expect.objectContaining({ id: 'chg_nope' }), 'webhook');
    });

    it("with the fake provider and no secret configured, checks the signature against 'fake-secret'", async () => {
      const fakeConfig = {
        get: (key: string) => ({ WEB_PUBLIC_URL: 'https://wolfcar.qa', API_PUBLIC_URL: 'https://wolfcar.qa', PAYMENTS_PROVIDER: 'fake' })[key],
      } as unknown as ConfigService<Env, true>;
      const fakeService = new PaymentsService(prisma, fakeConfig, trail, gateway, odooOrders);
      jest.spyOn(fakeService, 'settle').mockResolvedValue({ outcome: 'paid', orderId: 'o-1' });
      const body = charge();
      await expect(fakeService.handleWebhook(body, 'good')).resolves.toEqual({ received: true });
      expect(verifyTapSignature).toHaveBeenCalledWith(body, 'good', 'fake-secret');
    });

    it('refuses a body that is not a charge as 401 BAD_SIGNATURE (it cannot carry a valid signature)', async () => {
      const settle = jest.spyOn(service, 'settle').mockResolvedValue({ outcome: 'paid', orderId: 'o-1' });
      await failsWith(service.handleWebhook({ amount: 1 }, 'good'), 401, 'BAD_SIGNATURE');
      await failsWith(service.handleWebhook('chg_1', 'good'), 401, 'BAD_SIGNATURE');
      expect(settle).not.toHaveBeenCalled();
    });
  });

  describe('reconcile', () => {
    it('reads the newest attempt back from Tap, settles it and answers the fresh view', async () => {
      setOrder(webRow({ payments: [{ status: 'INITIATED', failureCode: null, chargeId: 'chg_1' }] }), paymentRow());
      const fromTap = charge();
      gateway.getCharge.mockResolvedValue(fromTap);
      const settle = jest.spyOn(service, 'settle').mockResolvedValue({ outcome: 'paid', orderId: 'o-1' });
      const view = await service.reconcile(customer, 'o-1');
      expect(gateway.getCharge).toHaveBeenCalledWith('chg_1');
      expect(settle).toHaveBeenCalledWith(fromTap, 'reconcile');
      expect(view).toMatchObject({ id: 'o-1', code: 'BO-000001', total: '619.50' });
    });

    it('answers the current view without asking Tap when no attempt has a charge yet', async () => {
      setOrder(webRow(), null);
      const settle = jest.spyOn(service, 'settle').mockResolvedValue({ outcome: 'pending', orderId: 'o-1' });
      await expect(service.reconcile(customer, 'o-1')).resolves.toMatchObject({ id: 'o-1', paymentStatus: 'PENDING' });
      expect(gateway.getCharge).not.toHaveBeenCalled();
      expect(settle).not.toHaveBeenCalled();
    });

    it('answers the current view when Tap cannot be reached (the return page keeps polling)', async () => {
      setOrder(webRow({ payments: [{ status: 'INITIATED', failureCode: null, chargeId: 'chg_1' }] }), paymentRow());
      gateway.getCharge.mockRejectedValue(new PaymentGatewayError('timeout', 'GATEWAY_ERROR'));
      const settle = jest.spyOn(service, 'settle').mockResolvedValue({ outcome: 'paid', orderId: 'o-1' });
      await expect(service.reconcile(customer, 'o-1')).resolves.toMatchObject({ id: 'o-1', paymentStatus: 'PENDING' });
      expect(settle).not.toHaveBeenCalled();
    });
  });

  describe('without a payment gateway', () => {
    const offline = new PaymentsService(prisma, config, trail, null, odooOrders);

    it('pay, reconcile and the webhook answer 503 CHECKOUT_UNAVAILABLE before anything else', async () => {
      const settle = jest.spyOn(offline, 'settle').mockResolvedValue({ outcome: 'paid', orderId: 'o-1' });
      await failsWith(offline.pay(customer, 'o-1', { tokenId: 'tok_abc123', locale: 'en' }), 503, 'CHECKOUT_UNAVAILABLE');
      await failsWith(offline.reconcile(customer, 'o-1'), 503, 'CHECKOUT_UNAVAILABLE');
      await failsWith(offline.handleWebhook(charge(), 'good'), 503, 'CHECKOUT_UNAVAILABLE');
      expect(prisma.order.findFirst).not.toHaveBeenCalled();
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(verifyTapSignature).not.toHaveBeenCalled();
      expect(settle).not.toHaveBeenCalled();
    });
  });

  describe('refundForCancel', () => {
    beforeEach(() => {
      setOrder(webRow({ status: 'CONFIRMED', paymentStatus: 'PAID' }), paymentRow({ status: 'CAPTURED' }));
    });

    it('refunds the captured attempt for its amount and remembers the refund id', async () => {
      gateway.refund.mockResolvedValue({ id: 'rf_1', status: 'REFUNDED' });
      await expect(service.refundForCancel('o-1', 'Cancelled by admin')).resolves.toEqual({ refundId: 'rf_1' });
      expect(gateway.refund).toHaveBeenCalledWith({ chargeId: 'chg_1', amount: '619.50', currency: 'QAR', reason: 'Cancelled by admin' });
      expect(paymentWrites()).toContainEqual(expect.objectContaining({ refundId: 'rf_1', refundedAt: expect.any(Date) as Date }));
    });

    it('answers 502 REFUND_FAILED when Tap refuses', async () => {
      gateway.refund.mockRejectedValue(new PaymentGatewayError('Refund window closed', 'REFUND_DECLINED', 400));
      const err = await failsWith(service.refundForCancel('o-1', 'Cancelled by admin'), 502, 'REFUND_FAILED');
      expect(err.getResponse()).toMatchObject({ reason: 'REFUND_DECLINED' });
      expect(paymentWrites()).not.toContainEqual(expect.objectContaining({ refundId: expect.any(String) as string }));
    });

    it.each(['INITIATED', 'PENDING', 'IN_PROGRESS', 'REFUNDED', 'refunded', 'In_Progress'])('accepts a refund Tap answers %s', async (status) => {
      gateway.refund.mockResolvedValue({ id: 'rf_1', status });
      await expect(service.refundForCancel('o-1', 'Cancelled by admin')).resolves.toEqual({ refundId: 'rf_1' });
      expect(paymentWrites()).toContainEqual(expect.objectContaining({ refundId: 'rf_1' }));
    });

    it.each(['FAILED', 'DECLINED', 'CANCELLED', '', undefined])('answers 502 REFUND_FAILED, storing no refund id, when Tap answers the refund %p', async (status) => {
      gateway.refund.mockResolvedValue({ id: 'rf_1', status } as never);
      const err = await failsWith(service.refundForCancel('o-1', 'Cancelled by admin'), 502, 'REFUND_FAILED');
      expect(err.getResponse()).toMatchObject({ reason: status ? status : 'UNKNOWN' });
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('refunds the newest CAPTURED attempt, not a newer attempt that failed', async () => {
      const captured = { ...paymentRow({ status: 'CAPTURED' }), order: { ...webRow({ status: 'CONFIRMED', paymentStatus: 'PAID' }), branchId: 'bo' } };
      const newerFailed = { ...captured, id: 'pay-2', chargeId: 'chg_2', status: 'FAILED', createdAt: new Date('2026-10-18T10:05:00.000Z') };
      prisma.payment.findFirst.mockImplementation(((args?: { where?: { status?: unknown } }) =>
        Promise.resolve(args?.where?.status === 'CAPTURED' ? captured : newerFailed)) as never);
      gateway.refund.mockResolvedValue({ id: 'rf_1', status: 'REFUNDED' });
      await service.refundForCancel('o-1', 'Cancelled by admin');
      expect(gateway.refund).toHaveBeenCalledWith(expect.objectContaining({ chargeId: 'chg_1' }));
      const args = prisma.payment.findFirst.mock.calls[0]?.[0];
      expect(args?.where).toMatchObject({ orderId: 'o-1', status: 'CAPTURED' });
      expect(JSON.stringify(args?.orderBy)).toContain('"createdAt":"desc"');
    });

    type Where = Record<string, unknown>;
    /** The refund query's `where` as Postgres applies it: equality and `not` on NULL are unknown, and only true matches. */
    const sqlMatch = (row: Record<string, unknown>, where: Where): boolean | null => {
      let result: boolean | null = true;
      const and = (v: boolean | null) => {
        if (v === false) result = false;
        else if (v === null && result !== false) result = null;
      };
      for (const [key, cond] of Object.entries(where)) {
        if (key === 'OR') {
          const vs = (cond as Where[]).map((w) => sqlMatch(row, w));
          and(vs.includes(true) ? true : vs.includes(null) ? null : false);
        } else if (key === 'AND' || key === 'NOT') {
          for (const w of [cond].flat() as Where[]) {
            const v = sqlMatch(row, w);
            and(key === 'AND' || v === null ? v : !v);
          }
        } else if (cond === null) {
          and(row[key] === null);
        } else if (typeof cond === 'object' && 'not' in cond) {
          const not = (cond as { not: unknown }).not;
          and(not === null ? row[key] !== null : row[key] === null ? null : row[key] !== not);
        } else {
          and(row[key] === null ? null : row[key] === cond);
        }
      }
      return result;
    };
    /** payment.findFirst over these rows: the where as Postgres applies it, newest first. */
    const paymentsAre = (...rows: ReturnType<typeof paymentRow>[]) =>
      prisma.payment.findFirst.mockImplementation(((args?: { where?: Where }) =>
        Promise.resolve(
          rows.filter((r) => sqlMatch(r, args?.where ?? {}) === true).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null,
        )) as never);

    it('refunds the charge that paid the order, never a newer DUPLICATE_CAPTURE one (staff refund that in Tap)', async () => {
      const paying = paymentRow({ status: 'CAPTURED', failureCode: null });
      const duplicate = paymentRow({ id: 'pay-2', chargeId: 'chg_2', status: 'CAPTURED', failureCode: 'DUPLICATE_CAPTURE', createdAt: new Date('2026-10-18T10:05:00.000Z') });
      paymentsAre(paying, duplicate);
      gateway.refund.mockResolvedValue({ id: 'rf_1', status: 'REFUNDED' });

      await expect(service.refundForCancel('o-1', 'Cancelled by admin')).resolves.toEqual({ refundId: 'rf_1' });
      expect(gateway.refund).toHaveBeenCalledTimes(1);
      expect(gateway.refund).toHaveBeenCalledWith({ chargeId: 'chg_1', amount: '619.50', currency: 'QAR', reason: 'Cancelled by admin' });
      expect(prisma.payment.update.mock.calls[0][0].where).toEqual({ id: 'pay-1' });
    });

    it('is 502 REFUND_FAILED, asking Tap nothing, when only a DUPLICATE_CAPTURE charge is left unrefunded', async () => {
      paymentsAre(
        paymentRow({ status: 'CAPTURED', failureCode: null, refundId: 'rf_0', refundedAt: new Date('2026-10-18T11:00:00.000Z') }),
        paymentRow({ id: 'pay-2', chargeId: 'chg_2', status: 'CAPTURED', failureCode: 'DUPLICATE_CAPTURE', createdAt: new Date('2026-10-18T10:05:00.000Z') }),
      );
      await failsWith(service.refundForCancel('o-1', 'Cancelled by admin'), 502, 'REFUND_FAILED');
      expect(gateway.refund).not.toHaveBeenCalled();
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('refunds an AMOUNT_MISMATCH capture for what Tap captured, not the order total', async () => {
      setOrder(webRow({ total: new Prisma.Decimal('120.50') }));
      paymentsAre(
        paymentRow({
          status: 'CAPTURED',
          failureCode: 'AMOUNT_MISMATCH',
          amount: new Prisma.Decimal('120.50'),
          rawLast: { id: 'chg_1', status: 'CAPTURED', amount: 100, currency: 'QAR' },
        }),
      );
      gateway.refund.mockResolvedValue({ id: 'rf_1', status: 'REFUNDED' });
      await service.refundForCancel('o-1', 'Cancelled by bo.cashier');
      expect(gateway.refund).toHaveBeenCalledWith({ chargeId: 'chg_1', amount: '100.00', currency: 'QAR', reason: 'Cancelled by bo.cashier' });
    });

    it.each([
      ['no charge object', null],
      ['an amount that is not a number', { id: 'chg_1', status: 'CAPTURED', amount: '100', currency: 'QAR' }],
      ['no amount', { id: 'chg_1', status: 'CAPTURED' }],
      ['a JSON array', [100]],
    ])('falls back to the attempt amount when the stored charge has %s', async (_what, rawLast) => {
      paymentsAre(paymentRow({ status: 'CAPTURED', rawLast }));
      gateway.refund.mockResolvedValue({ id: 'rf_1', status: 'REFUNDED' });
      await service.refundForCancel('o-1', 'Cancelled by admin');
      expect(gateway.refund).toHaveBeenCalledWith({ chargeId: 'chg_1', amount: '619.50', currency: 'QAR', reason: 'Cancelled by admin' });
    });
  });
});
