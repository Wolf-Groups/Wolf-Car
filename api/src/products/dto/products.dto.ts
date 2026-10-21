import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { BARCODE_PATTERN, PRODUCT_DESCRIPTION_MAX, PRODUCT_NAME_MAX } from '../../../../shared/validation';
import { EmptyToNull, EmptyToUndefined, IsPrice, ToPriceString, Trim } from '../../common/validators';

/**
 * Multipart fields for POST /products (plus an `image` file part). There is
 * deliberately no price field: sending one is rejected (forbidNonWhitelisted).
 */
export class CreateProductDto {
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(PRODUCT_NAME_MAX)
  name: string;

  @IsOptional()
  @EmptyToUndefined()
  @IsString()
  @MaxLength(PRODUCT_DESCRIPTION_MAX)
  description?: string;

  @IsOptional()
  @EmptyToUndefined()
  @IsString()
  @Matches(BARCODE_PATTERN, { message: 'barcode may only contain letters, digits and dashes (max 64)' })
  barcode?: string;
}

/** Multipart fields for PATCH /products/:id (optional new `image`). Details only — no price. */
export class UpdateProductDetailsDto {
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(PRODUCT_NAME_MAX)
  name?: string;

  /** Empty string clears it. */
  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(PRODUCT_DESCRIPTION_MAX)
  description?: string | null;

  /** Empty string clears it. */
  @IsOptional()
  @EmptyToNull()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Matches(BARCODE_PATTERN, { message: 'barcode may only contain letters, digits and dashes (max 64)' })
  barcode?: string | null;
}

/** The only field Finance can change. Anything else in the body is rejected. */
export class UpdatePriceDto {
  /** QAR amount with at most 2 decimals, e.g. 125 or "125.50". */
  @ToPriceString()
  @IsPrice()
  price: string;
}

/** Puts a product under the website's "Quick service" tab, or takes it out. */
export class SetQuickServiceDto {
  @IsBoolean()
  quickService: boolean;
}

export class ReorderProductsDto {
  /** Every product of the branch, in the new showroom order. */
  @IsArray()
  @ArrayMaxSize(2000)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  productIds: string[];

  /** Only for users without a branch (Super Admin): which branch to reorder. Ignored/forbidden otherwise. */
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class ListProductsQueryDto {
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @IsIn(['all', 'priced', 'unpriced'])
  price: 'all' | 'priced' | 'unpriced' = 'all';

  /** Hidden products are kept for past orders; the list leaves them out unless asked. */
  @IsOptional()
  @IsIn(['active', 'hidden', 'all'])
  visibility: 'active' | 'hidden' | 'all' = 'active';

  /** "true" lists only the products under the website's "Quick service" tab. */
  @IsOptional()
  @IsIn(['true'])
  quickService?: 'true';

  /** For users without a branch: show this branch's display order. */
  @IsOptional()
  @IsUUID()
  branchId?: string;

  /** One car model or line (e.g. THABT); a model also lists the parts common to its brand, as on the website. */
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  /** "in": Odoo has some free to sell; "out": Odoo has none. Products Odoo does not count match neither. */
  @IsOptional()
  @IsIn(['in', 'out'])
  stock?: 'in' | 'out';
}
