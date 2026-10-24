import { describe, expect, it } from "vitest";
import { availableFirst, isAvailable } from "./stock";

describe("availableFirst", () => {
  it("moves what is out of stock to the end and keeps the order otherwise", () => {
    const list = [
      { id: "a", available: false },
      { id: "b", available: true },
      { id: "c" },
      { id: "d", available: false },
      { id: "e", available: true },
    ];
    expect(availableFirst(list).map((p) => p.id)).toEqual(["b", "c", "e", "a", "d"]);
  });

  it("treats a product without the flag (an older API) as available", () => {
    expect(isAvailable({})).toBe(true);
  });
});
