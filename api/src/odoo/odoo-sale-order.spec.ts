import { nextAttemptAt, OdooMappingError, OUTBOX_MAX_ATTEMPTS, type OutboxOrder, partnerDomain, partnerValues, saleOrderValues } from './odoo-sale-order';

const order: OutboxOrder = {
  id: 'o-1',
  code: 'BO-000001',
  customerName: 'Sara Al Thani',
  customerPhone: '+97455123456',
  customerEmail: 'sara@example.qa',
  total: '619.50',
  currency: 'QAR',
  chargeId: 'chg_1',
  paidAt: new Date('2026-10-18T10:05:00.000Z'),
  items: [
    { productName: 'Dash Cam', quantity: 1, unitPrice: '499.00', odooId: 11 },
    { productName: 'Floor Mats', quantity: 2, unitPrice: '120.50', odooId: null },
  ],
};

describe('partnerDomain', () => {
  it('matches the phone or mobile field, in E.164 or local form', () => {
    expect(partnerDomain('+97455123456')).toEqual([
      '|',
      '|',
      '|',
      ['phone', '=', '+97455123456'],
      ['mobile', '=', '+97455123456'],
      ['phone', '=', '55123456'],
      ['mobile', '=', '55123456'],
    ]);
  });
});

describe('partnerValues', () => {
  it('creates a customer partner with the contact details', () => {
    expect(partnerValues(order)).toEqual({
      name: 'Sara Al Thani',
      phone: '+97455123456',
      mobile: '+97455123456',
      email: 'sara@example.qa',
      customer_rank: 1,
      comment: 'Created by wolfcar.qa',
    });
  });

  it('writes a missing email as false, as Odoo expects', () => {
    expect(partnerValues({ ...order, customerEmail: null }).email).toBe(false);
  });
});

describe('saleOrderValues', () => {
  it('maps the order with one line per item, the fallback product for lines without an Odoo id', () => {
    expect(saleOrderValues(order, 7, { fallbackProductId: 99 })).toEqual({
      partner_id: 7,
      client_order_ref: 'BO-000001',
      origin: 'wolfcar.qa',
      note: 'Paid online · Tap charge chg_1 · QAR 619.50',
      order_line: [
        [0, 0, { product_id: 11, name: 'Dash Cam', product_uom_qty: 1, price_unit: 499 }],
        [0, 0, { product_id: 99, name: 'Floor Mats', product_uom_qty: 2, price_unit: 120.5 }],
      ],
    });
  });

  it('adds warehouse_id only when one is configured', () => {
    expect(saleOrderValues(order, 7, { warehouseId: 3, fallbackProductId: 99 })).toMatchObject({ warehouse_id: 3 });
    expect(saleOrderValues(order, 7, { fallbackProductId: 99 })).not.toHaveProperty('warehouse_id');
  });

  it('refuses a line without an Odoo id when there is no fallback, naming the products', () => {
    expect(() => saleOrderValues(order, 7)).toThrow(OdooMappingError);
    const err = (() => {
      try {
        saleOrderValues(order, 7);
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(OdooMappingError);
    expect(err).toMatchObject({ code: 'PRODUCT_NOT_IN_ODOO', productNames: ['Floor Mats'] });
    expect((err as Error).message).toContain('PRODUCT_NOT_IN_ODOO');
    expect((err as Error).message).toContain('Floor Mats');
  });

  it('names every product that is missing in Odoo, not just the first', () => {
    const noIds = { ...order, items: order.items.map((i) => ({ ...i, odooId: null })) };
    expect(() => saleOrderValues(noIds, 7)).toThrow(OdooMappingError);
    const err = (() => {
      try {
        saleOrderValues(noIds, 7);
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toMatchObject({ productNames: ['Dash Cam', 'Floor Mats'] });
  });
});

describe('nextAttemptAt', () => {
  const now = new Date('2026-10-18T10:00:00.000Z');
  const minutes = (m: number) => new Date(now.getTime() + m * 60_000);

  it('backs off 1, 5, 15, 60 minutes and then hourly', () => {
    expect(nextAttemptAt(1, now)).toEqual(minutes(1));
    expect(nextAttemptAt(2, now)).toEqual(minutes(5));
    expect(nextAttemptAt(3, now)).toEqual(minutes(15));
    expect(nextAttemptAt(4, now)).toEqual(minutes(60));
    expect(nextAttemptAt(5, now)).toEqual(minutes(60));
    expect(nextAttemptAt(23, now)).toEqual(minutes(60));
  });

  it('gives up at OUTBOX_MAX_ATTEMPTS', () => {
    expect(OUTBOX_MAX_ATTEMPTS).toBe(24);
    expect(nextAttemptAt(24, now)).toBeNull();
    expect(nextAttemptAt(30, now)).toBeNull();
  });
});
