import { Injectable, Logger } from '@nestjs/common';
import { todo } from '../todo';

/** One way to send a text message. The real provider (owner's choice) is one more class behind this. */
export interface SmsSender {
  send(phone: string, text: string): Promise<void>;
}

export const SMS_SENDER = Symbol('SMS_SENDER');

/** The text a customer receives. Must contain the code and the words "Wolf Car". */
export function otpMessage(code: string, locale: 'ar' | 'en'): string {
  return todo('otpMessage', code, locale);
}

/**
 * SMS_PROVIDER=console: logs the message instead of sending it and remembers
 * the last one per phone, so local development and tests can read the code.
 */
@Injectable()
export class ConsoleSmsSender implements SmsSender {
  private readonly logger = new Logger(ConsoleSmsSender.name);
  private readonly last = new Map<string, string>();

  send(phone: string, text: string): Promise<void> {
    return todo('ConsoleSmsSender.send', this.logger, this.last, phone, text);
  }

  lastMessage(phone: string): string | undefined {
    return this.last.get(phone);
  }
}
