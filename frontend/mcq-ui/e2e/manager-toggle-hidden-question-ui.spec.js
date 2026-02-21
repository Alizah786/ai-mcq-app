import { test, expect, request } from "@playwright/test";

const API_BASE = process.env.E2E_API_URL || "http://127.0.0.1:4000";

function uid() {
  return `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

async function apiJson(ctx, method, path, body, token) {
  const res = await ctx.fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    data: body ?? undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} ${path} failed (${res.status()}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

test("manager can toggle hide-for-student checkbox on quiz screen", async ({ page }) => {
  const suffix = uid();
  const managerEmail = `mgr_${suffix}@e2e.local`;
  const managerPassword = "Pass1234!";
  const studentUserName = `student_${suffix}`;
  const studentPassword = "Pass1234!";
  const studentCode = `STD-${suffix}`;
  const className = `E2E Manager UI ${suffix}`;
  const quizTitle = `E2E Manager Quiz ${suffix}`;
  const questionText = "Manager toggle hidden question UI test";

  const api = await request.newContext();

  // Seed test data through API
  await apiJson(api, "POST", "/api/auth/signup", {
    userType: "Manager",
    email: managerEmail,
    fullName: `Manager ${suffix}`,
    password: managerPassword,
  });
  const managerLogin = await apiJson(api, "POST", "/api/auth/login", {
    identifier: managerEmail,
    password: managerPassword,
    userType: "Manager",
  });
  const managerToken = managerLogin.token;
  expect(managerToken).toBeTruthy();

  const createdStudent = await apiJson(
    api,
    "POST",
    "/api/manager/students",
    {
      userName: studentUserName,
      studentCode,
      password: studentPassword,
    },
    managerToken
  );
  const studentId = Number(createdStudent.studentId);
  expect(studentId).toBeGreaterThan(0);

  const createdClass = await apiJson(
    api,
    "POST",
    "/api/classes",
    {
      className,
      subject: "E2E",
      gradeLevel: "12",
      studentId,
    },
    managerToken
  );
  const classId = Number(createdClass.classId);
  expect(classId).toBeGreaterThan(0);

  const createdQuiz = await apiJson(
    api,
    "POST",
    `/api/classes/${classId}/quizzes`,
    {
      title: quizTitle,
      description: "Manager UI toggle test",
    },
    managerToken
  );
  const quizId = Number(createdQuiz.quizId);
  expect(quizId).toBeGreaterThan(0);

  await apiJson(
    api,
    "PUT",
    `/api/quizzes/${quizId}/content`,
    {
      questions: [
        {
          questionText: questionText,
          explanation: "Toggle hide/unhide in UI",
          isHiddenForStudent: false,
          options: [
            { label: "A", text: "Option 1", isCorrect: true },
            { label: "B", text: "Option 2", isCorrect: false },
            { label: "C", text: "Option 3", isCorrect: false },
            { label: "D", text: "Option 4", isCorrect: false },
          ],
        },
      ],
    },
    managerToken
  );
  await apiJson(api, "POST", `/api/quizzes/${quizId}/publish`, {}, managerToken);

  // Seed manager auth + selected student into browser storage
  await page.addInitScript((payload) => {
    window.localStorage.setItem("ai-mcq-auth", JSON.stringify({ token: payload.token, user: payload.user }));
    window.localStorage.setItem("ai-mcq-selected-student-id", String(payload.studentId));
  }, { token: managerLogin.token, user: managerLogin.user, studentId });

  await page.goto(`/quiz/${quizId}`);
  await expect(page.getByText(questionText, { exact: false })).toBeVisible();

  const hideCheckbox = page.getByLabel("Hide this question for students");
  await expect(hideCheckbox).toBeVisible();
  await expect(hideCheckbox).not.toBeChecked();

  await hideCheckbox.click();
  await expect(page.getByText("Hidden for students (manager preview only)")).toBeVisible();
  await expect(hideCheckbox).toBeChecked();

  await hideCheckbox.click();
  await expect(page.getByText("Hidden for students (manager preview only)")).toHaveCount(0);
  await expect(hideCheckbox).not.toBeChecked();
});
