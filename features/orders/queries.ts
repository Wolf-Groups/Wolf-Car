import { api } from "@/lib/api/client";
import type { OrderDetail, OrderSourceName, OrderStatusName, OrderSummary, Page } from "@/lib/api/types";
import { ORDER_STATUSES } from "@/shared/permissions";
import { ORDER_SOURCES } from "@/shared/shop";

export const PAGE_SIZE = 20;

/** Everything the orders page keeps in the query string (so links like ?status=PENDING or ?open=<id> work). */
export interface OrdersUrlState {
  status: OrderStatusName | "";
  /** showroom or web orders only; "" for both */
  source: OrderSourceName | "";
  from: string;
  to: string;
  customerName: string;
  orderNumber: string;
  branchId: string;
  page: number;
  /** id of the order shown in the detail sheet */
  open: string | null;
}

export type OrderFilters = Omit<OrdersUrlState, "open">;

export const EMPTY_STATE: OrdersUrlState = {
  status: "",
  source: "",
  from: "",
  to: "",
  customerName: "",
  orderNumber: "",
  branchId: "",
  page: 1,
  open: null,
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseUrlState(params: URLSearchParams): OrdersUrlState {
  const status = params.get("status") ?? "";
  const source = params.get("source") ?? "";
  const page = Number(params.get("page"));
  const day = (key: string) => {
    const v = params.get(key) ?? "";
    return DAY.test(v) ? v : "";
  };
  return {
    status: (ORDER_STATUSES as readonly string[]).includes(status) ? (status as OrderStatusName) : "",
    source: (ORDER_SOURCES as readonly string[]).includes(source) ? (source as OrderSourceName) : "",
    from: day("from"),
    to: day("to"),
    customerName: (params.get("customerName") ?? "").slice(0, 80),
    orderNumber: (params.get("orderNumber") ?? "").slice(0, 20),
    branchId: params.get("branchId") ?? "",
    page: Number.isInteger(page) && page > 1 ? page : 1,
    open: params.get("open") || null,
  };
}

/** Canonical query string (fixed key order, defaults omitted). */
export function serializeUrlState(state: OrdersUrlState): string {
  const params = new URLSearchParams();
  if (state.status) params.set("status", state.status);
  if (state.source) params.set("source", state.source);
  if (state.from) params.set("from", state.from);
  if (state.to) params.set("to", state.to);
  if (state.customerName) params.set("customerName", state.customerName);
  if (state.orderNumber) params.set("orderNumber", state.orderNumber);
  if (state.branchId) params.set("branchId", state.branchId);
  if (state.page > 1) params.set("page", String(state.page));
  if (state.open) params.set("open", state.open);
  return params.toString();
}

export const hasFilters = (f: OrderFilters) => Boolean(f.status || f.source || f.from || f.to || f.customerName || f.orderNumber || f.branchId);

export const orderKeys = {
  all: ["orders"] as const,
  list: (filters: OrderFilters) => ["orders", "list", filters] as const,
  detail: (id: string) => ["orders", "detail", id] as const,
};

export function fetchOrders(f: OrderFilters): Promise<Page<OrderSummary>> {
  return api<Page<OrderSummary>>("/orders", {
    query: {
      status: f.status,
      source: f.source,
      from: f.from,
      to: f.to,
      customerName: f.customerName,
      orderNumber: f.orderNumber,
      branchId: f.branchId,
      page: f.page,
      pageSize: PAGE_SIZE,
    },
  });
}

export function fetchOrder(id: string): Promise<OrderDetail> {
  return api<OrderDetail>(`/orders/${id}`);
}

/** Sends a paid web order to Odoo again after the outbox row failed (`order.odoo.retry`). */
export function retryOdoo(id: string): Promise<OrderDetail> {
  return api<OrderDetail>(`/orders/${id}/odoo/retry`, { method: "POST" });
}

/** The cashier handed the parts of a paid web order over (`order.confirm`). */
export function collectOrder(id: string): Promise<OrderDetail> {
  return api<OrderDetail>(`/orders/${id}/collect`, { method: "POST" });
}
