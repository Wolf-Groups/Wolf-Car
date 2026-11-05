"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { BRANCH_CONTACTS } from "@/lib/branches";
import { WOLFOS_ORIGIN } from "@/lib/content";
import { track } from "@/lib/track";
import type { SiteEventType } from "@/shared/analytics";

const digits = (value: string) => value.replace(/\D/g, "");

/** Which branch a WhatsApp or phone link leads to. */
function branchOf(href: string): string | undefined {
  const number = digits(href.split("?")[0]);
  return BRANCH_CONTACTS.find((b) => digits(b.wa) === number || digits(b.tel) === number)?.id;
}

/**
 * Counts page views and presses on WhatsApp, phone and WolfOS links across the
 * public website. Buttons that open WhatsApp from code (the branch picker, the
 * booking form) and the basket report themselves through track().
 */
export function SiteAnalytics() {
  const pathname = usePathname();

  useEffect(() => {
    track("pageview");
  }, [pathname]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      const href = link.getAttribute("href") ?? "";
      if (href.startsWith("tel:")) track("call", { label: branchOf(href) });
      else if (/^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(href)) {
        // a link can name its own kind, e.g. the basket's "order on WhatsApp"
        track((link.dataset.track as SiteEventType | undefined) ?? "whatsapp_chat", { label: branchOf(href) });
      } else if (href.startsWith(`${WOLFOS_ORIGIN}/`)) track("wolfos", { label: link.dataset.place });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}

/** Reports that a car model's products were opened; rendered by the products page for the chosen model. */
export function TrackModelView({ id, name }: { id: string; name: string }) {
  useEffect(() => {
    track("model_view", { label: name, targetId: id });
  }, [id, name]);
  return null;
}
