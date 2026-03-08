const { getSubscriptionStatus, assertCanCreateQuiz } = require("./subscription");
const { PaymentRequiredError } = require("./paymentErrors");

async function getStudentQuizCount(studentId) {
  const s = await getSubscriptionStatus("Student", studentId);
  return (s.aiUsed || 0) + (s.manualUsed || 0);
}

async function getStudentQuizLimit(studentId) {
  const s = await getSubscriptionStatus("Student", studentId);
  return (s.aiLimit || 0) + (s.manualLimit || 0);
}

async function getManagerQuizCount(managerId) {
  const s = await getSubscriptionStatus("Teacher", managerId);
  return (s.aiUsed || 0) + (s.manualUsed || 0);
}

async function getManagerQuizLimit(managerId) {
  const s = await getSubscriptionStatus("Teacher", managerId);
  return (s.aiLimit || 0) + (s.manualLimit || 0);
}

async function assertStudentCanCreateQuiz(studentId, extra = 1, kind = "manual") {
  return assertCanCreateQuiz("Student", studentId, kind, extra);
}

async function assertManagerCanCreateQuiz(managerId, extra = 1, kind = "manual") {
  return assertCanCreateQuiz("Teacher", managerId, kind, extra);
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

