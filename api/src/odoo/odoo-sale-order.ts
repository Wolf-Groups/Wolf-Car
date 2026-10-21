/**
 * Maps a paid web order onto Odoo's res.partner and sale.order. Pure functions
 * only; OdooOrdersService does the I/O.
 */
import { localQatarNumber } from '../../../shared/shop';

export interface OutboxOrder {
  id: string;
  code: string;
  customerName: string;
  /** E.164 */
  customerPhone: string;
  customerEmail: string | null;
  /** "619.50" */
  total: string;
  currency: string;
  chargeId: string | null;
  paidAt: Date | null;
  items: { productName: string; quantity: number; unitPrice: string; odooId: number | null }[];
}

export const OUTBOX_MAX_ATTEMPTS = 24;

/** Thrown when a line cannot be sent: a product without an Odoo id and no ODOO_FALLBACK_PRODUCT_ID. Retrying cannot fix it. */
export class OdooMappingError extends Error {
  constructor(
    readonly code: 'PRODUCT_NOT_IN_ODOO',
    readonly productNames: string[],
  ) {
    super(`${code}: ${productNames.join(', ')}`);
    this.name = 'OdooMappingError';
  }
}

/** ['|', '|', '|', ['phone','=',e164], ['mobile','=',e164], ['phone','=',local], ['mobile','=',local]] */
export function partnerDomain(phone: string): unknown[] {
  const local = localQatarNumber(phone);
  return ['|', '|', '|', ['phone', '=', phone], ['mobile', '=', phone], ['phone', '=', local], ['mobile', '=', local]];
}

/** { name, phone, mobile, email (or false), customer_rank: 1, comment: 'Created by wolfcar.qa' } */
export function partnerValues(order: OutboxOrder): Record<string, unknown> {
  return {
    name: order.customerName,
    phone: order.customerPhone,
    mobile: order.customerPhone,
    email: order.customerEmail ?? false,
    customer_rank: 1,
    comment: 'Created by wolfcar.qa',
  };
}

/** partner_id, client_order_ref, origin, note with the Tap charge, optional warehouse_id, order_line [[0,0,{…}]]. */
export function saleOrderValues(order: OutboxOrder, partnerId: number, opts: { warehouseId?: number; fallbackProductId?: number } = {}): Record<string, unknown> {
  const { warehouseId, fallbackProductId } = opts;
  const missing = order.items.filter((item) => item.odooId === null).map((item) => item.productName);
  if (missing.length && !fallbackProductId) throw new OdooMappingError('PRODUCT_NOT_IN_ODOO', missing);
  return {
    partner_id: partnerId,
    client_order_ref: order.code,
    origin: 'wolfcar.qa',
    note: `Paid online · Tap charge ${order.chargeId} · QAR ${order.total}`,
    ...(warehouseId && { warehouse_id: warehouseId }),
    order_line: order.items.map((item) => [
      0,
      0,
      { product_id: item.odooId ?? fallbackProductId, name: item.productName, product_uom_qty: item.quantity, price_unit: Number(item.unitPrice) },
    ]),
  };
}

const RETRY_MINUTES = [1, 5, 15, 60];

/** When to try again after the attempt that just failed (`attempts` already incremented): 1, 5, 15, 60 min, then hourly; null at OUTBOX_MAX_ATTEMPTS. */
export function nextAttemptAt(attempts: number, now: Date): Date | null {
  if (attempts >= OUTBOX_MAX_ATTEMPTS) return null;
  const minutes = RETRY_MINUTES[attempts - 1] ?? 60;
  return new Date(now.getTime() + minutes * 60_000);
}
