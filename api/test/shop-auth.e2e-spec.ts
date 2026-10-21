import type { Server } from 'node:http';
import request from 'supertest';
import { OTP_MAX_ATTEMPTS } from '../../shared/shop';
import { createTestApp, type TestApp } from './utils/app';
import { csrf } from './utils/auth';
import { seedWorld } from './utils/fixtures';
import { CUSTOMER_PHONE, customerCookieOf, SHOP_ENV, signInCustomer } from './utils/shop';

/** The Env default (OTP_PER_PHONE_PER_15_MIN). */
const OTP_PER_PHONE_PER_15_MIN = 3;

describe('Customer sign-in by phone code (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ ...SHOP_ENV });
  });
  beforeEach(async () => {
    await seedWorld(t.prisma);
  });
  afterAll(async () => {
    await t.close();
  });

  const send = (phone: unknown) => t.http().post('/api/shop/otp').set(csrf).send({ phone });
  const verify = (phone: string, code: string) => t.http().post('/api/shop/otp/verify').set(csrf).send({ phone, code });
  const me = (cookie: string) => t.http().get('/api/shop/me').set('Cookie', cookie);
  const sendAndRead = async (phone: string): Promise<string> => {
    const res = await send(phone);
    expect(res.status).toBe(200);
    return res.body.devCode as string;
  };

  it('refuses anything that is not a Qatari mobile number', async () => {
    for (const phone of ['44123456', '+966551234567', 'abc', '5512345', '551234567', 123, '']) {
      const res = await send(phone);
      expect(res.status).toBe(400);
      expect(res.body.errors.map((e: { field: string }) => e.field)).toContain('phone');
    }
    expect(await t.prisma.customerOtp.count()).toBe(0);
  });

  it('sends a code and, in test, shows it in the answer — never the code itself in the database', async () => {
    const res = await send('55123456');
    expect(res.status).toBe(200);
    expect(typeof res.body.expiresAt).toBe('string');
    expect(new Date(res.body.expiresAt as string).getTime() - Date.now()).toBeGreaterThan(4 * 60_000);
    expect(res.body.devCode).toMatch(/^\d{6}$/);

    const row = await t.prisma.customerOtp.findFirstOrThrow();
    expect(row.phone).toBe(CUSTOMER_PHONE);
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.codeHash).not.toContain(res.body.devCode);
    expect(row.attempts).toBe(0);
    expect(row.consumedAt).toBeNull();
    // no customer exists until a code is verified
    expect(await t.prisma.customer.count()).toBe(0);
  });

  // a cross-site HTML form (urlencoded, no preflight) cannot set the header
  it('sends no code without the CSRF header, before even reading the number', async () => {
    for (const body of ['phone=55123456', 'phone=abc']) {
      const res = await t.http().post('/api/shop/otp').type('form').send(body);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CSRF');
    }
    expect(await t.prisma.customerOtp.count()).toBe(0);
  });

  it('signs no one in without the CSRF header, even with the right code', async () => {
    const code = await sendAndRead('55123456');
    const res = await t.http().post('/api/shop/otp/verify').type('form').send(`phone=55123456&code=${code}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF');
    expect(customerCookieOf(res)).toBe('');
    expect(await t.prisma.customerOtp.findFirstOrThrow()).toMatchObject({ attempts: 0, consumedAt: null });
    expect(await t.prisma.customer.count()).toBe(0);
    // the code still works from the website
    expect((await verify('55123456', code)).status).toBe(200);
  });

  it('accepts the number as people type it: Arabic digits, spaces, a country code', async () => {
    // three spellings: the fourth code within 15 minutes would be refused (OTP_PER_PHONE_PER_15_MIN)
    for (const phone of ['٥٥١٢٣٤٥٦', '+974 5512 3456', '00974-55123456']) {
      expect((await send(phone)).status).toBe(200);
    }
    const rows = await t.prisma.customerOtp.findMany();
    expect(new Set(rows.map((r) => r.phone))).toEqual(new Set([CUSTOMER_PHONE]));
  });

  it('five wrong guesses burn the code: the right one is refused afterwards', async () => {
    const code = await sendAndRead('55123456');
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      const res = await verify('55123456', wrong);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('OTP_INVALID');
    }
    const late = await verify('55123456', code);
    expect(late.status).toBe(401);
    expect(late.body.code).toBe('OTP_INVALID');
    expect(await t.prisma.customer.count()).toBe(0);
    expect((await t.prisma.customerOtp.findFirstOrThrow()).attempts).toBe(OTP_MAX_ATTEMPTS);
  });

  it('a burst of wrong guesses cannot try more than the limit', async () => {
    const code = await sendAndRead('55123456');
    const wrong = code === '000000' ? '111111' : '000000';
    // One listening server for the whole burst: t.http() makes supertest listen and close per
    // request, and the first answer would close the server under the requests still being sent.
    const server = (t.app.getHttpServer() as Server).listen(0);
    try {
      const burst = await Promise.all(
        Array.from({ length: 20 }, () => request(server).post('/api/shop/otp/verify').set(csrf).send({ phone: '55123456', code: wrong })),
      );
      expect(burst.map((r) => r.status)).toEqual(Array.from({ length: 20 }, () => 401));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    expect((await t.prisma.customerOtp.findFirstOrThrow()).attempts).toBeLessThanOrEqual(OTP_MAX_ATTEMPTS);
    expect((await verify('55123456', code)).status).toBe(401);
  });

  it('the right code signs the customer in with a strict, httpOnly cookie scoped to /api/shop', async () => {
    const code = await sendAndRead('55123456');
    const res = await verify('٥٥١٢٣٤٥٦', code); // typed on an Arabic keyboard
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ customer: { phone: CUSTOMER_PHONE, name: null, email: null }, expiresAt: expect.any(String) });
    expect(new Date(res.body.expiresAt as string).getTime() - Date.now()).toBeGreaterThan(29 * 86_400_000);

    const cookies = res.headers['set-cookie'] as unknown as string[];
    const raw = cookies.find((c) => c.startsWith('wc_cst='))!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Strict/i);
    expect(raw).toMatch(/Path=\/api\/shop/);
    // the readable hint tells the website a session exists, nothing more
    const hint = cookies.find((c) => c.startsWith('wc_customer='))!;
    expect(hint).not.toMatch(/HttpOnly/i);
    expect(hint).toMatch(/Path=\//);
    expect(hint).toMatch(/SameSite=Lax/i);

    const customer = await t.prisma.customer.findUniqueOrThrow({ where: { phone: CUSTOMER_PHONE } });
    expect(customer.lastLoginAt).not.toBeNull();
    expect((await t.prisma.customerOtp.findFirstOrThrow()).consumedAt).not.toBeNull();

    const profile = await me(customerCookieOf(res));
    expect(profile.status).toBe(200);
    expect(profile.body).toEqual({ phone: CUSTOMER_PHONE, name: null, email: null });
  });

  it('a consumed code cannot be used twice', async () => {
    const code = await sendAndRead('55123456');
    expect((await verify('55123456', code)).status).toBe(200);
    const again = await verify('55123456', code);
    expect(again.status).toBe(401);
    expect(again.body.code).toBe('OTP_INVALID');
  });

  it('nothing opens without the cookie, and the cookie opens nothing but /api/shop', async () => {
    const cookie = await signInCustomer(t, '55123456');
    const anon = await me('');
    expect(anon.status).toBe(401);
    expect(anon.body.code).toBe('SESSION_EXPIRED');
    expect((await me('wc_cst=not-a-token')).status).toBe(401);
    // the customer token is not a staff token
    const token = cookie.replace('wc_cst=', '');
    expect((await t.http().get('/api/orders').set('Authorization', `Bearer ${token}`)).status).toBe(401);
    expect((await t.http().get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });

  it('a POST without the CSRF header is refused', async () => {
    const cookie = await signInCustomer(t, '55123456');
    const res = await t.http().post('/api/shop/logout').set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF');
    expect((await me(cookie)).status).toBe(200);
  });

  it('logout clears the cookie on this device only', async () => {
    const here = await signInCustomer(t, '55123456');
    const phone = await signInCustomer(t, '55123456');
    const res = await t.http().post('/api/shop/logout').set('Cookie', here).set(csrf);
    expect(res.status).toBe(204);
    const cleared = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('wc_cst='))!;
    expect(cleared).toMatch(/wc_cst=;|Max-Age=0|Expires=Thu, 01 Jan 1970/);
    const hintCleared = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('wc_customer='))!;
    expect(hintCleared).toMatch(/wc_customer=;|Max-Age=0|Expires=Thu, 01 Jan 1970/);
    // the cookie string itself is still a valid token until the version changes; the other device is untouched
    expect((await me(phone)).status).toBe(200);
  });

  it('logout-all signs every device out', async () => {
    const here = await signInCustomer(t, '55123456');
    const phone = await signInCustomer(t, '55123456');
    expect((await me(phone)).status).toBe(200);

    const res = await t.http().post('/api/shop/logout-all').set('Cookie', here).set(csrf);
    expect(res.status).toBe(204);
    const cleared = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('wc_cst='))!;
    expect(cleared).toMatch(/wc_cst=;|Max-Age=0|Expires=Thu, 01 Jan 1970/);
    const hintCleared = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('wc_customer='))!;
    expect(hintCleared).toMatch(/wc_customer=;|Max-Age=0|Expires=Thu, 01 Jan 1970/);
    for (const cookie of [here, phone]) {
      const after = await me(cookie);
      expect(after.status).toBe(401);
      expect(after.body.code).toBe('SESSION_EXPIRED');
    }
    expect((await t.prisma.customer.findUniqueOrThrow({ where: { phone: CUSTOMER_PHONE } })).sessionVersion).toBe(2);
    // signing in again works and yields a cookie of the new version
    expect((await me(await signInCustomer(t, '55123456'))).status).toBe(200);
  });

  it('a fourth code within fifteen minutes is refused with a wait', async () => {
    for (let i = 0; i < OTP_PER_PHONE_PER_15_MIN; i++) expect((await send('55123456')).status).toBe(200);
    const res = await send('55123456');
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('OTP_TOO_MANY');
    expect(res.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(res.body.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
    // another number is not affected
    expect((await send('66123456')).status).toBe(200);
  });

  it('names the phone in the activity log and never the code', async () => {
    const code = await sendAndRead('55123456');
    const wrong = code === '000000' ? '111111' : '000000';
    await verify('55123456', wrong);
    await verify('55123456', code);

    const log = await t.prisma.activityLog.findMany({ orderBy: { id: 'asc' } });
    const text = JSON.stringify(log, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
    expect(text).not.toContain(code);
    expect(text).not.toContain(wrong);

    expect(log.find((l) => l.action === 'shop.otp.send')).toMatchObject({ outcome: 'SUCCESS', actorId: null, entityType: 'Customer' });
    const verifies = log.filter((l) => l.action === 'shop.otp.verify');
    expect(verifies.map((l) => l.outcome)).toEqual(['FAILURE', 'SUCCESS']);
    expect(verifies[0]).toMatchObject({ actorUsername: CUSTOMER_PHONE, actorId: null, actorRole: null });
    const customer = await t.prisma.customer.findUniqueOrThrow({ where: { phone: CUSTOMER_PHONE } });
    expect(verifies[1]).toMatchObject({ entityType: 'Customer', entityId: customer.id, actorId: null });
  });
});
