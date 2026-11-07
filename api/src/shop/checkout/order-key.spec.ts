import { createHmac } from 'node:crypto';
import { orderKey, validOrderKey } from './order-key';

const SECRET = 'x'.repeat(40);
const ID = '0b6f3c2e-7a51-4d7e-9a0b-2d9f2c1e8f00';

describe('orderKey', () => {
  it('is the first 32 base64url characters of HMAC-SHA256(secret, "order-link:" + id)', () => {
    const expected = createHmac('sha256', SECRET).update(`order-link:${ID}`).digest('base64url').slice(0, 32);
    expect(orderKey(ID, SECRET)).toBe(expected);
    expect(orderKey(ID, SECRET)).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('differs per order and per secret', () => {
    expect(orderKey(ID, SECRET)).not.toBe(orderKey('another-order', SECRET));
    expect(orderKey(ID, SECRET)).not.toBe(orderKey(ID, 'y'.repeat(40)));
  });
});

describe('validOrderKey', () => {
  it("accepts the order's own key only", () => {
    expect(validOrderKey(ID, orderKey(ID, SECRET), SECRET)).toBe(true);
    expect(validOrderKey(ID, orderKey('another-order', SECRET), SECRET)).toBe(false);
  });

  it('refuses a missing, empty or differently sized key without throwing', () => {
    for (const key of [undefined, null, '', 'short', orderKey(ID, SECRET) + 'x', 'é'.repeat(32)]) {
      expect(validOrderKey(ID, key, SECRET)).toBe(false);
    }
  });
});
