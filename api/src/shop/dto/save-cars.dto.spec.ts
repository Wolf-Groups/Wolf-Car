import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SaveCarsDto } from './shop.dto';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const errors = (body: unknown) => validateSync(plainToInstance(SaveCarsDto, body)).map((e) => e.property);

describe('SaveCarsDto', () => {
  it('accepts up to five different category ids, or none', () => {
    expect(errors({ categoryIds: [id(1), id(2), id(3), id(4), id(5)] })).toEqual([]);
    expect(errors({ categoryIds: [] })).toEqual([]);
  });

  it('refuses a sixth car, the same car twice, or something that is not an id', () => {
    expect(errors({ categoryIds: [id(1), id(2), id(3), id(4), id(5), id(6)] })).toEqual(['categoryIds']);
    expect(errors({ categoryIds: [id(1), id(1)] })).toEqual(['categoryIds']);
    expect(errors({ categoryIds: ['leopard-8'] })).toEqual(['categoryIds']);
    expect(errors({})).toEqual(['categoryIds']);
  });
});
