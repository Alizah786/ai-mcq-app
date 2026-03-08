const express = require("express");
const { z } = require("zod");
const { requireAuth } = require("../auth");
const {
  DEFAULT_LOCALE,
  getSingle,
  getList,
  getMany,
  createCategory,
  createLookup,
  updateLookup,
  upsertTranslation,
  softDeleteLookup,
} = require("../services/lookups/service");

const router = express.Router();

function getLocale(req) {
  return String(req.query.locale || req.body?.locale || DEFAULT_LOCALE).trim() || DEFAULT_LOCALE;
}

function requireAppAdmin(req, res, next) {
  if (!req.user || req.user.role !== "AppAdmin") {
    return res.status(403).json({ message: "Admin access required." });
  }
  next();
}

const categorySchema = z.object({
  dataName: z.string().trim().min(1).max(100),
  description: z.string().trim().max(300).nullable().optional(),
});

const createLookupSchema = z.object({
  categoryName: z.string().trim().min(1).max(100),
  searchKey: z.string().trim().min(1).max(150),
  localeCode: z.string().trim().min(2).max(20).optional(),
  textValue: z.string().trim().min(1).max(4000),
  comments: z.string().trim().max(4000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
});

const updateLookupSchema = z.object({
  searchKey: z.string().trim().min(1).max(150),
  comments: z.string().trim().max(4000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  isActive: z.boolean().optional(),
});

const translationSchema = z.object({
  localeCode: z.string().trim().min(2).max(20),
  textValue: z.string().trim().min(1).max(4000),
  isActive: z.boolean().optional(),
});

const bulkSchema = z.object({
  category: z.string().trim().min(1).max(100),
  locale: z.string().trim().min(2).max(20).optional(),
  keys: z.array(z.string().trim().min(1).max(150)).min(1).max(200),
});

router.get("/lookups", async (req, res) => {
  const category = String(req.query.category || "").trim();
  const key = String(req.query.key || "").trim();
  if (!category || !key) {
    return res.status(400).json({ message: "category and key are required." });
  }
  try {
    const value = await getSingle(category, key, getLocale(req));
    return res.json({ category, key, locale: getLocale(req), value });
  } catch {
    return res.status(500).json({ message: "Unable to load lookup value right now." });
  }
});

router.get("/lookups/list", async (req, res) => {
  const category = String(req.query.category || "").trim();
  const key = String(req.query.key || "").trim();
  if (!category || !key) {
    return res.status(400).json({ message: "category and key are required." });
  }
  try {
    const items = await getList(category, key, getLocale(req));
    return res.json({ category, key, locale: getLocale(req), items });
  } catch {
    return res.status(500).json({ message: "Unable to load lookup list right now." });
  }
});

router.post("/lookups/bulk", async (req, res) => {
  const parsed = bulkSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid bulk lookup request." });
  }
  try {
    const locale = parsed.data.locale || DEFAULT_LOCALE;
    const items = await getMany(parsed.data.category, parsed.data.keys, locale);
    return res.json({ category: parsed.data.category, locale, items });
  } catch {
    return res.status(500).json({ message: "Unable to load lookup values right now." });
  }
});

router.post("/admin/lookups/category", requireAuth, requireAppAdmin, async (req, res) => {
  const parsed = categorySchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid category payload." });
  }
  try {
    const category = await createCategory(parsed.data);
    return res.status(201).json({ category });
  } catch {
    return res.status(500).json({ message: "Unable to create lookup category right now." });
  }
});

router.post("/admin/lookups", requireAuth, requireAppAdmin, async (req, res) => {
  const parsed = createLookupSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid lookup payload." });
  }
  try {
    const lookup = await createLookup({
      ...parsed.data,
      localeCode: parsed.data.localeCode || DEFAULT_LOCALE,
      createdByUserNameRegistryId: req.user.userId,
    });
    return res.status(201).json({ lookup });
  } catch {
    return res.status(500).json({ message: "Unable to create lookup right now." });
  }
});

router.put("/admin/lookups/:lookupId", requireAuth, requireAppAdmin, async (req, res) => {
  const lookupId = Number(req.params.lookupId);
  const parsed = updateLookupSchema.safeParse(req.body || {});
  if (!Number.isFinite(lookupId) || lookupId <= 0 || !parsed.success) {
    return res.status(400).json({ message: "Invalid lookup update request." });
  }
  try {
    await updateLookup({ lookupId, ...parsed.data });
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ message: "Unable to update lookup right now." });
  }
});

router.put("/admin/lookups/:lookupId/translations/:localeCode", requireAuth, requireAppAdmin, async (req, res) => {
  const lookupId = Number(req.params.lookupId);
  const parsed = translationSchema.safeParse({
    ...req.body,
    localeCode: req.params.localeCode,
  });
  if (!Number.isFinite(lookupId) || lookupId <= 0 || !parsed.success) {
    return res.status(400).json({ message: "Invalid lookup translation request." });
  }
  try {
    await upsertTranslation({
      lookupId,
      localeCode: parsed.data.localeCode,
      textValue: parsed.data.textValue,
      isActive: parsed.data.isActive,
      createdByUserNameRegistryId: req.user.userId,
    });
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ message: "Unable to save lookup translation right now." });
  }
});

router.delete("/admin/lookups/:lookupId", requireAuth, requireAppAdmin, async (req, res) => {
  const lookupId = Number(req.params.lookupId);
  if (!Number.isFinite(lookupId) || lookupId <= 0) {
    return res.status(400).json({ message: "Invalid lookup id." });
  }
  try {
    await softDeleteLookup(lookupId);
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ message: "Unable to delete lookup right now." });
  }
});

module.exports = router;
