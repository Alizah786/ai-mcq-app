const { TYPES } = require("tedious");
const { execQuery } = require("../db");

async function resolveRegistryId(roleRaw, userId) {
  const role = String(roleRaw || "").toUpperCase();
  const userType =
    role === "MANAGER" || role === "TEACHER"
      ? "TEACHER"
      : role === "STUDENT"
        ? "STUDENT"
        : role === "PRINCIPAL"
          ? "PRINCIPAL"
          : null;
  if (!userType || !Number.isFinite(Number(userId)) || Number(userId) <= 0) return null;

  const result = await execQuery(
    `SELECT TOP 1 UserNameRegistryId
     FROM dbo.UserNameRegistry
     WHERE UserType = @userType
       AND UserId = @userId
       AND IsActive = 1`,
    [
      { name: "userType", type: TYPES.NVarChar, value: userType },
      { name: "userId", type: TYPES.Int, value: Number(userId) },
    ]
  );
  return Number(result.rows[0]?.UserNameRegistryId || 0) || null;
}

async function insertUsageEvent({ userNameRegistryId, eventType, quantity = 1, costUsd = null, createdAtUtc = null }) {
  if (!Number.isFinite(Number(userNameRegistryId)) || Number(userNameRegistryId) <= 0) return;
  if (!String(eventType || "").trim()) return;
  await execQuery(
    `INSERT INTO dbo.UsageEvent (UserNameRegistryId, EventType, Quantity, CostUsd, CreatedAtUtc)
     VALUES (@userNameRegistryId, @eventType, @quantity, @costUsd, COALESCE(@createdAtUtc, SYSUTCDATETIME()))`,
    [
      { name: "userNameRegistryId", type: TYPES.Int, value: Number(userNameRegistryId) },
      { name: "eventType", type: TYPES.NVarChar, value: String(eventType).trim().toUpperCase() },
      { name: "quantity", type: TYPES.Int, value: Math.max(1, Math.trunc(Number(quantity || 1))) },
      {
        name: "costUsd",
        type: TYPES.Decimal,
        value: costUsd == null ? null : Number(costUsd),
        options: { precision: 10, scale: 4 },
      },
      { name: "createdAtUtc", type: TYPES.DateTime2, value: createdAtUtc || null },
    ]
  );
}

async function logUsageEventByActor({ role, userId, eventType, quantity = 1, costUsd = null, createdAtUtc = null }) {
  try {
    const userNameRegistryId = await resolveRegistryId(role, userId);
    if (!userNameRegistryId) return;
    await insertUsageEvent({ userNameRegistryId, eventType, quantity, costUsd, createdAtUtc });
  } catch {
    // Usage logging is best-effort and must not break primary flows.
  }
}

module.exports = {
  insertUsageEvent,
  logUsageEventByActor,
  resolveRegistryId,
};

