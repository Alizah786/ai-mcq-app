const { DEFAULT_PREFERENCE, mapAcceptLanguageToLocale, resolveEffectiveLocale } = require("../services/locale");

function attachRequestLocale(req, _res, next) {
  const accept = req.headers["accept-language"];
  req.localePreference = DEFAULT_PREFERENCE;
  req.locale = mapAcceptLanguageToLocale(accept);
  req.resolveLocaleFromPreference = (localePreference) => resolveEffectiveLocale({
    localePreference,
    acceptLanguageHeader: accept,
  });
  next();
}

module.exports = { attachRequestLocale };
