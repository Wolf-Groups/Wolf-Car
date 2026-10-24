import { describe, expect, it } from "vitest";
import type { ShowroomProduct } from "@/lib/api/types";
import { filterProducts, normalize, PRICE_RANGES } from "./filter";

const product = (over: Partial<ShowroomProduct>): ShowroomProduct => ({
  id: "p",
  name: "Product",
  description: null,
  barcode: null,
  categoryId: null,
  price: "10.00",
  imageUrl: "",
  thumbUrl: "",
  ...over,
});

const MAT = product({ id: "mat", name: "دعّاسات أرضية", description: "Floor mats", barcode: "FM-200", price: "350.00" });
const CLIP = product({ id: "clip", name: "Trim clip", price: "0.10" });
const RACK = product({ id: "rack", name: "Roof rack", description: "حامل سقف", price: "1200.00" });
const ALL = [MAT, CLIP, RACK];

const ids = (products: ShowroomProduct[]) => products.map((p) => p.id);
const NONE = { query: "", sort: "default", range: null } as const;

describe("normalize", () => {
  it("ignores case, Arabic diacritics and the letter forms people type interchangeably", () => {
    expect(normalize("  ROOF Rack ")).toBe("roof rack");
    expect(normalize("دعّاسات")).toBe("دعاسات");
    expect(normalize("أرضية")).toBe(normalize("ارضيه"));
    expect(normalize("مصطفى")).toBe(normalize("مصطفي"));
    expect(normalize("١٢٣")).toBe("123");
  });
});

describe("filterProducts", () => {
  it("returns everything in the given order when nothing is set", () => {
    expect(ids(filterProducts(ALL, NONE))).toEqual(["mat", "clip", "rack"]);
  });

  it("searches the name, the description and the barcode", () => {
    expect(ids(filterProducts(ALL, { ...NONE, query: "roof" }))).toEqual(["rack"]);
    expect(ids(filterProducts(ALL, { ...NONE, query: "floor" }))).toEqual(["mat"]);
    expect(ids(filterProducts(ALL, { ...NONE, query: "fm-200" }))).toEqual(["mat"]);
    expect(ids(filterProducts(ALL, { ...NONE, query: "دعاسات ارضيه" }))).toEqual(["mat"]);
  });

  it("finds a car's products by the car's name, alongside words from the product", () => {
    const cars = new Map([["tank", "تانك 500 Tank 500"]]);
    const mat = { ...MAT, categoryId: "tank", categoryIds: ["tank"] };
    expect(ids(filterProducts([mat, CLIP, RACK], { ...NONE, query: "tank" }, cars))).toEqual(["mat"]);
    expect(ids(filterProducts([mat, CLIP, RACK], { ...NONE, query: "تانك floor" }, cars))).toEqual(["mat"]);
    expect(ids(filterProducts([mat, CLIP, RACK], { ...NONE, query: "tank roof" }, cars))).toEqual([]);
  });

  it("matches every word, in any order", () => {
    expect(ids(filterProducts(ALL, { ...NONE, query: "rack roof" }))).toEqual(["rack"]);
    expect(ids(filterProducts(ALL, { ...NONE, query: "roof clip" }))).toEqual([]);
  });

  it("keeps a price range's lower bound and leaves out its upper bound", () => {
    const [under100, to500, , over1000] = PRICE_RANGES;
    expect(ids(filterProducts(ALL, { ...NONE, range: under100.id }))).toEqual(["clip"]);
    expect(ids(filterProducts(ALL, { ...NONE, range: to500.id }))).toEqual(["mat"]);
    expect(ids(filterProducts(ALL, { ...NONE, range: over1000.id }))).toEqual(["rack"]);
    expect(ids(filterProducts([product({ id: "edge", price: "100.00" })], { ...NONE, range: under100.id }))).toEqual([]);
    expect(ids(filterProducts([product({ id: "edge", price: "100.00" })], { ...NONE, range: to500.id }))).toEqual(["edge"]);
  });

  it("sorts by price without touching the list it was given", () => {
    expect(ids(filterProducts(ALL, { ...NONE, sort: "priceAsc" }))).toEqual(["clip", "mat", "rack"]);
    expect(ids(filterProducts(ALL, { ...NONE, sort: "priceDesc" }))).toEqual(["rack", "mat", "clip"]);
    expect(ids(ALL)).toEqual(["mat", "clip", "rack"]);
  });
});

describe("out of stock", () => {
  it("comes last under every sort, the rest keeping their order", () => {
    const gone = { ...MAT, available: false };
    expect(ids(filterProducts([gone, CLIP, RACK], NONE))).toEqual(["clip", "rack", "mat"]);
    expect(ids(filterProducts([gone, CLIP, RACK], { ...NONE, sort: "priceDesc" }))).toEqual(["rack", "clip", "mat"]);
  });
});
