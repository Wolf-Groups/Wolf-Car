/**
 * Gives the existing categories the photos and logos kept in
 * prisma/category-images (the sync only does that for a new category).
 * Replaces the image of every category whose key matches a file there.
 *
 *   docker compose -f compose.prod.yml --env-file deploy/prod.env \
 *     exec api node dist/api/src/scripts/category-images.cli.js [--dry-run] [folder]
 */
import 'reflect-metadata';
import { PrismaClient } from '../generated/prisma/client';
import { createPgAdapter } from '../prisma/pg-adapter';
import { applyCategoryImages, parseArgs } from './category-images';

async function main(): Promise<void> {
  const { dryRun, dir } = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  const uploadDir = process.env.UPLOAD_DIR;
  if (!url || !uploadDir) {
    console.error('DATABASE_URL and UPLOAD_DIR must be set.');
    process.exit(1);
  }
  const prisma = new PrismaClient({ adapter: createPgAdapter(url) });
  try {
    const changes = await applyCategoryImages(prisma, { dir, uploadDir, dryRun, log: console.log });
    console.table(
      changes.map((c) => ({
        file: c.file,
        category: c.category
          ? `${c.category.name} (${c.category.id.slice(0, 8)})`
          : '— no category —',
        'old image': c.oldImageKey ?? '—',
        'new image': c.newImageKey ?? (dryRun && c.category ? '(dry run)' : '—'),
      })),
    );
    const applied = changes.filter((c) => c.category).length;
    console.log(
      dryRun
        ? `${applied} categor${applied === 1 ? 'y' : 'ies'} would get a new image; nothing changed.`
        : `${applied} categor${applied === 1 ? 'y' : 'ies'} got a new image.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
