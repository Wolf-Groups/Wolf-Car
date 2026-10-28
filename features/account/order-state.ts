import type { WebOrder } from "@/lib/api/types";

/** Where a web order stands, in the customer's words (messages Account.state.*). */
export type OrderState = "awaitingPayment" | "paid" | "collected" | "refunded" | "review" | "cancelled";

export function orderState(order: WebOrder, now = Date.now()): OrderState {
  if (order.paymentStatus === "REFUNDED") return "refunded";
  if (order.paymentStatus === "PAID") return order.collectedAt ? "collected" : "paid";
  // captured but held back (AMOUNT_MISMATCH, DUPLICATE_CAPTURE): the branch sorts it out
  if (order.lastPayment?.status === "CAPTURED") return "review";
  const open = order.status === "PENDING" && order.paymentStatus === "PENDING";
  if (open && (order.expiresAt === null || Date.parse(order.expiresAt) > now)) return "awaitingPayment";
  return "cancelled";
}
