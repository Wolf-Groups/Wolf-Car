"use client";

import { todo } from "./todo";

export interface ReturnStatusProps {
  orderId: string;
}

/** After Tap's redirect: reconcile once, poll while pending, then paid / not paid / expired. */
export function ReturnStatus(props: ReturnStatusProps) {
  return todo("ReturnStatus", props);
}
