import { describe, expect, it } from "vitest";
import { getPrivacy, getRefund, getTerms } from "./legal";

describe("legal documents", () => {
  it.each([
    ["privacy", getPrivacy],
    ["terms", getTerms],
    ["refund", getRefund],
  ])("the %s policy has the same sections in Arabic and English", (_name, get) => {
    const ar = get("ar");
    const en = get("en");
    expect(ar.sections).toHaveLength(en.sections.length);
    for (const [i, section] of en.sections.entries()) {
      expect(ar.sections[i].paragraphs).toHaveLength(section.paragraphs.length);
    }
  });

  it("the refund policy covers card refunds, the time limits and how to ask", () => {
    const text = getRefund("en").sections.flatMap((s) => s.paragraphs).join(" ");
    expect(text).toContain("within 7 days");
    expect(text).toContain("refund the full amount to the same card");
    expect(text).toContain("within 3 working days");
    expect(text).toContain("+974 7100 8939");
    expect(getRefund("en").updated).toBe("2026-10-21");
    expect(getRefund("ar").title).toBe("سياسة الاسترجاع والاستبدال");
  });
});
