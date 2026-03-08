const path = require("path");
const { fork } = require("child_process");
const { AppError } = require("./errors");

const WORKER_TIMEOUT_MS = 15000;
const WORKER_PATH = path.resolve(__dirname, "../../workers/documentExtractWorker.js");

function runExtractionWorker(payload) {
  return new Promise((resolve, reject) => {
    const child = fork(WORKER_PATH, [], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    let settled = false;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill("SIGKILL");
      } catch {}
      if (err) reject(err);
      else resolve(value);
    };

    const timer = setTimeout(() => {
      finish(new AppError("EXTRACTION_TIMEOUT", "Worker timed out."));
    }, WORKER_TIMEOUT_MS);

    child.on("message", (msg) => {
      if (!msg || typeof msg !== "object") {
        return finish(new AppError("EXTRACTION_FAILED", "Invalid worker response."));
      }
      if (msg.ok) return finish(null, msg);
      return finish(new AppError(msg.errorCode || "EXTRACTION_FAILED", "Extraction failed."));
    });

    child.on("error", () => finish(new AppError("EXTRACTION_FAILED", "Worker failed.")));
    child.on("exit", (code) => {
      if (settled) return;
      if (code === 0) return;
      finish(new AppError("EXTRACTION_FAILED", "Worker exited unexpectedly."));
    });

    child.send(payload);
  });
}

module.exports = {
  runExtractionWorker,
  WORKER_TIMEOUT_MS,
};

