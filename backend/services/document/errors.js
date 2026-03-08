class AppError extends Error {
  constructor(errorCode, message, status = 400) {
    super(message);
    this.name = "AppError";
    this.errorCode = errorCode;
    this.status = status;
  }
}

const PUBLIC_ERRORS = {
  AUTH_REQUIRED: "Authentication required.",
  FORBIDDEN: "You are not allowed to access this resource.",
  INVALID_CONTEXT: "Invalid upload context.",
  FILE_MISSING: "File is required.",
  EMPTY_FILE: "File is empty.",
  FILE_TOO_LARGE: "File too large. Max 10 MB.",
  UNSUPPORTED_TYPE: "File type not supported. Upload PDF, DOCX, or TXT.",
  INVALID_TEXT_FILE: "Text file is invalid. Upload UTF-8 text without binary data.",
  ENCRYPTED_PDF: "Encrypted PDF is not supported.",
  PDF_TOO_MANY_PAGES: "Document has too many pages. Max 50.",
  DOCX_SUSPICIOUS_ARCHIVE: "Upload blocked for security reasons.",
  SCAN_BLOCKED: "Upload blocked for security reasons.",
  SCAN_ERROR: "Upload blocked for security reasons.",
  EXTRACTION_TIMEOUT: "We could not read the document in time. Try a smaller file.",
  EXTRACTION_FAILED: "We could not read text from this document.",
  TEXT_TOO_SHORT: "We couldn't read enough text from this document.",
  QUOTA_EXCEEDED: "You have reached your document upload limit for this period.",
  QUOTA_BLOCKED: "You've reached your document upload limit for this plan period. Upgrade to upload more.",
  PER_QUIZ_LIMIT_BLOCKED: "This quiz already has the maximum number of documents attached.",
  RATE_LIMITED: "Too many upload attempts. Please try again shortly.",
  NOT_FOUND: "Document not found.",
  DELETE_FAILED: "Failed to remove document.",
  INTERNAL: "Unexpected error.",
};

function sanitizePublicError(error) {
  if (error instanceof AppError) {
    return {
      ok: false,
      errorCode: error.errorCode,
      message: PUBLIC_ERRORS[error.errorCode] || error.message || PUBLIC_ERRORS.INTERNAL,
      status: error.status || 400,
    };
  }
  return {
    ok: false,
    errorCode: "INTERNAL",
    message: PUBLIC_ERRORS.INTERNAL,
    status: 500,
  };
}

function appendWarningCodes(existing, codeToAdd) {
  const set = new Set(
    String(existing || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
  );
  set.add(codeToAdd);
  return Array.from(set).join(",");
}

module.exports = {
  AppError,
  PUBLIC_ERRORS,
  sanitizePublicError,
  appendWarningCodes,
};
