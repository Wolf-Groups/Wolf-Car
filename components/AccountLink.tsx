"use client";

import { UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export interface AccountLinkProps {
  /**
   * cardCheckoutEnabled(): customers can only sign in once card checkout has
   * launched (the same switch), so the link stays hidden until then.
   */
  enabled: boolean;
  className?: string;
}

/** "My account" in the site headers: sign in with the phone code, then the customer's orders. */
export function AccountLink({ enabled, className }: AccountLinkProps) {
  const t = useTranslations("Account");
  if (!enabled) return null;
  return (
    <Link href="/account" className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-[12px] px-2 text-sm font-bold transition-colors", className)}>
      <UserRound aria-hidden="true" className="size-5" strokeWidth={2} />
      {/* icon only on phones; the name stays for screen readers */}
      <span className="sr-only sm:not-sr-only">{t("headerLink")}</span>
    </Link>
  );
}
