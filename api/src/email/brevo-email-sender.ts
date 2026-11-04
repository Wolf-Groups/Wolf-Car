import { EmailSendError, type EmailMessage, type EmailSender } from './email-sender';

/** Brevo's transactional email endpoint (https://developers.brevo.com/reference/sendtransacemail). */
export const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';

/** A slow Brevo must not hold a sign-in request for long. */
const TIMEOUT_MS = 10_000;

export interface BrevoOptions {
  apiKey: string;
  from: { email: string; name: string };
  /** for the tests */
  fetch?: typeof fetch;
}

/** EMAIL_PROVIDER=brevo. Any non-2xx answer or network failure is an EmailSendError. */
export class BrevoEmailSender implements EmailSender {
  private readonly fetch: typeof fetch;

  constructor(private readonly options: BrevoOptions) {
    this.fetch = options.fetch ?? fetch;
  }

  async send(message: EmailMessage): Promise<void> {
    let res: Response;
    try {
      res = await this.fetch(BREVO_SEND_URL, {
        method: 'POST',
        headers: { 'api-key': this.options.apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: this.options.from,
          to: message.to.map((email) => ({ email })),
          subject: message.subject,
          htmlContent: message.html,
          textContent: message.text,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new EmailSendError(`Brevo could not be reached: ${err instanceof Error ? err.message : 'unknown error'}`, 'NETWORK');
    }
    if (res.ok) return;
    const body = (await res.json().catch(() => null)) as { code?: unknown; message?: unknown } | null;
    const code = typeof body?.code === 'string' ? body.code : `HTTP_${res.status}`;
    throw new EmailSendError(`Brevo refused the email: ${typeof body?.message === 'string' ? body.message : res.statusText}`, code, res.status);
  }
}
