import { describe, expect, it } from "vitest";
import { EMAIL_PATTERN, localQatarNumber, normaliseQatarPhone, OTP_CODE_PATTERN } from "./shop";

describe("normaliseQatarPhone", () => {
  it.each([
    ["55123456", "+97455123456"],
    ["+974 5512 3456", "+97455123456"],
    ["00974-55123456", "+97455123456"],
    ["974 55 12 34 56", "+97455123456"],
    ["(974) 33123456", "+97433123456"],
    ["٥٥١٢٣٤٥٦", "+97455123456"],
    ["۶۶۱۲۳۴۵۶", "+97466123456"],
    ["  77123456  ", "+97477123456"],
  ])("accepts %s as %s", (input, expected) => {
    expect(normaliseQatarPhone(input)).toBe(expected);
  });

  it.each([
    ["", "empty"],
    ["5512345", "seven digits"],
    ["551234567", "nine digits"],
    ["44123456", "a landline (4…)"],
    ["+96655123456", "a foreign number"],
    ["+97455123456x", "letters"],
    ["97455123456789", "too long after the country code"],
  ])("rejects %s (%s)", (input) => {
    expect(normaliseQatarPhone(input)).toBeNull();
  });
});

describe("localQatarNumber", () => {
  it("drops the country code", () => {
    expect(localQatarNumber("+97455123456")).toBe("55123456");
  });
});

describe("patterns", () => {
  it("accepts six digits as a code and ordinary addresses as email", () => {
    expect(OTP_CODE_PATTERN.test("048213")).toBe(true);
    expect(OTP_CODE_PATTERN.test("04821")).toBe(false);
    expect(EMAIL_PATTERN.test("sara@example.qa")).toBe(true);
    expect(EMAIL_PATTERN.test("sara@localhost")).toBe(false);
    expect(EMAIL_PATTERN.test("sara @example.qa")).toBe(false);
  });
});
