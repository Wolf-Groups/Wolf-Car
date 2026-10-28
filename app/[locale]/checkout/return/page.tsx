import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PublicPage } from "@/components/PublicPage";
import { ReturnStatus } from "@/features/shop/return-status";
import { ORDER_ID_PATTERN } from "@/features/shop/shop-api";
import { routing } from "@/i18n/routing";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const resolved = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: resolved, namespace: "Checkout" });
  return { title: t("title"), robots: { index: false } };
}

/**
 * Where Tap sends the customer back after 3-D Secure (?order=<uuid>). The
 * redirect proves nothing: the page asks the API to reconcile with Tap and
 * shows what the server says. Never framed nor indexed (next.config.ts headers).
 */
export default async function CheckoutReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ order?: string | string[] }>;
}) {
  const { locale: raw } = await params;
  const { order } = await searchParams;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  setRequestLocale(locale);
  if (typeof order !== "string" || !ORDER_ID_PATTERN.test(order)) notFound();
  return (
    <PublicPage width="xl">
      <ReturnStatus orderId={order} />
    </PublicPage>
  );
}
