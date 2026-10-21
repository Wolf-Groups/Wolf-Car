"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { OrderStatusBadge } from "@/components/app/badges";
import { PageHeader } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { usePendingRequests } from "@/features/bookings/ppf/queries";
import { useAuth } from "@/features/auth/auth-provider";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api/client";
import type { ActivityEntry, BranchView, OrderSummary, Page, Product } from "@/lib/api/types";
import { formatDateTime, formatMoney, formatRelative, qatarDay } from "@/lib/format";
import { msgKey } from "@/lib/i18n/keys";

function Stat({ label, value, href }: { label: string; value: number | undefined; href?: string }) {
  const body = (
    <div className="h-full rounded-[var(--radius-brand-lg)] border border-line bg-surface p-5 transition-colors hover:border-[#CFCBC4] dark:hover:border-[#3a3733]">
      <p className="text-sm font-bold text-ink-2">{label}</p>
      {value === undefined ? (
        <Skeleton className="mt-2 h-9 w-16" />
      ) : (
        <p className="mt-1 text-[32px] leading-tight font-extrabold tabular-nums">{value}</p>
      )}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-[var(--radius-brand-lg)]">
      {body}
    </Link>
  ) : (
    body
  );
}

const count = (path: string, query: Record<string, string | number>) => api<Page<unknown>>(path, { query: { ...query, pageSize: 1 } }).then((p) => p.total);

export function Overview() {
  const t = useTranslations();
  const locale = useLocale();
  const { user, can, canAny } = useAuth();
  const today = qatarDay(new Date());
  const readsOrders = canAny("order.read.branch", "order.read.all");
  const seesPpf = can("booking.ppf.read");
  const waitingRequests = usePendingRequests(seesPpf);

  // a pending web order is waiting for the customer's card, not for staff: only showroom orders count
  const pending = useQuery({ queryKey: ["stats", "pending"], queryFn: () => count("/orders", { status: "PENDING", source: "SHOWROOM" }), enabled: readsOrders });
  // the default list already leaves out web orders cancelled before any card was charged
  const ordersToday = useQuery({ queryKey: ["stats", "today", today], queryFn: () => count("/orders", { from: today, to: today }), enabled: readsOrders });
  const confirmedToday = useQuery({
    queryKey: ["stats", "confirmedToday", today],
    queryFn: () => count("/orders", { from: today, to: today, status: "CONFIRMED" }),
    enabled: readsOrders,
  });
  const products = useQuery({ queryKey: ["products", "all"], queryFn: () => api<Product[]>("/products"), enabled: can("product.read") });
  const users = useQuery({ queryKey: ["stats", "users"], queryFn: () => count("/users", {}), enabled: can("user.manage") });
  const branches = useQuery({ queryKey: ["branches"], queryFn: () => api<BranchView[]>("/branches"), enabled: can("branch.manage") });
  const recentOrders = useQuery({
    queryKey: ["orders", "recent"],
    queryFn: () => api<Page<OrderSummary>>("/orders", { query: { pageSize: 5 } }),
    enabled: readsOrders,
    refetchInterval: 15_000,
  });
  const activity = useQuery({
    queryKey: ["activity", "recent"],
    queryFn: () => api<Page<ActivityEntry>>("/activity", { query: { pageSize: 6 } }),
    enabled: can("activity.read"),
  });

  if (!user) return null;
  const unpriced = products.data?.filter((p) => p.price === null).length;

  return (
    <>
      <PageHeader title={t("Dashboard.greeting", { name: user.displayName })} subtitle={t(`Dashboard.subtitle.${user.role}`)} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {readsOrders && <Stat label={t("Dashboard.pendingOrders")} value={pending.data} href="/dashboard/orders?status=PENDING&source=SHOWROOM" />}
        {readsOrders && <Stat label={t("Dashboard.ordersToday")} value={ordersToday.data} href="/dashboard/orders" />}
        {readsOrders && <Stat label={t("Dashboard.confirmedToday")} value={confirmedToday.data} />}
        {seesPpf && <Stat label={t("Dashboard.waitingRequests")} value={waitingRequests} href="/dashboard/ppf-bookings" />}
        {can("product.read") && <Stat label={t("Dashboard.unpricedProducts")} value={unpriced} href="/dashboard/products?price=unpriced" />}
        {can("product.read") && <Stat label={t("Dashboard.totalProducts")} value={products.data?.length} href="/dashboard/products" />}
        {can("user.manage") && <Stat label={t("Dashboard.activeUsers")} value={users.data} href="/dashboard/users" />}
        {can("branch.manage") && <Stat label={t("Dashboard.branches")} value={branches.data?.length} href="/dashboard/branches" />}
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
        {readsOrders && (
          <section aria-labelledby="recent-orders" className="rounded-[var(--radius-brand-lg)] border border-line">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 id="recent-orders" className="font-extrabold">{t("Dashboard.recentOrders")}</h2>
              <Link href="/dashboard/orders" className="-my-2.5 inline-flex min-h-11 items-center gap-1 text-sm font-bold text-accent-ink hover:underline">
                {t("Dashboard.viewAll")}
                <ArrowUpRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
              </Link>
            </div>
            <ul className="divide-y divide-line">
              {recentOrders.data?.items.map((o) => (
                <li key={o.id}>
                  <Link href={`/dashboard/orders?open=${o.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-sand">
                    <span className="min-w-0">
                      <b dir="ltr" className="font-mono text-sm">{o.code}</b>
                      <span className="block truncate text-[15px] text-ink-2">{o.customerName}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="font-bold tabular-nums">{formatMoney(o.total, locale)}</span>
                      <OrderStatusBadge status={o.status} />
                    </span>
                  </Link>
                </li>
              ))}
              {recentOrders.data?.items.length === 0 && <li className="px-5 py-6 text-center text-muted">{t("Orders.empty")}</li>}
            </ul>
          </section>
        )}
        {can("activity.read") && (
          <section aria-labelledby="recent-activity" className="rounded-[var(--radius-brand-lg)] border border-line">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 id="recent-activity" className="font-extrabold">{t("Dashboard.recentActivity")}</h2>
              <Link href="/dashboard/activity" className="-my-2.5 inline-flex min-h-11 items-center gap-1 text-sm font-bold text-accent-ink hover:underline">
                {t("Dashboard.viewAll")}
                <ArrowUpRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
              </Link>
            </div>
            <ul className="divide-y divide-line">
              {activity.data?.items.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="min-w-0">
                    <b className="block text-[15px]">
                      {t.has(`Activity.actions.${msgKey(a.action)}`) ? t(`Activity.actions.${msgKey(a.action)}`) : a.action}
                      {a.outcome === "FAILURE" && <span className="ms-2 text-[13px] font-bold text-danger">{t("Activity.failure")}</span>}
                    </b>
                    <span dir="ltr" className="block truncate text-start font-mono text-[13px] text-muted">
                      {a.actor?.username ?? t("Activity.anonymous")}
                    </span>
                  </span>
                  <time className="shrink-0 text-[13px] text-muted" dateTime={a.occurredAt} title={formatDateTime(a.occurredAt, locale)}>
                    {formatRelative(a.occurredAt, locale)}
                  </time>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
