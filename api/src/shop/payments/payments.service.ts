import { ConflictException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditTrail } from '../../activity/audit-trail.service';
import { money } from '../../common/money';
import type { Env } from '../../config/env';
import type { Prisma } from '../../generated/prisma/client';
import { OdooOrdersService } from '../../odoo/odoo-orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { checkoutUnavailable, orderNotFound } from '../checkout/checkout.service';
import { ensureSystemWebUser } from '../checkout/system-web-user';
import { WEB_ORDER_SELECT, webOrderView, type WebOrderView } from '../checkout/web-order.view';
import type { CustomerPrincipal } from '../customers/customers.service';
import type { PayDto } from '../dto/shop.dto';
import { type GatewayRefund, PAYMENT_GATEWAY, type PaymentGateway, PaymentGatewayError } from './payment-gateway';
import { chargeOutcome, sameAmount, type TapCharge } from './tap-charge';
import { verifyTapSignature } from './tap-signature';

export type SettleOutcome = 'paid' | 'already_paid' | 'failed' | 'pending' | 'amount_mismatch' | 'duplicate_capture' | 'unknown_charge';
export type SettleVia = 'webhook' | 'reconcile' | 'create';

/** What a settle transaction decided; the audit entry is written from it after the commit. */
interface Settled {
  outcome: SettleOutcome;
  orderId: string | null;
  branchId: string | null;
  failure?: 'AMOUNT_MISMATCH' | 'DUPLICATE_CAPTURE';
  afterExpiry?: boolean;
}

/** The order fields settle decides on, read after the row lock. */
const SETTLE_ORDER_SELECT = { id: true, branchId: true, status: true, paymentStatus: true, total: true, currency: true } as const satisfies Prisma.OrderSelect;

const alreadyPaid = () => new ConflictException({ statusCode: 409, error: 'Conflict', code: 'ALREADY_PAID', message: 'This order is already paid.' });
const orderNotPayable = () =>
  new ConflictException({ statusCode: 409, error: 'Conflict', code: 'ORDER_NOT_PAYABLE', message: 'This order can no longer be paid.' });
const paymentFailed = (reason: string) =>
  new HttpException(
    { statusCode: HttpStatus.PAYMENT_REQUIRED, error: 'Payment Required', code: 'PAYMENT_FAILED', message: 'The card was not accepted.', reason },
    HttpStatus.PAYMENT_REQUIRED,
  );
const refundFailed = (reason: string) =>
  new HttpException(
    { statusCode: HttpStatus.BAD_GATEWAY, error: 'Bad Gateway', code: 'REFUND_FAILED', message: 'The refund did not go through.', reason },
    HttpStatus.BAD_GATEWAY,
  );
const badSignature = () => new UnauthorizedException({ statusCode: 401, error: 'Unauthorized', code: 'BAD_SIGNATURE', message: 'Invalid signature.' });
const unknownCharge = () => new NotFoundException({ statusCode: 404, error: 'Not Found', code: 'UNKNOWN_CHARGE', message: 'Unknown charge.' });

/** Provider codes go into payments.failure_code (VARCHAR 64) and error bodies. */
const code64 = (code: unknown): string => String(code).slice(0, 64);

/** The stored charge object: Tap's JSON as received (card data is only first_six/last_four). */
const asJson = (charge: TapCharge) => charge as unknown as Prisma.InputJsonValue;

/**
 * The fields a Tap charge must carry before its signature can even be checked
 * (the hashstring is built from id, amount, currency and status). Anything
 * else cannot carry a valid signature.
 */
function isTapCharge(body: unknown): body is TapCharge {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  const b = body as Record<string, unknown>;
  return typeof b.id === 'string' && typeof b.status === 'string' && typeof b.currency === 'string' && (typeof b.amount === 'number' || typeof b.amount === 'string');
}

