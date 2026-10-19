"use client";

import type { CustomerProfile, WebOrder } from "@/lib/api/types";
import { todo } from "./todo";

export interface DetailsStepProps {
  customer: CustomerProfile;
  onCreated: (order: WebOrder) => void;
}

/** Step 3: name and email over the basket; creates the unpaid order so the server total is shown before the card. */
export function DetailsStep(props: DetailsStepProps) {
  return todo("DetailsStep", props);
}
