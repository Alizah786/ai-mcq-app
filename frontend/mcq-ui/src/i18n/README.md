# Locale / Region i18n Notes

## Current supported locales
- `en-US`
- `en-CA`
- `en-GB`
- `en-AU`

## Files
- `src/i18n/index.js`: i18next init + locale detection
- `src/i18n/format.js`: date/number/currency helpers
- `src/locales/en.json`: base keys
- `src/locales/en-*.json`: locale-specific overrides

## Preference storage
- Browser: `localStorage["app_locale_preference"]` (`auto` or explicit locale)
- Server (logged-in users): `PATCH /api/users/me/preferences`

## Add a new locale later
1. Add locale code to `SUPPORTED_LOCALES` in `src/i18n/index.js`.
2. Create `src/locales/<locale>.json` with only override keys.
3. Add currency mapping (if needed) in `src/i18n/format.js`.
4. Add dropdown option in `Profile.jsx`.
5. Extend backend allow-list in `backend/services/locale.js` and DB constraints migration.
