import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActivityService } from '../../activity/activity.service';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { ensureSystemWebUser, SYSTEM_WEB_USERNAME } from './system-web-user';

/** An INITIATED attempt younger than this keeps an expired order alive (a 3-D Secure page may still be open). */
export const IN_FLIGHT_MINUTES = 15;

/**
 * Cancels unpaid web orders past expiresAt, every minute (same pattern as
 * OdooSyncService: setInterval, unref, off in tests). Never touches an order
 * with a CAPTURED attempt or an attempt in flight. One activity entry
 * (shop.order.expire, actor system.web) per order.
 */
@Injectable()
export class CheckoutExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CheckoutExpiryService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly activity: ActivityService,
  ) {}

  onModuleInit(): void {
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;
    this.timer = setInterval(() => {
      // sweep is async, so a failure is always a rejection; never let one reach the process
      this.sweep().catch((err: unknown) => this.logger.error(`Order expiry sweep failed: ${err instanceof Error ? err.message : 'unknown error'}`));
    }, 60_000);
    // never keeps the process alive on shutdown
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** Returns how many orders were cancelled. */
  async sweep(now: Date = new Date()): Promise<number> {
    const due = await this.prisma.order.findMany({
      where: {
        source: 'WEB',
        status: 'PENDING',
        paymentStatus: 'PENDING',
        expiresAt: { lte: now },
        payments: { none: { OR: [{ status: 'CAPTURED' }, { status: 'INITIATED', createdAt: { gt: new Date(now.getTime() - IN_FLIGHT_MINUTES * 60_000) } }] } },
      },
      select: { id: true, branchId: true },
      orderBy: { expiresAt: 'asc' },
    });
    if (due.length === 0) return 0;

    const cancelledById = await ensureSystemWebUser(this.prisma);
    let cancelled = 0;
    for (const order of due) {
      // conditional: a payment settled since the select must not be cancelled
      const { count } = await this.prisma.order.updateMany({
        where: { id: order.id, status: 'PENDING', paymentStatus: 'PENDING', payments: { none: { status: 'CAPTURED' } } },
        data: { status: 'CANCELLED', cancelledAt: now, cancelledById },
      });
      if (count === 0) continue;
      cancelled += 1;
      await this.activity.record({
        action: 'shop.order.expire',
        outcome: 'SUCCESS',
        entityType: 'Order',
        entityId: order.id,
        branchId: order.branchId,
        actorId: null,
        actorUsername: SYSTEM_WEB_USERNAME,
      });
    }
    return cancelled;
  }
}
