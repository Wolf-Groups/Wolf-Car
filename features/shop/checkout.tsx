"use client";

import { todo } from "./todo";

export interface CheckoutProps {
  /** NEXT_PUBLIC_TAP_PUBLIC_KEY */
  publicKey: string;
}

/** The whole checkout: `useReducer(reduce, initialState)` over the four steps, or `empty` with a link to the catalogue. */
export function Checkout(props: CheckoutProps) {
  return todo("Checkout", props);
}
