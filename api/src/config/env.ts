import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

const toBool = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()) : value;
const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

/** Every environment variable the API reads, validated once at startup. */
export class Env {
  @IsIn(['development', 'production', 'test'])
  NODE_ENV: 'development' | 'production' | 'test' = 'development';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 4000;

  @IsIn(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  LOG_LEVEL = 'info';

  /** Comma-separated allowlist of browser origins. */
  @IsString()
  @IsNotEmpty()
  CORS_ORIGINS: string;

  @IsString()
  TRUST_PROXY = 'loopback';

  @Transform(toBool)
  @IsBoolean()
  SWAGGER_ENABLED = false;

  @IsString()
  @Matches(/^postgres(ql)?:\/\//, { message: 'DATABASE_URL must be a postgres:// URL' })
  DATABASE_URL: string;

  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET: string;

  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(3600)
  JWT_ACCESS_TTL_SECONDS = 900;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  REFRESH_TTL_DAYS = 7;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  // 90 days: a fixed screen in the branch signs in once with its PIN; a new PIN signs it out
  @Max(2160)
  SHOWROOM_SESSION_TTL_HOURS = 2160;

  @Transform(toBool)
  @IsBoolean()
  COOKIE_SECURE = true;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  LOGIN_MAX_ATTEMPTS = 5;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  LOGIN_LOCK_MINUTES = 15;

  /** General per-IP request budget per minute (all routes). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  RATE_LIMIT_PER_MINUTE = 300;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  AUTH_THROTTLE_LIMIT = 10;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  AUTH_THROTTLE_TTL_SECONDS = 60;

  /** 32 random bytes, base64 — AES-256-GCM key for TOTP secrets at rest. */
  @IsString()
  @Matches(/^[A-Za-z0-9+/]{43}=$/, { message: 'TOTP_ENCRYPTION_KEY must be 32 bytes, base64-encoded' })
  TOTP_ENCRYPTION_KEY: string;

  @IsString()
  @IsNotEmpty()
  TOTP_ISSUER = 'Wolf Car';

  @IsString()
  @IsNotEmpty()
  UPLOAD_DIR = './storage/uploads';

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  CHROME_PATH?: string;

  /**
   * The company's Odoo, the source of the product catalogue. All four are
   * needed for the sync to run; without them the catalogue is edited by hand.
   */
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @Matches(/^https?:\/\//, { message: 'ODOO_URL must start with http:// or https://' })
  ODOO_URL?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  ODOO_DB?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  ODOO_LOGIN?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  ODOO_API_KEY?: string;

  /** How often the catalogue is brought up to date from Odoo. 0 turns the timer off. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1440)
  ODOO_SYNC_MINUTES = 15;

  /** Tap Payments secret key (sk_test_… or sk_live_…). Never logged. */
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  TAP_SECRET_KEY?: string;

  @IsString()
  @Matches(/^https?:\/\//, { message: 'TAP_API_URL must start with http:// or https://' })
  TAP_API_URL = 'https://api.tap.company/v2';

  /** "fake" is the in-memory gateway used by the tests. */
  @IsIn(['tap', 'fake'])
  PAYMENTS_PROVIDER: 'tap' | 'fake' = 'tap';

  /** The website's public origin: where Tap sends the customer back to. */
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @Matches(/^https?:\/\//, { message: 'WEB_PUBLIC_URL must start with http:// or https://' })
  WEB_PUBLIC_URL?: string;

  /** The API's public origin: where Tap posts its webhook. */
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @Matches(/^https?:\/\//, { message: 'API_PUBLIC_URL must start with http:// or https://' })
  API_PUBLIC_URL?: string;

  /** Code of the branch that holds website orders for pickup. */
  @IsString()
  @IsNotEmpty()
  WEB_ORDERS_BRANCH_CODE = 'BO';

  /** Minutes an unpaid website order is held before it expires. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  CHECKOUT_TTL_MINUTES = 30;

  @IsIn(['console'])
  SMS_PROVIDER = 'console' as const;

  /** Returns the one-time code in the API response. Development only. */
  @Transform(toBool)
  @IsBoolean()
  OTP_DEV_CODE_IN_RESPONSE = false;

  /**
   * Lets a production-mode API run the test checkout (the fake gateway, echoed
   * sign-in codes). Only the browser tests set it; never next to a live Tap key.
   */
  @Transform(toBool)
  @IsBoolean()
  ALLOW_TEST_CHECKOUT = false;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  OTP_PER_PHONE_PER_15_MIN = 3;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  CUSTOMER_SESSION_TTL_DAYS = 30;

  /** Odoo user that writes paid website orders. Separate from the read-only catalogue user. */
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  ODOO_WRITE_LOGIN?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  ODOO_WRITE_API_KEY?: string;

  @Transform(({ value }) => (typeof value === 'string' ? (value.trim() === '' ? undefined : Number(value)) : value))
  @IsOptional()
  @IsInt()
  @Min(1)
  ODOO_WEB_WAREHOUSE_ID?: number;

  @Transform(({ value }) => (typeof value === 'string' ? (value.trim() === '' ? undefined : Number(value)) : value))
  @IsOptional()
  @IsInt()
  @Min(1)
  ODOO_FALLBACK_PRODUCT_ID?: number;
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const env = plainToInstance(Env, raw, { exposeDefaultValues: true });
  const errors = validateSync(env, { whitelist: false });
  if (errors.length > 0) {
    const details = errors
      .map((e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join('; ')}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  const testCheckout = testCheckoutErrors(env);
  if (testCheckout.length > 0) {
    throw new Error(`Invalid environment configuration:\n${testCheckout.map((e) => `  - ${e}`).join('\n')}`);
  }
  return env;
}

/**
 * The test checkout (the fake gateway, whose webhook trusts the public secret
 * `fake-secret`, and sign-in codes echoed to the page) must never take real
 * customers: refused next to a live Tap key always, and in production unless
 * ALLOW_TEST_CHECKOUT says this is the browser-test run.
 */
function testCheckoutErrors(env: Env): string[] {
  const errors: string[] = [];
  const liveKey = env.TAP_SECRET_KEY?.startsWith('sk_live_') ?? false;
  const productionWithoutPermit = env.NODE_ENV === 'production' && !env.ALLOW_TEST_CHECKOUT;
  if (env.PAYMENTS_PROVIDER === 'fake') {
    if (liveKey) errors.push('PAYMENTS_PROVIDER: must not be fake when TAP_SECRET_KEY is a live key');
    else if (productionWithoutPermit) errors.push('PAYMENTS_PROVIDER: must not be fake in production (ALLOW_TEST_CHECKOUT is for the browser tests only)');
  }
  if (env.OTP_DEV_CODE_IN_RESPONSE) {
    if (liveKey) errors.push('OTP_DEV_CODE_IN_RESPONSE: must be false when TAP_SECRET_KEY is a live key');
    else if (productionWithoutPermit) errors.push('OTP_DEV_CODE_IN_RESPONSE: must be false in production (ALLOW_TEST_CHECKOUT is for the browser tests only)');
  }
  return errors;
}

export function corsOrigins(env: Pick<Env, 'CORS_ORIGINS'>): string[] {
  return env.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}
