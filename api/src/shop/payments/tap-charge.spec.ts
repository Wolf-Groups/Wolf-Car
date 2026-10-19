import { chargeOutcome, FAILED_STATUSES, formatTapAmount, sameAmount } from './tap-charge';

describe('chargeOutcome', () => {
  it('reads CAPTURED as paid', () => {
    expect(chargeOutcome('CAPTURED')).toBe('captured');
  });

  it.each(FAILED_STATUSES)('reads %s as failed', (status) => {
    expect(chargeOutcome(status)).toBe('failed');
  });

  it.each(['INITIATED', 'AUTHORIZED', 'IN_PROGRESS', 'weird'])('reads %s as pending', (status) => {
    expect(chargeOutcome(status)).toBe('pending');
  });

  it('ignores case', () => {
    expect(chargeOutcome('captured')).toBe('captured');
    expect(chargeOutcome('declined')).toBe('failed');
  });
});

describe('formatTapAmount', () => {
  it('writes two decimals for QAR', () => {
    expect(formatTapAmount(1)).toBe('1.00');
    expect(formatTapAmount('120.5')).toBe('120.50');
    expect(formatTapAmount(619.5)).toBe('619.50');
    expect(formatTapAmount(1, 'SAR')).toBe('1.00');
    expect(formatTapAmount('2.5', 'AED')).toBe('2.50');
  });

  it('writes three decimals for KWD, BHD and OMR', () => {
    expect(formatTapAmount(1, 'KWD')).toBe('1.000');
    expect(formatTapAmount('2.5', 'BHD')).toBe('2.500');
    expect(formatTapAmount(0.125, 'OMR')).toBe('0.125');
  });
});

describe('sameAmount', () => {
  it('compares the formatted charge amount with the order total', () => {
    expect(sameAmount(619.5, '619.50')).toBe(true);
    expect(sameAmount(100, '120.50')).toBe(false);
  });
});
