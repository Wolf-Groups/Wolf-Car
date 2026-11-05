/**
 * The frame every Wolf Car email shares. Email clients ignore stylesheets and
 * most layout CSS, so this is one table-free column with inline styles only.
 */

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** The brand orange of the site's buttons (--color-accent), white text at 4.7:1. */
export const ACCENT = '#c94a12';
const INK = '#1d1d1b';
const MUTED = '#5c5c57';

export interface EmailLayoutInput {
  locale: 'ar' | 'en';
  /** plain text, escaped here */
  title: string;
  /** HTML, already escaped by the caller */
  body: string;
}

export function emailLayout({ locale, title, body }: EmailLayoutInput): string {
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const align = locale === 'ar' ? 'right' : 'left';
  const footer = locale === 'ar' ? 'Wolf Car · بن عمران، الدوحة' : 'Wolf Car · Bin Omran, Doha';
  return `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f2ee;">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:Tahoma,Arial,sans-serif;font-size:16px;line-height:1.6;color:${INK};text-align:${align};" dir="${dir}">
<p style="margin:0 0 16px;font-size:20px;font-weight:bold;color:${ACCENT};">Wolf Car</p>
<div style="background:#ffffff;border-radius:12px;padding:24px;">
${body}
</div>
<p style="margin:16px 0 0;font-size:13px;color:${MUTED};">${escapeHtml(footer)}</p>
</div>
</body>
</html>`;
}

/** A link that looks like the site's buttons. */
export function emailButton(href: string, label: string): string {
  return `<p style="margin:24px 0 0;"><a href="${escapeHtml(href)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px;">${escapeHtml(label)}</a></p>`;
}
