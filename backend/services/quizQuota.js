const { TYPES } = require("tedious");
const { execQuery } = require("../db");

class PaymentRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = "PaymentRequiredError";
    this.status = 402;
  }
}

async function getStudentQuizCount(studentId) {
  const r = await execQuery(
    `SELECT COUNT(1) AS QuizCount
     FROM dbo.Quiz q
     JOIN dbo.Class c ON c.ClassId = q.ClassId
     WHERE c.StudentId = @studentId`,
    [{ name: "studentId", type: TYPES.Int, value: studentId }]
  );
  return Number(r.rows[0]?.QuizCount || 0);
}

async function getStudentQuizLimit(studentId) {
  const r = await execQuery(
    "SELECT QuizLimit FROM dbo.Student WHERE StudentId = @studentId",
    [{ name: "studentId", type: TYPES.Int, value: studentId }]
  );
  const limit = Number(r.rows[0]?.QuizLimit);
  return Number.isFinite(limit) && limit > 0 ? limit : 40;
}

async function getManagerQuizCount(managerId) {
  const r = await execQuery(
    `SELECT COUNT(1) AS QuizCount
     FROM dbo.Quiz q
     JOIN dbo.Class c ON c.ClassId = q.ClassId
     JOIN dbo.Student s ON s.StudentId = c.StudentId
     WHERE s.TeacherId = @managerId`,
    [{ name: "managerId", type: TYPES.Int, value: managerId }]
  );
  return Number(r.rows[0]?.QuizCount || 0);
}

async function getManagerQuizLimit(managerId) {
  const r = await execQuery(
    "SELECT QuizLimit FROM dbo.Teacher WHERE TeacherId = @managerId",
    [{ name: "managerId", type: TYPES.Int, value: managerId }]
  );
  const limit = Number(r.rows[0]?.QuizLimit);
  return Number.isFinite(limit) && limit > 0 ? limit : 40;
}

async function assertStudentCanCreateQuiz(studentId, extra = 1) {
  const [count, limit] = await Promise.all([
    getStudentQuizCount(studentId),
    getStudentQuizLimit(studentId),
  ]);
  if (count + extra > limit) {
    throw new PaymentRequiredError(
      `Free quiz limit reached (${limit}). Please upgrade your plan to create more quizzes.`
    );
  }
  return { count, limit };
}

async function assertManagerCanCreateQuiz(managerId, extra = 1) {
  const [count, limit] = await Promise.all([
    getManagerQuizCount(managerId),
    getManagerQuizLimit(managerId),
  ]);
  if (count + extra > limit) {
    throw new PaymentRequiredError(
      `Free quiz limit reached (${limit}). Please upgrade your plan to create more quizzes.`
    );
  }
  return { count, limit };
}

module.exports = {
  PaymentRequiredError,
  getStudentQuizCount,
  getStudentQuizLimit,
  getManagerQuizCount,
  getManagerQuizLimit,
  assertStudentCanCreateQuiz,
  assertManagerCanCreateQuiz,
};

