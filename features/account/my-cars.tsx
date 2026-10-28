"use client";

import { Car, Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { categoryName } from "@/features/catalog/category-name";
import { shop } from "@/features/shop/shop-api";
import { Link } from "@/i18n/navigation";
import type { CustomerCar, PublicCategory } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { EmptyState, SectionTitle } from "./account";

/** The API keeps at most this many (CUSTOMER_CARS_MAX). */
export const CARS_MAX = 5;

/** "My cars" in /account: the car models the customer drives, each a way to its parts, and a picker to change them. */
export function MyCars() {
  const t = useTranslations("Account");
  const [cars, setCars] = useState<CustomerCar[] | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let live = true;
    // a failed read shows the empty state; saving still works
    shop.myCars().then(
      (c) => live && setCars(c),
      () => live && setCars([]),
    );
    return () => {
      live = false;
    };
  }, []);

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle icon={Car}>{t("carsTitle")}</SectionTitle>
        {cars !== null && cars.length > 0 && !editing && (
          <Button variant="outline" onClick={() => setEditing(true)}>
            {t("editCars")}
          </Button>
        )}
      </div>
      {cars === null ? (
        <div aria-busy="true" className="h-24 animate-pulse rounded-[var(--radius-brand-lg)] border border-line bg-surface" />
      ) : editing ? (
        <CarPicker
          initial={cars.map((c) => c.id)}
          onSaved={(saved) => {
            setCars(saved);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : cars.length === 0 ? (
        <EmptyState icon={Car}>
          <div className="grid gap-1">
            <p className="text-[15px] font-semibold">{t("carsEmpty")}</p>
            <p className="text-[14px] text-ink-2">{t("carsIntro")}</p>
          </div>
          <Button onClick={() => setEditing(true)}>{t("addCars")}</Button>
        </EmptyState>
      ) : (
        <ul className="flex flex-wrap gap-2.5">
          {cars.map((car) => (
            <li key={car.id}>
              <CarChip car={car} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A car as a pill with its small picture, linking to its parts. Also used by the catalogue's "Your cars". */
export function CarChip({ car, current = false }: { car: CustomerCar; current?: boolean }) {
  const locale = useLocale();
  return (
    <Link
      href={`/products?category=${car.id}`}
      aria-current={current ? "page" : undefined}
      className={cn(
        "inline-flex min-h-11 items-center gap-2 rounded-full border bg-surface ps-1.5 pe-4 text-[15px] font-bold transition-colors",
        current ? "border-accent text-accent-ink" : "border-line hover:border-ink-2/40",
      )}
    >
      <span className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-sand">
        {car.thumbUrl && <Image src={car.thumbUrl} alt="" fill sizes="32px" className="object-contain" unoptimized />}
      </span>
      <span dir="auto">{categoryName(car, locale)}</span>
    </Link>
  );
}

function CarPicker({ initial, onSaved, onCancel }: { initial: string[]; onSaved: (cars: CustomerCar[]) => void; onCancel: () => void }) {
  const t = useTranslations("Account");
  const locale = useLocale();
  const [models, setModels] = useState<PublicCategory[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [picked, setPicked] = useState<string[]>(initial);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const res = await fetch("/api/public/categories");
      if (!res.ok) throw new Error(String(res.status));
      setModels((await res.json()) as PublicCategory[]);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the car list once when the picker opens
    void load();
  }, [load]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < CARS_MAX ? [...p, id] : p));

  const save = async () => {
    setSaving(true);
    setSaveFailed(false);
    try {
      onSaved(await shop.saveCars(picked));
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  if (loadFailed)
    return (
      <div className="grid justify-items-start gap-3 rounded-[var(--radius-brand-lg)] border border-line bg-surface p-5">
        <p role="alert" className="text-[15px] text-ink-2">
          {t("carsLoadError")}
        </p>
        <Button variant="outline" onClick={() => void load()}>
          {t("retry")}
        </Button>
      </div>
    );
  if (models === null) return <div aria-busy="true" className="h-40 animate-pulse rounded-[var(--radius-brand-lg)] border border-line bg-surface" />;

  const label = t("carsPick", { max: CARS_MAX });
  return (
    <div className="grid gap-4 rounded-[var(--radius-brand-lg)] border border-line bg-surface p-5">
      <p className="text-[15px] font-semibold text-ink-2">{label}</p>
      <div role="group" aria-label={label} className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {models.map((m) => {
          const on = picked.includes(m.id);
          return (
            <button
              key={m.id}
              type="button"
              aria-pressed={on}
              disabled={!on && picked.length >= CARS_MAX}
              onClick={() => toggle(m.id)}
              className={cn(
                "relative flex min-h-14 items-center gap-2 rounded-[var(--radius-brand)] border p-2 text-start text-[14px] font-bold transition-colors disabled:opacity-40",
                on ? "border-accent bg-accent/5" : "border-line hover:border-ink-2/40",
              )}
            >
              <span className="relative size-10 shrink-0 overflow-hidden rounded-[var(--radius-brand)] bg-sand">
                {m.thumbUrl && <Image src={m.thumbUrl} alt="" fill sizes="40px" className="object-contain" unoptimized />}
              </span>
              <span dir="auto" className="min-w-0 flex-1 leading-snug">
                {categoryName(m, locale)}
              </span>
              {on && <Check aria-hidden="true" className="size-4 shrink-0 text-accent-ink" strokeWidth={3} />}
            </button>
          );
        })}
      </div>
      {saveFailed && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {t("carsError")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()} disabled={saving}>
          {t("save")}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}
