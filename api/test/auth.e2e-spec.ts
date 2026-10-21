import { generate } from 'otplib';
import { createTestApp, type TestApp } from './utils/app';
import { bearer, csrf, login, showroomLogin } from './utils/auth';
import { PW, seedWorld, type World } from './utils/fixtures';

const cookieFrom = (res: { headers: Record<string, unknown> }, name: string) => {
  const list = (res.headers['set-cookie'] as string[] | undefined) ?? [];
  return list.find((c) => c.startsWith(`${name}=`)) ?? '';
};

describe('Auth (e2e)', () => {
  let t: TestApp;
  let world: World;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    world = await seedWorld(t.prisma);
  });
  afterAll(async () => {
    await t.close();
  });

  describe('POST /api/auth/login', () => {
    it('returns an access token, the profile and a hardened refresh cookie', async () => {
      const res = await t.http().post('/api/auth/login').send({ username: ' GH.Manager ', password: PW.manager });
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.user).toMatchObject({
        username: 'gh.manager',
        role: 'BRANCH_MANAGER',
        branch: { code: 'GH' },
        permissions: expect.arrayContaining(['product.create', 'product.reorder']),
      });
      expect(res.body.user.permissions).not.toContain('product.update.price');
      expect(res.body).not.toHaveProperty('refreshToken');
      const cookie = cookieFrom(res, 'wc_rt');
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/Secure/);
      expect(cookie).toMatch(/SameSite=Strict/);
      expect(cookie).toMatch(/Path=\/api\/auth/);
    });

    it('never stores or returns password hashes', async () => {
      const { body } = await login(t, 'admin', PW.admin);
      expect(JSON.stringify(body)).not.toMatch(/argon2|passwordHash/);
    });

    it('answers wrong passwords and unknown users identically', async () => {
      const wrong = await t.http().post('/api/auth/login').send({ username: 'admin', password: 'Nope#12345678' });
      const unknown = await t.http().post('/api/auth/login').send({ username: 'nobody', password: 'Nope#12345678' });
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body.message).toBe(unknown.body.message);
      expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects unexpected fields (forbidNonWhitelisted)', async () => {
      const res = await t.http().post('/api/auth/login').send({ username: 'admin', password: PW.admin, role: 'SUPER_ADMIN' });
      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual([{ field: 'role', messages: ['property role should not exist'] }]);
    });

    it('locks the account after 5 failures, even for the right password, and audits it', async () => {
      for (let i = 0; i < 4; i++) {
        expect((await t.http().post('/api/auth/login').send({ username: 'bo.cashier', password: 'Wrong#Pass1234' })).status).toBe(401);
      }
      const fifth = await t.http().post('/api/auth/login').send({ username: 'bo.cashier', password: 'Wrong#Pass1234' });
      expect(fifth.status).toBe(423);
      expect(fifth.headers['retry-after']).toBe('900');
      const correct = await t.http().post('/api/auth/login').send({ username: 'bo.cashier', password: PW.cashier });
      expect(correct.status).toBe(423);

      const entries = await t.prisma.activityLog.findMany({ where: { action: 'auth.login', actorUsername: 'bo.cashier' } });
      expect(entries).toHaveLength(6);
      expect(entries.every((e) => e.outcome === 'FAILURE')).toBe(true);
      expect(entries.some((e) => (e.metadata as { lockedNow?: boolean } | null)?.lockedNow)).toBe(true);
    });

    it('locks unknown usernames the same way (no username enumeration)', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        statuses.push((await t.http().post('/api/auth/login').send({ username: 'ghost.user', password: 'Wrong#Pass1234' })).status);
      }
      expect(statuses).toEqual([401, 401, 401, 401, 423, 423]);
    });

    it('rejects deactivated accounts', async () => {
      await t.prisma.user.update({ where: { username: 'finance' }, data: { isActive: false } });
      expect((await t.http().post('/api/auth/login').send({ username: 'finance', password: PW.finance })).status).toBe(401);
    });
  });

  describe('sessions', () => {
    it('GET /auth/me needs a valid bearer token', async () => {
      expect((await t.http().get('/api/auth/me')).status).toBe(401);
      expect((await t.http().get('/api/auth/me').set(bearer('not.a.jwt'))).status).toBe(401);
      const { token } = await login(t, 'finance', PW.finance);
      const me = await t.http().get('/api/auth/me').set(bearer(token));
      expect(me.status).toBe(200);
      expect(me.body.permissions).toEqual(['order.odoo.retry', 'order.read.all', 'product.read', 'product.update.price']);
    });

    it('refresh requires the CSRF header and rotates the cookie', async () => {
      const { cookie } = await login(t, 'admin', PW.admin);
      expect((await t.http().post('/api/auth/refresh').set('Cookie', cookie)).status).toBe(403);
      const res = await t.http().post('/api/auth/refresh').set('Cookie', cookie).set(csrf);
      expect(res.status).toBe(200);
      expect(res.body.user.username).toBe('admin');
      const rotated = cookieFrom(res, 'wc_rt').split(';')[0];
      expect(rotated).not.toBe(cookie);
      expect((await t.http().post('/api/auth/refresh').set('Cookie', rotated).set(csrf)).status).toBe(200);
    });

    it('detects refresh-token reuse and revokes the whole session', async () => {
      const { cookie, token } = await login(t, 'admin', PW.admin);
      const first = await t.http().post('/api/auth/refresh').set('Cookie', cookie).set(csrf);
      const next = cookieFrom(first, 'wc_rt').split(';')[0];
      // pretend the first token was used a minute ago (outside the two-tabs grace window)
      await t.prisma.refreshToken.updateMany({ where: { usedAt: { not: null } }, data: { usedAt: new Date(Date.now() - 60_000) } });

      expect((await t.http().post('/api/auth/refresh').set('Cookie', cookie).set(csrf)).status).toBe(401);
      expect((await t.http().post('/api/auth/refresh').set('Cookie', next).set(csrf)).status).toBe(401);
      expect((await t.http().get('/api/auth/me').set(bearer(token))).status).toBe(401);
      expect(await t.prisma.activityLog.count({ where: { action: 'auth.refresh.reuse_detected' } })).toBe(1);
    });

    it('logout revokes the session immediately (access token too)', async () => {
      const { cookie, token } = await login(t, 'bo.manager', PW.manager);
      const res = await t.http().post('/api/auth/logout').set('Cookie', cookie).set(csrf);
      expect(res.status).toBe(204);
      expect(cookieFrom(res, 'wc_rt')).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect((await t.http().get('/api/auth/me').set(bearer(token))).status).toBe(401);
      expect((await t.http().post('/api/auth/refresh').set('Cookie', cookie).set(csrf)).status).toBe(401);
      expect(await t.prisma.activityLog.count({ where: { action: 'auth.logout', actorUsername: 'bo.manager' } })).toBe(1);
    });
  });

  describe('showroom sign-in', () => {
    it('uses the separate showroom password and a scoped session', async () => {
      expect((await t.http().post('/api/auth/showroom/login').send({ username: 'gh.cashier', password: PW.cashier })).status).toBe(401);
      const s = await showroomLogin(t, 'gh.cashier', PW.showroom);
      expect(s.cookie).toMatch(/^wc_srt=/);
      const me = await t.http().get('/api/auth/showroom/me').set(bearer(s.token));
      expect(me.status).toBe(200);
      expect(me.body.branch.code).toBe('GH');
    });

    it('showroom tokens cannot reach dashboard routes and vice versa', async () => {
      const s = await showroomLogin(t, 'bo.manager', PW.showroom);
      const d = await login(t, 'bo.manager', PW.manager);
      const a = await t.http().get('/api/auth/me').set(bearer(s.token));
      expect(a.status).toBe(403);
      expect(a.body.code).toBe('WRONG_SESSION_TYPE');
      expect((await t.http().get('/api/auth/showroom/me').set(bearer(d.token))).status).toBe(403);
    });

    it('refuses accounts without a branch or without order.create', async () => {
      expect((await t.http().post('/api/auth/showroom/login').send({ username: 'finance', password: PW.finance })).status).toBe(401);
      await t.prisma.userPermissionOverride.create({
        data: { userId: world.gh.managerId, permissionKey: 'order.create', effect: 'REVOKE' },
      });
      const res = await t.http().post('/api/auth/showroom/login').send({ username: 'gh.manager', password: PW.showroom });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('NO_SHOWROOM_ACCESS');
    });

    it('keeps a separate lockout counter from the dashboard', async () => {
      for (let i = 0; i < 5; i++) {
        await t.http().post('/api/auth/showroom/login').send({ username: 'gh.cashier', password: 'Wrong#Pass1234' });
      }
      expect((await t.http().post('/api/auth/showroom/login').send({ username: 'gh.cashier', password: PW.showroom })).status).toBe(423);
      await login(t, 'gh.cashier', PW.cashier); // dashboard still fine
    });
  });

  describe('account', () => {
    it('changes the password with policy checks and signs out every session', async () => {
      const a = await login(t, 'gh.cashier', PW.cashier);
      const b = await login(t, 'gh.cashier', PW.cashier);
      const patch = (body: object) => t.http().patch('/api/account/password').set(bearer(a.token)).send(body);

      const weak = await patch({ currentPassword: PW.cashier, newPassword: 'short' });
      expect(weak.status).toBe(400);
      expect(weak.body.errors[0].field).toBe('newPassword');
      expect((await patch({ currentPassword: 'Wrong#Pass1234', newPassword: 'Brand#New#Pass9' })).body.code).toBe('WRONG_PASSWORD');
      expect((await patch({ currentPassword: PW.cashier, newPassword: 'Gh.Cashier#999x' })).body.code).toBe('PASSWORD_CONTAINS_USERNAME');

      expect((await patch({ currentPassword: PW.cashier, newPassword: 'Brand#New#Pass9' })).status).toBe(204);
      expect((await t.http().get('/api/auth/me').set(bearer(a.token))).status).toBe(401);
      expect((await t.http().get('/api/auth/me').set(bearer(b.token))).status).toBe(401);
      expect((await t.http().post('/api/auth/login').send({ username: 'gh.cashier', password: PW.cashier })).status).toBe(401);
      await login(t, 'gh.cashier', 'Brand#New#Pass9');
    });

    it('changes the showroom password only with the permission', async () => {
      const cashier = await login(t, 'gh.cashier', PW.cashier);
      const res = await t
        .http()
        .patch('/api/account/showroom-password')
        .set(bearer(cashier.token))
        .send({ currentPassword: PW.cashier, newPassword: 'New#Kiosk#2026' });
      expect(res.status).toBe(204);
      await showroomLogin(t, 'gh.cashier', 'New#Kiosk#2026');

      await t.prisma.userPermissionOverride.create({
        data: { userId: world.bo.cashierId, permissionKey: 'showroom.password.view_or_change', effect: 'REVOKE' },
      });
      const bo = await login(t, 'bo.cashier', PW.cashier);
      const denied = await t
        .http()
        .patch('/api/account/showroom-password')
        .set(bearer(bo.token))
        .send({ currentPassword: PW.cashier, newPassword: 'New#Kiosk#2026' });
      expect(denied.status).toBe(403);
      expect(await t.prisma.activityLog.count({ where: { action: 'access.denied', actorUsername: 'bo.cashier' } })).toBe(1);
    });
  });

  describe('two-factor authentication', () => {
    it('setup → verify → login with TOTP → replay rejected → recovery code once → disable', async () => {
      const { token } = await login(t, 'finance', PW.finance);
      const auth = bearer(token);

      expect((await t.http().post('/api/account/2fa/setup').set(auth).send({ password: 'wrong' })).status).toBe(400);
      const setup = await t.http().post('/api/account/2fa/setup').set(auth).send({ password: PW.finance });
      expect(setup.status).toBe(200);
      expect(setup.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
      const secret: string = setup.body.secret;

      // not active until verified
      expect((await t.http().post('/api/auth/login').send({ username: 'finance', password: PW.finance })).body.accessToken).toBeDefined();
      expect((await t.http().post('/api/account/2fa/enable').set(auth).send({ code: '000000' })).status).toBe(400);
      const enable = await t.http().post('/api/account/2fa/enable').set(auth).send({ code: await generate({ secret }) });
      expect(enable.status).toBe(200);
      expect(enable.body.recoveryCodes).toHaveLength(10);
      const stored = await t.prisma.user.findUniqueOrThrow({ where: { username: 'finance' } });
      expect(stored.twoFactorSecretEnc).not.toContain(secret);

      const step1 = await t.http().post('/api/auth/login').send({ username: 'finance', password: PW.finance });
      expect(step1.body).toEqual({ twoFactorRequired: true, challengeToken: expect.any(String) });
      const challengeToken = step1.body.challengeToken;

      const bad = await t.http().post('/api/auth/login/2fa').send({ challengeToken, code: '000000' });
      expect(bad.status).toBe(401);
      expect(bad.body.code).toBe('INVALID_2FA');

      // the enable step consumed the current time step; use the next one (within the ±30 s window)
      const nextCode = await generate({ secret, epoch: Math.floor(Date.now() / 1000) + 30 });
      const ok = await t.http().post('/api/auth/login/2fa').send({ challengeToken, code: nextCode });
      expect(ok.status).toBe(200);
      expect(ok.body.accessToken).toBeDefined();
      expect((await t.http().post('/api/auth/login/2fa').send({ challengeToken, code: nextCode })).status).toBe(401);

      const recovery = enable.body.recoveryCodes[0];
      expect((await t.http().post('/api/auth/login/2fa').send({ challengeToken, recoveryCode: recovery })).status).toBe(200);
      expect((await t.http().post('/api/auth/login/2fa').send({ challengeToken, recoveryCode: recovery })).status).toBe(401);

      const status = await t.http().get('/api/account/2fa').set(bearer(ok.body.accessToken));
      expect(status.body).toEqual({ enabled: true, recoveryCodesRemaining: 9 });

      const disable = await t
        .http()
        .post('/api/account/2fa/disable')
        .set(bearer(ok.body.accessToken))
        .send({ password: PW.finance, recoveryCode: enable.body.recoveryCodes[1] });
      expect(disable.status).toBe(204);
      expect((await t.http().post('/api/auth/login').send({ username: 'finance', password: PW.finance })).body.accessToken).toBeDefined();

      const actions = (await t.prisma.activityLog.findMany({ where: { actorUsername: 'finance' }, orderBy: { id: 'asc' } })).map(
        (e) => `${e.action}:${e.outcome}`,
      );
      expect(actions).toEqual(
        expect.arrayContaining([
          'account.2fa.setup:FAILURE',
          'account.2fa.setup:SUCCESS',
          'account.2fa.enable:SUCCESS',
          'auth.login.2fa:FAILURE',
          'auth.login.2fa:SUCCESS',
          'account.2fa.disable:SUCCESS',
        ]),
      );
    });

    it('rejects expired or forged challenge tokens', async () => {
      const res = await t.http().post('/api/auth/login/2fa').send({ challengeToken: 'eyJhbGciOiJIUzI1NiJ9.e30.x', code: '123456' });
      expect(res.status).toBe(401);
    });
  });

  describe('hardening', () => {
    it('sends security headers and never leaks internals', async () => {
      const res = await t.http().get('/api/auth/me');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toContain("default-src 'self'");
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-request-id']).toEqual(expect.any(String));
      expect(JSON.stringify(res.body)).not.toMatch(/stack|at .*\.ts/);
    });

    it('applies the CORS allowlist', async () => {
      const allowed = await t.http().options('/api/auth/login').set('Origin', 'http://localhost:3000').set('Access-Control-Request-Method', 'POST');
      expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(allowed.headers['access-control-allow-credentials']).toBe('true');
      const denied = await t.http().options('/api/auth/login').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('propagates a caller-supplied request id into the audit log', async () => {
      await t.http().post('/api/auth/login').set('X-Request-Id', 'trace-12345678').send({ username: 'admin', password: 'x' });
      const entry = await t.prisma.activityLog.findFirstOrThrow({ where: { action: 'auth.login' }, orderBy: { id: 'desc' } });
      expect(entry.requestId).toBe('trace-12345678');
    });
  });
});

describe('Auth rate limiting (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ AUTH_THROTTLE_LIMIT: '3' });
    await seedWorld(t.prisma);
  });
  afterAll(async () => {
    await t.close();
  });

  it('returns 429 after the per-IP auth budget is spent', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await t.http().post('/api/auth/login').send({ username: 'nobody', password: 'x' })).status);
    }
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses[3]).toBe(429);
    // non-auth routes are not affected by the auth budget
    expect((await t.http().get('/api/health')).status).toBe(200);
  });
});
