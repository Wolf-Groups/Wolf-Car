import type { WebOrderView } from '../checkout/web-order.view';
import { orderPaidEmail, orderPlacedEmail, staffOrderEmail } from './order-emails';

const order = (over: Partial<WebOrderView> = {}): WebOrderView => ({
  id: 'o-1',
  code: 'BO-000124',
  status: 'PENDING',
  paymentStatus: 'NONE',
  paymentMethod: 'branch',
  total: '619.50',
  currency: 'QAR',
  createdAt: '2026-11-04T09:00:00.000Z',
  expiresAt: null,
  paidAt: null,
  collectedAt: null,
  branch: { code: 'BO', name: 'Bin Omran branch', nameAr: 'فرع بن عمران' },
  customer: { name: 'Sara Al-Mansouri', email: 'sara@example.com', phone: '+97455123456' },
  items: [
    { productId: 'p1', productName: 'Dash Cam', unitPrice: '499.00', quantity: 1, lineTotal: '499.00', thumbUrl: '' },
    { productId: 'p2', productName: 'Floor Mats', unitPrice: '60.25', quantity: 2, lineTotal: '120.50', thumbUrl: '' },
  ],
  lastPayment: null,
  ...over,
});

const LINK = 'https://wolfcar.qa/en/checkout/return?order=o-1&key=abc';

describe('orderPlacedEmail (pay at the branch)', () => {
  it.each(['ar', 'en'] as const)('names the order code in the subject and lists the lines and total (%s)', (locale) => {
    const mail = orderPlacedEmail(order(), locale, LINK);
    expect(mail.subject).toContain('BO-000124');
    for (const part of [mail.html, mail.text]) {
      expect(part).toContain('Dash Cam');
      expect(part).toContain('Floor Mats');
      expect(part).toContain('619.50');
      // the branch calls this number to confirm
      expect(part).toContain('5512 3456');
    }
    expect(mail.html).toContain('href="https://wolfcar.qa/en/checkout/return?order=o-1&amp;key=abc"');
  });

  it('thanks the customer by first name and says what happens next', () => {
    const en = orderPlacedEmail(order(), 'en', LINK);
    expect(en.text).toContain('Thank you, Sara!');
    expect(en.text).toMatch(/call you/i);
    expect(en.text).toMatch(/pay.*Bin Omran branch/i);
    const ar = orderPlacedEmail(order(), 'ar', LINK);
    expect(ar.text).toContain('شكراً لك يا Sara!');
    expect(ar.text).toContain('فرع بن عمران');
    expect(ar.html).toContain('dir="rtl"');
  });

  it('isolates the phone left to right, so the Arabic sentence cannot reverse its digit groups', () => {
    const ar = orderPlacedEmail(order(), 'ar', LINK);
    expect(ar.text).toContain('\u2066+974 5512 3456\u2069');
    expect(ar.html).toContain('\u2066+974 5512 3456\u2069');
    expect(orderPaidEmail(order({ paymentStatus: 'PAID', paidAt: '2026-11-04T10:15:00.000Z' }), 'ar', LINK).text).toContain('\u2066+974 5512 3456\u2069');
  });

    it('escapes what the customer typed', () => {
    const mail = orderPlacedEmail(order({ customer: { name: '<b>Sara</b>', email: 'sara@example.com', phone: '+97455123456' } }), 'en', LINK);
    expect(mail.html).not.toContain('<b>Sara</b>');
    expect(mail.html).toContain('&lt;b&gt;Sara&lt;/b&gt;');
  });

  it('leaves the button out without a website address', () => {
    expect(orderPlacedEmail(order(), 'en', null).html).not.toContain('href=');
  });
});

describe('orderPaidEmail (receipt)', () => {
  const paid = order({ status: 'CONFIRMED', paymentStatus: 'PAID', paymentMethod: 'card', paidAt: '2026-11-04T10:15:00.000Z' });

  it.each(['ar', 'en'] as const)('is a receipt: code, lines, the amount paid and when (%s)', (locale) => {
    const mail = orderPaidEmail(paid, locale, LINK);
    expect(mail.subject).toContain('BO-000124');
    expect(mail.text).toContain('619.50');
    expect(mail.text).toContain('Dash Cam');
    // 10:15 UTC is 13:15 in Doha
    expect(mail.text).toMatch(/1:15|13:15/);
  });

  it('tells the customer to bring the order code to the branch', () => {
    expect(orderPaidEmail(paid, 'en', LINK).text).toMatch(/Show your order code BO-000124/);
  });
});

describe('staffOrderEmail', () => {
  it('gives the branch the contact details, the lines and how it is paid', () => {
    const mail = staffOrderEmail(order(), 'https://wolfcar.qa/ar/dashboard/orders');
    expect(mail.subject).toContain('BO-000124');
    expect(mail.subject).toMatch(/pay at the branch/i);
    expect(mail.html).toContain('href="tel:+97455123456"');
    expect(mail.text).toContain('sara@example.com');
    expect(mail.text).toContain('Floor Mats');
    expect(mail.html).toContain('href="https://wolfcar.qa/ar/dashboard/orders"');
  });

  it('says a card order is already paid', () => {
    const mail = staffOrderEmail(order({ paymentStatus: 'PAID', paymentMethod: 'card', status: 'CONFIRMED' }), null);
    expect(mail.subject).toMatch(/paid by card/i);
  });
});
