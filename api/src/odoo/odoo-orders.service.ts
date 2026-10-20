import { Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { money } from '../common/money';
import type { Env } from '../config/env';
import type { OutboxStatus, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OdooClient } from './odoo-client';
import { nextAttemptAt, OdooMappingError, type OutboxOrder, partnerDomain, partnerValues, saleOrderValues } from './odoo-sale-order';
import type { OdooWriter } from './odoo-writer';

export interface OdooOrderStatus {
  status: OutboxStatus;
  saleOrderId: number | null;
  attempts: number;
  lastError: string | null;
  /** null once the row FAILED: nothing is scheduled any more. */
  nextAttemptAt: string | null;
}

const MINUTE = 60_000;
const TICK_MS = MINUTE;
/** Rows tried per tick. */
const BATCH = 20;
/** How long rows wait while no sales user is configured; attempts are not counted. */
const NOT_CONFIGURED_WAIT_MS = 60 * MINUTE;
/** odoo_outbox.last_error is VARCHAR(600). */
const LAST_ERROR_MAX = 600;
/** A sale order still to be confirmed (Odoo refuses action_confirm in any other state). */
const UNCONFIRMED = new Set(['draft', 'sent']);

/** What a row needs to be sent: its progress so far and the order in OutboxOrder shape. */
const OUTBOX_ROW_SELECT = {
  id: true,
  status: true,
  attempts: true,
  odooPartnerId: true,
  odooSaleOrderId: true,
  order: {
    select: {
      id: true,
      code: true,
      customerName: true,
      customerPhone: true,
      customerEmail: true,
      total: true,
      currency: true,
      paidAt: true,
      paymentStatus: true,
      items: { orderBy: { position: 'asc' }, select: { productName: true, quantity: true, unitPrice: true, product: { select: { odooId: true } } } },
      // the attempt that paid: settle() records it CAPTURED with no failure code
      payments: { where: { status: 'CAPTURED', failureCode: null }, orderBy: { createdAt: 'desc' }, take: 1, select: { chargeId: true } },
    },
  },
} as const satisfies Prisma.OdooOutboxSelect;
type OutboxRow = Prisma.OdooOutboxGetPayload<{ select: typeof OUTBOX_ROW_SELECT }>;

function outboxOrder(o: OutboxRow['order']): OutboxOrder {
  return {
    id: o.id,
    code: o.code,
    customerName: o.customerName,
    customerPhone: o.customerPhone ?? '',
    customerEmail: o.customerEmail,
    total: money(o.total),
    currency: o.currency,
    chargeId: o.payments[0]?.chargeId ?? null,
    paidAt: o.paidAt,
    items: o.items.map((i) => ({ productName: i.productName, quantity: i.quantity, unitPrice: money(i.unitPrice), odooId: i.product.odooId })),
  };
}

/**
 * Turns paid web orders into confirmed Odoo sale orders from the odoo_outbox
 * table: a timer every minute, one row at a time, backoff on failure, never in
 * the request path. Writes with the dedicated sales user
 * (ODOO_WRITE_LOGIN / ODOO_WRITE_API_KEY); without it rows wait with
 * lastError ODOO_WRITE_NOT_CONFIGURED. Assumes one API process (one timer).
 */
@Injectable()
export class OdooOrdersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OdooOrdersService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    // never keeps the process alive on shutdown
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** The timer's callback: whatever goes wrong is logged, never thrown (an unhandled rejection would end the process). */
  private tick(): void {
    const failed = (err: unknown) => this.logger.error(`Odoo outbox tick failed: ${this.errorText(err)}`);
    try {
      void this.processDue().catch(failed);
    } catch (err) {
      failed(err);
    }
  }

  /** The writing connection, or null when ODOO_URL, ODOO_DB, ODOO_WRITE_LOGIN or ODOO_WRITE_API_KEY is missing. */
  protected writer(): OdooWriter | null {
    const url = this.config.get('ODOO_URL', { infer: true });
    const db = this.config.get('ODOO_DB', { infer: true });
    const login = this.config.get('ODOO_WRITE_LOGIN', { infer: true });
    const apiKey = this.config.get('ODOO_WRITE_API_KEY', { infer: true });
    return url && db && login && apiKey ? new OdooClient({ url: url.replace(/\/+$/, ''), db, login, apiKey }) : null;
  }

  /** Upserts the outbox row for a freshly paid order (called inside the settle transaction). A row that exists is left as it is. */
  async enqueue(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    await tx.odooOutbox.upsert({
      where: { orderId },
      create: { orderId, status: 'PENDING', nextAttemptAt: new Date() },
      update: {},
    });
  }

  /**
   * Processes PENDING rows whose nextAttemptAt has passed (longest due first,
   * up to 20), one at a time, every row measured from this tick's `now`.
   * Returns how many were tried; 0 while another tick is still running. A row
   * that throws (database trouble; Odoo errors are recorded on the row) does
   * not stop the others: the first such error is rethrown once all were tried.
   */
  async processDue(now: Date = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const due = await this.prisma.odooOutbox.findMany({
        where: { status: 'PENDING', nextAttemptAt: { lte: now } },
        orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
        take: BATCH,
        select: { id: true },
      });
      let firstError: unknown;
      for (const { id } of due) {
        try {
          await this.processOne(id, now);
        } catch (err) {
          firstError ??= err;
        }
      }
      if (firstError !== undefined) throw firstError;
      return due.length;
    } finally {
      this.running = false;
    }
  }

  /**
   * Tries one PENDING outbox row. The backoff and the no-writer wait start
   * from `now`; processDue passes its own `now`. A refunded order is never
   * sold in Odoo: the row FAILS with ORDER_REFUNDED without calling Odoo.
   */
  async processOne(outboxId: string, now: Date = new Date()): Promise<void> {
    const row = await this.prisma.odooOutbox.findUnique({ where: { id: outboxId }, select: OUTBOX_ROW_SELECT });
    if (!row || row.status !== 'PENDING') return;
    const write = (data: Prisma.OdooOutboxUpdateInput) => this.prisma.odooOutbox.update({ where: { id: row.id }, data, select: { id: true } });

    // a cancel that lost the race with the payment refunded the card after the order was queued
    if (row.order.paymentStatus === 'REFUNDED') {
      await write({ status: 'FAILED', lastError: 'ORDER_REFUNDED' });
      return;
    }
    const odoo = this.writer();
    if (!odoo) {
      await write({ lastError: 'ODOO_WRITE_NOT_CONFIGURED', nextAttemptAt: new Date(now.getTime() + NOT_CONFIGURED_WAIT_MS) });
      return;
    }

    try {
      const sent = await this.send(odoo, row, write);
      await write({ status: 'DONE', lastError: null, odooPartnerId: sent.partnerId, odooSaleOrderId: sent.saleOrderId });
    } catch (err) {
      const attempts = row.attempts + 1;
      // a product Odoo does not know: retrying cannot fix it, someone has to (then Finance presses Retry)
      const next = err instanceof OdooMappingError ? null : nextAttemptAt(attempts, now);
      const lastError = err instanceof OdooMappingError ? this.errorText(`${err.code}: ${err.productNames.join(', ')}`) : this.errorText(err);
      await write({ attempts, lastError, ...(next ? { nextAttemptAt: next } : { status: 'FAILED' }) });
    }
  }

  /**
   * Partner (found by phone, else created), sale order, confirmation. The sale
   * order's id is stored as soon as Odoo answers it, so a later try only
   * confirms that order instead of creating a second one.
   */
  private async send(
    odoo: OdooWriter,
    row: OutboxRow,
    write: (data: Prisma.OdooOutboxUpdateInput) => Promise<unknown>,
  ): Promise<{ partnerId: number; saleOrderId: number }> {
    if (row.odooSaleOrderId !== null && row.odooPartnerId !== null) {
      const [sale] = await odoo.searchRead<{ state: string }>('sale.order', [['id', '=', row.odooSaleOrderId]], ['state']);
      if (!sale) throw new Error(`Sale order ${row.odooSaleOrderId} is no longer in Odoo`);
      if (UNCONFIRMED.has(sale.state)) await odoo.call('sale.order', 'action_confirm', [row.odooSaleOrderId]);
      return { partnerId: row.odooPartnerId, saleOrderId: row.odooSaleOrderId };
    }

    const order = outboxOrder(row.order);
    // an empty phone would match every partner without one
    if (!order.customerPhone) throw new Error('The order has no phone number');
    const [found] = await odoo.searchRead<{ id: number }>('res.partner', partnerDomain(order.customerPhone), ['id']);
    const partnerId = found?.id ?? (await odoo.create('res.partner', partnerValues(order)));
    const saleOrderId = await odoo.create('sale.order', saleOrderValues(order, partnerId, this.mappingOptions()));
    await write({ odooPartnerId: partnerId, odooSaleOrderId: saleOrderId });
    await odoo.call('sale.order', 'action_confirm', [saleOrderId]);
    return { partnerId, saleOrderId };
  }

  /** ODOO_WEB_WAREHOUSE_ID and ODOO_FALLBACK_PRODUCT_ID, only those that are set. */
  private mappingOptions(): { warehouseId?: number; fallbackProductId?: number } {
    const warehouseId = this.config.get('ODOO_WEB_WAREHOUSE_ID', { infer: true });
    const fallbackProductId = this.config.get('ODOO_FALLBACK_PRODUCT_ID', { infer: true });
    return { ...(warehouseId ? { warehouseId } : {}), ...(fallbackProductId ? { fallbackProductId } : {}) };
  }

  /** An error as stored and logged: the write key cut out, no NUL (Postgres refuses it), at most 600 characters. */
  private errorText(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    const key = this.config.get('ODOO_WRITE_API_KEY', { infer: true });
    const clean = (key ? message.split(key).join('***') : message).split('\u0000').join('');
    return (clean || 'unknown error').slice(0, LAST_ERROR_MAX);
  }

  /** Finance's "Retry": back to PENDING, now, error cleared. 404 when the order has no outbox row; a DONE row is left as it is. */
  async retry(orderId: string): Promise<void> {
    const row = await this.prisma.odooOutbox.findUnique({ where: { orderId }, select: { status: true } });
    if (!row) throw notQueued();
    // already in Odoo: sending it again would only confirm the same sale order
    if (row.status === 'DONE') return;
    const { count } = await this.prisma.odooOutbox.updateMany({ where: { orderId }, data: { status: 'PENDING', nextAttemptAt: new Date(), lastError: null } });
    if (count === 0) throw notQueued();
  }

  /** For the order detail; null when the order has no outbox row (showroom orders). */
  async statusFor(orderId: string): Promise<OdooOrderStatus | null> {
    const row = await this.prisma.odooOutbox.findUnique({
      where: { orderId },
      select: { status: true, odooSaleOrderId: true, attempts: true, lastError: true, nextAttemptAt: true },
    });
    if (!row) return null;
    return {
      status: row.status,
      saleOrderId: row.odooSaleOrderId,
      attempts: row.attempts,
      lastError: row.lastError,
      nextAttemptAt: row.status === 'FAILED' ? null : row.nextAttemptAt.toISOString(),
    };
  }
}

const notQueued = () =>
  new NotFoundException({ statusCode: 404, error: 'Not Found', code: 'ODOO_NOT_QUEUED', message: 'This order is not sent to Odoo.' });
