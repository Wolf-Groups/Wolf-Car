import type { CustomerProfile, WebOrder } from "@/lib/api/types";
import { todo } from "./todo";

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
  return todo("reduce", state, event);
}
