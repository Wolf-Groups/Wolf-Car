"use client";

import { keepPreviousData, type QueryKey, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Wrench } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, ErrorState, LoadingRows, NoAccess } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/features/auth/auth-provider";
import { api } from "@/lib/api/client";
import type { BranchOption, Product } from "@/lib/api/types";
import { useErrorMessage } from "@/lib/api/use-error-message";
import { cn } from "@/lib/utils";
import { PriceDialog } from "./price-dialog";
import { PriceHistorySheet } from "./price-history-sheet";
import { ProductFormSheet } from "./product-form";
import { OdooSyncBar } from "./odoo-sync-bar";
import { ProductList } from "./product-list";
import type { RowActions, RowPermissions } from "./product-row";
import { fetchCategories, fetchProducts, parsePriceFilter, type PriceFilter, productKeys, type StockFilter } from "./queries";
import { Segmented } from "./segmented";
import { useDebouncedValue } from "./use-debounced-value";

const BY_NAME = "__name__";
const ALL_CATEGORIES = "__all__";
const REORDER_KEY = ["products", "reorder"] as const;

interface Overlay {
  open: boolean;
  product: Product | null;
}
const closed: Overlay = { open: false, product: null };

interface ReorderVars {
  ids: string[];
  branchId?: string;
  key: QueryKey;
  previous: Product[] | undefined;
}

