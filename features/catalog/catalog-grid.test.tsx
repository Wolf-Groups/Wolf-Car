import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import type { PublicProduct } from "@/lib/api/types";
import { cart } from "./cart";
import { CatalogGrid } from "./catalog-grid";

const product = (id: string, name: string, price: string | null, description: string | null = null): PublicProduct => ({
  id,
  name,
  description,
  categoryId: null,
  price,
  imageUrl: `/api/uploads/${id}.webp`,
  thumbUrl: `/api/uploads/${id}-sm.webp`,
});

const products = [
  product("a", "4K Dash Cam", "499.00", "Front and rear camera"),
  product("b", "3D Floor Mats", "120.50"),
  product("c", "Phone Holder", null),
];

const renderGrid = (items: PublicProduct[]) =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <CatalogGrid products={items} />
    </NextIntlClientProvider>,
  );

const names = () => within(screen.getByTestId("catalog-grid")).getAllByRole("heading").map((h) => h.textContent);

afterEach(() => act(() => cart.clear()));

describe("public catalog grid", () => {
  it("marks what is out of stock as not available, offers no add button for it and lists it last", () => {
    renderGrid([{ ...products[0], available: false }, products[1], products[2]]);
    expect(names()).toEqual(["3D Floor Mats", "Phone Holder", "4K Dash Cam"]);
    const card = screen.getAllByRole("listitem")[2];
    expect(within(card).getByText("Not available")).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Add to cart" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add to cart" })).toHaveLength(2);
  });

  it("shows the full-size image, name and price of every product", () => {
    renderGrid(products);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    // the thumbnail is too small for the card; the full image keeps it sharp
    expect(screen.getByRole("img", { name: "4K Dash Cam" })).toHaveAttribute("src", "/api/uploads/a.webp");
    expect(screen.getByText("QAR 499.00")).toBeInTheDocument();
    expect(screen.getByText("Price on request")).toBeInTheDocument();
    expect(screen.getByText("3 products")).toBeInTheDocument();
  });

  it("filters by name or description as you type", async () => {
    renderGrid(products);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search products" }), "rear");
    expect(names()).toEqual(["4K Dash Cam"]);
    await userEvent.clear(screen.getByRole("searchbox"));
    await userEvent.type(screen.getByRole("searchbox"), "zzz");
    expect(screen.getByText("No products match your search.")).toBeInTheDocument();
  });

  it("sorts by price either way, with unpriced products last", async () => {
    renderGrid(products);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "priceAsc");
    expect(names()).toEqual(["3D Floor Mats", "4K Dash Cam", "Phone Holder"]);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "priceDesc");
    expect(names()).toEqual(["4K Dash Cam", "3D Floor Mats", "Phone Holder"]);
  });

  it("adds to the cart and turns the button into a quantity stepper", async () => {
    renderGrid(products);
    const card = screen.getByRole("heading", { name: "3D Floor Mats" }).closest("li")!;
    await userEvent.click(within(card).getByRole("button", { name: "Add to cart" }));
    const stepper = within(card).getByRole("group", { name: "Quantity of 3D Floor Mats" });
    await userEvent.click(within(stepper).getByRole("button", { name: "Increase quantity" }));
    expect(stepper).toHaveTextContent("2");
    await userEvent.click(within(stepper).getByRole("button", { name: "Decrease quantity" }));
    await userEvent.click(within(stepper).getByRole("button", { name: "Decrease quantity" }));
    expect(within(card).getByRole("button", { name: "Add to cart" })).toBeInTheDocument();
  });

  it("renders a page at a time with a show-more button", async () => {
    renderGrid(Array.from({ length: 30 }, (_, i) => product(`p${i}`, `Part ${String(i).padStart(2, "0")}`, "10.00")));
    expect(screen.getAllByRole("listitem")).toHaveLength(24);
    await userEvent.click(screen.getByRole("button", { name: "Show more (6 left)" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(30);
    expect(screen.queryByRole("button", { name: /Show more/ })).not.toBeInTheDocument();
  });

  it("loads the next page by itself when the visitor scrolls near the end", () => {
    let seen: (entries: Partial<IntersectionObserverEntry>[]) => void = () => {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof seen) {
          seen = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    renderGrid(Array.from({ length: 30 }, (_, i) => product(`p${i}`, `Part ${String(i).padStart(2, "0")}`, "10.00")));
    expect(screen.getAllByRole("listitem")).toHaveLength(24);
    act(() => seen([{ isIntersecting: true }]));
    expect(screen.getAllByRole("listitem")).toHaveLength(30);
    expect(screen.queryByRole("button", { name: /Show more/ })).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("shows the colours of one product as one card and adds the picked colour", async () => {
    const colour = (id: string, label: string): PublicProduct => ({
      ...product(id, `Arm rest (${label})`, "99.00"),
      groupId: "2406",
      variantLabel: label,
      variantColor: "#060505",
    });
    renderGrid([colour("black", "Black"), colour("beige", "Beige"), product("b", "3D Floor Mats", "120.50")]);
    expect(names()).toEqual(["Arm rest", "3D Floor Mats"]);
    expect(screen.getByText("2 products")).toBeInTheDocument();

    const card = screen.getByRole("heading", { name: "Arm rest" }).closest("li")!;
    const picker = within(card).getByRole("radiogroup", { name: "Colour" });
    expect(within(picker).getByRole("radio", { name: "Black" })).toBeChecked();
    await userEvent.click(within(picker).getByRole("radio", { name: "Beige" }));
    await userEvent.click(within(card).getByRole("button", { name: "Add to cart" }));
    expect(within(card).getByRole("group", { name: "Quantity of Arm rest (Beige)" })).toHaveTextContent("1");

    // the other colour is a separate line with its own quantity
    await userEvent.click(within(picker).getByRole("radio", { name: "Black" }));
    expect(within(card).getByRole("button", { name: "Add to cart" })).toBeInTheDocument();
  });

  it("has an empty state", () => {
    renderGrid([]);
    expect(screen.getByText("No products to show yet.")).toBeInTheDocument();
  });
});
