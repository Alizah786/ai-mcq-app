const { TYPES } = require("tedious");
const { execQuery } = require("../../db");

async function logDocumentTiming(stage, meta = {}) {
  const payload = {
    at: new Date().toISOString(),
    stage,
    ...meta,
  };

  try {
    console.log(`[document.timing] ${JSON.stringify(payload)}`);
  } catch {}

  try {
    await execQuery(
      `IF OBJECT_ID('dbo.DocumentProcessingTiming', 'U') IS NOT NULL
         INSERT INTO dbo.DocumentProcessingTiming
           (DocumentId, Stage, ElapsedMs, StageElapsedMs, StatusValue, ErrorCode, MetaJson, CreatedAtUtc)
         VALUES
           (@documentId, @stage, @elapsedMs, @stageElapsedMs, @statusValue, @errorCode, @metaJson, SYSUTCDATETIME())`,
      [
        { name: "documentId", type: TYPES.Int, value: Number(meta?.documentId || 0) || null },
        { name: "stage", type: TYPES.NVarChar, value: String(stage || "").slice(0, 100) || null },
        {
          name: "elapsedMs",
          type: TYPES.Int,
          value: Number.isFinite(Number(meta?.elapsedMs)) ? Number(meta.elapsedMs) : null,
        },
        {
          name: "stageElapsedMs",
          type: TYPES.Int,
          value: Number.isFinite(Number(meta?.stageElapsedMs)) ? Number(meta.stageElapsedMs) : null,
        },
        {
          name: "statusValue",
          type: TYPES.NVarChar,
          value: meta?.status == null ? null : String(meta.status).slice(0, 50),
        },
        {
          name: "errorCode",
          type: TYPES.NVarChar,
          value: meta?.errorCode == null ? null : String(meta.errorCode).slice(0, 50),
        },
        {
          name: "metaJson",
          type: TYPES.NVarChar,
          value: JSON.stringify(payload).slice(0, 4000),
        },
      ]
    );
  } catch {}
}

module.exports = {
  logDocumentTiming,
};
