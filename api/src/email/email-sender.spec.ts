import { Logger } from '@nestjs/common';
import { ConsoleEmailSender, type EmailMessage } from './email-sender';

const message: EmailMessage = {
  to: ['sara@example.com'],
  subject: 'Your Wolf Car sign-in code: 483920',
  html: '<p>483920</p>',
  text: 'Your code is 483920',
};

describe('ConsoleEmailSender', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  const logged = () => jest.mocked(Logger.prototype.log).mock.calls.map((c) => String(c[0]));

  it('keeps the last message per address instead of sending it', async () => {
    const sender = new ConsoleEmailSender(false);
    expect(sender.lastTo('sara@example.com')).toBeUndefined();
    await expect(sender.send(message)).resolves.toBeUndefined();
    await sender.send({ ...message, to: ['omar@example.com', 'sara@example.com'], subject: 'Second' });
    expect(sender.lastTo('sara@example.com')?.subject).toBe('Second');
    expect(sender.lastTo('omar@example.com')?.subject).toBe('Second');
  });

  it('logs the recipients, subject and text outside production', async () => {
    await new ConsoleEmailSender(false).send(message);
    expect(logged()).toContainEqual(expect.stringMatching(/^Email to sara@example\.com: Your Wolf Car sign-in code: 483920\n.*Your code is 483920/s));
  });

  it('logs only the recipients and subject in production, never the text', async () => {
    await new ConsoleEmailSender(true).send({ ...message, subject: 'Receipt BO-000001', text: 'secret 483920' });
    const lines = logged();
    expect(lines).toContainEqual(expect.stringContaining('Receipt BO-000001'));
    expect(lines.join('\n')).not.toContain('483920');
  });
});
