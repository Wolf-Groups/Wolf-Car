import { Injectable, Logger } from '@nestjs/common';
import { OTP_TTL_SECONDS } from '../../../../shared/shop';

/** One way to send a text message. The real provider (owner's choice) is one more class behind this. */
export interface SmsSender {
  send(phone: string, text: string): Promise<void>;
}

export const SMS_SENDER = Symbol('SMS_SENDER');

const OTP_TTL_MINUTES = OTP_TTL_SECONDS / 60;

/** The text a customer receives. Must contain the code and the words "Wolf Car". */
export function otpMessage(code: string, locale: 'ar' | 'en'): string {
  return locale === 'ar'
    ? `رمز التحقق من Wolf Car: ${code}\nصالح لمدة ${OTP_TTL_MINUTES} دقائق. لا تشاركه مع أحد.`
    : `Your Wolf Car verification code: ${code}\nValid for ${OTP_TTL_MINUTES} minutes. Do not share it with anyone.`;
}

/** Phones whose last message the console sender keeps; the oldest is forgotten first. */
const KEEP_LAST = 1000;

/**
 * SMS_PROVIDER=console: logs the message instead of sending it and remembers
 * the last one per phone, so local development and tests can read the code.
 */
@Injectable()
export class ConsoleSmsSender implements SmsSender {
  private readonly logger = new Logger(ConsoleSmsSender.name);
  private readonly last = new Map<string, string>();

  send(phone: string, text: string): Promise<void> {
    this.last.delete(phone); // re-insert so the map stays in sending order
    this.last.set(phone, text);
    if (this.last.size > KEEP_LAST) this.last.delete(this.last.keys().next().value as string);
    this.logger.log(`SMS to ${phone}: ${text}`);
    return Promise.resolve();
  }

  lastMessage(phone: string): string | undefined {
    return this.last.get(phone);
  }
}
