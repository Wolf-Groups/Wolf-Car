import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditTrail } from '../activity/audit-trail.service';
import { decimal, money } from '../common/money';
import type { AuthUser } from '../common/types';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ImageUploadService, type UploadedImage } from '../uploads/image-upload.service';
import type {
  CreateProductDto,
  ListProductsQueryDto,
  ReorderProductsDto,
  SetQuickServiceDto,
  UpdatePriceDto,
  UpdateProductDetailsDto,
} from './dto/products.dto';
import { PRODUCT_SELECT, productView, type ProductView } from './product.view';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly images: ImageUploadService,
    private readonly trail: AuditTrail,
  ) {}

  /**
   * The catalogue. Branch users always see their own branch's showroom order;
   * users without a branch may pick a branch's order, otherwise it is by name.
   */
  async list(user: AuthUser, q: ListProductsQueryDto): Promise<ProductView[]> {
    const branchId = user.branchId ?? q.branchId ?? null;
    // a model also holds what is common to its brand (the parent category), as on the website
    const parentId = q.categoryId
      ? ((await this.prisma.category.findUnique({ where: { id: q.categoryId }, select: { parentId: true } }))?.parentId ?? null)
      : null;
    const where: Prisma.ProductWhereInput = {
      // the hidden rows behind a service's prices are edited on the services page
      serviceId: null,
      ...(q.visibility === 'all' ? {} : { isActive: q.visibility !== 'hidden' }),
      ...(q.quickService ? { isQuickService: true } : {}),
      ...(q.price === 'priced' ? { price: { not: null } } : q.price === 'unpriced' ? { price: null } : {}),
      ...(q.categoryId ? { categoryId: { in: parentId ? [q.categoryId, parentId] : [q.categoryId] } } : {}),
      ...(q.stock === 'in' ? { odooStock: { gt: 0 } } : q.stock === 'out' ? { odooStock: { lte: 0 } } : {}),
      ...(q.q
        ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { barcode: { contains: q.q, mode: 'insensitive' } }] }
        : {}),
    };
    if (!branchId) {
      const rows = await this.prisma.product.findMany({ where, select: PRODUCT_SELECT, orderBy: { name: 'asc' }, take: 2000 });
      return rows.map((p) => productView(p));
    }
    const rows = await this.prisma.branchProduct.findMany({
      where: { branchId, product: where },
      select: { position: true, product: { select: PRODUCT_SELECT } },
      orderBy: { position: 'asc' },
      take: 2000,
    });
    return rows.map((r) => productView(r.product, r.position));
  }

  async get(id: string): Promise<ProductView> {
    const p = await this.prisma.product.findUnique({ where: { id }, select: PRODUCT_SELECT });
    if (!p) throw new NotFoundException('Product not found.');
    return productView(p);
  }

  /** Name + image (required), barcode and description (optional). No price: Finance sets it later. */
  async create(dto: CreateProductDto, image: UploadedImage | undefined, user: AuthUser): Promise<ProductView> {
    const imageKey = await this.images.store(image);
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        await this.lockBranches(tx);
        const product = await tx.product.create({
          data: {
            name: dto.name,
            description: dto.description ?? null,
            barcode: dto.barcode ?? null,
            imageKey,
            createdById: user.id,
          },
          select: { id: true },
        });
        // shared catalogue: the new product goes to the end of every branch's showroom list
        await tx.$executeRaw`
          INSERT INTO branch_products (branch_id, product_id, position)
          SELECT b.id, ${product.id}::uuid,
                 COALESCE((SELECT MAX(bp.position) + 1 FROM branch_products bp WHERE bp.branch_id = b.id), 0)
          FROM branches b`;
        return product.id;
      });
      const created = await this.get(id);
      this.trail.setEntity('Product', id).setChange(null, created);
      return created;
    } catch (err) {
      await this.images.remove(imageKey);
      throw err;
    }
  }

  /** Name, image, barcode, description only. The price column is never written here. */
  async updateDetails(
    id: string,
    dto: UpdateProductDetailsDto,
    image: UploadedImage | undefined,
    user: AuthUser,
  ): Promise<ProductView> {
    const before = await this.get(id);
    // Odoo owns these three; the next sync would put its own values back anyway
    if (before.fromOdoo && (dto.name !== undefined || dto.barcode !== undefined || image)) throw odooManaged();
    const oldKey = (await this.prisma.product.findUniqueOrThrow({ where: { id }, select: { imageKey: true } })).imageKey;
    const newKey = image ? await this.images.store(image) : undefined;
    const data: Prisma.ProductUncheckedUpdateInput = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.barcode !== undefined ? { barcode: dto.barcode } : {}),
      ...(newKey ? { imageKey: newKey } : {}),
    };
    if (Object.keys(data).length === 0) {
      throw new BadRequestException({ statusCode: 400, error: 'Bad Request', code: 'NOTHING_TO_UPDATE', message: 'Nothing to update.' });
    }
    try {
      await this.prisma.product.update({ where: { id }, data: { ...data, updatedById: user.id } });
    } catch (err) {
      if (newKey) await this.images.remove(newKey);
      throw err;
    }
    if (newKey) await this.images.remove(oldKey);
    const after = await this.get(id);
    this.trail.setEntity('Product', id).setChange(detailsOf(before), detailsOf(after));
    return after;
  }

  /** Price only, with an auditable history row (old → new, who, when). */
  async updatePrice(id: string, dto: UpdatePriceDto, user: AuthUser): Promise<ProductView> {
    const newPrice = decimal(dto.price);
    const oldPrice = await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ price: Prisma.Decimal | null; odoo_id: number | null }[]>`
        SELECT price, odoo_id FROM products WHERE id = ${id}::uuid FOR UPDATE`;
      if (!row) throw new NotFoundException('Product not found.');
      if (typeof row.odoo_id === 'number') throw odooManaged();
      const current = row.price === null ? null : decimal(row.price.toString());
      if (current !== null && current.equals(newPrice)) return current;
      await tx.product.update({
        where: { id },
        data: { price: newPrice, priceUpdatedAt: new Date(), updatedById: user.id },
      });
      await tx.priceHistory.create({ data: { productId: id, oldPrice: current, newPrice, changedById: user.id } });
      return current;
    });
    this.trail.setEntity('Product', id).setChange({ price: money(oldPrice) }, { price: money(newPrice) });
    return this.get(id);
  }

  /**
   * Puts the product under the website's "Quick service" tab or takes it out.
   * The colours of one product share a card there, so they change together.
   */
  async setQuickService(id: string, dto: SetQuickServiceDto, user: AuthUser): Promise<ProductView> {
    const row = await this.prisma.product.findFirst({
      where: { id, serviceId: null },
      select: { isQuickService: true, odooTemplateId: true, variantLabel: true },
    });
    if (!row) throw new NotFoundException('Product not found.');
    const grouped = row.odooTemplateId !== null && row.variantLabel !== null;
    await this.prisma.product.updateMany({
      where: grouped ? { odooTemplateId: row.odooTemplateId, variantLabel: { not: null } } : { id },
      data: { isQuickService: dto.quickService, updatedById: user.id },
    });
    this.trail.setEntity('Product', id).setChange({ quickService: row.isQuickService }, { quickService: dto.quickService });
    return this.get(id);
  }

  async priceHistory(id: string) {
    await this.get(id);
    const rows = await this.prisma.priceHistory.findMany({
      where: { productId: id },
      orderBy: { changedAt: 'desc' },
      select: {
        id: true,
        oldPrice: true,
        newPrice: true,
        changedAt: true,
        changedBy: { select: { id: true, username: true, displayName: true, role: true } },
      },
    });
    return rows.map((r) => ({ ...r, oldPrice: money(r.oldPrice), newPrice: money(r.newPrice) }));
  }

  /**
   * Saves a branch's showroom order. The list must contain exactly the
   * branch's products; positions are rewritten in one statement (the unique
   * (branch, position) constraint is deferred to commit).
   */
  async reorder(user: AuthUser, dto: ReorderProductsDto): Promise<ProductView[]> {
    let branchId: string;
    if (user.branchId) {
      if (dto.branchId && dto.branchId !== user.branchId) {
        throw new ForbiddenException({ statusCode: 403, error: 'Forbidden', code: 'OTHER_BRANCH', message: 'You can only reorder your own branch.' });
      }
      branchId = user.branchId;
    } else {
      if (!dto.branchId) {
        throw new BadRequestException({ statusCode: 400, error: 'Bad Request', code: 'BRANCH_REQUIRED', message: 'Choose which branch to reorder.' });
      }
      branchId = dto.branchId;
    }

    const before = await this.prisma.$transaction(async (tx) => {
      const [branch] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM branches WHERE id = ${branchId}::uuid FOR UPDATE`;
      if (!branch) throw new NotFoundException('Branch not found.');
      const current = await tx.branchProduct.findMany({
        where: { branchId },
        orderBy: { position: 'asc' },
        select: { productId: true, product: { select: { isActive: true } } },
      });
      // the dashboard only shows (and so only sends) the active products;
      // hidden ones keep a place after them so nothing is lost if they return
      const currentIds = current.filter((r) => r.product.isActive).map((r) => r.productId);
      const hiddenIds = current.filter((r) => !r.product.isActive).map((r) => r.productId);
      const known = new Set(currentIds);
      const missing = currentIds.filter((pid) => !dto.productIds.includes(pid)).length;
      const unknown = dto.productIds.filter((pid) => !known.has(pid)).length;
      if (missing || unknown) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          code: 'ORDER_MISMATCH',
          message: 'The list must contain every product of the branch exactly once. Refresh and try again.',
          missing,
          unknown,
        });
      }
      const ordered = [...dto.productIds, ...hiddenIds];
      await tx.$executeRaw`
        UPDATE branch_products bp
           SET position = o.ord - 1
          FROM unnest(${ordered}::uuid[]) WITH ORDINALITY AS o(product_id, ord)
         WHERE bp.branch_id = ${branchId}::uuid AND bp.product_id = o.product_id`;
      return currentIds;
    });

    this.trail.setEntity('Branch', branchId).setBranch(branchId).setChange({ productIds: before }, { productIds: dto.productIds });
    return this.list({ ...user, branchId }, { price: 'all', visibility: 'active' });
  }

  /** Serialises catalogue-wide position writes (product creation vs. reorder). */
  private async lockBranches(tx: Prisma.TransactionClient): Promise<void> {
    await tx.$queryRaw`SELECT id FROM branches ORDER BY id FOR UPDATE`;
  }
}

const odooManaged = () =>
  new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    code: 'ODOO_MANAGED',
    message: 'This product comes from Odoo. Change its name, barcode, photo or price in Odoo.',
  });

function detailsOf(p: ProductView) {
  return { name: p.name, description: p.description, barcode: p.barcode, imageUrl: p.imageUrl };
}
