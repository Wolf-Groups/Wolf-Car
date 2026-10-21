/**
 * Receipt HTML (rendered to PDF by headless Chromium). Pure function: every
 * dynamic value is HTML-escaped here, and the page runs with JavaScript
 * disabled and no network access.
 */

import { code128Svg, isCode128Encodable } from '../../../shared/code128';

export type ReceiptLocale = 'ar' | 'en';

export interface ReceiptData {
  code: string;
  createdAt: Date;
  confirmedAt: Date | null;
  customerName: string;
  currency: string;
  total: string;
  branch: { name: string; nameAr: string };
  cashier: string | null;
  items: { productName: string; barcode?: string | null; quantity: number; unitPrice: string; lineTotal: string }[];
  /**
   * A web order: its parts are never rung up at the till, so no scannable
   * bars. When the card paid it, the receipt says so with the paid date and
   * the end of Tap's charge id. Absent for showroom orders.
   */
  online?: { paid: boolean; paidAt: Date | null; chargeId: string | null } | null;
}

/**
 * Bars under the product name so the cashier can scan the printed sheet. The
 * page renders with JavaScript disabled, so the SVG has to be inlined here.
 */
function barcodeCell(barcode: string | null | undefined): string {
  if (!isCode128Encodable(barcode)) return '';
  return `<div class="bc">${code128Svg(barcode, { height: 30, moduleWidth: 1.1, showLabel: true })}</div>`;
}

export interface ReceiptAssets {
  /** data: URLs */
  fonts: { arabic400: string; arabic700: string; latin400: string; latin700: string };
  logo: string;
}

const TEXT = {
  en: {
    title: 'Receipt',
    brand: 'Wolf Car Auto Services',
    order: 'Order number',
    date: 'Date',
    customer: 'Customer',
    branch: 'Branch',
    cashier: 'Confirmed by',
    item: 'Item',
    qty: 'Qty',
    unit: 'Unit price',
    line: 'Total',
    grand: 'Grand total',
    thanks: 'Thank you for choosing Wolf Car.',
    note: 'Prices include all applicable charges. Keep this receipt for your records.',
    paidOnline: 'Paid online by card — nothing to collect at the till',
    paidOn: 'Paid',
    cardPayment: 'Card payment',
  },
  ar: {
    title: 'إيصال',
    brand: 'وولف كار لخدمات السيارات',
    order: 'رقم الطلب',
    date: 'التاريخ',
    customer: 'العميل',
    branch: 'الفرع',
    cashier: 'أكّده',
    item: 'المنتج',
    qty: 'الكمية',
    unit: 'سعر الوحدة',
    line: 'الإجمالي',
    grand: 'الإجمالي الكلي',
    thanks: 'شكرًا لاختياركم وولف كار.',
    note: 'الأسعار شاملة لجميع الرسوم. يُرجى الاحتفاظ بهذا الإيصال.',
    paidOnline: 'مدفوع أونلاين بالبطاقة — لا يُحصَّل أي مبلغ عند الكاشير',
    paidOn: 'تاريخ الدفع',
    cardPayment: 'عملية الدفع',
  },
} as const;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Latin digits in both languages (as on the website), Qatar time zone. */
export function formatMoney(amount: string, currency: string, locale: ReceiptLocale): string {
  return new Intl.NumberFormat(`${locale}-QA-u-nu-latn`, { style: 'currency', currency }).format(Number(amount));
}

export function formatDate(date: Date, locale: ReceiptLocale): string {
  return new Intl.DateTimeFormat(`${locale}-QA-u-nu-latn`, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Qatar',
  }).format(date);
}

