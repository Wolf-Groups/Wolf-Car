"use client";

import { useLocale, useTranslations } from "next-intl";
import { Icon } from "@/components/Icon";
import { type CartLine, orderMessage } from "@/features/catalog/cart";
import { getBranches, waLink } from "@/lib/branches";
import { cn } from "@/lib/utils";

/** "Order on WhatsApp" to the Bin Omran branch, with the lines written into the message: the way to buy when paying by card is not possible. */
export function WhatsAppOrderLink({ lines, className }: { lines: CartLine[]; className?: string }) {
  const tc = useTranslations("Cart");
  const locale = useLocale() === "ar" ? "ar" : "en";
  return (
    <a
      href={waLink(locale, "binomran", orderMessage(lines, locale))}
      target="_blank"
      rel="noopener"
      data-track="whatsapp_order"
      className={cn(
        "inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-brand)] bg-wa px-5 text-[15px] font-bold text-white hover:brightness-95",
        className,
      )}
    >
      <Icon name="wa" className="size-5" />
      {tc("checkout", { branch: getBranches(locale).binomran.short })}
    </a>
  );
}
