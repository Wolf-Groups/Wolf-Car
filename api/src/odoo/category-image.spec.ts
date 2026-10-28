import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { categoryImage, categoryImageFile, categoryTile } from './category-image';

const solid = (background: string, format: 'jpeg' | 'png' | 'webp' = 'jpeg') =>
  sharp({ create: { width: 300, height: 200, channels: 3, background } })[format]().toBuffer();

const centre = async (image: Buffer) => {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const at = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
  return [...data.subarray(at, at + 3)];
};

describe('categoryTile', () => {
  it('draws a name tile when there is no logo', async () => {
    const meta = await sharp(await categoryTile({ label: 'DINZA 5' })).metadata();
    expect(meta).toMatchObject({ format: 'png', width: 1200, height: 800 });
  });

  it('places a logo on a dark tile, so a white logo stays visible on a light page', async () => {
    const logo = await sharp({ create: { width: 600, height: 280, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
      .png()
      .toBuffer();
    const tile = sharp(await categoryTile({ label: 'THABT', logo }));
    expect(await tile.metadata()).toMatchObject({ width: 1200, height: 800 });
    const { data, info } = await tile.raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    expect(pixel(600, 400)).toEqual([255, 255, 255]); // the logo, centred
    expect(pixel(600, 60)).toEqual([22, 22, 22]); // the tile around it
  });

  it('escapes a name that contains markup characters', async () => {
    await expect(categoryTile({ label: 'A & B <C>' })).resolves.toBeInstanceOf(Buffer);
  });
});

describe('the images kept in the repository', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'wolfcar-category-images-'));
    await writeFile(path.join(dir, 'tank300.jpg'), await solid('#cc0000'));
    await writeFile(path.join(dir, 'dinza8.webp'), await solid('#0000cc', 'webp'));
    await writeFile(path.join(dir, 'services.jpeg'), await solid('#00cc00'));
    await writeFile(path.join(dir, 'wurth.png'), await solid('#ffffff', 'png'));
    // a photo and a logo for the same car: the photo wins
    await writeFile(path.join(dir, 'jetourt1.jpg'), await solid('#cc0000'));
    await writeFile(path.join(dir, 'jetourt1.png'), await solid('#ffffff', 'png'));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('finds a photo by the category key, whatever Odoo calls the category', async () => {
    await expect(categoryImageFile('TANK 300', dir)).resolves.toMatchObject({ kind: 'photo', file: 'tank300.jpg' });
    await expect(categoryImageFile('Dinza-8', dir)).resolves.toMatchObject({ kind: 'photo', file: 'dinza8.webp' });
    await expect(categoryImageFile('Services', dir)).resolves.toMatchObject({ kind: 'photo', file: 'services.jpeg' });
    // an alias: the old catalogue's name for the car
    await expect(categoryImageFile('JETOUR 1', dir)).resolves.toMatchObject({ kind: 'photo', file: 'jetourt1.jpg' });
  });

  it('tells a logo from a photo by its extension', async () => {
    await expect(categoryImageFile('WURTH', dir)).resolves.toMatchObject({ kind: 'logo', file: 'wurth.png' });
  });

  it('has nothing for a category without a file', async () => {
    await expect(categoryImageFile('OTHER CAR', dir)).resolves.toBeUndefined();
    await expect(categoryImageFile('OTHER CAR', path.join(dir, 'missing'))).resolves.toBeUndefined();
  });

  it('uses a photo as the tab image itself', async () => {
    const image = await categoryImage('TANK 300', dir);
    expect(image.equals(await readFile(path.join(dir, 'tank300.jpg')))).toBe(true);
  });

  it('puts a logo on a dark tile', async () => {
    const image = await categoryImage('WURTH', dir);
    expect(await sharp(image).metadata()).toMatchObject({ format: 'png', width: 1200, height: 800 });
    expect(await centre(image)).toEqual([255, 255, 255]);
  });

  it('draws a name tile for a category without a file', async () => {
    const image = await categoryImage('OTHER CAR', dir);
    expect(image.equals(await categoryTile({ label: 'OTHER CAR' }))).toBe(true);
  });
});
