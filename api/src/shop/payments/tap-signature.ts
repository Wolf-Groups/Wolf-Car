import { todo } from '../todo';
import type { TapCharge } from './tap-charge';

/**
 * Tap signs every webhook with HMAC-SHA256 over a string built from the charge
 * (not over the raw body), keyed with the merchant's secret key, and sends the
 * hex digest in the `hashstring` header.
 */

/** "x_id…x_amount…x_currency…x_gateway_reference…x_payment_reference…x_status…x_created…", missing references as empty strings. */
export function tapHashString(charge: TapCharge): string {
  return todo('tapHashString', charge);
}

/** Hex HMAC-SHA256 of tapHashString(charge) with the secret key. */
export function signTapCharge(charge: TapCharge, secret: string): string {
  return todo('signTapCharge', charge, secret);
}

/** Constant-time comparison; false for a missing or malformed header. */
export function verifyTapSignature(charge: TapCharge, header: string | string[] | undefined, secret: string): boolean {
  return todo('verifyTapSignature', charge, header, secret);
}
