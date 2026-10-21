"use client";

import { CalendarCheck, Menu } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import { Direction } from "radix-ui";
import { useEffect, useState, type MouseEvent } from "react";
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Link } from "@/i18n/navigation";
import { LOGO } from "@/lib/content";
import { cn } from "@/lib/utils";
import { cardCheckoutEnabled } from "@/features/shop/card-checkout";
import { AccountLink } from "./AccountLink";
import { openBooking } from "./BookingForm";
import { useContact } from "./ContactProvider";
import { Icon } from "./Icon";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Landing-page header: a floating glass bar over the hero (light or dark with
 * the theme) that turns solid once the hero has scrolled away. Below lg the links move into a menu
 * sheet (call and WhatsApp stay in the bottom StickyBar on phones).
 */
export function Header() {
  const t = useTranslations("Header");
  const brand = useTranslations("Brand");
  const locale = useLocale();
  const { ask } = useContact();
  const [solid, setSolid] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    const hero = document.getElementById("top");
    let frame = 0;
    const update = () => {
      frame = 0;
      // solid as soon as the bar would sit over the light page instead of the hero
      setSolid(hero ? hero.getBoundingClientRect().bottom < 88 : window.scrollY > 24);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const links = [
    { href: "#services", label: t("navServices") },
    { href: "#catalog", label: t("navCatalog") },
    { href: "/packages", label: t("navPackages") },
    { href: "#work", label: t("navWork") },
    { href: "#branches", label: t("navBranches") },
    { href: "/about", label: t("navAbout") },
  ];

  const book = (e: MouseEvent) => {
    e.preventDefault();
    setMenu(false);
    openBooking("branch");
  };

  // in-page links from the menu: close the sheet first, then scroll once its scroll lock is gone
  const jump = (e: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (!menu) return;
    e.preventDefault();
    setMenu(false);
    window.setTimeout(() => {
      document.querySelector(href)?.scrollIntoView({ behavior: "smooth", block: "start" });
      history.replaceState(null, "", href);
    }, 260);
  };

  // over the hero the dark theme needs light text; the light hero already suits the solid colours
  const onHero =
    "text-ink-2 hover:text-ink dark:text-white/80 dark:hover:text-white dark:group-data-[solid=true]:text-ink-2 dark:group-data-[solid=true]:hover:text-ink";

  return (
    <header data-solid={solid} className="group fixed inset-x-0 top-0 z-50 px-3 pt-3 lg:px-5 lg:pt-4">
      <div
        className={cn(
          "mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-3 rounded-[18px] border ps-3 pe-2 transition-[background-color,border-color,box-shadow] duration-300 lg:ps-4",
          "border-black/10 bg-white/60 text-ink backdrop-blur-xl dark:border-white/12 dark:bg-[#0d0c0b]/55 dark:text-white",
          "group-data-[solid=true]:border-line group-data-[solid=true]:bg-surface/92 group-data-[solid=true]:text-ink group-data-[solid=true]:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.25)]",
        )}
      >
        <a href="#top" aria-label={t("logoAria")} className="flex shrink-0 items-center gap-2.5">
          <Image src={LOGO} alt="" width={38} height={38} className="size-[38px] object-contain" unoptimized />
          <span className="whitespace-nowrap">
            <b className="block text-[17px] leading-tight font-extrabold">{brand("name")}</b>
            <small className="block text-xs leading-tight font-bold tracking-[0.1em] opacity-60">WOLF CAR</small>
          </span>
        </a>

        <nav aria-label={t("navAria")} className="hidden items-center gap-1 text-[15px] font-semibold lg:flex">
          {links.map((l) =>
            l.href.startsWith("/") ? (
              <Link key={l.href} href={l.href} className={cn("rounded-[10px] px-3 py-2 transition-colors", onHero)}>
                {l.label}
              </Link>
            ) : (
              <a key={l.href} href={l.href} className={cn("rounded-[10px] px-3 py-2 transition-colors", onHero)}>
                {l.label}
              </a>
            ),
          )}
        </nav>

        <div className="flex items-center gap-0.5">
          <AccountLink enabled={cardCheckoutEnabled()} className={onHero} />
          <ThemeToggle className={cn("hidden sm:grid", onHero)} />
          <LocaleSwitcher className={cn("hidden px-2 sm:inline-flex", onHero)} />
          <button
            type="button"
            onClick={() => ask({ kind: "call" })}
            aria-label={t("call")}
            title={t("call")}
            className={cn("hidden size-11 place-items-center rounded-[12px] transition-colors md:grid", onHero)}
          >
            <Icon name="phone" className="size-5" />
          </button>
          <a
            href="#book"
            onClick={book}
            className="ms-1 hidden min-h-11 items-center gap-2 rounded-[12px] bg-accent px-4 text-[15px] font-bold text-white transition-colors hover:bg-accent-dark sm:inline-flex"
          >
            <CalendarCheck className="size-[18px]" aria-hidden="true" strokeWidth={2} />
            {t("book")}
          </a>
          <button
            type="button"
            onClick={() => setMenu(true)}
            aria-label={t("menu")}
            aria-expanded={menu}
            className={cn("grid size-11 place-items-center rounded-[12px] transition-colors lg:hidden", onHero)}
          >
            <Menu className="size-6" aria-hidden="true" strokeWidth={2} />
          </button>
        </div>
      </div>

      <Direction.Provider dir={locale === "ar" ? "rtl" : "ltr"}>
        <Sheet open={menu} onOpenChange={setMenu}>
          <SheetContent side="end" closeLabel={t("closeMenu")} className="z-[70] gap-0 sm:max-w-sm">
            <SheetHeader className="pb-3">
              <SheetTitle>{t("menu")}</SheetTitle>
            </SheetHeader>
            <SheetBody>
              <nav aria-label={t("navAria")}>
                <ul className="divide-y divide-line">
                  {links.map((l) => (
                    <li key={l.href}>
                      {l.href.startsWith("/") ? (
                        <Link href={l.href} onClick={() => setMenu(false)} className="flex min-h-14 items-center text-[18px] font-bold">
                          {l.label}
                        </Link>
                      ) : (
                        <a href={l.href} onClick={(e) => jump(e, l.href)} className="flex min-h-14 items-center text-[18px] font-bold">
                          {l.label}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
              <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
                <ThemeToggle />
                <LocaleSwitcher />
              </div>
            </SheetBody>
            <SheetFooter className="flex-col! gap-2">
              <a
                href="#book"
                onClick={book}
                className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-[var(--radius-brand)] bg-accent px-5 text-[17px] font-bold text-white hover:bg-accent-dark"
              >
                <CalendarCheck className="size-5" aria-hidden="true" strokeWidth={2} />
                {t("book")}
              </a>
              <button
                type="button"
                onClick={() => {
                  setMenu(false);
                  ask({ kind: "call" });
                }}
                className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-[var(--radius-brand)] border-[1.5px] border-line px-5 text-[17px] font-bold hover:border-ink"
              >
                <Icon name="phone" className="size-5" />
                {t("call")}
              </button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </Direction.Provider>
    </header>
  );
}
