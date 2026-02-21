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

test("student cannot see manager-hidden question in quiz attempt", async ({ page }) => {
  const suffix = uid();
  const managerEmail = `mgr_${suffix}@e2e.local`;
  const managerPassword = "Pass1234!";
  const studentUserName = `student_${suffix}`;
  const studentPassword = "Pass1234!";
  const studentCode = `STD-${suffix}`;
  const className = `E2E Class ${suffix}`;
  const quizTitle = `E2E Quiz ${suffix}`;
  const hiddenQuestionText = "Hidden question for student should not appear";
  const visibleQuestionText = "Visible question should appear to student";

  const api = await request.newContext();

  // 1) Create manager
  await apiJson(api, "POST", "/api/auth/signup", {
    userType: "Manager",
    email: managerEmail,
    fullName: `Manager ${suffix}`,
    password: managerPassword,
  });

  // 2) Manager login
  const managerLogin = await apiJson(api, "POST", "/api/auth/login", {
    identifier: managerEmail,
    password: managerPassword,
    userType: "Manager",
  });
  const managerToken = managerLogin.token;
  expect(managerToken).toBeTruthy();

  // 3) Manager creates student
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

  // 4) Manager creates class for that student
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

  // 5) Create draft quiz
  const createdQuiz = await apiJson(
    api,
    "POST",
    `/api/classes/${classId}/quizzes`,
    {
      title: quizTitle,
      description: "E2E hidden-question test",
    },
    managerToken
  );
  const quizId = Number(createdQuiz.quizId);
  expect(quizId).toBeGreaterThan(0);

  // 6) Save quiz content with one hidden and one visible question
  await apiJson(
    api,
    "PUT",
    `/api/quizzes/${quizId}/content`,
    {
      questions: [
        {
          questionText: hiddenQuestionText,
          explanation: "Hidden explanation",
          isHiddenForStudent: true,
          options: [
            { label: "A", text: "Option 1", isCorrect: true },
            { label: "B", text: "Option 2", isCorrect: false },
            { label: "C", text: "Option 3", isCorrect: false },
            { label: "D", text: "Option 4", isCorrect: false },
          ],
        },
        {
          questionText: visibleQuestionText,
          explanation: "Visible explanation",
          isHiddenForStudent: false,
          options: [
            { label: "A", text: "Alpha", isCorrect: true },
            { label: "B", text: "Beta", isCorrect: false },
            { label: "C", text: "Gamma", isCorrect: false },
            { label: "D", text: "Delta", isCorrect: false },
          ],
        },
      ],
    },
    managerToken
  );

  // 7) Publish quiz
  await apiJson(api, "POST", `/api/quizzes/${quizId}/publish`, {}, managerToken);

  // 8) Student login via API, then seed browser auth storage
  const studentLogin = await apiJson(api, "POST", "/api/auth/login", {
    identifier: studentUserName,
    password: studentPassword,
    userType: "Student",
  });
  expect(studentLogin?.token).toBeTruthy();
  expect(studentLogin?.user?.role).toBe("Student");

  await page.addInitScript((authPayload) => {
    window.localStorage.setItem("ai-mcq-auth", JSON.stringify(authPayload));
  }, { token: studentLogin.token, user: studentLogin.user });

  // 9) Open quiz and verify only visible question appears
  await page.goto(`/quiz/${quizId}`);
  await expect(page.getByText(visibleQuestionText, { exact: false })).toBeVisible();
  await expect(page.getByText(hiddenQuestionText, { exact: false })).toHaveCount(0);
});
