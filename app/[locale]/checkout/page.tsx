import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Wrap } from "@/components/Button";
import { Footer } from "@/components/Footer";
import { SubpageHeader } from "@/components/SubpageHeader";
import { Checkout } from "@/features/shop/checkout";
import { routing } from "@/i18n/routing";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const resolved = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: resolved, namespace: "Checkout" });
  return { title: t("title"), robots: { index: false } };
}

/**
 * Online checkout of the basket: phone code → name and email → card through
 * Tap, collected at Bin Omran. The flow is client-side; the basket lives in
 * localStorage and the customer session in an httpOnly cookie.
 */
export default async function CheckoutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  setRequestLocale(locale);
  return (
    <>
      <SubpageHeader />
      <main id="main" className="bg-sand pt-6 pb-24 lg:pt-8">
        <Wrap>
          {/* read at build time; an empty key leaves the card form unconfigured */}
          <Checkout publicKey={process.env.NEXT_PUBLIC_TAP_PUBLIC_KEY ?? ""} />
        </Wrap>
      </main>
      <Footer />
    </>
  );
}
