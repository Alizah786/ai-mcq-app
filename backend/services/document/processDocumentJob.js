const { TYPES } = require("tedious");
const { execQuery } = require("../../db");
const { scanFile } = require("./scanner");
const { AppError, appendWarningCodes, PUBLIC_ERRORS } = require("./errors");
const { MAX_EXTRACTED_CHARS, MAX_PDF_PAGES, sanitizeExtractedText } = require("./validation");
const { runExtractionWorker } = require("./workerClient");
const { logDocumentTiming } = require("./timing");

async function updateDocumentProcessingState(documentId, fields = {}) {
  const setClauses = [];
  const params = [{ name: "documentId", type: TYPES.Int, value: documentId }];

  const add = (column, value, type) => {
    setClauses.push(`${column} = @${column}`);
    params.push({ name: column, type, value });
  };

  if (fields.status != null) add("Status", fields.status, TYPES.NVarChar);
  if (fields.scanResult !== undefined) add("ScanResult", fields.scanResult, TYPES.NVarChar);
  if (fields.pageCount !== undefined) add("PageCount", fields.pageCount, TYPES.Int);
  if (fields.extractedText !== undefined) add("ExtractedText", fields.extractedText, TYPES.NVarChar);
  if (fields.extractedTextLength !== undefined) add("ExtractedTextLength", fields.extractedTextLength, TYPES.Int);
  if (fields.extractedCharCount !== undefined) add("ExtractedCharCount", fields.extractedCharCount, TYPES.Int);
  if (fields.warningCodes !== undefined) add("WarningCodes", fields.warningCodes, TYPES.NVarChar);
  if (fields.errorCode !== undefined) add("ErrorCode", fields.errorCode, TYPES.NVarChar);
  if (fields.failureReasonSafe !== undefined) add("FailureReasonSafe", fields.failureReasonSafe, TYPES.NVarChar);

  if (!setClauses.length) return;
  setClauses.push("LastModifiedDate = SYSUTCDATETIME()");

  await execQuery(
    `UPDATE dbo.DocumentUpload
     SET ${setClauses.join(", ")}
     WHERE DocumentId = @documentId`,
    params
  );
}

async function markRejected(documentId, errorCode, warningCodes = null) {
  await updateDocumentProcessingState(documentId, {
    status: "Failed",
    errorCode,
    warningCodes,
    failureReasonSafe: PUBLIC_ERRORS[errorCode] || PUBLIC_ERRORS.EXTRACTION_FAILED,
  });
}

async function markBlocked(documentId, errorCode, scanResult = "FAIL") {
  await updateDocumentProcessingState(documentId, {
    status: "Failed",
    scanResult,
    errorCode,
    failureReasonSafe: PUBLIC_ERRORS[errorCode] || PUBLIC_ERRORS.SCAN_BLOCKED,
  });
}

async function loadDocumentById(documentId) {
  const r = await execQuery(
    `SELECT DocumentId, StoragePath, FileType, Status, WarningCodes
     FROM dbo.DocumentUpload
     WHERE DocumentId = @documentId`,
    [{ name: "documentId", type: TYPES.Int, value: documentId }]
  );
  return r.rows[0] || null;
}

