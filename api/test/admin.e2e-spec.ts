import { generate } from 'otplib';
import { createTestApp, type TestApp } from './utils/app';
import { bearer, login, showroomLogin } from './utils/auth';
import { PW, seedWorld, type World } from './utils/fixtures';

describe('Administration: users, branches, permissions (e2e)', () => {
  let t: TestApp;
  let world: World;
  let admin: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    world = await seedWorld(t.prisma);
    admin = (await login(t, 'admin', PW.admin)).token;
  });
  afterAll(async () => {
    await t.close();
  });

  const as = (token: string) => ({
    get: (url: string) => t.http().get(url).set(bearer(token)),
    post: (url: string, body: object = {}) => t.http().post(url).set(bearer(token)).send(body),
    patch: (url: string, body: object) => t.http().patch(url).set(bearer(token)).send(body),
    put: (url: string, body: object) => t.http().put(url).set(bearer(token)).send(body),
    del: (url: string) => t.http().delete(url).set(bearer(token)),
  });

  describe('only the Super Admin can administer', () => {
    it.each([
      ['finance', PW.finance],
      ['gh.manager', PW.manager],
      ['gh.cashier', PW.cashier],
    ])('%s gets 403 on every admin route', async (username, password) => {
      const token = (await login(t, username, password)).token;
      const api = as(token);
      const responses = await Promise.all([
        api.get('/api/users'),
        api.post('/api/users', { displayName: 'X', role: 'FINANCE' }),
        api.post(`/api/users/${world.financeId}/reset-password`),
        api.get('/api/branches'),
        api.post('/api/branches', {}),
        api.get('/api/permissions'),
        api.put('/api/roles/CASHIER/permissions', { permissions: [] }),
        api.put(`/api/users/${world.gh.cashierId}/permissions`, { overrides: [] }),
      ]);
      expect(responses.map((r) => r.status)).toEqual(Array(responses.length).fill(403));
    });
  });

  describe('users', () => {
    it('creates Finance/Super Admin accounts with generated credentials that work once handed over', async () => {
      const res = await as(admin).post('/api/users', { displayName: 'Aisha Finance', email: 'Aisha@WolfCar.qa', role: 'FINANCE' });
      expect(res.status).toBe(201);
      expect(res.body.user).toMatchObject({ displayName: 'Aisha Finance', email: 'aisha@wolfcar.qa', role: 'FINANCE' });
      expect(res.body.credentials.username).toMatch(/^finance\.[a-z2-9]{4}$/); // "finance" is taken
      expect(JSON.stringify(res.body.user)).not.toMatch(/hash/i);
      await login(t, res.body.credentials.username, res.body.credentials.password);
      const row = await t.prisma.user.findUniqueOrThrow({ where: { id: res.body.user.id } });
      expect(row.passwordHash).toMatch(/^\$argon2id\$/);
      const log = await t.prisma.activityLog.findFirstOrThrow({ where: { action: 'user.create' } });
      expect(JSON.stringify(log.after)).not.toContain(res.body.credentials.password);
    });

    it('does not create branch staff directly (they come with their branch)', async () => {
      const res = await as(admin).post('/api/users', { displayName: 'X', role: 'CASHIER', branchId: world.gh.id });
      expect(res.status).toBe(400);
    });

    it('lists and filters users without secrets', async () => {
      const res = await as(admin).get(`/api/users?branchId=${world.gh.id}&pageSize=10`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      expect(res.body.items.map((u: { username: string }) => u.username).sort()).toEqual(['gh.cashier', 'gh.manager']);
      expect(JSON.stringify(res.body)).not.toMatch(/argon2|Hash/);
      const search = await as(admin).get('/api/users?q=CASHIER&status=active');
      expect(search.body.total).toBe(2);
    });

    it('resets a password: new one works, old one and old sessions do not', async () => {
      const old = await login(t, 'gh.cashier', PW.cashier);
      const res = await as(admin).post(`/api/users/${world.gh.cashierId}/reset-password`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ username: 'gh.cashier', branchCode: 'GH', password: expect.any(String) });
      expect((await t.http().get('/api/auth/me').set(bearer(old.token))).status).toBe(401);
      expect((await t.http().post('/api/auth/login').send({ username: 'gh.cashier', password: PW.cashier })).status).toBe(401);
      await login(t, 'gh.cashier', res.body.password);
    });

    it('resets the showroom password separately', async () => {
      const res = await as(admin).post(`/api/users/${world.bo.managerId}/reset-showroom-password`);
      expect(res.status).toBe(200);
      expect(res.body.password).toBeUndefined();
      await showroomLogin(t, 'bo.manager', res.body.showroomPassword);
      await login(t, 'bo.manager', PW.manager); // dashboard password unchanged
      expect((await as(admin).post(`/api/users/${world.financeId}/reset-showroom-password`)).status).toBe(400);
    });

    it('sets a password the admin chose, for the dashboard and for the showroom', async () => {
      const chosen = 'Chosen#Wolf2026!';
      const res = await as(admin).post(`/api/users/${world.gh.cashierId}/reset-password`).send({ password: chosen });
      expect(res.status).toBe(200);
      expect(res.body.password).toBe(chosen);
      await login(t, 'gh.cashier', chosen);

      const kiosk = 'Kiosk#Wolf2026!!';
      const showroom = await as(admin).post(`/api/users/${world.gh.cashierId}/reset-showroom-password`).send({ password: kiosk });
      expect(showroom.status).toBe(200);
      expect(showroom.body.showroomPassword).toBe(kiosk);
      await showroomLogin(t, 'gh.cashier', kiosk);

      // the chosen password is never written to the activity log
      const logs = await t.prisma.activityLog.findMany({ where: { action: { in: ['user.password.reset', 'user.showroom_password.reset'] } } });
      const dump = JSON.stringify(logs, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value));
      expect(logs).toHaveLength(2);
      expect(dump).not.toContain(chosen);
      expect(dump).not.toContain(kiosk);
    });

    it('refuses a chosen password that is weak or is the username, and changes nothing', async () => {
      const before = await t.prisma.user.findUniqueOrThrow({ where: { id: world.bo.cashierId }, select: { passwordHash: true } });
      const weak = await as(admin).post(`/api/users/${world.bo.cashierId}/reset-password`).send({ password: 'short' });
      expect(weak.status).toBe(400);
      const same = await as(admin).post(`/api/users/${world.bo.cashierId}/reset-password`).send({ password: 'Bo.Cashier#2026' });
      expect(same.status).toBe(400);
      const extra = await as(admin).post(`/api/users/${world.bo.cashierId}/reset-password`).send({ password: 'Chosen#Wolf2026!', role: 'SUPER_ADMIN' });
      expect(extra.status).toBe(400);
      const after = await t.prisma.user.findUniqueOrThrow({ where: { id: world.bo.cashierId }, select: { passwordHash: true } });
      expect(after.passwordHash).toBe(before.passwordHash);
    });

    it("resets a user's 2FA so they can sign in with the password alone", async () => {
      const fin = (await login(t, 'finance', PW.finance)).token;
      const setup = await as(fin).post('/api/account/2fa/setup', { password: PW.finance });
      await as(fin).post('/api/account/2fa/enable', { code: await generate({ secret: setup.body.secret }) });
      expect((await t.http().post('/api/auth/login').send({ username: 'finance', password: PW.finance })).body.twoFactorRequired).toBe(true);

      const res = await as(admin).post(`/api/users/${world.financeId}/reset-2fa`);
      expect(res.status).toBe(200);
      expect(res.body.twoFactorEnabled).toBe(false);
      expect((await t.http().get('/api/auth/me').set(bearer(fin))).status).toBe(401);
      await login(t, 'finance', PW.finance);
      expect(await t.prisma.recoveryCode.count({ where: { userId: world.financeId } })).toBe(0);
    });

    it('deactivating signs the user out; reactivating lets them back in', async () => {
      const fin = await login(t, 'finance', PW.finance);
      expect((await as(admin).patch(`/api/users/${world.financeId}`, { isActive: false })).status).toBe(200);
      expect((await t.http().get('/api/auth/me').set(bearer(fin.token))).status).toBe(401);
      expect((await t.http().post('/api/auth/login').send({ username: 'finance', password: PW.finance })).status).toBe(401);
      await as(admin).patch(`/api/users/${world.financeId}`, { isActive: true });
      await login(t, 'finance', PW.finance);
    });

    it('unlocks a locked account', async () => {
      for (let i = 0; i < 5; i++) await t.http().post('/api/auth/login').send({ username: 'finance', password: 'Wrong#Pass1234' });
      expect((await t.http().post('/api/auth/login').send({ username: 'finance', password: PW.finance })).status).toBe(423);
      const list = await as(admin).get('/api/users?q=finance');
      expect(list.body.items[0].locked).toBe(true);
      expect((await as(admin).post(`/api/users/${world.financeId}/unlock`)).status).toBe(200);
      await login(t, 'finance', PW.finance);
    });

    it('protects the acting admin and branch staff from destructive changes', async () => {
      expect((await as(admin).patch(`/api/users/${world.adminId}`, { isActive: false })).body.code).toBe('SELF_DEACTIVATE');
      expect((await as(admin).del(`/api/users/${world.adminId}`)).body.code).toBe('SELF_DELETE');
      expect((await as(admin).patch(`/api/users/${world.gh.cashierId}`, { role: 'FINANCE' })).body.code).toBe('BRANCH_ROLE_FIXED');
      expect((await as(admin).del(`/api/users/${world.gh.cashierId}`)).body.code).toBe('BRANCH_STAFF');
      expect((await as(admin).get('/api/users/00000000-0000-4000-8000-000000000999')).status).toBe(404);
      expect((await as(admin).get('/api/users/not-a-uuid')).status).toBe(400);
    });

    it('deletes Finance accounts (soft delete, audit kept)', async () => {
      expect((await as(admin).del(`/api/users/${world.financeId}`)).status).toBe(204);
      expect((await as(admin).get(`/api/users/${world.financeId}`)).status).toBe(404);
      expect(await t.prisma.user.count({ where: { id: world.financeId } })).toBe(1);
      const log = await t.prisma.activityLog.findFirstOrThrow({ where: { action: 'user.delete' } });
      expect(log.entityId).toBe(world.financeId);
    });
  });

  describe('branches', () => {
    it('creates a branch with exactly one manager and one cashier and the full catalogue', async () => {
      const res = await as(admin).post('/api/branches', {
        code: 'wk',
        name: 'Al Wakra Branch',
        nameAr: 'فرع الوكرة',
        manager: { displayName: 'Wakra Manager' },
        cashier: { displayName: 'Wakra Cashier', email: 'cashier@wolfcar.qa' },
      });
      expect(res.status).toBe(201);
      expect(res.body.branch).toMatchObject({
        code: 'WK',
        manager: { username: 'wk.manager' },
        cashier: { username: 'wk.cashier', email: 'cashier@wolfcar.qa' },
      });
      expect(res.body.credentials).toHaveLength(2);
      const [manager, cashier] = res.body.credentials;
      const m = await login(t, manager.username, manager.password);
      expect((m.body.user as { branch: { code: string } }).branch.code).toBe('WK');
      await showroomLogin(t, cashier.username, cashier.showroomPassword);
      expect(await t.prisma.branchProduct.count({ where: { branchId: res.body.branch.id } })).toBe(world.products.length);
      const log = await t.prisma.activityLog.findFirstOrThrow({ where: { action: 'branch.create' } });
      expect(log.branchId).toBe(res.body.branch.id);
      expect(JSON.stringify([log.before, log.after, log.metadata])).not.toContain(manager.password);
    });

    it('rejects duplicate codes and invalid staff input without leaving anything behind', async () => {
      const dup = await as(admin).post('/api/branches', {
        code: 'GH',
        name: 'Dup',
        nameAr: 'مكرر',
        manager: { displayName: 'M' + 'x' },
        cashier: { displayName: 'Cx' },
      });
      expect(dup.status).toBe(409);
      const bad = await as(admin).post('/api/branches', { code: 'W1', name: 'x', nameAr: 'y', manager: {}, cashier: {} });
      expect(bad.status).toBe(400);
      expect(bad.body.errors.map((e: { field: string }) => e.field)).toEqual(
        expect.arrayContaining(['code', 'name', 'manager.displayName', 'cashier.displayName']),
      );
      expect(await t.prisma.branch.count()).toBe(2);
      expect(await t.prisma.user.count()).toBe(7);
    });

    it('replaces the cashier atomically: old account retired, new one works', async () => {
      const oldSession = await login(t, 'gh.cashier', PW.cashier);
      const res = await as(admin).post(`/api/branches/${world.gh.id}/staff/cashier/replace`, { displayName: 'New Cashier' });
      expect(res.status).toBe(200);
      expect(res.body.credentials.username).toMatch(/^gh\.cashier\.[a-z2-9]{4}$/);
      expect(res.body.branch.cashier.displayName).toBe('New Cashier');
      expect((await t.http().get('/api/auth/me').set(bearer(oldSession.token))).status).toBe(401);
      expect((await t.http().post('/api/auth/login').send({ username: 'gh.cashier', password: PW.cashier })).status).toBe(401);
      await login(t, res.body.credentials.username, res.body.credentials.password);
      expect(await t.prisma.user.count({ where: { branchId: world.gh.id, role: 'CASHIER', deletedAt: null } })).toBe(1);
    });

    it('offers a minimal branch list (no staff details) to users who filter by branch', async () => {
      const finance = (await login(t, 'finance', PW.finance)).token;
      const res = await as(finance).get('/api/branches/options');
      expect(res.status).toBe(200);
      expect(res.body.map((b: { code: string }) => b.code)).toEqual(['BO', 'GH']);
      expect(Object.keys(res.body[0]).sort()).toEqual(['code', 'id', 'isActive', 'name', 'nameAr']);
      expect((await as((await login(t, 'gh.cashier', PW.cashier)).token).get('/api/branches/options')).status).toBe(403);
    });

    it('updates names and the active flag, and an inactive branch cannot use the showroom', async () => {
      const res = await as(admin).patch(`/api/branches/${world.bo.id}`, { name: 'Bin Omran HQ', isActive: false });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: 'Bin Omran HQ', isActive: false, code: 'BO' });
      expect((await as(admin).patch(`/api/branches/${world.bo.id}`, { code: 'XX' })).status).toBe(400);
      expect((await t.http().post('/api/auth/showroom/login').send({ username: 'bo.cashier', password: PW.showroom })).status).toBe(403);
    });
  });

  describe('database constraints (not just application logic)', () => {
    it('refuses a second manager for a branch', async () => {
      await expect(
        t.prisma.user.create({
          data: { username: 'gh.manager.two', displayName: 'Two', role: 'BRANCH_MANAGER', branchId: world.gh.id, passwordHash: 'x' },
        }),
      ).rejects.toThrow(/users_one_manager_per_branch|Unique constraint/);
    });

    it('refuses to leave a branch without a cashier', async () => {
      await expect(
        t.prisma.user.update({ where: { id: world.gh.cashierId }, data: { deletedAt: new Date() } }),
      ).rejects.toThrow(/exactly one manager and one cashier/);
    });

    it('refuses a branch without staff', async () => {
      await expect(t.prisma.branch.create({ data: { code: 'ZZ', name: 'Empty', nameAr: 'فارغ' } })).rejects.toThrow(
        /exactly one manager and one cashier/,
      );
    });

    it('refuses a branch for Finance and no branch for a cashier', async () => {
      await expect(t.prisma.user.update({ where: { id: world.financeId }, data: { branchId: world.gh.id } })).rejects.toThrow(
        /users_role_branch_check/,
      );
    });

    it('keeps the activity log append-only', async () => {
      await login(t, 'admin', PW.admin);
      await expect(t.prisma.activityLog.deleteMany({})).rejects.toThrow(/append-only/);
      await expect(t.prisma.activityLog.updateMany({ data: { action: 'tampered' } })).rejects.toThrow(/append-only/);
    });
  });

  describe('permissions', () => {
    it('shows the catalogue and the role matrix with Super Admin locked', async () => {
      const catalog = await as(admin).get('/api/permissions');
      expect(catalog.body.map((p: { key: string }) => p.key)).toContain('showroom.password.view_or_change');
      const matrix = await as(admin).get('/api/roles/permissions');
      expect(matrix.body.locked).toEqual(['SUPER_ADMIN']);
      expect(matrix.body.roles.CASHIER).toContain('order.confirm');
      expect((await as(admin).put('/api/roles/SUPER_ADMIN/permissions', { permissions: [] })).body.code).toBe('ROLE_LOCKED');
      expect((await as(admin).put('/api/roles/NOPE/permissions', { permissions: [] })).status).toBe(400);
      expect((await as(admin).put('/api/roles/CASHIER/permissions', { permissions: ['made.up'] })).status).toBe(400);
    });

    it('revoking a role permission takes effect immediately for signed-in users', async () => {
      const fin = (await login(t, 'finance', PW.finance)).token;
      expect((await as(fin).get('/api/auth/me')).body.permissions).toContain('order.read.all');
      const res = await as(admin).put('/api/roles/FINANCE/permissions', { permissions: ['product.read', 'product.update.price'] });
      expect(res.status).toBe(200);
      expect((await as(fin).get('/api/auth/me')).body.permissions).not.toContain('order.read.all');
      const log = await t.prisma.activityLog.findFirstOrThrow({ where: { action: 'permission.role.update' } });
      expect(log.before).toEqual({ permissions: ['order.odoo.retry', 'order.read.all', 'product.read', 'product.update.price'] });
      expect(log.entityId).toBe('FINANCE');
    });

    it('grants and revokes per user on top of the role', async () => {
      const res = await as(admin).put(`/api/users/${world.gh.cashierId}/permissions`, {
        overrides: [
          { permission: 'order.read.all', effect: 'GRANT' },
          { permission: 'order.confirm', effect: 'REVOKE' },
        ],
      });
      expect(res.status).toBe(200);
      expect(res.body.effective).toContain('order.read.all');
      expect(res.body.effective).not.toContain('order.confirm');
      const cashier = (await login(t, 'gh.cashier', PW.cashier)).token;
      const perms = (await as(cashier).get('/api/auth/me')).body.permissions;
      expect(perms).toContain('order.read.all');
      expect(perms).not.toContain('order.confirm');
      // the other cashier is unaffected
      const other = (await login(t, 'bo.cashier', PW.cashier)).token;
      expect((await as(other).get('/api/auth/me')).body.permissions).toContain('order.confirm');

      const dup = await as(admin).put(`/api/users/${world.gh.cashierId}/permissions`, {
        overrides: [
          { permission: 'order.read.all', effect: 'GRANT' },
          { permission: 'order.read.all', effect: 'REVOKE' },
        ],
      });
      expect(dup.status).toBe(400);
      expect((await as(admin).put(`/api/users/${world.adminId}/permissions`, { overrides: [] })).body.code).toBe('ROLE_LOCKED');
    });

    it('lets the admin give user.manage to Finance, and the API follows', async () => {
      const fin = (await login(t, 'finance', PW.finance)).token;
      expect((await as(fin).get('/api/users')).status).toBe(403);
      await as(admin).put(`/api/users/${world.financeId}/permissions`, { overrides: [{ permission: 'user.manage', effect: 'GRANT' }] });
      expect((await as(fin).get('/api/users')).status).toBe(200);
    });
  });
});
