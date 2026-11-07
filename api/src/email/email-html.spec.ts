import { emailButton, emailLayout, escapeHtml } from './email-html';

describe('escapeHtml', () => {
  it('escapes the characters that would open markup', () => {
    expect(escapeHtml(`<b>"Sara" & 'Omar'</b>`)).toBe('&lt;b&gt;&quot;Sara&quot; &amp; &#39;Omar&#39;&lt;/b&gt;');
  });
});

describe('emailLayout', () => {
  it('writes Arabic right to left and English left to right', () => {
    expect(emailLayout({ locale: 'ar', title: 'طلبك', body: '<p>x</p>' })).toMatch(/<html lang="ar" dir="rtl">/);
    expect(emailLayout({ locale: 'en', title: 'Your order', body: '<p>x</p>' })).toMatch(/<html lang="en" dir="ltr">/);
  });

  it('escapes the title and keeps the body as given', () => {
    const html = emailLayout({ locale: 'en', title: '<Order>', body: '<p id="b">body</p>' });
    expect(html).toContain('&lt;Order&gt;');
    expect(html).toContain('<p id="b">body</p>');
    expect(html).toContain('Wolf Car');
  });
});

describe('emailButton', () => {
  it('links to the escaped address with the escaped label', () => {
    expect(emailButton('https://wolfcar.qa/a?x=1&y=2', 'View <order>')).toMatch(/href="https:\/\/wolfcar\.qa\/a\?x=1&amp;y=2"[^>]*>View &lt;order&gt;</);
  });
});
