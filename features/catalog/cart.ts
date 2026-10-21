import { useSyncExternalStore } from "react";
import type { PublicProduct } from "@/lib/api/types";
import { formatMoney } from "@/lib/format";
import { track } from "@/lib/track";

/**
 * The website basket. The customer pays for it by card at /checkout (priced
 * lines only, collected at the Bin Omran branch), or sends the list to that
 * branch on WhatsApp, which confirms stock and fitment.
 *
 * Kept in localStorage so it survives switching car models and reloads; every
 * access is guarded because storage can be missing or blocked (private mode).
 */
export interface CartLine {
  id: string;
  name: string;
  /** unit price when added ("125.00"), null for a product without a price */
  price: string | null;
  thumbUrl: string;
  qty: number;
}

const KEY = "wolfcar.cart.v1";
export const MAX_QTY = 99;
const EMPTY: CartLine[] = [];

let lines: CartLine[] = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function load(): CartLine[] {
  if (loaded) return lines;
  loaded = true;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    if (Array.isArray(parsed)) {
      lines = parsed
        .filter(
          (l): l is CartLine =>
            typeof l?.id === "string" && typeof l?.name === "string" && Number.isInteger(l?.qty) && l.qty > 0,
        )
        .map((l) => ({ ...l, price: typeof l.price === "string" ? l.price : null }));
    }
  } catch {
    /* unreadable or blocked storage: start empty */
  }
  return lines;
}

function commit(next: CartLine[]) {
  lines = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* the basket still works for this visit */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    loaded = false; // another tab changed the basket
    load();
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export const cart = {
  add(p: Pick<PublicProduct, "id" | "name" | "price" | "thumbUrl">) {
    const current = load();
    const found = current.find((l) => l.id === p.id);
    commit(
      found
        ? current.map((l) => (l.id === p.id ? { ...l, qty: Math.min(MAX_QTY, l.qty + 1) } : l))
        : // `?? null`: a catalogue response cached from before prices were public has none
          [...current, { id: p.id, name: p.name, price: p.price ?? null, thumbUrl: p.thumbUrl, qty: 1 }],
    );
    track("add_to_cart", { label: p.name, targetId: p.id });
  },
  setQty(id: string, qty: number) {
    const current = load();
    commit(
      qty <= 0
        ? current.filter((l) => l.id !== id)
        : current.map((l) => (l.id === id ? { ...l, qty: Math.min(MAX_QTY, qty) } : l)),
    );
  },
  clear() {
    commit(EMPTY);
  },
};

/** The basket's lines; empty on the server and during hydration. */
export function useCart(): CartLine[] {
  return useSyncExternalStore(subscribe, load, () => EMPTY);
}

/** Sum of the priced lines, and how many lines have no price. */
export function cartTotals(items: CartLine[]) {
  let total = 0;
  let count = 0;
  let unpriced = 0;
  for (const l of items) {
    count += l.qty;
    if (l.price === null) unpriced++;
    else total += Number(l.price) * l.qty;
  }
  return { total, count, unpriced };
}

/** The WhatsApp order text: one numbered line per product, then the total. */
export function orderMessage(items: CartLine[], locale: string): string {
  const ar = locale === "ar";
  const { total, unpriced } = cartTotals(items);
  const rows = items.map((l, i) => {
    const price = l.price === null ? (ar ? "السعر عند الطلب" : "price on request") : formatMoney(Number(l.price) * l.qty, locale);
    return `${i + 1}. ${l.name} × ${l.qty} — ${price}`;
  });
  const head = ar ? "أرغب في طلب المنتجات التالية من فرع بن عمران:" : "I'd like to order these products from the Bin Omran branch:";
  const sum = ar ? `الإجمالي: ${formatMoney(total, locale)}` : `Total: ${formatMoney(total, locale)}`;
  const note = unpriced > 0 ? (ar ? " (دون المنتجات غير المسعّرة)" : " (excluding items without a price)") : "";
  return [head, ...rows, sum + note].join("\n");
}
