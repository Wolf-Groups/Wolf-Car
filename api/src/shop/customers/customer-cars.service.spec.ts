import { BadRequestException } from '@nestjs/common';
import { mockDeep } from 'jest-mock-extended';
import type { PrismaService } from '../../prisma/prisma.service';
import { imageUrl } from '../../uploads/image-processing';
import { CustomerCarsService } from './customer-cars.service';
import type { CustomerPrincipal } from './customers.service';

const customer: CustomerPrincipal = { id: 'c-1', phone: '+97455123456', name: null, email: null, sessionVersion: 1 };
const L8 = '00000000-0000-4000-8000-000000000008';
const L5 = '00000000-0000-4000-8000-000000000005';

const carRow = (id: string, name: string, nameEn: string | null, imageKey: string | null = null) => ({ category: { id, name, nameEn, imageKey } });
const model = (id: string, nameEn: string) => ({ id, name: nameEn, nameEn });

describe('CustomerCarsService', () => {
  const prisma = mockDeep<PrismaService>();
  const service = new CustomerCarsService(prisma);

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((arg: unknown) => (typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as unknown[])) as never);
  });

  describe('list', () => {
    it("returns the customer's cars in their order, with names and a small picture", async () => {
      prisma.customerCar.findMany.mockResolvedValue([carRow(L8, 'ليوبارد 8', 'Leopard 8', 'img-8'), carRow(L5, 'ليوبارد 5', null)] as never);
      expect(await service.list(customer)).toEqual([
        { id: L8, name: 'ليوبارد 8', nameEn: 'Leopard 8', thumbUrl: imageUrl('img-8', 'sm') },
        { id: L5, name: 'ليوبارد 5', nameEn: null, thumbUrl: null },
      ]);
      const args = prisma.customerCar.findMany.mock.calls[0][0];
      expect(args?.where).toEqual({ customerId: 'c-1', category: { isActive: true } });
      expect(args?.orderBy).toEqual({ position: 'asc' });
    });
  });

  describe('replace', () => {
    it('keeps exactly the cars sent, in the order sent', async () => {
      prisma.category.findMany.mockResolvedValue([model(L5, 'Leopard 5'), model(L8, 'Leopard 8')] as never);
      prisma.customerCar.findMany.mockResolvedValue([] as never);
      await service.replace(customer, [L8, L5]);
      expect(prisma.customerCar.deleteMany).toHaveBeenCalledWith({ where: { customerId: 'c-1' } });
      expect(prisma.customerCar.createMany).toHaveBeenCalledWith({
        data: [
          { customerId: 'c-1', categoryId: L8, position: 0 },
          { customerId: 'c-1', categoryId: L5, position: 1 },
        ],
      });
    });

    it('accepts only active car models, never a brand', async () => {
      prisma.category.findMany.mockResolvedValue([model(L8, 'Leopard 8')] as never);
      prisma.customerCar.findMany.mockResolvedValue([] as never);
      await service.replace(customer, [L8]);
      expect(prisma.category.findMany.mock.calls[0][0]?.where).toEqual({ id: { in: [L8] }, isActive: true, children: { none: {} } });
    });

    it('is 400 UNKNOWN_CAR when one of them is not a car model, and changes nothing', async () => {
      prisma.category.findMany.mockResolvedValue([model(L8, 'Leopard 8')] as never);
      const err = await service.replace(customer, [L8, L5]).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'UNKNOWN_CAR' });
      expect(prisma.customerCar.deleteMany).not.toHaveBeenCalled();
      expect(prisma.customerCar.createMany).not.toHaveBeenCalled();
    });

    it('is 400 UNKNOWN_CAR for a catalogue tab that is not a car, such as Genuine Parts', async () => {
      prisma.category.findMany.mockResolvedValue([model(L8, 'Leopard 8'), model(L5, 'Genuine Parts')] as never);
      const err = await service.replace(customer, [L8, L5]).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'UNKNOWN_CAR' });
      expect(prisma.customerCar.deleteMany).not.toHaveBeenCalled();
    });

    it('clears the list when nothing is sent', async () => {
      prisma.customerCar.findMany.mockResolvedValue([] as never);
      expect(await service.replace(customer, [])).toEqual([]);
      expect(prisma.customerCar.deleteMany).toHaveBeenCalledWith({ where: { customerId: 'c-1' } });
      expect(prisma.customerCar.createMany).not.toHaveBeenCalled();
    });
  });
});
