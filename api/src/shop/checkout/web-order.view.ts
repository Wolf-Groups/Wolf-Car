import { money } from '../../common/money';
import type { OrderStatus, PaymentAttemptStatus, PaymentStatus, Prisma } from '../../generated/prisma/client';
import { imageUrl } from '../../uploads/image-processing';

/** What the website is told about a customer's own order. No barcodes, no staff names. */
export const WEB_ORDER_SELECT = {
  id: true,
  code: true,
  status: true,
  paymentStatus: true,
  total: true,
  currency: true,
  createdAt: true,
  expiresAt: true,
  paidAt: true,
  customerName: true,
  customerEmail: true,
  customerPhone: true,
  customerId: true,
  branch: { select: { id: true, code: true, name: true, nameAr: true } },
  items: {
    orderBy: { position: 'asc' },
    select: { productId: true, productName: true, unitPrice: true, quantity: true, lineTotal: true, product: { select: { imageKey: true } } },
  },
  payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, failureCode: true, chargeId: true } },
} as const satisfies Prisma.OrderSelect;

export type WebOrderRow = Prisma.OrderGetPayload<{ select: typeof WEB_ORDER_SELECT }>;

export interface WebOrderView {
  id: string;
  code: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  /** "619.50" */
  total: string;
  currency: string;
  createdAt: string;
  expiresAt: string | null;
  paidAt: string | null;
  branch: { code: string; name: string; nameAr: string };
  customer: { name: string | null; email: string | null; phone: string };
  items: { productId: string; productName: string; unitPrice: string; quantity: number; lineTotal: string; thumbUrl: string }[];
  lastPayment: { status: PaymentAttemptStatus; failureCode: string | null } | null;
}

export function webOrderView(row: WebOrderRow): WebOrderView {
  const last = row.payments[0];
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    paymentStatus: row.paymentStatus,
    total: money(row.total),
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    branch: { code: row.branch.code, name: row.branch.name, nameAr: row.branch.nameAr },
    // a web order always carries the phone it was placed with
    customer: { name: row.customerName, email: row.customerEmail, phone: row.customerPhone ?? '' },
    items: row.items.map((i) => ({
      productId: i.productId,
      productName: i.productName,
      unitPrice: money(i.unitPrice),
      quantity: i.quantity,
      lineTotal: money(i.lineTotal),
      thumbUrl: imageUrl(i.product.imageKey, 'sm'),
    })),
    lastPayment: last ? { status: last.status, failureCode: last.failureCode } : null,
  };
}
