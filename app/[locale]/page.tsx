import { getTranslations, setRequestLocale } from "next-intl/server";
import { ContactProvider } from "@/components/ContactProvider";
import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { BrandStrip } from "@/components/BrandStrip";
import { Services } from "@/components/Services";
import { Catalog } from "@/components/Catalog";
import { Steps } from "@/components/Steps";
import { Work } from "@/components/Work";
import { Reviews } from "@/components/Reviews";
import { Branches } from "@/components/Branches";
import { BookingForm } from "@/components/BookingForm";
import { Faq } from "@/components/Faq";
import { FinalCta } from "@/components/FinalCta";
import { Footer } from "@/components/Footer";
import { StickyBar } from "@/components/StickyBar";
import { WolfOs } from "@/components/WolfOs";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params;
  const locale = hasLocale(routing.locales, rawLocale) ? rawLocale : routing.defaultLocale;
  setRequestLocale(locale);
  const t = await getTranslations();

  return (
    <ContactProvider>
      <a href="#main" className="sr-only">
        {t("SkipLink")}
      </a>
      <Header />
      <main id="main">
        <Hero />
        <BrandStrip />
        <WolfOs />
        <Services />
        <Catalog />
        <Steps />
        <Work />
        <Branches />
        <BookingForm />
        <Reviews />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
      <StickyBar />
    </ContactProvider>
  );
}
