import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Image from "next/image";
import { Wrap } from "@/components/Button";
import { Footer } from "@/components/Footer";
import { Icon } from "@/components/Icon";
import { TrackModelView } from "@/components/SiteAnalytics";
import { SubpageHeader } from "@/components/SubpageHeader";
import { CartSheet } from "@/features/catalog/cart-sheet";
import { CatalogGrid } from "@/features/catalog/catalog-grid";
import { categoryName } from "@/features/catalog/category-name";
import { ModelSidebar, ModelTabs, QUICK_SERVICE } from "@/features/catalog/model-tabs";
import { YourCars } from "@/features/catalog/your-cars";
import { cardCheckoutEnabled } from "@/features/shop/card-checkout";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { formatMoney } from "@/lib/format";
import { FLAG_BADGE } from "@/lib/packages";
import { fetchPublicCatalog, fetchPublicCategories, fetchPublicQuickService, fetchPublicServices } from "@/lib/public-catalog";
import { lowestPrice } from "@/lib/services";
import { groupVariants } from "@/lib/variants";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const resolved = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: resolved, namespace: "ProductsPage" });
  return { title: t("metaTitle"), description: t("metaDescription") };
}

/**
 * Public catalogue, reachable from the landing page's car-model cards and
 * footer: prices and a basket that is sent to the Bin Omran branch on
 * WhatsApp (no barcodes, no online payment). ?category=<id> narrows it to one model.
 */
export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ category?: string | string[] }>;
}) {
  const { locale: raw } = await params;
  const { category: rawCategory } = await searchParams;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  setRequestLocale(locale);
  const t = await getTranslations("ProductsPage");
  const pkg = await getTranslations("Packages");
  const services = (await fetchPublicServices())?.services ?? [];
  const from = lowestPrice(services);
  const categories = (await fetchPublicCategories()) ?? [];
  // an unknown or stale id falls back to every product instead of an empty page
  const selected = categories.find((c) => c.id === rawCategory);
  // filters, oils and brake pads of every car, gathered under one tab
  const quickProducts = (await fetchPublicQuickService()) ?? [];
  const quickCount = groupVariants(quickProducts).length;
  const quick = rawCategory === QUICK_SERVICE && quickCount > 0;
  const products = quick ? quickProducts : await fetchPublicCatalog(selected?.id);
  const tab = quick ? QUICK_SERVICE : selected?.id;
  const perks = [
    { icon: "wa", title: t("perkOrderTitle"), body: t("perkOrderBody") },
    { icon: "wrench", title: t("perkFitTitle"), body: t("perkFitBody") },
    { icon: "card", title: t("perkPayTitle"), body: t("perkPayBody") },
  ] as const;

  return (
    <>
      <SubpageHeader />
      {selected && <TrackModelView id={selected.id} name={categoryName(selected, "en")} />}
      {quick && <TrackModelView id={QUICK_SERVICE} name="Quick Service" />}
      <main id="main" className="bg-sand pt-6 pb-24 lg:pt-8">
        <Wrap>
          {/* banner for the selected car model (the Wolf Car van for "all") */}
          <section className="relative mb-5 grid items-center overflow-hidden rounded-[var(--radius-brand-lg)] bg-charcoal text-white md:min-h-[230px] md:grid-cols-[1fr_46%]">
            <div className={cn("relative z-10 p-5 md:p-9", selected && "pb-2")}>
              <p className="text-sm font-bold text-[#FF9A62]">{t("label")}</p>
              <h1 dir="auto" className="mt-1.5 text-start text-[clamp(26px,5vw,40px)] leading-[1.2] font-extrabold">
                {quick ? t("quickService") : selected ? categoryName(selected, locale) : t("title")}
              </h1>
              <p className="mt-2 max-w-[440px] text-[15px] text-white/70">
                {quick ? t("quickBody") : selected ? t("modelBody", { count: selected.count }) : t("body")}
              </p>
            </div>
            {/* on a phone the van is decoration that pushes the products off the first screen; a chosen car keeps its picture */}
            <div className={cn("relative md:block md:h-full", selected ? "h-[104px]" : "hidden")}>
              <Image
                src={selected?.imageUrl ?? "/assets/van-rtl-45.webp"}
                alt=""
                fill
                preload
                sizes="(min-width:768px) 520px, 100vw"
                className="object-contain object-bottom px-6 pb-4 md:object-center md:py-6"
                unoptimized={Boolean(selected?.imageUrl)}
              />
            </div>
          </section>

          {/* a signed-in customer's own cars first (loads in the browser; the page stays cached) */}
          <YourCars enabled={cardCheckoutEnabled()} selected={selected?.id} />

          {/* protection packages are services, not parts: a way across to their page */}
          <Link
            href="/packages"
            className="group mb-5 flex items-center gap-3 rounded-[var(--radius-brand-lg)] border border-line bg-surface px-4 py-3 transition-colors hover:border-accent"
          >
            <Image src={FLAG_BADGE.de} alt="" width={35} height={40} className="h-10 w-auto shrink-0" unoptimized />
            <span className="min-w-0 flex-1 leading-snug">
              <b className="block text-[15px] font-extrabold">{pkg("promoTitle")}</b>
              <small className="block text-[13px] text-muted tabular-nums">
                {from === null ? pkg("promoBodyPlain") : pkg("promoBody", { price: formatMoney(from, locale, { whole: true }) })}
              </small>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-sm font-bold text-accent-ink">
              <span className="hidden sm:inline">{pkg("promoCta")}</span>
              <ArrowRight className="size-[18px] transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" aria-hidden="true" strokeWidth={2.2} />
            </span>
          </Link>

          <ul className="mb-7 hidden gap-2.5 sm:grid sm:grid-cols-3">
            {perks.map((p) => (
              <li key={p.title} className="flex items-center gap-3 rounded-[var(--radius-brand-lg)] border border-line bg-surface px-4 py-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-brand)] bg-sand text-accent-ink">
                  <Icon name={p.icon} className="size-5" />
                </span>
                <span className="leading-snug">
                  <b className="block text-[15px] font-extrabold">{p.title}</b>
                  <small className="block text-[13px] text-muted">{p.body}</small>
                </span>
              </li>
            ))}
          </ul>

          <div className="lg:grid lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-7">
            <ModelSidebar categories={categories} selected={tab} quickCount={quickCount} />
            <div>
              <ModelTabs categories={categories} selected={tab} quickCount={quickCount} />
              {products === null ? (
                <p role="alert" className="rounded-[var(--radius-brand-lg)] border border-line bg-surface px-6 py-12 text-center text-ink-2">
                  {t("unavailable")}
                </p>
              ) : (
                <CatalogGrid key={tab ?? "all"} products={products} />
              )}
            </div>
          </div>
        </Wrap>
      </main>
      <CartSheet />
      <Footer />
    </>
  );
}
