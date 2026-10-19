import type { ConfigService } from '@nestjs/config';
import { mock, mockDeep } from 'jest-mock-extended';
import type { ActivityService } from '../../activity/activity.service';
import type { Env } from '../../config/env';
import type { PrismaService } from '../../prisma/prisma.service';
import { CheckoutExpiryService, IN_FLIGHT_MINUTES } from './checkout-expiry.service';
import { ensureSystemWebUser } from './system-web-user';

jest.mock('./system-web-user', () => ({ SYSTEM_WEB_USERNAME: 'system.web', ensureSystemWebUser: jest.fn() }));

describe('CheckoutExpiryService', () => {
  const prisma = mockDeep<PrismaService>();
  const activity = mock<ActivityService>();
  const config = { get: (key: string) => ({ NODE_ENV: 'test' })[key] } as unknown as ConfigService<Env, true>;
  const service = new CheckoutExpiryService(prisma, config, activity);
  const now = new Date('2026-10-18T10:00:00.000Z');

  /** Every cancellation write, whichever verb; the race test below then requires the conditional updateMany. */
  const cancellations = () =>
    [...prisma.order.update.mock.calls, ...prisma.order.updateMany.mock.calls].map((c) => c[0] as { where: Record<string, unknown>; data: Record<string, unknown> });

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(ensureSystemWebUser).mockResolvedValue('sys-web');
    prisma.$transaction.mockImplementation((arg: unknown) =>
      (typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as unknown[])) as never,
    );
    prisma.order.updateMany.mockResolvedValue({ count: 1 });
    activity.record.mockResolvedValue(undefined);
  });

  it('cancels unpaid web orders past their expiry, except those with a captured or in-flight attempt', async () => {
    prisma.order.findMany.mockResolvedValue([
      { id: 'o-1', branchId: 'bo' },
      { id: 'o-2', branchId: 'bo' },
    ] as never);

    expect(await service.sweep(now)).toBe(2);

    expect(IN_FLIGHT_MINUTES).toBe(15);
    expect(prisma.order.findMany.mock.calls[0][0]?.where).toEqual({
      source: 'WEB',
      status: 'PENDING',
      paymentStatus: 'PENDING',
      expiresAt: { lte: now },
      payments: { none: { OR: [{ status: 'CAPTURED' }, { status: 'INITIATED', createdAt: { gt: new Date(now.getTime() - 15 * 60_000) } }] } },
    });

    const writes = cancellations();
    expect(writes).toHaveLength(2);
    for (const id of ['o-1', 'o-2']) {
      const write = writes.find((w) => w.where.id === id);
      expect(write).toBeDefined();
      expect(write?.data).toMatchObject({ status: 'CANCELLED', cancelledAt: now, cancelledById: 'sys-web' });
    }

    expect(activity.record).toHaveBeenCalledTimes(2);
    for (const id of ['o-1', 'o-2']) {
      expect(activity.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'shop.order.expire',
          outcome: 'SUCCESS',
          entityType: 'Order',
          entityId: id,
          branchId: 'bo',
          actorId: null,
          actorUsername: 'system.web',
        }),
      );
    }
  });

  it('skips an order that was settled between the select and the write', async () => {
    prisma.order.findMany.mockResolvedValue([
      { id: 'o-1', branchId: 'bo' },
      { id: 'o-2', branchId: 'bo' },
    ] as never);
    // the writes follow the findMany order: o-1 was paid by a webhook meanwhile, so its guarded write matches nothing
    prisma.order.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });

    expect(await service.sweep(now)).toBe(1);

    expect(prisma.order.update).not.toHaveBeenCalled();
    const writes = prisma.order.updateMany.mock.calls.map((c) => c[0]);
    expect(writes).toHaveLength(2);
    for (const id of ['o-1', 'o-2']) {
      expect(writes.find((w) => w?.where?.id === id)?.where).toEqual({ id, status: 'PENDING', paymentStatus: 'PENDING', payments: { none: { status: 'CAPTURED' } } });
    }
    expect(activity.record).toHaveBeenCalledTimes(1);
    expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'shop.order.expire', entityId: 'o-2' }));
  });

  it('does nothing when no order is due', async () => {
    prisma.order.findMany.mockResolvedValue([]);
    expect(await service.sweep(now)).toBe(0);
    expect(cancellations()).toHaveLength(0);
    expect(activity.record).not.toHaveBeenCalled();
  });

  it('does not start a timer under NODE_ENV=test', () => {
    const spy = jest.spyOn(global, 'setInterval');
    service.onModuleInit();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    service.onModuleDestroy();
  });
});
