import { escapeHtml, formatDate, formatMoney, renderReceiptHtml, type ReceiptData } from './receipt-template';

const assets = {
  fonts: { arabic400: 'data:a', arabic700: 'data:b', latin400: 'data:c', latin700: 'data:d' },
  logo: 'data:image/png;base64,AAAA',
};

const data: ReceiptData = {
  code: 'GH-000042',
  createdAt: new Date('2026-09-21T09:00:00Z'),
  confirmedAt: new Date('2026-09-21T10:30:00Z'),
  customerName: 'Sara <b>Al</b>-Mansouri',
  currency: 'QAR',
  total: '1118.50',
  branch: { name: 'Al Gharrafa Branch', nameAr: 'فرع الغرافة' },
  cashier: 'GH Cashier',
  items: [
    { productName: 'Dash Cam <script>alert(1)</script>', barcode: '6291041500244', quantity: 2, unitPrice: '499.00', lineTotal: '998.00' },
    { productName: 'عطر سيارة فاخر', barcode: null, quantity: 1, unitPrice: '120.50', lineTotal: '120.50' },
  ],
};

describe('receipt template', () => {
  it('prints scannable bars for an item that has a barcode', () => {
    const html = renderReceiptHtml(data, 'en', assets);
    // the PDF renders with JavaScript disabled, so the SVG must be inlined
    expect(html).toContain('class="bc"');
    expect(html).toContain('<svg');
    expect(html).toContain('6291041500244');
  });

  it('omits the bars for an item without a barcode', () => {
    const single = { ...data, items: [{ ...data.items[1] }] };
    expect(renderReceiptHtml(single, 'en', assets)).not.toContain('class="bc"');
  });

  it('falls back to no bars when the barcode is not CODE128-encodable', () => {
    // one legacy row had Arabic text in the barcode column
    const arabic = { ...data, items: [{ ...data.items[0], barcode: 'علبة مناديل' }] };
    const html = renderReceiptHtml(arabic, 'en', assets);
    expect(html).not.toContain('class="bc"');
  });

  it('escapes every dynamic value', () => {
    const html = renderReceiptHtml(data, 'en', assets);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('Dash Cam &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Sara &lt;b&gt;Al&lt;/b&gt;-Mansouri');
    expect(escapeHtml(`"'&`)).toBe('&quot;&#39;&amp;');
  });

  it('contains everything a receipt needs', () => {
    // Intl separates currency and amount with a no-break space
    const html = renderReceiptHtml(data, 'en', assets).replace(/\u00a0/g, ' ');
    for (const part of ['GH-000042', 'Al Gharrafa Branch', 'Grand total', 'QAR 998.00', 'QAR 1,118.50', 'GH Cashier', 'عطر سيارة فاخر']) {
      expect(html).toContain(part);
    }
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).toContain("default-src 'none'");
  });

  it('renders Arabic right-to-left with the Arabic branch name and Latin digits', () => {
    const html = renderReceiptHtml(data, 'ar', assets);
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain('فرع الغرافة');
    expect(html).toContain('الإجمالي الكلي');
    expect(formatMoney('1118.5', 'QAR', 'ar')).toMatch(/1,118\.50/);
  });

  describe('a web order paid online', () => {
    const web: ReceiptData = {
      ...data,
      online: { paid: true, paidAt: new Date('2026-09-21T10:05:00Z'), chargeId: 'chg_TS05A4120230736x9K22710693' },
    };

    it('says it is paid by card and that nothing is collected at the till, with the paid date and the end of the charge id', () => {
      const html = renderReceiptHtml(web, 'en', assets);
      expect(html).toContain('Paid online by card — nothing to collect at the till');
      expect(html).toContain(formatDate(new Date('2026-09-21T10:05:00Z'), 'en'));
      expect(html).toContain('22710693');
      expect(html).not.toContain('chg_TS05A4120230736x9K22710693');
    });

    it('says it in Arabic on the Arabic receipt', () => {
      const html = renderReceiptHtml(web, 'ar', assets);
      expect(html).toContain('مدفوع أونلاين بالبطاقة — لا يُحصَّل أي مبلغ عند الكاشير');
      expect(html).toContain(formatDate(new Date('2026-09-21T10:05:00Z'), 'ar'));
      expect(html).toContain('22710693');
    });

    it('prints no scannable bars, so its parts are not rung up at the till again', () => {
      for (const locale of ['en', 'ar'] as const) {
        const html = renderReceiptHtml(web, locale, assets);
        expect(html).not.toContain('class="bc"');
        expect(html).not.toContain('<svg');
      }
    });

    it('prints no bars for any web order, and the paid line only when it is paid', () => {
      const unpaid = renderReceiptHtml({ ...data, online: { paid: false, paidAt: null, chargeId: null } }, 'en', assets);
      expect(unpaid).not.toContain('class="bc"');
      expect(unpaid).not.toContain('nothing to collect');
    });

    it('leaves showroom receipts as they were', () => {
      const html = renderReceiptHtml(data, 'en', assets);
      expect(html).not.toContain('nothing to collect');
      expect(html).toContain('class="bc"');
    });
  });

  it('formats dates in Qatar time', () => {
    expect(formatDate(new Date('2026-09-21T22:30:00Z'), 'en')).toContain('Sep 22, 2026');
  });
});
