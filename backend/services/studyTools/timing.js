const { TYPES } = require("tedious");
const { execQuery } = require("../../db");

async function logStudyTiming(stage, meta = {}) {
  const payload = {
    at: new Date().toISOString(),
    stage,
    ...meta,
  };

  try {
    console.log(`[study-materials.timing] ${JSON.stringify(payload)}`);
  } catch {}

  try {
    await execQuery(
      `IF OBJECT_ID('dbo.StudyMaterialProcessingTiming', 'U') IS NOT NULL
         INSERT INTO dbo.StudyMaterialProcessingTiming
           (StudyMaterialSetId, StudyMaterialJobId, VersionNo, Stage, ElapsedMs, StageElapsedMs, StatusValue, ErrorCode, MetaJson, CreatedAtUtc)
         VALUES
           (@setId, @jobId, @versionNo, @stage, @elapsedMs, @stageElapsedMs, @statusValue, @errorCode, @metaJson, SYSUTCDATETIME())`,
      [
        { name: "setId", type: TYPES.Int, value: Number(meta?.studyMaterialSetId || 0) || null },
        { name: "jobId", type: TYPES.Int, value: Number(meta?.studyMaterialJobId || 0) || null },
        {
          name: "versionNo",
          type: TYPES.Int,
          value: Number.isFinite(Number(meta?.versionNo)) ? Number(meta.versionNo) : null,
        },
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
  logStudyTiming,
};
