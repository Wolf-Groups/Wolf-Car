"use client";

import { ShoppingCart, Trash2 } from "lucide-react";
import { MotionConfig } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import { Direction } from "radix-ui";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Link } from "@/i18n/navigation";
import { getBranches, waLink } from "@/lib/branches";
import { formatMoney } from "@/lib/format";
import { cart, cartTotals, orderMessage, useCart } from "./cart";
import { QtyStepper } from "./catalog-grid";

/**
 * Floating basket button plus the drawer it opens. "Pay by card" goes to the
 * online checkout; "Order on WhatsApp", the second way, sends the list to the
 * Bin Omran branch, which handles online orders.
 */
export function CartSheet() {
  const t = useTranslations("Cart");
  const locale = useLocale();
  const items = useCart();
  const [open, setOpen] = useState(false);
  const { total, count, unpriced } = cartTotals(items);
  const branch = getBranches(locale).binomran;

  return (
    <Direction.Provider dir={locale === "ar" ? "rtl" : "ltr"}>
      <MotionConfig reducedMotion="user">
        {count > 0 && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="fixed end-4 bottom-[calc(16px+env(safe-area-inset-bottom))] z-40 flex min-h-[56px] items-center gap-3 rounded-[var(--radius-brand-lg)] bg-charcoal ps-4 pe-5 text-white ring-1 ring-white/10 transition-colors hover:bg-black md:end-8 md:bottom-8"
          >
            <span className="relative">
              <ShoppingCart className="size-6" aria-hidden="true" strokeWidth={2} />
              <span className="absolute -end-2.5 -top-2.5 grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-extrabold tabular-nums">
                {count}
              </span>
            </span>
            <span className="text-start leading-tight">
              <b className="block text-[15px]">{t("open")}</b>
              <small className="block text-[13px] text-white/70 tabular-nums">{formatMoney(total, locale)}</small>
            </span>
          </button>
        )}

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="end" closeLabel={t("close")} className="gap-0 sm:max-w-md">
            <SheetHeader className="border-b border-line pb-4">
              <SheetTitle>{t("title")}</SheetTitle>
              <SheetDescription>{t("description", { branch: branch.short })}</SheetDescription>
            </SheetHeader>

            <SheetBody className="py-2">
              {items.length === 0 ? (
                <p className="py-12 text-center text-ink-2">{t("empty")}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {items.map((l) => (
                    <li key={l.id} className="flex items-center gap-3 py-3">
                      <div className="relative size-16 shrink-0 overflow-hidden rounded-[var(--radius-brand)] border border-line bg-white">
                        <Image src={l.thumbUrl} alt="" fill sizes="64px" className="object-contain p-1" unoptimized />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p dir="auto" className="line-clamp-3 text-start text-[14px] leading-snug font-bold">
                          {l.name}
                        </p>
                        <p className="mt-0.5 text-sm font-bold text-accent-ink tabular-nums">
                          {l.price === null ? t("priceOnRequest") : formatMoney(Number(l.price) * l.qty, locale)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end">
                        <QtyStepper id={l.id} name={l.name} qty={l.qty} compact />
                        <button
                          type="button"
                          onClick={() => cart.setQty(l.id, 0)}
                          className="inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-muted hover:text-danger"
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                          {t("remove")}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SheetBody>

            {items.length > 0 && (
              <SheetFooter className="flex-col! gap-3">
                <div className="flex items-baseline justify-between">
                  <span className="font-bold text-ink-2">{t("total")}</span>
                  <b className="text-xl font-extrabold tabular-nums">{formatMoney(total, locale)}</b>
                </div>
                {unpriced > 0 && <p className="text-xs text-muted">{t("unpricedNote", { count: unpriced })}</p>}
                {/* checkout_start is counted once, by the details step, not by this link */}
                <Link
                  href="/checkout"
                  className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-[var(--radius-brand)] bg-accent px-5 text-[17px] font-bold text-white hover:bg-accent-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink"
                >
                  <Icon name="card" className="size-5" />
                  {t("payByCard")}
                </Link>
                <p className="text-center text-[13px] text-muted">{t("orWhatsapp")}</p>
                <a
                  href={waLink(locale, "binomran", orderMessage(items, locale))}
                  target="_blank"
                  rel="noopener"
                  data-track="whatsapp_order"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-brand)] border-[1.5px] border-wa/50 px-5 text-[15px] font-bold text-ink hover:border-wa hover:bg-wa/5"
                >
                  <Icon name="wa" className="size-5 text-wa" />
                  {t("checkout", { branch: branch.short })}
                </a>
                <button type="button" onClick={() => cart.clear()} className="min-h-11 text-sm font-semibold text-muted hover:text-ink">
                  {t("clear")}
                </button>
              </SheetFooter>
            )}
          </SheetContent>
        </Sheet>
      </MotionConfig>
    </Direction.Provider>
  );
}
