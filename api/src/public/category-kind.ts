import { legacyCategoryKey } from '../odoo/odoo-rows';

/**
 * Catalogue groupings that are not a car model: parts and accessories common
 * to every car, services, and consumable brands. Keys as legacyCategoryKey()
 * makes them from the English name. A new service tab in Odoo goes here, or
 * customers could add it to "My cars".
 */
const NOT_A_CAR: ReadonlySet<string> = new Set([
  'genuineparts',
  'caraccessories',
  'ppf',
  'ppfservices',
  'services',
  'software',
  'wurth',
  'windowtintingservices',
  'nanoceramiccoating',
  'rubberpaint',
  'blackedetion',
  'blackedition',
  'thabt',
]);

/** Whether a category is a car model a customer can drive ("Leopard 5"), as opposed to "Genuine Parts" or "PPF". */
export function isCarModel(category: { name: string; nameEn: string | null }): boolean {
  return !NOT_A_CAR.has(legacyCategoryKey(category.nameEn ?? category.name));
}
