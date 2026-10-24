import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { syncOdooCatalogue, type OdooReader } from '../src/odoo/odoo-sync';
import type { OdooQuant, OdooVariant } from '../src/odoo/odoo-rows';
import { createTestApp, type TestApp } from './utils/app';
import { bearer, login } from './utils/auth';
import { PW, seedWorld, type World } from './utils/fixtures';

/** A stand-in for Odoo holding a few products that the test edits between runs. */
class FakeOdoo implements OdooReader {
  variants: OdooVariant[] = [];
  templateDates = new Map<number, string>();
  images = new Map<number, string>();
  quants: OdooQuant[] = [];
  imageReads = 0;

  searchRead<T>(model: string): Promise<T[]> {
    if (model === 'product.product') return Promise.resolve(this.variants.filter((v) => v.active) as T[]);
    if (model === 'stock.quant') return Promise.resolve(this.quants as T[]);
    if (model === 'product.template') return Promise.resolve([...this.templateDates].map(([id, write_date]) => ({ id, write_date })) as T[]);
    if (model === 'product.category') {
      return Promise.resolve([
        { id: 5, complete_name: 'Car', parent_id: false },
        { id: 7, complete_name: 'Car / E2EBRAND', parent_id: [5, 'Car'] },
        { id: 23, complete_name: 'Car / E2EBRAND / E2EMODEL', parent_id: [7, 'Car / E2EBRAND'] },
      ] as T[]);
    }
    return Promise.resolve([]);
  }

  read<T>(model: string, ids: number[]): Promise<T[]> {
    if (model === 'product.product') {
      this.imageReads += ids.length;
      return Promise.resolve(ids.map((id) => ({ id, image_1920: this.images.get(id) ?? false })) as T[]);
    }
    return Promise.resolve(ids.map((id) => ({ id, name: id === 235 ? 'Black' : 'Beige', html_color: '#060505' })) as T[]);
  }
}

const variant = (over: Partial<OdooVariant>): OdooVariant => ({
  id: 1,
  display_name: 'Mat',
  arabic_name: 'دعاسة',
  product_template_variant_value_ids: [],
  product_tmpl_id: [100, 'Mat'],
  barcode: '900001',
  lst_price: 50,
  active: true,
  sale_ok: true,
  type: 'consu',
  is_storable: true,
  categ_id: [23, 'Car / E2EBRAND / E2EMODEL'],
  write_date: '2026-10-01 08:00:00',
  ...over,
});

