const { randomUUID } = require("crypto");
const { TYPES } = require("tedious");
const { execQuery } = require("../db");
const path = require("path");

function safeString(value, fallback = "") {
  if (value == null) return fallback;
  return String(value);
}

function normalizeErrorMessage(err) {
  const msg = safeString(err && err.message, "Unknown error");
  return msg.slice(0, 2000);
}

function normalizeStack(err) {
  const stack = safeString(err && err.stack, "");
  return stack ? stack.slice(0, 8000) : null;
}

function safeJson(value) {
  if (value == null) return null;
  try {
    return JSON.stringify(value).slice(0, 8000);
  } catch {
    return null;
  }
}

let hasLocationColumnsCache = null;
let hasLocationColumnsCheckedAt = 0;

async function hasLocationColumns() {
  const now = Date.now();
  if (hasLocationColumnsCache != null && now - hasLocationColumnsCheckedAt < 60_000) {
    return hasLocationColumnsCache;
  }
  const result = await execQuery(
    `SELECT
       CASE
         WHEN COL_LENGTH('dbo.ExceptionLog', 'SourceFile') IS NOT NULL
          AND COL_LENGTH('dbo.ExceptionLog', 'SourceLine') IS NOT NULL
          AND COL_LENGTH('dbo.ExceptionLog', 'SourceColumn') IS NOT NULL
         THEN 1 ELSE 0
       END AS HasLocationColumns`
  );
  hasLocationColumnsCache = Number(result.rows[0]?.HasLocationColumns || 0) === 1;
  hasLocationColumnsCheckedAt = now;
  return hasLocationColumnsCache;
}

function parseSourceLocation(err) {
  const stack = safeString(err && err.stack, "");
  if (!stack) return { sourceFile: null, sourceLine: null, sourceColumn: null };

  const repoRoot = process.cwd().replace(/\//g, "\\").toLowerCase();
  const lines = stack.split(/\r?\n/).slice(1);
  const framePattern = /\(?([A-Za-z]:\\[^():]+):(\d+):(\d+)\)?$/;

  let fallback = null;
  for (const rawLine of lines) {
    const line = String(rawLine || "").trim();
    const match = line.match(framePattern);
    if (!match) continue;
    const fullPath = match[1];
    const normalizedPath = fullPath.replace(/\//g, "\\").toLowerCase();
    const candidate = {
      sourceFile: fullPath.slice(0, 400),
      sourceLine: Number(match[2]) || null,
      sourceColumn: Number(match[3]) || null,
    };
    if (!fallback) fallback = candidate;
    if (normalizedPath.includes("\\node_modules\\")) continue;
    if (normalizedPath.startsWith(repoRoot)) {
      return candidate;
    }
  }
  return fallback || { sourceFile: null, sourceLine: null, sourceColumn: null };
}

function attachCorrelationId(req, res, next) {
  const existing = req.headers["x-correlation-id"];
  const correlationId = safeString(existing || randomUUID()).slice(0, 64);
  req.correlationId = correlationId;
  res.setHeader("x-correlation-id", correlationId);
  next();
}

async function logException(payload = {}) {
  try {
    const err = payload.error || null;
    const locationEnabled = await hasLocationColumns();
    const sourceLocation = {
      sourceFile: payload.sourceFile || null,
      sourceLine: Number.isFinite(Number(payload.sourceLine)) ? Number(payload.sourceLine) : null,
      sourceColumn: Number.isFinite(Number(payload.sourceColumn)) ? Number(payload.sourceColumn) : null,
    };
    if (!sourceLocation.sourceFile && !sourceLocation.sourceLine && !sourceLocation.sourceColumn) {
      Object.assign(sourceLocation, parseSourceLocation(err));
    }
    const sql = locationEnabled
      ? `INSERT INTO dbo.ExceptionLog
         (CorrelationId, Source, Route, Method, UserId, UserRole, Stage, ErrorCode, ErrorMessage, StackTrace, MetaJson, SourceFile, SourceLine, SourceColumn)
         VALUES
         (@correlationId, @source, @route, @method, @userId, @userRole, @stage, @errorCode, @errorMessage, @stackTrace, @metaJson, @sourceFile, @sourceLine, @sourceColumn)`
      : `INSERT INTO dbo.ExceptionLog
         (CorrelationId, Source, Route, Method, UserId, UserRole, Stage, ErrorCode, ErrorMessage, StackTrace, MetaJson)
         VALUES
         (@correlationId, @source, @route, @method, @userId, @userRole, @stage, @errorCode, @errorMessage, @stackTrace, @metaJson)`;
    await execQuery(
      sql,
      [
        { name: "correlationId", type: TYPES.NVarChar, value: safeString(payload.correlationId || "").slice(0, 64) || null },
        { name: "source", type: TYPES.NVarChar, value: safeString(payload.source || "backend").slice(0, 120) || "backend" },
        { name: "route", type: TYPES.NVarChar, value: safeString(payload.route || "").slice(0, 260) || null },
        { name: "method", type: TYPES.NVarChar, value: safeString(payload.method || "").slice(0, 10) || null },
        { name: "userId", type: TYPES.Int, value: Number.isFinite(Number(payload.userId)) ? Number(payload.userId) : null },
        { name: "userRole", type: TYPES.NVarChar, value: safeString(payload.userRole || "").slice(0, 40) || null },
        { name: "stage", type: TYPES.NVarChar, value: safeString(payload.stage || "").slice(0, 120) || null },
        { name: "errorCode", type: TYPES.NVarChar, value: safeString(payload.errorCode || err?.code || "").slice(0, 80) || null },
        { name: "errorMessage", type: TYPES.NVarChar, value: normalizeErrorMessage(err || { message: payload.message || "Unknown error" }) },
        { name: "stackTrace", type: TYPES.NVarChar, value: normalizeStack(err) },
        { name: "metaJson", type: TYPES.NVarChar, value: safeJson(payload.meta) },
        ...(locationEnabled
          ? [
              { name: "sourceFile", type: TYPES.NVarChar, value: sourceLocation.sourceFile || null },
              { name: "sourceLine", type: TYPES.Int, value: Number.isFinite(sourceLocation.sourceLine) ? Number(sourceLocation.sourceLine) : null },
              { name: "sourceColumn", type: TYPES.Int, value: Number.isFinite(sourceLocation.sourceColumn) ? Number(sourceLocation.sourceColumn) : null },
            ]
          : []),
      ]
    );
  } catch (writeErr) {
    // Avoid recursion if logging itself fails.
    // eslint-disable-next-line no-console
    console.error("[exception-log-write-failed]", writeErr && writeErr.message ? writeErr.message : writeErr);
  }
}

module.exports = {
  attachCorrelationId,
  logException,
};
