/**
 * Seed 5 teacher test users and assign each an active Pro Teacher plan.
 *
 * Run:
 *   npm run seed-pro-teacher-users
 *
 * Optional env:
 *   TEST_TEACHER_PASSWORD=YourPassword123!
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const bcrypt = require("bcrypt");
const { TYPES } = require("tedious");
const { execQuery } = require("../db");
const { activatePlanForUser } = require("../services/subscription");

const DEFAULT_PASSWORD = process.env.TEST_TEACHER_PASSWORD || "ProTeacher123!";
const USERS = [
  { email: "proteacher1@test.local", fullName: "Pro Teacher 1" },
  { email: "proteacher2@test.local", fullName: "Pro Teacher 2" },
  { email: "proteacher3@test.local", fullName: "Pro Teacher 3" },
  { email: "proteacher4@test.local", fullName: "Pro Teacher 4" },
  { email: "proteacher5@test.local", fullName: "Pro Teacher 5" },
];

function isRegistryDuplicateError(err) {
  const msg = String((err && err.message) || "");
  return msg.includes("UX_UserNameRegistry_NormalizedUserName");
}

function toTeacherAliasEmail(email) {
  const raw = String(email || "").trim();
  const at = raw.indexOf("@");
  if (at < 0) return `${raw}+teacher`;
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  return `${local}+teacher@${domain}`;
}

function toTeacherAliasWithIndex(email, index) {
  const raw = String(email || "").trim();
  const at = raw.indexOf("@");
  if (at < 0) return `${raw}+teacher${index}`;
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  return `${local}+teacher${index}@${domain}`;
}

async function findTeacherByEmail(email) {
  const r = await execQuery(
    `SELECT TOP 1 TeacherId
     FROM dbo.Teacher
     WHERE Email = @email`,
    [{ name: "email", type: TYPES.NVarChar, value: email }]
  );
  return r.rows[0] ? Number(r.rows[0].TeacherId) : null;
}

async function isRegistryUserNameTaken(email) {
  const r = await execQuery(
    `SELECT TOP 1 1 AS Taken
     FROM dbo.UserNameRegistry
     WHERE NormalizedUserName = LOWER(LTRIM(RTRIM(@userName)))`,
    [{ name: "userName", type: TYPES.NVarChar, value: email }]
  );
  return !!r.rows.length;
}

async function pickUsableEmail(preferredEmail) {
  const existingTeacherId = await findTeacherByEmail(preferredEmail);
  if (existingTeacherId) {
    return { email: preferredEmail, teacherId: existingTeacherId };
  }

  try {
    const taken = await isRegistryUserNameTaken(preferredEmail);
    if (!taken) return { email: preferredEmail, teacherId: null };
  } catch {
    return { email: preferredEmail, teacherId: null };
  }

  const firstAlias = toTeacherAliasEmail(preferredEmail);
  const aliasTeacherId = await findTeacherByEmail(firstAlias);
  if (aliasTeacherId) {
    return { email: firstAlias, teacherId: aliasTeacherId };
  }
  try {
    const takenAlias = await isRegistryUserNameTaken(firstAlias);
    if (!takenAlias) return { email: firstAlias, teacherId: null };
  } catch {
    return { email: firstAlias, teacherId: null };
  }

  for (let i = 2; i <= 200; i += 1) {
    const candidate = toTeacherAliasWithIndex(preferredEmail, i);
    const candidateTeacherId = await findTeacherByEmail(candidate);
    if (candidateTeacherId) {
      return { email: candidate, teacherId: candidateTeacherId };
    }
    try {
      const taken = await isRegistryUserNameTaken(candidate);
      if (!taken) return { email: candidate, teacherId: null };
    } catch {
      return { email: candidate, teacherId: null };
    }
  }

  throw new Error(`No available test email could be allocated for ${preferredEmail}`);
}

async function getOrCreatePrincipal(email, fullName) {
  const raw = String(email || "").trim().toLowerCase();
  const at = raw.indexOf("@");
  const local = at > -1 ? raw.slice(0, at) : raw;
  const domain = at > -1 ? raw.slice(at + 1) : "local";

  const candidates = [
    `principal+${local}@${domain}`,
    `principal+${local}+1@${domain}`,
    `principal+${local}+2@${domain}`,
    `principal_${local.replace(/[^a-z0-9]/g, "")}@${domain}`,
  ];

  for (const principalEmail of candidates) {
    const existing = await execQuery(
      `SELECT TOP 1 PrincipalId
       FROM dbo.Principal
       WHERE Email = @email`,
      [{ name: "email", type: TYPES.NVarChar, value: principalEmail }]
    );
    if (existing.rows.length) return Number(existing.rows[0].PrincipalId);

    try {
      await execQuery(
        `INSERT INTO dbo.Principal (Email, FullName, IsActive)
         VALUES (@email, @fullName, 1)`,
        [
          { name: "email", type: TYPES.NVarChar, value: principalEmail },
          { name: "fullName", type: TYPES.NVarChar, value: fullName },
        ]
      );
      const created = await execQuery(
        `SELECT TOP 1 PrincipalId
         FROM dbo.Principal
         WHERE Email = @email
         ORDER BY PrincipalId DESC`,
        [{ name: "email", type: TYPES.NVarChar, value: principalEmail }]
      );
      return Number(created.rows[0].PrincipalId);
    } catch (err) {
      if (!isRegistryDuplicateError(err)) throw err;
    }
  }

  throw new Error(`Unable to allocate principal email for ${email}`);
}

async function upsertUserNameRegistry(userId, email) {
  try {
    const takenByUserName = await execQuery(
      `SELECT TOP 1 UserNameRegistryId, UserType, UserId
       FROM dbo.UserNameRegistry
       WHERE NormalizedUserName = LOWER(LTRIM(RTRIM(@userName)))`,
      [{ name: "userName", type: TYPES.NVarChar, value: email }]
    );

    if (takenByUserName.rows.length) {
      const row = takenByUserName.rows[0];
      const sameMapping = String(row.UserType || "").toUpperCase() === "TEACHER" && Number(row.UserId) === Number(userId);
      if (!sameMapping) {
        console.warn(
          `Skipped registry sync for ${email}: username already linked to UserType=${row.UserType}, UserId=${row.UserId}`
        );
        return;
      }
    }

    await execQuery(
      `IF EXISTS (
         SELECT 1
         FROM dbo.UserNameRegistry
         WHERE UserType = 'TEACHER' AND UserId = @userId
       )
       BEGIN
         UPDATE dbo.UserNameRegistry
         SET UserName = @userName,
             IsActive = 1,
             LastModifiedDate = SYSUTCDATETIME()
         WHERE UserType = 'TEACHER' AND UserId = @userId;
       END
       ELSE
       BEGIN
         INSERT INTO dbo.UserNameRegistry (UserName, UserType, UserId, IsActive)
         VALUES (@userName, 'TEACHER', @userId, 1);
       END`,
      [
        { name: "userId", type: TYPES.Int, value: Number(userId) },
        { name: "userName", type: TYPES.NVarChar, value: email },
      ]
    );
  } catch (err) {
    const msg = String((err && err.message) || "");
    if (msg.includes("UX_UserNameRegistry_NormalizedUserName")) {
      console.warn(`Skipped registry sync for ${email}: duplicate normalized username.`);
      return;
    }
    // Registry may be unavailable in partial/local schemas.
  }
}

async function getOrCreateTeacher({ email, fullName }, passwordHash) {
  const existing = await execQuery(
    `SELECT TOP 1 TeacherId
     FROM dbo.Teacher
     WHERE Email = @email`,
    [{ name: "email", type: TYPES.NVarChar, value: email }]
  );

  if (existing.rows.length) {
    const teacherId = Number(existing.rows[0].TeacherId);
    await execQuery(
      `UPDATE dbo.Teacher
       SET PasswordHash = @passwordHash,
           IsActive = 1,
           LastModifiedDate = SYSUTCDATETIME()
       WHERE TeacherId = @teacherId`,
      [
        { name: "passwordHash", type: TYPES.NVarChar, value: passwordHash },
        { name: "teacherId", type: TYPES.Int, value: teacherId },
      ]
    );
    return teacherId;
  }

  const principalId = await getOrCreatePrincipal(email, fullName);
  await execQuery(
    `INSERT INTO dbo.Teacher (PrincipalId, Email, FullName, PasswordHash, IsActive, QuizLimit)
     VALUES (@principalId, @email, @fullName, @passwordHash, 1, 40)`,
    [
      { name: "principalId", type: TYPES.Int, value: principalId },
      { name: "email", type: TYPES.NVarChar, value: email },
      { name: "fullName", type: TYPES.NVarChar, value: fullName },
      { name: "passwordHash", type: TYPES.NVarChar, value: passwordHash },
    ]
  );

  const created = await execQuery(
    `SELECT TOP 1 TeacherId
     FROM dbo.Teacher
     WHERE Email = @email
     ORDER BY TeacherId DESC`,
    [{ name: "email", type: TYPES.NVarChar, value: email }]
  );
  return Number(created.rows[0].TeacherId);
}

async function getProTeacherPlanId() {
  const plan = await execQuery(
    `SELECT TOP 1 PlanId
     FROM dbo.SubscriptionPlan
     WHERE LOWER(PlanName) = LOWER('Pro Teacher Plan')
       AND IsActive = 1`,
    []
  );
  if (!plan.rows.length) {
    throw new Error("Pro Teacher Plan is not available or inactive.");
  }
  return Number(plan.rows[0].PlanId);
}

async function main() {
  const planId = await getProTeacherPlanId();
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  const seededUsers = [];

  for (const user of USERS) {
    let chosenEmail = user.email;
    let teacherId = null;

    const picked = await pickUsableEmail(user.email);
    chosenEmail = picked.email;
    teacherId = picked.teacherId;

    if (!teacherId) {
      try {
        teacherId = await getOrCreateTeacher({ email: chosenEmail, fullName: user.fullName }, passwordHash);
      } catch (err) {
        if (!isRegistryDuplicateError(err)) throw err;
        const fallback = await pickUsableEmail(toTeacherAliasEmail(user.email));
        chosenEmail = fallback.email;
        teacherId = fallback.teacherId
          || (await getOrCreateTeacher({ email: chosenEmail, fullName: user.fullName }, passwordHash));
      }
    }

    await upsertUserNameRegistry(teacherId, chosenEmail);
    await activatePlanForUser("Teacher", teacherId, planId);
    seededUsers.push({ email: chosenEmail, teacherId });
    console.log(`Seeded ${chosenEmail} as Pro Teacher (TeacherId=${teacherId})`);
  }

  console.log("");
  console.log("Credentials:");
  for (const user of seededUsers) {
    console.log(`- ${user.email} / ${DEFAULT_PASSWORD}`);
  }
}

main().catch((err) => {
  console.error("Failed to seed Pro Teacher test users.");
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
