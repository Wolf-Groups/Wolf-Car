"use client";

import { useCallback, useEffect, useState } from "react";
import type { CustomerProfile } from "@/lib/api/types";
import { hasCustomerHint, shop } from "./shop-api";

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
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [status, setStatus] = useState<CustomerSession["status"]>("loading");

  const refresh = useCallback(async () => {
    if (!hasCustomerHint()) {
      setCustomer(null);
      setStatus("anonymous");
      return;
    }
    try {
      setCustomer(await shop.me());
      setStatus("signed-in");
    } catch {
      setCustomer(null);
      setStatus("anonymous");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the external session once on mount
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await shop.logout().catch(() => undefined);
    setCustomer(null);
    setStatus("anonymous");
  }, []);

  return { customer, status, refresh, signOut };
}
