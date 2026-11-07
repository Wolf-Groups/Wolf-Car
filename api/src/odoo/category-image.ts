import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { legacyCategoryKey } from './odoo-rows';

const WIDTH = 1200;
const HEIGHT = 800;
/** the site's charcoal, so the tile sits naturally on the dark model banner */
const CHARCOAL = '#161616';
const ACCENT = '#c94a12';

/**
 * Where the repository keeps a photo or logo per category, named by
 * legacyCategoryKey: `tank300.jpg` is the tab image itself, `thabt.png` a
 * logo placed on a dark tile. Relative to the API's working directory, which
 * is `api/` both in development and in the container.
 */
export const CATEGORY_IMAGES_DIR = path.resolve('prisma/category-images');
const PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'webp'] as const;
const LOGO_EXTENSION = 'png';

export interface CategoryImageFile {
  /** a photo is used as it is; a logo goes on a tile */
  kind: 'photo' | 'logo';
  /** the file's name inside the folder */
  file: string;
  data: Buffer;
}

const escapeXml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * A tab image for a category that has no car photo: the brand's logo on a
 * dark tile when one is supplied (several logos are white), else its name.
 */
export async function categoryTile({ label, logo }: { label: string; logo?: Buffer }): Promise<Buffer> {
  const size = label.length > 12 ? 96 : 132;
  const text = logo
    ? ''
    : `<rect x="540" y="486" width="120" height="10" rx="5" fill="${ACCENT}"/>
       <text x="600" y="430" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="700"
         fill="#ffffff" text-anchor="middle">${escapeXml(label)}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <rect width="${WIDTH}" height="${HEIGHT}" rx="56" fill="${CHARCOAL}"/>${text}
  </svg>`;
  const tile = sharp(Buffer.from(svg));
  if (!logo) return tile.png().toBuffer();
  const fitted = await sharp(logo).resize({ width: 820, height: 480, fit: 'inside' }).png().toBuffer();
  return tile.composite([{ input: fitted, gravity: 'centre' }]).png().toBuffer();
}

/**
 * The file the repository keeps for a category, found by the same key that
 * matches an Odoo category to the old catalogue's car. A photo wins over a
 * logo when both exist. Undefined when there is none, or no folder.
 */
export async function categoryImageFile(
  name: string,
  dir: string = CATEGORY_IMAGES_DIR,
): Promise<CategoryImageFile | undefined> {
  const key = legacyCategoryKey(name);
  const candidates: [CategoryImageFile['kind'], string][] = [
    ...PHOTO_EXTENSIONS.map((ext): [CategoryImageFile['kind'], string] => [
      'photo',
      `${key}.${ext}`,
    ]),
    ['logo', `${key}.${LOGO_EXTENSION}`],
  ];
  for (const [kind, file] of candidates) {
    try {
      return { kind, file, data: await readFile(path.join(dir, file)) };
    } catch {
      /* not this one */
    }
  }
  return undefined;
}

/**
 * The image to store for a category's tab: its photo from the repository,
 * else its logo on a dark tile, else a tile with its name.
 */
export async function categoryImage(
  name: string,
  dir: string = CATEGORY_IMAGES_DIR,
): Promise<Buffer> {
  const found = await categoryImageFile(name, dir);
  if (found?.kind === 'photo') return found.data;
  return categoryTile({ label: name, logo: found?.data });
}
