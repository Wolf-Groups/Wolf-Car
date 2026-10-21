/** Sent with every product the website and the showroom list; absent only while an older API is still running. */
export interface StockInfo {
  /** false when Odoo had none left at the last sync */
  available?: boolean;
}

export const isAvailable = (p: StockInfo): boolean => p.available !== false;

/**
 * What cannot be bought goes to the end of the list; otherwise the order is
 * kept. Applied before the colours are grouped, so a card's first colour is
 * one in stock and a card sinks only when none of its colours is.
 */
export function availableFirst<P extends StockInfo>(items: readonly P[]): P[] {
  return [...items.filter(isAvailable), ...items.filter((p) => !isAvailable(p))];
}
