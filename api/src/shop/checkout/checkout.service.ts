import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditTrail } from '../../activity/audit-trail.service';
import { decimal } from '../../common/money';
import type { Env } from '../../config/env';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { CustomerPrincipal } from '../customers/customers.service';
import type { CreateWebOrderDto } from '../dto/shop.dto';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../payments/payment-gateway';
import { ensureSystemWebUser } from './system-web-user';
import { WEB_ORDER_SELECT, webOrderView, type WebOrderView } from './web-order.view';

const MINUTE_MS = 60_000;

export const checkoutUnavailable = () =>
  new ServiceUnavailableException({
    statusCode: 503,
    error: 'Service Unavailable',
    code: 'CHECKOUT_UNAVAILABLE',
    message: 'Online checkout is not available right now.',
  });

export const orderNotFound = () => new NotFoundException('Order not found.');

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
  async pickupBranch(): Promise<{ id: string; code: string }> {
    if (!this.gateway) throw checkoutUnavailable();
    const branch = await this.prisma.branch.findFirst({
      where: { code: this.config.get('WEB_ORDERS_BRANCH_CODE', { infer: true }), isActive: true },
      select: { id: true, code: true },
    });
    if (!branch) throw checkoutUnavailable();
    return branch;
  }

  /** 400 PRODUCT_UNAVAILABLE { productIds } for lines that are inactive, unpriced, service rows or off the branch list. Replays by (customer, Idempotency-Key). */
  async createOrder(customer: CustomerPrincipal, dto: CreateWebOrderDto, idempotencyKey: string | undefined): Promise<{ order: WebOrderView; replayed: boolean }> {
    const branch = await this.pickupBranch();

    if (idempotencyKey) {
      const existing = await this.findByKey(customer, idempotencyKey);
      if (existing) return { order: existing, replayed: true };
    }

    let orderId: string;
    try {
      orderId = await this.prisma.$transaction(async (tx) => {
        const products = await tx.product.findMany({
          where: {
            id: { in: dto.items.map((i) => i.productId) },
            isActive: true,
            price: { not: null },
            // the hidden rows that price a service are not sold online
            serviceId: null,
            branchPositions: { some: { branchId: branch.id } },
          },
          select: { id: true, name: true, price: true },
        });
        const byId = new Map(products.map((p) => [p.id, p]));
        const unavailable = dto.items.filter((i) => !byId.has(i.productId)).map((i) => i.productId);
        if (unavailable.length) {
          throw new BadRequestException({
            statusCode: 400,
            error: 'Bad Request',
            code: 'PRODUCT_UNAVAILABLE',
            message: 'Some products are no longer available. Please review the cart.',
            productIds: unavailable,
          });
        }

        // what the customer typed last time fills the form next time
        await tx.customer.update({ where: { id: customer.id }, data: { name: dto.name, email: dto.email } });
        const createdById = await ensureSystemWebUser(tx);

        // per-branch sequence, shared with the showroom; the row lock also serialises concurrent orders of the branch
        const { orderSeq, code } = await tx.branch.update({
          where: { id: branch.id },
          data: { orderSeq: { increment: 1 } },
          select: { orderSeq: true, code: true },
        });

        let total = decimal(0);
        const items = dto.items.map((line, position) => {
          const product = byId.get(line.productId)!;
          const unitPrice = product.price as Prisma.Decimal;
          const lineTotal = unitPrice.mul(line.quantity);
          total = total.add(lineTotal);
          return { productId: product.id, productName: product.name, unitPrice, quantity: line.quantity, lineTotal, position };
        });

        const order = await tx.order.create({
          data: {
            branchId: branch.id,
            number: orderSeq,
            code: `${code}-${String(orderSeq).padStart(6, '0')}`,
            source: 'WEB',
            customerId: customer.id,
            customerPhone: customer.phone,
            customerEmail: dto.email,
            customerName: dto.name,
            paymentStatus: 'PENDING',
            expiresAt: new Date(Date.now() + this.config.get('CHECKOUT_TTL_MINUTES', { infer: true }) * MINUTE_MS),
            total,
            createdById,
            idempotencyKey: idempotencyKey ?? null,
            items: { create: items },
          },
          select: { id: true },
        });
        return order.id;
      });
    } catch (err) {
      // two identical requests raced past the lookup: return the one that won. Another
      // customer's order holding the same key is not found here, so their 409 stands.
      if (idempotencyKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.findByKey(customer, idempotencyKey);
        if (existing) return { order: existing, replayed: true };
      }
      throw err;
    }

    const order = webOrderView(await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: WEB_ORDER_SELECT }));
    this.trail.setEntity('Order', order.id).setBranch(branch.id).setChange(null, order);
    return { order, replayed: false };
  }

  /** The customer's own order; 404 for anyone else's. */
  async get(customer: CustomerPrincipal, id: string): Promise<WebOrderView> {
    const row = await this.prisma.order.findFirst({ where: { id, customerId: customer.id }, select: WEB_ORDER_SELECT });
    if (!row) throw orderNotFound();
    return webOrderView(row);
  }

  /** Cancels an unpaid PENDING order with no captured attempt. 404 for anyone else's order; 409 ORDER_NOT_CANCELLABLE when it is not cancellable. */
  async cancelUnpaid(customer: CustomerPrincipal, id: string): Promise<WebOrderView> {
    const before = await this.get(customer, id);
    // one conditional write, not read-then-write: an order that got paid in the meantime is left alone
    const { count } = await this.prisma.order.updateMany({
      where: { id, customerId: customer.id, status: 'PENDING', paymentStatus: 'PENDING', payments: { none: { status: 'CAPTURED' } } },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    if (count === 0) {
      throw new ConflictException({ statusCode: 409, error: 'Conflict', code: 'ORDER_NOT_CANCELLABLE', message: 'This order can no longer be cancelled.' });
    }
    const row = await this.prisma.order.findUniqueOrThrow({ where: { id }, select: WEB_ORDER_SELECT });
    const after = webOrderView(row);
    this.trail.setEntity('Order', id).setBranch(row.branch.id).setChange(before, after);
    return after;
  }

  /**
   * The customer's order placed with this Idempotency-Key. Every web order is
   * created by system.web and only web orders carry a customerId, so this is
   * the (createdById, idempotencyKey) unique key narrowed to the customer:
   * another customer's key never hands over their order.
   */
  private async findByKey(customer: CustomerPrincipal, key: string): Promise<WebOrderView | null> {
    const row = await this.prisma.order.findFirst({ where: { customerId: customer.id, idempotencyKey: key }, select: WEB_ORDER_SELECT });
    return row ? webOrderView(row) : null;
  }
}
