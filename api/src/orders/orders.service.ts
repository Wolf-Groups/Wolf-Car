import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ORDER_CODE_PATTERN } from '../../../shared/validation';
import { AuditTrail } from '../activity/audit-trail.service';
import { OrderLockedException } from '../common/errors';
import { decimal } from '../common/money';
import { type Page, skipTake } from '../common/pagination';
import type { AuthUser } from '../common/types';
import { Prisma } from '../generated/prisma/client';
import { branchBarcodeBases } from '../products/branch-barcodes';
import { PrismaService } from '../prisma/prisma.service';
import { todo } from '../shop/todo';
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

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trail: AuditTrail,
  ) {}

  async list(user: AuthUser, q: ListOrdersQueryDto): Promise<Page<OrderSummary>> {
    const and: Prisma.OrderWhereInput[] = [orderReadScope(user)];
    if (q.branchId && canReadAllBranches(user)) and.push({ branchId: q.branchId });
    if (q.status) and.push({ status: q.status });
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

  /** A foreign branch's order is indistinguishable from a missing one (404). */
  async get(user: AuthUser, id: string, scope: Prisma.OrderWhereInput = orderReadScope(user)): Promise<OrderDetail> {
    const row = await this.prisma.order.findFirst({ where: { AND: [{ id }, scope] }, select: ORDER_DETAIL_SELECT });
    if (!row) throw new NotFoundException('Order not found.');
    return orderDetail(row, await branchBarcodeBases(this.prisma, row.branch.id));
  }

  /**
   * Edits a pending order (customer name, quantities, removing lines). Unit
   * prices stay as snapshotted. Confirmed/cancelled orders are immutable —
   * except for the Super Admin, whose override is flagged in the audit log.
   */
  async update(user: AuthUser, id: string, dto: UpdateOrderDto): Promise<OrderDetail> {
    if (dto.customerName === undefined && dto.items === undefined) {
      throw new BadRequestException({ statusCode: 400, error: 'Bad Request', code: 'NOTHING_TO_UPDATE', message: 'Nothing to update.' });
    }
    const before = await this.get(user, id, orderWriteScope(user));
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

  async confirm(user: AuthUser, id: string): Promise<OrderDetail> {
    return this.transition(user, id, 'CONFIRMED', { confirmedById: user.id, confirmedAt: new Date() }, ['PENDING']);
  }

  async cancel(user: AuthUser, id: string): Promise<OrderDetail> {
    const from: ('PENDING' | 'CONFIRMED')[] = user.role === 'SUPER_ADMIN' ? ['PENDING', 'CONFIRMED'] : ['PENDING'];
    return this.transition(user, id, 'CANCELLED', { cancelledById: user.id, cancelledAt: new Date() }, from);
  }

  /**
   * Hands a paid web order over at the counter: one conditional update
   * (source WEB, PAID, CONFIRMED, not yet collected) → collectedAt/collectedById.
   * 404 outside the user's branch, else 409 ORDER_NOT_COLLECTABLE. Plan Task 8.
   */
  collect(user: AuthUser, id: string): Promise<OrderDetail> {
    return todo('OrdersService.collect', user, id);
  }

  /** Status change as one conditional UPDATE, so two cashiers (or confirm vs. edit) cannot race. */
  private async transition(
    user: AuthUser,
    id: string,
    to: 'CONFIRMED' | 'CANCELLED',
    data: Prisma.OrderUncheckedUpdateManyInput,
    from: ('PENDING' | 'CONFIRMED')[],
  ): Promise<OrderDetail> {
    const scope = orderWriteScope(user);
    const result = await this.prisma.order.updateMany({ where: { AND: [{ id }, scope, { status: { in: from } }] }, data: { ...data, status: to } });
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
