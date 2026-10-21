import { api } from "@/lib/api/client";
import type { PriceChange, Product, PublicCategory } from "@/lib/api/types";

export type PriceFilter = "all" | "priced" | "unpriced";
/** "in": Odoo has some free to sell; "out": Odoo has none */
export type StockFilter = "all" | "in" | "out";

export interface ProductListParams {
  q: string;
  price: PriceFilter;
  /** only the products under the website's "Quick service" tab */
  quick: boolean;
  /** Only for users without a branch: show this branch's showroom order. */
  branchId: string | null;
  /** one car model or line; a model also lists the parts common to its brand */
  categoryId: string | null;
  stock: StockFilter;
}

export const productKeys = {
  all: ["products"] as const,
  list: (params: ProductListParams) => ["products", "list", params] as const,
  history: (id: string) => ["products", "history", id] as const,
};

export function parsePriceFilter(value: string | null): PriceFilter {
  return value === "priced" || value === "unpriced" ? value : "all";
}

export function fetchProducts({ q, price, quick, branchId, categoryId, stock }: ProductListParams): Promise<Product[]> {
  return api<Product[]>("/products", {
    query: {
      q: q || undefined,
      price: price === "all" ? undefined : price,
      quickService: quick ? "true" : undefined,
      branchId: branchId ?? undefined,
      categoryId: categoryId ?? undefined,
      stock: stock === "all" ? undefined : stock,
    },
  });
}

/** The cars and lines (THABT, accessories, …) as the website offers them, for the list's car filter. */
export function fetchCategories(): Promise<PublicCategory[]> {
  return api<PublicCategory[]>("/public/categories");
}

export function fetchPriceHistory(id: string): Promise<PriceChange[]> {
  return api<PriceChange[]>(`/products/${id}/price-history`);
}
