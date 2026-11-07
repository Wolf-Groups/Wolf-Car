import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { mock, mockDeep } from 'jest-mock-extended';
import type { Env } from '../../config/env';
import type { EmailMessage, EmailSender } from '../../email/email-sender';
import { Prisma } from '../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { orderKey } from '../checkout/order-key';
import { OrderEmailsService } from './order-emails.service';

const SECRET = 'x'.repeat(40);

const row = (over: Record<string, unknown> = {}) => ({
  id: 'o-1',
  code: 'BO-000124',
  status: 'PENDING',
  paymentStatus: 'NONE',
  total: new Prisma.Decimal('619.50'),
  currency: 'QAR',
  createdAt: new Date('2026-11-04T09:00:00.000Z'),
  expiresAt: null,
  paidAt: null,
  collectedAt: null,
  customerName: 'Sara Al-Mansouri',
  customerEmail: 'sara@example.com',
  customerPhone: '+97455123456',
  customerId: 'c-1',
  customerLocale: 'ar',
  branch: { id: 'bo', code: 'BO', name: 'Bin Omran branch', nameAr: 'فرع بن عمران' },
  items: [{ productId: 'p1', productName: 'Dash Cam', unitPrice: new Prisma.Decimal('619.50'), quantity: 1, lineTotal: new Prisma.Decimal('619.50'), product: { imageKey: null } }],
  payments: [],
  ...over,
});

describe('OrderEmailsService', () => {
  const prisma = mockDeep<PrismaService>();
  const mailer = mock<EmailSender>();
  const configWith = (over: Record<string, unknown> = {}) =>
    ({ get: (key: string) => ({ WEB_PUBLIC_URL: 'https://wolfcar.qa/', JWT_ACCESS_SECRET: SECRET, SHOP_NOTIFY_EMAIL: 'shop@wolfcar.qa, manager@wolfcar.qa', ...over })[key] }) as unknown as ConfigService<Env, true>;
  const sent = () => mailer.send.mock.calls.map((c) => c[0] as EmailMessage);

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    mailer.send.mockResolvedValue(undefined);
    prisma.order.findUnique.mockResolvedValue(row() as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('placed: the customer gets the order in their language with a link that opens it, and the shop an alert', async () => {
    await new OrderEmailsService(prisma, configWith(), mailer).placed('o-1');
    const [customer, staff] = sent();
    expect(customer.to).toEqual(['sara@example.com']);
    expect(customer.html).toContain('dir="rtl"');
    // marked as the email's (from=email): opened again later, the page neither empties the basket nor counts the sale again
    const link = `https://wolfcar.qa/ar/checkout/return?order=o-1&key=${orderKey('o-1', SECRET)}&from=email`;
    expect(customer.html).toContain(`href="${link.replace(/&/g, '&amp;')}"`);
    expect(customer.text).toContain(link);
    expect(staff.to).toEqual(['shop@wolfcar.qa', 'manager@wolfcar.qa']);
    expect(staff.subject).toContain('BO-000124');
    expect(staff.html).toContain('https://wolfcar.qa/ar/dashboard/orders');
  });

  it('paid: the customer gets the receipt and the shop an alert', async () => {
    prisma.order.findUnique.mockResolvedValue(row({ status: 'CONFIRMED', paymentStatus: 'PAID', paidAt: new Date(), customerLocale: 'en' }) as never);
    await new OrderEmailsService(prisma, configWith(), mailer).paid('o-1');
    const [customer, staff] = sent();
    expect(customer.subject).toMatch(/Receipt/);
    expect(customer.text).toContain(`https://wolfcar.qa/en/checkout/return?order=o-1&key=${orderKey('o-1', SECRET)}&from=email`);
    expect(staff.subject).toMatch(/paid by card/i);
  });

  it('sends no alert when SHOP_NOTIFY_EMAIL is not set', async () => {
    await new OrderEmailsService(prisma, configWith({ SHOP_NOTIFY_EMAIL: undefined }), mailer).placed('o-1');
    expect(sent().map((m) => m.to)).toEqual([['sara@example.com']]);
  });

  it('leaves the links out without WEB_PUBLIC_URL', async () => {
    await new OrderEmailsService(prisma, configWith({ WEB_PUBLIC_URL: undefined }), mailer).placed('o-1');
    for (const mail of sent()) expect(mail.html).not.toContain('href="http');
  });

  it('never rejects: a failing send is logged and the other email still goes', async () => {
    mailer.send.mockRejectedValueOnce(new Error('Brevo is down'));
    await expect(new OrderEmailsService(prisma, configWith(), mailer).placed('o-1')).resolves.toBeUndefined();
    expect(mailer.send).toHaveBeenCalledTimes(2);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('BO-000124'));
  });

  it('never rejects when the order cannot be read either', async () => {
    prisma.order.findUnique.mockRejectedValue(new Error('db down'));
    await expect(new OrderEmailsService(prisma, configWith(), mailer).paid('o-1')).resolves.toBeUndefined();
    expect(mailer.send).not.toHaveBeenCalled();
  });
});
