import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import type { OutboxStatus, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { todo } from '../shop/todo';
import type { OdooWriter } from './odoo-writer';

export interface OdooOrderStatus {
  status: OutboxStatus;
  saleOrderId: number | null;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string | null;
}

/**
 * Turns paid web orders into confirmed Odoo sale orders from the odoo_outbox
 * table: a timer every minute, one row at a time, backoff on failure, never in
 * the request path. Writes with the dedicated sales user
 * (ODOO_WRITE_LOGIN / ODOO_WRITE_API_KEY); without it rows wait with
 * lastError ODOO_WRITE_NOT_CONFIGURED. Steps and errors: the plan, Task 10.
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
    const env = this.config as unknown as { get(key: string): string | undefined };
    if (env.get('NODE_ENV') === 'test') return;
    this.timer = setInterval(() => void this.processDue().catch((err: Error) => this.logger.error(err.message)), 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** The writing connection, or null when ODOO_URL, ODOO_DB, ODOO_WRITE_LOGIN or ODOO_WRITE_API_KEY is missing. */
  protected writer(): OdooWriter | null {
    return todo('OdooOrdersService.writer', this.config);
  }

  /** Upserts the outbox row for a freshly paid order (called inside the settle transaction). */
  enqueue(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    return todo('OdooOrdersService.enqueue', tx, orderId);
  }

  /** Processes PENDING rows whose nextAttemptAt has passed (oldest first, up to 20). Returns how many were tried. Never runs twice at once. */
  processDue(now: Date = new Date()): Promise<number> {
    return todo('OdooOrdersService.processDue', this.prisma, this.running, now);
  }

  processOne(outboxId: string): Promise<void> {
    return todo('OdooOrdersService.processOne', outboxId);
  }

  /** Finance's "Retry": back to PENDING, now. 404 when the order has no outbox row. */
  retry(orderId: string): Promise<void> {
    return todo('OdooOrdersService.retry', orderId);
  }

  /** For the order detail; null when the order has no outbox row (showroom orders). */
  statusFor(orderId: string): Promise<OdooOrderStatus | null> {
    return todo('OdooOrdersService.statusFor', orderId);
  }
}
