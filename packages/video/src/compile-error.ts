import type { TimelineIssue } from "./timeline";

export class CompositionCompileError extends Error {
  readonly issues: TimelineIssue[];

  constructor(issues: TimelineIssue[]) {
    super(issues[0]?.message ?? "Compositionを生成できません。");
    this.name = "CompositionCompileError";
    this.issues = issues;
  }
}
