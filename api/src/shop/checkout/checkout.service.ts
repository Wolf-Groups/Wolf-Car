import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditTrail } from '../../activity/audit-trail.service';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import type { CustomerPrincipal } from '../customers/customers.service';
import type { CreateWebOrderDto } from '../dto/shop.dto';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../payments/payment-gateway';
import { todo } from '../todo';
import type { WebOrderView } from './web-order.view';

/**
 * Web orders: created from the basket with the server's prices, for pickup at
 * the WEB_ORDERS_BRANCH_CODE branch, expiring CHECKOUT_TTL_MINUTES later if
 * unpaid. Mirrors ShowroomService.createOrder; see the plan (Task 5).
 */
@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly trail: AuditTrail,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway | null,
  ) {}

  /** The active branch with code WEB_ORDERS_BRANCH_CODE; 503 CHECKOUT_UNAVAILABLE otherwise, or when no gateway is configured. */
  pickupBranch(): Promise<{ id: string; code: string }> {
    return todo('CheckoutService.pickupBranch', this.prisma, this.config, this.gateway);
  }

  /** 400 PRODUCT_UNAVAILABLE { productIds } for lines that are inactive, unpriced, service rows or off the branch list. Replays by (customer, Idempotency-Key). */
  createOrder(customer: CustomerPrincipal, dto: CreateWebOrderDto, idempotencyKey: string | undefined): Promise<{ order: WebOrderView; replayed: boolean }> {
    return todo('CheckoutService.createOrder', this.trail, customer, dto, idempotencyKey);
  }

  /** The customer's own order; 404 for anyone else's. */
  get(customer: CustomerPrincipal, id: string): Promise<WebOrderView> {
    return todo('CheckoutService.get', customer, id);
  }

  /** Cancels an unpaid PENDING order with no captured attempt; 409 ORDER_NOT_CANCELLABLE otherwise. */
  cancelUnpaid(customer: CustomerPrincipal, id: string): Promise<WebOrderView> {
    return todo('CheckoutService.cancelUnpaid', customer, id);
  }
}
