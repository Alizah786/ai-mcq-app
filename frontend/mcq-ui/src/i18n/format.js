import { DEFAULT_LOCALE } from "./index";

export function formatDate(date, locale = DEFAULT_LOCALE) {
  if (!date) return "";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric" }).format(d);
}

export function formatNumber(num, locale = DEFAULT_LOCALE) {
  const n = Number(num);
  if (!Number.isFinite(n)) return "";
  return new Intl.NumberFormat(locale).format(n);
}

export function getCurrencyForLocale(locale = DEFAULT_LOCALE) {
  if (locale === "en-CA") return "CAD";
  if (locale === "en-GB") return "GBP";
  if (locale === "en-AU") return "AUD";
  return "USD";
}

export function formatCurrency(amount, currencyCode, locale = DEFAULT_LOCALE) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  const currency = currencyCode || getCurrencyForLocale(locale);
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(n);
}
