import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ORDER_CODE_PATTERN } from '../../../shared/validation';
import { AuditTrail } from '../activity/audit-trail.service';
import { OrderLockedException } from '../common/errors';
import { decimal } from '../common/money';
import { type Page, skipTake } from '../common/pagination';
import type { AuthUser } from '../common/types';
import { type OrderSource, type OrderStatus, type PaymentStatus, Prisma } from '../generated/prisma/client';
import { OdooOrdersService } from '../odoo/odoo-orders.service';
import { branchBarcodeBases } from '../products/branch-barcodes';
import { PrismaService } from '../prisma/prisma.service';
import { payingAttemptWhere, PaymentsService } from '../shop/payments/payments.service';
import type { ListOrdersQueryDto, UpdateOrderDto } from './dto/orders.dto';
import { canReadAllBranches, orderReadScope, orderWriteScope } from './order-scope';
import {
  ORDER_DETAIL_SELECT,
  ORDER_LIST_SELECT,
  orderAuditView,
  orderDetail,
  type OrderDetail,
  orderSummary,
  type OrderSummary,
} from './order.view';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Dates without a time are Qatar calendar days (UTC+3, no DST). */
const qatarDay = (d: string) => new Date(`${d}T00:00:00+03:00`);

/**
 * Hides abandoned checkouts: web orders cancelled (expired or by the customer)
 * before any card was charged. Asking for cancelled or web orders shows them.
 * An order Tap captured anyway (an amount mismatch after expiry) stays visible:
 * its money has to be refunded.
 */
const NOT_ABANDONED_CHECKOUT = {
  NOT: { source: 'WEB', status: 'CANCELLED', paymentStatus: 'PENDING', payments: { none: { status: 'CAPTURED' } } },
} satisfies Prisma.OrderWhereInput;

const webOrderReadonly = () =>
  new ConflictException({ statusCode: 409, error: 'Conflict', code: 'WEB_ORDER_READONLY', message: 'Web orders cannot be edited: the total is what the card was charged.' });
const webOrderUnpaid = () =>
  new ConflictException({ statusCode: 409, error: 'Conflict', code: 'WEB_ORDER_UNPAID', message: 'A web order is confirmed by its card payment, not by staff.' });
