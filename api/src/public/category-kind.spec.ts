import { isCarModel } from './category-kind';

describe('isCarModel', () => {
  it.each(['Leopard 5', 'TANK 300', 'Jetour T2', 'OTHER CAR', 'Tesla Accessories', 'Xiaomi Accessories'])('is true for the car model %s', (nameEn) => {
    expect(isCarModel({ name: 'x', nameEn })).toBe(true);
  });

  it.each(['Genuine Parts', 'CAR ACCESSORIES', 'PPF', 'PPF SERVICES', 'Services', 'Software', 'WURTH', 'Window Tinting Services', 'Nano Ceramic Coating', 'Rubber Paint', 'BLACK EDETION', 'THABT'])(
    'is false for %s',
    (nameEn) => {
      expect(isCarModel({ name: 'x', nameEn })).toBe(false);
    },
  );

  it('falls back to the Arabic name when there is no English one', () => {
    expect(isCarModel({ name: 'ليوبارد 5', nameEn: null })).toBe(true);
  });
});
