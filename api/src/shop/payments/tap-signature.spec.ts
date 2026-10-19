import { createHmac } from 'node:crypto';
import type { TapCharge } from './tap-charge';
import { signTapCharge, tapHashString, verifyTapSignature } from './tap-signature';

/** The worked example from the design (developers.tap.company, webhook signing). */
const charge: TapCharge = {
  id: 'chg_TS05A4120230736x9K22710693',
  amount: 1,
  currency: 'SAR',
  status: 'CAPTURED',
  reference: { gateway: 'mada_pg70983e7a-a686-40ba-83e2-c5e9f4074fe5', payment: '4327230736106619650' },
  transaction: { created: '1698392202943' },
};
const expectedHashString =
  'x_idchg_TS05A4120230736x9K22710693' +
  'x_amount1.00' +
  'x_currencySAR' +
  'x_gateway_referencemada_pg70983e7a-a686-40ba-83e2-c5e9f4074fe5' +
  'x_payment_reference4327230736106619650' +
  'x_statusCAPTURED' +
  'x_created1698392202943';
const secret = 'sk_test_secret';
const digest = (c: TapCharge) => createHmac('sha256', secret).update(tapHashString(c)).digest('hex');

describe('tapHashString', () => {
  it("reproduces Tap's example byte for byte", () => {
    expect(tapHashString(charge)).toBe(expectedHashString);
  });

  it('writes missing references as empty strings', () => {
    const bare: TapCharge = { id: 'chg_1', amount: 619.5, currency: 'QAR', status: 'INITIATED', transaction: { created: '1' } };
    expect(tapHashString(bare)).toBe('x_idchg_1x_amount619.50x_currencyQARx_gateway_referencex_payment_referencex_statusINITIATEDx_created1');
  });

  it("formats the amount for the charge's own currency and accepts a numeric created time", () => {
    expect(tapHashString({ id: 'chg_2', amount: 1, currency: 'KWD', status: 'CAPTURED', transaction: { created: 1698392202943 } })).toBe(
      'x_idchg_2x_amount1.000x_currencyKWDx_gateway_referencex_payment_referencex_statusCAPTUREDx_created1698392202943',
    );
  });
});

describe('signTapCharge', () => {
  it('is the hex HMAC-SHA256 of the hash string with the secret key', () => {
    expect(signTapCharge(charge, secret)).toBe(createHmac('sha256', secret).update(expectedHashString).digest('hex'));
    expect(signTapCharge(charge, secret)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('verifyTapSignature', () => {
  it('accepts the right header, as a string or a one-element array', () => {
    expect(verifyTapSignature(charge, digest(charge), secret)).toBe(true);
    expect(verifyTapSignature(charge, [digest(charge)], secret)).toBe(true);
  });

  it('rejects a wrong, missing, malformed or differently sized header without throwing', () => {
    const wrong = digest(charge).replace(/^./, (c) => (c === 'a' ? 'b' : 'a'));
    expect(verifyTapSignature(charge, wrong, secret)).toBe(false);
    expect(verifyTapSignature(charge, undefined, secret)).toBe(false);
    expect(verifyTapSignature(charge, [wrong], secret)).toBe(false);
    expect(verifyTapSignature(charge, 'abc', secret)).toBe(false);
    expect(verifyTapSignature(charge, '', secret)).toBe(false);
    expect(verifyTapSignature(charge, digest(charge), 'another-secret')).toBe(false);
  });
});
