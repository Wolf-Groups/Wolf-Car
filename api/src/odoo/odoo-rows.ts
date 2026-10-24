/**
 * Decides which Odoo product variants belong in this catalogue and maps them
 * onto the shape this database wants. Pure functions only — the import script
 * does the I/O.
 */
import { BARCODE_PATTERN, PRICE_PATTERN, PRODUCT_NAME_MAX } from '../../../shared/validation';
import { normaliseText } from '../legacy-import/legacy-rows';

/** A product.product row as read with VARIANT_FIELDS. Odoo sends `false` for an empty field. */
export interface OdooVariant {
  id: number;
  display_name: string;
  /** The company's own "Arabic Product Name" field; the same for every variant of a product. */
  arabic_name: string | false;
  /** Empty for a product without variants; one id per attribute (colour, size, …) otherwise. */
  product_template_variant_value_ids: number[];
  product_tmpl_id: [number, string];
  barcode: string | false;
  lst_price: number;
  active: boolean;
  sale_ok: boolean;
  type: string;
  /** false for a good Odoo does not count (no stock is kept for it) */
  is_storable: boolean;
  categ_id: [number, string] | false;
  /** "2026-08-12 07:27:15" — when the variant was last changed in Odoo */
  write_date: string;
}

export const VARIANT_FIELDS = [
  'display_name',
  'arabic_name',
  'product_template_variant_value_ids',
  'product_tmpl_id',
  'barcode',
  'lst_price',
  'active',
  'sale_ok',
  'type',
  'is_storable',
  'categ_id',
  'write_date',
] as const;

/** A product.template.attribute.value row: the "Black" of a colour variant. */
export interface OdooAttributeValue {
  id: number;
  name: string;
  html_color: string | false;
}

/** A stock.quant row: how many of one variant lie in one location. */
export interface OdooQuant {
  product_id: [number, string];
  quantity: number;
  reserved_quantity: number;
}

/** The internal locations (shelves, not customers or suppliers): what the company holds. */
export const STOCK_DOMAIN = [['location_id.usage', '=', 'internal']] as const;
export const QUANT_FIELDS = ['product_id', 'quantity', 'reserved_quantity'] as const;

/**
 * Units free to sell per variant id: on hand minus reserved, summed over the
 * locations. Read from stock.quant because the integration user may not read
 * product.product's own qty_available (it needs Manufacturing rights).
 */
export function freeStock(quants: readonly OdooQuant[]): Map<number, number> {
  const free = new Map<number, number>();
  for (const q of quants) {
    const id = q.product_id[0];
    free.set(id, (free.get(id) ?? 0) + q.quantity - q.reserved_quantity);
  }
  // Odoo keeps units as floats; this catalogue sells whole parts
  for (const [id, units] of free) free.set(id, Math.floor(units + 1e-9));
  return free;
}

/** A product.category row. */
export interface OdooCategory {
  id: number;
  complete_name: string;
  parent_id: [number, string] | false;
}

export interface OdooProduct {
  odooId: number;
  /** Shared by the colours/sizes of one product. */
  templateOdooId: number;
  /** "أسود" — null for a product that comes in one form only. */
  variantLabel: string | null;
  /** "#060505", when Odoo has a swatch for the colour. */
  variantColor: string | null;
  name: string;
  barcode: string | null;
  /** QAR with two decimals, e.g. "99.00" */
  price: string;
  categoryOdooId: number | null;
  /** Odoo's full category path, e.g. "Car / LEOPARD / LEOPARD 5" */
  categoryPath: string | null;
  /** Anything the import had to change or drop, reported at the end of the run. */
  warnings: string[];
}

const pathParts = (path: string): string[] =>
  path
    .split('/')
    .map((part) => normaliseText(part))
    .filter(Boolean);

/** Why a variant is left out of the catalogue, or null when it belongs in it. */
export function skipReason(v: OdooVariant): string | null {
  if (!v.active) return 'archived';
  if (!v.sale_ok) return 'not for sale';
  // a service (a software install, say) is sold like a part once it has a real price
  if (v.categ_id && pathParts(v.categ_id[1]).some((part) => part.toLowerCase() === 'expenses')) return 'expenses category';
  // 0 and 1 are placeholders in Odoo, not prices
  if (!Number.isFinite(v.lst_price) || v.lst_price <= 1) return 'price is 0 or 1';
  if (!PRICE_PATTERN.test(v.lst_price.toFixed(2))) return 'price out of range';
  if (normaliseText(v.display_name).length < 2) return 'no usable name';
  return null;
}

/** Odoo holds the colours and sizes in English only. Keyed in lower case. */
const VARIANT_LABELS_AR: Readonly<Record<string, string>> = {
  black: 'أسود',
  white: 'أبيض',
  'off white': 'أوف وايت',
  beige: 'بيج',
  brown: 'بني',
  orange: 'برتقالي',
  maroon: 'عنابي',
  red: 'أحمر',
  blue: 'أزرق',
  'light blue': 'أزرق فاتح',
  'deep blue': 'أزرق غامق',
  green: 'أخضر',
  gray: 'رمادي',
  grey: 'رمادي',
  silver: 'فضي',
  gold: 'ذهبي',
  carbon: 'كربون',
  carbo: 'كربون',
  small: 'صغير',
  medium: 'وسط',
  big: 'كبير',
  large: 'كبير',
};

