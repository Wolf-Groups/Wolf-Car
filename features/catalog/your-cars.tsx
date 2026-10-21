"use client";

import { CarFront } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { CarChip } from "@/features/account/my-cars";
import { hasCustomerHint, shop } from "@/features/shop/shop-api";
import { Link } from "@/i18n/navigation";
import type { CustomerCar } from "@/lib/api/types";

export interface YourCarsProps {
  /** cardCheckoutEnabled(): customers can only sign in once card checkout is live */
  enabled: boolean;
  /** the ?category= on screen, marked as the current car */
  selected?: string;
}

/**
 * The top of the catalogue for a signed-in customer: their cars first, each a
 * way to its parts, or a nudge to add one. Nothing for anyone else. The page
 * itself stays the same cached HTML for everybody; this part loads in the browser.
 */
export function YourCars({ enabled, selected }: YourCarsProps) {
  const t = useTranslations("Account");
  const [cars, setCars] = useState<CustomerCar[] | null>(null);

  useEffect(() => {
    if (!enabled || !hasCustomerHint()) return;
    let live = true;
    // not signed in after all (expired cookie) or any failure: show nothing
    shop.myCars().then(
      (c) => live && setCars(c),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [enabled]);

  if (!enabled || cars === null) return null;
  if (cars.length === 0)
    return (
      <Link
        href="/account"
        className="mb-5 flex items-center gap-2 rounded-[var(--radius-brand-lg)] border border-dashed border-line bg-surface px-4 py-3 text-[15px] font-bold text-accent-ink hover:border-accent"
      >
        <CarFront aria-hidden="true" className="size-5 shrink-0" strokeWidth={2} />
        {t("pickYourCar")}
      </Link>
    );
  return (
    <section aria-labelledby="your-cars" className="mb-5 flex flex-wrap items-center gap-2.5">
      <h2 id="your-cars" className="text-[15px] font-extrabold">
        {t("yourCars")}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {cars.map((car) => (
          <li key={car.id}>
            <CarChip car={car} current={car.id === selected} />
          </li>
        ))}
      </ul>
    </section>
  );
}
