import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { AccountLink } from "./AccountLink";
import { Wrap } from "./Button";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { ThemeToggle } from "./ThemeToggle";
import { cardCheckoutEnabled } from "@/features/shop/card-checkout";
import { Link } from "@/i18n/navigation";
import { LOGO } from "@/lib/content";

/** Slim header for the public pages beyond the landing page (catalogue, about, policies). */
export async function SubpageHeader() {
  const t = await getTranslations("ProductsPage");
  const header = await getTranslations("Header");
  const brand = await getTranslations("Brand");

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-surface">
      <Wrap className="flex h-[66px] items-center justify-between gap-3">
        <Link href="/" aria-label={header("logoAria")} className="flex items-center gap-2.5">
          <Image src={LOGO} alt="" width={40} height={40} className="size-10 object-contain" unoptimized />
          <span>
            <b className="block text-lg leading-tight font-extrabold">{brand("name")}</b>
            <small className="block text-xs leading-tight font-semibold tracking-[0.06em] text-muted">WOLF CAR</small>
          </span>
        </Link>
        <div className="flex items-center gap-1">
          <Link href="/" className="hidden min-h-11 items-center px-2 text-sm font-bold text-ink-2 hover:text-ink sm:inline-flex">
            {t("backHome")}
          </Link>
          <AccountLink enabled={cardCheckoutEnabled()} className="text-ink-2 hover:text-ink" />
          <ThemeToggle />
          <LocaleSwitcher />
        </div>
      </Wrap>
    </header>
  );
}
