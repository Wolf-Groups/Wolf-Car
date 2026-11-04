import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { BRANCH_ORDERS_OPEN_MAX, type PaymentMethod } from '../../../../shared/shop';
import { ConfigService } from '@nestjs/config';
import { AuditTrail } from '../../activity/audit-trail.service';
import { decimal } from '../../common/money';
import type { Env } from '../../config/env';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IN_STOCK } from '../../products/stock';
import type { CustomerPrincipal } from '../customers/customers.service';
import type { CreateWebOrderDto } from '../dto/shop.dto';
import { OrderEmailsService } from '../emails/order-emails.service';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../payments/payment-gateway';
import { type OrderAccess, orderAccessWhere } from './order-access';
import { orderKey } from './order-key';
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

const tooManyOpenOrders = () =>
  new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    code: 'TOO_MANY_OPEN_ORDERS',
    message: 'You already have orders waiting at the branch. Please wait for us to call you.',
  });

/** A web order created (or replayed) here, with the key that opens it without a session. */
export type CreatedWebOrder = WebOrderView & { key: string };

/**
 * Web orders: created from the basket with the server's prices, for pickup at
 * the WEB_ORDERS_BRANCH_CODE branch, by a signed-in customer or a guest. Paid
 * by card (expiring CHECKOUT_TTL_MINUTES later if unpaid) or at the branch on
 * collection (paymentStatus NONE, no expiry; staff confirm it after calling).
 * Mirrors ShowroomService.createOrder.
 */
