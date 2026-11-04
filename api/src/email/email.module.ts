import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { BrevoEmailSender } from './brevo-email-sender';
import { ConsoleEmailSender, EMAIL_SENDER, type EmailSender } from './email-sender';

/** The sender EMAIL_PROVIDER names. validateEnv already refused brevo without its key and sender. */
export function emailSenderFactory(config: ConfigService<Env, true>): EmailSender {
  if (config.get('EMAIL_PROVIDER', { infer: true }) === 'brevo') {
    return new BrevoEmailSender({
      apiKey: config.get('BREVO_API_KEY', { infer: true }) as string,
      from: { email: config.get('EMAIL_FROM', { infer: true }) as string, name: config.get('EMAIL_FROM_NAME', { infer: true }) },
    });
  }
  return new ConsoleEmailSender(config.get('NODE_ENV', { infer: true }) === 'production');
}

/** Sending email, for the shop's sign-in codes and order emails. */
@Global()
@Module({
  providers: [{ provide: EMAIL_SENDER, inject: [ConfigService], useFactory: emailSenderFactory }],
  exports: [EMAIL_SENDER],
})
export class EmailModule {}
