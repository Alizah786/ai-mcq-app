require("dotenv").config({ path: __dirname + "/.env" });
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const { execQuery } = require("./db");

const authRoutes = require("./routes/auth");
const classesRoutes = require("./routes/classes");
const quizzesRoutes = require("./routes/quizzes");
const attemptsRoutes = require("./routes/attempts");

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

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

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});
