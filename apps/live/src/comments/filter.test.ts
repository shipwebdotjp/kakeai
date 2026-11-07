import type { CommentEvent } from "@kakeai/contracts";
import { describe, expect, it } from "vitest";
import { CommentFilter } from "./filter.ts";

const BASE_TIME = Date.parse("2026-11-07T12:00:00.000Z");

function comment(
  text: string,
  options: { author?: string; seconds?: number; id?: string } = {},
): CommentEvent {
  const at = new Date(BASE_TIME + (options.seconds ?? 0) * 1000).toISOString();
  return {
    id: options.id ?? `yt-${Math.random().toString(36).slice(2)}`,
    authorName: options.author ?? "みかん",
    text,
    publishedAt: at,
    receivedAt: at,
    kind: "normal",
  };
}

function filter(overrides: Partial<ConstructorParameters<typeof CommentFilter>[0]> = {}) {
  return new CommentFilter({
    ngWords: [],
    blockedTopics: [],
    maxLength: 300,
    maxPerAuthorPerMinute: 3,
    ...overrides,
  });
}

describe("CommentFilter", () => {
  it("accepts a normal comment", () => {
    const result = filter().filter(comment("今日のニュース楽しみです"));
    expect(result.decision).toBe("accepted");
    expect(result.reasons).toEqual([]);
    expect(result.blockedAuthor).toBe(false);
    expect(result.redactedText).toBe("今日のニュース楽しみです");
  });

  it("blocks URLs and redacts them", () => {
    const result = filter().filter(comment("http://example.com を見てください"));
    expect(result.decision).toBe("blocked");
    expect(result.reasons).toContain("url");
    expect(result.redactedText).toContain("[URL]");
    expect(result.redactedText).not.toContain("example.com");

    const bareDomain = filter().filter(comment("example.com/foo を見てください"));
    expect(bareDomain.decision).toBe("blocked");
    expect(bareDomain.reasons).toContain("url");
  });

  it("blocks personal information and addresses", () => {
    const cases = [
      "連絡先は taro@example.com です",
      "電話は 090-1234-5678 です",
      "〒150-0001 に住んでいます",
      "住所は東京都渋谷区です",
      "@taro_123 まで連絡ください",
    ];
    for (const text of cases) {
      const result = filter().filter(comment(text));
      expect(result.decision, text).toBe("blocked");
      expect(result.reasons, text).toContain("pii");
      expect(result.redactedText, text).not.toMatch(/taro@example|090-1234|150-0001|渋谷区|taro_123/);
    }
  });

  it("reviews long comments", () => {
    const result = filter({ maxLength: 10 }).filter(comment("これはとても長いコメントです"));
    expect(result.decision).toBe("review");
    expect(result.reasons).toContain("too_long");
  });

  it("blocks emoji-only and repeated-character spam", () => {
    expect(filter().filter(comment("😊😊😊")).decision).toBe("blocked");
    expect(filter().filter(comment("😊😊😊")).reasons).toContain("spam");
    expect(filter().filter(comment("あああああああああ")).decision).toBe("blocked");
    expect(filter().filter(comment("チャンネル登録お願いします")).decision).toBe("blocked");
    expect(filter().filter(comment("チャンネル登録しました")).decision).toBe("accepted");
  });

  it("blocks limited attack words", () => {
    for (const text of ["お前は無能だ", "死ね", "黙れ"]) {
      const result = filter().filter(comment(text));
      expect(result.decision, text).toBe("blocked");
      expect(result.reasons, text).toContain("attack");
    }
    // The limited pattern must not swallow ordinary words.
    expect(filter().filter(comment("バカンスの話をしましょう")).decision).toBe("accepted");
  });

  it("normalizes full-width and case for NG words and blocked topics", () => {
    const ng = filter({ ngWords: ["ＮＧワード"] }).filter(comment("これはngワードです"));
    expect(ng.decision).toBe("blocked");
    expect(ng.reasons).toContain("ng_word");

    const topic = filter().filter(comment("政治の話はしません"));
    expect(topic.decision).toBe("accepted");
    const configured = filter({ blockedTopics: ["政治"] }).filter(comment("政治の話はしません"));
    expect(configured.decision).toBe("blocked");
    expect(configured.reasons).toContain("blocked_topic");
  });

  it("reviews repeated comments from the same author", () => {
    const source = filter({ maxPerAuthorPerMinute: 3 });
    expect(source.filter(comment("1つ目", { seconds: 0 })).decision).toBe("accepted");
    expect(source.filter(comment("2つ目", { seconds: 10 })).decision).toBe("accepted");
    expect(source.filter(comment("3つ目", { seconds: 20 })).decision).toBe("accepted");
    const fourth = source.filter(comment("4つ目", { seconds: 30 }));
    expect(fourth.decision).toBe("review");
    expect(fourth.reasons).toContain("rate_limited");

    expect(source.filter(comment("5つ目", { seconds: 70 })).decision).toBe("accepted");
  });

  it("blocks future comments from a blocked author and re-evaluates existing ones", () => {
    const source = filter();
    const first = source.filter(comment("こんにちは", { author: "spam" }));
    expect(first.decision).toBe("accepted");

    source.blockAuthor("SPAM");
    const next = source.filter(comment("またきました", { author: "spam" }));
    expect(next.decision).toBe("blocked");
    expect(next.blockedAuthor).toBe(true);

    const reevaluated = source.reevaluate(first.event);
    expect(reevaluated.decision).toBe("blocked");
    expect(reevaluated.blockedAuthor).toBe(true);
  });

  it("blocks existing comments after a topic is blocked", () => {
    const source = filter();
    const event = comment("その話題について話します");
    expect(source.filter(event).decision).toBe("accepted");
    source.blockTopic("その話題");
    const reevaluated = source.reevaluate(event);
    expect(reevaluated.decision).toBe("blocked");
    expect(reevaluated.reasons).toContain("blocked_topic");
  });
});
