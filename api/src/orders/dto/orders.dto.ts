import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ORDER_STATUSES, type OrderStatusName } from '../../../../shared/permissions';
import { ORDER_SOURCES, type OrderSourceName } from '../../../../shared/shop';
import {
  CUSTOMER_NAME_MAX,
  CUSTOMER_NAME_MIN,
  CUSTOMER_NAME_PATTERN,
  ORDER_MAX_LINES,
  ORDER_MAX_QUANTITY,
} from '../../../../shared/validation';
import { PageQueryDto } from '../../common/pagination';
import { Trim } from '../../common/validators';

export class OrderLineDto {
  @IsUUID()
  productId: string;

  @IsInt()
  @Min(1)
  @Max(ORDER_MAX_QUANTITY)
  quantity: number;
}

export const CustomerName = () => (target: object, key: string) => {
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value))(target, key);
  IsString()(target, key);
  MinLength(CUSTOMER_NAME_MIN)(target, key);
  MaxLength(CUSTOMER_NAME_MAX)(target, key);
  Matches(CUSTOMER_NAME_PATTERN, { message: 'customerName may only contain letters, spaces and . \' -' })(target, key);
};

/**
 * Showroom order. The branch is never taken from the client: it comes from
 * the signed-in showroom user, whose id must match `userId`.
 */
export class CreateShowroomOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ORDER_MAX_LINES)
  @ArrayUnique((l: OrderLineDto) => l.productId, { message: 'each product may appear only once' })
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  items: OrderLineDto[];

  @CustomerName()
  customerName: string;

  /** The signed-in showroom user; must match the session. */
  @IsUUID()
  userId: string;
}

export class UpdateOrderDto {
  @IsOptional()
  @CustomerName()
  customerName?: string;

  /** The lines to keep with their new quantities (existing products only; omitted lines are removed). */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ORDER_MAX_LINES)
  @ArrayUnique((l: OrderLineDto) => l.productId, { message: 'each product may appear only once' })
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  items?: OrderLineDto[];
}

export class ListOrdersQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatusName;

  /** SHOWROOM (kiosk) or WEB (the website's online checkout). */
  @IsOptional()
  @IsIn(ORDER_SOURCES)
  source?: OrderSourceName;

  /** Inclusive start (YYYY-MM-DD in Qatar time, or a full ISO timestamp). */
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  /** Inclusive end day (YYYY-MM-DD in Qatar time, or a full ISO timestamp). */
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(CUSTOMER_NAME_MAX)
  customerName?: string;

  /** "GH-000042", "42", or part of a code. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(20)
  orderNumber?: string;

  /** Only for users who can see all branches. */
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
