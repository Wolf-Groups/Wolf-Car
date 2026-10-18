import type { OrderStatus, PaymentAttemptStatus, PaymentStatus, Prisma } from '../../generated/prisma/client';
import { todo } from '../todo';

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
  return todo('webOrderView', row);
}
