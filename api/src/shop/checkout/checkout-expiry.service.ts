import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActivityService } from '../../activity/activity.service';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { todo } from '../todo';

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
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly activity: ActivityService,
  ) {}

  onModuleInit(): void {
    const env = this.config as unknown as { get(key: string): string | undefined };
    // Task 4 registers ShopModule while sweep is still a stub that throws; Task 7 removes this line so the timer runs.
    if (env.get('NODE_ENV') !== 'never') return;
    if (env.get('NODE_ENV') === 'test') return;
    this.timer = setInterval(() => void this.sweep().catch(() => undefined), 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** Returns how many orders were cancelled. */
  sweep(now: Date = new Date()): Promise<number> {
    return todo('CheckoutExpiryService.sweep', this.prisma, this.activity, now);
  }
}
