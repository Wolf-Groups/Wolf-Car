"use client";

import { Boxes, Clock3, History, Pencil, ScanBarcode, Wrench } from "lucide-react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { memo, type ReactNode } from "react";
import { Pill } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Product } from "@/lib/api/types";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface RowPermissions {
  canEdit: boolean;
  canPrice: boolean;
  canHistory: boolean;
}

export interface RowActions {
  onEdit: (product: Product) => void;
  onPrice: (product: Product) => void;
  onHistory: (product: Product) => void;
  /** puts the product under the website's "Quick service" tab, or takes it out */
  onQuickService: (product: Product) => void;
}

function IconAction({ label, tooltip, onClick, children }: { label: string; tooltip: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export function PriceValue({ product, canPrice }: { product: Product; canPrice: boolean }) {
  const t = useTranslations("Products");
  const locale = useLocale();
  const value =
    product.price === null ? (
      <Pill tone="warning">
        <Clock3 className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
        {t("awaitingPrice")}
      </Pill>
    ) : (
      <span className="font-bold whitespace-nowrap tabular-nums">
        {formatMoney(product.price, locale)}
      </span>
    );
  if (canPrice) return value;
  // read-only for everyone but Finance: explain who sets it (keyboard-reachable tooltip)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-flex cursor-help rounded-[6px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink"
        >
          {value}
        </span>
      </TooltipTrigger>
      <TooltipContent>{t("price.readOnly")}</TooltipContent>
    </Tooltip>
  );
}

/** How many Odoo had free to sell at the last sync; nothing for a product Odoo keeps no stock for. */
export function StockValue({ stock }: { stock: number | null | undefined }) {
  const t = useTranslations("Products.stock");
  if (stock === null || stock === undefined) return null;
  return (
    <Pill tone={stock > 0 ? "success" : "danger"}>
      <Boxes className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
      {stock > 0 ? t("available", { n: stock }) : t("out")}
    </Pill>
  );
}

/**
 * One product in the list: thumbnail, name, description, barcode, price,
 * stock and the actions the user may take. Card-like on phones, a single row from md up.
 * Memoised so dragging (which re-renders every sortable wrapper) stays cheap.
 */
export const ProductRowContent = memo(function ProductRowContent({
  product,
  position,
  handle,
  permissions,
  actions,
}: {
  product: Product;
  /** 1-based showroom position, shown in branch order */
  position?: number;
  handle?: ReactNode;
  permissions: RowPermissions;
  actions?: RowActions;
}) {
  const t = useTranslations("Products");
  const tc = useTranslations("Common");
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 md:flex-nowrap">
      <div className="flex min-w-0 flex-1 basis-[60%] items-center gap-3">
        {handle}
        {position !== undefined && (
          <span aria-hidden="true" dir="ltr" className="w-9 shrink-0 text-center font-mono text-sm font-bold text-muted tabular-nums">
            {t("position", { n: position })}
          </span>
        )}
        <Image
          src={product.thumbUrl}
          alt=""
          width={56}
          height={56}
          unoptimized
          draggable={false}
          className="size-14 shrink-0 rounded-[var(--radius-brand)] border border-line bg-sand object-cover"
        />
        <div className="min-w-0 flex-1 text-start">
          {/* dir="auto" on a shrink-to-fit block: the text keeps its own direction and ellipsis side, the box sits at the page's start */}
          <p dir="auto" className="w-fit max-w-full truncate text-[15px] font-bold">
            {product.name}
          </p>
          {product.description && (
            <p dir="auto" className="w-fit max-w-full truncate text-sm text-ink-2">
              {product.description}
            </p>
          )}
        </div>
      </div>
      <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 md:contents">
        <div className="flex min-w-0 items-center gap-1.5 text-sm md:w-44 md:shrink-0">
          <ScanBarcode className="size-4 shrink-0 text-muted" strokeWidth={1.8} aria-hidden="true" />
          {product.barcode ? (
            <span dir="ltr" className="truncate font-mono text-ink-2">
              {product.barcode}
            </span>
          ) : (
            <span className="text-muted">{t("noBarcode")}</span>
          )}
        </div>
        <div className="md:w-40 md:shrink-0">
          <PriceValue product={product} canPrice={permissions.canPrice} />
        </div>
        {product.fromOdoo && (
          <div className="md:w-32 md:shrink-0">
            <StockValue stock={product.stock} />
          </div>
        )}
        {actions && (
          <div className="ms-auto flex shrink-0 items-center gap-1">
            {product.fromOdoo && <Pill tone="neutral">{t("odoo.fromOdoo")}</Pill>}
            {permissions.canPrice && !product.fromOdoo && (
              <Button variant="outline" size="sm" onClick={() => actions.onPrice(product)}>
                {product.price === null ? t("price.set") : t("price.change")}
              </Button>
            )}
            {permissions.canEdit && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-pressed={Boolean(product.quickService)}
                    aria-label={t("quick.toggleNamed", { name: product.name })}
                    onClick={() => actions.onQuickService(product)}
                    className={cn(product.quickService && "bg-accent text-white hover:bg-accent-dark hover:text-white")}
                  >
                    <Wrench className="size-5" strokeWidth={1.8} aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{product.quickService ? t("quick.remove") : t("quick.add")}</TooltipContent>
              </Tooltip>
            )}
            {permissions.canHistory && (
              <IconAction label={t("historyNamed", { name: product.name })} tooltip={t("price.history")} onClick={() => actions.onHistory(product)}>
                <History className="size-5" strokeWidth={1.8} aria-hidden="true" />
              </IconAction>
            )}
            {permissions.canEdit && !product.fromOdoo && (
              <IconAction label={t("editNamed", { name: product.name })} tooltip={tc("edit")} onClick={() => actions.onEdit(product)}>
                <Pencil className="size-5" strokeWidth={1.8} aria-hidden="true" />
              </IconAction>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
