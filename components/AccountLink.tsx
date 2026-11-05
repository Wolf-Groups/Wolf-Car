"use client";

import { UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export interface AccountLinkProps {
  className?: string;
  /** back to the icon alone from this width up, where the header runs out of room */
  iconOnlyFrom?: "xl";
}

/** "My account" in the site headers: sign in with the email code, then the customer's cars and orders. */
export function AccountLink({ className, iconOnlyFrom }: AccountLinkProps) {
  const t = useTranslations("Account");
  return (
    <Link
      href="/account"
      title={iconOnlyFrom ? t("headerLink") : undefined}
      className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-[12px] px-2 text-sm font-bold transition-colors", className)}
    >
      <UserRound aria-hidden="true" className="size-5" strokeWidth={2} />
      {/* icon only on phones; the name stays for screen readers */}
      <span className={cn("sr-only sm:not-sr-only", iconOnlyFrom === "xl" && "xl:sr-only")}>{t("headerLink")}</span>
    </Link>
  );
}
