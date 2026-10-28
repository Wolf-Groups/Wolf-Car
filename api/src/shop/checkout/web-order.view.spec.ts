import { Prisma } from '../../generated/prisma/client';
import { imageUrl } from '../../uploads/image-processing';
import { webOrderView, type WebOrderRow } from './web-order.view';

const row = (over: Partial<WebOrderRow> = {}): WebOrderRow => ({
  id: 'o-1',
  code: 'BO-000001',
  status: 'PENDING',
  paymentStatus: 'PENDING',
  total: new Prisma.Decimal('619.5'),
  currency: 'QAR',
  createdAt: new Date('2026-10-18T10:00:00.000Z'),
  expiresAt: new Date('2026-10-18T10:30:00.000Z'),
  paidAt: null,
  collectedAt: null,
  customerName: 'Sara Al Thani',
  customerEmail: 'sara@example.qa',
  customerPhone: '+97455123456',
  customerId: 'c-1',
  branch: { id: 'bo', code: 'BO', name: 'Bin Omran', nameAr: 'بن عمران' },
  items: [
    { productId: 'p1', productName: 'Dash Cam', unitPrice: new Prisma.Decimal('499'), quantity: 1, lineTotal: new Prisma.Decimal('499'), product: { imageKey: 'img-1' } },
    { productId: 'p2', productName: 'Floor Mats', unitPrice: new Prisma.Decimal('120.5'), quantity: 1, lineTotal: new Prisma.Decimal('120.5'), product: { imageKey: 'img-2' } },
  ],
  payments: [{ status: 'FAILED', failureCode: 'DECLINED', chargeId: 'chg_1' }],
  ...over,
});

describe('webOrderView', () => {
  it('maps money to strings, dates to ISO strings and the thumbnail to the small upload', () => {
    expect(webOrderView(row())).toEqual({
      id: 'o-1',
      code: 'BO-000001',
      status: 'PENDING',
      paymentStatus: 'PENDING',
      total: '619.50',
      currency: 'QAR',
      createdAt: '2026-10-18T10:00:00.000Z',
      expiresAt: '2026-10-18T10:30:00.000Z',
      paidAt: null,
      collectedAt: null,
      branch: { code: 'BO', name: 'Bin Omran', nameAr: 'بن عمران' },
      customer: { name: 'Sara Al Thani', email: 'sara@example.qa', phone: '+97455123456' },
      items: [
        { productId: 'p1', productName: 'Dash Cam', unitPrice: '499.00', quantity: 1, lineTotal: '499.00', thumbUrl: imageUrl('img-1', 'sm') },
        { productId: 'p2', productName: 'Floor Mats', unitPrice: '120.50', quantity: 1, lineTotal: '120.50', thumbUrl: imageUrl('img-2', 'sm') },
      ],
      lastPayment: { status: 'FAILED', failureCode: 'DECLINED' },
    });
    expect(imageUrl('img-1', 'sm')).toBe('/api/uploads/img-1-sm.webp');
  });

  it('shows a paid order with its paidAt and no payment outcome when there was no attempt', () => {
    const view = webOrderView(row({ paymentStatus: 'PAID', status: 'CONFIRMED', paidAt: new Date('2026-10-18T10:05:00.000Z'), expiresAt: null, payments: [] }));
    expect(view).toMatchObject({ paymentStatus: 'PAID', status: 'CONFIRMED', paidAt: '2026-10-18T10:05:00.000Z', expiresAt: null, lastPayment: null });
  });

  it('says when the branch handed a paid order over', () => {
    const view = webOrderView(row({ paymentStatus: 'PAID', status: 'CONFIRMED', collectedAt: new Date('2026-10-19T08:00:00.000Z') }));
    expect(view.collectedAt).toBe('2026-10-19T08:00:00.000Z');
  });

  it('never leaks a staff name or the customer id', () => {
    const view = webOrderView(row()) as unknown as Record<string, unknown>;
    expect(view).not.toHaveProperty('customerId');
    expect(view).not.toHaveProperty('createdBy');
  });
});
