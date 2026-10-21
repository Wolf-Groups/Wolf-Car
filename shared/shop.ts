/**
 * Rules of the website's online checkout, shared by the API and the web app
 * so both accept and reject the same input. Keep this file free of imports:
 * it is compiled into both projects.
 */

/** Qatar's country code, without the "+". */
export const QATAR_COUNTRY_CODE = '974';

/**
 * "+97455123456" for anything a person may type for a Qatari mobile:
 * "55123456", "+974 5512 3456", "00974-55123456", "٥٥١٢٣٤٥٦" (Arabic digits),
 * with spaces, dashes or parentheses. Null for anything else, including
 * landlines (4…) and foreign numbers. Phase 1 serves Qatar only.
 */
export function normaliseQatarPhone(input: string): string | null {
  // Same fold as normaliseDigits in validation.ts, copied so this file stays import-free.
  const folded = input.replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) & 0xf));
  if (!/^\s*\+?[\d\s()-]+$/.test(folded)) return null;
  const digits = folded.replace(/\D/g, '').replace(/^(00974|974)/, '');
  return /^[3567]\d{7}$/.test(digits) ? `+${QATAR_COUNTRY_CODE}${digits}` : null;
}

/** "+97455123456" → "55123456" (what Tap wants next to country_code 974). */
export function localQatarNumber(e164: string): string {
  return e164.replace(/^\+?974/, '');
}

export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 300;
/** Wrong guesses one code survives. */
export const OTP_MAX_ATTEMPTS = 5;
/** How long the "Resend" button waits. */
export const OTP_RESEND_SECONDS = 60;
export const OTP_CODE_PATTERN = /^\d{6}$/;

export const CUSTOMER_EMAIL_MAX = 254;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const ORDER_SOURCES = ['SHOWROOM', 'WEB'] as const;
export type OrderSourceName = (typeof ORDER_SOURCES)[number];

export const PAYMENT_STATUSES = ['NONE', 'PENDING', 'PAID', 'REFUNDED'] as const;
export type PaymentStatusName = (typeof PAYMENT_STATUSES)[number];

/** The return page asks the API this often, for this long, while a payment is still pending. */
export const CHECKOUT_POLL_MS = 3000;
export const CHECKOUT_POLL_MAX_MS = 30000;

/** Tokens the in-memory payment gateway (PAYMENTS_PROVIDER=fake) understands. */
export const FAKE_TOKENS = { ok: 'tok_fake_ok', declined: 'tok_fake_declined', pending: 'tok_fake_pending' } as const;
