import { createHmac, timingSafeEqual } from 'node:crypto';
import { formatTapAmount, type TapCharge } from './tap-charge';

/**
 * Tap signs every webhook with HMAC-SHA256 over a string built from the charge
 * (not over the raw body), keyed with the merchant's secret key, and sends the
 * hex digest in the `hashstring` header.
 */

/** "x_id…x_amount…x_currency…x_gateway_reference…x_payment_reference…x_status…x_created…", missing references as empty strings. */
export function tapHashString(charge: TapCharge): string {
  return (
    `x_id${charge.id}` +
    `x_amount${formatTapAmount(charge.amount, charge.currency)}` +
    `x_currency${charge.currency}` +
    `x_gateway_reference${charge.reference?.gateway ?? ''}` +
    `x_payment_reference${charge.reference?.payment ?? ''}` +
    `x_status${charge.status}` +
    `x_created${charge.transaction?.created ?? ''}`
  );
}

/** Hex HMAC-SHA256 of tapHashString(charge) with the secret key. */
export function signTapCharge(charge: TapCharge, secret: string): string {
  return createHmac('sha256', secret).update(tapHashString(charge)).digest('hex');
}

/** Constant-time comparison; false for a missing or malformed header. */
export function verifyTapSignature(charge: TapCharge, header: string | string[] | undefined, secret: string): boolean {
  const received = Array.isArray(header) ? header[0] : header;
  if (!received) return false;
  const a = Buffer.from(received.toLowerCase());
  const b = Buffer.from(signTapCharge(charge, secret));
  return a.length === b.length && timingSafeEqual(a, b);
}
