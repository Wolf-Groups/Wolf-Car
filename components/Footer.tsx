import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import { Wrap } from "./Button";
import { Icon } from "./Icon";
import { Link } from "@/i18n/navigation";
import { getBranchList } from "@/lib/branches";
import { LOGO, SOCIAL } from "@/lib/content";

function prettyTel(tel: string) {
  const local = tel.replace("+974", "");
  return `${local.slice(0, 4)} ${local.slice(4)}`;
}

export async function Footer() {
  const locale = await getLocale();
  const t = await getTranslations("Footer");
  const brand = await getTranslations("Brand");
  const branchList = getBranchList(locale);

  return (
    <footer className="bg-charcoal pt-10 pb-[26px] text-[15px] text-[#BDBDBD]">
      <Wrap>
        <div className="grid gap-6 md:grid-cols-[2fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <Image src={LOGO} alt="" width={40} height={40} className="size-10 object-contain" unoptimized />
              <span>
                <b className="block text-lg leading-tight font-extrabold text-white">{brand("name")}</b>
                <small className="block text-xs leading-tight font-semibold tracking-[0.06em] text-[#8F8F8F]">
                  WOLF CAR
                </small>
              </span>
            </div>
            <p className="mt-2.5">{t("tagline")}</p>
          </div>

          {branchList.map((b) => (
            <div key={b.id}>
              <h4 className="mb-1.5 text-[15px] font-bold text-white">{b.name}</h4>
              <a href={`tel:${b.tel}`} dir="ltr" className="inline-flex min-h-11 items-center hover:text-white">
                {prettyTel(b.tel)}
              </a>
            </div>
          ))}

          <div>
            <h4 className="mb-1.5 text-[15px] font-bold text-white">{t("followUs")}</h4>
            <div className="flex gap-2">
              <a
                href={SOCIAL.instagram}
                target="_blank"
                rel="noopener"
                aria-label={t("instagramAria")}
                className="grid size-11 place-items-center rounded-[var(--radius-brand)] border border-[#3A3A3A] hover:border-white"
              >
                <Icon name="ig" />
              </a>
              <a
                href={SOCIAL.tiktok}
                target="_blank"
                rel="noopener"
                aria-label={t("tiktokAria")}
                className="grid size-11 place-items-center rounded-[var(--radius-brand)] border border-[#3A3A3A] hover:border-white"
              >
                <Icon name="tt" />
              </a>
              <a
                href={SOCIAL.salehSnap}
                target="_blank"
                rel="noopener"
                aria-label={t("snapAria")}
                className="grid size-11 place-items-center rounded-[var(--radius-brand)] border border-[#3A3A3A] hover:border-white"
              >
                <Icon name="snap" />
              </a>
            </div>
            <p className="mt-1">
              <a href={SOCIAL.salehSnap} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center hover:text-white">
                {t("salehSnap")}
              </a>
            </p>
            <p>
              <a href={`mailto:${SOCIAL.email}`} dir="ltr" className="inline-flex min-h-11 items-center hover:text-white">
                {SOCIAL.email}
              </a>
            </p>
          </div>
        </div>
        <div className="mt-[26px] flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-[#2C2C2C] pt-4 text-[13px] text-[#8F8F8F]">
          <span>{t("copyright")}</span>
          <nav aria-label={t("linksAria")} className="flex flex-wrap gap-x-4 gap-y-1">
            <Link href="/about" className="hover:text-white">
              {t("aboutLink")}
            </Link>
            <Link href="/products" className="hover:text-white">
              {t("catalogLink")}
            </Link>
            <Link href="/privacy" className="hover:text-white">
              {t("privacyLink")}
            </Link>
            <Link href="/terms" className="hover:text-white">
              {t("termsLink")}
            </Link>
            <Link href="/refund-policy" className="hover:text-white">
              {t("refundLink")}
            </Link>
            <Link href="/login" className="hover:text-white">
              {t("staffLogin")}
            </Link>
          </nav>
        </div>
      </Wrap>
    </footer>
  );
}
