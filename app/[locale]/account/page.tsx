import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PublicPage } from "@/components/PublicPage";
import { Account } from "@/features/account/account";
import { routing } from "@/i18n/routing";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const resolved = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: resolved, namespace: "Account" });
  return { title: t("title"), robots: { index: false } };
}

/**
 * The customer's account: sign in with the phone code (the checkout's sign-in),
 * then their web orders. Client-side; the session is the httpOnly cookie.
 * Never framed nor indexed (next.config.ts headers).
 */
export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  setRequestLocale(locale);
  const t = await getTranslations("Account");
  return (
    <PublicPage>
      <h1 className="text-[clamp(26px,5vw,34px)] leading-tight font-extrabold">{t("title")}</h1>
      <Account />
    </PublicPage>
  );
}
