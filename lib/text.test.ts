import { describe, expect, it } from "vitest";
import { hasArabic } from "./text";

describe("hasArabic", () => {
  it.each([
    ["G700 جيتور - شبك امامي", true],
    ["شبك امامي", true],
    ["3D Floor Mats", false],
    ["LYK-900", false],
    ["", false],
  ])("%j → %s", (text, expected) => {
    expect(hasArabic(text)).toBe(expected);
  });
});
