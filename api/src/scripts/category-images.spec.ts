import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import sharp from 'sharp';
import type { PrismaClient } from '../generated/prisma/client';
import { applyCategoryImages, parseArgs } from './category-images';

const solid = (background: string, format: 'jpeg' | 'png' = 'jpeg') =>
  sharp({ create: { width: 300, height: 200, channels: 3, background } })[format]().toBuffer();

describe('applyCategoryImages', () => {
  let prisma: DeepMockProxy<PrismaClient>;
  let dir: string;
  let uploadDir: string;
  const log = jest.fn();
  const OLD_TANK = '11111111-1111-4111-8111-111111111111';

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'wolfcar-category-images-'));
    await writeFile(path.join(dir, 'tank300.jpg'), await solid('#cc0000'));
    await writeFile(path.join(dir, 'wurth.png'), await solid('#ffffff', 'png'));
    await writeFile(path.join(dir, 'nobody.jpg'), await solid('#00cc00'));
    await writeFile(path.join(dir, 'SOURCES.md'), '# not an image\n');
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  beforeEach(async () => {
    log.mockClear();
    uploadDir = await mkdtemp(path.join(tmpdir(), 'wolfcar-uploads-'));
    await writeFile(path.join(uploadDir, `${OLD_TANK}.webp`), 'old');
    await writeFile(path.join(uploadDir, `${OLD_TANK}-sm.webp`), 'old');
    prisma = mockDeep<PrismaClient>();
    prisma.category.findMany.mockResolvedValue([
      { id: 'c-tank', name: 'تانك 300', nameEn: 'TANK 300', imageKey: OLD_TANK },
      { id: 'c-wurth', name: 'WURTH', nameEn: null, imageKey: null },
      { id: 'c-leopard', name: 'ليوبارد 5', nameEn: 'Leopard 5', imageKey: '22222222-2222-4222-8222-222222222222' },
    ] as never);
  });
  afterEach(() => rm(uploadDir, { recursive: true, force: true }));

  it('stores each file for the category with the same key, and removes the old image', async () => {
    const changes = await applyCategoryImages(prisma, { dir, uploadDir, log });
    expect(changes).toEqual([
      { file: 'nobody.jpg', key: 'nobody', category: null, oldImageKey: null, newImageKey: null },
      { file: 'tank300.jpg', key: 'tank300', category: { id: 'c-tank', name: 'TANK 300' }, oldImageKey: OLD_TANK, newImageKey: expect.any(String) },
      { file: 'wurth.png', key: 'wurth', category: { id: 'c-wurth', name: 'WURTH' }, oldImageKey: null, newImageKey: expect.any(String) },
    ]);
    const tank = changes[1].newImageKey as string;
    const wurth = changes[2].newImageKey as string;
    expect(prisma.category.update).toHaveBeenCalledTimes(2);
    expect(prisma.category.update).toHaveBeenCalledWith({ where: { id: 'c-tank' }, data: { imageKey: tank } });
    expect(prisma.category.update).toHaveBeenCalledWith({ where: { id: 'c-wurth' }, data: { imageKey: wurth } });

    const stored = (await readdir(uploadDir)).sort();
    expect(stored).toEqual([`${tank}-sm.webp`, `${tank}.webp`, `${wurth}-sm.webp`, `${wurth}.webp`].sort());
    // the photo as it is; the logo on the 1200x800 tile
    expect(await sharp(path.join(uploadDir, `${tank}.webp`)).metadata()).toMatchObject({ width: 300, height: 200 });
    expect(await sharp(path.join(uploadDir, `${wurth}.webp`)).metadata()).toMatchObject({ width: 1200, height: 800 });
  });

  it('lists what it would do in a dry run, and writes nothing', async () => {
    const changes = await applyCategoryImages(prisma, { dir, uploadDir, dryRun: true, log });
    expect(changes.map((c) => [c.file, c.category?.id ?? null, c.newImageKey])).toEqual([
      ['nobody.jpg', null, null],
      ['tank300.jpg', 'c-tank', null],
      ['wurth.png', 'c-wurth', null],
    ]);
    expect(prisma.category.update).not.toHaveBeenCalled();
    expect((await readdir(uploadDir)).sort()).toEqual([`${OLD_TANK}-sm.webp`, `${OLD_TANK}.webp`]);
  });

  it('gives every category that shares a key its own copy', async () => {
    prisma.category.findMany.mockResolvedValue([
      { id: 'c-1', name: 'TANK 300', nameEn: null, imageKey: null },
      { id: 'c-2', name: 'تانك 300', nameEn: 'Tank-300', imageKey: null },
    ] as never);
    const changes = await applyCategoryImages(prisma, { dir, uploadDir, log });
    const tank = changes.filter((c) => c.key === 'tank300');
    expect(tank.map((c) => c.category?.id)).toEqual(['c-1', 'c-2']);
    expect(tank[0].newImageKey).not.toBe(tank[1].newImageKey);
    expect(prisma.category.update).toHaveBeenCalledTimes(2);
  });
});

describe('parseArgs', () => {
  it('reads --dry-run and an optional folder', () => {
    expect(parseArgs([])).toEqual({ dryRun: false });
    expect(parseArgs(['--dry-run'])).toEqual({ dryRun: true });
    expect(parseArgs(['--dry-run', 'photos'])).toEqual({ dryRun: true, dir: path.resolve('photos') });
  });
});