describe('Odoo catalogue sync (e2e)', () => {
  let t: TestApp;
  let world: World;
  let uploadDir: string;
  let odoo: FakeOdoo;
  let admin: string;

  beforeAll(async () => {
    t = await createTestApp();
    world = await seedWorld(t.prisma);
    admin = (await login(t, 'admin', PW.admin)).token;
    uploadDir = await mkdtemp(path.join(tmpdir(), 'wolfcar-odoo-'));
    await t.prisma.category.deleteMany({ where: { odooId: { in: [7, 23] } } });
    odoo = new FakeOdoo();
    odoo.variants = [
      variant({ id: 1 }),
      variant({ id: 2, display_name: 'Arm rest (Black)', arabic_name: 'مسند', product_tmpl_id: [200, 'Arm rest'], product_template_variant_value_ids: [235], barcode: '900002', lst_price: 99 }),
      variant({ id: 3, display_name: 'Arm rest (Beige)', arabic_name: 'مسند', product_tmpl_id: [200, 'Arm rest'], product_template_variant_value_ids: [236], barcode: '900003', lst_price: 99 }),
      variant({ id: 4, display_name: 'Common part', arabic_name: 'قطعة مشتركة', product_tmpl_id: [300, 'Common'], barcode: '900004', lst_price: 20, categ_id: [7, 'Car / E2EBRAND'] }),
      variant({ id: 5, display_name: 'Placeholder price', product_tmpl_id: [400, 'P'], lst_price: 1 }),
    ];
    for (const id of [100, 200, 300, 400]) odoo.templateDates.set(id, '2026-10-01 08:00:00');
    odoo.images.set(1, (await sharp({ create: { width: 40, height: 40, channels: 3, background: '#cc0000' } }).png().toBuffer()).toString('base64'));
  });
  afterAll(async () => {
    await t.prisma.category.deleteMany({ where: { odooId: { in: [7, 23] } } });
    await rm(uploadDir, { recursive: true, force: true });
    await t.close();
  });

  const run = () => syncOdooCatalogue(t.prisma, odoo, { uploadDir });
  const byOdooId = async (odooId: number) => t.prisma.product.findUniqueOrThrow({ where: { odooId } });

  it('creates the products Odoo offers and leaves hand-made ones alone', async () => {
    const s = await run();
    expect(s).toMatchObject({ variants: 5, imported: 4, created: 4, updated: 0, unchanged: 0, imagesFetched: 1, skipped: { 'price is 0 or 1': 1 } });

    const mat = await byOdooId(1);
    expect(mat).toMatchObject({ name: 'دعاسة', barcode: '900001', isActive: true, variantLabel: null });
    expect(mat.price?.toFixed(2)).toBe('50.00');
    expect(await byOdooId(2)).toMatchObject({ name: 'مسند (أسود)', odooTemplateId: 200, variantLabel: 'أسود', variantColor: '#060505' });
    // the sync on a timer never hides what staff added in the dashboard
    expect(await t.prisma.product.count({ where: { odooId: null, isActive: true } })).toBe(world.products.length);
    // new products are placed in every branch's showroom
    expect(await t.prisma.branchProduct.count({ where: { productId: mat.id } })).toBe(2);
  });

  it('touches nothing when Odoo has not changed', async () => {
    const reads = odoo.imageReads;
    const before = await byOdooId(1);
    const s = await run();
    expect(s).toMatchObject({ created: 0, updated: 0, unchanged: 4, imagesFetched: 0 });
    expect(odoo.imageReads).toBe(reads);
    expect((await byOdooId(1)).updatedAt).toEqual(before.updatedAt);
  });

  it('picks up a new price, name and photo, and only for the product that changed', async () => {
    const before = await byOdooId(1);
    odoo.variants[0] = variant({ id: 1, arabic_name: 'دعاسة فاخرة', lst_price: 65 });
    odoo.templateDates.set(100, '2026-10-02 09:30:00');
    odoo.images.set(1, (await sharp({ create: { width: 40, height: 40, channels: 3, background: '#0000cc' } }).png().toBuffer()).toString('base64'));

    const s = await run();
    expect(s).toMatchObject({ created: 0, updated: 1, unchanged: 3, repriced: 1, imagesFetched: 1 });
    const after = await byOdooId(1);
    expect(after.name).toBe('دعاسة فاخرة');
    expect(after.price?.toFixed(2)).toBe('65.00');
    expect(after.imageKey).not.toBe(before.imageKey);
    const history = await t.prisma.priceHistory.findMany({ where: { productId: after.id }, orderBy: { changedAt: 'asc' } });
    expect(history.map((h) => [h.oldPrice?.toFixed(2) ?? null, h.newPrice.toFixed(2)])).toEqual([
      [null, '50.00'],
      ['50.00', '65.00'],
    ]);
  });

  it('keeps the stock up to date without counting the product as changed', async () => {
    expect((await byOdooId(1)).odooStock).toBe(0);
    const quant = (id: number, quantity: number, reserved_quantity = 0): OdooQuant => ({ product_id: [id, 'x'], quantity, reserved_quantity });
    // two shelves, three units promised to a customer
    odoo.quants = [quant(1, 10), quant(1, 5, 3), quant(3, 2)];
    odoo.variants[3] = { ...odoo.variants[3], is_storable: false };

    expect(await run()).toMatchObject({ updated: 0, restocked: 3 });
    expect((await byOdooId(1)).odooStock).toBe(12);
    expect((await byOdooId(2)).odooStock).toBe(0);
    expect((await byOdooId(3)).odooStock).toBe(2);
    // Odoo keeps no stock for it: unknown, not zero
    expect((await byOdooId(4)).odooStock).toBeNull();
    expect(await run()).toMatchObject({ restocked: 0 });
  });

  it('switches off what Odoo archives or reprices to 1, and brings it back later', async () => {
    odoo.variants[3] = { ...odoo.variants[3], active: false };
    odoo.variants[1] = { ...odoo.variants[1], lst_price: 1, write_date: '2026-10-03 10:00:00' };
    expect(await run()).toMatchObject({ switchedOff: 2, created: 0 });
    expect((await byOdooId(4)).isActive).toBe(false);
    expect((await byOdooId(2)).isActive).toBe(false);
    expect(await run()).toMatchObject({ switchedOff: 0 });

    odoo.variants[3] = { ...odoo.variants[3], active: true };
    expect(await run()).toMatchObject({ updated: 1 });
    expect((await byOdooId(4)).isActive).toBe(true);
  });

  it('writes nothing when Odoo cannot be read', async () => {
    const broken: OdooReader = { searchRead: () => Promise.reject(new Error('Odoo answered HTTP 502')), read: () => Promise.resolve([]) };
    const before = await t.prisma.product.count();
    await expect(syncOdooCatalogue(t.prisma, broken, { uploadDir })).rejects.toThrow('502');
    expect(await t.prisma.product.count()).toBe(before);
  });

  describe('in the dashboard', () => {
    it('does not let staff change the price, name, barcode or photo of an Odoo product', async () => {
      const { id } = await byOdooId(1);
      const price = await t.http().patch(`/api/products/${id}/price`).set(bearer(admin)).send({ price: '10' });
      expect(price.status).toBe(409);
      expect(price.body.code).toBe('ODOO_MANAGED');
      const name = await t.http().patch(`/api/products/${id}`).set(bearer(admin)).field('name', 'Renamed here');
      expect(name.status).toBe(409);
      expect((await byOdooId(1)).name).toBe('دعاسة فاخرة');

      // the description is ours: Odoo has none
      const description = await t.http().patch(`/api/products/${id}`).set(bearer(admin)).field('description', 'Fits all models');
      expect(description.status).toBe(200);
      expect(description.body).toMatchObject({ description: 'Fits all models', fromOdoo: true, stock: 12 });
    });

    it('still lets staff edit a product they made themselves', async () => {
      const res = await t.http().patch(`/api/products/${world.products[0].id}/price`).set(bearer(admin)).send({ price: '510' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ fromOdoo: false, stock: null });
    });

    it('reports that Odoo is not connected, and refuses to sync, when it is not set up', async () => {
      const status = await t.http().get('/api/odoo/sync').set(bearer(admin));
      expect(status.status).toBe(200);
      expect(status.body).toMatchObject({ configured: false, running: false, everyMinutes: 15, last: null });
      const sync = await t.http().post('/api/odoo/sync').set(bearer(admin));
      expect(sync.status).toBe(400);
      expect(sync.body.code).toBe('ODOO_NOT_CONFIGURED');
    });

    it('lets only those who manage prices start a sync', async () => {
      const cashier = (await login(t, 'gh.cashier', PW.cashier)).token;
      expect((await t.http().post('/api/odoo/sync').set(bearer(cashier))).status).toBe(403);
    });
  });
});
