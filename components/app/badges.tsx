"use client";

import { useTranslations } from "next-intl";
import type { OrderStatusName, OrderSummary, PaymentStatusName, RoleName } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const BADGE = "inline-flex items-center rounded-[6px] px-2 py-0.5 text-[13px] font-bold";

const STATUS_CLASS: Record<OrderStatusName, string> = {
  PENDING: "bg-warning-soft text-warning",
  CONFIRMED: "bg-success-soft text-success",
  CANCELLED: "bg-sand text-muted line-through decoration-1",
};

export function OrderStatusBadge({ status }: { status: OrderStatusName }) {
  const t = useTranslations("Common.orderStatus");
  return <span className={cn(BADGE, STATUS_CLASS[status])}>{t(status)}</span>;
}

/**
 * A web order's payment next to its status: PAID (success) or "Collected"
 * (neutral) once handed over, PENDING "Awaiting payment" (warning), REFUNDED
 * (neutral); NONE (showroom orders) renders nothing.
 */
export function PaymentBadge({ status, collected }: { status: PaymentStatusName; collected?: boolean }) {
  const t = useTranslations("Orders");
  if (status === "NONE") return null;
  if (status === "PAID" && collected) return <span className={cn(BADGE, "bg-sand text-ink-2")}>{t("collected")}</span>;
  if (status === "PAID") return <span className={cn(BADGE, "bg-success-soft text-success")}>{t("paymentPaid")}</span>;
  if (status === "PENDING") return <span className={cn(BADGE, "bg-warning-soft text-warning")}>{t("paymentPending")}</span>;
  return <span className={cn(BADGE, "bg-sand text-ink-2")}>{t("paymentRefunded")}</span>;
}

/**
 * The payment badge an order shows in the list and the detail: none for a
 * showroom order (paid at the till), nor for a web order cancelled before it
 * was paid (the status badge already says it is cancelled).
 */
export function OrderPaymentBadge({ order }: { order: Pick<OrderSummary, "source" | "status" | "paymentStatus" | "collectedAt"> }) {
  if (order.source !== "WEB" || (order.status === "CANCELLED" && order.paymentStatus === "PENDING")) return null;
  return <PaymentBadge status={order.paymentStatus} collected={order.collectedAt !== null} />;
}

export function RoleBadge({ role }: { role: RoleName }) {
  const t = useTranslations("Common.roles");
  return <span className="inline-flex items-center rounded-[6px] bg-sand px-2 py-0.5 text-[13px] font-bold text-ink-2">{t(role)}</span>;
}

export function Pill({ tone = "neutral", children }: { tone?: "neutral" | "success" | "warning" | "danger"; children: React.ReactNode }) {
  const tones = {
    neutral: "bg-sand text-ink-2",
    success: "bg-success-soft text-success",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
  };
  return <span className={cn("inline-flex items-center gap-1 rounded-[6px] px-2 py-0.5 text-[13px] font-bold", tones[tone])}>{children}</span>;
}
