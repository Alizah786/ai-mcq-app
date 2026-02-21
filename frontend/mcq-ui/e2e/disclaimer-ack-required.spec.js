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

test("disclaimer acknowledgment is required before quiz submit", async ({ page }) => {
  const suffix = uid();
  const managerEmail = `mgr_${suffix}@e2e.local`;
  const managerPassword = "Pass1234!";
  const studentUserName = `student_${suffix}`;
  const studentPassword = "Pass1234!";
  const studentCode = `STD-${suffix}`;
  const className = `E2E Disclaimer Class ${suffix}`;
  const quizTitle = `E2E Disclaimer Quiz ${suffix}`;
  const questionText = "Disclaimer flow validation question";

  const api = await request.newContext();

  // 1) Setup manager + student + class + published quiz by API
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
      description: "Quiz for disclaimer acknowledgment E2E test",
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
          questionText,
          explanation: "Choose first option",
          options: [
            { label: "A", text: "Correct Option", isCorrect: true },
            { label: "B", text: "Wrong Option 1", isCorrect: false },
            { label: "C", text: "Wrong Option 2", isCorrect: false },
            { label: "D", text: "Wrong Option 3", isCorrect: false },
          ],
        },
      ],
    },
    managerToken
  );
  await apiJson(api, "POST", `/api/quizzes/${quizId}/publish`, {}, managerToken);

  // 2) Student auth into browser storage
  const studentLogin = await apiJson(api, "POST", "/api/auth/login", {
    identifier: studentUserName,
    password: studentPassword,
    userType: "Student",
  });
  expect(studentLogin?.token).toBeTruthy();

  await page.addInitScript((authPayload) => {
    window.localStorage.setItem("ai-mcq-auth", JSON.stringify(authPayload));
  }, { token: studentLogin.token, user: studentLogin.user });

  // 3) Verify submit is blocked before disclaimer ack
  await page.goto(`/quiz/${quizId}`);
  await expect(page.getByText(questionText, { exact: false })).toBeVisible();
  const submitButton = page.getByRole("button", { name: "Submit Quiz" });
  await expect(submitButton).toBeDisabled();

  // 4) Acknowledge disclaimer via API for the current attempt (stable across UI variations)
  const metaText = (await page.locator("p").first().textContent()) || "";
  const attemptIdMatch = metaText.match(/Attempt ID:\s*(\d+)/i);
  expect(attemptIdMatch).toBeTruthy();
  const attemptId = Number(attemptIdMatch[1]);
  expect(attemptId).toBeGreaterThan(0);

  await apiJson(api, "POST", `/api/attempts/${attemptId}/disclaimer-ack`, {}, studentLogin.token);

  // Refresh to start a new attempt with persisted acknowledgment state
  await page.reload();
  await expect(page.getByText(questionText, { exact: false })).toBeVisible();
  await expect(submitButton).toBeEnabled();

  // 5) Select answer and submit
  await page.getByLabel("A. Correct Option").check();
  await submitButton.click();

  // 6) Result should be shown
  await expect(page.getByRole("heading", { name: "Result" })).toBeVisible();
  await expect(page.getByText("Score:", { exact: false })).toBeVisible();
});
