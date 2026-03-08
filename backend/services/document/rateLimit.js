const { AppError } = require("./errors");

const ONE_MINUTE_MS = 60 * 1000;
const USER_LIMIT_PER_MIN = 10;
const IP_LIMIT_PER_MIN = 100;

const userBuckets = new Map();
const ipBuckets = new Map();

function pruneExpired(bucket, now) {
  while (bucket.length && now - bucket[0] > ONE_MINUTE_MS) {
    bucket.shift();
  }
}

function hit(mapRef, key, limit, now) {
  const bucket = mapRef.get(key) || [];
  pruneExpired(bucket, now);
  if (bucket.length >= limit) return false;
  bucket.push(now);
  mapRef.set(key, bucket);
  return true;
}

function resolveIp(req) {
  const xfwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xfwd || req.ip || req.connection?.remoteAddress || "unknown";
}

function enforceDocumentUploadRateLimit(req) {
  const now = Date.now();
  const userId = Number(req.user?.userId || 0);
  const userKey = `u:${userId}`;
  const ipKey = `ip:${resolveIp(req)}`;
  const userOk = hit(userBuckets, userKey, USER_LIMIT_PER_MIN, now);
  if (!userOk) throw new AppError("RATE_LIMITED", "Too many upload attempts.", 429);
  const ipOk = hit(ipBuckets, ipKey, IP_LIMIT_PER_MIN, now);
  if (!ipOk) throw new AppError("RATE_LIMITED", "Too many upload attempts.", 429);
}

module.exports = {
  enforceDocumentUploadRateLimit,
};

