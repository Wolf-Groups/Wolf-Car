import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Env, notifyEmails } from '../../config/env';
import { EMAIL_SENDER, type EmailMessage, type EmailSender } from '../../email/email-sender';
import { PrismaService } from '../../prisma/prisma.service';
import { orderKey } from '../checkout/order-key';
import { WEB_ORDER_SELECT, webOrderView, type WebOrderView } from '../checkout/web-order.view';
import { orderPaidEmail, orderPlacedEmail, staffOrderEmail } from './order-emails';
import type { EmailContent } from './sign-in-code.email';

/**
 * The emails a web order sends: to the customer in the language they ordered
 * in, with a link that opens the order by its key, and an alert to the shop
 * (SHOP_NOTIFY_EMAIL). Best effort: a failure is logged and never reaches the
 * order or the payment that triggered it, so these methods never reject.
 */
@Injectable()
export class OrderEmailsService {
  private readonly logger = new Logger(OrderEmailsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @Inject(EMAIL_SENDER) private readonly mailer: EmailSender,
  ) {}

  /** An order to pay at the branch was placed. */
  placed(orderId: string): Promise<void> {
    return this.notify(orderId, (order, locale) => orderPlacedEmail(order, locale, this.orderLink(order.id, locale)));
  }

  /** A card payment was captured: the receipt. */
  paid(orderId: string): Promise<void> {
    return this.notify(orderId, (order, locale) => orderPaidEmail(order, locale, this.orderLink(order.id, locale)));
  }

  private async notify(orderId: string, render: (order: WebOrderView, locale: 'ar' | 'en') => EmailContent): Promise<void> {
    let order: WebOrderView;
    let locale: 'ar' | 'en';
    try {
      const row = await this.prisma.order.findUnique({ where: { id: orderId }, select: { ...WEB_ORDER_SELECT, customerLocale: true } });
      if (!row) return;
      order = webOrderView(row);
      locale = row.customerLocale === 'en' ? 'en' : 'ar';
    } catch (err) {
      this.logger.warn(`Emails for order ${orderId} not sent: ${reason(err)}`);
      return;
    }
    if (order.customer.email) await this.send(order, { to: [order.customer.email], ...render(order, locale) });
    const staff = notifyEmails({ SHOP_NOTIFY_EMAIL: this.config.get('SHOP_NOTIFY_EMAIL', { infer: true }) });
    if (staff.length > 0) await this.send(order, { to: staff, ...staffOrderEmail(order, this.webLink('/ar/dashboard/orders')) });
  }

  private async send(order: WebOrderView, message: EmailMessage): Promise<void> {
    try {
      await this.mailer.send(message);
    } catch (err) {
      this.logger.warn(`Email "${message.subject}" for order ${order.code} not sent: ${reason(err)}`);
    }
  }

  /** The return page, which shows the order to whoever holds its key. */
  private orderLink(orderId: string, locale: 'ar' | 'en'): string | null {
    return this.webLink(`/${locale}/checkout/return?order=${orderId}&key=${orderKey(orderId, this.config.get('JWT_ACCESS_SECRET', { infer: true }))}`);
  }

  /** WEB_PUBLIC_URL + path, or null when the website's address is not configured. */
  private webLink(path: string): string | null {
    const base = this.config.get('WEB_PUBLIC_URL', { infer: true });
    return base ? `${base.replace(/\/+$/, '')}${path}` : null;
  }
}

const reason = (err: unknown) => (err instanceof Error ? err.message : 'unknown error');
