const { TYPES } = require("tedious");
const { execQuery } = require("../../db");

const DEFAULT_LOCALE = "en-US";
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

function stableStringify(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return JSON.stringify([...value].sort());
  return String(value);
}

function getCacheKey(parts) {
  return parts.map(stableStringify).join("|");
}

function readCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache(key, value) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  return value;
}

function clearCache() {
  cache.clear();
}

function normalizeLocale(localeCode) {
  const value = String(localeCode || "").trim();
  return value || DEFAULT_LOCALE;
}

function normalizeRows(rows) {
  return (rows || []).map((row) => ({
    lookupId: Number(row.LookupId),
    dataCategoryId: Number(row.DataCategoryId),
    dataName: row.DataName,
    searchKey: row.SearchKey,
    textValue: row.TextValue ?? row.Value ?? null,
    comments: row.Comments ?? null,
    sortOrder: Number(row.SortOrder || 0),
  }));
}

async function runProcedure(sql, params, cacheKey) {
  if (cacheKey) {
    const cached = readCache(cacheKey);
    if (cached) return cached;
  }
  const result = await execQuery(sql, params);
  const rows = normalizeRows(result.rows);
  return cacheKey ? writeCache(cacheKey, rows) : rows;
}

async function getSingle(category, key, localeCode, fallbackLocaleCode = DEFAULT_LOCALE) {
  const locale = normalizeLocale(localeCode);
  const fallback = normalizeLocale(fallbackLocaleCode);
  const cacheKey = getCacheKey(["single", category, key, locale, fallback]);
  const cached = readCache(cacheKey);
  if (cached) return cached;
  const result = await execQuery(
    "EXEC dbo.usp_Lookup_GetSingleValue @CategoryName, @SearchKey, @LocaleCode, @FallbackLocaleCode",
    [
      { name: "CategoryName", type: TYPES.NVarChar, value: category },
      { name: "SearchKey", type: TYPES.NVarChar, value: key },
      { name: "LocaleCode", type: TYPES.NVarChar, value: locale },
      { name: "FallbackLocaleCode", type: TYPES.NVarChar, value: fallback },
    ]
  );
  const value = result.rows[0]?.Value ?? null;
  return writeCache(cacheKey, value);
}

async function getList(category, key, localeCode, fallbackLocaleCode = DEFAULT_LOCALE) {
  const locale = normalizeLocale(localeCode);
  const fallback = normalizeLocale(fallbackLocaleCode);
  return runProcedure(
    "EXEC dbo.usp_Lookup_GetByCategoryAndKey @CategoryName, @SearchKey, @LocaleCode, @FallbackLocaleCode",
    [
      { name: "CategoryName", type: TYPES.NVarChar, value: category },
      { name: "SearchKey", type: TYPES.NVarChar, value: key },
      { name: "LocaleCode", type: TYPES.NVarChar, value: locale },
      { name: "FallbackLocaleCode", type: TYPES.NVarChar, value: fallback },
    ],
    getCacheKey(["list", category, key, locale, fallback])
  );
}

async function getMany(category, keys, localeCode, fallbackLocaleCode = DEFAULT_LOCALE) {
  const locale = normalizeLocale(localeCode);
  const fallback = normalizeLocale(fallbackLocaleCode);
  const uniqueKeys = [...new Set((Array.isArray(keys) ? keys : []).map((key) => String(key || "").trim()).filter(Boolean))];
  if (!uniqueKeys.length) return [];
  return runProcedure(
    "EXEC dbo.usp_Lookup_GetByKeys @CategoryName, @LocaleCode, @FallbackLocaleCode, @KeysJson",
    [
      { name: "CategoryName", type: TYPES.NVarChar, value: category },
      { name: "LocaleCode", type: TYPES.NVarChar, value: locale },
      { name: "FallbackLocaleCode", type: TYPES.NVarChar, value: fallback },
      { name: "KeysJson", type: TYPES.NVarChar, value: JSON.stringify(uniqueKeys) },
    ],
    getCacheKey(["many", category, uniqueKeys, locale, fallback])
  );
}