const ARABIC = /[\u0600-\u06FF]/;

/** The variant's name as the showroom shows it: Arabic where it is known. */
export function variantLabel(name: string): string {
  const text = normaliseText(name);
  // some values are written in both languages: "Matte/مطفي"
  const arabicPart = text.split('/').map((part) => part.trim()).find((part) => ARABIC.test(part));
  return (arabicPart ?? VARIANT_LABELS_AR[text.toLowerCase()] ?? text).slice(0, 60);
}

/** Maps a variant that passed skipReason. `value` is its colour or size, when it has one. */
export function toProduct(v: OdooVariant, value?: OdooAttributeValue): OdooProduct {
  const warnings: string[] = [];
  const label = value ? variantLabel(value.name) : null;

  // the Arabic name belongs to the product, so every variant carries the same
  // one; Odoo's own name already ends in the English "(Black)", which goes
  const odooName = normaliseText(v.display_name);
  const base = normaliseText(v.arabic_name || '') || (label ? odooName.replace(/\s*\([^()]*\)$/, '') : odooName);
  const suffix = label ? ` (${label})` : '';
  let name = `${base}${suffix}`;
  if (name.length > PRODUCT_NAME_MAX) {
    warnings.push(`name truncated to ${PRODUCT_NAME_MAX} characters`);
    // the colour must survive, or the variants of a long name become identical
    name = `${base.slice(0, PRODUCT_NAME_MAX - suffix.length)}${suffix}`;
  }

  let barcode: string | null = (v.barcode ? normaliseText(v.barcode) : '') || null;
  if (barcode && !BARCODE_PATTERN.test(barcode)) {
    warnings.push(`dropped unusable barcode ${JSON.stringify(barcode)}`);
    barcode = null;
  }

  return {
    odooId: v.id,
    templateOdooId: v.product_tmpl_id[0],
    variantLabel: label,
    variantColor: value && value.html_color && /^#[0-9a-fA-F]{6}$/.test(value.html_color) ? value.html_color.toLowerCase() : null,
    name,
    barcode,
    price: v.lst_price.toFixed(2),
    categoryOdooId: v.categ_id ? v.categ_id[0] : null,
    categoryPath: v.categ_id ? v.categ_id[1] : null,
    warnings,
  };
}

/** "Car / LEOPARD / LEOPARD 5" → "LEOPARD 5": the last part is the car model. */
export function categoryName(path: string): string {
  const parts = pathParts(path);
  return (parts.at(-1) ?? normaliseText(path)).slice(0, 120);
}

/** Cars that Odoo names differently from the old catalogue, as legacyCategoryKey output. */
const LEGACY_ALIASES: Readonly<Record<string, string>> = {
  jetour1: 'jetourt1',
  jetour2: 'jetourt2',
  lynk900: 'lyk900',
  v27: 'icar',
  tesla: 'teslaaccessories',
  yu7: 'xiaomiaccessories',
};

/**
 * A comparison key for a category name, so an Odoo category ("LEOPARD 5") can
 * take over the Arabic name and car photo of the old category for the same
 * car ("Leopard 5"). Call it on the Odoo name and on the old English name.
 */
export function legacyCategoryKey(name: string): string {
  const key = normaliseText(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return LEGACY_ALIASES[key] ?? key;
}

/**
 * The brand a car model sits under, or null. A category directly under a root
 * ("Car / LEOPARD") gets no parent: the root is not a brand, and linking to it
 * would make its products common to every car.
 */
export function parentCategoryOdooId(category: OdooCategory, byId: ReadonlyMap<number, OdooCategory>): number | null {
  const parent = category.parent_id ? byId.get(category.parent_id[0]) : undefined;
  return parent?.parent_id ? parent.id : null;
}

/** Arabic names for the Odoo categories the old catalogue had no equivalent of, by legacyCategoryKey. */
const CATEGORY_NAMES_AR: Readonly<Record<string, string>> = {
  leopard: 'ليوبارد',
  jetour: 'جيتور',
  tank: 'تانك',
  tank300: 'تانك 300',
  haval: 'هافال',
  rox01: 'روكس 01',
  roxadamas: 'روكس أداماس',
  dinza: 'دينزا',
  dinza5: 'دينزا 5',
  dinza8: 'دينزا 8',
  caraccessories: 'اكسسوارات السيارات',
  othercar: 'سيارات أخرى',
  oils: 'زيوت',
};

export function arabicCategoryName(name: string): string | null {
  return CATEGORY_NAMES_AR[legacyCategoryKey(name)] ?? null;
}
