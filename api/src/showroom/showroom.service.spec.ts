import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { mock, mockDeep } from 'jest-mock-extended';
import { authUser } from '../../test/unit/helpers';
import type { AuditTrail } from '../activity/audit-trail.service';
import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { ServicesService } from '../services/services.service';
import { ShowroomService } from './showroom.service';

describe('ShowroomService', () => {
  const prisma = mockDeep<PrismaService>();
  const trail = mock<AuditTrail>();
  const services = mock<ServicesService>();
  const service = new ShowroomService(prisma, trail, services);
  const user = authUser({ id: 'u-1', role: 'CASHIER', branchId: 'gh', audience: 'SHOWROOM' }, ['order.create']);
  const dto = { userId: 'u-1', customerName: 'Sara', items: [{ productId: 'p1', quantity: 2 }, { productId: 'p2', quantity: 1 }] };

  beforeEach(() => {
    jest.resetAllMocks();
    for (const m of ['setEntity', 'setChange', 'setBranch'] as const) trail[m].mockReturnValue(trail);
    prisma.$transaction.mockImplementation((fn: unknown) => (fn as (tx: unknown) => unknown)(prisma) as never);
    prisma.branch.findUnique.mockResolvedValue({ id: 'gh', code: 'GH', name: 'GH', nameAr: 'GH', isActive: true } as never);
    prisma.branch.update.mockResolvedValue({ orderSeq: 42, code: 'GH' } as never);
    prisma.order.create.mockResolvedValue({ id: 'o-1' } as never);
    prisma.order.findUniqueOrThrow.mockResolvedValue({
      id: 'o-1', code: 'GH-000042', number: 42, status: 'PENDING', customerName: 'Sara', total: new Prisma.Decimal('250'), currency: 'QAR',
      createdAt: new Date(), updatedAt: new Date(), confirmedAt: null, cancelledAt: null,
      branch: { id: 'gh', code: 'GH', name: 'GH', nameAr: 'GH' }, createdBy: { id: 'u-1', username: 'x', displayName: 'x' },
      confirmedBy: null, cancelledBy: null, _count: { items: 2 }, items: [],
      // what ORDER_DETAIL_SELECT reads for a showroom order since the web-order fields
      source: 'SHOWROOM', paymentStatus: 'NONE', paidAt: null, collectedAt: null, customerPhone: null, customerEmail: null, collectedBy: null, payments: [],
    } as never);
  });

  it('refuses a userId that is not the signed-in user', async () => {
    await expect(service.createOrder(user, { ...dto, userId: 'someone-else' }, undefined)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('derives the branch from the session and snapshots prices and names', async () => {
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', name: 'Dash Cam', price: new Prisma.Decimal('100') },
      { id: 'p2', name: 'Mats', price: new Prisma.Decimal('50') },
    ] as never);
    await service.createOrder(user, dto, undefined);
    const data = prisma.order.create.mock.calls[0][0].data as {
      branchId: string; code: string; total: Prisma.Decimal; items: { create: { productName: string; unitPrice: Prisma.Decimal; lineTotal: Prisma.Decimal }[] };
    };
    expect(data.branchId).toBe('gh');
    expect(data.code).toBe('GH-000042');
    expect(data.total.toFixed(2)).toBe('250.00');
    expect(data.items.create.map((i) => [i.productName, i.unitPrice.toFixed(2), i.lineTotal.toFixed(2)])).toEqual([
      ['Dash Cam', '100.00', '200.00'],
      ['Mats', '50.00', '50.00'],
    ]);
    // only priced products that belong to this branch's catalogue are accepted
    expect(prisma.product.findMany.mock.calls[0][0]?.where).toMatchObject({
      price: { not: null },
      AND: [
        // a part must be on this branch's list; a service is sold at every branch
        { OR: [{ branchPositions: { some: { branchId: 'gh' } } }, { service: { isActive: true } }] },
        // and Odoo must not have run out of it
        { OR: [{ odooStock: null }, { odooStock: { gt: 0 } }] },
      ],
    });
  });

  it('rejects unavailable (unknown or unpriced) products', async () => {
    prisma.product.findMany.mockResolvedValue([{ id: 'p1', name: 'Dash Cam', price: new Prisma.Decimal('100') }] as never);
    await expect(service.createOrder(user, dto, undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('returns the original order for a repeated idempotency key', async () => {
    prisma.order.findUnique.mockResolvedValue({ ...(await prisma.order.findUniqueOrThrow({ where: { id: 'o-1' } })) } as never);
    const result = await service.createOrder(user, dto, 'checkout-12345678');
    expect(result.replayed).toBe(true);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('refuses inactive branches', async () => {
    prisma.branch.findUnique.mockResolvedValue({ id: 'gh', isActive: false } as never);
    await expect(service.products(user)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