async function getAllCategory(category, localeCode, fallbackLocaleCode = DEFAULT_LOCALE) {
  const locale = normalizeLocale(localeCode);
  const fallback = normalizeLocale(fallbackLocaleCode);
  return runProcedure(
    "EXEC dbo.usp_Lookup_GetCategoryAll @CategoryName, @LocaleCode, @FallbackLocaleCode",
    [
      { name: "CategoryName", type: TYPES.NVarChar, value: category },
      { name: "LocaleCode", type: TYPES.NVarChar, value: locale },
      { name: "FallbackLocaleCode", type: TYPES.NVarChar, value: fallback },
    ],
    getCacheKey(["category-all", category, locale, fallback])
  );
}

async function createCategory({ dataName, description = null }) {
  const result = await execQuery(
    "EXEC dbo.usp_DataCategory_Create @DataName, @Description",
    [
      { name: "DataName", type: TYPES.NVarChar, value: dataName },
      { name: "Description", type: TYPES.NVarChar, value: description },
    ]
  );
  clearCache();
  return result.rows[0] || null;
}

async function createLookup({ categoryName, searchKey, localeCode, textValue, comments = null, sortOrder = 0, createdByUserNameRegistryId = null }) {
  const result = await execQuery(
    "EXEC dbo.usp_Lookup_Create @CategoryName, @SearchKey, @LocaleCode, @TextValue, @Comments, @SortOrder, @CreatedByUserNameRegistryId",
    [
      { name: "CategoryName", type: TYPES.NVarChar, value: categoryName },
      { name: "SearchKey", type: TYPES.NVarChar, value: searchKey },
      { name: "LocaleCode", type: TYPES.NVarChar, value: normalizeLocale(localeCode) },
      { name: "TextValue", type: TYPES.NVarChar, value: textValue },
      { name: "Comments", type: TYPES.NVarChar, value: comments },
      { name: "SortOrder", type: TYPES.Int, value: Number(sortOrder || 0) },
      { name: "CreatedByUserNameRegistryId", type: TYPES.BigInt, value: createdByUserNameRegistryId == null ? null : Number(createdByUserNameRegistryId) },
    ]
  );
  clearCache();
  return result.rows[0] || null;
}

async function updateLookup({ lookupId, searchKey, comments = null, sortOrder = 0, isActive = true }) {
  await execQuery(
    "EXEC dbo.usp_Lookup_Update @LookupId, @SearchKey, @Comments, @SortOrder, @IsActive",
    [
      { name: "LookupId", type: TYPES.BigInt, value: Number(lookupId) },
      { name: "SearchKey", type: TYPES.NVarChar, value: searchKey },
      { name: "Comments", type: TYPES.NVarChar, value: comments },
      { name: "SortOrder", type: TYPES.Int, value: Number(sortOrder || 0) },
      { name: "IsActive", type: TYPES.Bit, value: isActive ? 1 : 0 },
    ]
  );
  clearCache();
}

async function upsertTranslation({ lookupId, localeCode, textValue, isActive = true, createdByUserNameRegistryId = null }) {
  await execQuery(
    "EXEC dbo.usp_LookupTranslation_Upsert @LookupId, @LocaleCode, @TextValue, @IsActive, @CreatedByUserNameRegistryId",
    [
      { name: "LookupId", type: TYPES.BigInt, value: Number(lookupId) },
      { name: "LocaleCode", type: TYPES.NVarChar, value: normalizeLocale(localeCode) },
      { name: "TextValue", type: TYPES.NVarChar, value: textValue },
      { name: "IsActive", type: TYPES.Bit, value: isActive ? 1 : 0 },
      { name: "CreatedByUserNameRegistryId", type: TYPES.BigInt, value: createdByUserNameRegistryId == null ? null : Number(createdByUserNameRegistryId) },
    ]
  );
  clearCache();
}

async function softDeleteLookup(lookupId) {
  await execQuery(
    "EXEC dbo.usp_Lookup_SoftDelete @LookupId",
    [{ name: "LookupId", type: TYPES.BigInt, value: Number(lookupId) }]
  );
  clearCache();
}

module.exports = {
  DEFAULT_LOCALE,
  clearCache,
  getSingle,
  getList,
  getMany,
  getAllCategory,
  createCategory,
  createLookup,
  updateLookup,
  upsertTranslation,
  softDeleteLookup,
};
