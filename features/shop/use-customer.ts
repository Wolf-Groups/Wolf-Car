"use client";

import type { CustomerProfile } from "@/lib/api/types";
import { todo } from "./todo";

export interface CustomerSession {
  customer: CustomerProfile | null;
  status: "loading" | "signed-in" | "anonymous";
  /** re-reads `GET /api/shop/me` */
  refresh(): Promise<void>;
  /** `POST /api/shop/logout`, then anonymous */
  signOut(): Promise<void>;
}

/** The website's customer session; asks the API only when the hint cookie says there may be one. */
export function useCustomer(): CustomerSession {
  return todo("useCustomer");
}
