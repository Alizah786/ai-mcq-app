const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const COURSE_OUTLINE_DIR = path.resolve(__dirname, "../../storage/course-outlines");

function ensureStorageDir() {
  if (!fs.existsSync(COURSE_OUTLINE_DIR)) {
    fs.mkdirSync(COURSE_OUTLINE_DIR, { recursive: true });
  }
  return COURSE_OUTLINE_DIR;
}

function buildStoredFileName(originalName) {
  const ext = String(path.extname(originalName || "") || "").toLowerCase();
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  return `${ts}_${rand}${ext}`;
}

function computeSha256FromFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function deleteStoredFile(filePath) {
  if (!filePath) return true;
  try {
    await fs.promises.unlink(filePath);
    return true;
  } catch (err) {
    if (err && err.code === "ENOENT") return true;
    return false;
  }
}

module.exports = {
  COURSE_OUTLINE_DIR,
  ensureStorageDir,
  buildStoredFileName,
  computeSha256FromFile,
  deleteStoredFile,
};

