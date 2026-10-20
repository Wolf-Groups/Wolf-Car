import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AuditTrail } from '../activity/audit-trail.service';
import type { AuthUser } from '../common/types';
import { orderReceiptScope } from '../orders/order-scope';
import { OrdersService } from '../orders/orders.service';
import { PdfRendererService } from './pdf-renderer.service';
import { type ReceiptAssets, type ReceiptLocale, renderReceiptHtml } from './receipt-template';

const dataUrl = async (file: string, mime: string) => `data:${mime};base64,${(await readFile(file)).toString('base64')}`;

@Injectable()
export class ReceiptsService implements OnModuleInit {
  private assets: ReceiptAssets | null = null;

  constructor(
    private readonly orders: OrdersService,
    private readonly renderer: PdfRendererService,
    private readonly trail: AuditTrail,
  ) {}

  async onModuleInit(): Promise<void> {
    const fonts = path.dirname(require.resolve('@fontsource/cairo/package.json'));
    const font = (name: string) => dataUrl(path.join(fonts, 'files', name), 'font/woff2');
    this.assets = {
      fonts: {
        arabic400: await font('cairo-arabic-400-normal.woff2'),
        arabic700: await font('cairo-arabic-700-normal.woff2'),
        latin400: await font('cairo-latin-400-normal.woff2'),
        latin700: await font('cairo-latin-700-normal.woff2'),
      },
      logo: await dataUrl(path.resolve(process.cwd(), 'assets/logo.png'), 'image/png'),
    };
  }

  /** PDF receipt for a confirmed order in the user's scope (404 outside it). */
  async receipt(user: AuthUser, orderId: string, locale: ReceiptLocale): Promise<{ filename: string; pdf: Buffer }> {
    const order = await this.orders.get(user, orderId, orderReceiptScope(user));
    this.trail.setEntity('Order', order.id).setBranch(order.branch.id).addMetadata({ code: order.code, locale });
    if (order.status !== 'CONFIRMED') {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'ORDER_NOT_CONFIRMED',
        message: 'A receipt is available once the order is confirmed.',
      });
    }
    const html = renderReceiptHtml(
      {
        code: order.code,
        createdAt: order.createdAt,
        confirmedAt: order.confirmedAt,
        customerName: order.customerName,
        currency: order.currency,
        total: order.total,
        branch: order.branch,
        cashier: order.confirmedBy?.displayName ?? null,
        items: order.items,
        online:
          order.source === 'WEB'
            ? {
                paid: order.paymentStatus === 'PAID',
                paidAt: order.paidAt ? new Date(order.paidAt) : null,
                chargeId: order.payment?.chargeId ?? null,
              }
            : null,
      },
      locale,
      this.assets as ReceiptAssets,
    );
    return { filename: `receipt-${order.code}.pdf`, pdf: await this.renderer.render(html) };
  }
}
