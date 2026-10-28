import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PublicPage } from "@/components/PublicPage";
import { OrderView } from "@/features/account/order-view";
import { ORDER_ID_PATTERN } from "@/features/shop/shop-api";
import { routing } from "@/i18n/routing";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const resolved = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: resolved, namespace: "Account" });
  return { title: t("title"), robots: { index: false } };
}

/** One of the customer's web orders. Never framed nor indexed (next.config.ts headers). */
export default async function AccountOrderPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale: raw, id } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  setRequestLocale(locale);
  if (!ORDER_ID_PATTERN.test(id)) notFound();
  return (
    <PublicPage>
      <OrderView orderId={id} />
    </PublicPage>
  );
}
