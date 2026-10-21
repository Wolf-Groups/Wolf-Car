-- How many of an Odoo product are free to sell, read from Odoo's stock by every sync.
ALTER TABLE "products" ADD COLUMN "odoo_stock" INTEGER;
