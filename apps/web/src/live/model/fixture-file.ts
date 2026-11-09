import {
  liveFixtureCommentsSchema,
  type LiveFixtureComment,
} from "@kakeai/contracts";

/** Mirrors the server-side `LiveRunSourceInput` limit. */
export const MAX_LIVE_FIXTURE_COMMENTS = 10_000;

/**
 * Parses a fixture JSON file with the same contract the API validates against,
 * so malformed files fail in the browser before a Run is created.
 */
export function parseLiveFixtureCommentsJson(text: string): LiveFixtureComment[] {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("fixture の JSON を解析できませんでした。");
  }
  const parsed = liveFixtureCommentsSchema
    .max(MAX_LIVE_FIXTURE_COMMENTS)
    .safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const location =
      issue === undefined || issue.path.length === 0
        ? "全体"
        : issue.path
            .map((entry) => (typeof entry === "number" ? `[${entry}]` : String(entry)))
            .join(".");
    throw new Error(
      `fixture の形式が不正です（${location}: ${issue?.message ?? "不明なエラー"}）。`,
    );
  }
  return parsed.data;
}
