const express = require("express");
const { z } = require("zod");
const { TYPES } = require("tedious");
const { requireAuth } = require("../auth");
const { execQuery } = require("../db");
const { PaymentRequiredError } = require("../services/paymentErrors");
const { logException } = require("../services/exceptionLogger");
const { assertCanGenerateStudyTools } = require("../services/subscription");
const {
  StudyToolError,
  OUTLINE_BLOCK_MESSAGE,
  OUTLINE_LIMITED_WARNING,
  OUTLINE_OUTPUTS_LIMITED_MESSAGE,
  loadOwnerRegistryId,
  normalizeOutputs,
  normalizeOptions,
  normalizeWhitespace,
  truncateStudyText,
  isLikelyCourseOutline,
  supportsOutlineOutputs,
  enforceOutputLimits,
  loadAccessibleDocumentForUser,
  parseImageDataUrl,
  safePublicMessage,
} = require("../services/studyTools/common");
const { validateStudyInput, validateImageStudyInput, generateStudyOutputFromImage } = require("../services/studyTools/pythonClient");
const { validateSpecificSubjectTopic, preprocessStudyText, classifyStudySource } = require("../services/studyTools/preprocess");
const { logUsageEventByActor } = require("../services/usageEvents");

const router = express.Router();
router.use(requireAuth);
const STUDY_MATERIALS_ROUTE_VERSION = "studyMaterials-route-2026-03-01-01";
router.use((req, res, next) => {
  res.setHeader("x-study-materials-route-version", STUDY_MATERIALS_ROUTE_VERSION);
  next();
});

const CreateBody = z.object({
  subject: z.string().trim().min(1).max(120),
  topic: z.string().trim().min(1).max(180),
  outputs: z.array(z.enum(["notes", "flashcards", "keywords", "summary", "assignments"])).min(1).max(4),
  documentUploadId: z.number().int().positive().optional(),
  pastedText: z.string().max(200000).optional(),
  imageDataUrl: z.string().max(10000000).optional(),
  imageMimeType: z.string().max(100).optional(),
  classId: z.number().int().positive().optional(),
  courseCode: z.string().trim().max(80).optional(),
  userChosenCategory: z.enum(["STUDY_NOTES", "FLASH_CARDS", "KEYWORDS", "ASSIGNMENT", "STUDY_NOTES_AND_FLASH_CARDS"]).optional(),
  userOverrodeSuggestion: z.boolean().optional(),
  options: z
    .object({
      notesLength: z.enum(["Short", "Medium", "Long"]).optional(),
      flashcardCount: z.number().int().min(5).max(50).optional(),
      assignmentCount: z.number().int().min(3).max(20).optional(),
      difficulty: z.enum(["Easy", "Mixed", "Hard"]).optional(),
      includeDefinitions: z.boolean().optional(),
      includeExamples: z.boolean().optional(),
    })
    .optional(),
});

const UpdateVersionBody = z.object({
  summary: z.string().max(1200).optional(),
  keywords: z.array(z.string().max(40)).max(30).optional(),
  notesMarkdown: z.string().max(200000).optional(),
  flashcards: z
    .array(
      z.object({
        front: z.string().min(1).max(180),
        back: z.string().min(1).max(400),
        tags: z.array(z.string().max(40)).max(8).optional(),
        difficulty: z.enum(["Easy", "Medium", "Hard"]).optional(),
      })
    )
    .min(1)
    .max(50)
    .optional(),
  assignments: z
    .array(
      z.object({
        question: z.string().min(1).max(1200),
        example: z.string().max(2000).optional(),
        explanation: z.string().max(3000).optional(),
        difficulty: z.enum(["Easy", "Medium", "Hard"]).optional(),
      })
    )
    .min(1)
    .max(20)
    .optional(),
});

const RegenerateBody = z
  .object({
    outputs: z.array(z.enum(["notes", "flashcards", "keywords", "summary", "assignments"])).min(1).max(4).optional(),
    options: z
      .object({
        notesLength: z.enum(["Short", "Medium", "Long"]).optional(),
        flashcardCount: z.number().int().min(5).max(50).optional(),
        assignmentCount: z.number().int().min(3).max(20).optional(),
        difficulty: z.enum(["Easy", "Mixed", "Hard"]).optional(),
        includeDefinitions: z.boolean().optional(),
        includeExamples: z.boolean().optional(),
      })
      .optional(),
  })
  .optional();

async function logStudyError(req, stage, err, meta = null) {
  const callerLocation = captureCallerLocation();
  await logException({
    source: "studyMaterials.route",
    route: req?.originalUrl || req?.url || null,
    method: req?.method || null,
    userId: req?.user?.userId || null,
    userRole: req?.user?.role || null,
    stage,
    error: err instanceof Error ? err : new Error(String(err)),
    meta,
    sourceFile: callerLocation.sourceFile,
    sourceLine: callerLocation.sourceLine,
    sourceColumn: callerLocation.sourceColumn,
  });
}

