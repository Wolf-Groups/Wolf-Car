import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { PublicPage } from "@/components/PublicPage";
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
 * Online checkout of the basket, no account needed: name, mobile and email,
 * then the card through Tap or "pay at the branch", collected at Bin Omran.
 * The flow is client-side; the basket lives in localStorage, a session (if
 * any) in an httpOnly cookie, a guest's order key in the address. Never
 * framed nor indexed (next.config.ts headers).
 */
export default async function CheckoutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  setRequestLocale(locale);
  const t = await getTranslations("Checkout");
  return (
    <PublicPage width="xl">
      <h1 className="text-[clamp(26px,5vw,34px)] leading-tight font-extrabold">{t("title")}</h1>
      {/* Checkout reads ?order= ("Try another card"), so it renders in the browser only */}
      <Suspense fallback={<div aria-busy="true" className="h-56 animate-pulse rounded-[var(--radius-brand-lg)] border border-line bg-surface" />}>
        {/* baked in at build time; an empty key leaves "pay at the branch" only */}
        <Checkout publicKey={tapPublicKey()} />
      </Suspense>
    </PublicPage>
  );
}