/** Keeps ?price= in the address bar without a navigation (the dashboard links to ?price=unpriced). */
function writePriceParam(price: PriceFilter) {
  const params = new URLSearchParams(window.location.search);
  if (price === "all") params.delete("price");
  else params.set("price", price);
  const qs = params.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

/**
 * The shared catalogue. Branch staff see (and, with product.reorder, drag)
 * their showroom order; Finance prices products; the Super Admin can view or
 * reorder any branch. Every control is gated by permission, not by role.
 */
export function ProductsPage() {
  const t = useTranslations("Products");
  const { can } = useAuth();
  if (!can("product.read")) {
    return (
      <>
        <PageHeader title={t("title")} />
        <NoAccess permission="product.read" />
      </>
    );
  }
  return <ProductsManager />;
}

function ProductsManager() {
  const t = useTranslations("Products");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const { user, can } = useAuth();

  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim(), 250);
  const [price, setPrice] = useState<PriceFilter>(() => parsePriceFilter(searchParams.get("price")));
  const [quick, setQuick] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [stock, setStock] = useState<StockFilter>("all");
  const [pickedBranch, setPickedBranch] = useState<string | null>(null);
  const [form, setForm] = useState<Overlay>(closed);
  const [pricing, setPricing] = useState<Overlay>(closed);
  const [history, setHistory] = useState<Overlay>(closed);

  const ownBranch = user?.branch ?? null;
  const canCreate = can("product.create");
  const canReorder = can("product.reorder");
  const canPickBranch = !ownBranch && canReorder;
  const branchId = ownBranch ? null : pickedBranch;
  const branchContext = ownBranch?.id ?? pickedBranch;
  const filtered = q !== "" || price !== "all" || quick || categoryId !== null || stock !== "all";

  const params = { q, price, quick, branchId, categoryId, stock };
  const listKey = productKeys.list(params);
  const products = useQuery({ queryKey: listKey, queryFn: () => fetchProducts(params), placeholderData: keepPreviousData });
  const branches = useQuery({
    queryKey: ["branches", "options"],
    queryFn: () => api<BranchOption[]>("/branches/options"),
    enabled: canPickBranch,
    staleTime: 5 * 60_000,
  });
  const categories = useQuery({ queryKey: ["products", "categories"], queryFn: fetchCategories, staleTime: 5 * 60_000 });

  const reorderable = canReorder && branchContext !== null && !filtered && !products.isPlaceholderData;

  const permissions = useMemo<RowPermissions>(
    () => ({ canEdit: can("product.update.details"), canPrice: can("product.update.price"), canHistory: can("product.read") }),
    [can],
  );
  const quickService = useMutation({
    mutationFn: (product: Product) =>
      api<Product>(`/products/${product.id}/quick-service`, { method: "PUT", json: { quickService: !product.quickService } }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: productKeys.all });
      toast.success(saved.quickService ? t("quick.added") : t("quick.removed"));
    },
    onError: (error) => toast.error(t("quick.failed"), { description: message(error) }),
  });
  const toggleQuickService = quickService.mutate;

  const actions = useMemo<RowActions>(
    () => ({
      onEdit: (product) => setForm({ open: true, product }),
      onPrice: (product) => setPricing({ open: true, product }),
      onHistory: (product) => setHistory({ open: true, product }),
      onQuickService: (product) => toggleQuickService(product),
    }),
    [toggleQuickService],
  );

  const reorder = useMutation({
    mutationKey: REORDER_KEY,
    mutationFn: ({ ids, branchId: forBranch }: ReorderVars) =>
      api<Product[]>("/products/order", { method: "PUT", json: forBranch ? { productIds: ids, branchId: forBranch } : { productIds: ids } }),
    onSuccess: (saved, { key }) => {
      void queryClient.invalidateQueries({ queryKey: productKeys.all, refetchType: "none" });
      // a later drop may already be on its way; its optimistic order wins
      if (queryClient.isMutating({ mutationKey: REORDER_KEY }) <= 1) queryClient.setQueryData(key, saved);
      toast.success(t("reorderSaved"));
    },
    onError: (error, { key, previous }) => {
      if (previous && queryClient.isMutating({ mutationKey: REORDER_KEY }) <= 1) queryClient.setQueryData(key, previous);
      else void queryClient.invalidateQueries({ queryKey: key });
      toast.error(t("reorderFailed"), { description: message(error) });
    },
  });

  const onReorder = (next: Product[]) => {
    const key = listKey;
    const previous = queryClient.getQueryData<Product[]>(key);
    const apply = () => {
      // optimistic: the list shows the new order at once (no jump after the drop)
      queryClient.setQueryData<Product[]>(
        key,
        next.map((p, i) => ({ ...p, position: i })),
      );
      reorder.mutate({ ids: next.map((p) => p.id), branchId: ownBranch ? undefined : (pickedBranch ?? undefined), key, previous });
    };
    if (queryClient.isFetching({ queryKey: key }) > 0) void queryClient.cancelQueries({ queryKey: key }).then(apply);
    else apply();
  };

  const changePrice = (next: PriceFilter) => {
    setPrice(next);
    writePriceParam(next);
  };
  const clearFilters = () => {
    setSearch("");
    changePrice("all");
    setQuick(false);
    setCategoryId(null);
    setStock("all");
  };

  if (!user) return null;
  const subtitle = ownBranch ? t("subtitleManager") : can("product.update.price") && !canCreate ? t("subtitleFinance") : t("subtitleAdmin");
  const branchName = (b: BranchOption) => (locale === "ar" ? b.nameAr : b.name);
  const addButton = canCreate && (
    <Button onClick={() => setForm({ open: true, product: null })}>
      <Plus aria-hidden="true" />
      {t("add")}
    </Button>
  );

  let body;
  if (products.isPending) body = <LoadingRows rows={6} className="h-[82px]" />;
  else if (products.isError && !products.data) body = <ErrorState error={products.error} onRetry={() => void products.refetch()} />;
  else if (products.data.length === 0)
    body = filtered ? (
      <EmptyState
        title={t("emptyFiltered")}
        action={
          <Button variant="outline" size="sm" onClick={clearFilters}>
            {tc("clearFilters")}
          </Button>
        }
      />
    ) : (
      <EmptyState title={t("empty")} action={addButton} />
    );
  else
    body = (
      <div className={cn("transition-opacity", products.isPlaceholderData && "opacity-60")} aria-busy={products.isFetching}>
        <ProductList
          products={products.data}
          label={t("listLabel")}
          showPositions={branchContext !== null}
          permissions={permissions}
          actions={actions}
          onReorder={reorderable ? onReorder : undefined}
        />
      </div>
    );

  return (
    <>
      <PageHeader title={t("title")} subtitle={subtitle} actions={addButton} />
      <OdooSyncBar />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-[18px] -translate-y-1/2 text-muted" strokeWidth={1.8} aria-hidden="true" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="ps-10"
          />
        </div>
        <Segmented
          label={t("priceFilterLabel")}
          value={price}
          onChange={changePrice}
          options={[
            { value: "all", label: t("filterAll") },
            { value: "priced", label: t("filterPriced") },
            { value: "unpriced", label: t("filterUnpriced") },
          ]}
        />
        <Select value={categoryId ?? ALL_CATEGORIES} onValueChange={(v) => setCategoryId(v === ALL_CATEGORIES ? null : v)}>
          <SelectTrigger aria-label={t("categoryFilterLabel")} className="max-w-full min-w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CATEGORIES}>{t("allCategories")}</SelectItem>
            {categories.data?.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {locale === "ar" ? c.name : (c.nameEn ?? c.name)} ({c.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Segmented
          label={t("stockFilterLabel")}
          value={stock}
          onChange={setStock}
          options={[
            { value: "all", label: t("filterAll") },
            { value: "in", label: t("stockIn") },
            { value: "out", label: t("stockOut") },
          ]}
        />
        <Button variant={quick ? "default" : "outline"} aria-pressed={quick} onClick={() => setQuick((on) => !on)}>
          <Wrench aria-hidden="true" />
          {t("quick.filter")}
        </Button>
        {canPickBranch && (
          <Select value={pickedBranch ?? BY_NAME} onValueChange={(v) => setPickedBranch(v === BY_NAME ? null : v)}>
            <SelectTrigger aria-label={t("orderLabel")} className="max-w-full min-w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={BY_NAME}>{t("sortedByName")}</SelectItem>
              {branches.data?.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {t("branchOrder")} {branchName(b)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="mb-4 flex min-h-5 flex-wrap items-center justify-between gap-2 text-[13px]">
        <p className="text-muted">
          {reorderable ? t("reorderHint") : canReorder && branchContext !== null && filtered ? t("orderDisabledFiltered") : null}
        </p>
        {products.data && <p className="text-muted tabular-nums">{tc("resultsCount", { count: products.data.length })}</p>}
      </div>

      {body}

      <p className="sr-only" role="status" aria-live="polite">
        {reorder.isPending ? t("savingOrder") : ""}
      </p>

      <ProductFormSheet open={form.open} product={form.product} onOpenChange={(open) => setForm((f) => ({ ...f, open }))} />
      <PriceDialog open={pricing.open} product={pricing.product} onOpenChange={(open) => setPricing((p) => ({ ...p, open }))} />
      <PriceHistorySheet open={history.open} product={history.product} onOpenChange={(open) => setHistory((h) => ({ ...h, open }))} />
    </>
  );
}
