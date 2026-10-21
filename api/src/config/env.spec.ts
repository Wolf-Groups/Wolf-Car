import { corsOrigins, validateEnv } from './env';

const base = {
  CORS_ORIGINS: 'http://localhost:3000, https://wolfcar.qa',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'x'.repeat(40),
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

describe('validateEnv', () => {
  it('applies defaults and coerces types', () => {
    const env = validateEnv({ ...base, PORT: '4100', COOKIE_SECURE: 'false', CHROME_PATH: '' });
    expect(env.PORT).toBe(4100);
    expect(env.COOKIE_SECURE).toBe(false);
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(env.LOGIN_MAX_ATTEMPTS).toBe(5);
    expect(env.CHROME_PATH).toBeUndefined();
  });

  it.each([
    ['short JWT secret', { JWT_ACCESS_SECRET: 'short' }, 'JWT_ACCESS_SECRET'],
    ['bad TOTP key', { TOTP_ENCRYPTION_KEY: 'abc' }, 'TOTP_ENCRYPTION_KEY'],
    ['non-postgres url', { DATABASE_URL: 'mysql://x' }, 'DATABASE_URL'],
    ['token TTL too long', { JWT_ACCESS_TTL_SECONDS: '86400' }, 'JWT_ACCESS_TTL_SECONDS'],
  ])('rejects %s', (_label, patch, field) => {
    expect(() => validateEnv({ ...base, ...patch })).toThrow(field);
  });

  it('requires the CORS allowlist', () => {
    const { CORS_ORIGINS: _omit, ...rest } = base;
    expect(() => validateEnv(rest)).toThrow('CORS_ORIGINS');
  });

  it('splits the CORS allowlist', () => {
    expect(corsOrigins({ CORS_ORIGINS: base.CORS_ORIGINS })).toEqual(['http://localhost:3000', 'https://wolfcar.qa']);
  });

  describe('online checkout (Task 1 of the online-checkout plan adds these to Env)', () => {
    interface Phase1Env {
      TAP_API_URL: string;
      PAYMENTS_PROVIDER: string;
      WEB_ORDERS_BRANCH_CODE: string;
      CHECKOUT_TTL_MINUTES: number;
      SMS_PROVIDER: string;
      OTP_DEV_CODE_IN_RESPONSE: boolean;
      OTP_PER_PHONE_PER_15_MIN: number;
      CUSTOMER_SESSION_TTL_DAYS: number;
      ODOO_WEB_WAREHOUSE_ID?: number;
      ODOO_FALLBACK_PRODUCT_ID?: number;
      TAP_SECRET_KEY?: string;
      WEB_PUBLIC_URL?: string;
      API_PUBLIC_URL?: string;
      ODOO_WRITE_LOGIN?: string;
      ODOO_WRITE_API_KEY?: string;
    }
    const phase1 = (raw: Record<string, unknown>) => validateEnv(raw) as unknown as Phase1Env;

    it('applies the payment and sign-in defaults', () => {
      const env = phase1(base);
      expect(env.TAP_API_URL).toBe('https://api.tap.company/v2');
      expect(env.PAYMENTS_PROVIDER).toBe('tap');
      expect(env.WEB_ORDERS_BRANCH_CODE).toBe('BO');
      expect(env.CHECKOUT_TTL_MINUTES).toBe(30);
      expect(env.SMS_PROVIDER).toBe('console');
      expect(env.OTP_DEV_CODE_IN_RESPONSE).toBe(false);
      expect(env.OTP_PER_PHONE_PER_15_MIN).toBe(3);
      expect(env.CUSTOMER_SESSION_TTL_DAYS).toBe(30);
      expect(env.TAP_SECRET_KEY).toBeUndefined();
    });

    it('knows only the tap and fake providers', () => {
      expect(() => validateEnv({ ...base, PAYMENTS_PROVIDER: 'stripe' })).toThrow('PAYMENTS_PROVIDER');
      expect(phase1({ ...base, PAYMENTS_PROVIDER: 'fake' }).PAYMENTS_PROVIDER).toBe('fake');
    });

    it('refuses to echo sign-in codes next to a live Tap key', () => {
      expect(() => validateEnv({ ...base, OTP_DEV_CODE_IN_RESPONSE: 'true', TAP_SECRET_KEY: 'sk_live_x' })).toThrow('OTP_DEV_CODE_IN_RESPONSE');
      expect(phase1({ ...base, OTP_DEV_CODE_IN_RESPONSE: 'true', TAP_SECRET_KEY: 'sk_test_x' }).OTP_DEV_CODE_IN_RESPONSE).toBe(true);
    });

    describe('test checkout never runs in production', () => {
      const prod = { ...base, NODE_ENV: 'production' };

      it('refuses the fake gateway in production', () => {
        expect(() => validateEnv({ ...prod, PAYMENTS_PROVIDER: 'fake' })).toThrow('PAYMENTS_PROVIDER');
      });

      it('refuses echoed sign-in codes in production', () => {
        expect(() => validateEnv({ ...prod, OTP_DEV_CODE_IN_RESPONSE: 'true' })).toThrow('OTP_DEV_CODE_IN_RESPONSE');
      });

      it('allows both in production when ALLOW_TEST_CHECKOUT is set (the browser tests)', () => {
        const env = validateEnv({ ...prod, PAYMENTS_PROVIDER: 'fake', OTP_DEV_CODE_IN_RESPONSE: 'true', TAP_SECRET_KEY: 'fake-secret', ALLOW_TEST_CHECKOUT: 'true' });
        expect(env.PAYMENTS_PROVIDER).toBe('fake');
        expect(env.OTP_DEV_CODE_IN_RESPONSE).toBe(true);
        expect(env.ALLOW_TEST_CHECKOUT).toBe(true);
      });

      it('defaults ALLOW_TEST_CHECKOUT to false and reads "false" as false', () => {
        expect(validateEnv(base).ALLOW_TEST_CHECKOUT).toBe(false);
        expect(() => validateEnv({ ...prod, PAYMENTS_PROVIDER: 'fake', ALLOW_TEST_CHECKOUT: 'false' })).toThrow('PAYMENTS_PROVIDER');
      });

      it('allows the real gateway in production', () => {
        expect(validateEnv({ ...prod, PAYMENTS_PROVIDER: 'tap', TAP_SECRET_KEY: 'sk_live_x' }).PAYMENTS_PROVIDER).toBe('tap');
      });

      it('allows the fake gateway and echoed codes outside production', () => {
        expect(validateEnv({ ...base, NODE_ENV: 'test', PAYMENTS_PROVIDER: 'fake', OTP_DEV_CODE_IN_RESPONSE: 'true' }).PAYMENTS_PROVIDER).toBe('fake');
        expect(validateEnv({ ...base, NODE_ENV: 'development', PAYMENTS_PROVIDER: 'fake', OTP_DEV_CODE_IN_RESPONSE: 'true' }).OTP_DEV_CODE_IN_RESPONSE).toBe(true);
      });

      it.each([
        ['in development', { NODE_ENV: 'development' }],
        ['in production with ALLOW_TEST_CHECKOUT', { NODE_ENV: 'production', ALLOW_TEST_CHECKOUT: 'true' }],
      ])('always refuses the fake gateway next to a live Tap key (%s)', (_label, patch) => {
        expect(() => validateEnv({ ...base, ...patch, PAYMENTS_PROVIDER: 'fake', TAP_SECRET_KEY: 'sk_live_x' })).toThrow('PAYMENTS_PROVIDER');
      });

      it('always refuses echoed codes next to a live Tap key, even with ALLOW_TEST_CHECKOUT', () => {
        expect(() =>
          validateEnv({ ...prod, ALLOW_TEST_CHECKOUT: 'true', OTP_DEV_CODE_IN_RESPONSE: 'true', TAP_SECRET_KEY: 'sk_live_x' }),
        ).toThrow('OTP_DEV_CODE_IN_RESPONSE');
      });
    });

    it('reads OTP_DEV_CODE_IN_RESPONSE=false as false', () => {
      expect(phase1({ ...base, OTP_DEV_CODE_IN_RESPONSE: 'false' }).OTP_DEV_CODE_IN_RESPONSE).toBe(false);
      expect(() => validateEnv({ ...base, OTP_DEV_CODE_IN_RESPONSE: 'false', TAP_SECRET_KEY: 'sk_live_x' })).not.toThrow();
    });

    it.each([
      ['an unknown SMS provider', { SMS_PROVIDER: 'twilio' }, 'SMS_PROVIDER'],
      ['a checkout TTL of zero', { CHECKOUT_TTL_MINUTES: '0' }, 'CHECKOUT_TTL_MINUTES'],
      ['a checkout TTL over a day', { CHECKOUT_TTL_MINUTES: '1441' }, 'CHECKOUT_TTL_MINUTES'],
      ['a website address without a scheme', { WEB_PUBLIC_URL: 'wolfcar.qa' }, 'WEB_PUBLIC_URL'],
      ['an API address without a scheme', { API_PUBLIC_URL: 'api.wolfcar.qa' }, 'API_PUBLIC_URL'],
      ['an Odoo warehouse id of zero', { ODOO_WEB_WAREHOUSE_ID: '0' }, 'ODOO_WEB_WAREHOUSE_ID'],
    ])('rejects %s', (_label, patch, field) => {
      expect(() => validateEnv({ ...base, ...patch })).toThrow(field);
    });

    it('treats empty payment settings as unset and reads the checkout TTL as a number', () => {
      const env = phase1({ ...base, TAP_SECRET_KEY: '', WEB_PUBLIC_URL: '', API_PUBLIC_URL: '', CHECKOUT_TTL_MINUTES: '45' });
      expect(env.TAP_SECRET_KEY).toBeUndefined();
      expect(env).toMatchObject({ WEB_PUBLIC_URL: undefined, API_PUBLIC_URL: undefined, CHECKOUT_TTL_MINUTES: 45 });
      expect(phase1({ ...base, WEB_PUBLIC_URL: 'https://wolfcar.qa', API_PUBLIC_URL: 'http://localhost:3000' })).toMatchObject({
        WEB_PUBLIC_URL: 'https://wolfcar.qa',
        API_PUBLIC_URL: 'http://localhost:3000',
      });
    });

    it('reads the optional Odoo ids as integers, empty meaning unset', () => {
      expect(phase1({ ...base, ODOO_WEB_WAREHOUSE_ID: '', ODOO_FALLBACK_PRODUCT_ID: '' })).toMatchObject({ ODOO_WEB_WAREHOUSE_ID: undefined, ODOO_FALLBACK_PRODUCT_ID: undefined });
      expect(phase1({ ...base, ODOO_WEB_WAREHOUSE_ID: '3', ODOO_FALLBACK_PRODUCT_ID: '99' })).toMatchObject({ ODOO_WEB_WAREHOUSE_ID: 3, ODOO_FALLBACK_PRODUCT_ID: 99 });
    });

    it('treats empty Odoo write credentials as unset', () => {
      const env = phase1({ ...base, ODOO_WRITE_LOGIN: '', ODOO_WRITE_API_KEY: '' });
      expect(env.ODOO_WRITE_LOGIN).toBeUndefined();
      expect(env.ODOO_WRITE_API_KEY).toBeUndefined();
      expect(phase1({ ...base, ODOO_WRITE_LOGIN: 'sales@wolfcar.qa', ODOO_WRITE_API_KEY: 'write-key' })).toMatchObject({
        ODOO_WRITE_LOGIN: 'sales@wolfcar.qa',
        ODOO_WRITE_API_KEY: 'write-key',
      });
    });
  });
});
