const fs = require("fs");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const { TextDecoder } = require("util");

function blockNetworkModules() {
  const http = require("http");
  const https = require("https");
  const net = require("net");
  const dns = require("dns");

  const deny = () => {
    throw new Error("NETWORK_NOT_ALLOWED");
  };

  http.request = deny;
  http.get = deny;
  https.request = deny;
  https.get = deny;
  net.connect = deny;
  net.createConnection = deny;
  dns.lookup = deny;
  dns.resolve = deny;
}

function safeFail(errorCode) {
  if (!process.send) return;
  process.send({
    ok: false,
    errorCode,
  });
}

function isUtf8(buffer) {
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    decoder.decode(buffer);
    return true;
  } catch {
    return false;
  }
}

async function extractFromPdf(filePath) {
  const buf = await fs.promises.readFile(filePath);
  if (buf.includes(Buffer.from("/Encrypt"))) {
    throw new Error("ENCRYPTED_PDF");
  }
  const parsed = await pdfParse(buf);
  return {
    extractedText: String(parsed.text || ""),
    pageCount: Number(parsed.numpages || 0),
    warnings: [],
  };
}

async function extractFromDocx(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  const warnings = Array.isArray(result.messages) && result.messages.length ? ["DOCX_FORMAT_WARNINGS"] : [];
  return {
    extractedText: String(result.value || ""),
    pageCount: null,
    warnings,
  };
}

async function extractFromTxt(filePath) {
  const buf = await fs.promises.readFile(filePath);
  if (buf.includes(0x00) || !isUtf8(buf)) {
    throw new Error("INVALID_TEXT_FILE");
  }
  return {
    extractedText: buf.toString("utf8"),
    pageCount: null,
    warnings: [],
  };
}

async function handle(payload) {
  const fileType = String(payload.fileType || "").toUpperCase();
  if (!payload || !payload.filePath || !fileType) {
    return safeFail("EXTRACTION_FAILED");
  }

  try {
    blockNetworkModules();
    let result = null;
    if (fileType === "PDF") result = await extractFromPdf(payload.filePath);
    else if (fileType === "DOCX") result = await extractFromDocx(payload.filePath);
    else if (fileType === "TXT") result = await extractFromTxt(payload.filePath);
    else return safeFail("UNSUPPORTED_TYPE");

    if (process.send) {
      process.send({
        ok: true,
        extractedText: result.extractedText,
        pageCount: result.pageCount,
        warnings: result.warnings || [],
      });
    }
  } catch (err) {
    const code = String(err && err.message ? err.message : "EXTRACTION_FAILED");
    if (code === "ENCRYPTED_PDF") return safeFail("ENCRYPTED_PDF");
    if (code === "INVALID_TEXT_FILE") return safeFail("INVALID_TEXT_FILE");
    if (code === "NETWORK_NOT_ALLOWED") return safeFail("EXTRACTION_FAILED");
    return safeFail("EXTRACTION_FAILED");
  }
}

process.on("message", (payload) => {
  handle(payload).finally(() => process.exit(0));
});

