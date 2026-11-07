import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderOnSite } from "@/tests/render-site";
import { WolfOs } from "./WolfOs";
import { WolfOsLink } from "./WolfOsLink";

describe("landing: WolfOS, our app", () => {
  it("sends visitors to the WolfOS site and its Leopard download, each in a new tab", () => {
    renderOnSite(<WolfOs />);
    const discover = screen.getByRole("link", { name: /Discover WolfOS/ });
    expect(discover).toHaveAttribute("href", "https://wolfcaros.com/en");
    expect(discover).toHaveAttribute("target", "_blank");
    expect(discover).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(discover).toHaveAttribute("data-place", "section");
    const download = screen.getByRole("link", { name: /Free download/ });
    expect(download).toHaveAttribute("href", "https://wolfcaros.com/en/download?brand=byd-leopard");
    expect(download).toHaveAttribute("target", "_blank");
    expect(download).toHaveAttribute("data-place", "download");
  });

  it("is in Arabic on the Arabic site and leads to the Arabic WolfOS site", () => {
    renderOnSite(<WolfOs />, { locale: "ar" });
    expect(screen.getByRole("heading", { name: "WolfOS" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /اكتشف WolfOS/ })).toHaveAttribute("href", "https://wolfcaros.com/ar");
    expect(screen.getByRole("link", { name: /تنزيل مجاني/ })).toHaveAttribute("href", "https://wolfcaros.com/ar/download?brand=byd-leopard");
  });
});

describe("header: our app", () => {
  it("opens the WolfOS site straight away, in a new tab", () => {
    renderOnSite(<WolfOsLink place="header" />);
    const link = screen.getByRole("link", { name: /Our app/ });
    expect(link).toHaveAttribute("href", "https://wolfcaros.com/en");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(link).toHaveAttribute("data-place", "header");
    expect(link).toHaveTextContent("New");
  });

  it("reads تطبيقنا on the Arabic site and leads to the Arabic WolfOS site", () => {
    renderOnSite(<WolfOsLink place="menu" />, { locale: "ar" });
    const link = screen.getByRole("link", { name: /تطبيقنا/ });
    expect(link).toHaveAttribute("href", "https://wolfcaros.com/ar");
    expect(link).toHaveAttribute("data-place", "menu");
  });
});
