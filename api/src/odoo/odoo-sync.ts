/**
 * Brings the catalogue in line with the company's Odoo. Read-only towards
 * Odoo, and it never deletes anything here: products are keyed on the Odoo
 * variant id, and one Odoo no longer offers (archived, not for sale, or
 * repriced to 0 or 1) is switched off, not removed.
 *
 * Used by the scheduled sync, the dashboard's "Sync now" and the
 * `db:import-odoo` command.
 */
import { randomUUID } from 'node:crypto';
import { copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '../generated/prisma/client';
import { deleteStoredImage, processAndStoreImage } from '../uploads/image-processing';
import { categoryTile } from './category-image';
import {
  arabicCategoryName,
  categoryName,
  freeStock,
  legacyCategoryKey,
  parentCategoryOdooId,
  QUANT_FIELDS,
  skipReason,
  STOCK_DOMAIN,
  toProduct,
  VARIANT_FIELDS,
  type OdooAttributeValue,
  type OdooCategory,
  type OdooProduct,
  type OdooQuant,
  type OdooVariant,
} from './odoo-rows';
import { placeInBranch } from './place-in-branch';
import { placeholderImage } from './placeholder-image';

/** The two calls the sync makes; OdooClient implements it, tests fake it. */
export interface OdooReader {
  searchRead<T>(
    model: string,
    domain: unknown[],
    fields: readonly string[],
    context?: Record<string, unknown>,
  ): Promise<T[]>;
  read<T>(model: string, ids: number[], fields: readonly string[]): Promise<T[]>;
  /** when the API key stops working; null for one that never does */
  keyExpiresAt?(): Promise<Date | null>;
}

export interface SyncOptions {
  uploadDir: string;
  /** report what would happen, write nothing */
  dryRun?: boolean;
  /** also switch off every product that did not come from Odoo (the first switch-over only) */
  hideLegacy?: boolean;
  /** treat every product as changed and fetch its photo again */
  forceImages?: boolean;
  log?: (line: string) => void;
}

export interface SyncSummary {
  /** variants Odoo returned */
  variants: number;
  /** variants that belong in the catalogue */
  imported: number;
  /** why the rest were left out, with how many */
  skipped: Record<string, number>;
  created: number;
  updated: number;
  /** not touched, because Odoo has not changed them since the last run */
  unchanged: number;
  repriced: number;
  /** products whose free stock moved, including those that changed in no other way */
  restocked: number;
  switchedOff: number;
  imagesFetched: number;
  hiddenLegacy: number;
  warnings: string[];
}

const IMPORT_USERNAME = 'system.odoo';
const IMAGE_BATCH = 25;
/** Bump when the mapping in odoo-rows.ts changes, so every product is refreshed once. */
const MAPPING_VERSION = 'm1';

type SyncProduct = OdooProduct & {
  stamp: string;
  /** units free to sell; null when Odoo keeps no stock for it */
  stock: number | null;
};

export async function syncOdooCatalogue(
  prisma: PrismaClient,
  odoo: OdooReader,
  options: SyncOptions,
): Promise<SyncSummary> {
  const {
    uploadDir,
    dryRun = false,
    hideLegacy = false,
    forceImages = false,
    log = () => undefined,
  } = options;

  // ---- read everything from Odoo before touching the database --------------
  // archived variants are left out by Odoo itself; ar_001 gives the Arabic name
  // where one exists, and display_default_code drops the "[PROD-001]" prefix
  const variants = await odoo.searchRead<OdooVariant>('product.product', [], VARIANT_FIELDS, {
    lang: 'ar_001',
    display_default_code: false,
  });
  const summary: SyncSummary = {
    variants: variants.length,
    imported: 0,
    skipped: {},
    created: 0,
    updated: 0,
    unchanged: 0,
    repriced: 0,
    restocked: 0,
    switchedOff: 0,
    imagesFetched: 0,
    hiddenLegacy: 0,
    warnings: [],
  };
  const wantedVariants: OdooVariant[] = [];
  for (const v of variants) {
    const reason = skipReason(v);
    if (reason) summary.skipped[reason] = (summary.skipped[reason] ?? 0) + 1;
    else wantedVariants.push(v);
  }
  // the colour or size of each variant, and the category tree (which car belongs to which brand)
  const valueIds = [
    ...new Set(wantedVariants.flatMap((v) => v.product_template_variant_value_ids)),
  ];
  const values = new Map(
    (valueIds.length
      ? await odoo.read<OdooAttributeValue>('product.template.attribute.value', valueIds, [
          'name',
          'html_color',
        ])
      : []
    ).map((value) => [value.id, value]),
  );
  const odooCategories = new Map(
    (
      await odoo.searchRead<OdooCategory>('product.category', [], ['complete_name', 'parent_id'])
    ).map((c) => [c.id, c]),
  );
  // the name, category and photo live on the product (template), the barcode
  // and colour on the variant: a change to either makes the row worth re-reading
  const templateIds = [...new Set(wantedVariants.map((v) => v.product_tmpl_id[0]))];
  const templateDates = new Map(
    (templateIds.length
      ? await odoo.searchRead<{ id: number; write_date: string }>(
          'product.template',
          [['id', 'in', templateIds]],
          ['write_date'],
        )
      : []
    ).map((tmpl) => [tmpl.id, tmpl.write_date]),
  );
  // stock moves without touching the product's own dates, so it is read whole every run
  const stock = freeStock(
    await odoo.searchRead<OdooQuant>('stock.quant', [...STOCK_DOMAIN], QUANT_FIELDS),
  );
  const products: SyncProduct[] = wantedVariants.map((v) => ({
    ...toProduct(v, values.get(v.product_template_variant_value_ids[0])),
    stamp: `${v.write_date}|${templateDates.get(v.product_tmpl_id[0]) ?? ''}|${MAPPING_VERSION}`,
    stock: v.is_storable ? (stock.get(v.id) ?? 0) : null,
  }));
  summary.imported = products.length;

  const existing = new Map(
    (
      await prisma.product.findMany({
        where: { odooId: { not: null } },
        select: {
          id: true,
          odooId: true,
          imageKey: true,
          price: true,
          odooStamp: true,
          odooStock: true,
          isActive: true,
        },
      })
    ).map((p) => [p.odooId as number, p]),
  );
  const wanted = new Set(products.map((p) => p.odooId));
  const stale = [...existing.values()].filter((p) => !wanted.has(p.odooId as number));
  // services are kept here on purpose: they are not legacy and never hidden by a sync
  const legacyCount = await prisma.product.count({ where: { odooId: null, serviceId: null, isActive: true } });

  const changed = products.filter((p) => {
    const before = existing.get(p.odooId);
    return !before || !before.isActive || before.odooStamp !== p.stamp || forceImages;
  });
  summary.unchanged = products.length - changed.length;
  summary.switchedOff = stale.filter((p) => p.isActive).length;
  const restocked = products.filter((p) => {
    const before = existing.get(p.odooId);
    return before !== undefined && before.odooStock !== p.stock;
  });
  summary.restocked = restocked.length;

  if (dryRun) {
    summary.created = changed.filter((p) => !existing.has(p.odooId)).length;
    summary.updated = changed.length - summary.created;
    summary.hiddenLegacy = hideLegacy ? legacyCount : 0;
    return summary;
  }

  // ---- images (files only; still no database writes) ---------------------
  // a product is re-read from Odoo, photo included, only when Odoo says it changed
  const needImage = changed
    .filter((p) => {
      const before = existing.get(p.odooId);
      // a row from before stamps existed already has its photo: do not fetch 1,000 of them again
      return forceImages || !before || (before.odooStamp !== null && before.odooStamp !== p.stamp);
    })
    .map((p) => p.odooId);
  const imageKeys = new Map<number, string>();
  const placeholder = needImage.length ? await placeholderImage() : null;
  let withPhoto = 0;
  for (let i = 0; i < needImage.length; i += IMAGE_BATCH) {
    const ids = needImage.slice(i, i + IMAGE_BATCH);
    const rows = await odoo.read<{ id: number; image_1920: string | false }>(
      'product.product',
      ids,
      ['image_1920'],
    );
    const byId = new Map(rows.map((r) => [r.id, r.image_1920]));
    for (const id of ids) {
      const b64 = byId.get(id);
      let key: string | undefined;
      if (b64) {
        try {
          key = await processAndStoreImage(Buffer.from(b64, 'base64'), uploadDir);
          withPhoto++;
        } catch (err) {
          summary.warnings.push(
            `odoo ${id}: image could not be processed (${(err as Error).message}); placeholder used`,
          );
        }
      }
      imageKeys.set(id, key ?? (await processAndStoreImage(placeholder as Buffer, uploadDir)));
    }
    if (needImage.length > IMAGE_BATCH)
      log(`  images …${Math.min(i + IMAGE_BATCH, needImage.length)}/${needImage.length}`);
  }
  summary.imagesFetched = withPhoto;

  // ---- database ----------------------------------------------------------
  // the catalogue has to belong to someone: Product.createdById is required
  const importer = await prisma.user.upsert({
    where: { username: IMPORT_USERNAME },
    update: {},
    create: {
      username: IMPORT_USERNAME,
      displayName: 'Odoo catalogue import',
      role: 'SUPER_ADMIN',
      // no usable password hash: this account exists for attribution only
      passwordHash: 'x'.repeat(97),
      isActive: false,
    },
    select: { id: true },
  });

  // categories: created once, then left alone so a name or image set in the dashboard survives.
  // One for a car the old catalogue already had takes over that car's Arabic name and photo.
  const legacyByKey = new Map(
    (
      await prisma.category.findMany({
        where: { odooId: null, imageKey: { not: null } },
        select: { name: true, nameEn: true, carModel: true, imageKey: true },
      })
    ).map((c) => [legacyCategoryKey(c.nameEn ?? c.name), c]),
  );
  let adopted = 0;
  const categoryIdByOdoo = new Map<number, string>();
  const paths = new Map<number, string>();
  for (const p of products)
    if (p.categoryOdooId !== null && p.categoryPath) paths.set(p.categoryOdooId, p.categoryPath);
  let position =
    ((await prisma.category.aggregate({ _max: { position: true } }))._max.position ?? -1) + 1;
  for (const [odooId, categoryPath] of [...paths].sort((a, b) => a[1].localeCompare(b[1]))) {
    const found = await prisma.category.findUnique({
      where: { odooId },
      select: { id: true, imageKey: true },
    });
    const name = categoryName(categoryPath);
    const legacy = legacyByKey.get(legacyCategoryKey(name));
    if (legacy?.imageKey && !found?.imageKey) {
      const imageKey = await copyImage(legacy.imageKey, uploadDir);
      const data = {
        name: legacy.name,
        nameEn: legacy.nameEn ?? name,
        carModel: legacy.carModel,
        imageKey,
      };
      const saved = found
        ? await prisma.category.update({ where: { id: found.id }, data, select: { id: true } })
        : await prisma.category.create({
            data: { ...data, odooId, position: position++ },
            select: { id: true },
          });
      categoryIdByOdoo.set(odooId, saved.id);
      adopted++;
      continue;
    }
    const saved =
      found ??
      (await prisma.category.create({
        data: {
          odooId,
          name,
          nameEn: /[؀-ۿ]/.test(name) ? null : name,
          carModel: name,
          position: position++,
        },
        select: { id: true },
      }));
    categoryIdByOdoo.set(odooId, saved.id);
  }
  // brand links, Arabic names for the categories the old catalogue never had,
  // and an image for every tab: the brand's photo for a model without its
  // own, else a logo from prisma/category-images/<key>.png, else a name tile
  let models = 0;
  const parentOf = (odooId: number): string | null => {
    const source = odooCategories.get(odooId);
    const parentOdooId = source ? parentCategoryOdooId(source, odooCategories) : null;
    return parentOdooId === null ? null : (categoryIdByOdoo.get(parentOdooId) ?? null);
  };
  // a brand with models is never a tab, so it gets no tile: a model must
  // only ever inherit a real photo from it, not a tile with the brand's name
  const brands = new Set(
    [...categoryIdByOdoo.keys()].map(parentOf).filter((id): id is string => id !== null),
  );
  for (const [odooId, id] of categoryIdByOdoo) {
    const parentId = parentOf(odooId);
    const row = await prisma.category.findUniqueOrThrow({
      where: { id },
      select: { name: true, imageKey: true },
    });
    const odooName = categoryName(paths.get(odooId) as string);
    // only while the name is still Odoo's: one changed by hand is kept
    const arabic = row.name === odooName ? arabicCategoryName(odooName) : null;
    const parentImage =
      !row.imageKey && parentId
        ? (
            await prisma.category.findUniqueOrThrow({
              where: { id: parentId },
              select: { imageKey: true },
            })
          ).imageKey
        : null;
    await prisma.category.update({
      where: { id },
      data: {
        parentId,
        isActive: true,
        ...(arabic ? { name: arabic, carModel: arabic } : {}),
        ...(parentImage
          ? { imageKey: await copyImage(parentImage, uploadDir) }
          : !row.imageKey && !brands.has(id)
            ? {
                imageKey: await processAndStoreImage(
                  await categoryTile({ label: odooName, logo: await categoryLogo(odooName) }),
                  uploadDir,
                ),
              }
            : {}),
      },
    });
    if (parentId) models++;
  }
  const createdIds: string[] = [];
  const replacedImages: string[] = [];
  for (const p of changed) {
    for (const w of p.warnings) summary.warnings.push(`odoo ${p.odooId} (${p.name}): ${w}`);
    const categoryId =
      p.categoryOdooId === null ? null : (categoryIdByOdoo.get(p.categoryOdooId) ?? null);
    const before = existing.get(p.odooId);
    const newKey = imageKeys.get(p.odooId);

    if (!before) {
      const row = await prisma.product.create({
        data: {
          odooId: p.odooId,
          odooStamp: p.stamp,
          odooTemplateId: p.templateOdooId,
          odooStock: p.stock,
          variantLabel: p.variantLabel,
          variantColor: p.variantColor,
          name: p.name,
          barcode: p.barcode,
          categoryId,
          imageKey: newKey as string,
          price: p.price,
          priceUpdatedAt: new Date(),
          createdById: importer.id,
          priceHistory: { create: { oldPrice: null, newPrice: p.price, changedById: importer.id } },
        },
        select: { id: true },
      });
      createdIds.push(row.id);
      summary.created++;
    } else {
      const priceChanged = before.price === null || before.price.toFixed(2) !== p.price;
      await prisma.product.update({
        where: { id: before.id },
        data: {
          name: p.name,
          odooStamp: p.stamp,
          odooTemplateId: p.templateOdooId,
          variantLabel: p.variantLabel,
          variantColor: p.variantColor,
          barcode: p.barcode,
          categoryId,
          isActive: true,
          updatedById: importer.id,
          ...(newKey ? { imageKey: newKey } : {}),
          ...(priceChanged
            ? {
                price: p.price,
                priceUpdatedAt: new Date(),
                priceHistory: {
                  create: { oldPrice: before.price, newPrice: p.price, changedById: importer.id },
                },
              }
            : {}),
        },
      });
      if (newKey) replacedImages.push(before.imageKey);
      if (priceChanged) summary.repriced++;
      summary.updated++;
    }
  }
  for (const key of replacedImages) await deleteStoredImage(key, uploadDir);

  // one write per stock level, not per product: most runs move only a handful
  const byStock = new Map<number | null, number[]>();
  for (const p of restocked) byStock.set(p.stock, [...(byStock.get(p.stock) ?? []), p.odooId]);
  for (const [odooStock, odooIds] of byStock) {
    await prisma.product.updateMany({ where: { odooId: { in: odooIds } }, data: { odooStock } });
  }

  if (stale.length) {
    await prisma.product.updateMany({
      where: { id: { in: stale.map((p) => p.id) } },
      data: { isActive: false },
    });
  }

  if (hideLegacy) {
    summary.hiddenLegacy = (
      await prisma.product.updateMany({
        where: { odooId: null, serviceId: null, isActive: true },
        data: { isActive: false },
      })
    ).count;
  }
  // a tab with nothing left to show goes away; it comes back with its first product
  await prisma.category.updateMany({
    where: {
      isActive: true,
      products: { none: { isActive: true } },
      ...(hideLegacy ? {} : { odooId: { not: null } }),
    },
    data: { isActive: false },
  });

  if (createdIds.length) {
    const branches = await prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    for (const branch of branches) await placeInBranch(prisma, branch.id, createdIds);
  }
  return summary;
}

/** A logo kept in the repository for a category, e.g. prisma/category-images/thabt.png. */
async function categoryLogo(name: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path.resolve('prisma/category-images', `${legacyCategoryKey(name)}.png`));
  } catch {
    return undefined; // no logo for this one: it gets a name tile
  }
}

/** A copy of a stored image under a new key, so no two rows can remove each other's photo. */
async function copyImage(key: string, uploadDir: string): Promise<string> {
  const copy = randomUUID();
  for (const suffix of ['', '-sm']) {
    await copyFile(
      path.join(uploadDir, `${key}${suffix}.webp`),
      path.join(uploadDir, `${copy}${suffix}.webp`),
    );
  }
  return copy;
}
