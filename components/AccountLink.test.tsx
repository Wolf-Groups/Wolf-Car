import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderOnSite } from "@/tests/render-site";
import { AccountLink } from "./AccountLink";

describe("header: my account", () => {
  it("links to the account page", () => {
    renderOnSite(<AccountLink />);
    expect(screen.getByRole("link", { name: "My account" })).toHaveAttribute("href", "/account");
  });

  it("is in Arabic on the Arabic site", () => {
    renderOnSite(<AccountLink />, { locale: "ar" });
    expect(screen.getByRole("link", { name: "حسابي" })).toBeInTheDocument();
  });
});
