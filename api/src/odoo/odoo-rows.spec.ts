import {
  arabicCategoryName,
  categoryName,
  freeStock,
  legacyCategoryKey,
  parentCategoryOdooId,
  skipReason,
  toProduct,
  variantLabel,
  type OdooCategory,
  type OdooVariant,
} from './odoo-rows';

const variant = (over: Partial<OdooVariant> = {}): OdooVariant => ({
  id: 2729,
  display_name: 'ARM REST COVER (Black)',
  arabic_name: 'غطاء مسند الذراع',
  product_template_variant_value_ids: [235],
  product_tmpl_id: [2406, 'ARM REST COVER'],
  barcode: '10011100161',
  lst_price: 99,
  active: true,
  sale_ok: true,
  type: 'consu',
  is_storable: true,
  categ_id: [29, 'Car / CAR ACCESSORIES'],
  write_date: '2026-08-12 07:27:15',
  ...over,
});

describe('skipReason', () => {
  it('accepts a sellable, priced good', () => {
    expect(skipReason(variant())).toBeNull();
  });

  it.each([
    [0, 'price is 0 or 1'],
    [1, 'price is 0 or 1'],
    [-5, 'price is 0 or 1'],
    [Number.NaN, 'price is 0 or 1'],
  ])('rejects the placeholder price %p', (lst_price, reason) => {
    expect(skipReason(variant({ lst_price }))).toBe(reason);
  });

  it('accepts a price just above 1', () => {
    expect(skipReason(variant({ lst_price: 1.01 }))).toBeNull();
  });

  it('rejects a price too large for the price column', () => {
    expect(skipReason(variant({ lst_price: 99_999_999_999 }))).toBe('price out of range');
  });

  it('rejects services, archived and not-for-sale products', () => {
    expect(skipReason(variant({ type: 'service' }))).toBe('service');
    expect(skipReason(variant({ active: false }))).toBe('archived');
    expect(skipReason(variant({ sale_ok: false }))).toBe('not for sale');
  });

  it('rejects anything under an Expenses category, however it is spaced or cased', () => {
    expect(skipReason(variant({ categ_id: [5, 'Expenses'] }))).toBe('expenses category');
    expect(skipReason(variant({ categ_id: [6, 'All/expenses / Fuel'] }))).toBe('expenses category');
  });

  it('rejects a product whose name is too short to show', () => {
    expect(skipReason(variant({ display_name: ' x ' }))).toBe('no usable name');
  });
});

describe('toProduct', () => {
  const black = { id: 235, name: 'Black', html_color: '#060505' };

  it('maps a clean variant, with its colour in Arabic', () => {
    expect(toProduct(variant(), black)).toEqual({
      odooId: 2729,
      templateOdooId: 2406,
      variantLabel: 'أسود',
      variantColor: '#060505',
      name: 'غطاء مسند الذراع (أسود)',
      barcode: '10011100161',
      price: '99.00',
      categoryOdooId: 29,
      categoryPath: 'Car / CAR ACCESSORIES',
      warnings: [],
    });
  });

  it('normalises Arabic presentation forms and whitespace in the name', () => {
    expect(toProduct(variant({ arabic_name: '  ﻟﻴﻮﺑﺎرد   5 ', product_template_variant_value_ids: [] })).name).toBe('ليوبارد 5');
  });

  it('uses the Arabic name alone for a product without variants, even when the English name ends in brackets', () => {
    const p = toProduct(variant({ display_name: 'Covers Set (2-PCS)', arabic_name: 'طقم أغطية', product_template_variant_value_ids: [] }));
    expect(p).toMatchObject({ name: 'طقم أغطية', variantLabel: null, variantColor: null, templateOdooId: 2406 });
  });

  it('falls back to the Odoo name when there is no Arabic name, still with the Arabic colour', () => {
    expect(toProduct(variant({ arabic_name: false }), black).name).toBe('ARM REST COVER (أسود)');
    expect(toProduct(variant({ arabic_name: '   ' }), black).name).toBe('ARM REST COVER (أسود)');
    expect(toProduct(variant({ arabic_name: false, display_name: 'Covers Set (2-PCS)', product_template_variant_value_ids: [] })).name).toBe(
      'Covers Set (2-PCS)',
    );
  });

  it('keeps a colour it has no Arabic for, and ignores a swatch that is not a hex colour', () => {
    const p = toProduct(variant(), { id: 9, name: 'Carbon Fibre', html_color: 'rgb(1,2,3)' });
    expect(p).toMatchObject({ variantLabel: 'Carbon Fibre', variantColor: null, name: 'غطاء مسند الذراع (Carbon Fibre)' });
    expect(toProduct(variant(), { id: 9, name: 'Red', html_color: false }).variantColor).toBeNull();
  });

  it('truncates an over-long name and says so', () => {
    const p = toProduct(variant({ arabic_name: 'x'.repeat(200) }));
    expect(p.name).toHaveLength(120);
    expect(p.warnings).toEqual(['name truncated to 120 characters']);
  });

  it('drops a barcode the app cannot store, keeping the product', () => {
    const p = toProduct(variant({ barcode: '1001 110/056' }));
    expect(p.barcode).toBeNull();
    expect(p.warnings).toEqual(['dropped unusable barcode "1001 110/056"']);
  });

  it('treats a missing barcode and a missing category as empty', () => {
    const p = toProduct(variant({ barcode: false, categ_id: false }), black);
    expect(p).toMatchObject({ barcode: null, categoryOdooId: null, categoryPath: null, warnings: [] });
  });

  it('rounds the price to two decimals', () => {
    expect(toProduct(variant({ lst_price: 49.999 })).price).toBe('50.00');
  });
});

