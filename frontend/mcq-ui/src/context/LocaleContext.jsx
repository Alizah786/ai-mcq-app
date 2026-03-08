import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiGet, apiPatch } from "../api/http";
import i18n, { DEFAULT_LOCALE, getEffectiveLocaleFromPreference, LOCALE_PREFERENCE_KEY } from "../i18n";
import { useAuth } from "./AuthContext";

const LocaleContext = createContext(null);
const SUPPORTED_PREFS = ["auto", "en-US", "en-CA", "en-GB", "en-AU"];

export function LocaleProvider({ children }) {
  const { token, user } = useAuth();
  const [localePreference, setLocalePreferenceState] = useState(() => {
    if (typeof window === "undefined") return "auto";
    return String(window.localStorage.getItem(LOCALE_PREFERENCE_KEY) || "auto");
  });
  const [effectiveLocale, setEffectiveLocale] = useState(i18n.resolvedLanguage || DEFAULT_LOCALE);

  const applyPreference = useCallback(async (nextPreference, saveRemote = true) => {
    const normalized = SUPPORTED_PREFS.includes(nextPreference) ? nextPreference : "auto";
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LOCALE_PREFERENCE_KEY, normalized);
    }
    setLocalePreferenceState(normalized);
    const nextEffective = getEffectiveLocaleFromPreference(normalized);
    setEffectiveLocale(nextEffective);
    await i18n.changeLanguage(nextEffective);
    if (saveRemote && token && user) {
      try {
        await apiPatch("/api/users/me/preferences", { localePreference: normalized });
      } catch {
        // keep local setting even if server save fails
      }
    }
  }, [token, user]);

  useEffect(() => {
    if (!token || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await apiGet("/api/users/me");
        if (cancelled) return;
        const pref = SUPPORTED_PREFS.includes(String(me?.localePreference || "")) ? String(me.localePreference) : "auto";
        const eff = String(me?.effectiveLocale || "") || getEffectiveLocaleFromPreference(pref);
        if (typeof window !== "undefined") window.localStorage.setItem(LOCALE_PREFERENCE_KEY, pref);
        setLocalePreferenceState(pref);
        setEffectiveLocale(eff);
        await i18n.changeLanguage(eff);
      } catch {
        const stored = typeof window !== "undefined" ? String(window.localStorage.getItem(LOCALE_PREFERENCE_KEY) || "auto") : "auto";
        applyPreference(stored, false).catch(() => {});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, user, applyPreference]);

  const value = useMemo(() => ({
    localePreference,
    effectiveLocale,
    setLocalePreference: applyPreference,
  }), [localePreference, effectiveLocale, applyPreference]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale must be used inside LocaleProvider");
  return value;
}
