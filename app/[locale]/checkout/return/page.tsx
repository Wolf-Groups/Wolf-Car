import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Wrap } from "@/components/Button";
import { Footer } from "@/components/Footer";
import { SubpageHeader } from "@/components/SubpageHeader";
import { ReturnStatus } from "@/features/shop/return-status";
import { routing } from "@/i18n/routing";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const resolved = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: resolved, namespace: "Checkout" });
  return { title: t("title"), robots: { index: false } };
}

/**
 * Where Tap sends the customer back after 3-D Secure (?order=<uuid>). The
 * redirect proves nothing: the page asks the API to reconcile with Tap and
 * shows what the server says.
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
  if (typeof order !== "string" || !UUID.test(order)) notFound();
  return (
    <>
      <SubpageHeader />
      <main id="main" className="bg-sand pt-6 pb-24 lg:pt-8">
        <Wrap>
          <ReturnStatus orderId={order} />
        </Wrap>
      </main>
      <Footer />
    </>
  );
}
