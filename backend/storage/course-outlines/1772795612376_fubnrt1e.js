require("dotenv").config({ path: __dirname + "/.env" });
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const { execQuery } = require("./db");
const { attachCorrelationId, logException } = require("./services/exceptionLogger");
const { attachRequestLocale } = require("./middleware/locale");

const authRoutes = require("./routes/auth");
const classesRoutes = require("./routes/classes");
const quizzesRoutes = require("./routes/quizzes");
const attemptsRoutes = require("./routes/attempts");
const aiRoutes = require("./routes/ai");
const importRoutes = require("./routes/import");
const managerRoutes = require("./routes/manager");
const billingRoutes = require("./routes/billing");
const { stripeWebhookHandler } = require("./routes/billing");
const passwordRoutes = require("./routes/password");
const documentRoutes = require("./routes/document");
const studyMaterialsRoutes = require("./routes/studyMaterials");
const lookupRoutes = require("./routes/lookups");
const adminAnalyticsRoutes = require("./routes/adminAnalytics");
const usersRoutes = require("./routes/users");

const app = express();

app.use(helmet());
app.use(cors());
app.post("/api/billing/webhook", express.raw({ type: "application/json" }), stripeWebhookHandler);
app.use(express.json({ limit: "12mb" }));
app.use(morgan("dev"));
app.use(attachCorrelationId);
app.use(attachRequestLocale);

// Health (no auth)
app.get("/health", (req, res) => {
  res.json({ ok: true, service: "ai-mcq-backend", time: new Date().toISOString() });
});
app.get("/health/db", async (req, res) => {
  try {
    const r = await execQuery("SELECT 1 AS ok");
    res.json({ ok: true, db: r.rows[0] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// API
app.use("/api/auth", authRoutes);
app.use("/api", classesRoutes);
app.use("/api", quizzesRoutes);
app.use("/api", attemptsRoutes);
app.use("/api", aiRoutes);
app.use("/api", importRoutes);
app.use("/api", managerRoutes);
app.use("/api", billingRoutes);
app.use("/api", passwordRoutes);
app.use("/api", documentRoutes);
app.use("/api", studyMaterialsRoutes);
app.use("/api", lookupRoutes);
app.use("/api", adminAnalyticsRoutes);
app.use("/api", usersRoutes);

app.use((err, req, res, _next) => {
  logException({
    correlationId: req?.correlationId || null,
    source: "express",
    route: req?.originalUrl || req?.url || null,
    method: req?.method || null,
    userId: req?.user?.userId || null,
    userRole: req?.user?.role || null,
    stage: "unhandled_route_error",
    error: err,
  });
  const message = "Unexpected server error.";
  return res.status(500).json({ message, correlationId: req?.correlationId || null });
});

process.on("unhandledRejection", (reason) => {
  logException({
    source: "process",
    stage: "unhandledRejection",
    error: reason instanceof Error ? reason : new Error(String(reason)),
    meta: { reasonType: typeof reason },
  });
  // eslint-disable-next-line no-console
  console.error("[unhandledRejection]", reason);
});

process.on("uncaughtException", (err) => {
  logException({
    source: "process",
    stage: "uncaughtException",
    error: err,
  });
  // eslint-disable-next-line no-console
  console.error("[uncaughtException]", err);
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});