@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly trail: AuditTrail,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway | null,
    private readonly emails: OrderEmailsService,
  ) {}

  /** The active branch with code WEB_ORDERS_BRANCH_CODE; 503 CHECKOUT_UNAVAILABLE otherwise, or for a card order when no gateway is configured. */
  async pickupBranch(paymentMethod: PaymentMethod): Promise<{ id: string; code: string }> {
    if (paymentMethod === 'card' && !this.gateway) throw checkoutUnavailable();
    const branch = await this.prisma.branch.findFirst({
      where: { code: this.config.get('WEB_ORDERS_BRANCH_CODE', { infer: true }), isActive: true },
      select: { id: true, code: true },
    });
    if (!branch) throw checkoutUnavailable();
    return branch;
  }

  /**
   * 400 PRODUCT_UNAVAILABLE { productIds } for lines that are inactive, unpriced, out of stock, service rows or off the
   * branch list; 409 TOO_MANY_OPEN_ORDERS past BRANCH_ORDERS_OPEN_MAX open pay-at-branch orders (guests). Replays by
   * (customer, Idempotency-Key). A guest's order belongs to the customer of its email, found or created.
   */
  async createOrder(access: OrderAccess, dto: CreateWebOrderDto, idempotencyKey: string | undefined): Promise<{ order: CreatedWebOrder; replayed: boolean }> {
    const branch = await this.pickupBranch(dto.paymentMethod);
    const customer = await this.orderingCustomer(access.customer, dto);
    const keyed = (order: WebOrderView): CreatedWebOrder => ({ ...order, key: orderKey(order.id, this.secret()) });

    if (idempotencyKey) {
      const existing = await this.findByKey(customer.id, idempotencyKey);
      if (existing) return { order: keyed(existing), replayed: true };
    }

    // Guests only: anyone may type any email, so a signed-in customer (who proved theirs) is never held back by
    // pay-at-branch orders a stranger placed under it; staff cancelling those frees a guest again.
    if (dto.paymentMethod === 'branch' && !access.customer) {
      const open = await this.prisma.order.count({ where: { customerId: customer.id, source: 'WEB', status: 'PENDING', paymentStatus: 'NONE' } });
      if (open >= BRANCH_ORDERS_OPEN_MAX) throw tooManyOpenOrders();
    }
    const card = dto.paymentMethod === 'card';

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
            // Odoo had none left at the last sync
            ...IN_STOCK,
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

        // what a signed-in customer typed fills the form next time; a guest's request changes no one's details
        if (access.customer) await tx.customer.update({ where: { id: customer.id }, data: { name: dto.name, phone: dto.phone } });
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
            customerPhone: dto.phone,
            customerEmail: customer.email,
            customerName: dto.name,
            customerLocale: dto.locale,
            paymentStatus: card ? 'PENDING' : 'NONE',
            expiresAt: card ? new Date(Date.now() + this.config.get('CHECKOUT_TTL_MINUTES', { infer: true }) * MINUTE_MS) : null,
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
        const existing = await this.findByKey(customer.id, idempotencyKey);
        if (existing) return { order: keyed(existing), replayed: true };
      }
      throw err;
    }

    const order = webOrderView(await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: WEB_ORDER_SELECT }));
    this.trail.setEntity('Order', order.id).setBranch(branch.id).setChange(null, order);
    // a card order is announced once it is paid (PaymentsService.settle)
    if (!card) await this.emails.placed(order.id);
    return { order: keyed(order), replayed: false };
  }

  /**
   * Whose order this is: the signed-in customer, or the customer of the email a guest typed
   * (created with the guest's name and phone if new; an existing one is left as it is).
   */
  private async orderingCustomer(signedIn: CustomerPrincipal | null, dto: CreateWebOrderDto): Promise<{ id: string; email: string }> {
    if (signedIn) return signedIn;
    const customer = await this.prisma.customer.upsert({
      where: { email: dto.email },
      create: { email: dto.email, name: dto.name, phone: dto.phone },
      update: {},
      select: { id: true },
    });
    this.trail.setActor({ id: null, username: dto.email, role: null, branchId: null });
    return { id: customer.id, email: dto.email };
  }

  /**
   * The customer's own web orders, newest first. Checkouts cancelled before any
   * card was charged (expired or given up) are left out, as in the staff list.
   */
  async list(customer: CustomerPrincipal): Promise<WebOrderView[]> {
    const rows = await this.prisma.order.findMany({
      where: {
        customerId: customer.id,
        source: 'WEB',
        NOT: { status: 'CANCELLED', paymentStatus: 'PENDING', payments: { none: { status: 'CAPTURED' } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: WEB_ORDER_SELECT,
    });
    return rows.map(webOrderView);
  }

  /** The order its key opens, or the signed-in customer's own; 404 otherwise. */
  async get(access: OrderAccess, id: string): Promise<WebOrderView> {
    const where = orderAccessWhere(access, id, this.secret());
    const row = where && (await this.prisma.order.findFirst({ where, select: WEB_ORDER_SELECT }));
    if (!row) throw orderNotFound();
    return webOrderView(row);
  }

  /**
   * Cancels an unpaid card order (PENDING, no captured attempt). 404 when `access` cannot open it; 409
   * ORDER_NOT_CANCELLABLE when it is not cancellable — also a pay-at-branch order: the branch cancels those.
   */
  async cancelUnpaid(access: OrderAccess, id: string): Promise<WebOrderView> {
    const before = await this.get(access, id);
    const where = orderAccessWhere(access, id, this.secret()) as Prisma.OrderWhereInput;
    // one conditional write, not read-then-write: an order that got paid in the meantime is left alone
    const { count } = await this.prisma.order.updateMany({
      where: { AND: [where, { status: 'PENDING', paymentStatus: 'PENDING', payments: { none: { status: 'CAPTURED' } } }] },
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
  private async findByKey(customerId: string, key: string): Promise<WebOrderView | null> {
    const row = await this.prisma.order.findFirst({ where: { customerId, idempotencyKey: key }, select: WEB_ORDER_SELECT });
    return row ? webOrderView(row) : null;
  }

  private secret(): string {
    return this.config.get('JWT_ACCESS_SECRET', { infer: true });
  }
}
