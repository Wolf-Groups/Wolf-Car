import { localQatarNumber } from '../../../../shared/shop';
import { emailButton, emailLayout, escapeHtml } from '../../email/email-html';
import type { WebOrderView } from '../checkout/web-order.view';
import type { EmailContent } from './sign-in-code.email';

type Locale = 'ar' | 'en';

/** "+97455123456" → "+974 5512 3456" */
const displayPhone = (e164: string) => {
  const local = localQatarNumber(e164);
  return `+974 ${local.slice(0, 4)} ${local.slice(4)}`;
};

/** The phone inside a sentence: isolated left to right, or an Arabic sentence reverses its digit groups ("3456 5512 974+"). */
const phoneInSentence = (e164: string) => `\u2066${displayPhone(e164)}\u2069`;

const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] ?? '';

const money = (amount: string, locale: Locale) => (locale === 'ar' ? `${amount} ر.ق` : `QAR ${amount}`);

/** Doha time, Latin digits (as the website's formatDateTime). */
const dateTime = (iso: string, locale: Locale) =>
  new Intl.DateTimeFormat(`${locale}-QA-u-nu-latn`, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Qatar' }).format(new Date(iso));

const branchName = (order: WebOrderView, locale: Locale) => (locale === 'ar' ? order.branch.nameAr : order.branch.name);

const COPY = {
  ar: {
    thanks: (name: string) => (name ? `شكراً لك يا ${name}!` : 'شكراً لك!'),
    orderCode: 'رقم طلبك',
    lines: 'تفاصيل الطلب',
    total: 'الإجمالي',
    next: 'الخطوات التالية',
    view: 'عرض طلبك',
    placedSubject: (code: string) => `استلمنا طلبك ${code} — Wolf Car`,
    placedIntro: 'تم تسجيل طلبك، والدفع عند الاستلام في الفرع.',
    placedSteps: (phone: string, branch: string, total: string) => [`نتصل بك على ${phone} لتأكيد الطلب.`, 'نجهّز القطع.', `ادفع ${total} واستلم طلبك من ${branch}.`],
    paidSubject: (code: string) => `إيصال طلبك ${code} — تم الدفع`,
    paidIntro: (total: string, when: string) => `استلمنا دفعتك بمبلغ ${total} بتاريخ ${when}.`,
    paidSteps: (phone: string, branch: string, code: string) => ['نجهّز طلبك.', `نتصل بك على ${phone} عندما يكون جاهزاً.`, `استلمه من ${branch}. أظهر رقم الطلب ${code}.`],
    paidTotal: 'المبلغ المدفوع',
  },
  en: {
    thanks: (name: string) => (name ? `Thank you, ${name}!` : 'Thank you!'),
    orderCode: 'Your order code',
    lines: 'Your order',
    total: 'Total',
    next: 'What happens next',
    view: 'View your order',
    placedSubject: (code: string) => `We received your order ${code} — Wolf Car`,
    placedIntro: 'Your order is placed. You pay at the branch when you collect it.',
    placedSteps: (phone: string, branch: string, total: string) => [`We call you on ${phone} to confirm the order.`, 'We get your parts ready.', `You pay ${total} and collect your order at the ${branch}.`],
    paidSubject: (code: string) => `Receipt for your order ${code} — paid`,
    paidIntro: (total: string, when: string) => `We received your payment of ${total} on ${when}.`,
    paidSteps: (phone: string, branch: string, code: string) => ['We get your order ready.', `We call you on ${phone} when it is ready.`, `Collect it at the ${branch}. Show your order code ${code}.`],
    paidTotal: 'Paid',
  },
} as const;

function linesHtml(order: WebOrderView, locale: Locale, totalLabel: string): string {
  const rows = order.items
    .map(
      (i) =>
        `<tr><td style="padding:6px 0;border-bottom:1px solid #eeeae3;">${escapeHtml(i.productName)} <span style="color:#5c5c57;">×${i.quantity}</span></td>` +
        `<td dir="ltr" style="padding:6px 0;border-bottom:1px solid #eeeae3;text-align:end;white-space:nowrap;">${escapeHtml(money(i.lineTotal, locale))}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" style="width:100%;border-collapse:collapse;font-size:15px;">${rows}
<tr><td style="padding:10px 0 0;font-weight:bold;">${escapeHtml(totalLabel)}</td><td dir="ltr" style="padding:10px 0 0;font-weight:bold;text-align:end;white-space:nowrap;">${escapeHtml(money(order.total, locale))}</td></tr></table>`;
}

const linesText = (order: WebOrderView, locale: Locale, totalLabel: string) =>
  [...order.items.map((i) => `- ${i.productName} ×${i.quantity}: ${money(i.lineTotal, locale)}`), `${totalLabel}: ${money(order.total, locale)}`].join('\n');

interface CustomerEmailParts {
  locale: Locale;
  subject: string;
  intro: string;
  steps: readonly string[];
  totalLabel: string;
  link: string | null;
}

/** The shape both customer emails share: thanks, code, what happens next, the lines, the link to the order. */
function customerEmail(order: WebOrderView, parts: CustomerEmailParts): EmailContent {
  const c = COPY[parts.locale];
  const thanks = c.thanks(firstName(order.customer.name));
  const body = `<p style="margin:0 0 8px;font-size:22px;font-weight:bold;">${escapeHtml(thanks)}</p>
<p style="margin:0 0 16px;">${escapeHtml(parts.intro)}</p>
<p style="margin:0;font-size:13px;color:#5c5c57;">${escapeHtml(c.orderCode)}</p>
<p dir="ltr" style="margin:0 0 20px;font-size:28px;font-weight:bold;letter-spacing:1px;">${escapeHtml(order.code)}</p>
<p style="margin:0 0 6px;font-weight:bold;">${escapeHtml(c.next)}</p>
<ol style="margin:0 0 20px;padding-inline-start:20px;">${parts.steps.map((s) => `<li style="margin:0 0 4px;">${escapeHtml(s)}</li>`).join('')}</ol>
<p style="margin:0 0 6px;font-weight:bold;">${escapeHtml(c.lines)}</p>
${linesHtml(order, parts.locale, parts.totalLabel)}
${parts.link ? emailButton(parts.link, c.view) : ''}`;
  const text = [
    thanks,
    parts.intro,
    `${c.orderCode}: ${order.code}`,
    `${c.next}:\n${parts.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    `${c.lines}:\n${linesText(order, parts.locale, parts.totalLabel)}`,
    ...(parts.link ? [`${c.view}: ${parts.link}`] : []),
  ].join('\n\n');
  return { subject: parts.subject, html: emailLayout({ locale: parts.locale, title: parts.subject, body }), text };
}

/** To the customer, when an order to pay at the branch is placed. */
export function orderPlacedEmail(order: WebOrderView, locale: Locale, link: string | null): EmailContent {
  const c = COPY[locale];
  return customerEmail(order, {
    locale,
    subject: c.placedSubject(order.code),
    intro: c.placedIntro,
    steps: c.placedSteps(phoneInSentence(order.customer.phone), branchName(order, locale), money(order.total, locale)),
    totalLabel: c.total,
    link,
  });
}

/** To the customer, when the card payment is captured: the receipt. */
export function orderPaidEmail(order: WebOrderView, locale: Locale, link: string | null): EmailContent {
  const c = COPY[locale];
  return customerEmail(order, {
    locale,
    subject: c.paidSubject(order.code),
    intro: c.paidIntro(money(order.total, locale), dateTime(order.paidAt ?? order.createdAt, locale)),
    steps: c.paidSteps(phoneInSentence(order.customer.phone), branchName(order, locale), order.code),
    totalLabel: c.paidTotal,
    link,
  });
}

/** To the shop (SHOP_NOTIFY_EMAIL): a new website order to call about or hand over. English first, Arabic beside it. */
export function staffOrderEmail(order: WebOrderView, dashboardLink: string | null): EmailContent {
  const branch = order.paymentMethod === 'branch';
  const how = branch ? 'pay at the branch · الدفع في المعرض' : 'paid by card · مدفوع بالبطاقة';
  const subject = `New website order ${order.code} (${how})`;
  const todo = branch
    ? 'Call the customer to confirm, then confirm the order in the dashboard. · اتصل بالعميل لتأكيد الطلب ثم أكّده في لوحة التحكم.'
    : 'Paid online: get the parts ready and call the customer. · مدفوع: جهّز القطع واتصل بالعميل.';
  const phone = order.customer.phone;
  const body = `<p style="margin:0 0 4px;font-size:20px;font-weight:bold;" dir="ltr">${escapeHtml(order.code)}</p>
<p style="margin:0 0 16px;">${escapeHtml(how)}</p>
<p style="margin:0 0 16px;">${escapeHtml(todo)}</p>
<p style="margin:0 0 4px;"><b>${escapeHtml(order.customer.name ?? '—')}</b></p>
<p style="margin:0 0 4px;" dir="ltr"><a href="tel:${escapeHtml(phone)}">${escapeHtml(displayPhone(phone))}</a></p>
<p style="margin:0 0 16px;" dir="ltr">${escapeHtml(order.customer.email ?? '—')}</p>
${linesHtml(order, 'en', 'Total')}
${dashboardLink ? emailButton(dashboardLink, 'Open the orders · فتح الطلبات') : ''}`;
  const text = [
    `${order.code} — ${how}`,
    todo,
    `${order.customer.name ?? '—'}\n${displayPhone(phone)}\n${order.customer.email ?? '—'}`,
    linesText(order, 'en', 'Total'),
    ...(dashboardLink ? [dashboardLink] : []),
  ].join('\n\n');
  return { subject, html: emailLayout({ locale: 'en', title: subject, body }), text };
}
