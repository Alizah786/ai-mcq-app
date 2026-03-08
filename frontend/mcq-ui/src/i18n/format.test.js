import { describe, expect, test } from "vitest";
import { formatCurrency } from "./format";

describe("i18n format", () => {
  test("currency formatting differs by locale", () => {
    const us = formatCurrency(12.5, "USD", "en-US");
    const gb = formatCurrency(12.5, "GBP", "en-GB");
    expect(us).not.toBe(gb);
  });
});