describe('categoryName', () => {
  it('keeps the last part of the Odoo path', () => {
    expect(categoryName('Car / LEOPARD / LEOPARD 5')).toBe('LEOPARD 5');
    expect(categoryName('Car/XIAOMI/YU7')).toBe('YU7');
    expect(categoryName('THABT')).toBe('THABT');
  });

  it('ignores a trailing separator', () => {
    expect(categoryName('Car / ROX / ')).toBe('ROX');
  });
});

describe('legacyCategoryKey', () => {
  it('matches an Odoo category to the old category of the same car, ignoring case and spacing', () => {
    expect(legacyCategoryKey('LEOPARD 5')).toBe(legacyCategoryKey('Leopard 5'));
    expect(legacyCategoryKey('JETOUR G700')).toBe(legacyCategoryKey('Jetour G700'));
    expect(legacyCategoryKey('ROX')).toBe(legacyCategoryKey('Rox'));
  });

  it('knows the cars Odoo names differently', () => {
    expect(legacyCategoryKey('JETOUR1')).toBe(legacyCategoryKey('Jetour T1'));
    expect(legacyCategoryKey('JETOUR2')).toBe(legacyCategoryKey('Jetour T2'));
    expect(legacyCategoryKey('LYNK 900')).toBe(legacyCategoryKey('LYK-900'));
    expect(legacyCategoryKey('V27')).toBe(legacyCategoryKey('iCar'));
    expect(legacyCategoryKey('TESLA')).toBe(legacyCategoryKey('Tesla Accessories'));
    expect(legacyCategoryKey('YU7')).toBe(legacyCategoryKey('Xiaomi Accessories'));
  });

  it('keeps different cars apart', () => {
    expect(legacyCategoryKey('LEOPARD 5')).not.toBe(legacyCategoryKey('Leopard 8'));
    expect(legacyCategoryKey('LEOPARD')).not.toBe(legacyCategoryKey('Leopard 5'));
  });
});

describe('variantLabel', () => {
  it('translates the colours and sizes Odoo holds in English', () => {
    expect(variantLabel('Black')).toBe('أسود');
    expect(variantLabel(' off  white ')).toBe('أوف وايت');
    expect(variantLabel('SMALL')).toBe('صغير');
  });

  it('takes the Arabic half of a value written in both languages', () => {
    expect(variantLabel('Matte/مطفي')).toBe('مطفي');
  });

  it('leaves an unknown value as it is', () => {
    expect(variantLabel('10IN1')).toBe('10IN1');
  });
});

describe('parentCategoryOdooId', () => {
  const cats: OdooCategory[] = [
    { id: 5, complete_name: 'Car', parent_id: false },
    { id: 7, complete_name: 'Car / LEOPARD', parent_id: [5, 'Car'] },
    { id: 23, complete_name: 'Car / LEOPARD / LEOPARD 5', parent_id: [7, 'Car / LEOPARD'] },
    { id: 40, complete_name: 'THABT', parent_id: false },
  ];
  const byId = new Map(cats.map((c) => [c.id, c]));

  it('links a car model to its brand', () => {
    expect(parentCategoryOdooId(cats[2], byId)).toBe(7);
  });

  it('does not link a brand to the root, or everything would be common to every car', () => {
    expect(parentCategoryOdooId(cats[1], byId)).toBeNull();
  });

  it('has no parent for a top-level category or an unknown parent', () => {
    expect(parentCategoryOdooId(cats[3], byId)).toBeNull();
    expect(parentCategoryOdooId({ id: 99, complete_name: 'X / Y', parent_id: [404, 'X'] }, byId)).toBeNull();
  });
});

describe('arabicCategoryName', () => {
  it('knows the cars and lines the old catalogue did not have', () => {
    expect(arabicCategoryName('ROX ADAMAS')).toBe('روكس أداماس');
    expect(arabicCategoryName('Car Accessories')).toBe('اكسسوارات السيارات');
  });

  it('returns null for a name it does not know', () => {
    expect(arabicCategoryName('THABT')).toBeNull();
  });
});

describe('freeStock', () => {
  const quant = (id: number, quantity: number, reserved_quantity = 0) => ({ product_id: [id, 'x'] as [number, string], quantity, reserved_quantity });

  it('sums the locations of a variant and takes off what is reserved', () => {
    expect(freeStock([quant(7, 10), quant(7, 5, 3), quant(8, 2)])).toEqual(new Map([[7, 12], [8, 2]]));
  });

  it('keeps a negative count, as Odoo has it, and rounds part units down', () => {
    expect(freeStock([quant(7, -2), quant(8, 2.5)])).toEqual(new Map([[7, -2], [8, 2]]));
  });
});
