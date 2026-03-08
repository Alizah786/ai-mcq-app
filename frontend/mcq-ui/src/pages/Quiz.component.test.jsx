import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import Quiz from "./Quiz";

const mockUseParams = vi.fn();
const mockUseAuth = vi.fn();
const mockUseUIText = vi.fn();
const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiPut = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useParams: () => mockUseParams(),
  };
});

vi.mock("../context/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("../context/UITextContext", () => ({
  useUIText: () => mockUseUIText(),
}));

vi.mock("../api/http", () => ({
  apiGet: (...args) => mockApiGet(...args),
  apiPost: (...args) => mockApiPost(...args),
  apiPut: (...args) => mockApiPut(...args),
}));

function buildQuiz(overrides = {}) {
  return {
    title: "Practice Quiz",
    assessmentType: "QUIZ",
    timeLimitMinutes: 0,
    questions: [
      {
        questionId: 101,
        questionType: "MCQ",
        questionText: "Capital of France?",
        options: [
          { optionId: 1, label: "A", text: "Paris" },
          { optionId: 2, label: "B", text: "Rome" },
        ],
      },
      {
        questionId: 202,
        questionType: "SHORT_TEXT",
        questionText: "Name a primary color",
      },
    ],
    ...overrides,
  };
}

function buildUIText() {
  return {
    loadCategoryKeys: vi.fn().mockResolvedValue({}),
    t: (_key, fallback) => fallback,
    msg: (_key, fallback) => fallback,
  };
}

