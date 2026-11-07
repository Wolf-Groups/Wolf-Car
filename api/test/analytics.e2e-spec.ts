import { createTestApp, type TestApp } from './utils/app';
import { bearer, login } from './utils/auth';
import { PW, seedWorld } from './utils/fixtures';
import { qatarToday, addDays, toDate } from '../src/common/day';
import { AnalyticsService, RETENTION_DAYS } from '../src/analytics/analytics.service';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

describe('Visitor statistics (e2e)', () => {
  let t: TestApp;
  let admin: string;
  const today = qatarToday();

  const send = (userAgent: string, body: Record<string, unknown>) =>
    t.http().post('/api/public/events').set('User-Agent', userAgent).set('Origin', 'http://localhost:3000').send(body);
  const summary = (token: string, from = today, to = today) => t.http().get(`/api/analytics/summary?from=${from}&to=${to}`).set(bearer(token));

  beforeAll(async () => {
    t = await createTestApp();
    await seedWorld(t.prisma);
    admin = (await login(t, 'admin', PW.admin)).token;

    // a phone visitor from Instagram: two pages, a car model, a product in the basket, the order on WhatsApp
    await send(IPHONE, { type: 'pageview', path: '/ar', entry: true, referrer: 'https://l.instagram.com/?u=x' });
    await send(IPHONE, { type: 'pageview', path: '/ar/products' });
    await send(IPHONE, { type: 'model_view', path: '/ar/products', label: 'Tank 500' });
    await send(IPHONE, { type: 'add_to_cart', path: '/ar/products', label: 'Floor Mats', targetId: 'p-1' });
    await send(IPHONE, { type: 'add_to_cart', path: '/ar/products', label: 'Floor Mats', targetId: 'p-1' });
    await send(IPHONE, { type: 'whatsapp_order', path: '/ar/products', label: 'binomran' });
    // …and opened WolfOS from the landing page's section
    await send(IPHONE, { type: 'wolfos', path: '/ar', label: 'section' });
    // a desktop visitor who typed the address, read one page and called
    await send(CHROME, { type: 'pageview', path: '/en/packages', entry: true, referrer: 'http://localhost:3000/en' });
    await send(CHROME, { type: 'call', path: '/en/packages', label: 'gharrafa' });
  });
  afterAll(async () => {
    await t.close();
  });

  it('accepts events from anyone and answers 204 with no body', async () => {
    const res = await send(CHROME, { type: 'whatsapp_chat', path: '/en', label: 'gharrafa' });
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
  });

  it('rejects unknown event types and extra fields', async () => {
    expect((await send(CHROME, { type: 'purchase', path: '/en' })).status).toBe(400);
    expect((await send(CHROME, { type: 'pageview', path: 'en' })).status).toBe(400);
    expect((await send(CHROME, { type: 'pageview', path: '/en', ip: '1.2.3.4' })).status).toBe(400);
  });

  it('stores no IP address and no user agent, only a daily hash', async () => {
    const rows = await t.prisma.siteEvent.findMany();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.visitor).toMatch(/^[0-9a-f]{32}$/);
      expect(JSON.stringify(row, (_, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toMatch(/127\.0\.0\.1|::1|Mozilla/);
    }
    expect(new Set(rows.map((r) => r.visitor)).size).toBe(2);
  });

  it('silently drops crawlers and staff pages', async () => {
    const before = await t.prisma.siteEvent.count();
    expect((await send('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', { type: 'pageview', path: '/ar' })).status).toBe(204);
    expect((await send(CHROME, { type: 'pageview', path: '/en/dashboard/orders' })).status).toBe(204);
    expect(await t.prisma.siteEvent.count()).toBe(before);
  });

  it('is readable by the Super Admin only', async () => {
    expect((await t.http().get(`/api/analytics/summary?from=${today}&to=${today}`)).status).toBe(401);
    for (const [user, password] of [
      ['finance', PW.finance],
      ['gh.cashier', PW.cashier],
    ] as const) {
      expect((await summary((await login(t, user, password)).token)).status).toBe(403);
    }
    expect((await summary(admin)).status).toBe(200);
  });

  it('adds up visitors, page views, sources and button presses for the chosen days', async () => {
    const { body } = await summary(admin, addDays(today, -1), today);
    expect(body.totals).toEqual({
      visitors: 2,
      visits: 2,
      pageviews: 3,
      whatsappOrder: 1,
      whatsappBooking: 0,
      whatsappChat: 1,
      calls: 1,
      addToCart: 2,
      visitorsAdded: 1,
      visitorsOrdered: 1,
      visitorsContacted: 2,
      wolfos: 1,
    });
    expect(body.previous.visitors).toBe(0);
    expect(body.daily).toEqual([
      { day: addDays(today, -1), visitors: 0, pageviews: 0, contacts: 0 },
      { day: today, visitors: 2, pageviews: 3, contacts: 3 },
    ]);
    expect(body.pages).toEqual([
      { path: '/', views: 1, visitors: 1 },
      { path: '/packages', views: 1, visitors: 1 },
      { path: '/products', views: 1, visitors: 1 },
    ]);
    // the desktop visit's referrer was the website itself, so it counts as direct
    expect(body.sources).toEqual([
      { source: 'direct', visits: 1 },
      { source: 'instagram', visits: 1 },
    ]);
    expect(body.devices).toEqual([
      { device: 'desktop', visitors: 1 },
      { device: 'mobile', visitors: 1 },
    ]);
    expect(body.locales).toEqual([
      { locale: 'ar', visitors: 1 },
      { locale: 'en', visitors: 1 },
    ]);
    expect(body.products).toEqual([{ id: 'p-1', name: 'Floor Mats', count: 2 }]);
    expect(body.models).toEqual([{ name: 'Tank 500', count: 1 }]);
  });

  it('refuses a backwards range, a range over a year and malformed days', async () => {
    const backwards = await summary(admin, today, addDays(today, -1));
    expect([backwards.status, backwards.body.code]).toEqual([400, 'ANALYTICS_RANGE_INVALID']);
    const long = await summary(admin, addDays(today, -400), today);
    expect([long.status, long.body.code]).toEqual([400, 'ANALYTICS_RANGE_TOO_LONG']);
    expect((await summary(admin, '2026-02-30', today)).status).toBe(400);
  });

  it('deletes rows older than the retention period and nothing newer', async () => {
    const old = { type: 'pageview', visitor: 'a'.repeat(32), path: '/', locale: 'ar', device: 'mobile' };
    await t.prisma.siteEvent.createMany({
      data: [
        { ...old, day: toDate(addDays(today, -RETENTION_DAYS - 1)) },
        { ...old, day: toDate(addDays(today, -RETENTION_DAYS)) },
      ],
    });
    const before = await t.prisma.siteEvent.count();
    expect(await t.app.get(AnalyticsService).prune()).toBe(1);
    expect(await t.prisma.siteEvent.count()).toBe(before - 1);
  });
});
