/**
 * Fills the catalogue from the company's Odoo.
 *
 *   npm run db:import-odoo -- [--dry-run] [--hide-legacy] [--force-images]
 *
 * Read-only towards Odoo, and it never deletes anything here. Products are
 * keyed on the Odoo variant id, so re-running updates rows instead of
 * duplicating them. A product that Odoo no longer offers (archived, or
 * repriced to 0 or 1) is switched off, not removed.
 *
 *   --dry-run       show what would happen, write nothing
 *   --hide-legacy   switch off every product that did not come from Odoo
 *   --force-images  fetch every image again, not only for new products
 */
import path from 'node:path';
import { PrismaClient } from '../src/generated/prisma/client';
import { OdooClient, odooConfigFromEnv } from '../src/odoo/odoo-client';
import { syncOdooCatalogue } from '../src/odoo/odoo-sync';
import { createPgAdapter } from '../src/prisma/pg-adapter';

try {
  process.loadEnvFile('.env');
} catch {
  /* env comes from the process */
}

const hasFlag = (name: string) => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const dryRun = hasFlag('dry-run');
  const config = odooConfigFromEnv(process.env);
  console.log(`Reading products from ${config.url} (database ${config.db})`);

  const prisma = new PrismaClient({ adapter: createPgAdapter(url) });
  try {
    const s = await syncOdooCatalogue(prisma, new OdooClient(config), {
      uploadDir: path.resolve(process.env.UPLOAD_DIR ?? './storage/uploads'),
      dryRun,
      hideLegacy: hasFlag('hide-legacy'),
      forceImages: hasFlag('force-images'),
      log: (line) => console.log(line),
    });
    console.log(
      `Odoo has ${s.variants} variants: ${s.imported} to import, ${s.variants - s.imported} left out`,
    );
    for (const [reason, n] of Object.entries(s.skipped).sort((a, b) => b[1] - a[1]))
      console.log(`  - ${n} ${reason}`);
    if (dryRun) console.log('\nDry run — nothing was written. It would:');
    console.log(
      `Products: ${s.created} created, ${s.updated} updated (${s.repriced} repriced), ${s.unchanged} unchanged, ${s.restocked} restocked`,
    );
    console.log(`Images fetched from Odoo: ${s.imagesFetched}`);
    console.log(`Switched off ${s.switchedOff} products Odoo no longer offers`);
    if (s.hiddenLegacy)
      console.log(`Hidden: ${s.hiddenLegacy} products that did not come from Odoo`);
    if (s.warnings.length) {
      console.log(`\n${s.warnings.length} warning(s):`);
      for (const w of s.warnings.slice(0, 40)) console.log(`  - ${w}`);
      if (s.warnings.length > 40) console.log(`  …and ${s.warnings.length - 40} more`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error((err as Error).message ?? err);
  process.exit(1);
});
