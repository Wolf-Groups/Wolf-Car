import { createTestApp, type TestApp } from './utils/app';
import { bearer, showroomLogin } from './utils/auth';
import { PW, seedWorld, type World } from './utils/fixtures';
import { createWebOrder, CUSTOMER_PHONE, defaultBasket, SHOP_ENV, signInCustomer } from './utils/shop';

/** A product Odoo has none left of: listed as not available, and refused when ordered. */
describe('Out-of-stock products (e2e)', () => {
  let t: TestApp;
  let world: World;
  let goneId: string;

  beforeAll(async () => {
    t = await createTestApp({ ...SHOP_ENV });
    world = await seedWorld(t.prisma);
    // Dash Cam is priced and on both branches' lists: only its stock stops the sale
    goneId = world.products[0].id;
    await t.prisma.product.update({ where: { id: goneId }, data: { odooStock: 0 } });
    await t.prisma.product.update({ where: { id: world.products[1].id }, data: { odooStock: 4 } });
  });
  afterAll(async () => {
    await t.close();
  });

  const availability = (body: { id: string; available: boolean }[]) => Object.fromEntries(body.map((p) => [p.id, p.available]));

  it('is still on the website, marked not available, and never with a count', async () => {
    const res = await t.http().get('/api/public/products');
    expect(res.status).toBe(200);
    expect(availability(res.body)).toEqual({ [goneId]: false, [world.products[1].id]: true, [world.products[2].id]: true });
    expect(res.body[0]).not.toHaveProperty('stock');
    expect(res.body[0]).not.toHaveProperty('odooStock');
  });

  it('cannot be bought online', async () => {
    const sara = await signInCustomer(t, CUSTOMER_PHONE);
    const res = await createWebOrder(t, sara, { ...defaultBasket(world), items: [{ productId: goneId, quantity: 1 }, { productId: world.products[1].id, quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PRODUCT_UNAVAILABLE');
    expect(res.body.productIds).toEqual([goneId]);
  });

  it('is in the showroom as not available, and cannot be ordered there', async () => {
    const kiosk = await showroomLogin(t, 'gh.cashier', PW.showroom);
    const list = await t.http().get('/api/showroom/products').set(bearer(kiosk.token));
    expect(availability(list.body.products)).toEqual({ [goneId]: false, [world.products[1].id]: true });

    const order = (productId: string) =>
      t
        .http()
        .post('/api/showroom/orders')
        .set(bearer(kiosk.token))
        .send({ items: [{ productId, quantity: 1 }], customerName: 'Sara', userId: (kiosk.body.user as { id: string }).id });
    const refused = await order(goneId);
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('PRODUCT_UNAVAILABLE');
    // one in stock still sells
    expect((await order(world.products[1].id)).status).toBe(201);
  });
});
