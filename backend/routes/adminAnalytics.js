const express = require("express");
const { z } = require("zod");
const { requireAuth } = require("../auth");
const { parseDateRange } = require("../utils/dateRange");
const { logException } = require("../services/exceptionLogger");
const {
  getMonthlyOverheadSetting,
  getUsageSummaryByRange,
  getProfitLossByRange,
  getAtRiskUsersByRange,
  setMonthlyOverheadSetting,
} = require("../services/adminAnalyticsService");

const router = express.Router();
router.use(requireAuth);

function requireAppAdmin(req, res, next) {
  if (!req.user || req.user.role !== "AppAdmin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

async function reportRouteFailure(req, error, routeName) {
  try {
    await logException({
      area: "admin-analytics",
      route: routeName,
      message: error?.message || "Admin analytics route failed",
      stack: error?.stack || null,
      userId: req?.user?.userId || null,
      userRole: req?.user?.role || null,
    });
  } catch {
    // Ignore logging failures for analytics fallbacks.
  }
}

const UpdateOverheadBody = z.object({
  monthlyOverheadUsd: z.number().min(0).max(1000000),
});

router.get("/admin/pnl/settings", requireAppAdmin, async (_req, res) => {
  try {
    const monthlyOverheadUsd = await getMonthlyOverheadSetting();
    return res.json({ monthlyOverheadUsd });
  } catch (error) {
    await reportRouteFailure(_req, error, "pnl-settings-get");
    return res.json({ monthlyOverheadUsd: 0 });
  }
});

router.put("/admin/pnl/settings", requireAppAdmin, async (req, res) => {
  try {
    const body = UpdateOverheadBody.parse(req.body || {});
    const settings = await setMonthlyOverheadSetting(body.monthlyOverheadUsd);
    return res.json(settings);
  } catch (error) {
    if (error?.name === "ZodError") {
      return res.status(400).json({ error: "Invalid monthly overhead amount." });
    }
    await reportRouteFailure(req, error, "pnl-settings-put");
    return res.status(500).json({ error: "Unable to save settings" });
  }
});

router.get("/admin/usage/summary", requireAppAdmin, async (req, res) => {
  const { fromDateString, toDateString } = parseDateRange(req.query || {});
  try {
    const summary = await getUsageSummaryByRange(fromDateString, toDateString);
    return res.json(summary);
  } catch (error) {
    if (error?.status === 400) {
      return res.status(400).json({ error: error.message });
    }
    await reportRouteFailure(req, error, "usage-summary");
    return res.json({
      fromDate: fromDateString,
      toDate: toDateString,
      distinctActiveUsers: 0,
      totalQuantity: 0,
      totalTrackedCostUsd: 0,
      totalsByEventType: [],
      topUsers: [],
    });
  }
});

router.get("/admin/pnl", requireAppAdmin, async (req, res) => {
  const { fromDateString, toDateString } = parseDateRange(req.query || {});
  try {
    const pnl = await getProfitLossByRange(fromDateString, toDateString);
    return res.json(pnl);
  } catch (error) {
    if (error?.status === 400) {
      return res.status(400).json({ error: error.message });
    }
    await reportRouteFailure(req, error, "pnl");
    return res.json({
      fromDate: fromDateString,
      toDate: toDateString,
      activePaidUsers: 0,
      activeFreeUsers: 0,
      revenueUsd: 0,
      aiCostUsd: 0,
      monthlyOverheadUsd: 0,
      overageCostUsd: 0,
      potentialChurnLossUsd: 0,
      netUsd: 0,
    });
  }
});

router.get("/admin/users/at-risk", requireAppAdmin, async (req, res) => {
  const { fromDateString, toDateString } = parseDateRange(req.query || {});
  try {
    const users = await getAtRiskUsersByRange(fromDateString, toDateString);
    return res.json({
      fromDate: fromDateString,
      toDate: toDateString,
      users,
    });
  } catch (error) {
    if (error?.status === 400) {
      return res.status(400).json({ error: error.message });
    }
    await reportRouteFailure(req, error, "users-at-risk");
    return res.json({
      fromDate: fromDateString,
      toDate: toDateString,
      users: [],
    });
  }
});

module.exports = router;
