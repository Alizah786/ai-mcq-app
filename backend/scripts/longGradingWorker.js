require("dotenv").config({ path: __dirname + "/../.env" });

const { claimNextLongGradingJob, processLongGradingJob } = require("../services/longGradingService");
const { logException } = require("../services/exceptionLogger");

const POLL_MS = Math.max(2000, Number(process.env.LONG_GRADING_WORKER_POLL_MS || 5000));
let shuttingDown = false;

async function runOnce() {
  const job = await claimNextLongGradingJob();
  if (!job) return false;
  await processLongGradingJob(job, {
    source: "longGradingWorker",
    route: "worker",
    method: "WORKER",
  });
  return true;
}

async function loop() {
  while (!shuttingDown) {
    try {
      const processed = await runOnce();
      if (!processed) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    } catch (err) {
      await logException({
        source: "longGradingWorker",
        stage: "loop_error",
        error: err,
      });
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }
}

process.on("SIGINT", () => {
  shuttingDown = true;
});
process.on("SIGTERM", () => {
  shuttingDown = true;
});

loop().catch(async (err) => {
  await logException({
    source: "longGradingWorker",
    stage: "fatal_error",
    error: err,
  });
  process.exit(1);
});