/**
 * Card payments of web orders. The one rule: an order becomes PAID only in
 * `settle`, from a charge object that came from the provider (a verified
 * webhook, getCharge, or the create answer), never from the browser.
 * Without a gateway (PAYMENT_GATEWAY null) pay, reconcile and the webhook
 * answer 503 CHECKOUT_UNAVAILABLE.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly trail: AuditTrail,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway | null,
    private readonly odooOrders: OdooOrdersService,
  ) {}

  /** Creates a Payment and a Tap charge; answers the 3-D Secure URL. 404 for anyone else's order. 409 ALREADY_PAID (checked first) / ORDER_NOT_PAYABLE, 402 PAYMENT_FAILED. */
  async pay(customer: CustomerPrincipal, orderId: string, dto: PayDto): Promise<{ redirectUrl: string | null; order: WebOrderView }> {
    const gateway = this.requireGateway();
    const webUrl = this.publicUrl('WEB_PUBLIC_URL');
    const apiUrl = this.publicUrl('API_PUBLIC_URL');

    const order = await this.prisma.order.findFirst({ where: { id: orderId, customerId: customer.id }, select: WEB_ORDER_SELECT });
    if (!order) throw orderNotFound();
    this.trail.setEntity('Order', order.id).setBranch(order.branch.id);

    // any captured attempt, not only the newest: a later attempt from another tab may have failed
    const captured = await this.prisma.payment.findFirst({ where: { orderId: order.id, status: 'CAPTURED' }, select: { id: true } });
    if (captured) throw alreadyPaid();
    if (order.status !== 'PENDING' || order.paymentStatus !== 'PENDING' || !order.expiresAt || order.expiresAt.getTime() <= Date.now()) {
      throw orderNotPayable();
    }

    const payment = await this.prisma.payment.create({
      data: { orderId: order.id, status: 'INITIATED', amount: order.total, currency: order.currency },
      select: { id: true },
    });

    let charge: TapCharge;
    try {
      charge = await gateway.createCharge({
        amount: money(order.total),
        currency: 'QAR',
        tokenId: dto.tokenId,
        customer: { name: order.customerName, email: order.customerEmail ?? customer.email ?? '', phone: order.customerPhone ?? customer.phone },
        redirectUrl: `${webUrl}/${dto.locale}/checkout/return?order=${order.id}`,
        postUrl: `${apiUrl}/api/shop/payments/tap/webhook`,
        orderId: order.id,
        orderCode: order.code,
        paymentId: payment.id,
        description: `Wolf Car order ${order.code}`,
        locale: dto.locale,
      });
    } catch (err) {
      if (!(err instanceof PaymentGatewayError)) throw err;
      const reason = code64(err.code);
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureCode: reason } });
      throw paymentFailed(reason);
    }

    await this.prisma.payment.update({ where: { id: payment.id }, data: { chargeId: charge.id, rawLast: asJson(charge) } });
    // non-3-D Secure cards can be captured in the create answer itself
    if (chargeOutcome(charge.status) === 'captured') await this.settle(charge, 'create');

    const fresh = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: WEB_ORDER_SELECT });
    return { redirectUrl: charge.transaction?.url ?? null, order: webOrderView(fresh) };
  }

  /** Reads the newest attempt's charge back from the provider and settles it; used by the return page. */
  async reconcile(customer: CustomerPrincipal, orderId: string): Promise<WebOrderView> {
    const gateway = this.requireGateway();
    const order = await this.prisma.order.findFirst({ where: { id: orderId, customerId: customer.id }, select: WEB_ORDER_SELECT });
    if (!order) throw orderNotFound();
    this.trail.setEntity('Order', order.id).setBranch(order.branch.id);

    const latest = await this.prisma.payment.findFirst({
      where: { orderId: order.id, chargeId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { chargeId: true },
    });
    if (!latest?.chargeId) return webOrderView(order);

    let charge: TapCharge;
    try {
      charge = await gateway.getCharge(latest.chargeId);
    } catch (err) {
      if (!(err instanceof PaymentGatewayError)) throw err;
      // the return page polls again; the webhook may still settle it meanwhile
      this.logger.warn(`Reconcile of order ${order.id}: the provider answered ${err.code}`);
      this.trail.addMetadata({ gatewayError: code64(err.code) });
      return webOrderView(order);
    }
    await this.settle(charge, 'reconcile');
    return webOrderView(await this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: WEB_ORDER_SELECT }));
  }

  /** Verifies the hashstring header, then settles. 401 BAD_SIGNATURE, 404 UNKNOWN_CHARGE; { received: true } for every known charge, whatever the outcome. */
  async handleWebhook(body: unknown, hashHeader: string | string[] | undefined): Promise<{ received: true }> {
    this.requireGateway();
    if (!isTapCharge(body)) throw badSignature();
    const secret = this.webhookSecret();
    if (!secret || !verifyTapSignature(body, hashHeader, secret)) throw badSignature();

    const { outcome } = await this.settle(body, 'webhook');
    if (outcome === 'unknown_charge') throw unknownCharge();
    // a recorded outcome, even a failure, is acknowledged: Tap must not retry it
    return { received: true };
  }

  /**
   * One transaction with the order row locked FOR UPDATE. A payment already
   * CAPTURED never changes again (only the last charge object is stored).
   * Otherwise: pending → kept; failed → payment FAILED; captured → amount or
   * currency mismatch (AMOUNT_MISMATCH), or a second capture on an order
   * already PAID/REFUNDED (DUPLICATE_CAPTURE): payment captured, order
   * untouched, audit FAILURE; else the order becomes PAID + CONFIRMED and is
   * queued for Odoo, also after it was cancelled unpaid (afterExpiry).
   * Never throws for an outcome.
   */
  async settle(charge: TapCharge, via: SettleVia): Promise<{ outcome: SettleOutcome; orderId: string | null }> {
    const rawLast = asJson(charge);
    const settled = await this.prisma.$transaction(async (tx): Promise<Settled> => {
      const unknown: Settled = { outcome: 'unknown_charge', orderId: null, branchId: null };
      const found = await tx.payment.findUnique({ where: { chargeId: charge.id }, select: { orderId: true } });
      if (!found) return unknown;

      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${found.orderId}::uuid FOR UPDATE`;
      // read again under the lock: a concurrent settle of the same charge (webhook and reconcile together) has committed by now
      const payment = await tx.payment.findUnique({
        where: { chargeId: charge.id },
        select: { id: true, status: true, failureCode: true, order: { select: SETTLE_ORDER_SELECT } },
      });
      if (!payment) return unknown;
      const { order } = payment;
      const base = { orderId: order.id, branchId: order.branchId };
      const writePayment = (data: Prisma.PaymentUpdateInput) => tx.payment.update({ where: { id: payment.id }, data, select: { id: true } });

      if (payment.status === 'CAPTURED') {
        await writePayment({ rawLast });
        return { ...base, outcome: payment.failureCode === 'AMOUNT_MISMATCH' ? 'amount_mismatch' : 'already_paid' };
      }

      const result = chargeOutcome(charge.status);
      if (result === 'pending') {
        await writePayment({ rawLast });
        return { ...base, outcome: 'pending' };
      }
      if (result === 'failed') {
        await writePayment({ status: 'FAILED', failureCode: code64(charge.response?.code ?? charge.status), rawLast });
        return { ...base, outcome: 'failed' };
      }

      if (!sameAmount(charge.amount, money(order.total)) || charge.currency !== order.currency) {
        await writePayment({ status: 'CAPTURED', failureCode: 'AMOUNT_MISMATCH', rawLast });
        return { ...base, outcome: 'amount_mismatch', failure: 'AMOUNT_MISMATCH' };
      }
      if (order.paymentStatus === 'PAID' || order.paymentStatus === 'REFUNDED') {
        await writePayment({ status: 'CAPTURED', failureCode: 'DUPLICATE_CAPTURE', rawLast });
        return { ...base, outcome: 'duplicate_capture', failure: 'DUPLICATE_CAPTURE' };
      }

      // PENDING, or CANCELLED unpaid (by the expiry sweep or the customer): the customer paid, the order is theirs
      const now = new Date();
      await writePayment({ status: 'CAPTURED', failureCode: null, rawLast });
      await tx.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: 'PAID',
          paidAt: now,
          // an order staff already confirmed keeps who confirmed it
          ...(order.status === 'CONFIRMED' ? {} : { status: 'CONFIRMED', confirmedAt: now, confirmedById: await ensureSystemWebUser(tx) }),
        },
        select: { id: true },
      });
      await this.odooOrders.enqueue(tx, order.id);
      return { ...base, outcome: 'paid', afterExpiry: order.status === 'CANCELLED' };
    });

    if (settled.orderId) this.trail.setEntity('Order', settled.orderId).setBranch(settled.branchId);
    this.trail.addMetadata({ via, chargeId: charge.id, outcome: settled.outcome, ...(settled.afterExpiry ? { afterExpiry: true } : {}) });
    if (settled.failure) this.trail.markFailure(settled.failure);
    return { outcome: settled.outcome, orderId: settled.orderId };
  }

  /** Refunds the newest captured, unrefunded attempt of an order; 502 REFUND_FAILED. Used by OrdersService.cancel. */
  async refundForCancel(orderId: string, reason: string): Promise<{ refundId: string }> {
    const payment = await this.prisma.payment.findFirst({
      where: { orderId, status: 'CAPTURED', refundId: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, chargeId: true, amount: true },
    });
    if (!payment?.chargeId) throw refundFailed('NOT_CAPTURED');
    if (!this.gateway) throw refundFailed('CHECKOUT_UNAVAILABLE');

    let refund: GatewayRefund;
    try {
      refund = await this.gateway.refund({ chargeId: payment.chargeId, amount: money(payment.amount), currency: 'QAR', reason });
    } catch (err) {
      if (err instanceof PaymentGatewayError) throw refundFailed(code64(err.code));
      throw err;
    }
    await this.prisma.payment.update({ where: { id: payment.id }, data: { refundId: refund.id, refundedAt: new Date() }, select: { id: true } });
    return { refundId: refund.id };
  }

  private requireGateway(): PaymentGateway {
    if (!this.gateway) throw checkoutUnavailable();
    return this.gateway;
  }

  /** The configured origin without a trailing slash; 503 CHECKOUT_UNAVAILABLE when it is not set. */
  private publicUrl(key: 'WEB_PUBLIC_URL' | 'API_PUBLIC_URL'): string {
    const url = this.config.get(key, { infer: true });
    if (!url) throw checkoutUnavailable();
    return url.replace(/\/+$/, '');
  }

  /** TAP_SECRET_KEY; the fake provider falls back to 'fake-secret' so tests can sign. */
  private webhookSecret(): string | undefined {
    const key = this.config.get('TAP_SECRET_KEY', { infer: true });
    return this.config.get('PAYMENTS_PROVIDER', { infer: true }) === 'fake' ? (key ?? 'fake-secret') : key;
  }
}
