import { describe, expect, it } from "vitest";
import { paidOrder, webOrder } from "@/tests/shop-fixtures";
import { orderState } from "./order-state";

const NOW = Date.parse("2031-03-10T09:10:00.000Z");

describe("orderState", () => {
  it("is awaitingPayment for an open unpaid order before its expiry", () => {
    expect(orderState(webOrder(), NOW)).toBe("awaitingPayment");
  });

  it("is cancelled for an unpaid order past its expiry or closed", () => {
    expect(orderState(webOrder(), Date.parse("2031-03-10T09:31:00.000Z"))).toBe("cancelled");
    expect(orderState(webOrder({ status: "CANCELLED" }), NOW)).toBe("cancelled");
  });

  it("is paid once the card payment is in, and collected once the branch handed it over", () => {
    expect(orderState(paidOrder(), NOW)).toBe("paid");
    expect(orderState(paidOrder({ collectedAt: "2031-03-11T08:00:00.000Z" }), NOW)).toBe("collected");
  });

  it("is refunded after a refund, even if it had been collected", () => {
    expect(orderState(paidOrder({ paymentStatus: "REFUNDED", status: "CANCELLED" }), NOW)).toBe("refunded");
  });

  it("is review when money was captured but held back for the branch", () => {
    expect(orderState(webOrder({ status: "CANCELLED", lastPayment: { status: "CAPTURED", failureCode: "AMOUNT_MISMATCH" } }), NOW)).toBe("review");
  });
});
