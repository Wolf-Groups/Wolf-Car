import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/tests/msw";
import { makeUser, renderWithApp } from "@/tests/render";
import { finance, makeProduct, manager } from "./fixtures";
import { ProductsPage } from "./products-page";

const brake = makeProduct({ name: "Brake pads", price: "280.00", barcode: "BP-1", position: 0 });
const oil = makeProduct({ name: "Oil filter", price: null, position: 1 });
const mats = makeProduct({ name: "Floor mats", price: "320.00", position: 2 });

const names = () =>
  within(screen.getByRole("list", { name: "Products" }))
    .getAllByRole("listitem")
    .map((li) => li.querySelector("p")?.textContent);

/** jsdom has no layout: give every product row a stacked 90px box so dnd-kit can measure it. */
function stackRows() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const row = this.closest<HTMLElement>("li[data-product-id]");
    const index = row?.parentElement ? Array.from(row.parentElement.children).indexOf(row) : -1;
    const top = index >= 0 ? index * 100 : 0;
    const height = index >= 0 ? 90 : 0;
    const width = index >= 0 ? 800 : 0;
    return { x: 0, y: top, top, left: 0, right: width, bottom: top + height, width, height, toJSON: () => ({}) } as DOMRect;
  });
}

const tick = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

afterEach(() => window.history.replaceState(null, "", "/en/dashboard"));

