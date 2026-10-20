/**
 * What Tap sends and answers for one charge (the fields this app reads; the
 * object carries many more and is stored whole on Payment.rawLast).
 */
export interface TapCharge {
  id: string;
  object?: string;
  status: string;
  amount: number;
  currency: string;
  live_mode?: boolean;
  reference?: { gateway?: string; payment?: string; order?: string; idempotent?: string; transaction?: string };
  transaction?: { created?: string | number; url?: string };
  response?: { code?: string; message?: string };
  metadata?: Record<string, string>;
  [k: string]: unknown;
}

export type ChargeOutcome = 'captured' | 'failed' | 'pending';

/** Tap's final statuses that mean "not paid". */
export const FAILED_STATUSES = ['DECLINED', 'FAILED', 'CANCELLED', 'ABANDONED', 'RESTRICTED', 'TIMEDOUT', 'VOID', 'UNKNOWN'] as const;

/** CAPTURED → captured; the FAILED_STATUSES → failed; anything else (INITIATED, AUTHORIZED, …) → pending. Case-insensitive. */
export function chargeOutcome(status: string): ChargeOutcome {
  const s = status.toUpperCase();
  if (s === 'CAPTURED') return 'captured';
  return (FAILED_STATUSES as readonly string[]).includes(s) ? 'failed' : 'pending';
}

const THREE_DECIMAL_CURRENCIES = new Set(['KWD', 'BHD', 'OMR']);

/** "1" → "1.00" for QAR (two decimals); three decimals for KWD, BHD, OMR. */
export function formatTapAmount(amount: number | string, currency = 'QAR'): string {
  const decimals = THREE_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 3 : 2;
  return Number(amount).toFixed(decimals);
}

/** True when formatTapAmount(chargeAmount) (QAR, two decimals) equals the order's "1234.50". */
export function sameAmount(chargeAmount: number, orderTotal: string): boolean {
  return formatTapAmount(chargeAmount) === orderTotal;
}
