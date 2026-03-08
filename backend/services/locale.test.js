const {
  normalizeLocalePreference,
  mapAcceptLanguageToLocale,
  resolveEffectiveLocale,
} = require("./locale");

describe("locale utility", () => {
  test("normalizes supported locale preference", () => {
    expect(normalizeLocalePreference("en-gb")).toBe("en-GB");
    expect(normalizeLocalePreference("AUTO")).toBe("auto");
  });

  test("rejects unsupported locale preference", () => {
    expect(normalizeLocalePreference("fr-CA")).toBeNull();
  });

  test("maps Accept-Language in priority order", () => {
    expect(mapAcceptLanguageToLocale("en-GB,en-US;q=0.9")).toBe("en-GB");
    expect(mapAcceptLanguageToLocale("en;q=0.9")).toBe("en-US");
  });

  test("effective locale prefers explicit preference over header", () => {
    expect(resolveEffectiveLocale({
      localePreference: "en-AU",
      acceptLanguageHeader: "en-GB,en;q=0.9",
    })).toBe("en-AU");
  });
});
