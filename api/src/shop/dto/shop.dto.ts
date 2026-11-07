import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsEmail, IsIn, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { CUSTOMER_EMAIL_MAX, normaliseQatarPhone, OTP_CODE_PATTERN, PAYMENT_METHODS, type PaymentMethod } from '../../../../shared/shop';
import { ORDER_MAX_LINES } from '../../../../shared/validation';
import { CustomerName, OrderLineDto } from '../../orders/dto/orders.dto';
import { CUSTOMER_CARS_MAX } from '../customers/customer-cars.service';

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

/** An email address as the customer typed it: trimmed and lower-cased, so it is one identity however it was written. */
const CustomerEmail = () => (target: object, key: string) => {
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))(target, key);
  IsEmail()(target, key);
  MaxLength(CUSTOMER_EMAIL_MAX)(target, key);
};

export class SendCodeDto {
  @CustomerEmail()
  email: string;

  /** the language of the email */
  @IsIn(['ar', 'en'])
  locale: 'ar' | 'en';
}

export class VerifyCodeDto {
  @CustomerEmail()
  email: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) & 0xf)).trim() : value))
  @IsString()
  @Matches(OTP_CODE_PATTERN, { message: 'code must be 6 digits' })
  code: string;
}

/**
 * The basket, how it is paid, and the contact details the branch, Tap and Odoo
 * need. Prices never come from the client. A signed-in customer orders under
 * their account's email, whatever `email` says.
 */
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

  /** for the branch to call; nothing is sent to it */
  @QatarPhone()
  phone: string;

  @CustomerEmail()
  email: string;

  @IsIn(PAYMENT_METHODS)
  paymentMethod: PaymentMethod;

  /** the website language, for the order's emails */
  @IsIn(['ar', 'en'])
  locale: 'ar' | 'en';
}

export class PayDto {
  /** The card token from Tap's browser SDK. */
  @IsString()
  @Matches(/^tok_[A-Za-z0-9_]{3,80}$/, { message: 'tokenId must be a Tap token' })
  tokenId: string;

  @IsIn(['ar', 'en'])
  locale: 'ar' | 'en';
}

export class SaveCarsDto {
  /** Car-model category ids, in the order the customer wants them; [] clears the list. */
  @IsArray()
  @ArrayMaxSize(CUSTOMER_CARS_MAX)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  categoryIds: string[];
}
