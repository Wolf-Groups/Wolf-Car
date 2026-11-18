"use client";

import { ArrowDownWideNarrow, ArrowUpNarrowWide, Search, X, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";
import { type Filters, PRICE_RANGES, type Sort } from "./filter";

/**
 * The kiosk's search box. The tablet's own keyboard opens on tap; its search
 * key puts the keyboard away again so the results are not hidden behind it.
 */
export function KioskSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const t = useTranslations("Showroom");
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute inset-y-0 start-4 my-auto size-6 text-muted" aria-hidden="true" strokeWidth={1.8} />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        dir="auto"
        aria-label={t("search")}
        placeholder={t("search")}
        className="h-[60px] w-full rounded-[var(--radius-brand-lg)] border-[1.5px] border-line bg-surface ps-13 pe-16 text-lg font-semibold outline-none placeholder:font-normal placeholder:text-muted focus-visible:border-accent [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={t("clearSearch")}
          className="absolute inset-y-0 end-1.5 my-auto grid size-12 place-items-center rounded-full text-ink-2 hover:bg-sand"
        >
          <X className="size-6" aria-hidden="true" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex min-h-12 shrink-0 touch-manipulation items-center gap-2 rounded-full border px-4 text-[15px] font-bold whitespace-nowrap transition-colors",
        active ? "border-charcoal bg-charcoal text-white dark:border-accent dark:bg-accent" : "border-line bg-surface hover:border-accent",
      )}
    >
      {children}
    </button>
  );
}

/** Sort and price-band chips: one tap turns a chip on, a second tap turns it off. */
export function KioskFilters({ filters, onChange }: { filters: Filters; onChange: (patch: Partial<Filters>) => void }) {
  const t = useTranslations("Showroom");
  const amount = (n: number) => n.toLocaleString("en");
  const toggleSort = (sort: Sort) => onChange({ sort: filters.sort === sort ? "default" : sort });

  return (
    <div
      role="group"
      aria-label={t("filters")}
      className="-mx-4 flex items-center gap-2 overflow-x-auto overscroll-x-contain px-4 pb-1 lg:-mx-6 lg:px-6 [scrollbar-width:none]"
    >
      <Chip active={filters.sort === "priceAsc"} onClick={() => toggleSort("priceAsc")}>
        <ArrowUpNarrowWide className="size-5" aria-hidden="true" strokeWidth={2} />
        {t("sortPriceAsc")}
      </Chip>
      <Chip active={filters.sort === "priceDesc"} onClick={() => toggleSort("priceDesc")}>
        <ArrowDownWideNarrow className="size-5" aria-hidden="true" strokeWidth={2} />
        {t("sortPriceDesc")}
      </Chip>
      <span className="mx-1 h-7 w-px shrink-0 bg-line" aria-hidden="true" />
      <span className="shrink-0 text-sm font-bold text-ink-2">{t("priceLabel")}</span>
      {PRICE_RANGES.map((r) => (
        <Chip key={r.id} active={filters.range === r.id} onClick={() => onChange({ range: filters.range === r.id ? null : r.id })}>
          <span dir="ltr">
            {r.min === 0
              ? t("priceUnder", { amount: amount(r.max) })
              : r.max === Infinity
                ? t("priceOver", { amount: amount(r.min) })
                : `${amount(r.min)} – ${amount(r.max)}`}
          </span>
        </Chip>
      ))}
    </div>
  );
}

/** The narrowest card width from a tablet up, in px: the screens differ, so each one picks its own. */
const CARD_WIDTHS = [150, 180, 200, 240, 290, 340];
/** Where the cashier scans off the screen a card never gets narrower than its barcode needs (kiosk SCAN_GRID). */
const SCAN_CARD_WIDTHS = [340, 390, 440, 500];
const DEFAULT_WIDTH = 200;
/** Kept on this screen only: the big screen and a tablet in the same branch want different sizes. */
const CARD_WIDTH_KEY = "wolfcar.showroom.cardWidth";

const rememberedWidth = (): number | null => {
  try {
    const stored = Number(localStorage.getItem(CARD_WIDTH_KEY));
    return stored > 0 ? stored : null;
  } catch {
    return null;
  }
};

/**
 * The card width this screen uses, and a step smaller or larger; remembered across sign-ins. The grid is drawn
 * in the browser only (after the screen has signed in), so storage is read while rendering.
 */
export function useCardWidth(scan: boolean) {
  const widths = scan ? SCAN_CARD_WIDTHS : CARD_WIDTHS;
  const [chosen, setChosen] = useState(rememberedWidth);
  // the stored width, or the nearest one this branch allows
  const want = chosen ?? (scan ? SCAN_CARD_WIDTHS[0] : DEFAULT_WIDTH);
  const index = widths.reduce((best, w, i) => (Math.abs(w - want) < Math.abs(widths[best] - want) ? i : best), 0);
  const step = (by: number) => {
    const next = widths[Math.min(widths.length - 1, Math.max(0, index + by))];
    setChosen(next);
    try {
      localStorage.setItem(CARD_WIDTH_KEY, String(next));
    } catch {
      /* storage blocked: kept until the page reloads */
    }
  };
  return { width: widths[index], smaller: index > 0 ? () => step(-1) : null, larger: index < widths.length - 1 ? () => step(1) : null };
}

/** Smaller / larger cards, beside the search; from a tablet up (a phone keeps two cards across). */
export function CardSizeControl({ smaller, larger }: { smaller: (() => void) | null; larger: (() => void) | null }) {
  const t = useTranslations("Showroom");
  const button = "grid size-[60px] shrink-0 touch-manipulation place-items-center rounded-[var(--radius-brand-lg)] border-[1.5px] border-line bg-surface text-ink transition-colors hover:border-accent disabled:opacity-40 disabled:hover:border-line";
  return (
    <div role="group" aria-label={t("cardSize")} className="flex gap-2 max-sm:hidden">
      <button type="button" onClick={smaller ?? undefined} disabled={!smaller} aria-label={t("cardsSmaller")} className={button}>
        <ZoomOut className="size-6" aria-hidden="true" strokeWidth={1.8} />
      </button>
      <button type="button" onClick={larger ?? undefined} disabled={!larger} aria-label={t("cardsLarger")} className={button}>
        <ZoomIn className="size-6" aria-hidden="true" strokeWidth={1.8} />
      </button>
    </div>
  );
}
