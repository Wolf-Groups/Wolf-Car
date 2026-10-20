import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { Wrap } from "@/components/Button";
import { Footer } from "@/components/Footer";
import { SubpageHeader } from "@/components/SubpageHeader";
import { tapPublicKey } from "@/features/shop/card-checkout";
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
 * localStorage and the customer session in an httpOnly cookie. Never framed
 * nor indexed (next.config.ts headers).
 */
export default async function CheckoutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  setRequestLocale(locale);
  const t = await getTranslations("Checkout");
  return (
    <>
      <SubpageHeader />
      <main id="main" className="bg-sand pt-6 pb-24 lg:pt-8">
        <Wrap>
          <div className="mx-auto grid w-full max-w-xl gap-5">
            <h1 className="text-[clamp(26px,5vw,34px)] leading-tight font-extrabold">{t("title")}</h1>
            {/* Checkout reads ?order= ("Try another card"), so it renders in the browser only */}
            <Suspense fallback={<div aria-busy="true" className="h-56 animate-pulse rounded-[var(--radius-brand-lg)] border border-line bg-surface" />}>
              {/* baked in at build time; an empty key turns card checkout off */}
              <Checkout publicKey={tapPublicKey()} />
            </Suspense>
          </div>
        </Wrap>
      </main>
      <Footer />
    </>
  );
}
