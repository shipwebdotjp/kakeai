import { describe, expect, it } from "vitest";
import {
  MAX_LIVE_FIXTURE_COMMENTS,
  parseLiveFixtureCommentsJson,
} from "./fixture-file";

describe("live fixture file parser", () => {
  it("parses valid comments and applies the contract defaults", () => {
    const comments = parseLiveFixtureCommentsJson(
      JSON.stringify([{ atMs: 1000, author: "viewer", text: "こんにちは" }]),
    );
    expect(comments).toEqual([
      { atMs: 1000, author: "viewer", text: "こんにちは", kind: "normal" },
    ]);
  });

  it("rejects a value that is not an array", () => {
    expect(() => parseLiveFixtureCommentsJson("{}")).toThrow();
  });

  it("rejects a comment with invalid fields", () => {
    expect(() =>
      parseLiveFixtureCommentsJson(
        JSON.stringify([{ atMs: -1, author: "", text: "" }]),
      ),
    ).toThrow();
  });

  it("rejects more comments than the server accepts", () => {
    const comments = Array.from(
      { length: MAX_LIVE_FIXTURE_COMMENTS + 1 },
      (_, index) => ({ atMs: index, author: "viewer", text: "hello" }),
    );
    expect(() => parseLiveFixtureCommentsJson(JSON.stringify(comments))).toThrow();
  });

  it("rejects malformed JSON", () => {
    expect(() => parseLiveFixtureCommentsJson("[")).toThrow();
  });
});
