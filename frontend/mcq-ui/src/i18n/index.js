import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import enBase from "../locales/en.json";
import enUS from "../locales/en-US.json";
import enCA from "../locales/en-CA.json";
import enGB from "../locales/en-GB.json";
import enAU from "../locales/en-AU.json";

export const SUPPORTED_LOCALES = ["en-US", "en-CA", "en-GB", "en-AU"];
export const DEFAULT_LOCALE = "en-US";
export const LOCALE_PREFERENCE_KEY = "app_locale_preference";

function mapNavigatorLocales(locales = []) {
  for (const raw of locales) {
    const token = String(raw || "").trim().toLowerCase();
    if (!token) continue;
    const exact = SUPPORTED_LOCALES.find((item) => item.toLowerCase() === token);
    if (exact) return exact;
    if (token.startsWith("en-ca")) return "en-CA";
    if (token.startsWith("en-gb")) return "en-GB";
    if (token.startsWith("en-au")) return "en-AU";
    if (token.startsWith("en-us")) return "en-US";
    if (token === "en") return "en-US";
  }
  return DEFAULT_LOCALE;
}

export function getEffectiveLocaleFromPreference(preference) {
  const pref = String(preference || "").trim();
  if (SUPPORTED_LOCALES.includes(pref)) return pref;
  const browserLocales =
    typeof navigator !== "undefined"
      ? (Array.isArray(navigator.languages) && navigator.languages.length ? navigator.languages : [navigator.language])
      : [];
  return mapNavigatorLocales(browserLocales);
}

function detectInitialLocale() {
  const stored =
    typeof window !== "undefined"
      ? String(window.localStorage.getItem(LOCALE_PREFERENCE_KEY) || "auto").trim()
      : "auto";
  if (stored && stored !== "auto" && SUPPORTED_LOCALES.includes(stored)) return stored;
  return getEffectiveLocaleFromPreference("auto");
}

const resources = {
  "en-US": { translation: { ...enBase, ...enUS } },
  "en-CA": { translation: { ...enBase, ...enCA } },
  "en-GB": { translation: { ...enBase, ...enGB } },
  "en-AU": { translation: { ...enBase, ...enAU } },
};

i18n.use(initReactI18next).init({
  resources,
  lng: detectInitialLocale(),
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: SUPPORTED_LOCALES,
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
