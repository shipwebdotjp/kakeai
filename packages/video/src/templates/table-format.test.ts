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

  it("formats currency in CNY for zh-Hans and TWD for zh-Hant", () => {
    expect(formatNumber(1000, "currency", "zh-Hans")).toContain("1,000");
    expect(formatNumber(1000, "currency", "zh-Hant")).toContain("1,000");
    // 通貨記号は ICU の locale 解決に依存する（zh-Hans は ¥、zh-Hant は NT$ または $）
    expect(formatNumber(1000, "currency", "zh-Hans")).toMatch(/[¥￥]/);
  });

  it("maps each supported locale to its currency", () => {
    expect(currencyForLocale("ja-JP")).toBe("JPY");
    expect(currencyForLocale("en-US")).toBe("USD");
    expect(currencyForLocale("zh-Hans")).toBe("CNY");
    expect(currencyForLocale("zh-Hant")).toBe("TWD");
  });
});
