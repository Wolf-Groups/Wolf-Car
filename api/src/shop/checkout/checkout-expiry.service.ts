import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActivityService } from '../../activity/activity.service';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsService, type SettleOutcome } from '../payments/payments.service';
import { ensureSystemWebUser, SYSTEM_WEB_USERNAME } from './system-web-user';

/** An INITIATED attempt younger than this keeps an expired order alive (a 3-D Secure page may still be open). */
export const IN_FLIGHT_MINUTES = 15;

/** Settle outcomes worth an activity entry from the sweep, and whether the entry is a FAILURE. */
const LOGGED_OUTCOMES: Partial<Record<SettleOutcome, 'SUCCESS' | 'FAILURE'>> = {
  paid: 'SUCCESS',
  amount_mismatch: 'FAILURE',
  duplicate_capture: 'FAILURE',
};

/**
 * Cancels unpaid web orders past expiresAt, every minute (same pattern as
 * OdooSyncService: setInterval, unref, off in tests). Never touches an order
 * with a CAPTURED attempt or an attempt in flight. Before cancelling, asks Tap
 * about the order's open attempts (a payment whose webhook never came pays
 * the order instead: shop.order.reconcile, via expiry); an order Tap cannot be
 * asked about waits for the next round. One activity entry (shop.order.expire,
 * actor system.web) per cancelled order.
 */
@Injectable()
export class CheckoutExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CheckoutExpiryService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly activity: ActivityService,
    private readonly payments: PaymentsService,
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
      if (!(await this.askTap(order))) continue;
      // conditional: a payment settled since the select (or just now by askTap) must not be cancelled
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

  /** settleBeforeExpiry, logged; false keeps the order for the next round (Tap or the database could not answer). */
  private async askTap(order: { id: string; branchId: string }): Promise<boolean> {
    let check;
    try {
      check = await this.payments.settleBeforeExpiry(order.id);
    } catch (err) {
      this.logger.warn(`Before expiring order ${order.id}: ${err instanceof Error ? err.message : 'unknown error'}`);
      return false;
    }
    for (const { chargeId, outcome } of check.settled) {
      const logged = LOGGED_OUTCOMES[outcome];
      if (!logged) continue;
      await this.activity.record({
        action: 'shop.order.reconcile',
        outcome: logged,
        entityType: 'Order',
        entityId: order.id,
        branchId: order.branchId,
        actorId: null,
        actorUsername: SYSTEM_WEB_USERNAME,
        metadata: { via: 'expiry', chargeId, outcome },
      });
    }
    if (!check.reachable) this.logger.warn(`Order ${order.id} expired but Tap could not be asked about its payment: kept for the next round`);
    return check.reachable;
  }
}
