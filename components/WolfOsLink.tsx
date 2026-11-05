import { ExternalLink } from "lucide-react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { WOLFOS, wolfOsLink } from "@/lib/content";
import { cn } from "@/lib/utils";

const WOLF = "/assets/wolfos/wolf.webp";

/**
 * "Our app" in the landing header: WolfOS in its own night-and-ember colours, lit so it stands
 * out from the other links, straight to wolfcaros.com in a new tab. In the header bar it stays
 * visible on phones too; in the menu sheet it is the first row.
 */
export function WolfOsLink({ place, onClick }: { place: "header" | "menu"; onClick?: () => void }) {
  const t = useTranslations("Header");
  const locale = useLocale() as Locale;
  const link = wolfOsLink(WOLFOS.site(locale), place);

  if (place === "menu") {
    return (
      <a {...link} aria-label={t("appAria")} onClick={onClick} className="flex min-h-14 items-center gap-2.5 text-[18px] font-extrabold text-accent-ink">
        <Image src={WOLF} alt="" width={26} height={26} className="size-[26px]" />
        {t("app")}
        <span className="rounded-full bg-[#ff7a18] px-2 text-[11px] leading-5 font-extrabold text-[#1c1410]">{t("appNew")}</span>
        <ExternalLink className="ms-auto size-5 text-muted" aria-hidden="true" strokeWidth={2} />
      </a>
    );
  }

  return (
    <a
      {...link}
      aria-label={t("appAria")}
      onClick={onClick}
      className={cn(
        "relative inline-flex min-h-11 items-center gap-1.5 rounded-[12px] border border-[#ff7a18]/65 bg-[#0c0a09] px-2.5 text-sm font-extrabold whitespace-nowrap text-white",
        "shadow-[0_0_18px_-4px_rgba(255,122,24,0.85)] transition-shadow hover:shadow-[0_0_26px_-2px_rgba(255,122,24,0.95)] sm:px-3 sm:text-[15px]",
      )}
    >
      <Image src={WOLF} alt="" width={20} height={20} className="size-5" />
      {t("app")}
      <span className="absolute -start-1.5 -top-2 rounded-full bg-[#ff7a18] px-1.5 text-[10px] leading-4 font-extrabold text-[#1c1410]">{t("appNew")}</span>
    </a>
  );
}
