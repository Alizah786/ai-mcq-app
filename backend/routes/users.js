const express = require("express");
const { z } = require("zod");
const { TYPES } = require("tedious");
const { execQuery } = require("../db");
const { requireAuth } = require("../auth");
const {
  ALLOWED_PREFERENCES,
  DEFAULT_PREFERENCE,
  normalizeLocalePreference,
  resolveEffectiveLocale,
} = require("../services/locale");

const router = express.Router();
router.use(requireAuth);

const UpdatePreferencesBody = z.object({
  localePreference: z.string().trim().min(1).max(10),
});

function getRoleTableAndId(user) {
  if (user.role === "Manager") return { table: "Teacher", idColumn: "TeacherId", id: user.userId };
  if (user.role === "Student") return { table: "Student", idColumn: "StudentId", id: user.userId };
  if (user.role === "Principal") return { table: "Principal", idColumn: "PrincipalId", id: user.userId };
  if (user.role === "AppAdmin") return { table: "AppAdmin", idColumn: "AppAdminId", id: user.userId };
  return null;
}

async function loadUserLocalePreference(user) {
  const map = getRoleTableAndId(user);
  if (!map) return DEFAULT_PREFERENCE;
  const hasColumn = await execQuery(
    `SELECT COL_LENGTH('dbo.${map.table}', 'LocalePreference') AS ColumnLength`
  )
    .then((r) => Number(r.rows[0]?.ColumnLength || 0) > 0)
    .catch(() => false);
  if (!hasColumn) return DEFAULT_PREFERENCE;
  const row = await execQuery(
    `SELECT LocalePreference FROM dbo.${map.table} WHERE ${map.idColumn} = @id`,
    [{ name: "id", type: TYPES.Int, value: map.id }]
  );
  return normalizeLocalePreference(row.rows[0]?.LocalePreference) || DEFAULT_PREFERENCE;
}

async function saveUserLocalePreference(user, localePreference) {
  const map = getRoleTableAndId(user);
  if (!map) return false;
  await execQuery(
    `UPDATE dbo.${map.table} SET LocalePreference = @localePreference WHERE ${map.idColumn} = @id`,
    [
      { name: "localePreference", type: TYPES.NVarChar, value: localePreference },
      { name: "id", type: TYPES.Int, value: map.id },
    ]
  );
  return true;
}

router.get("/users/me", async (req, res) => {
  const localePreference = await loadUserLocalePreference(req.user).catch(() => DEFAULT_PREFERENCE);
  const effectiveLocale = req.resolveLocaleFromPreference
    ? req.resolveLocaleFromPreference(localePreference)
    : resolveEffectiveLocale({ localePreference, acceptLanguageHeader: req.headers["accept-language"] });
  req.locale = effectiveLocale;
  return res.json({
    userId: req.user.userId,
    role: req.user.displayRole || req.user.role,
    localePreference,
    effectiveLocale,
  });
});

router.patch("/users/me/preferences", async (req, res) => {
  const parsed = UpdatePreferencesBody.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid preferences payload." });
  }
  const normalized = normalizeLocalePreference(parsed.data.localePreference);
  if (!normalized || !ALLOWED_PREFERENCES.includes(normalized)) {
    return res.status(400).json({ message: "Invalid localePreference. Allowed: auto, en-US, en-CA, en-GB, en-AU." });
  }
  await saveUserLocalePreference(req.user, normalized);
  const effectiveLocale = req.resolveLocaleFromPreference
    ? req.resolveLocaleFromPreference(normalized)
    : resolveEffectiveLocale({ localePreference: normalized, acceptLanguageHeader: req.headers["accept-language"] });
  req.locale = effectiveLocale;
  return res.json({ localePreference: normalized, effectiveLocale });
});

module.exports = router;
