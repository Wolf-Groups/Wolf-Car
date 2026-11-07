import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderOnSite } from "@/tests/render-site";
import { webOrder } from "@/tests/shop-fixtures";
import { OrderLines } from "./order-lines";

describe("order lines", () => {
  it("reads each product name in its own script's direction, inside the page's row", () => {
    const order = webOrder({
      items: [
        { productId: "p-grille", productName: "G700 جيتور - شبك امامي", unitPrice: "499.00", quantity: 1, lineTotal: "499.00", thumbUrl: "/api/uploads/g-sm.webp" },
        { productId: "p-mats", productName: "3D Floor Mats", unitPrice: "120.50", quantity: 1, lineTotal: "120.50", thumbUrl: "/api/uploads/m-sm.webp" },
      ],
    });
    renderOnSite(<OrderLines items={order.items} total={order.total} currency={order.currency} />, { locale: "ar" });

    // "G700" reads first in Arabic; an English name stays left to right
    expect(screen.getByText("G700 جيتور - شبك امامي").closest("bdi")).toHaveAttribute("dir", "rtl");
    expect(screen.getByText("3D Floor Mats").closest("bdi")).toHaveAttribute("dir", "ltr");
  });
});
