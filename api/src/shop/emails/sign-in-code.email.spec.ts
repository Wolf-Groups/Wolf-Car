import { signInCodeEmail } from './sign-in-code.email';

describe('signInCodeEmail', () => {
  it.each(['ar', 'en'] as const)('names Wolf Car and carries the code in the subject, text and html (%s)', (locale) => {
    const mail = signInCodeEmail('483920', locale);
    expect(mail.subject).toContain('Wolf Car');
    expect(mail.subject).toContain('483920');
    expect(mail.text).toContain('483920');
    expect(mail.html).toContain('483920');
    // the code expires: the customer is told after how long
    expect(mail.text).toMatch(/5/);
  });

  it('writes Arabic right to left', () => {
    expect(signInCodeEmail('483920', 'ar').html).toContain('dir="rtl"');
    expect(signInCodeEmail('483920', 'en').html).toContain('dir="ltr"');
  });
});
