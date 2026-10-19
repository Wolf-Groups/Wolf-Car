import { FAKE_TOKENS } from '../../../../shared/shop';
import { FakePaymentGateway } from './fake-gateway';
import { type CreateChargeInput, PaymentGatewayError } from './payment-gateway';

const input = (tokenId: string): CreateChargeInput => ({
  amount: '619.50',
  currency: 'QAR',
  tokenId,
  customer: { name: 'Sara Al Thani', email: 'sara@example.qa', phone: '+97455123456' },
  redirectUrl: 'https://wolfcar.qa/ar/checkout/return?order=o-1',
  postUrl: 'https://wolfcar.qa/api/shop/payments/tap/webhook',
  orderId: 'o-1',
  orderCode: 'BO-000001',
  paymentId: 'pay-1',
  description: 'Wolf Car order BO-000001',
  locale: 'ar',
});

describe('FakePaymentGateway', () => {
  let gateway: FakePaymentGateway;
  beforeEach(() => {
    gateway = new FakePaymentGateway();
  });

  it('refuses a token it does not know', async () => {
    const err = await gateway.createCharge(input('tok_real_card')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaymentGatewayError);
    expect(err).toMatchObject({ code: 'INVALID_TOKEN', status: 400 });
  });

  it('creates an INITIATED charge that sends the browser straight to the return page', async () => {
    const charge = await gateway.createCharge(input(FAKE_TOKENS.ok));
    expect(charge.id).toMatch(/^chg_fake_/);
    expect(charge).toMatchObject({
      status: 'INITIATED',
      amount: 619.5,
      currency: 'QAR',
      reference: { order: 'BO-000001', idempotent: 'pay-1' },
      metadata: { orderId: 'o-1', paymentId: 'pay-1' },
    });
    expect(charge.transaction?.url).toBe('https://wolfcar.qa/ar/checkout/return?order=o-1');
  });

  it('captures tok_fake_ok on the first read', async () => {
    const { id } = await gateway.createCharge(input(FAKE_TOKENS.ok));
    const read = await gateway.getCharge(id);
    expect(read.status).toBe('CAPTURED');
    expect(read.id).toBe(id);
    expect(read.reference?.payment).toBe('fakepay1');
  });

  it('declines tok_fake_declined', async () => {
    const { id } = await gateway.createCharge(input(FAKE_TOKENS.declined));
    expect((await gateway.getCharge(id)).status).toBe('DECLINED');
  });

  it('leaves tok_fake_pending INITIATED', async () => {
    const { id } = await gateway.createCharge(input(FAKE_TOKENS.pending));
    expect((await gateway.getCharge(id)).status).toBe('INITIATED');
    expect((await gateway.getCharge(id)).status).toBe('INITIATED');
  });

  it('does not know charges it never created', async () => {
    const err = await gateway.getCharge('chg_nope').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaymentGatewayError);
    expect(err).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('refunds only a captured charge', async () => {
    const { id } = await gateway.createCharge(input(FAKE_TOKENS.pending));
    const refund = { chargeId: id, amount: '619.50', currency: 'QAR' as const, reason: 'Cancelled by admin' };
    await expect(gateway.refund(refund)).rejects.toMatchObject({ code: 'NOT_CAPTURED' });

    gateway.settle(id, 'CAPTURED');
    const result = await gateway.refund(refund);
    expect(result.status).toBe('REFUNDED');
    expect(result.id).toMatch(/^rf_fake_/);
    expect((await gateway.getCharge(id)).status).toBe('REFUNDED');
  });

  it('a refunded or forced tok_fake_ok charge is not captured again on read', async () => {
    const { id } = await gateway.createCharge(input(FAKE_TOKENS.ok));
    expect((await gateway.getCharge(id)).status).toBe('CAPTURED');
    await gateway.refund({ chargeId: id, amount: '619.50', currency: 'QAR', reason: 'r' });
    expect((await gateway.getCharge(id)).status).toBe('REFUNDED');

    const forced = await gateway.createCharge(input(FAKE_TOKENS.ok));
    gateway.settle(forced.id, 'DECLINED');
    expect((await gateway.getCharge(forced.id)).status).toBe('DECLINED');
  });

  it('refuses to refund a charge it never created with a gateway error', async () => {
    const err = await gateway.refund({ chargeId: 'chg_nope', amount: '1.00', currency: 'QAR', reason: 'r' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaymentGatewayError);
  });

  it('lets a test force any status', async () => {
    const { id } = await gateway.createCharge(input(FAKE_TOKENS.pending));
    expect(gateway.settle(id, 'CAPTURED')).toMatchObject({ id, status: 'CAPTURED' });
    expect((await gateway.getCharge(id)).status).toBe('CAPTURED');
    expect(gateway.settle(id, 'DECLINED').status).toBe('DECLINED');
  });
});
