"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { RefreshCw, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { OrderStatusBadge } from "@/components/app/badges";
import { Field } from "@/components/app/field";
import { PageHeader } from "@/components/app/page-header";
import { PhoneFilters } from "@/components/app/phone-filters";
import { Pagination } from "@/components/app/pagination";
import { EmptyState, ErrorState, LoadingRows, NoAccess } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/features/auth/auth-provider";
import { isolate } from "@/features/products/bidi";
import { Segmented } from "@/features/products/segmented";
import { api } from "@/lib/api/client";
import type { BranchOption, OrderStatusName, OrderSummary } from "@/lib/api/types";
import { formatDateTime, formatMoney } from "@/lib/format";
import { fast } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { ORDER_STATUSES } from "@/shared/permissions";
import { DebouncedInput } from "./debounced-input";
import { OrderDetailSheet } from "./order-detail-sheet";
import { EMPTY_STATE, fetchOrders, hasFilters, type OrderFilters, orderKeys, PAGE_SIZE } from "./queries";
import { useOrdersUrlState } from "./use-url-state";

const ANY = "__any__";

/** Branch filter; receives id/aria-* from <Field> for its trigger. */
function BranchSelect({
  value,
  onChange,
  branches,
  ...aria
}: {
  value: string;
  onChange: (value: string) => void;
  branches: BranchOption[];
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const tc = useTranslations("Common");
  const locale = useLocale();
  return (
    <Select value={value || ANY} onValueChange={(v) => onChange(v === ANY ? "" : v)}>
      <SelectTrigger {...aria} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{tc("anyBranch")}</SelectItem>
        {branches.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {locale === "ar" ? b.nameAr : b.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function OrdersTable({
  orders,
  showBranch,
  openId,
  onOpen,
}: {
  orders: OrderSummary[];
  showBranch: boolean;
  openId: string | null;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("Orders");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const th = "h-11 px-3 text-start align-middle text-[13px] font-bold whitespace-nowrap text-muted";
  const td = "px-3 py-3 align-middle max-md:p-0";
  return (
    <div className="md:overflow-x-auto md:rounded-[var(--radius-brand-lg)] md:border md:border-line">
      <table className="w-full text-[15px] max-md:block">
        <caption className="sr-only">{t("title")}</caption>
        <thead className="border-b border-line bg-sand/60 max-md:hidden">
          <tr>
            <th scope="col" className={th}>
              {t("number")}
            </th>
            <th scope="col" className={th}>
              {t("customer")}
            </th>
            {showBranch && (
              <th scope="col" className={th}>
                {tc("branch")}
              </th>
            )}
            <th scope="col" className={th}>
              {t("items")}
            </th>
            <th scope="col" className={cn(th, "text-end")}>
              {t("total")}
            </th>
            <th scope="col" className={th}>
              {tc("status")}
            </th>
            <th scope="col" className={th}>
              {t("placedAt")}
            </th>
          </tr>
        </thead>
        <tbody className="max-md:grid max-md:grid-cols-1 max-md:gap-2">
          <AnimatePresence initial={false}>
            {orders.map((o) => (
              <motion.tr
                key={o.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={fast}
                onClick={() => onOpen(o.id)}
                aria-current={openId === o.id ? "true" : undefined}
                className={cn(
                  "cursor-pointer border-b border-line transition-colors last:border-b-0 hover:bg-sand/60",
                  "max-md:flex max-md:flex-wrap max-md:items-center max-md:gap-x-3 max-md:gap-y-1.5 max-md:rounded-[var(--radius-brand-lg)] max-md:border max-md:p-4 max-md:last:border-b",
                  openId === o.id && "bg-sand",
                )}
              >
                <td className={cn(td, "max-md:order-1 max-md:flex-1")}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(o.id);
                    }}
                    aria-label={t("openOrder", { code: o.code })}
                    className="rounded-[6px] font-mono text-sm font-bold text-accent-ink underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink"
                  >
                    <span dir="ltr">{o.code}</span>
                  </button>
                </td>
                <td className={cn(td, "font-bold max-md:order-3 max-md:w-full")}>
                  <p dir="auto" className="w-fit max-w-[220px] truncate max-md:max-w-full">
                    {o.customerName}
                  </p>
                </td>
                {showBranch && (
                  <td className={cn(td, "whitespace-nowrap text-ink-2 max-md:order-4 max-md:w-full max-md:text-sm")}>
                    {locale === "ar" ? o.branch.nameAr : o.branch.name}
                  </td>
                )}
                <td className={cn(td, "whitespace-nowrap text-ink-2 max-md:order-5 max-md:text-sm")}>{t("lines", { count: o.itemCount })}</td>
                <td className={cn(td, "text-end font-bold whitespace-nowrap tabular-nums max-md:order-6 max-md:ms-auto")}>
                  <span>{formatMoney(o.total, locale)}</span>
                </td>
                <td className={cn(td, "max-md:order-2")}>
                  <OrderStatusBadge status={o.status} />
                </td>
                <td className={cn(td, "text-sm whitespace-nowrap max-md:order-7 max-md:w-full")}>
                  <time dateTime={o.createdAt} className="block text-ink-2">
                    {formatDateTime(o.createdAt, locale)}
                  </time>
                  <span className="block text-[13px] text-muted">{tc("by", { name: isolate(o.createdBy.displayName) })}</span>
                </td>
              </motion.tr>
            ))}
          </AnimatePresence>
        </tbody>
      </table>
    </div>
  );
}

/**
 * Orders of the user's branch (or of every branch with order.read.all).
 * Filters and the open order live in the URL; the list polls every 10 s.
 */
export function OrdersPage() {
  const t = useTranslations("Orders");
  const { canAny } = useAuth();
  if (!canAny("order.read.branch", "order.read.all")) {
    return (
      <>
        <PageHeader title={t("title")} />
        <NoAccess permission="order.read.branch" />
      </>
    );
  }
  return <OrdersManager />;
}

function OrdersManager() {
  const t = useTranslations("Orders");
  const tc = useTranslations("Common");
  const { can } = useAuth();
  const [state, update] = useOrdersUrlState();
  const readsAll = can("order.read.all");

  const filters = useMemo<OrderFilters>(
    () => ({
      status: state.status,
      source: state.source,
      from: state.from,
      to: state.to,
      customerName: state.customerName,
      orderNumber: state.orderNumber,
      branchId: readsAll ? state.branchId : "",
      page: state.page,
    }),
    [state.status, state.source, state.from, state.to, state.customerName, state.orderNumber, state.branchId, state.page, readsAll],
  );
  const filtered = hasFilters(filters);

  const orders = useQuery({
    queryKey: orderKeys.list(filters),
    queryFn: () => fetchOrders(filters),
    placeholderData: keepPreviousData,
    refetchInterval: 10_000,
  });
  const branches = useQuery({
    queryKey: ["branches", "options"],
    queryFn: () => api<BranchOption[]>("/branches/options"),
    enabled: readsAll,
    staleTime: 5 * 60_000,
  });

  const setFilter = (patch: Partial<OrderFilters>) => update({ ...patch, page: 1 });
  const clear = () => update({ ...EMPTY_STATE, open: state.open });
  const subtitle = readsAll
    ? can("order.update") || can("order.confirm") || can("order.cancel")
      ? t("subtitleAdmin")
      : t("subtitleAll")
    : t("subtitleBranch");

  const statusOptions: { value: OrderStatusName | "ALL"; label: string }[] = [
    { value: "ALL", label: tc("all") },
    ...ORDER_STATUSES.map((s) => ({ value: s, label: tc(`orderStatus.${s}`) })),
  ];

  let body;
  if (orders.isPending) body = <LoadingRows rows={8} className="h-14" />;
  else if (orders.isError && !orders.data) body = <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />;
  else if (orders.data.items.length === 0)
    body = filtered ? (
      <EmptyState
        title={t("emptyFiltered")}
        action={
          <Button variant="outline" size="sm" onClick={clear}>
            {tc("clearFilters")}
          </Button>
        }
      />
    ) : (
      <EmptyState title={t("empty")} />
    );
  else
    body = (
      <div className={cn("transition-opacity", orders.isPlaceholderData && "opacity-60")} aria-busy={orders.isFetching}>
        <OrdersTable orders={orders.data.items} showBranch={readsAll} openId={state.open} onOpen={(id) => update({ open: id })} />
        <Pagination page={orders.data.page} pageSize={PAGE_SIZE} total={orders.data.total} onPageChange={(page) => update({ page })} />
      </div>
    );

  return (
    <>
      <PageHeader title={t("title")} subtitle={subtitle} />

      <section aria-label={tc("filters")} className="mb-4 grid grid-cols-1 gap-4 rounded-[var(--radius-brand-lg)] border border-line p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            label={tc("status")}
            value={state.status || "ALL"}
            options={statusOptions}
            onChange={(v) => setFilter({ status: v === "ALL" ? "" : v })}
          />
          {filtered && (
            <Button variant="ghost" size="sm" onClick={clear}>
              <X aria-hidden="true" />
              {tc("clearFilters")}
            </Button>
          )}
        </div>
        <PhoneFilters
          label={tc("filters")}
          active={[state.customerName, state.orderNumber, state.from, state.to, readsAll ? state.branchId : ""].filter(Boolean).length}
          className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", readsAll ? "xl:grid-cols-5" : "xl:grid-cols-4")}
        >
          <Field label={t("searchCustomer")}>
            <DebouncedInput type="search" dir="auto" autoComplete="off" value={state.customerName} onValueChange={(v) => setFilter({ customerName: v })} />
          </Field>
          <Field label={t("searchNumber")}>
            <DebouncedInput
              type="search"
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              placeholder={t("numberPlaceholder")}
              className="font-mono"
              value={state.orderNumber}
              onValueChange={(v) => setFilter({ orderNumber: v })}
            />
          </Field>
          <Field label={tc("dateFrom")}>
            <Input type="date" dir="ltr" value={state.from} max={state.to || undefined} onChange={(e) => setFilter({ from: e.target.value })} />
          </Field>
          <Field label={tc("dateTo")}>
            <Input type="date" dir="ltr" value={state.to} min={state.from || undefined} onChange={(e) => setFilter({ to: e.target.value })} />
          </Field>
          {readsAll && (
            <Field label={tc("branch")}>
              <BranchSelect value={state.branchId} onChange={(branchId) => setFilter({ branchId })} branches={branches.data ?? []} />
            </Field>
          )}
        </PhoneFilters>
      </section>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
        <p className="flex items-center gap-1.5">
          <RefreshCw className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
          {t("newOrdersHint")}
        </p>
        {orders.data && (
          <p className="tabular-nums" role="status" aria-live="polite">
            {tc("resultsCount", { count: orders.data.total })}
          </p>
        )}
      </div>

      {body}

      <OrderDetailSheet orderId={state.open} onClose={() => update({ open: null })} />
    </>
  );
}
