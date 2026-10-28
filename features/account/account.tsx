"use client";

import { ChevronLeft, ChevronRight, type LucideIcon, PackageOpen, PackageSearch, UserRound } from "lucide-react";
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

/** A section heading of the account page, with its icon in the brand colour. */
export function SectionTitle({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-xl font-extrabold">
      <Icon aria-hidden="true" className="size-5 shrink-0 text-accent-ink" />
      {children}
    </h2>
  );
}

/** A card for a section with nothing in it yet (or that failed): icon, a line or two, and the one thing to do. */
export function EmptyState({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="grid justify-items-center gap-3 rounded-[var(--radius-brand-lg)] border border-line bg-surface px-5 py-8 text-center">
      <span aria-hidden="true" className="grid size-14 place-items-center rounded-full bg-sand text-ink-2">
        <Icon className="size-7" />
      </span>
      {children}
    </div>
  );
}

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
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-4 rounded-[var(--radius-brand-lg)] border border-line bg-surface p-5">
        <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-accent/10 text-accent-ink">
          <UserRound className="size-6" />
        </span>
        <p className="min-w-0 flex-1 basis-48 text-[15px] font-semibold text-ink-2">
          {t("signedInAs", { phone: displayPhone(session.customer.phone) })}
        </p>
        {/* a full-width button under the number on narrow screens, beside it otherwise */}
        <Button variant="outline" onClick={() => void signOut()} disabled={signingOut} className="w-full sm:w-auto">
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
      <SectionTitle icon={PackageSearch}>{t("ordersTitle")}</SectionTitle>
      {failed ? (
        <EmptyState icon={PackageSearch}>
          <p role="alert" className="text-[15px] text-ink-2">
            {t("ordersError")}
          </p>
          <Button variant="outline" onClick={() => void load()}>
            {t("retry")}
          </Button>
        </EmptyState>
      ) : orders === null ? (
        <Skeleton />
      ) : orders.length === 0 ? (
        <EmptyState icon={PackageOpen}>
          <p className="text-[15px] font-semibold">{t("ordersEmpty")}</p>
          <Link href="/products" className={cn(buttonVariants())}>
            {t("browseProducts")}
          </Link>
        </EmptyState>
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
