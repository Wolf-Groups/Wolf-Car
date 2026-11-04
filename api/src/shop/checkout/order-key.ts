import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The key that opens one web order without a customer session: a guest's
 * checkout, the return page after 3-D Secure, the link in an order email.
 * Derived, not stored: base64url(HMAC-SHA256(secret, "order-link:" + id)),
 * first 32 characters. The secret is JWT_ACCESS_SECRET, so rotating it
 * retires every link.
 */
export function orderKey(orderId: string, secret: string): string {
  return createHmac('sha256', secret).update(`order-link:${orderId}`).digest('base64url').slice(0, 32);
}

export function validOrderKey(orderId: string, key: string | null | undefined, secret: string): boolean {
  if (!key) return false;
  const given = Buffer.from(key);
  const expected = Buffer.from(orderKey(orderId, secret));
  return given.length === expected.length && timingSafeEqual(given, expected);
}
