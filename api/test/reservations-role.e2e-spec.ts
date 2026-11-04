import { createTestApp, type TestApp } from './utils/app';
import { bearer, login } from './utils/auth';
import { PW, seedWorld } from './utils/fixtures';

describe('Reservations role (e2e)', () => {
  let t: TestApp;
  let admin: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await seedWorld(t.prisma);
    admin = (await login(t, 'admin', PW.admin)).token;
  });
  afterAll(async () => {
    await t.close();
  });

  it('the Super Admin creates a Reservations account without a branch', async () => {
    // the seeded one already owns "reservations", so the new one gets a suffix
    const res = await t.http().post('/api/users').set(bearer(admin)).send({ displayName: 'Amani', role: 'RESERVATIONS' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('RESERVATIONS');
    expect(res.body.user.branch).toBeNull();
    expect(res.body.credentials.username).toMatch(/^reservations\.[a-z0-9]{4}$/);
  });

  it("the role holds exactly the three booking permissions and the website's orders by default", async () => {
    const me = await login(t, 'reservations', PW.reservations);
    const user = me.body.user as { role: string; permissions: string[] };
    expect(user.role).toBe('RESERVATIONS');
    expect([...user.permissions].sort()).toEqual(['booking.general.manage', 'booking.ppf.manage', 'booking.ppf.read', 'order.web.handle']);
  });

  it('the Super Admin holds the booking permissions too', async () => {
    const me = await login(t, 'admin', PW.admin);
    expect((me.body.user as { permissions: string[] }).permissions).toEqual(
      expect.arrayContaining(['booking.ppf.read', 'booking.ppf.manage', 'booking.general.manage']),
    );
  });
});
