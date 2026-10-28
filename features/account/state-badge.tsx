"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { OrderState } from "./order-state";

const TONE: Record<OrderState, string> = {
  awaitingPayment: "bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200",
  paid: "bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-200",
  collected: "bg-sand text-ink-2",
  refunded: "bg-sky-100 text-sky-900 dark:bg-sky-400/15 dark:text-sky-200",
  review: "bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200",
  cancelled: "bg-sand text-ink-2",
};

export function StateBadge({ state, className }: { state: OrderState; className?: string }) {
  const t = useTranslations("Account.state");
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[13px] font-bold", TONE[state], className)}>{t(state)}</span>;
}
