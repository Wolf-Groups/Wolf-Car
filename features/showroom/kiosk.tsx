"use client";

import { useQuery } from "@tanstack/react-query";
import { Lock, ShoppingCart } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BrandMark } from "@/components/app/brand";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { EmptyState, ErrorState } from "@/components/app/states";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/features/auth/auth-provider";
import { useRouter } from "@/i18n/navigation";
import { api } from "@/lib/api/client";
import type { BranchSummary, OrderDetail, Profile, ServiceCatalog, ShowroomCategory, ShowroomProduct } from "@/lib/api/types";
import { formatMoney } from "@/lib/format";
import { EMPTY_SERVICES } from "@/lib/services";
import { ORDER_MAX_LINES, ORDER_MAX_QUANTITY } from "@/shared/validation";
import { canAdd, itemCount, quantityOf, total as cartTotal } from "./cart";
import { type CartEntry, CartPanel } from "./cart-panel";
import { ALL_CATEGORIES, CategoryTabs, SERVICES_TAB } from "./category-tabs";
import { CheckoutDialog } from "./checkout-dialog";
import { type Filters, filterProducts, isFiltering, NO_FILTERS } from "./filter";
import { newIdempotencyKey } from "./idempotency";
import { KioskFilters, KioskSearch } from "./kiosk-toolbar";
import { cn } from "@/lib/utils";
import { isAvailable } from "@/lib/stock";
import { groupVariants } from "@/lib/variants";
import { ProductGroupCard } from "./product-card";
import { serviceProducts, ServicesView } from "./services-view";
import { SuccessOverlay } from "./success-overlay";
import { clearStoredCart, useCart } from "./use-cart";
import { IDLE_TIMEOUT_MS, useIdleTimeout } from "./use-idle-timeout";

export interface ShowroomCatalog {
  branch: BranchSummary;
  categories: ShowroomCategory[];
  products: ShowroomProduct[];
  /** packages and services; absent only while an older API is still running */
  services?: ServiceCatalog;
}

export const SHOWROOM_PRODUCTS_KEY = ["showroom", "products"] as const;
const HEADER_H = "76px";
/** Two cards across a small tablet, three across an upright kiosk, up to five on a wide wall screen. */
const GRID = "grid grid-cols-1 gap-4 min-[560px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 min-[2000px]:grid-cols-5";
/** Cards added each time the list nears its end; a car model can hold 150+ products. */
const PAGE = 24;

function KioskSplash() {
  const t = useTranslations();
  return (
    <div className="grid min-h-dvh place-items-center bg-sand px-6" role="status" aria-live="polite">
      <div className="grid justify-items-center gap-5">
        <BrandMark name={t("Brand.name")} sub={t("Showroom.title")} />
        <Skeleton className="h-1.5 w-40 rounded-full" />
        <span className="sr-only">{t("Common.loading")}</span>
      </div>
    </div>
  );
}

