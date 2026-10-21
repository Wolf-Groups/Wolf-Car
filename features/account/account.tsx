"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { shop } from "@/features/shop/shop-api";
import { useCustomer } from "@/features/shop/use-customer";
import { Link } from "@/i18n/navigation";
import type { WebOrder } from "@/lib/api/types";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { localQatarNumber } from "@/shared/shop";
import { MyCars } from "./my-cars";
import { orderState } from "./order-state";
import { SignIn } from "./sign-in";
import { StateBadge } from "./state-badge";

/** "+97455123456" → "+974 5512 3456", isolated left-to-right so Arabic text around it cannot reorder it */
export const displayPhone = (e164: string) => {
  const local = localQatarNumber(e164);
  return `⁦+974 ${local.slice(0, 4)} ${local.slice(4)}⁩`;
};

export const Skeleton = () => <div aria-busy="true" className="h-56 animate-pulse rounded-[var(--radius-brand-lg)] border border-line bg-surface" />;

/** /account: sign in with the phone code, then the customer's number, sign out and their orders. */
export function Account() {
  const t = useTranslations("Account");
  const session = useCustomer();
  const [signingOut, setSigningOut] = useState(false);

  if (session.status === "loading") return <Skeleton />;
  if (session.status === "anonymous" || !session.customer) return <SignIn onSignedIn={session.refresh} />;

  const signOut = async () => {
    setSigningOut(true);
    await session.signOut();
    setSigningOut(false);
  };

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-brand-lg)] border border-line bg-surface px-5 py-4">
        <p className="text-[15px] font-semibold text-ink-2">
          {t("signedInAs", { phone: displayPhone(session.customer.phone) })}
        </p>
        <Button variant="outline" onClick={() => void signOut()} disabled={signingOut}>
          {t("signOut")}
        </Button>
      </div>
      <MyCars />
      <OrdersList />
    </div>
  );
}

function OrdersList() {
  const t = useTranslations("Account");
  const [orders, setOrders] = useState<WebOrder[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    setOrders(null);
    try {
      setOrders(await shop.listOrders());
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the list once on mount
    void load();
  }, [load]);

  return (
    <section className="grid gap-3">
      <h2 className="text-xl font-extrabold">{t("ordersTitle")}</h2>
      {failed ? (
        <div className="grid justify-items-start gap-3 rounded-[var(--radius-brand-lg)] border border-line bg-surface p-5">
          <p role="alert" className="text-[15px] text-ink-2">
            {t("ordersError")}
          </p>
          <Button variant="outline" onClick={() => void load()}>
            {t("retry")}
          </Button>
        </div>
      ) : orders === null ? (
        <Skeleton />
      ) : orders.length === 0 ? (
        <div className="grid justify-items-start gap-3 rounded-[var(--radius-brand-lg)] border border-line bg-surface p-5">
          <p className="text-[15px] text-ink-2">{t("ordersEmpty")}</p>
          <Link href="/products" className={cn(buttonVariants({ size: "lg" }))}>
            {t("browseProducts")}
          </Link>
        </div>
      ) : (
        <ul className="grid gap-3">
          {orders.map((order) => (
            <li key={order.id}>
              <OrderRow order={order} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OrderRow({ order }: { order: WebOrder }) {
  const t = useTranslations("Account");
  const locale = useLocale();
  const Chevron = locale === "ar" ? ChevronLeft : ChevronRight;
  const count = order.items.reduce((n, i) => n + i.quantity, 0);
  return (
    <Link
      href={`/account/orders/${order.id}`}
      className="flex items-center gap-4 rounded-[var(--radius-brand-lg)] border border-line bg-surface px-5 py-4 transition-colors hover:border-ink-2/40"
    >
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <b dir="ltr" className="font-mono text-[16px] font-extrabold tracking-wide">
            {order.code}
          </b>
          <StateBadge state={orderState(order)} />
        </div>
        <p className="text-[13px] text-ink-2">
          {t("placedOn", { date: formatDate(order.createdAt, locale) })} · {t("itemCount", { count })}
        </p>
      </div>
      <b className="shrink-0 text-[16px] font-extrabold tabular-nums">{formatMoney(order.total, locale)}</b>
      <Chevron aria-hidden="true" className="size-5 shrink-0 text-ink-2" />
    </Link>
  );
}
