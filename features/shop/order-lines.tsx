"use client";

import type { WebOrder } from "@/lib/api/types";
import { todo } from "./todo";

export type OrderLinesProps = Pick<WebOrder, "items" | "total" | "currency">;

/** Read-only list of an order's lines with the total, through `formatMoney`. */
export function OrderLines(props: OrderLinesProps) {
  return todo("OrderLines", props);
}
