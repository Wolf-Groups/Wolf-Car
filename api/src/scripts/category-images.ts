import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '../generated/prisma/client';
import { CATEGORY_IMAGES_DIR, categoryImage } from '../odoo/category-image';
import { legacyCategoryKey } from '../odoo/odoo-rows';
import { deleteStoredImage, processAndStoreImage } from '../uploads/image-processing';

export interface CategoryImageChange {
  /** the file in the folder, e.g. tank300.jpg */
  file: string;
  /** its name without the extension: the category key it is for */
  key: string;
  /** the category it was applied to; null when no category has that key */
  category: { id: string; name: string } | null;
  oldImageKey: string | null;
  /** the stored image's key; null in a dry run or without a category */
  newImageKey: string | null;
}

export interface ApplyOptions {
  /** the folder of photos and logos (default: prisma/category-images) */
  dir?: string;
  uploadDir: string;
  /** report what would happen, write nothing */
  dryRun?: boolean;
  log?: (line: string) => void;
}

const IMAGE_FILE = /^(.+)\.(jpe?g|webp|png)$/i;

/**
 * One-off, after photos are added to the repository: the sync gives a
 * category its image only once, so categories that already have a tile keep
 * it. This gives every category whose key matches a file in the folder that
 * file's image (a photo as it is, a logo on a tile), the way the sync would
 * for a new category, and removes the image it had. One row per file, in name
 * order; a file no category matches is reported with `category: null`.
 */
export async function applyCategoryImages(
  prisma: PrismaClient,
  { dir = CATEGORY_IMAGES_DIR, uploadDir, dryRun = false, log = () => undefined }: ApplyOptions,
): Promise<CategoryImageChange[]> {
  const files = (await readdir(dir)).filter((f) => IMAGE_FILE.test(f)).sort();
  const categories = await prisma.category.findMany({
    select: { id: true, name: true, nameEn: true, imageKey: true },
    orderBy: { position: 'asc' },
  });
  const changes: CategoryImageChange[] = [];
  for (const file of files) {
    const key = (IMAGE_FILE.exec(file) as RegExpExecArray)[1].toLowerCase();
    const matching = categories.filter((c) => legacyCategoryKey(c.nameEn ?? c.name) === key);
    if (!matching.length) {
      log(`${file}: no category with the key "${key}"`);
      changes.push({ file, key, category: null, oldImageKey: null, newImageKey: null });
      continue;
    }
    for (const c of matching) {
      const name = c.nameEn ?? c.name;
      const change: CategoryImageChange = {
        file,
        key,
        category: { id: c.id, name },
        oldImageKey: c.imageKey,
        newImageKey: null,
      };
      if (!dryRun) {
        // by the category's own name, so a logo tile carries it; same key, same file
        change.newImageKey = await processAndStoreImage(await categoryImage(name, dir), uploadDir);
        await prisma.category.update({
          where: { id: c.id },
          data: { imageKey: change.newImageKey },
        });
        if (c.imageKey) await deleteStoredImage(c.imageKey, uploadDir);
      }
      log(`${file}: ${dryRun ? 'would replace' : 'replaced'} the image of "${name}" (${c.id})`);
      changes.push(change);
    }
  }
  return changes;
}

/** For the command line: `--dry-run` and an optional folder. */
export function parseArgs(argv: readonly string[]): { dryRun: boolean; dir?: string } {
  const dryRun = argv.includes('--dry-run');
  const dir = argv.find((a) => !a.startsWith('--'));
  return { dryRun, ...(dir ? { dir: path.resolve(dir) } : {}) };
}
