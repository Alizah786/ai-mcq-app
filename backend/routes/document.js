const express = require("express");
const multer = require("multer");
const { TYPES } = require("tedious");
const { requireAuth } = require("../auth");
const { execQuery } = require("../db");
const { processDocumentJob } = require("../services/document/processDocumentJob");
const { logException } = require("../services/exceptionLogger");
const { AppError, sanitizePublicError, appendWarningCodes } = require("../services/document/errors");
const { detectAndValidateFileType, MAX_FILE_SIZE_BYTES } = require("../services/document/validation");
const { analyzeDocumentForCategories } = require("../services/documentAnalyzer");
const { ensureStorageDir, buildStoredFileName, computeSha256FromFile, deleteStoredFile } = require("../services/document/storage");
const { enforceDocumentUploadRateLimit } = require("../services/document/rateLimit");
const { assertCanAttemptUpload, getPerQuizDocumentLimit, resolveRegistryIdForActor } = require("../services/document/quota");
const { logDocumentTiming } = require("../services/document/timing");
const { logUsageEventByActor } = require("../services/usageEvents");

const router = express.Router();
router.use(requireAuth);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      cb(null, ensureStorageDir());
    } catch {
      cb(new Error("storage_init_failed"));
    }
  },
  filename: (_req, file, cb) => {
    cb(null, buildStoredFileName(file?.originalname || "upload"));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

async function logDocumentRouteError(req, stage, err, meta = null) {
  await logException({
    source: "document.route",
    route: req?.originalUrl || req?.url || null,
    method: req?.method || null,
    userId: req?.user?.userId || null,
    userRole: req?.user?.role || null,
    stage,
    error: err instanceof Error ? err : new Error(String(err)),
    meta,
  });
}

function runUpload(req, res) {
  return new Promise((resolve, reject) => {
    upload.single("file")(req, res, (err) => {
      if (!err) return resolve();
      if (err && err.code === "LIMIT_FILE_SIZE") return reject(new AppError("FILE_TOO_LARGE", "File too large.", 400));
      reject(new AppError("FILE_MISSING", "File upload failed.", 400));
    });
  });
}

function parseClassId(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

function normalizeCourseCode(raw) {
  const v = String(raw || "").trim().toUpperCase();
  if (!v) return "";
  return v.slice(0, 80);
}

async function getClassScopeForUser(classId, userId, role) {
  let sql = `
    SELECT TOP 1 c.ClassId, c.StudentId, s.TeacherId
    FROM dbo.Class c
    JOIN dbo.Student s ON s.StudentId = c.StudentId
    WHERE c.ClassId = @classId
  `;
  const params = [{ name: "classId", type: TYPES.Int, value: classId }];
  if (role === "Manager" || role === "Principal") {
    sql += " AND s.TeacherId = @userId";
    params.push({ name: "userId", type: TYPES.Int, value: userId });
  } else if (role === "Student") {
    sql += " AND c.StudentId = @userId";
    params.push({ name: "userId", type: TYPES.Int, value: userId });
  } else {
    throw new AppError("FORBIDDEN", "Forbidden.", 403);
  }
  const r = await execQuery(sql, params);
  return r.rows[0] || null;
}

async function resolveUploadContext(req, body = {}) {
  const role = String(req.user?.role || "");
  const userId = Number(req.user?.userId || 0);
  const classId = parseClassId(body.classId);
  const courseCode = normalizeCourseCode(body.courseCode);

  if (!courseCode) throw new AppError("INVALID_CONTEXT", "Course code is required.", 400);

  if (role === "Manager" || role === "Principal") {
    if (!classId) throw new AppError("INVALID_CONTEXT", "classId is required for teacher/principal context.", 400);
    const scopedClass = await getClassScopeForUser(classId, userId, role);
    if (!scopedClass) throw new AppError("FORBIDDEN", "Forbidden.", 403);
    const classStudentId = Number(scopedClass.StudentId || 0);
    if (!classStudentId) throw new AppError("INVALID_CONTEXT", "Selected class is missing student context.", 400);
    return {
      contextMode: "TEACHER",
      teacherId: Number(scopedClass.TeacherId || userId),
      studentId: classStudentId,
      classId: Number(scopedClass.ClassId),
      courseCodeNormalized: courseCode,
      courseCodeRaw: String(body.courseCode || "").trim() || courseCode,
    };
  }

  if (role === "Student") {
    if (classId) {
      const scopedClass = await getClassScopeForUser(classId, userId, role);
      if (!scopedClass) throw new AppError("FORBIDDEN", "Forbidden.", 403);
    }
    return {
      contextMode: "STUDENT",
      teacherId: null,
      studentId: userId,
      classId: classId || null,
      courseCodeNormalized: courseCode,
      courseCodeRaw: String(body.courseCode || "").trim() || courseCode,
    };
  }

  throw new AppError("FORBIDDEN", "Forbidden.", 403);
}

async function insertDocumentUpload(params) {
  const created = await execQuery(
    `INSERT INTO dbo.DocumentUpload (
       StudentId, ClassId, OriginalFileName, StoragePath, FileType, UploadedAtUtc,
       TeacherId, CourseCode, LastModifiedDate, FileSizeBytes, MimeType, Sha256Hash,
       Status, ScanResult, PageCount, ExtractedText, ExtractedTextLength, ExtractedCharCount,
       WarningCodes, ErrorCode, FailureReasonSafe, DeletedAtUtc, ExpiresAtUtc, OwnerUserNameRegistryId, CreatedAtUtc
     )
     OUTPUT INSERTED.DocumentId
     VALUES (
       @studentId, @classId, @originalFileName, @storagePath, @fileType, SYSUTCDATETIME(),
       @teacherId, @courseCodeRaw, SYSUTCDATETIME(), @fileSizeBytes, @mimeType, @sha256Hash,
       'Uploaded', NULL, NULL, NULL, NULL, 0,
       NULL, NULL, NULL, NULL, NULL, @ownerUserNameRegistryId, SYSUTCDATETIME()
     )`,
    [
      { name: "studentId", type: TYPES.Int, value: params.studentId },
      { name: "classId", type: TYPES.Int, value: params.classId },
      { name: "originalFileName", type: TYPES.NVarChar, value: params.originalFileName },
      { name: "storagePath", type: TYPES.NVarChar, value: params.storagePath },
      { name: "fileType", type: TYPES.NVarChar, value: params.fileType },
      { name: "teacherId", type: TYPES.Int, value: params.teacherId },
      { name: "courseCodeRaw", type: TYPES.NVarChar, value: params.courseCodeRaw },
      { name: "fileSizeBytes", type: TYPES.BigInt, value: params.fileSizeBytes },
      { name: "mimeType", type: TYPES.NVarChar, value: params.mimeType },
      { name: "sha256Hash", type: TYPES.Char, value: params.sha256Hash },
      { name: "ownerUserNameRegistryId", type: TYPES.Int, value: params.ownerUserNameRegistryId },
    ]
  );
  const id = Number(created.rows[0]?.DocumentId || 0);
  if (!id) throw new AppError("INTERNAL", "Insert failed.", 500);
  return id;
}

async function getQuizScopeForUser(req, quizId) {
  const role = String(req.user?.role || "");
  const userId = Number(req.user?.userId || 0);
  let sql = `
    SELECT TOP 1 q.QuizId, q.ClassId, c.StudentId, s.TeacherId
    FROM dbo.Quiz q
    JOIN dbo.Class c ON c.ClassId = q.ClassId
    JOIN dbo.Student s ON s.StudentId = c.StudentId
    WHERE q.QuizId = @quizId
  `;
  const params = [{ name: "quizId", type: TYPES.Int, value: quizId }];
  if (role === "Manager") {
    sql += " AND s.TeacherId = @userId";
    params.push({ name: "userId", type: TYPES.Int, value: userId });
  } else if (role === "Student") {
    sql += " AND c.StudentId = @userId";
    params.push({ name: "userId", type: TYPES.Int, value: userId });
  } else if (role === "Principal") {
    sql += " AND s.TeacherId = @userId";
    params.push({ name: "userId", type: TYPES.Int, value: userId });
  } else {
    throw new AppError("FORBIDDEN", "Forbidden.", 403);
  }
  const r = await execQuery(sql, params);
  return r.rows[0] || null;
}

async function attachDocumentToQuizTransactional({ quizId, documentId, createdByUserNameRegistryId, userRole, userId }) {
  const { limit } = await getPerQuizDocumentLimit(userRole, userId);
  try {
    await execQuery(
      `SET XACT_ABORT ON;
       SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
       BEGIN TRAN;
         DECLARE @existingCount INT;
         SELECT @existingCount = COUNT(1)
         FROM dbo.QuizDocument WITH (UPDLOCK, HOLDLOCK)
         WHERE QuizId = @quizId;

         IF (@existingCount >= @limit)
         BEGIN
           ROLLBACK TRAN;
           THROW 50001, 'PER_QUIZ_LIMIT_BLOCKED', 1;
         END

         INSERT INTO dbo.QuizDocument (QuizId, DocumentId, CreatedByUserNameRegistryId)
         VALUES (@quizId, @documentId, @createdByUserNameRegistryId);
       COMMIT;`,
      [
        { name: "quizId", type: TYPES.Int, value: quizId },
        { name: "documentId", type: TYPES.Int, value: documentId },
        { name: "limit", type: TYPES.Int, value: limit },
        { name: "createdByUserNameRegistryId", type: TYPES.Int, value: createdByUserNameRegistryId },
      ]
    );
    return { limit };
  } catch (err) {
    const msg = String(err?.message || "");
    if (msg.includes("PER_QUIZ_LIMIT_BLOCKED")) {
      throw new AppError("PER_QUIZ_LIMIT_BLOCKED", "Quiz document limit reached.", 409);
    }
    if (msg.toLowerCase().includes("ux_quizdocument_quizid_documentid")) {
      return { limit, alreadyAttached: true };
    }
    throw err;
  }
}

async function canAccessDocument(req, row) {
  if (!row) return false;
  const role = String(req.user?.role || "");
  const userId = Number(req.user?.userId || 0);

  if (role === "Manager") return Number(row.TeacherId || 0) === userId;
  if (role === "Student") {
    if (Number(row.StudentId || 0) === userId) return true;
    if (!row.ClassId) return false;
    const scopedClass = await getClassScopeForUser(Number(row.ClassId), userId, role);
    return !!scopedClass;
  }
  if (role === "Principal") {
    if (!row.ClassId) return false;
    const scopedClass = await getClassScopeForUser(Number(row.ClassId), userId, role);
    return !!scopedClass;
  }
  return false;
}

async function appendCleanupWarning(documentId) {
  const r = await execQuery(
    "SELECT WarningCodes FROM dbo.DocumentUpload WHERE DocumentId = @documentId",
    [{ name: "documentId", type: TYPES.Int, value: documentId }]
  );
  const current = r.rows[0]?.WarningCodes || null;
  const merged = appendWarningCodes(current, "FILE_CLEANUP_NEEDED");
  await execQuery(
    `UPDATE dbo.DocumentUpload
     SET WarningCodes = @warningCodes, LastModifiedDate = SYSUTCDATETIME()
     WHERE DocumentId = @documentId`,
    [
      { name: "warningCodes", type: TYPES.NVarChar, value: merged },
      { name: "documentId", type: TYPES.Int, value: documentId },
    ]
  );
}

async function hasDocumentAnalysisColumns() {
  const r = await execQuery(
    `SELECT CASE WHEN COL_LENGTH('dbo.DocumentUpload', 'DetectedDocType') IS NULL THEN 0 ELSE 1 END AS HasColumns`
  );
  return Number(r.rows[0]?.HasColumns || 0) === 1;
}

async function persistDocumentAnalysis(documentId, analysis) {
  const analysisEnabled = await hasDocumentAnalysisColumns();
  if (!analysisEnabled) return;
  await execQuery(
    `UPDATE dbo.DocumentUpload
     SET DetectedDocType = @docType,
         DetectConfidence = @confidence,
         CategoryScoresJson = @categoryScoresJson,
         SuggestedCategory = @suggestedCategory,
         AnalysisReasonsJson = @analysisReasonsJson,
         AnalyzedAtUtc = SYSUTCDATETIME(),
         LastModifiedDate = SYSUTCDATETIME()
     WHERE DocumentId = @documentId`,
    [
      { name: "docType", type: TYPES.NVarChar, value: analysis.docType },
      { name: "confidence", type: TYPES.Float, value: Number(analysis.confidence || 0) },
      { name: "categoryScoresJson", type: TYPES.NVarChar, value: JSON.stringify(analysis.categoryScores || {}) },
      { name: "suggestedCategory", type: TYPES.NVarChar, value: analysis.suggestedCategory || null },
      { name: "analysisReasonsJson", type: TYPES.NVarChar, value: JSON.stringify(analysis.reasons || []) },
      { name: "documentId", type: TYPES.Int, value: documentId },
    ]
  );
}

async function handleCourseOutlineUpload(req, res) {
  let uploadedPath = null;
  let insertedDocumentId = null;
  const startedAt = Date.now();
  try {
    logDocumentTiming("upload_request_started", {
      userId: Number(req.user?.userId || 0) || null,
      role: String(req.user?.role || ""),
      classId: req?.body?.classId || null,
      courseCode: String(req?.body?.courseCode || "").trim() || null,
    });
    enforceDocumentUploadRateLimit(req);
    await runUpload(req, res);
    logDocumentTiming("upload_file_received", {
      elapsedMs: Date.now() - startedAt,
      originalFileName: String(req?.file?.originalname || ""),
      fileSizeBytes: Number(req?.file?.size || 0),
      tempPath: String(req?.file?.path || ""),
    });
    const context = await resolveUploadContext(req, req.body || {});
    const quizId = parseClassId(req.body?.quizId);
    let scopedQuiz = null;
    if (quizId) {
      scopedQuiz = await getQuizScopeForUser(req, quizId);
      if (!scopedQuiz) throw new AppError("NOT_FOUND", "Quiz not found.", 404);
    }
    if (!req.file || !req.file.path) throw new AppError("FILE_MISSING", "Missing file.", 400);
    uploadedPath = req.file.path;

    if (context.contextMode === "TEACHER") {
      await assertCanAttemptUpload("Teacher", Number(context.teacherId));
    } else {
      await assertCanAttemptUpload("Student", Number(context.studentId));
    }

    if (!Number.isFinite(Number(req.file.size || 0)) || Number(req.file.size || 0) <= 0) {
      throw new AppError("EMPTY_FILE", "Empty file.", 400);
    }

    const fileMeta = await detectAndValidateFileType(
      uploadedPath,
      Number(req.file.size || 0),
      String(req.file.originalname || "")
    );
    logDocumentTiming("upload_file_validated", {
      elapsedMs: Date.now() - startedAt,
      fileType: fileMeta.fileType,
      mimeType: fileMeta.mimeType,
    });
    const sha256Hash = await computeSha256FromFile(uploadedPath);
    logDocumentTiming("upload_hash_computed", {
      elapsedMs: Date.now() - startedAt,
      sha256Prefix: String(sha256Hash || "").slice(0, 12),
    });
    const ownerUserNameRegistryId = await resolveRegistryIdForActor(
      context.contextMode === "TEACHER" ? "Teacher" : "Student",
      Number(context.contextMode === "TEACHER" ? context.teacherId : context.studentId)
    );

    insertedDocumentId = await insertDocumentUpload({
      studentId: context.studentId,
      classId: context.classId,
      originalFileName: String(req.file.originalname || "course-outline"),
      storagePath: uploadedPath,
      fileType: fileMeta.fileType,
      teacherId: context.teacherId,
      courseCodeRaw: context.courseCodeRaw,
      fileSizeBytes: Number(req.file.size || 0),
      mimeType: fileMeta.mimeType,
      sha256Hash,
      ownerUserNameRegistryId,
    });
    logDocumentTiming("upload_row_inserted", {
      elapsedMs: Date.now() - startedAt,
      documentId: insertedDocumentId,
      contextMode: context.contextMode,
      fileType: fileMeta.fileType,
    });
    let attachResult = null;
    if (quizId) {
      attachResult = await attachDocumentToQuizTransactional({
        quizId,
        documentId: insertedDocumentId,
        createdByUserNameRegistryId: ownerUserNameRegistryId,
        userRole: context.contextMode === "TEACHER" ? "Teacher" : "Student",
        userId: context.contextMode === "TEACHER" ? Number(context.teacherId) : Number(context.studentId),
      });
      if (attachResult?.alreadyAttached) {
        // No-op; document already attached to that quiz.
      }
    }

    setImmediate(() => {
      logDocumentTiming("upload_job_dispatched", {
        elapsedMs: Date.now() - startedAt,
        documentId: insertedDocumentId,
      });
      processDocumentJob(insertedDocumentId).catch(() => {});
    });
    logUsageEventByActor({
      role: context.contextMode === "TEACHER" ? "Teacher" : "Student",
      userId: context.contextMode === "TEACHER" ? Number(context.teacherId) : Number(context.studentId),
      eventType: "DOC_UPLOAD",
      quantity: 1,
    }).catch(() => {});

    return res.status(202).json({
      ok: true,
      documentId: insertedDocumentId,
      status: "Uploaded",
      attachedToQuizId: quizId || null,
      message: "Document uploaded and queued for extraction.",
    });
  } catch (err) {
    logDocumentTiming("upload_failed", {
      elapsedMs: Date.now() - startedAt,
      documentId: insertedDocumentId || null,
      error: String(err?.errorCode || err?.message || err || "unknown"),
    });
    if (uploadedPath && !insertedDocumentId) {
      await deleteStoredFile(uploadedPath);
    }
    await logDocumentRouteError(req, "upload_failed", err, {
      uploadedPath: uploadedPath || null,
      hasFile: !!req?.file,
      classId: req?.body?.classId || null,
      courseCode: req?.body?.courseCode || null,
      quizId: req?.body?.quizId || null,
      insertedDocumentId,
    });
    const safe = sanitizePublicError(err);
    if (safe.status >= 500) {
      console.error("[document.upload]", err && err.stack ? err.stack : String(err));
    }
    return res.status(safe.status).json({
      ok: false,
      errorCode: safe.errorCode,
      message: safe.message,
      documentId: insertedDocumentId || null,
    });
  }
}

router.post("/document/upload-course-outline", handleCourseOutlineUpload);
router.post("/documents/upload", handleCourseOutlineUpload);

router.get("/classes/:classId/course-outline", async (req, res) => {
  try {
    const classId = Number(req.params.classId);
    if (!Number.isFinite(classId) || classId <= 0) throw new AppError("NOT_FOUND", "Not found.", 404);

    const scopedClass = await getClassScopeForUser(classId, Number(req.user?.userId || 0), String(req.user?.role || ""));
    if (!scopedClass) throw new AppError("NOT_FOUND", "Class not found.", 404);

    const r = await execQuery(
      `SELECT TOP 1
          DocumentId, OriginalFileName, FileType, Status, WarningCodes, ErrorCode,
          FailureReasonSafe, UploadedAtUtc, LastModifiedDate
       FROM dbo.DocumentUpload
       WHERE ClassId = @classId
         AND DeletedAtUtc IS NULL
         AND (
           (@role = 'Manager' AND TeacherId = @userId) OR
           (@role = 'Principal' AND TeacherId = @userId) OR
           (@role = 'Student' AND StudentId = @userId)
         )
       ORDER BY COALESCE(CreatedAtUtc, UploadedAtUtc) DESC, DocumentId DESC`,
      [
        { name: "classId", type: TYPES.Int, value: classId },
        { name: "role", type: TYPES.NVarChar, value: String(req.user?.role || "") },
        { name: "userId", type: TYPES.Int, value: Number(req.user?.userId || 0) },
      ]
    );
    const row = r.rows[0];
    if (!row) {
      return res.json({ ok: true, document: null });
    }

    return res.json({
      ok: true,
      document: {
        documentId: Number(row.DocumentId),
        originalFileName: row.OriginalFileName || "",
        fileType: row.FileType || "",
        status: row.Status || "Uploaded",
        warningCodes: String(row.WarningCodes || "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
        errorCode: row.ErrorCode || null,
        failureReasonSafe: row.FailureReasonSafe || null,
        uploadedAtUtc: row.UploadedAtUtc || null,
        lastModifiedDate: row.LastModifiedDate || null,
      },
    });
  } catch (err) {
    await logDocumentRouteError(req, "class_course_outline_failed", err, {
      classId: req?.params?.classId || null,
    });
    const safe = sanitizePublicError(err);
    return res.status(safe.status).json({
      ok: false,
      errorCode: safe.errorCode,
      message: safe.message,
    });
  }
});

router.post("/quizzes/:quizId/documents/:documentId", async (req, res) => {
  try {
    const quizId = Number(req.params.quizId);
    const documentId = Number(req.params.documentId);
    if (!Number.isFinite(quizId) || quizId <= 0 || !Number.isFinite(documentId) || documentId <= 0) {
      throw new AppError("NOT_FOUND", "Not found.", 404);
    }
    const scopedQuiz = await getQuizScopeForUser(req, quizId);
    if (!scopedQuiz) throw new AppError("NOT_FOUND", "Quiz not found.", 404);
    const docRes = await execQuery(
      `SELECT DocumentId, StudentId, ClassId, TeacherId, OriginalFileName, Status, FailureReasonSafe, PageCount, ExtractedCharCount, ExtractedTextLength, WarningCodes
       FROM dbo.DocumentUpload
       WHERE DocumentId = @documentId AND DeletedAtUtc IS NULL`,
      [{ name: "documentId", type: TYPES.Int, value: documentId }]
    );
    const row = docRes.rows[0];
    if (!row) throw new AppError("NOT_FOUND", "Document not found.", 404);
    const allowed = await canAccessDocument(req, row);
    if (!allowed) throw new AppError("FORBIDDEN", "Forbidden.", 403);
    const createdByUserNameRegistryId = await resolveRegistryIdForActor(
      ["Manager", "Principal"].includes(String(req.user?.role || "")) ? "Teacher" : "Student",
      Number(req.user?.userId || 0)
    );
    await attachDocumentToQuizTransactional({
      quizId,
      documentId,
      createdByUserNameRegistryId,
      userRole: ["Manager", "Principal"].includes(String(req.user?.role || "")) ? "Teacher" : "Student",
      userId: Number(req.user?.userId || 0),
    });
    return res.json({ ok: true, quizId, documentId });
  } catch (err) {
    await logDocumentRouteError(req, "attach_failed", err, {
      quizId: req?.params?.quizId || null,
      documentId: req?.params?.documentId || null,
    });
    const safe = sanitizePublicError(err);
    return res.status(safe.status).json({
      ok: false,
      errorCode: safe.errorCode,
      message: safe.message,
    });
  }
});

router.get("/quizzes/:quizId/documents", async (req, res) => {
  try {
    const quizId = Number(req.params.quizId);
    if (!Number.isFinite(quizId) || quizId <= 0) throw new AppError("NOT_FOUND", "Not found.", 404);
    const scopedQuiz = await getQuizScopeForUser(req, quizId);
    if (!scopedQuiz) throw new AppError("NOT_FOUND", "Quiz not found.", 404);
    const r = await execQuery(
      `SELECT qd.QuizDocumentId, d.DocumentId, d.OriginalFileName, d.FileType, d.Status, d.PageCount,
              d.ExtractedCharCount, d.ExtractedTextLength, d.FailureReasonSafe, d.WarningCodes, qd.CreatedAtUtc
       FROM dbo.QuizDocument qd
       JOIN dbo.DocumentUpload d ON d.DocumentId = qd.DocumentId
       WHERE qd.QuizId = @quizId
       ORDER BY qd.CreatedAtUtc DESC, qd.QuizDocumentId DESC`,
      [{ name: "quizId", type: TYPES.Int, value: quizId }]
    );
    return res.json({
      ok: true,
      documents: (r.rows || []).map((row) => ({
        quizDocumentId: Number(row.QuizDocumentId),
        documentId: Number(row.DocumentId),
        originalFileName: row.OriginalFileName || "",
        fileType: row.FileType || "",
        status: row.Status || "Uploaded",
        pageCount: row.PageCount == null ? null : Number(row.PageCount),
        extractedCharCount: Number(row.ExtractedCharCount || 0),
        extractedTextLength: Number(row.ExtractedTextLength || 0),
        failureReasonSafe: row.FailureReasonSafe || null,
        warningCodes: String(row.WarningCodes || "").split(",").map((v) => v.trim()).filter(Boolean),
        createdAtUtc: row.CreatedAtUtc || null,
      })),
    });
  } catch (err) {
    await logDocumentRouteError(req, "list_quiz_documents_failed", err, {
      quizId: req?.params?.quizId || null,
    });
    const safe = sanitizePublicError(err);
    return res.status(safe.status).json({
      ok: false,
      errorCode: safe.errorCode,
      message: safe.message,
    });
  }
});

router.get("/document/:documentId/status", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
    const documentId = Number(req.params.documentId);
    if (!Number.isFinite(documentId) || documentId <= 0) throw new AppError("NOT_FOUND", "Not found.", 404);

    const r = await execQuery(
      `SELECT DocumentId, StudentId, ClassId, TeacherId, CourseCode, OriginalFileName, FileType,
              FileSizeBytes, MimeType, Status, ScanResult, PageCount, ExtractedTextLength,
              ExtractedCharCount, FailureReasonSafe, WarningCodes, ErrorCode, UploadedAtUtc, LastModifiedDate, DeletedAtUtc
       FROM dbo.DocumentUpload
       WHERE DocumentId = @documentId`,
      [{ name: "documentId", type: TYPES.Int, value: documentId }]
    );
    const row = r.rows[0];
    if (!row) throw new AppError("NOT_FOUND", "Not found.", 404);
    const allowed = await canAccessDocument(req, row);
    if (!allowed) throw new AppError("FORBIDDEN", "Forbidden.", 403);

    return res.json({
      ok: true,
      document: {
        documentId: row.DocumentId,
        originalFileName: row.OriginalFileName || "",
        fileType: row.FileType || "",
        fileSizeBytes: Number(row.FileSizeBytes || 0),
        mimeType: row.MimeType || null,
        status: row.Status || "Uploaded",
        scanResult: row.ScanResult || null,
        pageCount: row.PageCount == null ? null : Number(row.PageCount),
        extractedTextLength: row.ExtractedTextLength == null ? null : Number(row.ExtractedTextLength),
        extractedCharCount: Number(row.ExtractedCharCount || 0),
        failureReasonSafe: row.FailureReasonSafe || null,
        warningCodes: String(row.WarningCodes || "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
        errorCode: row.ErrorCode || null,
        uploadedAtUtc: row.UploadedAtUtc || null,
        lastModifiedDate: row.LastModifiedDate || null,
        deletedAtUtc: row.DeletedAtUtc || null,
      },
    });
  } catch (err) {
    await logDocumentRouteError(req, "status_failed", err, {
      documentId: req?.params?.documentId || null,
    });
    const safe = sanitizePublicError(err);
    return res.status(safe.status).json({
      ok: false,
      errorCode: safe.errorCode,
      message: safe.message,
    });
  }
});

async function handleCategorySuggestions(req, res) {
  try {
    const documentId = Number(req.params.documentId);
    if (!Number.isFinite(documentId) || documentId <= 0) throw new AppError("NOT_FOUND", "Not found.", 404);

    const r = await execQuery(
      `SELECT DocumentId, StudentId, ClassId, TeacherId, Status, ExtractedText, OriginalFileName
       FROM dbo.DocumentUpload
       WHERE DocumentId = @documentId AND DeletedAtUtc IS NULL`,
      [{ name: "documentId", type: TYPES.Int, value: documentId }]
    );
    const row = r.rows[0];
    if (!row) throw new AppError("NOT_FOUND", "Document not found.", 404);
    const allowed = await canAccessDocument(req, row);
    if (!allowed) throw new AppError("FORBIDDEN", "Forbidden.", 403);
    if (String(row.Status || "") !== "Extracted" || !String(row.ExtractedText || "").trim()) {
      throw new AppError("SOURCE_NOT_READY", "Selected document is not ready yet.", 400);
    }

    let analysis;
    try {
      analysis = analyzeDocumentForCategories(String(row.ExtractedText || ""), {
        originalFileName: String(row.OriginalFileName || ""),
      });
    } catch (err) {
      if (String(err?.code || "") === "INSUFFICIENT_TEXT") {
        throw new AppError("INSUFFICIENT_TEXT", "Document has insufficient readable text.", 400);
      }
      throw err;
    }

    await persistDocumentAnalysis(documentId, analysis);

    return res.json({
      ok: true,
      documentId,
      docType: analysis.docType,
      confidence: analysis.confidence,
      suggestedCategory: analysis.suggestedCategory,
      categoryScores: analysis.categoryScores,
      visibleCategories: analysis.visibleCategories,
      hiddenCategories: analysis.hiddenCategories,
      reasons: analysis.reasons,
    });
  } catch (err) {
    await logDocumentRouteError(req, "category_suggestions_failed", err, {
      documentId: req?.params?.documentId || null,
    });
    const safe = sanitizePublicError(err);
    if (safe.errorCode === "SOURCE_NOT_READY") {
      return res.status(400).json({ ok: false, errorCode: safe.errorCode, message: "Selected document is not ready yet." });
    }
    if (safe.errorCode === "INSUFFICIENT_TEXT") {
      return res.status(400).json({ ok: false, errorCode: safe.errorCode, message: "Document has insufficient readable text." });
    }
    return res.status(safe.status).json({
      ok: false,
      errorCode: safe.errorCode,
      message: safe.message,
    });
  }
}

router.get("/documents/:documentId/category-suggestions", handleCategorySuggestions);
router.get("/document/:documentId/category-suggestions", handleCategorySuggestions);

router.delete("/document/:documentId", async (req, res) => {
  try {
    const documentId = Number(req.params.documentId);
    if (!Number.isFinite(documentId) || documentId <= 0) throw new AppError("NOT_FOUND", "Not found.", 404);

    const r = await execQuery(
      `SELECT DocumentId, StudentId, ClassId, TeacherId, StoragePath, Status, DeletedAtUtc
       FROM dbo.DocumentUpload
       WHERE DocumentId = @documentId`,
      [{ name: "documentId", type: TYPES.Int, value: documentId }]
    );
    const row = r.rows[0];
    if (!row) throw new AppError("NOT_FOUND", "Not found.", 404);
    const allowed = await canAccessDocument(req, row);
    if (!allowed) throw new AppError("FORBIDDEN", "Forbidden.", 403);

    if (row.DeletedAtUtc) {
      return res.json({ ok: true, documentId, status: "DeletedByUser" });
    }

    const upd = await execQuery(
      `UPDATE dbo.DocumentUpload
       SET Status = 'DeletedByUser',
           DeletedAtUtc = SYSUTCDATETIME(),
           ExtractedText = NULL,
           ExtractedTextLength = NULL,
           LastModifiedDate = SYSUTCDATETIME()
       OUTPUT INSERTED.StoragePath
       WHERE DocumentId = @documentId`,
      [{ name: "documentId", type: TYPES.Int, value: documentId }]
    );
    await execQuery(
      `DELETE FROM dbo.QuizDocument WHERE DocumentId = @documentId`,
      [{ name: "documentId", type: TYPES.Int, value: documentId }]
    );
    const storagePath = upd.rows[0]?.StoragePath || null;
    const deleted = await deleteStoredFile(storagePath);
    if (!deleted) {
      await appendCleanupWarning(documentId);
    }

    return res.json({
      ok: true,
      documentId,
      status: "DeletedByUser",
    });
  } catch (err) {
    await logDocumentRouteError(req, "delete_failed", err, {
      documentId: req?.params?.documentId || null,
    });
    const safe = sanitizePublicError(err);
    return res.status(safe.status).json({
      ok: false,
      errorCode: safe.errorCode,
      message: safe.message,
    });
  }
});

module.exports = router;
