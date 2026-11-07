"use client";

import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import type { WebOrder } from "@/lib/api/types";
import { formatMoney } from "@/lib/format";
import { hasArabic } from "@/lib/text";

export type OrderLinesProps = Pick<WebOrder, "items" | "total" | "currency">;

/** Read-only list of an order's lines with the total, through `formatMoney` (always QAR, like `currency`). */
export function OrderLines({ items, total }: OrderLinesProps) {
  const t = useTranslations("Checkout");
  const locale = useLocale();
  return (
    <div className="grid gap-3">
      <ul className="divide-y divide-line">
        {items.map((item) => (
          <li key={item.productId} className="flex items-center gap-3 py-3">
            <div className="relative size-14 shrink-0 overflow-hidden rounded-[var(--radius-brand)] border border-line bg-white">
              <Image src={item.thumbUrl} alt="" fill sizes="56px" className="object-contain p-1" unoptimized />
            </div>
            <div className="min-w-0 flex-1">
              {/* the row follows the page; the name alone reads in its own script's direction ("G700" first in Arabic) */}
              <p className="line-clamp-2 text-start text-[14px] leading-snug font-bold">
                <bdi dir={hasArabic(item.productName) ? "rtl" : "ltr"}>{item.productName}</bdi>
              </p>
              <p className="mt-0.5 text-[13px] text-ink-2 tabular-nums">
                <span dir="ltr">×{item.quantity}</span> · {formatMoney(item.unitPrice, locale)}
              </p>
            </div>
            <span className="shrink-0 text-[15px] font-bold tabular-nums">{formatMoney(item.lineTotal, locale)}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-baseline justify-between border-t border-line pt-3">
        <span className="font-bold text-ink-2">{t("total")}</span>
        <b className="text-xl font-extrabold tabular-nums">{formatMoney(total, locale)}</b>
      </div>
    </div>
  );
}
