"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { OrderLines } from "@/features/shop/order-lines";
import { shop } from "@/features/shop/shop-api";
import { useCustomer } from "@/features/shop/use-customer";
import { Link } from "@/i18n/navigation";
import { ApiError } from "@/lib/api/client";
import type { WebOrder } from "@/lib/api/types";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Skeleton } from "./account";
import { orderState } from "./order-state";
import { SignIn } from "./sign-in";
import { StateBadge } from "./state-badge";

export interface OrderViewProps {
  /** a UUID (checked by the page) */
  orderId: string;
}

/** /account/orders/[id]: one of the customer's orders, after signing in if needed. */
export function OrderView({ orderId }: OrderViewProps) {
  const session = useCustomer();
  if (session.status === "loading") return <Skeleton />;
  if (session.status === "anonymous") return <SignIn onSignedIn={session.refresh} />;
  return <OrderDetails orderId={orderId} />;
}

function OrderDetails({ orderId }: OrderViewProps) {
  const t = useTranslations("Account");
  const [order, setOrder] = useState<WebOrder | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    shop.getOrder(orderId).then(
      (o) => live && setOrder(o),
      // 404 (not this customer's), 400 or anything else: the same "not found" with the way back
      (e: unknown) => live && setMissing(e instanceof ApiError || e instanceof Error),
    );
    return () => {
      live = false;
    };
  }, [orderId]);

  const back = (
    <Link href="/account" className={cn(buttonVariants({ variant: "outline" }), "justify-self-start")}>
      {t("backToOrders")}
    </Link>
  );

  if (missing)
    return (
      <div className="grid justify-items-start gap-4 rounded-[var(--radius-brand-lg)] border border-line bg-surface p-5 md:p-7">
        <p className="text-[17px] text-ink-2">{t("orderNotFound")}</p>
        {back}
      </div>
    );
  if (!order) return <Skeleton />;
  return (
    <div className="grid gap-5">
      <OrderCard order={order} />
      {back}
    </div>
  );
}

function OrderCard({ order }: { order: WebOrder }) {
  const t = useTranslations("Account");
  const locale = useLocale();
  const state = orderState(order);
  const branch = locale === "ar" ? order.branch.nameAr : order.branch.name;
  const note =
    state === "awaitingPayment"
      ? t("stateNote.awaitingPayment", { time: formatDateTime(order.expiresAt, locale) })
      : state === "paid"
        ? t("stateNote.paid", { branch })
        : state === "collected"
          ? t("stateNote.collected", { date: formatDate(order.collectedAt, locale) })
          : t(`stateNote.${state}`);

  return (
    <section className="grid gap-5 rounded-[var(--radius-brand-lg)] border border-line bg-surface p-5 md:p-7">
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[clamp(22px,4vw,28px)] leading-tight font-extrabold">
            <bdi>{t("orderTitle", { code: order.code })}</bdi>
          </h1>
          <StateBadge state={state} />
        </div>
        <p className="text-[13px] text-ink-2">{t("placedOn", { date: formatDate(order.createdAt, locale) })}</p>
        <p className="text-[15px] text-ink-2">{note}</p>
      </div>
      <OrderLines items={order.items} total={order.total} currency={order.currency} />
      {state === "awaitingPayment" && (
        <Link href={`/checkout?order=${order.id}`} className={cn(buttonVariants({ size: "lg" }), "justify-self-start")}>
          {t("continuePayment")}
        </Link>
      )}
    </section>
  );
}
