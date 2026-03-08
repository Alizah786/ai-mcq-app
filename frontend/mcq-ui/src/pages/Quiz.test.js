import { describe, expect, test } from "vitest";
import {
  canSubmitQuizAttempt,
  formatRemaining,
  getExportHeadingTitle,
  isQuestionAnswered,
  isStudentQuizComplete,
  orderQuizQuestions,
} from "./quizUtils";

describe("Quiz helpers", () => {
  test("detects answered state across supported question types", () => {
    expect(isQuestionAnswered({ questionType: "MCQ" }, { selectedOptionId: 3 })).toBe(true);
    expect(isQuestionAnswered({ questionType: "SHORT_TEXT" }, { textAnswer: "  answer  " })).toBe(true);
    expect(isQuestionAnswered({ questionType: "NUMERIC" }, { numberAnswer: "0" })).toBe(true);
    expect(
      isQuestionAnswered(
        {
          questionType: "MIX_MATCH_DRAG",
          leftItems: [{ leftMatchPairId: 11 }, { leftMatchPairId: 12 }],
        },
        { matchMap: { 11: 21, 12: 22 } },
      ),
    ).toBe(true);
    expect(isQuestionAnswered({ questionType: "LONG" }, { textAnswer: "   " })).toBe(false);
  });

  test("requires students to answer every question before submission", () => {
    const quiz = {
      questions: [
        { questionId: 1, questionType: "MCQ" },
        { questionId: 2, questionType: "SHORT_TEXT" },
      ],
    };

    expect(
      isStudentQuizComplete(quiz, {
        1: { selectedOptionId: 9 },
        2: { textAnswer: "done" },
      }),
    ).toBe(true);

    expect(
      isStudentQuizComplete(quiz, {
        1: { selectedOptionId: 9 },
      }),
    ).toBe(false);
  });

  test("prevents assignment submission and allows manager override", () => {
    expect(
      canSubmitQuizAttempt({
        quiz: { assessmentType: "ASSIGNMENT", questions: [{ questionId: 1, questionType: "MCQ" }] },
        answers: { 1: { selectedOptionId: 2 } },
        isManager: true,
      }),
    ).toBe(false);

    expect(
      canSubmitQuizAttempt({
        quiz: { assessmentType: "QUIZ", questions: [{ questionId: 1, questionType: "MCQ" }] },
        answers: {},
        isManager: true,
      }),
    ).toBe(true);
  });

  test("orders quiz questions by type rank and question id", () => {
    const ordered = orderQuizQuestions([
      { questionId: 8, questionType: "LONG" },
      { questionId: 3, questionType: "MCQ" },
      { questionId: 5, questionType: "NUMERIC" },
      { questionId: 2, questionType: "MCQ" },
      { questionId: 7, questionType: "TRUE_FALSE" },
    ]);

    expect(ordered.map((question) => question.questionId)).toEqual([2, 3, 7, 5, 8]);
  });

  test("formats export headings and countdown display", () => {
    expect(getExportHeadingTitle("", true)).toBe("Assignment");
    expect(getExportHeadingTitle("assignment 12 review")).toBe("Assignment 12");
    expect(getExportHeadingTitle("Midterm Quiz")).toBe("Midterm Quiz");
    expect(formatRemaining(65)).toBe("01:05");
    expect(formatRemaining(-10)).toBe("00:00");
  });
});
