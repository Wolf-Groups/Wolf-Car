# Odoo as the product catalogue — design

Date: 2026-10-07 · Status: awaiting review

## Goal

The products imported from the old Supabase catalogue are not correct. The
company's Odoo holds the right products and prices. This change makes Odoo the
source of the app's catalogue:

1. The old products are **hidden, not deleted**.
2. Products are **imported from Odoo** (name, barcode, price, image, category).
3. The result is shown **on a local machine first**, so the accountant can
   compare it with Odoo before anything reaches wolfcar.qa.

Success: the accountant opens the local showroom and dashboard, picks products
at random, and finds the same name, barcode and price as in Odoo.

## Decisions already made

| Topic | Decision |
|---|---|
| Old products | Kept in the database, switched off. Past orders keep pointing at them. |
| Source | Odoo 19 Enterprise. Test copy: `https://erp-test.wolf-groups.com`, database `wolf_group_test_db`. |
| Price 0 or 1 | **Not imported at all.** These are placeholders in Odoo. |
| Services and expenses | Expenses are not imported. Services are, once they have a real price (owner, 2026-10-24: the Software category showed one product while Odoo held all of them as services). |
| Where it runs first | Local database only. Production is not touched by this work. |
| How it runs | A command run by hand. No scheduled or automatic sync yet. |
| Direction | Read only. The app never writes to Odoo. |

## What the probe found (2026-10-07, test database)

- 1,043 products, 1,278 with variants. All QAR, one company.
- Barcodes sit on variants: 1,197 have one, none is repeated.
- 594 of 1,043 products have an image.
- 118 products are priced 0 or 1.
- Fewer than half have an Arabic name; the rest are English only.
- 40 categories, mostly by car: `Car / LEOPARD / LEOPARD 5`, `Car / TANK / TANK 500`, …
- The old `/jsonrpc` endpoint works with an API key. `/json/2` did not answer on
  the first server tried and has not been retried on the test server.

## Data model

One migration on `Product` and `Category`:

| Change | Why |
|---|---|
| `Product.isActive Boolean @default(true)` | The "hidden" switch. Same name as `Category.isActive`. |
| `Product.odooId Int? @unique` | The Odoo variant id (`product.product`). Re-running the import updates rows instead of duplicating them. |
| `Category.odooId Int? @unique` | The Odoo category id (`product.category`). |

The migration only adds columns. It hides nothing; hiding is done by the import
command, so deploying the migration alone changes nothing a user can see.

## What is imported

One app product per Odoo **variant** (`product.product`), because the barcode
and the final price live there.

A variant is imported when all of these hold:

- it is active and `sale_ok` (goods and services alike)
- its category is not `Expenses`
- its sales price (`lst_price`) is greater than 1

Field mapping:

| App | Odoo |
|---|---|
| `odooId` | `id` |
| `name` | `display_name` read in Arabic (`ar_001`) without the internal reference, so a variant reads `ARM REST COVER (Black)`. Odoo returns English where no Arabic exists. Cut to 120 characters. |
| `barcode` | `barcode` |
| `price` | `lst_price` |
| `imageKey` | `image_1920`, passed through the existing `processAndStoreImage`. A generated placeholder when Odoo has none. |
| `categoryId` | the variant's `categ_id` |

Categories: each Odoo category that has at least one imported product becomes
an app category keyed on `odooId`. Its name is the last part of the Odoo path
(`Car / LEOPARD / LEOPARD 5` → `LEOPARD 5`). New categories have no hero image;
one can be added in the dashboard later.

Imported products are attributed to an inactive `system.odoo` user, as the
legacy import does with `system.import`, and are appended to each active
branch's showroom order.

## The command

`npm run db:import-odoo -- [--hide-legacy] [--dry-run] [--force-images]`

- Reads `ODOO_URL`, `ODOO_DB`, `ODOO_LOGIN`, `ODOO_API_KEY` from `api/.env`.
- `--dry-run` prints what would be created, updated and skipped, and writes nothing.
- `--hide-legacy` sets `isActive = false` on every product without an `odooId`,
  and on every category left with no active product.
- A product that came from Odoo earlier but no longer qualifies (archived, or
  repriced to 0 or 1) is set inactive. Nothing is ever deleted.
- A price change is written to `PriceHistory`, as a dashboard edit would be.
- Images are fetched only when a product is first created. `--force-images`
  fetches them again for every product, which is how a product that started
  with a placeholder picks up an image added in Odoo later.
- Ends with a summary: created, updated, hidden, skipped with the reason.

Undo: `UPDATE products SET is_active = true WHERE odoo_id IS NULL` brings the
old catalogue back.

## Code layout

| File | Purpose |
|---|---|
| `api/src/odoo/odoo-client.ts` | Authenticates and calls `search_read`. The only file that knows the Odoo wire format. |
| `api/src/odoo/odoo-rows.ts` | Pure functions: which variants qualify, and Odoo row → app product. Mirrors `legacy-import/legacy-rows.ts`. |
| `api/prisma/import-odoo.ts` | The command. Mirrors `prisma/import-legacy.ts`. |
| `api/.env.example` | Documents the four `ODOO_*` variables. The command reads them itself, as the legacy import reads `DATABASE_URL`; the API server does not need them. |

## Where the hidden switch applies

- **Showroom** (`showroom.service.ts`): listing and order placement require `isActive`.
- **Public website** (`public-catalog.service.ts`): products and the "category has products" check require `isActive`.
- **Dashboard** (`products.service.ts`): the list shows active products only.
  The API accepts `visibility=hidden` or `visibility=all`; a dashboard control
  for it is not part of this change. A hidden product can still be opened by id.
- **Reordering a branch's showroom**: the list sent by the dashboard holds the
  active products; hidden ones keep their place after them.
- **Orders and receipts**: unchanged. They read the name and price stored on the order.

## Missing images

The app keeps requiring an image for every product. A product whose Odoo
record has none gets a generated neutral placeholder file of its own, so no
screen needs to change and replacing it later in the dashboard works as for
any other product.

## Errors

- Odoo unreachable or the key rejected: the command stops before writing anything.
- One image fails to process: the product is imported with the placeholder and listed in the summary.
- All database writes for products run after the Odoo read has fully succeeded,
  so a failure halfway through reading leaves the catalogue as it was.

## Testing

- Unit tests for `odoo-rows.ts`: the qualifying rules (price 0, 1, 1.01; a priced
  service; Expenses; not `sale_ok`), the name choice, the category name.
- Unit test for `odoo-client.ts` against a stubbed `fetch`.
- e2e: a hidden product is absent from the showroom and public catalogue,
  cannot be ordered, and is still shown on an existing order.
- e2e: reordering with a hidden product in the branch succeeds.

## Not in this change

- Running against production, or against the real Odoo database.
- Automatic or scheduled sync.
- Making dashboard price editing read-only.
- Linking old products to Odoo products.
- A dashboard control to list or un-hide hidden products.