function captureCallerLocation() {
  const stack = String(new Error().stack || "");
  const lines = stack.split(/\r?\n/).slice(1);
  const framePattern = /\(?([A-Za-z]:\\[^():]+):(\d+):(\d+)\)?$/;
  const currentFile = __filename.replace(/\//g, "\\").toLowerCase();
  for (const rawLine of lines) {
    const line = String(rawLine || "").trim();
    const match = line.match(framePattern);
    if (!match) continue;
    const sourceFile = match[1];
    if (sourceFile.replace(/\//g, "\\").toLowerCase() !== currentFile) continue;
    return {
      sourceFile: sourceFile.slice(0, 400),
      sourceLine: Number(match[2]) || null,
      sourceColumn: Number(match[3]) || null,
    };
  }
  return { sourceFile: __filename, sourceLine: null, sourceColumn: null };
}

function addOutputIfMissing(outputs, value) {
  if (!Array.isArray(outputs) || !value) return;
  if (!outputs.includes(value)) outputs.push(value);
}

function supportsTopicOnlyOutputs(outputs) {
  const list = Array.isArray(outputs) ? outputs : [];
  return list.length > 0 && !list.includes("assignments");
}

async function hasAssignmentsColumn() {
  const result = await execQuery(
    `SELECT CASE WHEN COL_LENGTH('dbo.StudyMaterialVersion', 'AssignmentsJson') IS NULL THEN 0 ELSE 1 END AS HasAssignments`
  );
  return Number(result.rows[0]?.HasAssignments || 0) === 1;
}

async function listStudyMaterialsByOwner(ownerUserId) {
  try {
    return await execQuery(
      "EXEC dbo.usp_StudyMaterials_ListByOwner @OwnerUserId",
      [{ name: "OwnerUserId", type: TYPES.Int, value: Number(ownerUserId || 0) }]
    );
  } catch {
    const assignmentsEnabled = await hasAssignmentsColumn();
    return execQuery(
      `SELECT
         s.StudyMaterialSetId,
         s.Subject,
         s.Topic,
         s.Status,
         s.OutputsJson,
         s.LatestVersionNo,
         s.CreatedAtUtc,
         s.UpdatedAtUtc,
         v.Title,
         v.SummaryText,
         v.KeywordsJson,
         v.NotesMarkdown,
         v.FlashcardsJson${assignmentsEnabled ? ", v.AssignmentsJson" : ", CAST(NULL AS NVARCHAR(MAX)) AS AssignmentsJson"},
         v.IsUserEdited,
         v.CreatedAtUtc AS VersionCreatedAtUtc
       FROM dbo.StudyMaterialSet s
       OUTER APPLY (
         SELECT TOP 1 VersionNo, Title, SummaryText, KeywordsJson, NotesMarkdown, FlashcardsJson${assignmentsEnabled ? ", AssignmentsJson" : ", CAST(NULL AS NVARCHAR(MAX)) AS AssignmentsJson"}, IsUserEdited, CreatedAtUtc
         FROM dbo.StudyMaterialVersion
         WHERE StudyMaterialSetId = s.StudyMaterialSetId
           AND VersionNo = s.LatestVersionNo
       ) v
       WHERE s.OwnerUserId = @ownerUserId
       ORDER BY ISNULL(s.UpdatedAtUtc, s.CreatedAtUtc) DESC, s.StudyMaterialSetId DESC`,
      [{ name: "ownerUserId", type: TYPES.Int, value: Number(ownerUserId || 0) }]
    );
  }
}

async function persistDocumentCategoryChoice(documentId, userChosenCategory, userOverrodeSuggestion) {
  if (!documentId || !userChosenCategory) return;
  await execQuery(
    `IF COL_LENGTH('dbo.DocumentUpload', 'UserChosenCategory') IS NOT NULL
       UPDATE dbo.DocumentUpload
       SET UserChosenCategory = @userChosenCategory,
           UserOverrodeSuggestion = @userOverrodeSuggestion,
           LastModifiedDate = SYSUTCDATETIME()
       WHERE DocumentId = @documentId;`,
    [
      { name: "documentId", type: TYPES.Int, value: Number(documentId) },
      { name: "userChosenCategory", type: TYPES.NVarChar, value: userChosenCategory },
      { name: "userOverrodeSuggestion", type: TYPES.Bit, value: userOverrodeSuggestion ? 1 : 0 },
    ]
  );
}

function roleContextForUser(user) {
  return String(user?.role || "") === "Manager" ? "Teacher" : "Student";
}

async function assertStudySetAccess(req, setId) {
  const r = await execQuery(
    `SELECT TOP 1 *
     FROM dbo.StudyMaterialSet
     WHERE StudyMaterialSetId = @setId`,
    [{ name: "setId", type: TYPES.Int, value: Number(setId) }]
  );
  const row = r.rows[0];
  if (!row) throw new StudyToolError("Study material not found.", 404, "NOT_FOUND");
  if (Number(row.OwnerUserId || 0) !== Number(req.user?.userId || 0)) {
    throw new StudyToolError("Forbidden.", 403, "FORBIDDEN");
  }
  return row;
}

async function createSetVersionJob({
  req,
  subject,
  topic,
  outputs,
  options,
  sourceType,
  documentUploadId,
  pastedText,
  classId,
  courseCode,
  teacherId,
  studentId,
}) {
  const ownerRegistryId = await loadOwnerRegistryId(req.user);
  const roleContext = roleContextForUser(req.user);
  const r = await execQuery(
    `SET XACT_ABORT ON;
     BEGIN TRAN;
       DECLARE @set TABLE (StudyMaterialSetId INT);
       INSERT INTO dbo.StudyMaterialSet
         (OwnerUserNameRegistryId, OwnerUserId, OwnerRole, RoleContext, TeacherId, StudentId, ClassId, CourseCode, DocumentUploadId,
          SourceType, PastedText, Subject, Topic, OutputsJson, OptionsJson, Status, LatestVersionNo, CreatedAtUtc, UpdatedAtUtc)
       OUTPUT INSERTED.StudyMaterialSetId INTO @set(StudyMaterialSetId)
       VALUES
         (@ownerRegistryId, @ownerUserId, @ownerRole, @roleContext, @teacherId, @studentId, @classId, @courseCode, @documentUploadId,
          @sourceType, @pastedText, @subject, @topic, @outputsJson, @optionsJson, 'Queued', 1, SYSUTCDATETIME(), SYSUTCDATETIME());

       INSERT INTO dbo.StudyMaterialVersion
         (StudyMaterialSetId, VersionNo, IsUserEdited, CreatedAtUtc)
       SELECT StudyMaterialSetId, 1, 0, SYSUTCDATETIME()
       FROM @set;

       INSERT INTO dbo.StudyMaterialJob
         (StudyMaterialSetId, VersionNo, Status, AttemptCount, MaxAttempts, NextRetryAtUtc, LockedUntilUtc, CreatedAtUtc, UpdatedAtUtc)
       SELECT StudyMaterialSetId, 1, 'Queued', 0, 3, SYSUTCDATETIME(), NULL, SYSUTCDATETIME(), SYSUTCDATETIME()
       FROM @set;

       SELECT TOP 1 StudyMaterialSetId FROM @set;
     COMMIT;`,
    [
      { name: "ownerRegistryId", type: TYPES.Int, value: ownerRegistryId },
      { name: "ownerUserId", type: TYPES.Int, value: Number(req.user?.userId || 0) },
      { name: "ownerRole", type: TYPES.NVarChar, value: roleContext },
      { name: "roleContext", type: TYPES.NVarChar, value: roleContext },
      { name: "teacherId", type: TYPES.Int, value: teacherId || null },
      { name: "studentId", type: TYPES.Int, value: studentId || null },
      { name: "classId", type: TYPES.Int, value: classId || null },
      { name: "courseCode", type: TYPES.NVarChar, value: courseCode || null },
      { name: "documentUploadId", type: TYPES.Int, value: documentUploadId || null },
      { name: "sourceType", type: TYPES.NVarChar, value: sourceType },
      { name: "pastedText", type: TYPES.NVarChar, value: pastedText || null },
      { name: "subject", type: TYPES.NVarChar, value: subject },
      { name: "topic", type: TYPES.NVarChar, value: topic },
      { name: "outputsJson", type: TYPES.NVarChar, value: JSON.stringify(outputs) },
      { name: "optionsJson", type: TYPES.NVarChar, value: JSON.stringify(options) },
    ]
  );
  const id = Number(r.rows[0]?.StudyMaterialSetId || 0);
  if (!id) throw new StudyToolError("Failed to create study job.", 500, "INTERNAL");
  return id;
}

async function createCompletedSetVersion({
  req,
  subject,
  topic,
  outputs,
  options,
  sourceType,
  documentUploadId,
  pastedText,
  classId,
  courseCode,
  teacherId,
  studentId,
  generated,
}) {
  const ownerRegistryId = await loadOwnerRegistryId(req.user);
  const roleContext = roleContextForUser(req.user);
  const safe = enforceOutputLimits(generated, options, { skipWordMinimum: true });
  const assignmentsEnabled = await hasAssignmentsColumn();
  const insertVersionSql = `SET XACT_ABORT ON;
     BEGIN TRAN;
       DECLARE @set TABLE (StudyMaterialSetId INT);
       INSERT INTO dbo.StudyMaterialSet
         (OwnerUserNameRegistryId, OwnerUserId, OwnerRole, RoleContext, TeacherId, StudentId, ClassId, CourseCode, DocumentUploadId,
          SourceType, PastedText, Subject, Topic, OutputsJson, OptionsJson, Status, LatestVersionNo, CreatedAtUtc, UpdatedAtUtc)
       OUTPUT INSERTED.StudyMaterialSetId INTO @set(StudyMaterialSetId)
       VALUES
         (@ownerRegistryId, @ownerUserId, @ownerRole, @roleContext, @teacherId, @studentId, @classId, @courseCode, @documentUploadId,
          @sourceType, @pastedText, @subject, @topic, @outputsJson, @optionsJson, 'Completed', 1, SYSUTCDATETIME(), SYSUTCDATETIME());

       INSERT INTO dbo.StudyMaterialVersion
         (StudyMaterialSetId, VersionNo, Title, SummaryText, KeywordsJson, NotesMarkdown, FlashcardsJson${assignmentsEnabled ? ", AssignmentsJson" : ""}, IsUserEdited, CreatedAtUtc)
       SELECT
         StudyMaterialSetId,
         1,
         @title,
         @summary,
         @keywordsJson,
         @notesMarkdown,
         @flashcardsJson${assignmentsEnabled ? ", @assignmentsJson" : ""},
         0,
         SYSUTCDATETIME()
       FROM @set;

       SELECT TOP 1 StudyMaterialSetId FROM @set;
     COMMIT;`;
  const r = await execQuery(
    insertVersionSql,
    [
      { name: "ownerRegistryId", type: TYPES.Int, value: ownerRegistryId },
      { name: "ownerUserId", type: TYPES.Int, value: Number(req.user?.userId || 0) },
      { name: "ownerRole", type: TYPES.NVarChar, value: roleContext },
      { name: "roleContext", type: TYPES.NVarChar, value: roleContext },
      { name: "teacherId", type: TYPES.Int, value: teacherId || null },
      { name: "studentId", type: TYPES.Int, value: studentId || null },
      { name: "classId", type: TYPES.Int, value: classId || null },
      { name: "courseCode", type: TYPES.NVarChar, value: courseCode || null },
      { name: "documentUploadId", type: TYPES.Int, value: documentUploadId || null },
      { name: "sourceType", type: TYPES.NVarChar, value: sourceType },
      { name: "pastedText", type: TYPES.NVarChar, value: pastedText || null },
      { name: "subject", type: TYPES.NVarChar, value: subject },
      { name: "topic", type: TYPES.NVarChar, value: topic },
      { name: "outputsJson", type: TYPES.NVarChar, value: JSON.stringify(outputs) },
      { name: "optionsJson", type: TYPES.NVarChar, value: JSON.stringify(options) },
      { name: "title", type: TYPES.NVarChar, value: safe.title || null },
      { name: "summary", type: TYPES.NVarChar, value: safe.summary || null },
      { name: "keywordsJson", type: TYPES.NVarChar, value: safe.keywords?.length ? JSON.stringify(safe.keywords) : null },
      { name: "notesMarkdown", type: TYPES.NVarChar, value: safe.notesMarkdown || null },
      { name: "flashcardsJson", type: TYPES.NVarChar, value: safe.flashcards?.length ? JSON.stringify(safe.flashcards) : null },
      ...(assignmentsEnabled
        ? [{ name: "assignmentsJson", type: TYPES.NVarChar, value: safe.assignments?.length ? JSON.stringify(safe.assignments) : null }]
        : []),
    ]
  );
  const id = Number(r.rows[0]?.StudyMaterialSetId || 0);
  if (!id) throw new StudyToolError("Failed to create study material.", 500, "INTERNAL");
  return id;
}

router.get("/study-materials", async (req, res) => {
  try {
    const rows = await listStudyMaterialsByOwner(req.user?.userId);

    return res.json({
      ok: true,
      routeVersion: STUDY_MATERIALS_ROUTE_VERSION,
      studyMaterials: (rows.rows || []).map((row) => {
        let declaredOutputs = [];
        let flashcards = [];
        let keywords = [];
        try {
          declaredOutputs = JSON.parse(String(row.OutputsJson || "[]"));
        } catch {}
        try {
          flashcards = row.FlashcardsJson ? JSON.parse(String(row.FlashcardsJson || "[]")) : [];
        } catch {}
        let assignments = [];
        try {
          assignments = row.AssignmentsJson ? JSON.parse(String(row.AssignmentsJson || "[]")) : [];
        } catch {}
        try {
          keywords = row.KeywordsJson ? JSON.parse(String(row.KeywordsJson || "[]")) : [];
        } catch {}
        const outputs = [];
        if (declaredOutputs.includes("notes") && String(row.NotesMarkdown || "").trim()) outputs.push("notes");
        if (declaredOutputs.includes("flashcards") && Array.isArray(flashcards) && flashcards.length) outputs.push("flashcards");
        if (declaredOutputs.includes("keywords") && Array.isArray(keywords) && keywords.length) outputs.push("keywords");
        if (declaredOutputs.includes("summary") && String(row.SummaryText || "").trim()) outputs.push("summary");
        if (declaredOutputs.includes("assignments") && Array.isArray(assignments) && assignments.length) outputs.push("assignments");
        return {
          studyMaterialSetId: Number(row.StudyMaterialSetId),
          subject: row.Subject || "",
          topic: row.Topic || "",
          status: row.Status || "",
          outputs,
          latestVersionNo: Number(row.LatestVersionNo || 0),
          title: row.Title || "",
          flashcardCount: Array.isArray(flashcards) ? flashcards.length : 0,
          assignmentCount: Array.isArray(assignments) ? assignments.length : 0,
          isUserEdited: !!row.IsUserEdited,
          createdAtUtc: row.CreatedAtUtc || null,
          updatedAtUtc: row.UpdatedAtUtc || null,
          versionCreatedAtUtc: row.VersionCreatedAtUtc || null,
        };
      }),
    });
  } catch (err) {
    await logStudyError(req, "list_sets_failed", err);
    const code = err instanceof StudyToolError ? err.code : "INTERNAL";
    const status = err instanceof StudyToolError ? err.status : 500;
    return res.status(status).json({ ok: false, errorCode: code, message: safePublicMessage(code) });
  }
});

router.get("/study-materials/documents", async (req, res) => {
  try {
    const classId = Number(req.query?.classId || 0) || null;
    const role = String(req.user?.role || "");
    let sql = `
      SELECT TOP 100
        DocumentId, OriginalFileName, CourseCode, ClassId, UploadedAtUtc, ExtractedTextLength, WarningCodes
      FROM dbo.DocumentUpload
      WHERE DeletedAtUtc IS NULL
        AND Status = 'Extracted'
    `;
    const params = [];
    if (role === "Manager") {
      sql += " AND TeacherId = @userId";
      params.push({ name: "userId", type: TYPES.Int, value: Number(req.user.userId) });
    } else if (role === "Student") {
      sql += " AND StudentId = @userId";
      params.push({ name: "userId", type: TYPES.Int, value: Number(req.user.userId) });
    } else {
      throw new StudyToolError("Forbidden.", 403, "FORBIDDEN");
    }
    if (classId) {
      sql += " AND ClassId = @classId";
      params.push({ name: "classId", type: TYPES.Int, value: classId });
    }
    sql += " ORDER BY UploadedAtUtc DESC, DocumentId DESC";
    const r = await execQuery(sql, params);
    return res.json({
      ok: true,
      documents: (r.rows || []).map((d) => ({
        documentId: Number(d.DocumentId),
        originalFileName: d.OriginalFileName || "",
        courseCode: d.CourseCode || "",
        classId: d.ClassId == null ? null : Number(d.ClassId),
        uploadedAtUtc: d.UploadedAtUtc || null,
        extractedTextLength: Number(d.ExtractedTextLength || 0),
        warningCodes: String(d.WarningCodes || "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      })),
    });
  } catch (err) {
    await logStudyError(req, "list_documents_failed", err);
    const code = err instanceof StudyToolError ? err.code : "INTERNAL";
    const status = err instanceof StudyToolError ? err.status : 500;
    return res.status(status).json({ ok: false, errorCode: code, message: safePublicMessage(code) });
  }
});

router.post("/study-materials", async (req, res) => {
  try {
    const body = CreateBody.parse(req.body || {});
    await assertCanGenerateStudyTools(req.user.role, req.user.userId, 1);
    const subject = String(body.subject || "").trim();
    const topic = String(body.topic || "").trim();
    if (!subject || !topic) throw new StudyToolError("Subject and topic are required.");
    validateSpecificSubjectTopic(subject, topic);

    const outputs = normalizeOutputs(body.outputs);
    const options = normalizeOptions(body.options || {});
    const pasted = normalizeWhitespace(body.pastedText || "");
    const imageData = String(body.imageDataUrl || "").trim();
    let sourceType = "Document";
    if (imageData) sourceType = "Image";
    else if (pasted) sourceType = "PastedText";
    else if (!body.documentUploadId && supportsTopicOnlyOutputs(outputs)) sourceType = "TopicOnly";

    if (sourceType === "Document" && !body.documentUploadId) {
      throw new StudyToolError("documentUploadId, pastedText, or imageDataUrl is required.");
    }

    let textSource = "";
    let document = null;
    let parsedImage = null;
    if (sourceType === "Document") {
      document = await loadAccessibleDocumentForUser(req.user, Number(body.documentUploadId));
      if (String(document.Status || "") !== "Extracted") {
        throw new StudyToolError("Selected document is not ready yet.", 400, "SOURCE_NOT_READY");
      }
      textSource = String(document.ExtractedText || "");
    } else if (sourceType === "Image") {
      parsedImage = parseImageDataUrl(imageData);
    } else if (sourceType === "TopicOnly") {
      textSource = `Study subject: ${subject}\nStudy topic: ${topic}\nGenerate revision material using general academic knowledge about this topic.`;
    } else {
      if (pasted.length < 200) {
        throw new StudyToolError("Pasted text must be at least 200 characters.");
      }
      textSource = pasted;
    }

    let topicWarning = null;
    let autoSwitchMessage = null;
    let storedPastedText = sourceType === "TopicOnly" ? textSource : null;
    let completedImageOutput = null;
    if (sourceType === "Image") {
      const validation = await validateImageStudyInput({
        subject,
        topic,
        imageMimeType: parsedImage.mimeType,
      });
      if (!validation?.isEducationRelated) {
        throw new StudyToolError("Image content could not be processed as study material.", 400, "TOPIC_MISMATCH");
      }
      storedPastedText = parsedImage.dataUrl;
      completedImageOutput = await generateStudyOutputFromImage({
        subject,
        topic,
        imageDataUrl: parsedImage.dataUrl,
        imageMimeType: parsedImage.mimeType,
        outputs,
        options,
      });
    } else {
      const truncatedText = truncateStudyText(textSource, 200000);
      const preprocessed = preprocessStudyText(truncatedText, subject, topic);
      const isTopicOnlySource = sourceType === "TopicOnly";
      const isOutlineSource =
        isLikelyCourseOutline(textSource, document?.OriginalFileName || "")
        || isLikelyCourseOutline(preprocessed.normalizedText, document?.OriginalFileName || "");
      if (!isTopicOnlySource && isOutlineSource && !supportsOutlineOutputs(outputs)) {
        throw new StudyToolError(OUTLINE_OUTPUTS_LIMITED_MESSAGE, 400, "OUTLINE_OUTPUTS_LIMITED");
      }
      if (!isTopicOnlySource && isOutlineSource) {
        topicWarning = OUTLINE_LIMITED_WARNING;
      }
      const sourceClass = classifyStudySource(preprocessed.normalizedText, document?.OriginalFileName || "");
      if (!isTopicOnlySource && !isOutlineSource && sourceClass.type === "assignment") {
        const userSelectedAssessment = String(body.userChosenCategory || "") === "ASSIGNMENT";
        const hadAssignments = outputs.includes("assignments");
        if (!userSelectedAssessment) {
          addOutputIfMissing(outputs, "assignments");
        }
        if (!userSelectedAssessment && !hadAssignments) {
          autoSwitchMessage = outputs.includes("flashcards")
            ? "This source looks like an assessment such as an assignment, quiz, exam, or test. Your selected output will be generated, and Assessment was also added."
            : "This source looks like an assessment such as an assignment, quiz, exam, or test. Assessment was added from the document type.";
        }
      } else if (!isTopicOnlySource && !isOutlineSource && sourceType === "PastedText" && outputs.length === 1 && outputs[0] === "assignments") {
        outputs.length = 0;
        outputs.push("notes", "keywords", "summary");
        autoSwitchMessage = "This source looks like study content. Output was switched from Assessment to Notes.";
      }
      if (!isTopicOnlySource && preprocessed.isMixedSubject && !isOutlineSource) {
        throw new StudyToolError(
          "This document contains multiple subjects. Please choose a specific subject/topic or upload a single-subject document.",
          400,
          "MIXED_SUBJECT_DOCUMENT"
        );
      }

      if (!isTopicOnlySource) {
        const validation = await validateStudyInput({ subject, topic, text: preprocessed.filteredText });
        if (validation?.isCourseOutline && !supportsOutlineOutputs(outputs)) {
          throw new StudyToolError(OUTLINE_OUTPUTS_LIMITED_MESSAGE, 400, "OUTLINE_OUTPUTS_LIMITED");
        }
        if (validation?.isCourseOutline) {
          topicWarning = OUTLINE_LIMITED_WARNING;
        }
        if (validation?.isMixedSubject && !isOutlineSource && !validation?.isCourseOutline) {
          throw new StudyToolError(
            "This document contains multiple subjects. Please choose a specific subject/topic or upload a single-subject document.",
            400,
            "MIXED_SUBJECT_DOCUMENT"
          );
        }
        if (!validation?.isEducationRelated) {
          throw new StudyToolError("Topic/subject does not seem related to the uploaded document.", 400, "TOPIC_MISMATCH");
        }

        topicWarning =
          validation?.topicMatchesDoc === false && sourceClass.type !== "assignment"
            ? "Warning: the topic may not closely match the uploaded document. Generation will continue using the document content."
            : null;
      }
      storedPastedText = isTopicOnlySource
        ? (preprocessed.filteredText || textSource)
        : sourceType === "PastedText"
          ? preprocessed.filteredText
          : null;
      if (sourceType === "Document") {
        await persistDocumentCategoryChoice(
          Number(body.documentUploadId),
          body.userChosenCategory || null,
          !!body.userOverrodeSuggestion
        );
      }
    }

    const role = roleContextForUser(req.user);
    const commonPayload = {
      req,
      subject,
      topic,
      outputs,
      options,
      sourceType,
      documentUploadId: sourceType === "Document" ? Number(body.documentUploadId) : null,
      pastedText: storedPastedText,
      classId: document?.ClassId || body.classId || null,
      courseCode: document?.CourseCode || body.courseCode || null,
      teacherId: role === "Teacher" ? Number(req.user.userId) : Number(document?.TeacherId || 0) || null,
      studentId: role === "Student" ? Number(req.user.userId) : Number(document?.StudentId || 0) || null,
    };

    if (sourceType === "Image") {
      const studyMaterialSetId = await createCompletedSetVersion({
        ...commonPayload,
        generated: completedImageOutput,
      });
      logUsageEventByActor({
        role: req.user.role,
        userId: req.user.userId,
        eventType: "AI_JOB",
        quantity: 1,
      }).catch(() => {});
      return res.status(201).json({
        ok: true,
        studyMaterialSetId,
        status: "Completed",
        warning: autoSwitchMessage || topicWarning,
        effectiveOutputs: outputs,
      });
    }

    const studyMaterialSetId = await createSetVersionJob(commonPayload);
    logUsageEventByActor({
      role: req.user.role,
      userId: req.user.userId,
      eventType: "AI_JOB",
      quantity: 1,
    }).catch(() => {});
    return res.status(202).json({
      ok: true,
      studyMaterialSetId,
      status: "Queued",
      warning: autoSwitchMessage || topicWarning,
      effectiveOutputs: outputs,
    });
  } catch (err) {
    if (err?.name === "ZodError") {
      return res.status(400).json({ ok: false, errorCode: "INVALID_INPUT", message: "Invalid request body." });
    }
    if (err instanceof PaymentRequiredError) {
      return res.status(402).json({
        ok: false,
        errorCode: "PAYMENT_REQUIRED",
        message: err.message,
        paymentRequired: true,
        redirectTo: "/pricing",
      });
    }
    const code = err instanceof StudyToolError ? err.code : "INTERNAL";
    const status = err instanceof StudyToolError ? err.status : 500;
    await logStudyError(req, "create_failed", err, {
      code,
      status,
      sourceType:
        String(req?.body?.pastedText || "").trim().length > 0
          ? "PastedText"
          : req?.body?.documentUploadId
            ? "Document"
            : "Unknown",
    });
    const message = err instanceof StudyToolError && status < 500 ? err.message : safePublicMessage(code);
    return res.status(status).json({ ok: false, errorCode: code, message });
  }
});

router.get("/study-materials/:id", async (req, res) => {
  try {
    const assignmentsEnabled = await hasAssignmentsColumn();
    const setId = Number(req.params.id);
    if (!Number.isFinite(setId) || setId <= 0) throw new StudyToolError("Not found.", 404, "NOT_FOUND");
    const setRow = await assertStudySetAccess(req, setId);
    const versions = await execQuery(
      `SELECT VersionNo, Title, SummaryText, KeywordsJson, NotesMarkdown, FlashcardsJson${assignmentsEnabled ? ", AssignmentsJson" : ", CAST(NULL AS NVARCHAR(MAX)) AS AssignmentsJson"}, IsUserEdited, CreatedAtUtc
       FROM dbo.StudyMaterialVersion
       WHERE StudyMaterialSetId = @setId
       ORDER BY VersionNo DESC`,
      [{ name: "setId", type: TYPES.Int, value: setId }]
    );
    const latest = versions.rows.find((v) => Number(v.VersionNo) === Number(setRow.LatestVersionNo)) || versions.rows[0] || null;
    return res.json({
      ok: true,
      studyMaterial: {
        studyMaterialSetId: Number(setRow.StudyMaterialSetId),
        status: setRow.Status,
        sourceType: setRow.SourceType,
        subject: setRow.Subject,
        topic: setRow.Topic,
        outputs: JSON.parse(String(setRow.OutputsJson || "[]")),
        latestVersionNo: Number(setRow.LatestVersionNo || 0),
        updatedAtUtc: setRow.UpdatedAtUtc || null,
        latestVersion: latest
          ? {
              versionNo: Number(latest.VersionNo),
              title: latest.Title || "",
              summary: latest.SummaryText || "",
              keywords: latest.KeywordsJson ? JSON.parse(String(latest.KeywordsJson || "[]")) : [],
              notesMarkdown: latest.NotesMarkdown || "",
              flashcards: latest.FlashcardsJson ? JSON.parse(String(latest.FlashcardsJson || "[]")) : [],
              assignments: latest.AssignmentsJson ? JSON.parse(String(latest.AssignmentsJson || "[]")) : [],
              isUserEdited: !!latest.IsUserEdited,
              createdAtUtc: latest.CreatedAtUtc || null,
            }
          : null,
        versions: versions.rows.map((v) => ({
          versionNo: Number(v.VersionNo),
          createdAtUtc: v.CreatedAtUtc || null,
          isUserEdited: !!v.IsUserEdited,
        })),
      },
    });
  } catch (err) {
    await logStudyError(req, "get_set_failed", err, { studyMaterialSetId: req.params?.id || null });
    const code = err instanceof StudyToolError ? err.code : "INTERNAL";
    const status = err instanceof StudyToolError ? err.status : 500;
    return res.status(status).json({ ok: false, errorCode: code, message: safePublicMessage(code) });
  }
});

router.get("/study-materials/:id/versions/:versionNo", async (req, res) => {
  try {
    const assignmentsEnabled = await hasAssignmentsColumn();
    const setId = Number(req.params.id);
    const versionNo = Number(req.params.versionNo);
    if (!Number.isFinite(setId) || setId <= 0 || !Number.isFinite(versionNo) || versionNo <= 0) {
      throw new StudyToolError("Not found.", 404, "NOT_FOUND");
    }
    await assertStudySetAccess(req, setId);
    const r = await execQuery(
      `SELECT VersionNo, Title, SummaryText, KeywordsJson, NotesMarkdown, FlashcardsJson${assignmentsEnabled ? ", AssignmentsJson" : ", CAST(NULL AS NVARCHAR(MAX)) AS AssignmentsJson"}, IsUserEdited, CreatedAtUtc
       FROM dbo.StudyMaterialVersion
       WHERE StudyMaterialSetId = @setId AND VersionNo = @versionNo`,
      [
        { name: "setId", type: TYPES.Int, value: setId },
        { name: "versionNo", type: TYPES.Int, value: versionNo },
      ]
    );
    const row = r.rows[0];
    if (!row) throw new StudyToolError("Version not found.", 404, "NOT_FOUND");
    return res.json({
      ok: true,
      version: {
        versionNo: Number(row.VersionNo),
        title: row.Title || "",
        summary: row.SummaryText || "",
        keywords: row.KeywordsJson ? JSON.parse(String(row.KeywordsJson || "[]")) : [],
        notesMarkdown: row.NotesMarkdown || "",
        flashcards: row.FlashcardsJson ? JSON.parse(String(row.FlashcardsJson || "[]")) : [],
        assignments: row.AssignmentsJson ? JSON.parse(String(row.AssignmentsJson || "[]")) : [],
        isUserEdited: !!row.IsUserEdited,
        createdAtUtc: row.CreatedAtUtc || null,
      },
    });
  } catch (err) {
    await logStudyError(req, "get_version_failed", err, {
      studyMaterialSetId: req.params?.id || null,
      versionNo: req.params?.versionNo || null,
    });
    const code = err instanceof StudyToolError ? err.code : "INTERNAL";
    const status = err instanceof StudyToolError ? err.status : 500;
    return res.status(status).json({ ok: false, errorCode: code, message: safePublicMessage(code) });
  }
});

router.put("/study-materials/:id/versions/:versionNo", async (req, res) => {
  try {
    const assignmentsEnabled = await hasAssignmentsColumn();
    const setId = Number(req.params.id);
    const versionNo = Number(req.params.versionNo);
    if (!Number.isFinite(setId) || setId <= 0 || !Number.isFinite(versionNo) || versionNo <= 0) {
      throw new StudyToolError("Not found.", 404, "NOT_FOUND");
    }
    await assertStudySetAccess(req, setId);
    const body = UpdateVersionBody.parse(req.body || {});
    const versionRow = await execQuery(
      `SELECT StudyMaterialVersionId
       FROM dbo.StudyMaterialVersion
       WHERE StudyMaterialSetId = @setId AND VersionNo = @versionNo`,
      [
        { name: "setId", type: TYPES.Int, value: setId },
        { name: "versionNo", type: TYPES.Int, value: versionNo },
      ]
    );
    const id = Number(versionRow.rows[0]?.StudyMaterialVersionId || 0);
    if (!id) throw new StudyToolError("Version not found.", 404, "NOT_FOUND");

    const sanitized = enforceOutputLimits(
      {
        title: "",
        summary: body.summary || "",
        keywords: body.keywords || [],
        notesMarkdown: body.notesMarkdown || "",
        flashcards: body.flashcards || [],
        assignments: body.assignments || [],
      },
      { notesLength: "Long" },
      { skipWordMinimum: true }
    );
    const assignmentsUpdateFragment = assignmentsEnabled ? ",\n           AssignmentsJson = @assignmentsJson" : "";
    const updateVersionSql = `UPDATE dbo.StudyMaterialVersion
       SET SummaryText = @summary,
           KeywordsJson = @keywordsJson,
           NotesMarkdown = @notesMarkdown,
           FlashcardsJson = @flashcardsJson${assignmentsUpdateFragment},
           IsUserEdited = 1
       WHERE StudyMaterialVersionId = @id`;

    await execQuery(
      updateVersionSql,
      [
        { name: "summary", type: TYPES.NVarChar, value: sanitized.summary || null },
        { name: "keywordsJson", type: TYPES.NVarChar, value: sanitized.keywords?.length ? JSON.stringify(sanitized.keywords) : null },
        { name: "notesMarkdown", type: TYPES.NVarChar, value: sanitized.notesMarkdown || null },
        { name: "flashcardsJson", type: TYPES.NVarChar, value: sanitized.flashcards?.length ? JSON.stringify(sanitized.flashcards) : null },
        ...(assignmentsEnabled
          ? [{ name: "assignmentsJson", type: TYPES.NVarChar, value: sanitized.assignments?.length ? JSON.stringify(sanitized.assignments) : null }]
          : []),
        { name: "id", type: TYPES.Int, value: id },
      ]
    );
    await execQuery(
      `UPDATE dbo.StudyMaterialSet SET UpdatedAtUtc = SYSUTCDATETIME() WHERE StudyMaterialSetId = @setId`,
      [{ name: "setId", type: TYPES.Int, value: setId }]
    );
    return res.json({ ok: true, message: "Saved." });
  } catch (err) {
    if (err?.name === "ZodError") {
      await logStudyError(req, "update_version_zod_error", err, {
        studyMaterialSetId: req.params?.id || null,
        versionNo: req.params?.versionNo || null,
      });
      return res.status(400).json({ ok: false, errorCode: "INVALID_INPUT", message: "Invalid request body." });
    }
    await logStudyError(req, "update_version_failed", err, {
      studyMaterialSetId: req.params?.id || null,
      versionNo: req.params?.versionNo || null,
    });
    const code = err instanceof StudyToolError ? err.code : "INTERNAL";
    const status = err instanceof StudyToolError ? err.status : 500;
    const message = err instanceof StudyToolError && status < 500 ? err.message : safePublicMessage(code);
    return res.status(status).json({ ok: false, errorCode: code, message });
  }
});

router.post("/study-materials/:id/regenerate", async (req, res) => {
  try {
    const setId = Number(req.params.id);
    if (!Number.isFinite(setId) || setId <= 0) throw new StudyToolError("Not found.", 404, "NOT_FOUND");
    const setRow = await assertStudySetAccess(req, setId);
    await assertCanGenerateStudyTools(req.user.role, req.user.userId, 1);
    const body = RegenerateBody.parse(req.body || {});
    const outputs = body?.outputs ? normalizeOutputs(body.outputs) : JSON.parse(String(setRow.OutputsJson || "[]"));
    const options = body?.options ? normalizeOptions(body.options || {}) : JSON.parse(String(setRow.OptionsJson || "{}"));
    const nextVersion = Number(setRow.LatestVersionNo || 0) + 1;

    await execQuery(
      `SET XACT_ABORT ON;
       BEGIN TRAN;
         INSERT INTO dbo.StudyMaterialVersion
           (StudyMaterialSetId, VersionNo, IsUserEdited, CreatedAtUtc)
         VALUES
           (@setId, @versionNo, 0, SYSUTCDATETIME());

         INSERT INTO dbo.StudyMaterialJob
           (StudyMaterialSetId, VersionNo, Status, AttemptCount, MaxAttempts, NextRetryAtUtc, LockedUntilUtc, CreatedAtUtc, UpdatedAtUtc)
         VALUES
           (@setId, @versionNo, 'Queued', 0, 3, SYSUTCDATETIME(), NULL, SYSUTCDATETIME(), SYSUTCDATETIME());

         UPDATE dbo.StudyMaterialSet
         SET LatestVersionNo = @versionNo,
             Status = 'Queued',
             OutputsJson = @outputsJson,
             OptionsJson = @optionsJson,
             UpdatedAtUtc = SYSUTCDATETIME()
         WHERE StudyMaterialSetId = @setId;
       COMMIT;`,
      [
        { name: "setId", type: TYPES.Int, value: setId },
        { name: "versionNo", type: TYPES.Int, value: nextVersion },
        { name: "outputsJson", type: TYPES.NVarChar, value: JSON.stringify(outputs) },
        { name: "optionsJson", type: TYPES.NVarChar, value: JSON.stringify(options) },
      ]
    );
    return res.status(202).json({ ok: true, studyMaterialSetId: setId, versionNo: nextVersion, status: "Queued" });
  } catch (err) {
    if (err?.name === "ZodError") {
      await logStudyError(req, "regenerate_zod_error", err, { studyMaterialSetId: req.params?.id || null });
      return res.status(400).json({ ok: false, errorCode: "INVALID_INPUT", message: "Invalid request body." });
    }
    if (err instanceof PaymentRequiredError) {
      return res.status(402).json({
        ok: false,
        errorCode: "PAYMENT_REQUIRED",
        message: err.message,
        paymentRequired: true,
        redirectTo: "/pricing",
      });
    }
    await logStudyError(req, "regenerate_failed", err, { studyMaterialSetId: req.params?.id || null });
    const code = err instanceof StudyToolError ? err.code : "INTERNAL";
    const status = err instanceof StudyToolError ? err.status : 500;
    const message = err instanceof StudyToolError && status < 500 ? err.message : safePublicMessage(code);
    return res.status(status).json({ ok: false, errorCode: code, message });
  }
});

module.exports = router;


