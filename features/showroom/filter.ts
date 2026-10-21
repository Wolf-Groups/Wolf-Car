import type { ShowroomProduct } from "@/lib/api/types";
import { availableFirst } from "@/lib/stock";

export type Sort = "default" | "priceAsc" | "priceDesc";

/** Price bands in QAR: `min` is included, `max` is not. */
export const PRICE_RANGES = [
  { id: "under100", min: 0, max: 100 },
  { id: "100to500", min: 100, max: 500 },
  { id: "500to1000", min: 500, max: 1000 },
  { id: "over1000", min: 1000, max: Infinity },
] as const;

export type PriceRangeId = (typeof PRICE_RANGES)[number]["id"];

export interface Filters {
  query: string;
  sort: Sort;
  range: PriceRangeId | null;
}

export const NO_FILTERS: Filters = { query: "", sort: "default", range: null };

export const isFiltering = (f: Filters) => f.query.trim() !== "" || f.sort !== "default" || f.range !== null;

/**
 * Folds text for searching: case, Arabic diacritics and tatweel, and the
 * letter forms a customer types interchangeably (أ/إ/آ → ا, ى → ي, ة → ه),
 * with Arabic-Indic digits read as Latin ones.
 */
export function normalize(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The kiosk's search, price band and sort; the default sort keeps the manager's order.
 * Whatever the sort, what is out of stock comes last.
 * `cars` maps a category id to its names, so "tank" finds every Tank product
 * even though the car is not written in each product's name.
 */
export function filterProducts(
  products: ShowroomProduct[],
  { query, sort, range }: Filters,
  cars: ReadonlyMap<string, string> = new Map(),
): ShowroomProduct[] {
  const words = normalize(query).split(" ").filter(Boolean);
  const band = PRICE_RANGES.find((r) => r.id === range);

  const matched = products.filter((p) => {
    if (band && !(Number(p.price) >= band.min && Number(p.price) < band.max)) return false;
    if (words.length === 0) return true;
    const car = (p.categoryIds ?? [p.categoryId]).map((id) => (id && cars.get(id)) || "").join(" ");
    const haystack = normalize(`${p.name} ${p.description ?? ""} ${p.barcode ?? ""} ${car}`);
    return words.every((w) => haystack.includes(w));
  });

  if (sort === "default") return availableFirst(matched);
  const dir = sort === "priceAsc" ? 1 : -1;
  return availableFirst([...matched].sort((a, b) => dir * (Number(a.price) - Number(b.price))));
}
