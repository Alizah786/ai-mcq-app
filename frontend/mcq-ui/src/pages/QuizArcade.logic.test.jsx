import { describe, expect, test } from "vitest";
import {
  buildTargets,
  buildLiveArcadeOutcomes,
  resolveArcadeRoundFrame,
  resolveArcadeRoundSelection,
} from "./QuizArcade";

describe("QuizArcade logic", () => {
  test("buildTargets constrains long option cards so text stays within the box", () => {
    const targets = buildTargets(
      {
        options: [
          {
            optionId: 1,
            text: "This is a very long answer option intended to verify wrapping and prevent text overflow outside the answer card box in arcade mode.",
            isCorrect: false,
          },
        ],
      },
      860,
      { fallMultiplier: 1 }
    );

    expect(targets).toHaveLength(1);
    expect(targets[0].width).toBeLessThanOrEqual(210);
    expect(targets[0].width).toBeGreaterThanOrEqual(96);
    expect(targets[0].height).toBeGreaterThanOrEqual(70);
  });

  test("falls back to the correct option id when a preserved-correct round succeeds without a selected target id", () => {
    const result = resolveArcadeRoundSelection({
      roundState: "failed",
      roundWasSuccess: true,
      roundSelectedOptionId: null,
      roundCorrectOptionId: null,
      options: [
        { questionOptionId: 41, text: "Correct", isCorrect: true },
        { questionOptionId: 52, text: "Wrong", isCorrect: false },
      ],
    });

    expect(result).toEqual({
      wasSuccessfulRound: true,
      resolvedOptionId: 41,
    });
  });

  test("keeps the current round counted as correct in live outcomes when success was already resolved", () => {
    const outcomes = buildLiveArcadeOutcomes({
      questionOutcomes: {},
      currentQuestionId: 999,
      roundState: "failed",
      roundWasSuccess: true,
    });

    expect(outcomes).toEqual({
      999: true,
    });
  });

  test("prefers the stored round correct option id when the selected target id is unavailable", () => {
    const result = resolveArcadeRoundSelection({
      roundState: "success",
      roundWasSuccess: true,
      roundSelectedOptionId: null,
      roundCorrectOptionId: 88,
      options: [],
    });

    expect(result).toEqual({
      wasSuccessfulRound: true,
      resolvedOptionId: 88,
    });
  });

  test("fails the round when the player hits the correct answer card", () => {
    const result = resolveArcadeRoundFrame({
      fieldWidth: 860,
      lives: 3,
      hits: 0,
      misses: 0,
      roundState: "playing",
      roundMessage: "",
      roundColor: "#1d4ed8",
      roundCorrectOptionId: 10,
      projectiles: [{ id: "p1", x: 50, y: 100, width: 12, height: 22 }],
      targets: [
        {
          id: "correct",
          optionId: 10,
          isCorrect: true,
          x: 45,
          y: 80,
          width: 100,
          height: 70,
          drift: 0,
          speed: 0,
        },
      ],
    });

    expect(result.roundState).toBe("failed");
    expect(result.lives).toBe(2);
    expect(result.roundMessage).toBe("Wrong shot. You hit the correct answer.");
  });

  test("fails the round when a wrong answer reaches the fail line", () => {
    const result = resolveArcadeRoundFrame({
      fieldWidth: 860,
      lives: 3,
      hits: 0,
      misses: 0,
      roundState: "playing",
      roundMessage: "",
      roundColor: "#1d4ed8",
      roundCorrectOptionId: 10,
      projectiles: [],
      targets: [
        {
          id: "wrong",
          optionId: 20,
          isCorrect: false,
          x: 45,
          y: 540,
          width: 100,
          height: 40,
          drift: 0,
          speed: 1,
        },
        {
          id: "correct",
          optionId: 10,
          isCorrect: true,
          x: 200,
          y: 100,
          width: 100,
          height: 70,
          drift: 0,
          speed: 0,
        },
      ],
    });

    expect(result.roundState).toBe("failed");
    expect(result.lives).toBe(2);
    expect(result.misses).toBe(1);
    expect(result.roundMessage).toBe("A wrong answer slipped through.");
  });

  test("succeeds the round when all wrong answers are removed and preserves the correct option id", () => {
    const result = resolveArcadeRoundFrame({
      fieldWidth: 860,
      lives: 3,
      hits: 0,
      misses: 0,
      roundState: "playing",
      roundMessage: "",
      roundColor: "#1d4ed8",
      roundCorrectOptionId: 10,
      projectiles: [{ id: "p1", x: 50, y: 100, width: 12, height: 22 }],
      targets: [
        {
          id: "wrong",
          optionId: 20,
          isCorrect: false,
          x: 45,
          y: 80,
          width: 100,
          height: 70,
          drift: 0,
          speed: 0,
        },
        {
          id: "correct",
          optionId: 10,
          isCorrect: true,
          x: 200,
          y: 100,
          width: 100,
          height: 70,
          drift: 0,
          speed: 0,
        },
      ],
    });

    expect(result.roundState).toBe("success");
    expect(result.hits).toBe(1);
    expect(result.roundSelectedOptionId).toBe(10);
    expect(result.roundMessage).toBe("Round cleared. You preserved the correct answer.");
  });

  test("does not mark a failed round as correct when no success flag was preserved", () => {
    const outcomes = buildLiveArcadeOutcomes({
      questionOutcomes: {},
      currentQuestionId: 999,
      roundState: "failed",
      roundWasSuccess: false,
    });

    expect(outcomes).toEqual({
      999: false,
    });
  });
});
