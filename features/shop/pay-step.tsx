"use client";

import type { WebOrder } from "@/lib/api/types";
import { todo } from "./todo";

export interface PayStepProps {
  order: WebOrder;
  publicKey: string;
  locale: "ar" | "en";
  /** the order expired (ORDER_NOT_PAYABLE): back to the details step */
  onBack: () => void;
}

/** Step 4: total, pickup branch, the Tap card and the Pay button; follows Tap's redirect. */
export function PayStep(props: PayStepProps) {
  return todo("PayStep", props);
}
