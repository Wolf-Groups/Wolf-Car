/** Whether a text holds Arabic letters: a product name like "G700 جيتور - شبك امامي" then reads right to left. */
export const hasArabic = (text: string): boolean => /[\u0600-\u06FF]/.test(text);
