import { money } from '../common/money';
import type { OrderSource, OrderStatus, PaymentAttemptStatus, PaymentStatus, Prisma } from '../generated/prisma/client';
import type { OdooOrderStatus } from '../odoo/odoo-orders.service';
import { branchBarcode } from '../products/branch-barcodes';
import { imageUrl } from '../uploads/image-processing';

const PERSON = { select: { id: true, username: true, displayName: true } } as const;

export const ORDER_LIST_SELECT = {
  id: true,
  code: true,
  number: true,
  status: true,
  customerName: true,
  total: true,
  currency: true,
  createdAt: true,
  updatedAt: true,
  confirmedAt: true,
  cancelledAt: true,
  source: true,
  paymentStatus: true,
  paidAt: true,
  collectedAt: true,
  customerPhone: true,
  branch: { select: { id: true, code: true, name: true, nameAr: true } },
  createdBy: PERSON,
  confirmedBy: PERSON,
  cancelledBy: PERSON,
  _count: { select: { items: true } },
} as const;

export const ORDER_DETAIL_SELECT = {
  ...ORDER_LIST_SELECT,
  customerEmail: true,
  collectedBy: PERSON,
  /** The newest card attempt (web orders only). */
  payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { chargeId: true, status: true, failureCode: true, refundId: true, rawLast: true } },
  items: {
    orderBy: { position: 'asc' },
    select: {
      id: true,
      productId: true,
      productName: true,
      unitPrice: true,
      quantity: true,
      lineTotal: true,
      product: { select: { imageKey: true, barcode: true, odooTemplateId: true, variantLabel: true } },
    },
  },
} as const;

type Person = { id: string; username: string; displayName: string } | null;

interface OrderRow {
  id: string;
  code: string;
  number: number;
  status: OrderStatus;
  customerName: string;
  total: Prisma.Decimal;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  source: OrderSource;
  paymentStatus: PaymentStatus;
  paidAt: Date | null;
  collectedAt: Date | null;
  customerPhone: string | null;
  branch: { id: string; code: string; name: string; nameAr: string };
  createdBy: NonNullable<Person>;
  confirmedBy: Person;
  cancelledBy: Person;
  _count: { items: number };
}

interface OrderDetailRow extends OrderRow {
  customerEmail: string | null;
  collectedBy: Person;
  payments: { chargeId: string | null; status: PaymentAttemptStatus; failureCode: string | null; refundId: string | null; rawLast: Prisma.JsonValue }[];
  items: {
    id: string;
    productId: string;
    productName: string;
    unitPrice: Prisma.Decimal;
    quantity: number;
    lineTotal: Prisma.Decimal;
    product: { imageKey: string; barcode: string | null; odooTemplateId: number | null; variantLabel: string | null };
  }[];
}

export function orderSummary(o: OrderRow) {
  return {
    id: o.id,
    code: o.code,
    number: o.number,
    status: o.status,
    customerName: o.customerName,
    total: money(o.total),
    currency: o.currency,
    itemCount: o._count.items,
    branch: o.branch,
    createdBy: o.createdBy,
    confirmedBy: o.confirmedBy,
    confirmedAt: o.confirmedAt,
    cancelledBy: o.cancelledBy,
    cancelledAt: o.cancelledAt,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    source: o.source,
    paymentStatus: o.paymentStatus,
    paidAt: o.paidAt?.toISOString() ?? null,
    collectedAt: o.collectedAt?.toISOString() ?? null,
    customerPhone: o.customerPhone,
  };
}

/**
 * The newest card attempt as staff see it; null for showroom orders and unpaid
 * web orders without an attempt. `testMode`: Tap's stored charge says
 * live_mode false (a sandbox key, or the fake gateway).
 */
export type OrderPaymentView = {
  chargeId: string | null;
  status: PaymentAttemptStatus;
  failureCode: string | null;
  refundId: string | null;
  testMode: boolean;
} | null;

const isTestCharge = (raw: Prisma.JsonValue): boolean =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw) && raw.live_mode === false;

/**
 * `bases` comes from branchBarcodeBases for the order's branch: a branch whose
 * till is not Odoo scans a multi-colour product by its shared code. `odoo` is
 * the outbox state of a paid web order (OdooOrdersService.statusFor), null
 * for showroom orders.
 */
export function orderDetail(o: OrderDetailRow, bases: ReadonlyMap<number, string> | null = null, odoo: OdooOrderStatus | null = null) {
  const last = o.payments[0];
  const payment: OrderPaymentView = last
    ? { chargeId: last.chargeId, status: last.status, failureCode: last.failureCode, refundId: last.refundId, testMode: isTestCharge(last.rawLast) }
    : null;
  return {
    ...orderSummary(o),
    customerEmail: o.customerEmail,
    collectedBy: o.collectedBy,
    payment,
    odoo,
    items: o.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.productName,
      barcode: branchBarcode(i.product, bases),
      thumbUrl: imageUrl(i.product.imageKey, 'sm'),
      unitPrice: money(i.unitPrice),
      quantity: i.quantity,
      lineTotal: money(i.lineTotal),
    })),
  };
}

export type OrderSummary = ReturnType<typeof orderSummary>;
export type OrderDetail = ReturnType<typeof orderDetail>;

/** What the audit log stores for an order (no personal data beyond the customer name). */
export function orderAuditView(o: OrderDetail) {
  return {
    code: o.code,
    status: o.status,
    customerName: o.customerName,
    total: o.total,
    items: o.items.map((i) => ({ productId: i.productId, productName: i.productName, unitPrice: i.unitPrice, quantity: i.quantity })),
  };
}
