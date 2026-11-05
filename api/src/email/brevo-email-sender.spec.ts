import { BrevoEmailSender, BREVO_SEND_URL } from './brevo-email-sender';
import { EmailSendError, type EmailMessage } from './email-sender';

const message: EmailMessage = {
  to: ['sara@example.com', 'omar@example.com'],
  subject: 'Receipt BO-000001',
  html: '<p>Thank you</p>',
  text: 'Thank you',
};

const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function senderWith(fetchImpl: jest.Mock) {
  return new BrevoEmailSender({ apiKey: 'xkeysib-test', from: { email: 'orders@wolfcar.qa', name: 'Wolf Car' }, fetch: fetchImpl as unknown as typeof fetch });
}

describe('BrevoEmailSender', () => {
  it("posts Brevo's transactional email body with the api-key header", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(answer(201, { messageId: '<1@smtp-relay.brevo.com>' }));
    await senderWith(fetchImpl).send(message);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(BREVO_SEND_URL);
    expect(BREVO_SEND_URL).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'api-key': 'xkeysib-test', 'content-type': 'application/json', accept: 'application/json' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string)).toEqual({
      sender: { email: 'orders@wolfcar.qa', name: 'Wolf Car' },
      to: [{ email: 'sara@example.com' }, { email: 'omar@example.com' }],
      subject: 'Receipt BO-000001',
      htmlContent: '<p>Thank you</p>',
      textContent: 'Thank you',
    });
  });

  it("throws EmailSendError with Brevo's code on a refusal", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(answer(401, { code: 'unauthorized', message: 'Key not found' }));
    const sent = senderWith(fetchImpl).send(message);
    await expect(sent).rejects.toBeInstanceOf(EmailSendError);
    await expect(sent).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
  });

  it('throws EmailSendError when Brevo cannot be reached', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(senderWith(fetchImpl).send(message)).rejects.toMatchObject({ name: 'EmailSendError', code: 'NETWORK' });
  });
});
