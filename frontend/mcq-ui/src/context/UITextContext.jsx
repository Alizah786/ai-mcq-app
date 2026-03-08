import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { apiPost } from "../api/http";
import { useLocale } from "./LocaleContext";

const DEFAULT_LOCALE = "en-US";
const UITextContext = createContext(null);

function sortAndStore(items) {
  const map = {};
  for (const item of items || []) {
    const key = item.searchKey;
    if (!key) continue;
    if (!map[key]) map[key] = [];
    map[key].push(item);
  }
  Object.keys(map).forEach((key) => {
    map[key].sort((a, b) => {
      const aOrder = Number(a.sortOrder || 0);
      const bOrder = Number(b.sortOrder || 0);
      if (aOrder !== bOrder) return aOrder - bOrder;
      return Number(a.lookupId || 0) - Number(b.lookupId || 0);
    });
  });
  return map;
}

export function UITextProvider({ children }) {
  const [store, setStore] = useState({});
  const pendingRef = useRef(new Map());
  const { effectiveLocale } = useLocale();
  const locale = effectiveLocale || DEFAULT_LOCALE;

  const loadCategoryKeys = useCallback(async (category, keys, localeCode = locale) => {
    const normalizedKeys = [...new Set((Array.isArray(keys) ? keys : []).map((key) => String(key || "").trim()).filter(Boolean))];
    if (!category || !normalizedKeys.length) return {};
    const requestKey = `${localeCode}|${category}|${normalizedKeys.slice().sort().join(",")}`;
    if (pendingRef.current.has(requestKey)) {
      return pendingRef.current.get(requestKey);
    }
    const task = apiPost("/api/lookups/bulk", {
      category,
      locale: localeCode,
      keys: normalizedKeys,
    }).then((response) => {
      const bucket = sortAndStore(response.items || []);
      setStore((prev) => ({
        ...prev,
        [localeCode]: {
          ...(prev[localeCode] || {}),
          [category]: {
            ...((prev[localeCode] || {})[category] || {}),
            ...bucket,
          },
        },
      }));
      pendingRef.current.delete(requestKey);
      return bucket;
    }).catch((error) => {
      pendingRef.current.delete(requestKey);
      throw error;
    });
    pendingRef.current.set(requestKey, task);
    return task;
  }, [locale]);

  const getEntries = useCallback((category, key, localeCode = locale) => {
    return (
      store[localeCode]?.[category]?.[key]
      || store[DEFAULT_LOCALE]?.[category]?.[key]
      || []
    );
  }, [locale, store]);

  const t = useCallback((key, fallback, localeCode = locale) => {
    const entries = getEntries("UI_LABEL", key, localeCode)
      .concat(getEntries("UI_MESSAGE", key, localeCode))
      .concat(getEntries("UI_PLACEHOLDER", key, localeCode))
      .concat(getEntries("VALIDATION_MESSAGE", key, localeCode));
    return entries[0]?.textValue || fallback;
  }, [getEntries, locale]);

  const msg = useCallback((key, fallback, localeCode = locale) => {
    const entries = getEntries("UI_MESSAGE", key, localeCode)
      .concat(getEntries("VALIDATION_MESSAGE", key, localeCode))
      .concat(getEntries("UI_HELP_TEXT", key, localeCode));
    return entries[0]?.textValue || fallback;
  }, [getEntries, locale]);

  const options = useCallback((key, fallback = [], localeCode = locale) => {
    const entries = getEntries("DROPDOWN_OPTIONS", key, localeCode);
    if (!entries.length) return fallback;
    return entries.map((entry) => ({
      value: entry.comments || entry.textValue,
      label: entry.textValue,
      sortOrder: entry.sortOrder,
      lookupId: entry.lookupId,
    }));
  }, [getEntries, locale]);

  const value = useMemo(() => ({
    locale,
    loadCategoryKeys,
    t,
    msg,
    options,
  }), [locale, loadCategoryKeys, msg, options, t]);

  return <UITextContext.Provider value={value}>{children}</UITextContext.Provider>;
}

export function useUIText() {
  const value = useContext(UITextContext);
  if (!value) {
    throw new Error("useUIText must be used within UITextProvider");
  }
  return value;
}
