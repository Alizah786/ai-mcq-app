require("dotenv").config({ path: __dirname + "/../.env" });
const { processNextStudyMaterialJob } = require("../services/studyTools/jobProcessor");

const POLL_MS = Math.max(1000, Number(process.env.STUDY_MATERIAL_WORKER_POLL_MS || 1500));
let stopped = false;

async function tick() {
  if (stopped) return;
  try {
    let processed = true;
    while (processed && !stopped) {
      processed = await processNextStudyMaterialJob();
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[study-materials-worker] tick failed", err && err.message ? err.message : err);
  } finally {
    if (!stopped) setTimeout(tick, POLL_MS);
  }
}

process.on("SIGINT", () => {
  stopped = true;
});
process.on("SIGTERM", () => {
  stopped = true;
});

// eslint-disable-next-line no-console
console.log(`[study-materials-worker] started. poll=${POLL_MS}ms`);
tick();
