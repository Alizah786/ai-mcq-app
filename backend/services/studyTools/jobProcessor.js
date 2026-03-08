const { TYPES } = require("tedious");
const { execQuery } = require("../../db");
const { logException } = require("../exceptionLogger");
const {
  StudyToolError,
  truncateStudyText,
  isLikelyCourseOutline,
  supportsOutlineOutputs,
  OUTLINE_LIMITED_WARNING,
  enforceOutputLimits,
  parseImageDataUrl,
  safePublicMessage,
} = require("./common");
const { validateStudyInput, validateImageStudyInput, generateStudyOutput, generateStudyOutputFromImage } = require("./pythonClient");
const { validateSpecificSubjectTopic, preprocessStudyText, ensureStructuredNotes, classifyStudySource } = require("./preprocess");
const { logStudyTiming } = require("./timing");

function parseJsonSafe(value, fallback) {
  try {
    if (value == null || value === "") return fallback;
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function computeBackoff(attemptCount) {
  if (attemptCount <= 1) return 30;
  if (attemptCount === 2) return 120;
  return 600;
}

async function markJobAndSetState(job, updates = {}) {
  const setStatus = updates.setStatus || null;
  const jobStatus = updates.jobStatus || null;
  const errorCode = updates.errorCode || null;
  const lastErrorSafe = updates.lastErrorSafe || null;
  const lockClear = updates.lockClear === true;

  if (jobStatus) {
    await execQuery(
      `UPDATE dbo.StudyMaterialJob
       SET Status = @status,
           ErrorCode = @errorCode,
           LastErrorSafe = @lastErrorSafe,
           UpdatedAtUtc = SYSUTCDATETIME(),
           LockedUntilUtc = ${lockClear ? "NULL" : "LockedUntilUtc"}
       WHERE StudyMaterialJobId = @jobId`,
      [
        { name: "status", type: TYPES.NVarChar, value: jobStatus },
        { name: "errorCode", type: TYPES.NVarChar, value: errorCode },
        { name: "lastErrorSafe", type: TYPES.NVarChar, value: lastErrorSafe },
        { name: "jobId", type: TYPES.Int, value: Number(job.StudyMaterialJobId) },
      ]
    );
  }

  if (setStatus) {
    await execQuery(
      `UPDATE dbo.StudyMaterialSet
       SET Status = @status, UpdatedAtUtc = SYSUTCDATETIME()
       WHERE StudyMaterialSetId = @setId`,
      [
        { name: "status", type: TYPES.NVarChar, value: setStatus },
        { name: "setId", type: TYPES.Int, value: Number(job.StudyMaterialSetId) },
      ]
    );
  }
}

async function hasAssignmentsColumn() {
  const result = await execQuery(
    `SELECT CASE WHEN COL_LENGTH('dbo.StudyMaterialVersion', 'AssignmentsJson') IS NULL THEN 0 ELSE 1 END AS HasAssignments`
  );
  return Number(result.rows[0]?.HasAssignments || 0) === 1;
}

async function failWithRetry(job, err) {
  const nextAttempt = Number(job.AttemptCount || 0) + 1;
  const maxAttempts = Number(job.MaxAttempts || 3);
  const code = String(err?.code || "PROCESSING_FAILED").slice(0, 50);
  const safe = safePublicMessage(code);

  if (nextAttempt >= maxAttempts) {
    await execQuery(
      `UPDATE dbo.StudyMaterialJob
       SET AttemptCount = @attemptCount,
           Status = 'Failed',
           ErrorCode = @errorCode,
           LastErrorSafe = @lastErrorSafe,
           LockedUntilUtc = NULL,
           UpdatedAtUtc = SYSUTCDATETIME()
       WHERE StudyMaterialJobId = @jobId`,
      [
        { name: "attemptCount", type: TYPES.Int, value: nextAttempt },
        { name: "errorCode", type: TYPES.NVarChar, value: code },
        { name: "lastErrorSafe", type: TYPES.NVarChar, value: safe },
        { name: "jobId", type: TYPES.Int, value: Number(job.StudyMaterialJobId) },
      ]
    );
    await markJobAndSetState(job, { setStatus: "Failed" });
    return;
  }

  const backoffSec = computeBackoff(nextAttempt);
  await execQuery(
    `UPDATE dbo.StudyMaterialJob
     SET AttemptCount = @attemptCount,
         Status = 'Retrying',
         ErrorCode = @errorCode,
         LastErrorSafe = @lastErrorSafe,
         NextRetryAtUtc = DATEADD(SECOND, @backoffSeconds, SYSUTCDATETIME()),
         LockedUntilUtc = NULL,
         UpdatedAtUtc = SYSUTCDATETIME()
     WHERE StudyMaterialJobId = @jobId`,
    [
      { name: "attemptCount", type: TYPES.Int, value: nextAttempt },
      { name: "errorCode", type: TYPES.NVarChar, value: code },
      { name: "lastErrorSafe", type: TYPES.NVarChar, value: safe },
      { name: "backoffSeconds", type: TYPES.Int, value: backoffSec },
      { name: "jobId", type: TYPES.Int, value: Number(job.StudyMaterialJobId) },
    ]
  );
  await markJobAndSetState(job, { setStatus: "Processing" });
}

async function loadJobContext(studyMaterialJobId) {
  const assignmentsEnabled = await hasAssignmentsColumn();
  const r = await execQuery(
    `SELECT j.StudyMaterialJobId, j.StudyMaterialSetId, j.VersionNo, j.Status, j.AttemptCount, j.MaxAttempts, j.CreatedAtUtc AS JobCreatedAtUtc,
            s.OwnerUserId, s.OwnerRole, s.RoleContext, s.TeacherId, s.StudentId, s.ClassId, s.CourseCode,
            s.DocumentUploadId, s.SourceType, s.PastedText, s.Subject, s.Topic, s.OutputsJson, s.OptionsJson, s.CreatedAtUtc AS SetCreatedAtUtc,
            v.StudyMaterialVersionId, v.NotesMarkdown, v.FlashcardsJson, v.KeywordsJson, v.SummaryText${assignmentsEnabled ? ", v.AssignmentsJson" : ", CAST(NULL AS NVARCHAR(MAX)) AS AssignmentsJson"}
     FROM dbo.StudyMaterialJob j
     JOIN dbo.StudyMaterialSet s ON s.StudyMaterialSetId = j.StudyMaterialSetId
     JOIN dbo.StudyMaterialVersion v ON v.StudyMaterialSetId = j.StudyMaterialSetId AND v.VersionNo = j.VersionNo
     WHERE j.StudyMaterialJobId = @jobId`,
    [{ name: "jobId", type: TYPES.Int, value: Number(studyMaterialJobId) }]
  );
  return r.rows[0] || null;
}

async function loadSourceText(ctx) {
  if (String(ctx.SourceType) === "Image") {
    return {
      text: String(ctx.PastedText || ""),
      originalFileName: "",
    };
  }
  if (String(ctx.SourceType) === "PastedText") {
    return {
      text: String(ctx.PastedText || ""),
      originalFileName: "",
    };
  }
  if (String(ctx.SourceType) === "TopicOnly") {
    return {
      text: `Study subject: ${String(ctx.Subject || "")}\nStudy topic: ${String(ctx.Topic || "")}\nGenerate revision material using general academic knowledge about this topic.`,
      originalFileName: "",
    };
  }
  const r = await execQuery(
    `SELECT TOP 1 Status, ExtractedText, OriginalFileName
     FROM dbo.DocumentUpload
     WHERE DocumentId = @documentId AND DeletedAtUtc IS NULL`,
    [{ name: "documentId", type: TYPES.Int, value: Number(ctx.DocumentUploadId) }]
  );
  const row = r.rows[0];
  if (!row || String(row.Status || "") !== "Extracted") {
    throw new StudyToolError("Document is not ready for study tools.", 422, "SOURCE_NOT_READY");
  }
  return {
    text: String(row.ExtractedText || ""),
    originalFileName: String(row.OriginalFileName || ""),
  };
}

async function processStudyMaterialJobById(studyMaterialJobId) {
  const startedAt = Date.now();
  const ctx = await loadJobContext(studyMaterialJobId);
  if (!ctx) return false;

  try {
    await logStudyTiming("job_started", {
      studyMaterialJobId,
      studyMaterialSetId: Number(ctx.StudyMaterialSetId),
      versionNo: Number(ctx.VersionNo),
      status: String(ctx.Status || ""),
      queueWaitMs: ctx.JobCreatedAtUtc ? Math.max(0, Date.now() - new Date(ctx.JobCreatedAtUtc).getTime()) : null,
      sourceType: String(ctx.SourceType || ""),
    });

    const alreadyPopulated =
      String(ctx.NotesMarkdown || "").trim() ||
      String(ctx.FlashcardsJson || "").trim() ||
      String(ctx.KeywordsJson || "").trim() ||
      String(ctx.AssignmentsJson || "").trim();

    if (alreadyPopulated) {
      await logStudyTiming("job_skipped_already_populated", {
        studyMaterialJobId,
        studyMaterialSetId: Number(ctx.StudyMaterialSetId),
        versionNo: Number(ctx.VersionNo),
        elapsedMs: Date.now() - startedAt,
      });
      await markJobAndSetState(ctx, { jobStatus: "Succeeded", setStatus: "Completed", lockClear: true });
      return true;
    }

    const subjectValidationStartedAt = Date.now();
    validateSpecificSubjectTopic(String(ctx.Subject || ""), String(ctx.Topic || ""));
    await logStudyTiming("subject_topic_validated", {
      studyMaterialJobId,
      studyMaterialSetId: Number(ctx.StudyMaterialSetId),
      versionNo: Number(ctx.VersionNo),
      elapsedMs: Date.now() - startedAt,
      stageElapsedMs: Date.now() - subjectValidationStartedAt,
    });
    const outputs = parseJsonSafe(ctx.OutputsJson, []);
    const options = parseJsonSafe(ctx.OptionsJson, {});
    let generated;
    if (String(ctx.SourceType) === "Image") {
      const imagePreparationStartedAt = Date.now();
      const image = parseImageDataUrl(String(ctx.PastedText || ""));
      const validation = await validateImageStudyInput({
        subject: String(ctx.Subject || ""),
        topic: String(ctx.Topic || ""),
        imageMimeType: image.mimeType,
      });
      await logStudyTiming("image_validated", {
        studyMaterialJobId,
        studyMaterialSetId: Number(ctx.StudyMaterialSetId),
        versionNo: Number(ctx.VersionNo),
        elapsedMs: Date.now() - startedAt,
        stageElapsedMs: Date.now() - imagePreparationStartedAt,
      });
      if (!validation?.isEducationRelated) {
        throw new StudyToolError("Image content could not be processed as study material.", 422, "TOPIC_MISMATCH");
      }
      const generationStartedAt = Date.now();
      generated = await generateStudyOutputFromImage({
        subject: String(ctx.Subject || ""),
        topic: String(ctx.Topic || ""),
        imageDataUrl: image.dataUrl,
        imageMimeType: image.mimeType,
        outputs,
        options,
      });
      await logStudyTiming("provider_generation_completed", {
        studyMaterialJobId,
        studyMaterialSetId: Number(ctx.StudyMaterialSetId),
        versionNo: Number(ctx.VersionNo),
        elapsedMs: Date.now() - startedAt,
        stageElapsedMs: Date.now() - generationStartedAt,
        provider: generated?._meta?.provider || null,
        model: generated?._meta?.model || null,
        providerChain: Array.isArray(generated?._meta?.chain) ? generated._meta.chain.join(",") : null,
        sourceKind: generated?._meta?.sourceKind || "image",
      });
    } else {
      const sourceLoadStartedAt = Date.now();
      const source = await loadSourceText(ctx);
      const rawText = String(source?.text || "");
      const originalFileName = String(source?.originalFileName || "");
      await logStudyTiming("source_loaded", {
        studyMaterialJobId,
        studyMaterialSetId: Number(ctx.StudyMaterialSetId),
        versionNo: Number(ctx.VersionNo),
        elapsedMs: Date.now() - startedAt,
        stageElapsedMs: Date.now() - sourceLoadStartedAt,
        sourceChars: String(rawText || "").length,
      });
      const normalized = truncateStudyText(rawText, 200000);
      const preprocessStartedAt = Date.now();
      const preprocessed = preprocessStudyText(normalized, String(ctx.Subject || ""), String(ctx.Topic || ""));
      const isTopicOnlySource = String(ctx.SourceType || "") === "TopicOnly";
      const isOutlineSource =
        isLikelyCourseOutline(normalized, originalFileName)
        || isLikelyCourseOutline(preprocessed.normalizedText, originalFileName);
      if (!isTopicOnlySource && isOutlineSource && !supportsOutlineOutputs(outputs)) {
        throw new StudyToolError("Course outlines only support notes/keywords generation.", 422, "OUTLINE_OUTPUTS_LIMITED");
      }
      await logStudyTiming("preprocess_completed", {
        studyMaterialJobId,
        studyMaterialSetId: Number(ctx.StudyMaterialSetId),
        versionNo: Number(ctx.VersionNo),
        elapsedMs: Date.now() - startedAt,
        stageElapsedMs: Date.now() - preprocessStartedAt,
        filteredChars: String(preprocessed.filteredText || "").length,
      });
      if (!isTopicOnlySource && preprocessed.isMixedSubject && !isOutlineSource) {
        throw new StudyToolError(
          "This document contains multiple subjects. Please choose a specific subject/topic or upload a single-subject document.",
          422,
          "MIXED_SUBJECT_DOCUMENT"
        );
      }

      const sourceClass = classifyStudySource(preprocessed.filteredText);
      if (!isTopicOnlySource && !isOutlineSource && sourceClass.type === "assignment") {
        if (!outputs.includes("assignments")) outputs.push("assignments");
      } else if (!isTopicOnlySource && !isOutlineSource && outputs.length === 1 && outputs[0] === "assignments") {
        outputs.length = 0;
        outputs.push("notes", "keywords", "summary");
      }

      if (!isTopicOnlySource) {
        const validationStartedAt = Date.now();
        const validation = await validateStudyInput({
          subject: String(ctx.Subject || ""),
          topic: String(ctx.Topic || ""),
          text: preprocessed.filteredText,
        });
        await logStudyTiming("content_validated", {
          studyMaterialJobId,
          studyMaterialSetId: Number(ctx.StudyMaterialSetId),
          versionNo: Number(ctx.VersionNo),
          elapsedMs: Date.now() - startedAt,
          stageElapsedMs: Date.now() - validationStartedAt,
          educationRelated: !!validation?.isEducationRelated,
          topicMatchesDoc: validation?.topicMatchesDoc === false ? "false" : "true",
          outlineLimited: isOutlineSource || !!validation?.isCourseOutline ? OUTLINE_LIMITED_WARNING : null,
        });
        if (validation?.isCourseOutline && !supportsOutlineOutputs(outputs)) {
          throw new StudyToolError("Course outlines only support notes/keywords generation.", 422, "OUTLINE_OUTPUTS_LIMITED");
        }
        if (validation?.isMixedSubject && !isOutlineSource && !validation?.isCourseOutline) {
          throw new StudyToolError(
            "This document contains multiple subjects. Please choose a specific subject/topic or upload a single-subject document.",
            422,
            "MIXED_SUBJECT_DOCUMENT"
          );
        }
        if (!validation?.isEducationRelated) {
          throw new StudyToolError("Topic mismatch.", 422, "TOPIC_MISMATCH");
        }
      }

      const generationStartedAt = Date.now();
      generated = await generateStudyOutput({
        subject: String(ctx.Subject || ""),
        topic: String(ctx.Topic || ""),
        text: preprocessed.filteredText,
        outputs,
        options,
        sourceClass: sourceClass.type,
      });
      await logStudyTiming("provider_generation_completed", {
        studyMaterialJobId,
        studyMaterialSetId: Number(ctx.StudyMaterialSetId),
        versionNo: Number(ctx.VersionNo),
        elapsedMs: Date.now() - startedAt,
        stageElapsedMs: Date.now() - generationStartedAt,
        provider: generated?._meta?.provider || null,
        model: generated?._meta?.model || null,
        providerChain: Array.isArray(generated?._meta?.chain) ? generated._meta.chain.join(",") : null,
        sourceKind: generated?._meta?.sourceKind || "text",
      });
    }
    const normalizeOutputsStartedAt = Date.now();
    const safe = enforceOutputLimits(generated, options, { skipWordMinimum: true });
    if (safe.notesMarkdown) ensureStructuredNotes(safe.notesMarkdown);
    await logStudyTiming("outputs_normalized", {
      studyMaterialJobId,
      studyMaterialSetId: Number(ctx.StudyMaterialSetId),
      versionNo: Number(ctx.VersionNo),
      elapsedMs: Date.now() - startedAt,
      stageElapsedMs: Date.now() - normalizeOutputsStartedAt,
      hasNotes: !!safe.notesMarkdown,
      flashcardCount: Array.isArray(safe.flashcards) ? safe.flashcards.length : 0,
      assignmentCount: Array.isArray(safe.assignments) ? safe.assignments.length : 0,
    });

    const assignmentsEnabled = await hasAssignmentsColumn();
    const assignmentsUpdateFragment = assignmentsEnabled ? ",\n           AssignmentsJson = @assignmentsJson" : "";
    const updateVersionSql = `UPDATE dbo.StudyMaterialVersion
       SET Title = @title,
           SummaryText = @summary,
           KeywordsJson = @keywordsJson,
           NotesMarkdown = @notesMarkdown,
           FlashcardsJson = @flashcardsJson${assignmentsUpdateFragment}
       WHERE StudyMaterialVersionId = @versionId`;
    const saveStartedAt = Date.now();
    await execQuery(
      updateVersionSql,
      [
        { name: "title", type: TYPES.NVarChar, value: safe.title || null },
        { name: "summary", type: TYPES.NVarChar, value: safe.summary || null },
        { name: "keywordsJson", type: TYPES.NVarChar, value: safe.keywords?.length ? JSON.stringify(safe.keywords) : null },
        { name: "notesMarkdown", type: TYPES.NVarChar, value: safe.notesMarkdown || null },
        { name: "flashcardsJson", type: TYPES.NVarChar, value: safe.flashcards?.length ? JSON.stringify(safe.flashcards) : null },
        ...(assignmentsEnabled
          ? [{ name: "assignmentsJson", type: TYPES.NVarChar, value: safe.assignments?.length ? JSON.stringify(safe.assignments) : null }]
          : []),
        { name: "versionId", type: TYPES.Int, value: Number(ctx.StudyMaterialVersionId) },
      ]
    );

    await execQuery(
      `UPDATE dbo.StudyMaterialJob
       SET Status = 'Succeeded',
           ErrorCode = NULL,
           LastErrorSafe = NULL,
           LockedUntilUtc = NULL,
           UpdatedAtUtc = SYSUTCDATETIME()
       WHERE StudyMaterialJobId = @jobId`,
      [{ name: "jobId", type: TYPES.Int, value: Number(studyMaterialJobId) }]
    );
    await execQuery(
      `UPDATE dbo.StudyMaterialSet
       SET Status = 'Completed',
           LatestVersionNo = @versionNo,
           UpdatedAtUtc = SYSUTCDATETIME()
       WHERE StudyMaterialSetId = @setId`,
      [
        { name: "versionNo", type: TYPES.Int, value: Number(ctx.VersionNo) },
        { name: "setId", type: TYPES.Int, value: Number(ctx.StudyMaterialSetId) },
      ]
    );
    await logStudyTiming("job_completed", {
      studyMaterialJobId,
      studyMaterialSetId: Number(ctx.StudyMaterialSetId),
      versionNo: Number(ctx.VersionNo),
      elapsedMs: Date.now() - startedAt,
      stageElapsedMs: Date.now() - saveStartedAt,
    });
    return true;
  } catch (err) {
    await logStudyTiming("job_failed", {
      studyMaterialJobId,
      studyMaterialSetId: Number(ctx.StudyMaterialSetId),
      versionNo: Number(ctx.VersionNo),
      elapsedMs: Date.now() - startedAt,
      errorCode: String(err?.code || "PROCESSING_FAILED"),
    });
    await logException({
      source: "studyMaterials.worker",
      stage: "process_job_failed",
      userId: ctx.OwnerUserId || null,
      userRole: ctx.OwnerRole || null,
      error: err instanceof Error ? err : new Error(String(err)),
      meta: {
        studyMaterialJobId,
        studyMaterialSetId: ctx.StudyMaterialSetId,
        versionNo: ctx.VersionNo,
      },
    });
    await failWithRetry(ctx, err);
    return false;
  }
}

async function claimNextStudyMaterialJob() {
  const r = await execQuery(
    `;WITH next_job AS (
        SELECT TOP (1) StudyMaterialJobId
        FROM dbo.StudyMaterialJob WITH (UPDLOCK, READPAST, ROWLOCK)
        WHERE Status IN ('Queued', 'Retrying')
          AND (NextRetryAtUtc IS NULL OR NextRetryAtUtc <= SYSUTCDATETIME())
          AND (LockedUntilUtc IS NULL OR LockedUntilUtc < SYSUTCDATETIME())
        ORDER BY CreatedAtUtc ASC, StudyMaterialJobId ASC
      )
      UPDATE j
      SET Status = 'Processing',
          LockedUntilUtc = DATEADD(SECOND, 120, SYSUTCDATETIME()),
          UpdatedAtUtc = SYSUTCDATETIME()
      OUTPUT INSERTED.StudyMaterialJobId
      FROM dbo.StudyMaterialJob j
      INNER JOIN next_job n ON n.StudyMaterialJobId = j.StudyMaterialJobId;`
  );
  const id = Number(
    r.rows[0]?.StudyMaterialJobId ||
      r.rows[0]?.[""] ||
      Object.values(r.rows[0] || {})[0] ||
      0
  );
  if (id) {
    const ctx = await loadJobContext(id);
    if (ctx) {
      await logStudyTiming("job_claimed", {
        studyMaterialJobId: Number(ctx.StudyMaterialJobId),
        studyMaterialSetId: Number(ctx.StudyMaterialSetId),
        versionNo: Number(ctx.VersionNo),
        status: "Processing",
        queueWaitMs: ctx.JobCreatedAtUtc ? Math.max(0, Date.now() - new Date(ctx.JobCreatedAtUtc).getTime()) : null,
      });
    }
  }
  return id || null;
}

async function processNextStudyMaterialJob() {
  const id = await claimNextStudyMaterialJob();
  if (!id) return false;
  await processStudyMaterialJobById(id);
  return true;
}

module.exports = {
  processStudyMaterialJobById,
  processNextStudyMaterialJob,
};







