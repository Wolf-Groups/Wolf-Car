import type { OrderSourceName, Profile } from "@/lib/api/types";

/**
 * The tab the orders page opens on (no ?source=), and the source the
 * overview's Pending tile counts. Every website order waits at one branch, so
 * they are the work for the call center, for users who read every branch and
 * for that branch; every other branch opens on its showroom's orders.
 */
export function defaultSource(user: Pick<Profile, "permissions" | "branchHoldsWebOrders"> | null): OrderSourceName {
  const everyBranch = user?.permissions.some((p) => p === "order.web.handle" || p === "order.read.all");
  return everyBranch || user?.branchHoldsWebOrders ? "WEB" : "SHOWROOM";
}