async function processDocumentJob(documentId) {
  const startedAt = Date.now();
  const doc = await loadDocumentById(documentId);
  if (!doc || doc.Status === "DeletedByUser" || doc.Status === "Extracted") {
    logDocumentTiming("job_skipped", {
      documentId,
      elapsedMs: Date.now() - startedAt,
      status: doc?.Status || null,
    });
    return;
  }

  logDocumentTiming("job_started", {
    documentId,
    fileType: String(doc.FileType || "").toUpperCase(),
    status: String(doc.Status || ""),
  });

  try {
    const scanStartedAt = Date.now();
    const scan = await scanFile(doc.StoragePath);
    logDocumentTiming("job_scan_completed", {
      documentId,
      elapsedMs: Date.now() - startedAt,
      stageElapsedMs: Date.now() - scanStartedAt,
      scanResult: scan?.result || null,
    });
    if (!scan || scan.result === "FAIL") {
      await markBlocked(documentId, "SCAN_BLOCKED", "FAIL");
      logDocumentTiming("job_failed_scan_blocked", {
        documentId,
        elapsedMs: Date.now() - startedAt,
      });
      return;
    }
    if (scan.result === "ERROR") {
      await markBlocked(documentId, "SCAN_ERROR", "ERROR");
      logDocumentTiming("job_failed_scan_error", {
        documentId,
        elapsedMs: Date.now() - startedAt,
      });
      return;
    }

    const scanPassedStateStartedAt = Date.now();
    await updateDocumentProcessingState(documentId, {
      status: "ScanPassed",
      scanResult: "PASS",
      errorCode: null,
      failureReasonSafe: null,
    });
    logDocumentTiming("job_state_scan_passed", {
      documentId,
      elapsedMs: Date.now() - startedAt,
      stageElapsedMs: Date.now() - scanPassedStateStartedAt,
    });

    const extractingStateStartedAt = Date.now();
    await updateDocumentProcessingState(documentId, {
      status: "Extracting",
    });
    logDocumentTiming("job_state_extracting", {
      documentId,
      elapsedMs: Date.now() - startedAt,
      stageElapsedMs: Date.now() - extractingStateStartedAt,
    });

    const workerStartedAt = Date.now();
    const workerResult = await runExtractionWorker({
      documentId,
      filePath: doc.StoragePath,
      fileType: String(doc.FileType || "").toUpperCase(),
    });
    logDocumentTiming("job_worker_completed", {
      documentId,
      elapsedMs: Date.now() - startedAt,
      stageElapsedMs: Date.now() - workerStartedAt,
      extractedChars: String(workerResult?.extractedText || "").length,
      pageCount: Number(workerResult?.pageCount || 0) || null,
      warningCount: Array.isArray(workerResult?.warnings) ? workerResult.warnings.length : 0,
    });

    if (!workerResult || !workerResult.ok) {
      throw new AppError("EXTRACTION_FAILED", "Extraction failed.");
    }

    if (String(doc.FileType || "").toUpperCase() === "PDF") {
      const pages = Number(workerResult.pageCount || 0);
      if (pages > MAX_PDF_PAGES) {
        await markRejected(documentId, "PDF_TOO_MANY_PAGES");
        return;
      }
    }

    let cleanedText = sanitizeExtractedText(workerResult.extractedText || "");
    const originalExtractedCharCount = cleanedText.length;
    if (originalExtractedCharCount < 300) {
      await markRejected(documentId, "TEXT_TOO_SHORT");
      logDocumentTiming("job_failed_text_too_short", {
        documentId,
        elapsedMs: Date.now() - startedAt,
        extractedChars: originalExtractedCharCount,
      });
      return;
    }

    let warningCodes = String(doc.WarningCodes || "").trim() || null;
    if (cleanedText.length > MAX_EXTRACTED_CHARS) {
      cleanedText = cleanedText.slice(0, MAX_EXTRACTED_CHARS);
      warningCodes = appendWarningCodes(warningCodes, "TEXT_TRUNCATED");
    }
    const mergedWarnings = (workerResult.warnings || []).reduce((acc, code) => appendWarningCodes(acc, code), warningCodes);

    const extractedStateStartedAt = Date.now();
    await updateDocumentProcessingState(documentId, {
      status: "Extracted",
      pageCount: Number(workerResult.pageCount || 0) || null,
      extractedText: cleanedText,
      extractedTextLength: cleanedText.length,
      extractedCharCount: originalExtractedCharCount,
      warningCodes: mergedWarnings,
      errorCode: null,
      failureReasonSafe: null,
    });
    logDocumentTiming("job_completed", {
      documentId,
      elapsedMs: Date.now() - startedAt,
      stageElapsedMs: Date.now() - extractedStateStartedAt,
      extractedChars: cleanedText.length,
      originalExtractedChars: originalExtractedCharCount,
      warningCodes: mergedWarnings,
    });
  } catch (err) {
    const code = err instanceof AppError ? err.errorCode : "EXTRACTION_FAILED";
    logDocumentTiming("job_failed", {
      documentId,
      elapsedMs: Date.now() - startedAt,
      errorCode: code,
      error: String(err?.message || err || "unknown"),
    });
    if (code === "SCAN_BLOCKED" || code === "SCAN_ERROR") {
      await markBlocked(documentId, code, code === "SCAN_BLOCKED" ? "FAIL" : "ERROR");
      return;
    }
    await markRejected(documentId, code);
  }
}

module.exports = {
  processDocumentJob,
};
