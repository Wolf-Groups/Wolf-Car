import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditTrail } from '../../activity/audit-trail.service';
import type { Env } from '../../config/env';
import { OdooOrdersService } from '../../odoo/odoo-orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { WebOrderView } from '../checkout/web-order.view';
import type { CustomerPrincipal } from '../customers/customers.service';
import type { PayDto } from '../dto/shop.dto';
import { PAYMENT_GATEWAY, type PaymentGateway } from './payment-gateway';
import type { TapCharge } from './tap-charge';
import { todo } from '../todo';

export type SettleOutcome = 'paid' | 'already_paid' | 'failed' | 'pending' | 'amount_mismatch' | 'duplicate_capture' | 'unknown_charge';
export type SettleVia = 'webhook' | 'reconcile' | 'create';

/**
 * Card payments of web orders. The one rule: an order becomes PAID only in
 * `settle`, from a charge object that came from the provider (a verified
 * webhook, getCharge, or the create answer), never from the browser.
 * Decision table and error codes: the plan, Task 6. Without a gateway
 * (PAYMENT_GATEWAY null) pay, reconcile and the webhook answer 503 CHECKOUT_UNAVAILABLE.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly trail: AuditTrail,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway | null,
    private readonly odooOrders: OdooOrdersService,
  ) {}

  /** Creates a Payment and a Tap charge; answers the 3-D Secure URL. 404 for anyone else's order. 409 ALREADY_PAID (checked first) / ORDER_NOT_PAYABLE, 402 PAYMENT_FAILED. */
  pay(customer: CustomerPrincipal, orderId: string, dto: PayDto): Promise<{ redirectUrl: string | null; order: WebOrderView }> {
    return todo('PaymentsService.pay', this.prisma, this.config, this.trail, this.gateway, this.odooOrders, customer, orderId, dto);
  }

  /** Reads the newest attempt's charge back from the provider and settles it; used by the return page. */
  reconcile(customer: CustomerPrincipal, orderId: string): Promise<WebOrderView> {
    return todo('PaymentsService.reconcile', customer, orderId);
  }

  /** Verifies the hashstring header, then settles. 401 BAD_SIGNATURE; { received: true } otherwise. */
  handleWebhook(body: unknown, hashHeader: string | string[] | undefined): Promise<{ received: true }> {
    return todo('PaymentsService.handleWebhook', body, hashHeader);
  }

  /** Idempotent: a payment already CAPTURED never changes again. Captured → order PAID + CONFIRMED (+ Odoo outbox), even after expiry (metadata afterExpiry); mismatch, or a second capture on an order already PAID/REFUNDED (DUPLICATE_CAPTURE) → payment captured, order untouched. */
  settle(charge: TapCharge, via: SettleVia): Promise<{ outcome: SettleOutcome; orderId: string | null }> {
    return todo('PaymentsService.settle', charge, via);
  }

  /** Refunds the newest captured, unrefunded attempt of an order; 502 REFUND_FAILED. Used by OrdersService.cancel. */
  refundForCancel(orderId: string, reason: string): Promise<{ refundId: string }> {
    return todo('PaymentsService.refundForCancel', orderId, reason);
  }
}
