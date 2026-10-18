import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { CUSTOMER_EMAIL_MAX, normaliseQatarPhone, OTP_CODE_PATTERN } from '../../../../shared/shop';
import { ORDER_MAX_LINES } from '../../../../shared/validation';
import { CustomerName, OrderLineDto } from '../../orders/dto/orders.dto';

/**
 * Phone as the customer typed it, normalised to "+974XXXXXXXX". Anything that
 * is not a Qatari mobile becomes the string "invalid", which the pattern then
 * rejects with a field error on `phone`.
 */
const QatarPhone = () => (target: object, key: string) => {
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? (normaliseQatarPhone(value) ?? 'invalid') : value))(target, key);
  IsString()(target, key);
  Matches(/^\+974[3567]\d{7}$/, { message: 'phone must be a Qatari mobile number' })(target, key);
};

export class SendOtpDto {
  @QatarPhone()
  phone: string;

  @IsOptional()
  @IsIn(['ar', 'en'])
  locale?: 'ar' | 'en';
}

export class VerifyOtpDto {
  @QatarPhone()
  phone: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) & 0xf)).trim() : value))
  @IsString()
  @Matches(OTP_CODE_PATTERN, { message: 'code must be 6 digits' })
  code: string;
}

/** The basket plus the contact details Tap and Odoo need. Prices never come from the client. */
export class CreateWebOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ORDER_MAX_LINES)
  @ArrayUnique((l: OrderLineDto) => l.productId, { message: 'each product may appear only once' })
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  items: OrderLineDto[];

  @CustomerName()
  name: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(CUSTOMER_EMAIL_MAX)
  email: string;
}

export class PayDto {
  /** The card token from Tap's browser SDK. */
  @IsString()
  @Matches(/^tok_[A-Za-z0-9_]{3,80}$/, { message: 'tokenId must be a Tap token' })
  tokenId: string;

  @IsIn(['ar', 'en'])
  locale: 'ar' | 'en';
}