describe("Quiz component", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mockUseParams.mockReturnValue({ quizId: "quiz-1" });
    mockUseAuth.mockReturnValue({
      isManager: false,
      selectedStudentId: null,
      user: { userId: 12, role: "Student", managerId: 0, isDirectStudent: false },
    });
    mockUseUIText.mockReturnValue(buildUIText());
    mockApiPost.mockImplementation((endpoint) => {
      if (String(endpoint).includes("/attempts/start")) {
        return Promise.resolve({
          attemptId: 77,
          quiz: buildQuiz(),
          attemptLimit: 1,
          attemptsRemaining: 1,
          attemptSummary: [],
          attemptStartedAtUtc: null,
        });
      }
      throw new Error(`Unexpected POST ${endpoint}`);
    });
    mockApiGet.mockImplementation((endpoint) => {
      if (endpoint === "/api/billing/subscription-status") {
        return Promise.resolve({ subscription: null });
      }
      throw new Error(`Unexpected GET ${endpoint}`);
    });
    mockApiPut.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  test("student submit stays disabled until all questions are answered", async () => {
    render(<Quiz />);

    const submitButton = await screen.findByRole("button", { name: "Submit Quiz" });
    expect(submitButton).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/A\.\s+Paris/i));
    expect(submitButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("Enter short answer"), {
      target: { value: "Red" },
    });

    await waitFor(() => expect(submitButton).toBeEnabled());
  });

  test("manager can submit immediately after the quiz loads", async () => {
    mockUseAuth.mockReturnValue({
      isManager: true,
      selectedStudentId: 44,
      user: { userId: 2, role: "Manager" },
    });

    render(<Quiz />);

    const submitButton = await screen.findByRole("button", { name: "Submit Quiz" });
    expect(submitButton).toBeEnabled();
  });

  test("assignment mode hides quiz submit and shows assignment PDF action", async () => {
    mockApiPost.mockImplementation((endpoint) => {
      if (String(endpoint).includes("/attempts/start")) {
        return Promise.resolve({
          attemptId: 88,
          quiz: buildQuiz({ assessmentType: "ASSIGNMENT" }),
          attemptLimit: 1,
          attemptsRemaining: 1,
          attemptSummary: [],
          attemptStartedAtUtc: null,
        });
      }
      throw new Error(`Unexpected POST ${endpoint}`);
    });

    render(<Quiz />);

    expect(await screen.findByRole("button", { name: "Download Assignment PDF" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit Quiz" })).not.toBeInTheDocument();
  });

  test("free-plan student locks hint access", async () => {
    mockApiGet.mockImplementation((endpoint) => {
      if (endpoint === "/api/billing/subscription-status") {
        return Promise.resolve({
          subscription: {
            isTrial: true,
            price: 0,
            lockHintForFreePlan: true,
            lockPdfForFreePlan: true,
          },
        });
      }
      throw new Error(`Unexpected GET ${endpoint}`);
    });

    render(<Quiz />);

    await screen.findByRole("button", { name: "Submit Quiz" });

    fireEvent.click(screen.getByRole("button", { name: "Show Hint (3 steps)" }));
    expect(screen.getByText("This feature is available in paid version.")).toBeInTheDocument();
  });

  test("free-plan non-student locks solved PDF export", async () => {
    mockUseAuth.mockReturnValue({
      isManager: false,
      selectedStudentId: null,
      user: { userId: 33, role: "Viewer", managerId: 0, isDirectStudent: false },
    });

    mockApiGet.mockImplementation((endpoint) => {
      if (endpoint === "/api/billing/subscription-status") {
        return Promise.resolve({
          subscription: {
            isTrial: true,
            price: 0,
            lockHintForFreePlan: false,
            lockPdfForFreePlan: true,
          },
        });
      }
      throw new Error(`Unexpected GET ${endpoint}`);
    });

    render(<Quiz />);

    const pdfButton = await screen.findByRole("button", { name: "Download Quiz PDF" });
    expect(pdfButton).toHaveAttribute("title", "This feature is available in paid version.");

    fireEvent.click(pdfButton);
    expect(screen.getByText("This feature is available in paid version.")).toBeInTheDocument();
  });

  test("time limit expiry auto-submits the quiz attempt", async () => {
    mockApiPost.mockImplementation((endpoint, payload) => {
      if (String(endpoint).includes("/attempts/start")) {
        return Promise.resolve({
          attemptId: 99,
          quiz: buildQuiz({
            timeLimitMinutes: 1,
            questions: [
              {
                questionId: 101,
                questionType: "MCQ",
                questionText: "Capital of France?",
                options: [
                  { optionId: 1, label: "A", text: "Paris" },
                  { optionId: 2, label: "B", text: "Rome" },
                ],
              },
            ],
          }),
          attemptLimit: 1,
          attemptsRemaining: 0,
          attemptSummary: [],
          attemptStartedAtUtc: new Date(Date.now() - 60000).toISOString(),
        });
      }
      if (String(endpoint).includes("/submit")) {
        return Promise.resolve({
          attemptLimit: 1,
          attemptsRemaining: 0,
          attemptSummary: [{ submitted: true, attemptId: 99 }],
          payload,
        });
      }
      throw new Error(`Unexpected POST ${endpoint}`);
    });

    mockApiGet.mockImplementation((endpoint) => {
      if (endpoint === "/api/billing/subscription-status") {
        return Promise.resolve({ subscription: null });
      }
      if (endpoint === "/api/attempts/99/result") {
        return Promise.resolve({
          score: 1,
          total: 1,
          scorePercent: 100,
          attemptsRemaining: 0,
          attemptLimit: 1,
          attemptSummary: [{ submitted: true, attemptId: 99, score: 1, total: 1 }],
          questionResults: [],
        });
      }
      throw new Error(`Unexpected GET ${endpoint}`);
    });

    render(<Quiz />);

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        "/api/attempts/99/submit",
        expect.objectContaining({
          answers: [
            expect.objectContaining({
              questionId: 101,
            }),
          ],
        }),
      );
    });
    expect(await screen.findByText("Result")).toBeInTheDocument();
  }, 10000);

  test("manager sees hidden-question preview state and cannot answer it", async () => {
    mockUseAuth.mockReturnValue({
      isManager: true,
      selectedStudentId: 44,
      user: { userId: 2, role: "Manager" },
    });
    mockApiPost.mockImplementation((endpoint) => {
      if (String(endpoint).includes("/attempts/start")) {
        return Promise.resolve({
          attemptId: 120,
          quiz: buildQuiz({
            questions: [
              {
                questionId: 101,
                questionType: "MCQ",
                questionText: "Capital of France?",
                isHiddenForStudent: true,
                options: [
                  { optionId: 1, label: "A", text: "Paris" },
                  { optionId: 2, label: "B", text: "Rome" },
                ],
              },
            ],
          }),
          attemptLimit: 1,
          attemptsRemaining: 1,
          attemptSummary: [],
          attemptStartedAtUtc: null,
        });
      }
      throw new Error(`Unexpected POST ${endpoint}`);
    });

    render(<Quiz />);

    expect(await screen.findByText("Hidden for students (teacher preview only)")).toBeInTheDocument();
    expect(screen.getByLabelText("Hide this question for students")).toBeChecked();
    expect(screen.getByLabelText(/A\.\s+Paris/i)).toBeDisabled();
  });

  test("manager can toggle question visibility", async () => {
    mockUseAuth.mockReturnValue({
      isManager: true,
      selectedStudentId: 44,
      user: { userId: 2, role: "Manager" },
    });
    mockApiPost.mockImplementation((endpoint) => {
      if (String(endpoint).includes("/attempts/start")) {
        return Promise.resolve({
          attemptId: 121,
          quiz: buildQuiz({
            questions: [
              {
                questionId: 101,
                questionType: "MCQ",
                questionText: "Capital of France?",
                isHiddenForStudent: false,
                options: [
                  { optionId: 1, label: "A", text: "Paris" },
                  { optionId: 2, label: "B", text: "Rome" },
                ],
              },
            ],
          }),
          attemptLimit: 1,
          attemptsRemaining: 1,
          attemptSummary: [],
          attemptStartedAtUtc: null,
        });
      }
      throw new Error(`Unexpected POST ${endpoint}`);
    });

    render(<Quiz />);

    const toggle = await screen.findByLabelText("Hide this question for students");
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockApiPut).toHaveBeenCalledWith("/api/questions/101/visibility", { isHiddenForStudent: true });
    });
    expect(screen.getByText("Hidden for students (teacher preview only)")).toBeInTheDocument();
    expect(screen.getByLabelText(/A\.\s+Paris/i)).toBeDisabled();
  });
});