function ProductGridSkeleton() {
  const t = useTranslations("Common");
  return (
    <div role="status" aria-live="polite" className={GRID}>
      <span className="sr-only">{t("loading")}</span>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-[var(--radius-brand-lg)] border border-line bg-surface">
          <Skeleton className="aspect-[4/3] rounded-none" />
          <div className="grid gap-2 p-4">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-7 w-1/2" />
            <Skeleton className="h-[60px] w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Kiosk({ user, idleTimeoutMs }: { user: Profile; idleTimeoutMs: number }) {
  const t = useTranslations("Showroom");
  const tc = useTranslations("Common");
  const brand = useTranslations("Brand");
  const locale = useLocale();
  const router = useRouter();
  const { logout } = useAuth();
  const { cart, add, increment, decrement, remove, clear, prune } = useCart({ persist: true });
  const topRef = useRef<HTMLDivElement>(null);
  /** set when an order is placed so the closing dialog doesn't pull focus from the confirmation */
  const placedRef = useRef(false);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [checkoutKey, setCheckoutKey] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const [lockOpen, setLockOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [shown, setShown] = useState(PAGE);
  // typing stays instant while a long grid catches up
  const query = useDeferredValue(filters.query);

  const catalog = useQuery({
    queryKey: SHOWROOM_PRODUCTS_KEY,
    queryFn: async () => {
      const data = await api<ShowroomCatalog>("/showroom/products", { audience: "showroom" });
      // products and services that were unpriced or removed since they were added leave the cart
      prune([...data.products.map((p) => p.id), ...(data.services?.services ?? []).flatMap((s) => s.prices.map((p) => p.productId))]);
      return data;
    },
    refetchInterval: 60_000,
  });

  const products = catalog.data?.products ?? [];
  const categories = catalog.data?.categories ?? [];
  // the cart still resolves against every product, not just the visible tab
  // a product common to a brand carries every model of that brand in categoryIds
  const inCategory =
    category === ALL_CATEGORIES ? products : products.filter((p) => (p.categoryIds ?? [p.categoryId]).includes(category));
  const applied = { ...filters, query };
  const cars = new Map(categories.map((c) => [c.id, `${c.name} ${c.carModel ?? ""}`]));
  // the colours of one product share a card
  const groups = groupVariants(filterProducts(inCategory, applied, cars));

  // the next cards load as the list is scrolled near its end; the button
  // stays for keyboards and for browsers without IntersectionObserver
  const more = useRef<HTMLDivElement>(null);
  const hasMore = groups.length > shown;
  useEffect(() => {
    const el = more.current;
    if (!hasMore || !el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setShown((n) => n + PAGE);
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, shown]);
  const filtering = isFiltering(applied);
  const showServices = category === SERVICES_TAB;
  // what the same search finds across every car, offered when this car has nothing
  const elsewhere = category !== ALL_CATEGORIES && groups.length === 0 ? groupVariants(filterProducts(products, applied, cars)).length : 0;
  const offer = catalog.data?.services ?? EMPTY_SERVICES;
  // each price of a service is a basket line of its own, named in full
  const orderable = [...products, ...serviceProducts(offer, locale, (b) => t(`body.${b}`))];
  const byId = new Map(orderable.map((p) => [p.id, p]));
  const entries: CartEntry[] = cart.lines.flatMap((line) => {
    const product = byId.get(line.productId);
    return product ? [{ product, quantity: line.quantity }] : [];
  });
  const lines = entries.map((e) => ({ productId: e.product.id, quantity: e.quantity }));
  const count = itemCount({ lines });
  const total = cartTotal({ lines }, new Map(orderable.map((p) => [p.id, p.price])));
  const branch = catalog.data?.branch ?? user.branch;
  // the cashier scans barcodes off this screen: show them, and keep the basket out of the way
  const scan = catalog.data?.branch.scanFromScreen ?? false;
  const branchName = branch ? (locale === "ar" ? branch.nameAr : branch.name) : null;

  const changeFilters = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setShown(PAGE);
  };
  const selectCategory = (id: string) => {
    setCategory(id);
    setShown(PAGE);
  };

  // the next visitor starts from the full catalogue, not the last one's search
  const reset = () => {
    placedRef.current = false;
    clear();
    setFilters(NO_FILTERS);
    setCategory(ALL_CATEGORIES);
    setShown(PAGE);
    setOrder(null);
    setCheckoutKey(null);
    setSheetOpen(false);
    topRef.current?.scrollIntoView({ block: "start" });
  };

  useIdleTimeout(
    (cart.lines.length > 0 || isFiltering(filters) || category !== ALL_CATEGORIES) && order === null,
    () => {
      const hadCart = cart.lines.length > 0;
      reset();
      if (hadCart) toast(t("idleReset"));
    },
    idleTimeoutMs,
  );

  const handleAdd = (product: ShowroomProduct) => {
    if (!isAvailable(product)) return false;
    if (!canAdd(cart, product.id)) {
      toast(
        quantityOf(cart, product.id) > 0
          ? t("maxQuantity", { max: ORDER_MAX_QUANTITY })
          : t("cartFull", { max: ORDER_MAX_LINES }),
      );
      return false;
    }
    add(product.id);
    return true;
  };

  const openCheckout = () => {
    setSheetOpen(false);
    setCheckoutKey(newIdempotencyKey());
  };

  const handlers = { onIncrement: increment, onDecrement: decrement, onRemove: remove };
  const panelProps = {
    entries,
    count,
    total,
    onClear: () => setClearOpen(true),
    onCheckout: openCheckout,
    scan,
    ...handlers,
  };

  return (
    <div ref={topRef} className="min-h-dvh bg-sand">
      <header className="sticky top-0 z-30 border-b border-line bg-surface" style={{ height: HEADER_H }}>
        <div className="flex h-full items-center justify-between gap-3 px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-4">
            <BrandMark name={brand("name")} sub={t("title")} />
            {branchName && (
              <>
                <span className="hidden h-9 w-px bg-line min-[560px]:block" aria-hidden="true" />
                <p dir="auto" className="hidden truncate text-lg font-extrabold text-ink-2 min-[560px]:block" data-testid="branch-name">
                  {branchName}
                </p>
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <LocaleSwitcher className="px-2" />
            <ThemeToggle />
            <Button
              variant="outline"
              size="lg"
              className="ms-1 px-3 sm:px-4"
              onClick={() => setLockOpen(true)}
              aria-label={t("lock")}
            >
              <Lock aria-hidden="true" strokeWidth={1.8} />
              <span className="hidden text-[15px] sm:inline">{t("lock")}</span>
            </Button>
          </div>
        </div>
      </header>

      {/* the basket docks beside the grid only on a wide landscape screen; an
          upright kiosk keeps its full width for the products */}
      <div className={cn(!scan && "lg:landscape:grid lg:landscape:grid-cols-[minmax(0,1fr)_360px] xl:landscape:grid-cols-[minmax(0,1fr)_400px]")}>
        <main className={cn("min-w-0 px-4 pt-5 pb-36 lg:px-6", !scan && "lg:landscape:pb-8")}>
          <h1 className="sr-only">{branchName ? `${t("title")} · ${branchName}` : t("title")}</h1>
          {catalog.isPending ? (
            <ProductGridSkeleton />
          ) : catalog.isError && !catalog.data ? (
            <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />
          ) : orderable.length === 0 ? (
            <EmptyState title={t("noProducts")} />
          ) : (
            <>
              {/* the search stays in reach while the grid scrolls under it */}
              <div className="sticky z-20 -mx-4 -mt-3 bg-sand px-4 py-3 lg:-mx-6 lg:px-6" style={{ top: HEADER_H }}>
                <KioskSearch value={filters.query} onChange={(value) => changeFilters({ query: value })} />
              </div>
              <div className="grid gap-3">
                <CategoryTabs
                  categories={categories}
                  selected={category}
                  total={groupVariants(products).length}
                  services={offer.services.length}
                  onSelect={selectCategory}
                />
                {!showServices && <KioskFilters filters={filters} onChange={changeFilters} />}
              </div>
              {showServices ? (
                <div className="mt-5">
                  <ServicesView
                    catalog={offer}
                    query={query}
                    quantityOf={(id) => quantityOf(cart, id)}
                    onAdd={(id) => {
                      const product = byId.get(id);
                      return product ? handleAdd(product) : false;
                    }}
                  />
                </div>
              ) : (
                <>
                  <p className="mt-4 mb-3 text-[15px] font-bold text-ink-2" aria-live="polite" data-testid="result-count">
                    {t("results", { count: groups.length })}
                  </p>
                  {groups.length === 0 ? (
                    filtering ? (
                      <EmptyState
                        title={t("noMatch")}
                        body={t("noMatchHint")}
                        action={
                          <div className="flex flex-wrap justify-center gap-3">
                            {elsewhere > 0 && (
                              <Button size="touch" onClick={() => selectCategory(ALL_CATEGORIES)}>
                                {t("searchAll")} ({elsewhere})
                              </Button>
                            )}
                            <Button size="touch" variant="outline" onClick={() => changeFilters(NO_FILTERS)}>
                              {t("clearFilters")}
                            </Button>
                          </div>
                        }
                      />
                    ) : (
                      <EmptyState title={t("noProducts")} />
                    )
                  ) : (
                    <>
                      <ul className={GRID} aria-label={t("title")}>
                        {groups.slice(0, shown).map((group) => (
                          <li key={group.key} className="grid">
                            <ProductGroupCard group={group} scan={scan} quantityOf={(id) => quantityOf(cart, id)} onAdd={handleAdd} />
                          </li>
                        ))}
                      </ul>
                      {groups.length > shown && (
                        <div ref={more} className="mt-6 flex justify-center">
                          <Button size="touch" variant="outline" className="min-w-64" onClick={() => setShown((n) => n + PAGE)}>
                            {t("showMore", { count: groups.length - shown })}
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}
        </main>

        {!scan && (
          <aside className="hidden border-s border-line bg-surface lg:landscape:block">
            <div className="sticky" style={{ top: HEADER_H, height: `calc(100dvh - ${HEADER_H})` }}>
              <CartPanel heading={<h2 className="text-xl leading-tight font-extrabold">{t("cart")}</h2>} {...panelProps} />
            </div>
          </aside>
        )}
      </div>

      {/* tablets in portrait, and every screen where the basket is not docked:
          a bottom bar that opens the cart as a sheet */}
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]",
          !scan && "lg:landscape:hidden",
        )}
      >
        <div className="mx-auto flex max-w-3xl items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink-2">{t("items", { count })}</p>
            <p className="text-2xl leading-tight font-extrabold tabular-nums" aria-live="polite">
              <span dir="ltr">{formatMoney(total, locale)}</span>
            </p>
          </div>
          <Button size="touch" className="relative" onClick={() => setSheetOpen(true)}>
            <ShoppingCart aria-hidden="true" strokeWidth={1.8} />
            {t("viewCart")}
            {count > 0 && (
              <span className="grid h-7 min-w-7 place-items-center rounded-full bg-white px-1.5 text-sm font-extrabold text-accent-ink tabular-nums" aria-hidden="true">
                {count}
              </span>
            )}
          </Button>
        </div>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" closeLabel={tc("close")} className="h-[88dvh] gap-0 overflow-hidden" aria-describedby={undefined}>
          <CartPanel
            heading={<SheetTitle className="text-xl leading-tight">{t("cart")}</SheetTitle>}
            headerClassName="pe-16"
            {...panelProps}
          />
        </SheetContent>
      </Sheet>

      <CheckoutDialog
        open={checkoutKey !== null && order === null}
        restoreFocus={() => !placedRef.current}
        idempotencyKey={checkoutKey ?? ""}
        lines={lines}
        count={count}
        total={total}
        userId={user.id}
        onPlaced={(placed) => {
          placedRef.current = true;
          setOrder(placed);
        }}
        onUnavailable={async () => {
          const fresh = await catalog.refetch();
          const valid = new Set(fresh.data?.products.map((p) => p.id) ?? []);
          return cart.lines.filter((l) => valid.has(l.productId)).length;
        }}
        onClose={() => setCheckoutKey(null)}
      />

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title={t("clearTitle")}
        body={t("clearBody")}
        confirmLabel={t("clear")}
        destructive
        onConfirm={async () => {
          clear();
          setSheetOpen(false);
        }}
      />

      <ConfirmDialog
        open={lockOpen}
        onOpenChange={setLockOpen}
        title={t("lockTitle")}
        body={t("lockBody")}
        confirmLabel={t("lock")}
        onConfirm={async () => {
          clear();
          clearStoredCart();
          await logout();
          router.replace("/showroom/login");
        }}
      />

      <AnimatePresence>{order && <SuccessOverlay key={order.id} order={order} onDone={reset} />}</AnimatePresence>
    </div>
  );
}

/**
 * The showroom kiosk: a full-screen product grid for customers with a cart
 * and checkout. Signed-out tablets are sent to the showroom sign-in.
 */
export function ShowroomKiosk({ idleTimeoutMs = IDLE_TIMEOUT_MS }: { idleTimeoutMs?: number }) {
  const { status, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "anonymous") router.replace("/showroom/login");
  }, [status, router]);

  if (status !== "authenticated" || !user) return <KioskSplash />;
  return <Kiosk user={user} idleTimeoutMs={idleTimeoutMs} />;
}
