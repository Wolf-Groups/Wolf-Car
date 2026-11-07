import { Injectable } from '@nestjs/common';
import { isCarModel } from './category-kind';
import { PrismaService } from '../prisma/prisma.service';
import { inStock } from '../products/stock';
import { countCards, VARIANT_SELECT, variantView } from '../products/variant.view';
import { imageUrl } from '../uploads/image-processing';

/**
 * The only product fields that may ever leave the API unauthenticated. The
 * price is public (the website shows it and builds the WhatsApp order from
 * it); the barcode and every audit field are not.
 */
export interface PublicProduct {
  id: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  /** "1800.00" (QAR), or null while Finance has not priced it */
  price: string | null;
  imageUrl: string;
  thumbUrl: string;
  /** products sharing a groupId are colours/sizes of one product; null otherwise */
  groupId: string | null;
  variantLabel: string | null;
  variantColor: string | null;
  /** false when Odoo has none left: shown as "not available" and refused at checkout */
  available: boolean;
}

/** A car-model grouping as shown publicly, with how many products it holds. */
export interface PublicCategory {
  id: string;
  name: string;
  /** English name for the /en pages; null means show `name` */
  nameEn: string | null;
  carModel: string | null;
  /** a car model a customer can add to "My cars" (not parts, accessories or services) */
  isCar: boolean;
  imageUrl: string | null;
  thumbUrl: string | null;
  count: number;
}

@Injectable()
export class PublicCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(categoryId?: string, quickService = false): Promise<PublicProduct[]> {
    // explicit select: the barcode is never read, so it cannot leak
    // a model also lists what is common to its brand (the parent category)
    const parentId = categoryId
      ? ((await this.prisma.category.findUnique({ where: { id: categoryId }, select: { parentId: true } }))?.parentId ?? null)
      : null;
    const rows = await this.prisma.product.findMany({
      where: {
        isActive: true,
        // services have their own endpoint (public/services)
        serviceId: null,
        ...(quickService ? { isQuickService: true } : {}),
        ...(categoryId ? { categoryId: { in: parentId ? [categoryId, parentId] : [categoryId] }, category: { isActive: true } } : {}),
      },
      select: { id: true, name: true, description: true, categoryId: true, price: true, imageKey: true, odooStock: true, ...VARIANT_SELECT },
      orderBy: { name: 'asc' },
      take: 5000,
    });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      categoryId: p.categoryId,
      price: p.price ? p.price.toFixed(2) : null,
      imageUrl: imageUrl(p.imageKey),
      thumbUrl: imageUrl(p.imageKey, 'sm'),
      ...variantView(p),
      // only whether it can be bought, never how many: the count stays with staff
      available: inStock(p.odooStock),
    }));
  }

  /**
   * Active categories that hold at least one product, largest first. A brand
   * with models under it is not offered itself: its products are counted, and
   * listed, inside each model.
   */
  async categories(): Promise<PublicCategory[]> {
    const rows = await this.prisma.category.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        nameEn: true,
        carModel: true,
        imageKey: true,
        position: true,
        parentId: true,
        products: { where: { isActive: true }, select: { id: true, ...VARIANT_SELECT } },
      },
    });
    const own = new Map(rows.map((c) => [c.id, c.products]));
    const brands = new Set(rows.map((c) => c.parentId).filter((id): id is string => id !== null));
    return rows
      .filter((c) => !brands.has(c.id))
      .map((c) => ({ ...c, _count: { products: countCards([...c.products, ...((c.parentId && own.get(c.parentId)) || [])]) } }))
      .filter((c) => c._count.products > 0)
      .sort((a, b) => b._count.products - a._count.products || a.position - b.position || a.name.localeCompare(b.name))
      .map((c) => ({
        id: c.id,
        name: c.name,
        nameEn: c.nameEn,
        carModel: c.carModel,
        isCar: isCarModel(c),
        imageUrl: c.imageKey ? imageUrl(c.imageKey) : null,
        thumbUrl: c.imageKey ? imageUrl(c.imageKey, 'sm') : null,
        count: c._count.products,
      }));
  }
}