export function renderReceiptHtml(data: ReceiptData, locale: ReceiptLocale, assets: ReceiptAssets): string {
  const t = TEXT[locale];
  const e = escapeHtml;
  const money = (v: string) => e(formatMoney(v, data.currency, locale));
  const branchName = locale === 'ar' ? data.branch.nameAr : data.branch.name;
  const face = (family: string, url: string, weight: number, range: string) =>
    `@font-face{font-family:'${family}';src:url(${url}) format('woff2');font-weight:${weight};unicode-range:${range};}`;
  const ARABIC = 'U+0600-06FF, U+0750-077F, U+0870-08FF, U+FB50-FDFF, U+FE70-FEFF, U+200C-200E, U+2010-2011, U+204F, U+2E41';
  const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';


  // a web order is never rung up at the till: no bars to scan
  const scannable = !data.online;
  const online = data.online?.paid ? data.online : null;
  const paidLine = online
    ? `<div class="paid"><b>${e(t.paidOnline)}</b><span>${
        online.paidAt ? `${e(t.paidOn)}: <bdi>${e(formatDate(online.paidAt, locale))}</bdi>` : ''
      }${online.paidAt && online.chargeId ? ' · ' : ''}${
        online.chargeId ? `${e(t.cardPayment)}: <bdi dir="ltr">…${e(online.chargeId.slice(-8))}</bdi>` : ''
      }</span></div>`
    : '';

  const rows = data.items
    .map(
      (i, n) => `<tr>
        <td class="n">${n + 1}</td>
        <td class="name"><bdi>${e(i.productName)}</bdi>${scannable ? barcodeCell(i.barcode) : ''}</td>
        <td class="num">${i.quantity}</td>
        <td class="num">${money(i.unitPrice)}</td>
        <td class="num strong">${money(i.lineTotal)}</td>
      </tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'">
<title>${e(t.title)} ${e(data.code)}</title>
<style>
${face('Cairo', assets.fonts.arabic400, 400, ARABIC)}
${face('Cairo', assets.fonts.arabic700, 700, ARABIC)}
${face('Cairo', assets.fonts.latin400, 400, LATIN)}
${face('Cairo', assets.fonts.latin700, 700, LATIN)}
@page { size: A5; margin: 14mm 12mm; }
* { box-sizing: border-box; }
html { background: #fff; color-scheme: light; }
body { margin: 0; background: #fff; font-family: 'Cairo', sans-serif; color: #161616; font-size: 10.5pt; line-height: 1.55; }
header { display: flex; align-items: center; gap: 10px; padding-bottom: 10px; border-bottom: 2px solid #f2702a; }
header img { width: 44px; height: 44px; }
.brand b { display: block; font-size: 13pt; font-weight: 700; }
.brand small { color: #6e6e6e; font-size: 8.5pt; letter-spacing: 0.06em; }
.title { margin-inline-start: auto; text-align: end; }
.title h1 { margin: 0; font-size: 15pt; font-weight: 700; color: #c94a12; }
.title div { font-size: 11pt; font-weight: 700; direction: ltr; unicode-bidi: isolate; }
dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 14px; margin: 12px 0 14px; }
dt { color: #6e6e6e; }
dd { margin: 0; font-weight: 700; }
table { width: 100%; border-collapse: collapse; }
th { text-align: start; font-size: 8.5pt; color: #6e6e6e; font-weight: 700; border-bottom: 1px solid #e4e1db; padding: 6px 4px; }
td { padding: 7px 4px; border-bottom: 1px solid #f0ede7; vertical-align: top; }
td.n { color: #9c968c; width: 18px; }
.num { text-align: end; white-space: nowrap; font-variant-numeric: tabular-nums; }
.bc { margin-top: 3px; color: #161616; }
.bc svg { display: block; }
th.num { text-align: end; }
.strong { font-weight: 700; }
.total { display: flex; justify-content: space-between; align-items: baseline; margin-top: 12px; padding: 10px 12px; background: #f5f4f1; border-radius: 10px; }
.total span { font-weight: 700; }
.total strong { font-size: 14pt; }
.paid { margin: 0 0 14px; padding: 10px 12px; border: 2px solid #1f7a3d; border-radius: 10px; color: #1f7a3d; }
.paid b { display: block; font-size: 11.5pt; }
.paid span { color: #161616; font-size: 9.5pt; }
footer { margin-top: 18px; color: #6e6e6e; font-size: 8.5pt; text-align: center; }
footer b { display: block; color: #161616; font-size: 9.5pt; }
</style>
</head>
<body>
<header>
  <img src="${assets.logo}" alt="">
  <div class="brand"><b>${e(t.brand)}</b><small>WOLF CAR</small></div>
  <div class="title"><h1>${e(t.title)}</h1><div>${e(data.code)}</div></div>
</header>
<dl>
  <dt>${e(t.order)}</dt><dd><bdi>${e(data.code)}</bdi></dd>
  <dt>${e(t.date)}</dt><dd><bdi>${e(formatDate(data.confirmedAt ?? data.createdAt, locale))}</bdi></dd>
  <dt>${e(t.branch)}</dt><dd>${e(branchName)}</dd>
  <dt>${e(t.customer)}</dt><dd><bdi>${e(data.customerName)}</bdi></dd>
  ${data.cashier ? `<dt>${e(t.cashier)}</dt><dd><bdi>${e(data.cashier)}</bdi></dd>` : ''}
</dl>
${paidLine}
<table>
  <thead><tr><th></th><th>${e(t.item)}</th><th class="num">${e(t.qty)}</th><th class="num">${e(t.unit)}</th><th class="num">${e(t.line)}</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="total"><span>${e(t.grand)}</span><strong><bdi>${money(data.total)}</bdi></strong></div>
<footer><b>${e(t.thanks)}</b>${e(t.note)}</footer>
</body>
</html>`;
}
