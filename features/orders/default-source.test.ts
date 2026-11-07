import { describe, expect, it } from "vitest";
import { makeUser } from "@/tests/render";
import { defaultSource } from "./default-source";

const BO = { id: "b-bo", code: "BO", name: "Bin Omran Branch", nameAr: "فرع بن عمران" };

describe("defaultSource", () => {
  it("is the website's orders for the call center, who follows them at every branch", () => {
    expect(defaultSource(makeUser({ role: "RESERVATIONS", branch: null, permissions: ["booking.ppf.read", "order.web.handle"] }))).toBe("WEB");
  });

  it("is the website's orders for a user who reads every branch", () => {
    expect(defaultSource(makeUser({ role: "SUPER_ADMIN", branch: null, permissions: ["order.read.all", "order.confirm"] }))).toBe("WEB");
  });

  it("is the website's orders for the branch that holds them", () => {
    expect(defaultSource(makeUser({ role: "CASHIER", branch: BO, branchHoldsWebOrders: true, permissions: ["order.read.branch"] }))).toBe("WEB");
  });

  it("is the showroom's orders for any other branch, which never holds a website order", () => {
    expect(defaultSource(makeUser({ role: "CASHIER", branchHoldsWebOrders: false, permissions: ["order.read.branch"] }))).toBe("SHOWROOM");
  });
});
