import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isCarModel } from '../../public/category-kind';
import { imageUrl } from '../../uploads/image-processing';
import type { CustomerPrincipal } from './customers.service';

/** How many cars one customer may keep in "My account". */
export const CUSTOMER_CARS_MAX = 5;

/** A car model the customer drives, as the website shows it. */
export interface CustomerCarView {
  /** the category id: the catalogue's ?category= */
  id: string;
  /** Arabic name */
  name: string;
  /** English name for /en; null means show `name` */
  nameEn: string | null;
  thumbUrl: string | null;
}

const unknownCar = () =>
  new BadRequestException({ statusCode: 400, error: 'Bad Request', code: 'UNKNOWN_CAR', message: 'Choose car models from the catalogue.' });

@Injectable()
export class CustomerCarsService {
  constructor(private readonly prisma: PrismaService) {}

  /** In the customer's order; a model since switched off is left out. */
  async list(customer: CustomerPrincipal): Promise<CustomerCarView[]> {
    const rows = await this.prisma.customerCar.findMany({
      where: { customerId: customer.id, category: { isActive: true } },
      orderBy: { position: 'asc' },
      select: { category: { select: { id: true, name: true, nameEn: true, imageKey: true } } },
    });
    return rows.map(({ category: c }) => ({ id: c.id, name: c.name, nameEn: c.nameEn, thumbUrl: c.imageKey ? imageUrl(c.imageKey, 'sm') : null }));
  }

  /**
   * Replaces the list with `categoryIds`, in that order (the DTO checks there are
   * at most CUSTOMER_CARS_MAX, unique). Each must be an active car model: not a
   * brand (a category with models under it) and not parts, accessories or a
   * service (isCarModel): 400 UNKNOWN_CAR otherwise, and nothing changes.
   */
  async replace(customer: CustomerPrincipal, categoryIds: string[]): Promise<CustomerCarView[]> {
    if (categoryIds.length > 0) {
      const found = await this.prisma.category.findMany({
        where: { id: { in: categoryIds }, isActive: true, children: { none: {} } },
        select: { id: true, name: true, nameEn: true },
      });
      if (found.length !== categoryIds.length || !found.every(isCarModel)) throw unknownCar();
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.customerCar.deleteMany({ where: { customerId: customer.id } });
      if (categoryIds.length > 0) {
        await tx.customerCar.createMany({ data: categoryIds.map((categoryId, position) => ({ customerId: customer.id, categoryId, position })) });
      }
    });
    return this.list(customer);
  }
}
