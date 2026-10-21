import { Logger } from '@nestjs/common';
import { ConsoleSmsSender, otpMessage } from './sms-sender';

describe('otpMessage', () => {
  it.each(['ar', 'en'] as const)('names Wolf Car and carries the code (%s)', (locale) => {
    const text = otpMessage('483920', locale);
    expect(text).toContain('483920');
    expect(text).toContain('Wolf Car');
  });
});

describe('ConsoleSmsSender', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it("logs 'SMS to +974…: <text>' with the Nest logger", async () => {
    await new ConsoleSmsSender().send('+97455123456', 'Wolf Car code 483920');
    const lines = jest.mocked(Logger.prototype.log).mock.calls.map((c) => String(c[0]));
    expect(lines).toContainEqual(expect.stringMatching(/^SMS to \+974.*: Wolf Car code 483920$/));
  });

  it('keeps the last message per phone instead of sending it', async () => {
    const sender = new ConsoleSmsSender();
    expect(sender.lastMessage('+97455123456')).toBeUndefined();
    await expect(sender.send('+97455123456', 'Wolf Car code 483920')).resolves.toBeUndefined();
    await expect(sender.send('+97466123456', 'Wolf Car code 111111')).resolves.toBeUndefined();
    expect(sender.lastMessage('+97455123456')).toBe('Wolf Car code 483920');
    expect(sender.lastMessage('+97466123456')).toBe('Wolf Car code 111111');
  });
});
