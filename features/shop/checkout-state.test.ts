import { describe, expect, it } from "vitest";
import { branchOrder, customer, ORDER_KEY, webOrder } from "@/tests/shop-fixtures";
import { type CheckoutEvent, type CheckoutState, initialState, reduce, resumable } from "./checkout-state";

const state = (over: Partial<CheckoutState> = {}): CheckoutState => ({ ...initialState, ...over });

/** Deep-freezes a state so a reducer that mutates its input throws. */
function frozen(s: CheckoutState): CheckoutState {
  if (s.customer) Object.freeze(s.customer);
  if (s.order) Object.freeze(s.order);
  Object.freeze(s.contact);
  return Object.freeze(s);
}

const EVERY_EVENT_BUT_ERROR: CheckoutEvent[] = [
  { type: "SESSION_FOUND", customer: customer() },
  { type: "SIGNED_OUT" },
  { type: "ORDER_CREATED", order: webOrder(), key: ORDER_KEY },
  { type: "BACK_TO_DETAILS" },
  { type: "BUSY", busy: true },
  { type: "BUSY", busy: false },
];

describe("checkout state: the order of steps", () => {
  it("starts at the details, with nothing known: nobody has to sign in to order", () => {
    expect(initialState).toEqual({ step: "details", customer: null, contact: { name: "", phone: "", email: "" }, order: null, key: null, busy: false, error: null });
  });

  it("a session fills the details with the customer's name, phone and email", () => {
    const next = reduce(frozen(state()), { type: "SESSION_FOUND", customer: customer() });
    expect(next.step).toBe("details");
    expect(next.customer).toEqual(customer());
    expect(next.contact).toEqual({ name: "Sara Ali", phone: "55123456", email: "sara@example.com" });
  });

  it("a session without a saved name or phone leaves those empty", () => {
    const next = reduce(frozen(state()), { type: "SESSION_FOUND", customer: customer({ name: null, phone: null }) });
    expect(next.contact).toEqual({ name: "", phone: "", email: "sara@example.com" });
  });

  it("signing out forgets the customer and their details", () => {
    const signedIn = reduce(state(), { type: "SESSION_FOUND", customer: customer() });
    const next = reduce(frozen(signedIn), { type: "SIGNED_OUT" });
    expect(next).toMatchObject({ step: "details", customer: null, contact: { name: "", phone: "", email: "" } });
  });

  it("a created card order moves to the pay step with the order and its key", () => {
    const order = webOrder();
    const next = reduce(frozen(state()), { type: "ORDER_CREATED", order, key: ORDER_KEY });
    expect(next).toMatchObject({ step: "pay", order, key: ORDER_KEY });
  });

  it("a created order keeps what it was made with, for going back to the details (a guest has no profile to refill it)", () => {
    const order = webOrder({ customer: { name: "Khalid Saleh", email: "khalid@example.com", phone: "+97466123456" } });
    const next = reduce(frozen(state()), { type: "ORDER_CREATED", order, key: ORDER_KEY });
    expect(next.contact).toEqual({ name: "Khalid Saleh", phone: "66123456", email: "khalid@example.com" });
    const back = reduce(frozen(next), { type: "BACK_TO_DETAILS" });
    expect(back).toMatchObject({ step: "details", order: null, key: null, contact: next.contact });
  });
});

describe("resumable", () => {
  it("is an open, unpaid card order before its expiry", () => {
    expect(resumable(webOrder({ expiresAt: new Date(Date.now() + 60_000).toISOString() }))).toBe(true);
    expect(resumable(webOrder({ expiresAt: new Date(Date.now() - 60_000).toISOString() }))).toBe(false);
  });

  it("is never an order to pay at the branch: there is nothing to pay here", () => {
    expect(resumable(branchOrder())).toBe(false);
  });
});

describe("checkout state: busy and errors", () => {
  it("BUSY toggles busy and nothing else about the step", () => {
    const on = reduce(frozen(state()), { type: "BUSY", busy: true });
    expect(on.busy).toBe(true);
    expect(on.step).toBe("details");
    expect(reduce(frozen(on), { type: "BUSY", busy: false }).busy).toBe(false);
  });

  it("ERROR keeps the step and shows the code", () => {
    const next = reduce(frozen(state({ step: "pay", order: webOrder() })), { type: "ERROR", code: "PAYMENT_FAILED" });
    expect(next.step).toBe("pay");
    expect(next.error).toBe("PAYMENT_FAILED");
    expect(reduce(frozen(next), { type: "ERROR", code: null }).error).toBeNull();
  });

  it.each(EVERY_EVENT_BUT_ERROR.map((e) => [e.type, e] as const))("%s clears the error", (_type, event) => {
    expect(reduce(frozen(state({ customer: customer(), order: webOrder(), error: "PAYMENT_FAILED" })), event).error).toBeNull();
  });

  it("never changes the state it was given", () => {
    const before = state({ customer: customer(), error: "PAYMENT_FAILED" });
    const copy = structuredClone(before);
    for (const event of [...EVERY_EVENT_BUT_ERROR, { type: "ERROR", code: "X" } as const]) reduce(before, event);
    expect(before).toEqual(copy);
  });
});
