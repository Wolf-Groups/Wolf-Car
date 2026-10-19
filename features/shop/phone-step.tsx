"use client";

import { todo } from "./todo";

export interface PhoneStepProps {
  /** the E.164 phone the code went to, plus the code itself when the API is in development mode */
  onSent: (phone: string, devCode?: string) => void;
}

/** Step 1: one phone input, normalised live through `normaliseQatarPhone`; sends the code. */
export function PhoneStep(props: PhoneStepProps) {
  return todo("PhoneStep", props);
}
