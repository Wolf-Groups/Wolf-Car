import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { track } from "@/lib/track";
import { renderOnSite } from "@/tests/render-site";
import { SiteAnalytics } from "./SiteAnalytics";

vi.mock("@/lib/track", () => ({ track: vi.fn() }));

describe("visitor statistics: links out of the site", () => {
  it("counts a press on a WolfOS link, with where on the page it sat", async () => {
    const { user } = renderOnSite(
      <>
        <SiteAnalytics />
        <a href="https://wolfcaros.com/ar" data-place="section" onClick={(e) => e.preventDefault()}>
          WolfOS
        </a>
      </>,
    );
    await user.click(screen.getByRole("link", { name: "WolfOS" }));
    expect(track).toHaveBeenCalledWith("wolfos", { label: "section" });
  });

  it("does not count other links as WolfOS", async () => {
    const { user } = renderOnSite(
      <>
        <SiteAnalytics />
        <a href="https://wolfcaros.com.example.net/ar" onClick={(e) => e.preventDefault()}>
          Look-alike
        </a>
      </>,
    );
    await user.click(screen.getByRole("link", { name: "Look-alike" }));
    expect(vi.mocked(track).mock.calls.map((c) => c[0])).not.toContain("wolfos");
  });
});
