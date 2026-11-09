import {
  liveProgramDocumentSchema,
  validateLiveProgramDocumentForVersion,
  type LiveProgramDocument,
} from "@kakeai/contracts";
import type { RefinementCtx } from "zod";
import { isCueSegment } from "./visual";

export type LiveProgramValidationScope = "draft" | "version";
export type LiveProgramValidationSeverity = "error" | "warning";

export interface LiveProgramValidationIssue {
  path: (string | number)[];
  code: string;
  message: string;
  scope: LiveProgramValidationScope;
  severity: LiveProgramValidationSeverity;
}

function normalizePath(path: readonly PropertyKey[]): (string | number)[] {
  return path.filter(
    (entry): entry is string | number =>
      typeof entry === "string" || typeof entry === "number",
  );
}

function draftSchemaIssues(
  document: LiveProgramDocument,
): { issues: LiveProgramValidationIssue[]; parsed: LiveProgramDocument | null } {
  const parsed = liveProgramDocumentSchema.safeParse(document);
  if (parsed.success) {
    return { issues: [], parsed: parsed.data };
  }
  return {
    issues: parsed.error.issues.map((issue) => ({
      path: normalizePath(issue.path),
      code: issue.code,
      message: issue.message,
      scope: "draft",
      severity: "error",
    })),
    parsed: null,
  };
}

function versionRuleIssues(document: LiveProgramDocument): LiveProgramValidationIssue[] {
  const issues: LiveProgramValidationIssue[] = [];
  const ctx: RefinementCtx = {
    value: document,
    issues: [],
    addIssue(issue) {
      const normalized = typeof issue === "string" ? { message: issue } : issue;
      issues.push({
        path:
          "path" in normalized
            ? normalizePath(normalized.path ?? [])
            : [],
        code: "version-rule",
        message: normalized.message ?? "版を確定できません。",
        scope: "version",
        severity: "error",
      });
    },
  };
  validateLiveProgramDocumentForVersion(document, ctx);
  return issues;
}

function durationWarning(document: LiveProgramDocument): LiveProgramValidationIssue | null {
  // The validation panel also renders while a malformed draft is being
  // repaired; never throw before the schema issues have been shown.
  if (document === null || typeof document !== "object") {
    return null;
  }
  const rawSegments: unknown = document.segments;
  const targetDurationMs: unknown = document.targetDurationMs;
  if (
    !Array.isArray(rawSegments) ||
    typeof targetDurationMs !== "number" ||
    !Number.isFinite(targetDurationMs)
  ) {
    return null;
  }
  let total = 0;
  for (const segment of rawSegments) {
    if (segment === null || typeof segment !== "object") {
      continue;
    }
    const entry = segment as { kind?: unknown; targetDurationMs?: unknown };
    if (entry.kind === "cut_in") {
      continue;
    }
    if (
      typeof entry.targetDurationMs === "number" &&
      Number.isFinite(entry.targetDurationMs)
    ) {
      total += entry.targetDurationMs;
    }
  }
  if (total === 0) {
    return null;
  }
  const difference = Math.abs(total - targetDurationMs);
  const threshold = Math.max(60_000, targetDurationMs * 0.2);
  if (difference <= threshold) {
    return null;
  }
  return {
    path: ["segments"],
    code: "duration-mismatch",
    message: `セグメント目標尺の合計（${Math.round(total / 1000)}秒）が全体目標尺（${Math.round(
      targetDurationMs / 1000,
    )}秒）と大きくずれています。`,
    scope: "version",
    severity: "warning",
  };
}

/**
 * UI-side validation. Draft issues mirror the contract schema so the editor can
 * explain a rejected save before sending it. Version issues cover spine and
 * completeness rules; warnings never block finalize.
 */
export function validateLiveProgramDocument(
  document: LiveProgramDocument,
): LiveProgramValidationIssue[] {
  const draft = draftSchemaIssues(document);
  // Version rules assume the document shape is intact. Run them on the parsed
  // copy so schema defaults fill missing arrays; a malformed draft can produce
  // misleading paths or throw on missing objects.
  const versionIssues = draft.parsed === null ? [] : versionRuleIssues(draft.parsed);
  const warning = durationWarning(draft.parsed ?? document);
  return [...draft.issues, ...versionIssues, ...(warning === null ? [] : [warning])];
}

export function draftValidationIssues(
  document: LiveProgramDocument,
): LiveProgramValidationIssue[] {
  return validateLiveProgramDocument(document).filter(
    (issue) => issue.scope === "draft" && issue.severity === "error",
  );
}

export function versionValidationIssues(
  document: LiveProgramDocument,
): LiveProgramValidationIssue[] {
  return validateLiveProgramDocument(document).filter((issue) => issue.scope === "version");
}

/** Human-readable segments used by the editor validation panel. */
export function validationPathLabel(path: readonly (string | number)[]): string {
  const parts: string[] = [];
  for (let index = 0; index < path.length; index += 1) {
    const part = path[index]!;
    if (typeof part === "number") {
      parts.push(`#${part + 1}`);
      continue;
    }
    switch (part) {
      case "segments":
        parts.push("セグメント");
        break;
      case "cues":
        parts.push("キュー");
        break;
      case "cards":
        parts.push("カード");
        break;
      case "states":
        parts.push("状態");
        break;
      case "materials":
        parts.push("素材");
        break;
      case "cutIns":
        parts.push("CutIn");
        break;
      case "visual":
        parts.push("中央ビジュアル");
        break;
      case "safety":
        parts.push("安全設定");
        break;
      case "playout":
        parts.push("プレイアウト");
        break;
      case "commentPolicy":
        parts.push("コメント設定");
        break;
      default:
        parts.push(part);
        break;
    }
  }
  return parts.join(" / ");
}

export function hasBlockingDraftIssues(document: LiveProgramDocument): boolean {
  return draftValidationIssues(document).length > 0;
}

/** Small structural helper shared by the segment list and validation UI. */
export function cueSegmentCueCount(document: LiveProgramDocument, segmentId: string): number {
  const segment = document.segments.find((entry) => entry.id === segmentId);
  return segment !== undefined && isCueSegment(segment) ? segment.cues.length : 0;
}
