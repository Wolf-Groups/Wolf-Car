import { describe, expect, it } from "vitest";
import { customer, webOrder } from "@/tests/shop-fixtures";
import { OTP_RESEND_SECONDS } from "@/shared/shop";
import { type CheckoutEvent, type CheckoutState, initialState, reduce } from "./checkout-state";

const NOW = Date.parse("2031-03-10T09:00:00.000Z");
const state = (over: Partial<CheckoutState> = {}): CheckoutState => ({ ...initialState, ...over });

/** Deep-freezes a state so a reducer that mutates its input throws. */
function frozen(s: CheckoutState): CheckoutState {
  if (s.customer) Object.freeze(s.customer);
  if (s.order) Object.freeze(s.order);
  return Object.freeze(s);
}

const EVERY_EVENT_BUT_ERROR: CheckoutEvent[] = [
  { type: "SESSION_FOUND", customer: customer() },
  { type: "NO_SESSION" },
  { type: "OTP_SENT", phone: "+97455123456", now: NOW },
  { type: "VERIFIED", customer: customer() },
  { type: "CHANGE_PHONE" },
  { type: "ORDER_CREATED", order: webOrder() },
  { type: "BACK_TO_DETAILS" },
  { type: "BUSY", busy: true },
  { type: "BUSY", busy: false },
];

describe("checkout state: the order of steps", () => {
  it("a remembered session goes straight to the details with the customer", () => {
    const me = customer();
    const next = reduce(frozen(state()), { type: "SESSION_FOUND", customer: me });
    expect(next.step).toBe("details");
    expect(next.customer).toEqual(me);
  });

  it("no session means the phone step", () => {
    expect(reduce(frozen(state({ step: "details" })), { type: "NO_SESSION" }).step).toBe("phone");
  });

  it("a sent code moves to the code step, remembers the phone and holds Resend for OTP_RESEND_SECONDS", () => {
    const next = reduce(frozen(state()), { type: "OTP_SENT", phone: "+97455123456", now: NOW });
    expect(next.step).toBe("code");
    expect(next.phone).toBe("+97455123456");
    expect(next.resendAt).toBe(NOW + OTP_RESEND_SECONDS * 1000);
    expect(next.resendAt).toBe(NOW + 60_000);
  });

  it("a verified code moves to the details with the customer", () => {
    const me = customer({ name: null, email: null });
    const next = reduce(frozen(state({ step: "code", phone: "+97455123456" })), { type: "VERIFIED", customer: me });
    expect(next.step).toBe("details");
    expect(next.customer).toEqual(me);
  });

  it("changing the number goes back to the phone step and forgets the customer", () => {
    const next = reduce(frozen(state({ step: "code", phone: "+97455123456", customer: customer() })), { type: "CHANGE_PHONE" });
    expect(next.step).toBe("phone");
    expect(next.customer).toBeNull();
  });

  it("a created order moves to the pay step with the order", () => {
    const order = webOrder();
    const next = reduce(frozen(state({ step: "details", customer: customer() })), { type: "ORDER_CREATED", order });
    expect(next.step).toBe("pay");
    expect(next.order).toEqual(order);
    expect(next.customer).toEqual(customer());
  });

  it("a created order keeps the name and email it was made with, for going back to the details", () => {
    const order = webOrder({ customer: { name: "Sara Ali", email: "sara@example.com", phone: "+97455123456" } });
    const next = reduce(frozen(state({ step: "details", customer: customer({ name: null, email: null }) })), { type: "ORDER_CREATED", order });
    expect(next.customer).toMatchObject({ name: "Sara Ali", email: "sara@example.com" });
  });

  it("back to the details drops the order (an expired one cannot be paid)", () => {
    const next = reduce(frozen(state({ step: "pay", customer: customer(), order: webOrder() })), { type: "BACK_TO_DETAILS" });
    expect(next.step).toBe("details");
    expect(next.order).toBeNull();
    expect(next.customer).toEqual(customer());
  });

  it("starts at the phone step with nothing known and walks the whole way: phone → code → details → pay", () => {
    expect(initialState).toEqual({ step: "phone", phone: "", customer: null, order: null, busy: false, error: null, resendAt: null });
    const events: CheckoutEvent[] = [
      { type: "NO_SESSION" },
      { type: "OTP_SENT", phone: "+97455123456", now: NOW },
      { type: "VERIFIED", customer: customer() },
      { type: "ORDER_CREATED", order: webOrder() },
    ];
    const steps = events.reduce<CheckoutState[]>((acc, e) => [...acc, reduce(acc[acc.length - 1], e)], [initialState]).map((s) => s.step);
    expect(steps).toEqual(["phone", "phone", "code", "details", "pay"]);
  });
});

describe("checkout state: busy and errors", () => {
  it("BUSY toggles busy and nothing else about the step", () => {
    const on = reduce(frozen(state({ step: "details" })), { type: "BUSY", busy: true });
    expect(on.busy).toBe(true);
    expect(on.step).toBe("details");
    expect(reduce(frozen(on), { type: "BUSY", busy: false }).busy).toBe(false);
  });

  it("ERROR keeps the step and shows the code", () => {
    const next = reduce(frozen(state({ step: "code" })), { type: "ERROR", code: "OTP_INVALID" });
    expect(next.step).toBe("code");
    expect(next.error).toBe("OTP_INVALID");
    expect(reduce(frozen(next), { type: "ERROR", code: null }).error).toBeNull();
  });

  it.each(EVERY_EVENT_BUT_ERROR.map((e) => [e.type, e] as const))("%s clears the error", (_type, event) => {
    expect(reduce(frozen(state({ step: "details", customer: customer(), order: webOrder(), error: "PAYMENT_FAILED" })), event).error).toBeNull();
  });

  it("never changes the state it was given", () => {
    const before = state({ step: "code", phone: "+97455123456", customer: customer(), error: "OTP_INVALID", resendAt: NOW });
    const copy = structuredClone(before);
    for (const event of [...EVERY_EVENT_BUT_ERROR, { type: "ERROR", code: "X" } as const]) reduce(before, event);
    expect(before).toEqual(copy);
  });
});
