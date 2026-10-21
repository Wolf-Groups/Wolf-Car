import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderOnSite } from "@/tests/render-site";
import { AccountLink } from "./AccountLink";

describe("header: my account", () => {
  it("links to the account page", () => {
    renderOnSite(<AccountLink enabled />);
    expect(screen.getByRole("link", { name: "My account" })).toHaveAttribute("href", "/account");
  });

  it("is in Arabic on the Arabic site", () => {
    renderOnSite(<AccountLink enabled />, { locale: "ar" });
    expect(screen.getByRole("link", { name: "حسابي" })).toBeInTheDocument();
  });

  it("is hidden while card checkout is off (no customer can sign in yet)", () => {
    renderOnSite(<AccountLink enabled={false} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
