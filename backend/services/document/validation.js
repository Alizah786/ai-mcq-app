const fs = require("fs");
const { TextDecoder } = require("util");
const yauzl = require("yauzl");
const { AppError } = require("./errors");

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 50;
const MAX_EXTRACTED_CHARS = 60000;
const MAX_DOCX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_DOCX_ENTRY_COUNT = 500;
const MAX_DOCX_COMPRESSION_RATIO = 50;
const ALLOWED_EXTENSIONS = new Set([".pdf", ".docx", ".txt"]);

function getNormalizedExtension(fileName) {
  const name = String(fileName || "").trim().toLowerCase();
  if (!name) return "";
  const idx = name.lastIndexOf(".");
  if (idx < 0) return "";
  return name.slice(idx);
}

function readFileStart(filePath, size = 1024) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { start: 0, end: size - 1 });
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function isPdfSignature(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 5) return false;
  return buf.slice(0, 5).toString("ascii") === "%PDF-";
}

function isZipSignature(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b;
}

function isValidUtf8Buffer(buf) {
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    decoder.decode(buf);
    return true;
  } catch {
    return false;
  }
}

function hasNullByte(buf) {
  return buf.includes(0x00);
}

function mostlyPrintable(buf) {
  if (!buf.length) return false;
  let printable = 0;
  for (const b of buf) {
    const isCommonWhitespace = b === 9 || b === 10 || b === 13;
    const isPrintableAscii = b >= 32 && b <= 126;
    if (isCommonWhitespace || isPrintableAscii) printable += 1;
  }
  return printable / buf.length >= 0.85;
}

function inspectDocxArchive(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (openErr, zipFile) => {
      if (openErr || !zipFile) return reject(new AppError("DOCX_SUSPICIOUS_ARCHIVE", "Invalid DOCX archive."));
      let entryCount = 0;
      let totalCompressed = 0;
      let totalUncompressed = 0;
      let hasWordDocument = false;
      let done = false;

      const finish = (err, result) => {
        if (done) return;
        done = true;
        try {
          zipFile.close();
        } catch {}
        if (err) reject(err);
        else resolve(result);
      };

      zipFile.on("entry", (entry) => {
        entryCount += 1;
        totalCompressed += Number(entry.compressedSize || 0);
        totalUncompressed += Number(entry.uncompressedSize || 0);
        const name = String(entry.fileName || "").replace(/\\/g, "/");
        if (name.toLowerCase() === "word/document.xml") hasWordDocument = true;

        if (entryCount > MAX_DOCX_ENTRY_COUNT) {
          return finish(new AppError("DOCX_SUSPICIOUS_ARCHIVE", "DOCX contains too many entries."));
        }
        if (totalUncompressed > MAX_DOCX_UNCOMPRESSED_BYTES) {
          return finish(new AppError("DOCX_SUSPICIOUS_ARCHIVE", "DOCX uncompressed size is too large."));
        }
        zipFile.readEntry();
      });

      zipFile.on("end", () => {
        const ratio = totalUncompressed / Math.max(totalCompressed, 1);
        if (ratio > MAX_DOCX_COMPRESSION_RATIO) {
          return finish(new AppError("DOCX_SUSPICIOUS_ARCHIVE", "DOCX compression ratio is suspicious."));
        }
        if (!hasWordDocument) {
          return finish(new AppError("DOCX_SUSPICIOUS_ARCHIVE", "DOCX structure is invalid."));
        }
        finish(null, {
          entryCount,
          totalCompressed,
          totalUncompressed,
        });
      });

      zipFile.on("error", () => finish(new AppError("DOCX_SUSPICIOUS_ARCHIVE", "DOCX archive inspection failed.")));
      zipFile.readEntry();
    });
  });
}

async function detectAndValidateFileType(filePath, fileSizeBytes, originalFileName = "") {
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
    throw new AppError("EMPTY_FILE", "File is empty.");
  }
  if (fileSizeBytes > MAX_FILE_SIZE_BYTES) {
    throw new AppError("FILE_TOO_LARGE", "File too large.");
  }
  const extension = getNormalizedExtension(originalFileName);
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new AppError("UNSUPPORTED_TYPE", "File type not supported.");
  }

  const head = await readFileStart(filePath, 4096);
  if (!head.length) throw new AppError("EMPTY_FILE", "File is empty.");

  if (isPdfSignature(head)) {
    return { fileType: "PDF", mimeType: "application/pdf" };
  }

  if (isZipSignature(head)) {
    await inspectDocxArchive(filePath);
    return {
      fileType: "DOCX",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }

  const fileBuf = await fs.promises.readFile(filePath);
  if (hasNullByte(fileBuf) || !isValidUtf8Buffer(fileBuf) || !mostlyPrintable(fileBuf)) {
    throw new AppError("INVALID_TEXT_FILE", "Invalid text file.");
  }
  return { fileType: "TXT", mimeType: "text/plain; charset=utf-8" };
}

function sanitizeExtractedText(text) {
  const cleaned = String(text || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned;
}

module.exports = {
  MAX_FILE_SIZE_BYTES,
  MAX_PDF_PAGES,
  MAX_EXTRACTED_CHARS,
  detectAndValidateFileType,
  sanitizeExtractedText,
};
