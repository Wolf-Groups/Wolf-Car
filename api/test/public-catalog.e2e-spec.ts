import { createTestApp, type TestApp } from './utils/app';
import { seedWorld } from './utils/fixtures';

describe('Public catalogue (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    await seedWorld(t.prisma);
  });
  afterAll(async () => {
    await t.close();
  });

  it('is public and lists every product by name with image, name, description and price', async () => {
    const res = await t.http().get('/api/public/products');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(res.body.map((p: { name: string }) => p.name)).toEqual(['Dash Cam', 'Floor Mats', 'Phone Holder']);
    for (const product of res.body) {
      expect(Object.keys(product).sort()).toEqual([
        'available',
        'categoryId',
        'description',
        'groupId',
        'id',
        'imageUrl',
        'name',
        'price',
        'thumbUrl',
        'variantColor',
        'variantLabel',
      ]);
    }
    expect(res.body.map((p: { price: string | null }) => p.price)).toEqual(['499.00', '120.50', null]);
  });

  it('never includes the barcode anywhere in the response', async () => {
    const res = await t.http().get('/api/public/products');
    expect(res.text).not.toMatch(/"barcode"|priceUpdatedAt/i);
    const deepKeys = (v: unknown): string[] =>
      v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...deepKeys(x)]) : [];
    const leafValues = (v: unknown): unknown[] => (v && typeof v === 'object' ? Object.values(v).flatMap(leafValues) : [v]);
    expect(deepKeys(res.body)).not.toEqual(expect.arrayContaining(['barcode']));
    // the seeded barcodes themselves must not appear as any value either
    const values = leafValues(res.body).map(String);
    for (const secret of ['1000000000001', '1000000000003']) expect(values).not.toContain(secret);
    expect(res.text).not.toContain('1000000000001');
  });
});
