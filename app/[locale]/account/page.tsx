import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Wrap } from "@/components/Button";
import { Footer } from "@/components/Footer";
import { SubpageHeader } from "@/components/SubpageHeader";
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
    <>
      <SubpageHeader />
      <main id="main" className="bg-sand pt-6 pb-24 lg:pt-8">
        <Wrap>
          <div className="mx-auto grid w-full max-w-2xl gap-5">
            <h1 className="text-[clamp(26px,5vw,34px)] leading-tight font-extrabold">{t("title")}</h1>
            <Account />
          </div>
        </Wrap>
      </main>
      <Footer />
    </>
  );
}
