import type { Prisma } from '../generated/prisma/client';

/**
 * Whether a product can be sold: false only when Odoo counts it and has none
 * left at the last sync. Hand-made products and services carry no count and
 * are always available.
 */
export const inStock = (odooStock: number | null): boolean => odooStock === null || odooStock > 0;

/** The same rule as a filter. Spelled out: `NOT { lte: 0 }` would also drop the null rows. */
export const IN_STOCK = { OR: [{ odooStock: null }, { odooStock: { gt: 0 } }] } satisfies Prisma.ProductWhereInput;
