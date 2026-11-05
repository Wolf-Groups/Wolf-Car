import type { CustomerProfile, WebOrder } from "@/lib/api/types";
import { localQatarNumber } from "@/shared/shop";

/**
 * The checkout's steps as a pure reducer, so the order of screens is tested
 * without the DOM: details → pay. Nobody has to sign in; a session only fills
 * the details in. An order paid at the branch has no pay step: it goes
 * straight to its thank-you page.
 */
export type Step = "details" | "pay";

/** What fills the details form: the session's profile, or what this order was made with. */
export interface ContactDetails {
  name: string;
  /** as shown in the field: "55123456" */
  phone: string;
  email: string;
}

export interface CheckoutState {
  step: Step;
  /** the signed-in customer, if any */
  customer: CustomerProfile | null;
  contact: ContactDetails;
  /** the unpaid card order created at the details step */
  order: WebOrder | null;
  /** the key that opens `order` without a session */
  key: string | null;
  busy: boolean;
  /** an API error code (or a message key) shown above the current step */
  error: string | null;
}

const NO_CONTACT: ContactDetails = { name: "", phone: "", email: "" };

export const initialState: CheckoutState = {
  step: "details",
  customer: null,
  contact: NO_CONTACT,
  order: null,
  key: null,
  busy: false,
  error: null,
};

const contactOf = (c: { name: string | null; phone: string | null; email: string | null }): ContactDetails => ({
  name: c.name ?? "",
  phone: c.phone ? localQatarNumber(c.phone) : "",
  email: c.email ?? "",
});

/**
 * An order the checkout may take (back) to the pay step: a card order still open and unpaid,
 * not past its expiry, and no capture on it (money already taken is for the branch to sort out).
 */
export function resumable(order: WebOrder): boolean {
  return (
    order.status === "PENDING" &&
    order.paymentStatus === "PENDING" &&
    order.lastPayment?.status !== "CAPTURED" &&
    (order.expiresAt === null || Date.parse(order.expiresAt) > Date.now())
  );
}

/** Paid, or captured and held back (AMOUNT_MISMATCH, DUPLICATE_CAPTURE): nothing left to pay here. */
export function paidOrHeld(order: WebOrder): boolean {
  return order.paymentStatus === "PAID" || (order.lastPayment?.status === "CAPTURED" && order.lastPayment.failureCode !== null);
}

export type CheckoutEvent =
  | { type: "SESSION_FOUND"; customer: CustomerProfile }
  | { type: "SIGNED_OUT" }
  | { type: "ORDER_CREATED"; order: WebOrder; key: string | null }
  | { type: "BACK_TO_DETAILS" }
  | { type: "BUSY"; busy: boolean }
  | { type: "ERROR"; code: string | null };

export function reduce(state: CheckoutState, event: CheckoutEvent): CheckoutState {
  if (event.type === "ERROR") return { ...state, error: event.code };
  const next = { ...state, error: null };
  switch (event.type) {
    case "SESSION_FOUND":
      return { ...next, customer: event.customer, contact: contactOf(event.customer) };
    case "SIGNED_OUT":
      return { ...next, customer: null, contact: NO_CONTACT };
    case "ORDER_CREATED":
      // the order's details fill the details step again if the customer goes back to it
      return { ...next, step: "pay", order: event.order, key: event.key, contact: contactOf(event.order.customer) };
    case "BACK_TO_DETAILS":
      return { ...next, step: "details", order: null, key: null };
    case "BUSY":
      return { ...next, busy: event.busy };
  }
}
