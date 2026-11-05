import { Injectable, Logger } from '@nestjs/common';

/** One email, already rendered. Every address gets the same message. */
export interface EmailMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
}

/** One way to send an email: the console (development, tests) or Brevo. */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

/** Thrown by a sender that could not hand the message over; `code` is the provider's, or NETWORK. */
export class EmailSendError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'EmailSendError';
  }
}

/** Addresses whose last message the console sender keeps; the oldest is forgotten first. */
const KEEP_LAST = 1000;

/**
 * EMAIL_PROVIDER=console: writes the message to the log instead of sending it
 * and remembers the last one per address, so development and tests can read
 * a sign-in code. In production only the recipients and subject are logged:
 * the text may hold a code.
 */
@Injectable()
export class ConsoleEmailSender implements EmailSender {
  private readonly logger = new Logger(ConsoleEmailSender.name);
  private readonly last = new Map<string, EmailMessage>();

  constructor(private readonly production: boolean) {}

  send(message: EmailMessage): Promise<void> {
    for (const address of message.to) {
      this.last.delete(address); // re-insert so the map stays in sending order
      this.last.set(address, message);
    }
    while (this.last.size > KEEP_LAST) this.last.delete(this.last.keys().next().value as string);
    const head = `Email to ${message.to.join(', ')}: ${message.subject}`;
    this.logger.log(this.production ? `${head} (not sent: EMAIL_PROVIDER=console)` : `${head}\n${message.text}`);
    return Promise.resolve();
  }

  lastTo(address: string): EmailMessage | undefined {
    return this.last.get(address);
  }
}