describe("products page permissions", () => {
  it("shows a no-access state (and asks the API nothing) without product.read", async () => {
    const requested = vi.fn();
    server.use(http.get("/api/products", () => (requested(), HttpResponse.json([]))));
    renderWithApp(<ProductsPage />, { user: makeUser({ role: "CASHIER", permissions: ["order.read.branch"] }) });
    expect(await screen.findByRole("alert")).toHaveTextContent("You can't open this page");
    expect(requested).not.toHaveBeenCalled();
  });

  it("Finance can price but not add, edit or reorder", async () => {
    server.use(http.get("/api/products", () => HttpResponse.json([brake, oil])));
    renderWithApp(<ProductsPage />, { user: finance() });

    expect(await screen.findByRole("button", { name: "Set price" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change price" })).toBeInTheDocument();
    expect(screen.getByText("Set and adjust prices. Every change is recorded.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add product" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Reorder / })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Price history of / })).toHaveLength(2);
  });

  it("offers no price or edit button on a product that comes from Odoo", async () => {
    server.use(http.get("/api/products", () => HttpResponse.json([{ ...brake, fromOdoo: true }, oil])));
    const everything = makeUser({ permissions: ["product.read", "product.update.price", "product.update.details"] });
    renderWithApp(<ProductsPage />, { user: everything });

    expect(await screen.findByText("From Odoo")).toBeInTheDocument();
    // only the hand-made product can still be priced and edited here
    expect(screen.queryByRole("button", { name: "Change price" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set price" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Edit / })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^Price history of / })).toHaveLength(2);
  });

  it("shows how many of an Odoo product are in stock, and nothing for one Odoo does not count", async () => {
    server.use(
      http.get("/api/products", () =>
        HttpResponse.json([
          { ...brake, fromOdoo: true, stock: 12 },
          { ...oil, fromOdoo: true, stock: -1 },
          { ...mats, fromOdoo: true, stock: null },
        ]),
      ),
    );
    renderWithApp(<ProductsPage />, { user: finance() });

    expect(await screen.findByText("In stock: 12")).toBeInTheDocument();
    const list = within(screen.getByRole("list", { name: "Products" }));
    expect(list.getAllByText(/^(In stock|Out of stock)/)).toHaveLength(2);
    expect(list.getByText("Out of stock")).toBeInTheDocument();
  });

  it("a Branch Manager can add, edit and reorder but not price", async () => {
    server.use(http.get("/api/products", () => HttpResponse.json([brake, oil])));
    renderWithApp(<ProductsPage />, { user: manager() });

    expect(await screen.findByRole("button", { name: "Reorder Brake pads" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add product" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Oil filter" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Set price|Change price/ })).not.toBeInTheDocument();
    // prices are read-only for them, awaiting ones flagged
    expect(within(screen.getByRole("list", { name: "Products" })).getByText("Awaiting price")).toBeInTheDocument();
  });

  it("starts from ?price=unpriced and disables reordering while filtered", async () => {
    window.history.replaceState(null, "", "/en/dashboard/products?price=unpriced");
    const seen: string[] = [];
    server.use(
      http.get("/api/products", ({ request }) => {
        seen.push(new URL(request.url).search);
        return HttpResponse.json([oil]);
      }),
    );
    renderWithApp(<ProductsPage />, { user: manager() });

    expect(await screen.findByText("Clear the search and filters to reorder.")).toBeInTheDocument();
    expect(seen[0]).toBe("?price=unpriced");
    expect(screen.getByRole("button", { name: "Awaiting price" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /^Reorder / })).not.toBeInTheDocument();
  });
});

describe("car and stock filters", () => {
  it("asks the API for one car's products and for what is out of stock, and clears both", async () => {
    const seen: string[] = [];
    server.use(
      http.get("/api/public/categories", () =>
        HttpResponse.json([{ id: "cat-thabt", name: "ثابت", nameEn: "THABT", carModel: null, imageUrl: null, thumbUrl: null, count: 175 }]),
      ),
      http.get("/api/products", ({ request }) => {
        const search = new URL(request.url).search;
        seen.push(search);
        return HttpResponse.json(search === "" ? [brake, oil] : []);
      }),
    );
    const { user } = renderWithApp(<ProductsPage />, { user: finance() });
    expect(await screen.findByText("Brake pads")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Car or line" }));
    await user.click(await screen.findByRole("option", { name: "THABT (175)" }));
    await user.click(screen.getByRole("button", { name: "Out of stock" }));

    await waitFor(() => expect(seen.at(-1)).toBe("?categoryId=cat-thabt&stock=out"));
    await user.click(await screen.findByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(seen.at(-1)).toBe(""));
    expect(screen.getByRole("combobox", { name: "Car or line" })).toHaveTextContent("All cars and lines");
  });
});

describe("showroom order (drag and drop)", () => {
  beforeEach(stackRows);

  /** focus the first handle, Space, ArrowDown, Space */
  async function moveFirstDown({ user }: ReturnType<typeof renderWithApp>) {
    const handle = await screen.findByRole("button", { name: "Reorder Brake pads" });
    act(() => handle.focus());
    await user.keyboard(" ");
    await tick();
    await user.keyboard("{ArrowDown}");
    await tick();
    await user.keyboard(" ");
    await tick();
  }

  it("reorders with the keyboard and saves every id in the new order", async () => {
    let body: unknown = null;
    server.use(
      http.get("/api/products", () => HttpResponse.json([brake, oil, mats])),
      http.put("/api/products/order", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json([oil, brake, mats].map((p, i) => ({ ...p, position: i })));
      }),
    );
    const success = vi.spyOn(toast, "success");
    await moveFirstDown(renderWithApp(<ProductsPage />, { user: manager() }));

    await waitFor(() => expect(body).toEqual({ productIds: [oil.id, brake.id, mats.id] }));
    expect(names()).toEqual(["Oil filter", "Brake pads", "Floor mats"]);
    await waitFor(() => expect(success).toHaveBeenCalledWith("Showroom order saved"));
  });

  it("puts the list back when saving fails", async () => {
    let calls = 0;
    server.use(
      http.get("/api/products", () => HttpResponse.json([brake, oil, mats])),
      http.put("/api/products/order", () => {
        calls += 1;
        return HttpResponse.json({ statusCode: 400, error: "Bad Request", code: "ORDER_MISMATCH", message: "mismatch" }, { status: 400 });
      }),
    );
    const failure = vi.spyOn(toast, "error");
    await moveFirstDown(renderWithApp(<ProductsPage />, { user: manager() }));

    await waitFor(() => expect(calls).toBe(1));
    await waitFor(() => expect(names()).toEqual(["Brake pads", "Oil filter", "Floor mats"]));
    expect(failure).toHaveBeenCalledWith("Couldn't save the new order. It was reset.", {
      description: "The product list changed. Refresh and reorder again.",
    });
  });
});
