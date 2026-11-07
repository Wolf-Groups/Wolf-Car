import { authUser } from '../../test/unit/helpers';
import { canReadAllBranches, orderReadScope, orderReceiptScope, orderWriteScope } from './order-scope';

const NOTHING = { id: { in: [] } };

describe('order scopes', () => {
  it('limits branch staff to their own branch for reads and writes', () => {
    const cashier = authUser({ role: 'CASHIER', branchId: 'gh' }, ['order.read.branch']);
    expect(orderReadScope(cashier)).toEqual({ branchId: 'gh' });
    expect(orderWriteScope(cashier)).toEqual({ branchId: 'gh' });
    expect(orderReceiptScope(cashier)).toEqual({ branchId: 'gh' });
  });

  it('lets order.read.all read every branch but never write outside its own', () => {
    const finance = authUser({ role: 'FINANCE', branchId: null }, ['order.read.all']);
    expect(orderReadScope(finance)).toEqual({});
    expect(orderWriteScope(finance)).toEqual(NOTHING);
    const cashierWithAll = authUser({ role: 'CASHIER', branchId: 'gh' }, ['order.read.all']);
    expect(orderReadScope(cashierWithAll)).toEqual({});
    expect(orderWriteScope(cashierWithAll)).toEqual({ branchId: 'gh' });
  });

  it('gives the Super Admin every order', () => {
    const admin = authUser({ role: 'SUPER_ADMIN', branchId: null });
    expect(orderReadScope(admin)).toEqual({});
    expect(orderWriteScope(admin)).toEqual({});
    expect(orderReceiptScope(admin)).toEqual({});
  });

  it('matches nothing for users without a branch or read permission', () => {
    expect(orderReadScope(authUser({ role: 'CASHIER', branchId: 'gh' }, []))).toEqual(NOTHING);
    expect(orderReadScope(authUser({ role: 'FINANCE', branchId: null }, ['order.read.branch']))).toEqual(NOTHING);
  });

  it("lets the call center (order.web.handle, no branch) read every order and change the website's only", () => {
    const callCenter = authUser({ role: 'RESERVATIONS', branchId: null }, ['order.web.handle']);
    expect(orderReadScope(callCenter)).toEqual({});
    expect(orderReceiptScope(callCenter)).toEqual({});
    expect(canReadAllBranches(callCenter)).toBe(true);
    expect(orderWriteScope(callCenter)).toEqual({ source: 'WEB' });
  });

  it("adds the website's orders to a branch user's own branch when they hold order.web.handle", () => {
    const cashier = authUser({ role: 'CASHIER', branchId: 'gh' }, ['order.read.branch', 'order.web.handle']);
    expect(orderWriteScope(cashier)).toEqual({ OR: [{ branchId: 'gh' }, { source: 'WEB' }] });
  });
});
