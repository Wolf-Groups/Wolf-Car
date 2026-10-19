"use client";

import type { CustomerProfile } from "@/lib/api/types";
import { todo } from "./todo";

export interface OtpStepProps {
  phone: string;
  /** epoch ms when "Resend" becomes available; null means at once */
  resendAt: number | null;
  onVerified: (customer: CustomerProfile) => void;
  onChangePhone: () => void;
  onResent: (resendAt: number) => void;
  /** development only: the page passes it when the API echoed the code */
  devCode?: string;
}

/** Step 2: the six-digit code, auto-submitted when full, with resend countdown and "change number". */
export function OtpStep(props: OtpStepProps) {
  return todo("OtpStep", props);
}
