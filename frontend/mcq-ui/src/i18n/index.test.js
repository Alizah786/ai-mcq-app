import { describe, expect, test } from "vitest";
import i18n from "./index";

describe("i18n language switching", () => {
  test("can switch between supported locales and still resolve Create Quiz labels", async () => {
    await i18n.changeLanguage("en-US");
    expect(i18n.t("createQuiz.tab_ai")).toBeTruthy();
    await i18n.changeLanguage("en-GB");
    expect(i18n.t("createQuiz.tab_ai")).toBeTruthy();
    expect(i18n.resolvedLanguage).toBe("en-GB");
  });
});
