import { randomUUID } from 'node:crypto';
import { createTestApp, type TestApp } from './utils/app';
import { bearer, csrf, login, showroomLogin } from './utils/auth';
import { PW, seedWorld } from './utils/fixtures';
import { appRoutes } from './utils/routes';

type Caller = 'anon' | 'admin' | 'finance' | 'manager' | 'cashier' | 'reservations' | 'kiosk';
const DASHBOARD: Caller[] = ['admin', 'finance', 'manager', 'cashier', 'reservations'];
const ALL: Caller[] = ['anon', ...DASHBOARD, 'kiosk'];

/**
 * Who may call each route. Everyone else must get 401 (no session) or 403
 * (wrong permission / wrong session type). Allowed callers must NOT get
 * 401/403 — they may get 400/404/409 because the matrix sends empty bodies
 * and random ids (so nothing is modified).
 *
 * Every route in the app must appear here: adding an endpoint without
 * deciding who may call it fails the "complete" test.
 */
const MATRIX: Record<string, Caller[] | { public: number }> = {
  'GET /api/health': { public: 200 },
  'POST /api/auth/login': ALL,
  'POST /api/auth/login/2fa': ALL,
  'POST /api/auth/refresh': { public: 401 }, // no refresh cookie
  'POST /api/auth/logout': { public: 204 },
  'GET /api/auth/me': DASHBOARD,
  'POST /api/auth/showroom/login': ALL,
  'GET /api/auth/showroom/branches': { public: 200 },
  'POST /api/auth/showroom/pin': ALL,
  'POST /api/auth/showroom/refresh': { public: 401 },
  'POST /api/auth/showroom/logout': { public: 204 },
  'GET /api/auth/showroom/me': ['kiosk'],

  'PATCH /api/account/password': DASHBOARD,
  'PATCH /api/account/showroom-password': ['admin', 'manager', 'cashier'],
  'GET /api/account/2fa': DASHBOARD,
  'POST /api/account/2fa/setup': DASHBOARD,
  'POST /api/account/2fa/enable': DASHBOARD,
  'POST /api/account/2fa/disable': DASHBOARD,
  'POST /api/account/2fa/recovery-codes': DASHBOARD,

  'GET /api/permissions': ['admin'],
  'GET /api/roles/permissions': ['admin'],
  'PUT /api/roles/:role/permissions': ['admin'],
  'GET /api/users/:id/permissions': ['admin'],
  'PUT /api/users/:id/permissions': ['admin'],

  'GET /api/users': ['admin'],
  'POST /api/users': ['admin'],
  'GET /api/users/:id': ['admin'],
  'PATCH /api/users/:id': ['admin'],
  'DELETE /api/users/:id': ['admin'],
  'POST /api/users/:id/reset-password': ['admin'],
  'POST /api/users/:id/reset-showroom-password': ['admin'],
  'POST /api/users/:id/reset-2fa': ['admin'],
  'POST /api/users/:id/unlock': ['admin'],

  'GET /api/branches': ['admin'],
  'POST /api/branches': ['admin'],
  'GET /api/branches/options': ['admin', 'finance', 'manager'],
  'GET /api/branches/:id': ['admin'],
  'PATCH /api/branches/:id': ['admin'],
  'PUT /api/branches/:id/showroom-pin': ['admin'],
  'POST /api/branches/:id/staff/:role/replace': ['admin'],

  'GET /api/uploads/:file': { public: 404 },
  'GET /api/products': ['admin', 'finance', 'manager'],
  'PUT /api/products/order': ['admin', 'manager'],
  'GET /api/products/:id': ['admin', 'finance', 'manager'],
  'GET /api/products/:id/price-history': ['admin', 'finance', 'manager'],
  'POST /api/products': ['admin', 'manager'],
  'PATCH /api/products/:id': ['admin', 'manager'],
  'PUT /api/products/:id/quick-service': ['admin', 'manager'],
  'PATCH /api/products/:id/price': ['admin', 'finance'],
  'GET /api/odoo/sync': ['admin', 'finance', 'manager'],
  'POST /api/odoo/sync': ['admin', 'finance'],
  'GET /api/services': ['admin', 'finance', 'manager'],
  'POST /api/services': ['admin', 'manager'],
  'PATCH /api/services/:id': ['admin', 'manager'],
  'PATCH /api/services/tiers/:id': ['admin', 'manager'],

  'GET /api/showroom/products': ['kiosk'],
  'POST /api/showroom/orders': ['kiosk'],

  'GET /api/orders': ['admin', 'finance', 'manager', 'cashier'],
  'GET /api/orders/:id': ['admin', 'finance', 'manager', 'cashier'],
  'PATCH /api/orders/:id': ['admin', 'cashier'],
  'POST /api/orders/:id/confirm': ['admin', 'cashier'],
  'POST /api/orders/:id/cancel': ['admin', 'cashier'],
  'GET /api/orders/:id/receipt': ['admin', 'cashier'],
  // POST /api/orders/:id/collect (Task 8) and POST /api/orders/:id/odoo/retry (Task 10) are added with their routes

  // the website's customers: no bearer token of any kind opens these, only the customer cookie
  'POST /api/shop/otp': ALL,
  'POST /api/shop/otp/verify': ALL,
  'GET /api/shop/me': { public: 401 },
  'POST /api/shop/logout': { public: 401 },
  'POST /api/shop/logout-all': { public: 401 },
  'POST /api/shop/orders': { public: 401 },
  'GET /api/shop/orders/:id': { public: 401 },
  'POST /api/shop/orders/:id/cancel': { public: 401 },
  'POST /api/shop/orders/:id/pay': { public: 401 },
  'POST /api/shop/orders/:id/reconcile': { public: 401 },
  'POST /api/shop/payments/tap/webhook': { public: 401 }, // empty body has no signature

  'GET /api/ppf/calendar': ['admin', 'reservations'],
  'GET /api/ppf/bookings': ['admin', 'reservations'],
  'POST /api/ppf/bookings': ['admin', 'reservations'],
  'PATCH /api/ppf/bookings/:id': ['admin', 'reservations'],
  'POST /api/ppf/bookings/:id/cancel': ['admin', 'reservations'],
  'PUT /api/ppf/closed-days/:date': ['admin', 'reservations'],
  'DELETE /api/ppf/closed-days/:date': ['admin', 'reservations'],
  'GET /api/ppf/requests': ['admin', 'reservations'],
  'POST /api/ppf/requests/:id/approve': ['admin', 'reservations'],
  'POST /api/ppf/requests/:id/reject': ['admin', 'reservations'],
  'GET /api/ppf/sales-access': ['admin', 'reservations'],
  'PUT /api/ppf/sales-access/pin': ['admin', 'reservations'],
  // the sales page: no bearer token of any kind opens these, only the PIN cookie
  'POST /api/slots/unlock': { public: 400 }, // empty body
  'GET /api/slots': { public: 401 },
  'POST /api/slots/requests': { public: 401 },

  'GET /api/reservations': ['admin', 'reservations'],
  'POST /api/reservations': ['admin', 'reservations'],
  'PATCH /api/reservations/:id': ['admin', 'reservations'],
  'POST /api/reservations/:id/cancel': ['admin', 'reservations'],

  'GET /api/public/categories': { public: 200 },
  'GET /api/public/products': { public: 200 },
  'GET /api/public/services': { public: 200 },
  'POST /api/public/events': { public: 400 }, // empty body

  'GET /api/activity': ['admin'],
  'GET /api/activity/actions': ['admin'],

  'GET /api/analytics/summary': ['admin'],
};

