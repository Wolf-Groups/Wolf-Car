import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import type { CustomerCar, PublicCategory } from "@/lib/api/types";
import { server } from "@/tests/msw";
import { renderOnSite } from "@/tests/render-site";
import { apiError } from "@/tests/shop-fixtures";
import { MyCars } from "./my-cars";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const car = (n: number, nameEn: string): CustomerCar => ({ id: id(n), name: `سيارة ${n}`, nameEn, thumbUrl: null });
const model = (n: number, nameEn: string, isCar = true): PublicCategory => ({ id: id(n), name: `سيارة ${n}`, nameEn, carModel: null, isCar, imageUrl: null, thumbUrl: null, count: 10 });
const MODELS = [model(8, "Leopard 8"), model(5, "Leopard 5"), model(1, "Thabt"), model(2, "Tank 300"), model(3, "Tank 500"), model(4, "Jetour T2"), model(9, "Genuine Parts", false)];

function api(saved: CustomerCar[]) {
  const puts: unknown[] = [];
  server.use(
    http.get("/api/shop/me/cars", () => HttpResponse.json(saved)),
    http.get("/api/public/categories", () => HttpResponse.json(MODELS)),
    http.put("/api/shop/me/cars", async ({ request }) => {
      const body = (await request.json()) as { categoryIds: string[] };
      puts.push(body);
      return HttpResponse.json(body.categoryIds.map((cid) => car(Number(cid.slice(-2)), MODELS.find((m) => m.id === cid)!.nameEn!)));
    }),
  );
  return puts;
}

describe("my cars", () => {
  it("shows the saved cars, each a link to its parts", async () => {
    api([car(8, "Leopard 8")]);
    renderOnSite(<MyCars />);
    expect(await screen.findByRole("link", { name: "Leopard 8" })).toHaveAttribute("href", `/products?category=${id(8)}`);
  });

  it("invites to add a car when there is none, and saves the ones picked in order", async () => {
    const puts = api([]);
    const { user } = renderOnSite(<MyCars />);
    expect(await screen.findByText("You haven't added a car yet.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add your car" }));
    const picker = await screen.findByRole("group", { name: "Choose up to 5 cars" });
    await user.click(within(picker).getByRole("button", { name: "Leopard 5" }));
    await user.click(within(picker).getByRole("button", { name: "Leopard 8" }));
    expect(within(picker).getByRole("button", { name: "Leopard 5" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("link", { name: "Leopard 5" })).toBeInTheDocument();
    expect(puts).toEqual([{ categoryIds: [id(5), id(8)] }]);
  });

  it("offers only car models, not parts or services", async () => {
    api([]);
    const { user } = renderOnSite(<MyCars />);
    await user.click(await screen.findByRole("button", { name: "Add your car" }));
    const picker = await screen.findByRole("group", { name: "Choose up to 5 cars" });
    expect(within(picker).getByRole("button", { name: "Tank 300" })).toBeInTheDocument();
    expect(within(picker).queryByRole("button", { name: "Genuine Parts" })).not.toBeInTheDocument();
  });

  it("allows five cars at most", async () => {
    api([]);
    const { user } = renderOnSite(<MyCars />);
    await user.click(await screen.findByRole("button", { name: "Add your car" }));
    const picker = await screen.findByRole("group", { name: "Choose up to 5 cars" });
    for (const name of ["Leopard 8", "Leopard 5", "Thabt", "Tank 300", "Tank 500"]) await user.click(within(picker).getByRole("button", { name }));
    expect(within(picker).getByRole("button", { name: "Jetour T2" })).toBeDisabled();
  });

  it("keeps the picker open with a message when saving fails", async () => {
    api([]);
    server.use(http.put("/api/shop/me/cars", () => apiError(500, "INTERNAL")));
    const { user } = renderOnSite(<MyCars />);
    await user.click(await screen.findByRole("button", { name: "Add your car" }));
    await user.click(within(await screen.findByRole("group")).getByRole("button", { name: "Thabt" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("We couldn't save your cars. Please try again.")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Choose up to 5 cars" })).toBeInTheDocument();
  });
});
