import type { CustomerProfile, WebOrder } from "@/lib/api/types";
import { OTP_RESEND_SECONDS } from "@/shared/shop";

/**
 * The checkout's steps as a pure reducer, so the order of screens is tested
 * without the DOM: phone → code → details → pay.
 */
export type Step = "phone" | "code" | "details" | "pay";

export interface CheckoutState {
  step: Step;
  /** E.164 once a code was sent */
  phone: string;
  customer: CustomerProfile | null;
  /** the unpaid order created at the details step */
  order: WebOrder | null;
  busy: boolean;
  /** an API error code (or a message key) shown above the current step */
  error: string | null;
  /** epoch ms when "Resend" may be pressed again */
  resendAt: number | null;
}

export const initialState: CheckoutState = {
  step: "phone",
  phone: "",
  customer: null,
  order: null,
  busy: false,
  error: null,
  resendAt: null,
};

/**
 * An order the checkout may take (back) to the pay step: still open and unpaid,
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
  | { type: "NO_SESSION" }
  | { type: "OTP_SENT"; phone: string; now: number }
  | { type: "VERIFIED"; customer: CustomerProfile }
  | { type: "CHANGE_PHONE" }
  | { type: "ORDER_CREATED"; order: WebOrder }
  | { type: "BACK_TO_DETAILS" }
  | { type: "BUSY"; busy: boolean }
  | { type: "ERROR"; code: string | null };

export function reduce(state: CheckoutState, event: CheckoutEvent): CheckoutState {
  if (event.type === "ERROR") return { ...state, error: event.code };
  const next = { ...state, error: null };
  switch (event.type) {
    case "SESSION_FOUND":
    case "VERIFIED":
      return { ...next, step: "details", customer: event.customer };
    case "NO_SESSION":
      return { ...next, step: "phone" };
    case "OTP_SENT":
      return { ...next, step: "code", phone: event.phone, resendAt: event.now + OTP_RESEND_SECONDS * 1000 };
    case "CHANGE_PHONE":
      return { ...next, step: "phone", customer: null };
    case "ORDER_CREATED":
      // the order's name and email fill the details step again if the customer goes back to it
      return {
        ...next,
        step: "pay",
        order: event.order,
        customer: state.customer && {
          ...state.customer,
          name: event.order.customer.name ?? state.customer.name,
          email: event.order.customer.email ?? state.customer.email,
        },
      };
    case "BACK_TO_DETAILS":
      return { ...next, step: "details", order: null };
    case "BUSY":
      return { ...next, busy: event.busy };
  }
}