const fillPath = (path: string) =>
  path
    .replace(':role/permissions', 'CASHIER/permissions')
    .replace('staff/:role', 'staff/manager')
    .replace(':file', 'missing.webp')
    .replace(':date', '2031-01-05')
    .replace(/:id/g, randomUUID());

describe('RBAC matrix: every route × every caller', () => {
  let t: TestApp;
  const tokens: Partial<Record<Caller, string>> = {};

  beforeAll(async () => {
    t = await createTestApp();
    await seedWorld(t.prisma);
    tokens.admin = (await login(t, 'admin', PW.admin)).token;
    tokens.finance = (await login(t, 'finance', PW.finance)).token;
    tokens.manager = (await login(t, 'gh.manager', PW.manager)).token;
    tokens.cashier = (await login(t, 'gh.cashier', PW.cashier)).token;
    tokens.reservations = (await login(t, 'reservations', PW.reservations)).token;
    tokens.kiosk = (await showroomLogin(t, 'gh.manager', PW.showroom)).token;
  });
  afterAll(async () => {
    await t.close();
  });

  it('the matrix lists exactly the routes the app exposes', () => {
    const actual = appRoutes(t).map((r) => `${r.method} ${r.path}`).sort();
    expect(Object.keys(MATRIX).sort()).toEqual(actual);
  });

  const cases = Object.entries(MATRIX).flatMap(([route, rule]) => ALL.map((caller) => [route, caller, rule] as const));

  it.each(cases)('%s as %s', async (route, caller, rule) => {
    const [method, path] = route.split(' ');
    let req = t
      .http()
      [method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'](fillPath(path))
      .set(csrf);
    const token = tokens[caller];
    if (token) req = req.set(bearer(token));
    const res = method === 'GET' || method === 'DELETE' ? await req : await req.send({});

    if (!Array.isArray(rule)) {
      expect(res.status).toBe(rule.public);
    } else if (rule.includes(caller)) {
      expect([401, 403]).not.toContain(res.status);
      expect(res.status).toBeLessThan(500);
    } else {
      expect(res.status).toBe(caller === 'anon' ? 401 : 403);
    }
  });
});
