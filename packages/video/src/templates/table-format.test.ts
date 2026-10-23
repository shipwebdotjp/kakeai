import { describe, expect, it } from "vitest";
import { currencyForLocale, formatNumber } from "./table-format";

describe("formatNumber locale", () => {
  it("formats currency in JPY for ja-JP", () => {
    expect(formatNumber(1000, "currency", "ja-JP")).toContain("1,000");
    expect(formatNumber(1000, "currency", "ja-JP")).toContain("￥");
  });

  it("formats currency in USD for en-US", () => {
    expect(formatNumber(1000, "currency", "en-US")).toContain("$");
    expect(formatNumber(1000, "currency", "en-US")).toContain("1,000");
  });

  it("maps ja locales to JPY and others to USD", () => {
    expect(currencyForLocale("ja-JP")).toBe("JPY");
    expect(currencyForLocale("en-US")).toBe("USD");
  });
});
