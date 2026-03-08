const SUPPORTED_LOCALES = ["en-US", "en-CA", "en-GB", "en-AU"];
const DEFAULT_LOCALE = "en-US";
const DEFAULT_PREFERENCE = "auto";
const ALLOWED_PREFERENCES = [DEFAULT_PREFERENCE, ...SUPPORTED_LOCALES];

function normalizeLocalePreference(value) {
  const raw = String(value || "").trim();
  if (!raw) return DEFAULT_PREFERENCE;
  const match = ALLOWED_PREFERENCES.find((item) => item.toLowerCase() === raw.toLowerCase());
  return match || null;
}

function mapAcceptLanguageToLocale(headerValue) {
  const header = String(headerValue || "").trim();
  if (!header) return DEFAULT_LOCALE;

  const tokens = header
    .split(",")
    .map((part) => String(part || "").split(";")[0].trim().toLowerCase())
    .filter(Boolean);

  for (const token of tokens) {
    const exact = SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === token);
    if (exact) return exact;
    if (token.startsWith("en-ca")) return "en-CA";
    if (token.startsWith("en-gb")) return "en-GB";
    if (token.startsWith("en-au")) return "en-AU";
    if (token.startsWith("en-us")) return "en-US";
    if (token === "en") return "en-US";
  }

  return DEFAULT_LOCALE;
}

function resolveEffectiveLocale({ localePreference, acceptLanguageHeader }) {
  const normalizedPref = normalizeLocalePreference(localePreference);
  if (normalizedPref && normalizedPref !== DEFAULT_PREFERENCE) return normalizedPref;
  return mapAcceptLanguageToLocale(acceptLanguageHeader);
}

module.exports = {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  DEFAULT_PREFERENCE,
  ALLOWED_PREFERENCES,
  normalizeLocalePreference,
  mapAcceptLanguageToLocale,
  resolveEffectiveLocale,
};
