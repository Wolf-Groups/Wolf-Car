"use client";

import { Check, Plus } from "lucide-react";
import { motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { ShowroomProduct } from "@/lib/api/types";
import { formatMoney } from "@/lib/format";
import { fast, spring } from "@/lib/motion";
import { isAvailable } from "@/lib/stock";
import { cn } from "@/lib/utils";
import type { ProductGroup } from "@/lib/variants";
import { ImageZoom } from "@/components/image-zoom";
import { VariantPicker } from "@/components/variant-picker";
import { ScanBarcode } from "./scan-barcode";

/** Card grid column widths → which image the browser should pick (480px thumb vs 1200px). */
export const PRODUCT_IMAGE_SIZES = "(min-width: 2000px) 20vw, (min-width: 1536px) 25vw, (min-width: 1024px) 33vw, (min-width: 560px) 50vw, 100vw";

export function ProductImage({ product, sizes, className }: { product: ShowroomProduct; sizes: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- API-served webp renditions with an explicit srcset; no optimizer round-trip
    <img
      src={product.thumbUrl}
      srcSet={`${product.thumbUrl} 480w, ${product.imageUrl} 1200w`}
      sizes={sizes}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      // contain, not cover: catalogue photos are cut-outs of the part on white,
      // and cropping them to fill the card slices the part in half
      className={cn("size-full object-contain", className)}
    />
  );
}

/**
 * One product on the kiosk. Taps are never blocked: every tap adds one, the
 * quantity badge pops and the button briefly confirms with a check mark.
 */
export function ProductCard({
  product,
  title = product.name,
  picker,
  barcode,
  quantity,
  onAdd,
}: {
  product: ShowroomProduct;
  /** the name without the colour, when the card offers a colour picker */
  title?: string;
  picker?: ReactNode;
  /** only at a branch whose cashier scans off the screen */
  barcode?: ReactNode;
  quantity: number;
  /** returns false when the cart limits stopped the add */
  onAdd: () => boolean;
}) {
  const t = useTranslations("Showroom");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const [flash, setFlash] = useState(0);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(0), 1100);
    return () => clearTimeout(id);
  }, [flash]);

  const added = flash > 0;
  const available = isAvailable(product);

  return (
    <article
      className={cn(
        "flex flex-col overflow-hidden rounded-[var(--radius-brand-lg)] border bg-surface transition-colors",
        quantity > 0 ? "border-accent" : "border-line",
      )}
      aria-label={title}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-white">
        {/* absolute, so the 4/3 box keeps its height: a tall catalogue photo
            would otherwise stretch the card via the image's intrinsic size */}
        <ImageZoom
          src={product.imageUrl}
          name={product.name}
          viewLabel={t("viewImage", { name: product.name })}
          closeLabel={tc("close")}
          className="absolute inset-0 size-full"
          showName
          open={zoomed}
          onOpenChange={setZoomed}
        >
          <ProductImage product={product} sizes={PRODUCT_IMAGE_SIZES} className={cn("absolute inset-0 p-3", !available && "opacity-50")} />
        </ImageZoom>
        {/* over the photo, so a product with colours is as tall as its neighbours */}
        {picker && <div className="absolute inset-x-2 bottom-2 flex justify-center">{picker}</div>}
        {quantity > 0 && (
          <motion.span
            key={quantity}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={spring}
            className="pointer-events-none absolute end-3 top-3 grid h-11 min-w-11 place-items-center rounded-full bg-accent px-2 text-lg font-extrabold text-white tabular-nums"
            data-testid="card-quantity"
          >
            <span aria-hidden="true">{quantity}</span>
            <span className="sr-only">{t("inCart", { count: quantity })}</span>
          </motion.span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 dir="auto" className="min-h-[2.75em] text-start text-[17px] leading-snug font-bold">
          {/* two lines at most on the card; pressing the name opens the photo with the name in full */}
          <button type="button" onClick={() => setZoomed(true)} className="line-clamp-2 text-start">
            {title}
          </button>
        </h3>
        {product.description && (
          <p dir="auto" className="mt-1 line-clamp-3 text-start text-sm leading-relaxed text-ink-2">
            {product.description}
          </p>
        )}
        {/* by default the barcode is not shown to customers: the cashier scans it
            from the order sheet. A branch that scans off this screen passes it in. */}
        {barcode && <div className="mt-3">{barcode}</div>}
        <div className="mt-auto pt-3">
          <p className="text-[22px] leading-tight font-extrabold tabular-nums">
            <span dir="ltr">{formatMoney(product.price, locale)}</span>
          </p>
          {!available ? (
            <p className="mt-3 flex min-h-[60px] w-full items-center justify-center rounded-[var(--radius-brand)] bg-sand px-4 text-[17px] font-bold text-muted">
              {t("unavailable")}
            </p>
          ) : (
            <Button
              size="touch"
              className="mt-3 w-full"
              aria-label={t("addNamed", { name: product.name })}
              onClick={() => {
                if (onAdd()) setFlash((n) => n + 1);
              }}
            >
              <motion.span
                key={added ? "added" : "add"}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={fast}
                className="inline-flex items-center gap-2"
              >
                {added ? <Check aria-hidden="true" strokeWidth={2.4} /> : <Plus aria-hidden="true" strokeWidth={2.2} />}
                {added ? t("added") : t("add")}
              </motion.span>
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

/** One card for a product and all its colours; the picked colour is what gets added. */
export function ProductGroupCard({
  group,
  scan = false,
  quantityOf,
  onAdd,
}: {
  group: ProductGroup<ShowroomProduct>;
  /** show the picked product's barcode for scanning off the screen */
  scan?: boolean;
  quantityOf: (productId: string) => number;
  /** returns false when the cart limits stopped the add */
  onAdd: (product: ShowroomProduct) => boolean;
}) {
  const t = useTranslations("Showroom");
  const [picked, setPicked] = useState(group.variants[0].id);
  const product = group.variants.find((v) => v.id === picked) ?? group.variants[0];
  return (
    <ProductCard
      product={product}
      title={group.title}
      quantity={quantityOf(product.id)}
      onAdd={() => onAdd(product)}
      barcode={scan && product.barcode ? <ScanBarcode key={product.id} product={product} /> : undefined}
      picker={
        group.variants.length > 1 ? (
          <VariantPicker variants={group.variants} selected={product.id} onSelect={setPicked} label={t("variant")} touch compact />
        ) : undefined
      }
    />
  );
}
