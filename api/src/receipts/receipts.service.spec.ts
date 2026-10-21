import { ConflictException } from '@nestjs/common';
import { mock } from 'jest-mock-extended';
import { authUser } from '../../test/unit/helpers';
import type { AuditTrail } from '../activity/audit-trail.service';
import type { OrderDetail } from '../orders/order.view';
import type { OrdersService } from '../orders/orders.service';
import type { PdfRendererService } from './pdf-renderer.service';
import { ReceiptsService } from './receipts.service';

const order = (status: string, extra: Partial<Record<keyof OrderDetail, unknown>> = {}) =>
  ({
    id: 'o-1', code: 'GH-000007', status, customerName: 'Sara', currency: 'QAR', total: '10.00', createdAt: new Date(), confirmedAt: new Date(),
    branch: { id: 'gh', code: 'GH', name: 'GH', nameAr: 'غ' }, confirmedBy: { id: 'c', username: 'c', displayName: 'Cashier' },
    source: 'SHOWROOM', paymentStatus: 'NONE', paidAt: null, payment: null,
    items: [{ productName: 'A', barcode: '6291041500244', quantity: 1, unitPrice: '10.00', lineTotal: '10.00' }],
    ...extra,
  }) as unknown as OrderDetail;

describe('ReceiptsService', () => {
  const orders = mock<OrdersService>();
  const renderer = mock<PdfRendererService>();
  const trail = mock<AuditTrail>();
  const service = new ReceiptsService(orders, renderer, trail);
  const cashier = authUser({ role: 'CASHIER', branchId: 'gh' }, ['order.receipt.download']);

  beforeAll(async () => {
    await service.onModuleInit();
  });
  beforeEach(() => {
    jest.resetAllMocks();
    for (const m of ['setEntity', 'setBranch', 'addMetadata'] as const) trail[m].mockReturnValue(trail);
  });

  it('loads the order within the receipt scope and refuses unconfirmed orders', async () => {
    orders.get.mockResolvedValue(order('PENDING'));
    await expect(service.receipt(cashier, 'o-1', 'ar')).rejects.toBeInstanceOf(ConflictException);
    expect(orders.get).toHaveBeenCalledWith(cashier, 'o-1', { branchId: 'gh' });
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it('renders the localized receipt with embedded fonts and logo', async () => {
    orders.get.mockResolvedValue(order('CONFIRMED'));
    renderer.render.mockResolvedValue(Buffer.from('%PDF-1.7'));
    const result = await service.receipt(cashier, 'o-1', 'en');
    expect(result.filename).toBe('receipt-GH-000007.pdf');
    const html = renderer.render.mock.calls[0][0];
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('data:font/woff2;base64,');
    expect(html).toContain('data:image/png;base64,');
    expect(trail.addMetadata).toHaveBeenCalledWith({ code: 'GH-000007', locale: 'en' });
    // a showroom order keeps its scannable bars and has no online-payment line
    expect(html).toContain('class="bc"');
    expect(html).not.toContain('nothing to collect');
  });

  it('marks a paid web order as paid online, with no bars to scan at the till', async () => {
    orders.get.mockResolvedValue(
      order('CONFIRMED', {
        source: 'WEB',
        paymentStatus: 'PAID',
        paidAt: '2026-10-18T09:05:00.000Z',
        payment: { chargeId: 'chg_TS05A4120230736x9K22710693', status: 'CAPTURED', failureCode: null, refundId: null, testMode: false },
      }),
    );
    renderer.render.mockResolvedValue(Buffer.from('%PDF-1.7'));
    await service.receipt(cashier, 'o-1', 'en');
    const html = renderer.render.mock.calls[0][0];
    expect(html).toContain('Paid online by card — nothing to collect at the till');
    expect(html).toContain('22710693');
    expect(html).not.toContain('class="bc"');
  });
});
