import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { server } from "@/tests/msw";
import { renderOnSite } from "@/tests/render-site";
import { customer, setCustomerHint } from "@/tests/shop-fixtures";
import { YourCars } from "./your-cars";

const L8 = "00000000-0000-4000-8000-000000000008";
const L5 = "00000000-0000-4000-8000-000000000005";

afterEach(() => setCustomerHint(false));

function signedIn(cars: unknown[]) {
  setCustomerHint(true);
  server.use(
    http.get("/api/shop/me", () => HttpResponse.json(customer())),
    http.get("/api/shop/me/cars", () => HttpResponse.json(cars)),
  );
}

describe("catalogue: your cars first", () => {
  it("puts the signed-in customer's cars at the top, each a link to its parts", async () => {
    signedIn([
      { id: L8, name: "ليوبارد 8", nameEn: "Leopard 8", thumbUrl: null },
      { id: L5, name: "ليوبارد 5", nameEn: null, thumbUrl: null },
    ]);
    renderOnSite(<YourCars enabled selected={L8} />);
    expect(await screen.findByText("Your cars")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Leopard 8" })).toHaveAttribute("href", `/products?category=${L8}`);
    expect(screen.getByRole("link", { name: "Leopard 8" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "ليوبارد 5" })).not.toHaveAttribute("aria-current");
  });

  it("asks a signed-in customer without cars to add one", async () => {
    signedIn([]);
    renderOnSite(<YourCars enabled />);
    expect(await screen.findByRole("link", { name: "Add your car to see its parts first" })).toHaveAttribute("href", "/account");
  });

  it("shows nothing to a visitor who is not signed in, or while card checkout is off", async () => {
    const { container, unmount } = renderOnSite(<YourCars enabled />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
    unmount();
    signedIn([{ id: L8, name: "ليوبارد 8", nameEn: "Leopard 8", thumbUrl: null }]);
    const off = renderOnSite(<YourCars enabled={false} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(off.container).toBeEmptyDOMElement();
  });
});