const orderNotCollectable = () =>
  new ConflictException({ statusCode: 409, error: 'Conflict', code: 'ORDER_NOT_COLLECTABLE', message: 'Only a paid web order that has not been collected can be handed over.' });

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trail: AuditTrail,
    private readonly payments: PaymentsService,
    private readonly odooOrders: OdooOrdersService,
  ) {}

  async list(user: AuthUser, q: ListOrdersQueryDto): Promise<Page<OrderSummary>> {
    const and: Prisma.OrderWhereInput[] = [orderReadScope(user)];
    if (q.branchId && canReadAllBranches(user)) and.push({ branchId: q.branchId });
    if (q.status) and.push({ status: q.status });
    if (q.source) and.push({ source: q.source });
    if (q.status !== 'CANCELLED' && q.source !== 'WEB') and.push(NOT_ABANDONED_CHECKOUT);
    if (q.from) and.push({ createdAt: { gte: DAY.test(q.from) ? qatarDay(q.from) : new Date(q.from) } });
    if (q.to) {
      and.push(
        DAY.test(q.to)
          ? { createdAt: { lt: new Date(qatarDay(q.to).getTime() + 86_400_000) } }
          : { createdAt: { lte: new Date(q.to) } },
      );
    }
    if (q.customerName) and.push({ customerName: { contains: q.customerName, mode: 'insensitive' } });
    if (q.orderNumber) {
      const n = q.orderNumber.toUpperCase();
      and.push(
        ORDER_CODE_PATTERN.test(n)
          ? { code: n }
          : /^\d{1,9}$/.test(n)
            ? { number: Number(n) }
            : { code: { contains: n, mode: 'insensitive' } },
      );
    }
    const where: Prisma.OrderWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({ where, select: ORDER_LIST_SELECT, orderBy: [{ createdAt: 'desc' }, { number: 'desc' }], ...skipTake(q) }),
      this.prisma.order.count({ where }),
    ]);
    return { items: rows.map(orderSummary), page: q.page, pageSize: q.pageSize, total };
  }

  /** A foreign branch's order is indistinguishable from a missing one (404). Web orders carry their Odoo outbox state. */
  async get(user: AuthUser, id: string, scope: Prisma.OrderWhereInput = orderReadScope(user)): Promise<OrderDetail> {
    const row = await this.prisma.order.findFirst({ where: { AND: [{ id }, scope] }, select: ORDER_DETAIL_SELECT });
    if (!row) throw new NotFoundException('Order not found.');
    const [bases, odoo] = await Promise.all([
      branchBarcodeBases(this.prisma, row.branch.id),
      row.source === 'WEB' ? this.odooOrders.statusFor(row.id) : null,
    ]);
    return orderDetail(row, bases, odoo);
  }

  /**
   * Finance's "Retry" on a paid web order Odoo has not taken yet: its outbox
   * row goes back to PENDING, due now, and the next tick sends it. 404 outside
   * the caller's read scope, or when the order was never queued (showroom
   * orders); an order already in Odoo is left as it is.
   */
  async retryOdoo(user: AuthUser, id: string): Promise<OrderDetail> {
    const before = await this.get(user, id);
    await this.odooOrders.retry(id);
    const after = await this.get(user, id);
    this.trail
      .setEntity('Order', id)
      .setBranch(after.branch.id)
      .setChange({ odooStatus: before.odoo?.status ?? null }, { odooStatus: after.odoo?.status ?? null })
      .addMetadata({ code: after.code });
    return after;
  }

  /**
   * Edits a pending order (customer name, quantities, removing lines). Unit
   * prices stay as snapshotted. Confirmed/cancelled orders are immutable —
   * except for the Super Admin, whose override is flagged in the audit log.
   * Web orders are never edited (409 WEB_ORDER_READONLY), not even by the
   * Super Admin: their total is what the card was charged.
   */
  async update(user: AuthUser, id: string, dto: UpdateOrderDto): Promise<OrderDetail> {
    if (dto.customerName === undefined && dto.items === undefined) {
      throw new BadRequestException({ statusCode: 400, error: 'Bad Request', code: 'NOTHING_TO_UPDATE', message: 'Nothing to update.' });
    }
    const before = await this.get(user, id, orderWriteScope(user));
    if (before.source === 'WEB') throw webOrderReadonly();
    const override = before.status !== 'PENDING';
    if (override && user.role !== 'SUPER_ADMIN') throw new OrderLockedException(before.status);

    await this.prisma.$transaction(async (tx) => {
      // lock the row and re-check the status inside the transaction (no confirm/edit race)
      const [locked] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM orders WHERE id = ${id}::uuid FOR UPDATE`;
      if (!locked) throw new NotFoundException('Order not found.');
      if (locked.status !== 'PENDING' && user.role !== 'SUPER_ADMIN') throw new OrderLockedException(locked.status);

      const data: Prisma.OrderUpdateInput = {};
      if (dto.customerName !== undefined) data.customerName = dto.customerName;
      if (dto.items) {
        const existing = new Map(before.items.map((i) => [i.productId, i]));
        const unknown = dto.items.filter((l) => !existing.has(l.productId));
        if (unknown.length) {
          throw new BadRequestException({
            statusCode: 400,
            error: 'Bad Request',
            code: 'UNKNOWN_LINE',
            message: 'Only products already on the order can be changed.',
          });
        }
        const keep = new Set(dto.items.map((l) => l.productId));
        await tx.orderItem.deleteMany({ where: { orderId: id, productId: { notIn: [...keep] } } });
        let total = decimal(0);
        for (const line of dto.items) {
          const unitPrice = decimal(existing.get(line.productId)!.unitPrice);
          const lineTotal = unitPrice.mul(line.quantity);
          total = total.add(lineTotal);
          await tx.orderItem.update({
            where: { orderId_productId: { orderId: id, productId: line.productId } },
            data: { quantity: line.quantity, lineTotal },
          });
        }
        data.total = total;
      }
      await tx.order.update({ where: { id }, data });
    });

    const after = await this.get(user, id, orderWriteScope(user));
    this.trail
      .setEntity('Order', id)
      .setBranch(before.branch.id)
      .setChange(orderAuditView(before), orderAuditView(after))
      .addMetadata(override ? { override: true, status: before.status } : {});
    return after;
  }

  /** A web order is confirmed by its payment (PaymentsService.settle), never by staff: 409 WEB_ORDER_UNPAID. */
  async confirm(user: AuthUser, id: string): Promise<OrderDetail> {
    const order = await this.findWritable(user, id);
    if (order.source === 'WEB') throw webOrderUnpaid();
    return this.transition(user, id, 'CONFIRMED', { confirmedById: user.id, confirmedAt: new Date() }, ['PENDING']);
  }

  /**
   * Cashiers cancel pending orders, the Super Admin also confirmed ones. A web
   * order whose card was captured (and not yet refunded) is refunded first,
   * and only once the order is known to be the caller's and cancellable: a
   * refund that fails (502 REFUND_FAILED) leaves the order as it was.
   *
   * The conditional update also requires the paymentStatus read here, so a
   * payment settling mid-cancel gives 409 instead of cancelling a paid order
   * unrefunded (a retry then refunds it). Once money went back, the order says
   * REFUNDED even when the cancel itself does not go through.
   */
  async cancel(user: AuthUser, id: string): Promise<OrderDetail> {
    const from: ('PENDING' | 'CONFIRMED')[] = user.role === 'SUPER_ADMIN' ? ['PENDING', 'CONFIRMED'] : ['PENDING'];
    const order = await this.findWritable(user, id);
    if (!(from as OrderStatus[]).includes(order.status)) throw new OrderLockedException(order.status);

    const data: Prisma.OrderUncheckedUpdateManyInput = { cancelledById: user.id, cancelledAt: new Date() };
    const unchanged: Prisma.OrderWhereInput = { paymentStatus: order.paymentStatus };
    if (order.source !== 'WEB') return this.transition(user, id, 'CANCELLED', data, from, unchanged);

    if (await this.payingAttempt(id, 'unrefunded')) {
      this.trail.setEntity('Order', id).setBranch(order.branchId);
      const { refundId } = await this.payments.refundForCancel(id, `Cancelled by ${user.username}`);
      // recorded before the transition, so the entry keeps it even if the cancel then loses a race
      this.trail.addMetadata({ refundId });
      data.paymentStatus = 'REFUNDED';
      try {
        return await this.transition(user, id, 'CANCELLED', data, from, unchanged);
      } catch (err) {
        await this.prisma.order.updateMany({ where: { id }, data: { paymentStatus: 'REFUNDED' } });
        throw err;
      }
    }
    // an earlier cancel refunded the card but did not record it on the order (it lost a race, or the database failed)
    if (await this.payingAttempt(id, 'refunded')) data.paymentStatus = 'REFUNDED';
    return this.transition(user, id, 'CANCELLED', data, from, unchanged);
  }

  /**
   * Hands a paid web order over at the counter: one conditional update
   * (source WEB, PAID, CONFIRMED, not yet collected) → collectedAt/collectedById.
   * 404 outside the user's branch, else 409 ORDER_NOT_COLLECTABLE.
   */
  async collect(user: AuthUser, id: string): Promise<OrderDetail> {
    const scope = orderWriteScope(user);
    const { count } = await this.prisma.order.updateMany({
      // the scope comes after `id`: a user without a branch gets { id: { in: [] } }, which matches nothing
      where: { id, ...scope, source: 'WEB', paymentStatus: 'PAID', status: 'CONFIRMED', collectedAt: null },
      data: { collectedAt: new Date(), collectedById: user.id },
    });
    if (count === 0) {
      await this.get(user, id, scope); // 404 when outside the user's branch
      throw orderNotCollectable();
    }
    const after = await this.get(user, id, scope);
    this.trail
      .setEntity('Order', id)
      .setBranch(after.branch.id)
      .setChange({ collectedAt: null }, { collectedAt: after.collectedAt })
      .addMetadata({ code: after.code });
    return after;
  }

  /** What confirm and cancel decide on, read in the caller's write scope (404 outside it). */
  private async findWritable(
    user: AuthUser,
    id: string,
  ): Promise<{ status: OrderStatus; source: OrderSource; paymentStatus: PaymentStatus; branchId: string }> {
    const row = await this.prisma.order.findFirst({
      where: { AND: [{ id }, orderWriteScope(user)] },
      select: { status: true, source: true, paymentStatus: true, branchId: true },
    });
    if (!row) throw new NotFoundException('Order not found.');
    return row;
  }

  /** Whether the order has a paying attempt (PaymentsService's rule) that is still to be refunded, or already was. */
  private async payingAttempt(orderId: string, state: 'unrefunded' | 'refunded'): Promise<boolean> {
    const payment = await this.prisma.payment.findFirst({
      where: { ...payingAttemptWhere(orderId), refundId: state === 'unrefunded' ? null : { not: null } },
      select: { id: true },
    });
    return Boolean(payment);
  }

  /** Status change as one conditional UPDATE, so two cashiers (or confirm vs. edit) cannot race. */
  private async transition(
    user: AuthUser,
    id: string,
    to: 'CONFIRMED' | 'CANCELLED',
    data: Prisma.OrderUncheckedUpdateManyInput,
    from: ('PENDING' | 'CONFIRMED')[],
    /** A further condition the row must still meet (cancel: the paymentStatus it decided on). */
    unchanged?: Prisma.OrderWhereInput,
  ): Promise<OrderDetail> {
    const scope = orderWriteScope(user);
    const where: Prisma.OrderWhereInput = { AND: [{ id }, scope, { status: { in: from } }, ...(unchanged ? [unchanged] : [])] };
    const result = await this.prisma.order.updateMany({ where, data: { ...data, status: to } });
    if (result.count === 0) {
      const current = await this.get(user, id, scope); // 404 when outside the user's branch
      throw new OrderLockedException(current.status);
    }
    const after = await this.get(user, id, scope);
    const previous = from.length === 1 ? from[0] : 'PENDING|CONFIRMED';
    this.trail
      .setEntity('Order', id)
      .setBranch(after.branch.id)
      .setChange({ status: previous }, { status: to })
      .addMetadata({ code: after.code, total: after.total });
    return after;
  }
}
