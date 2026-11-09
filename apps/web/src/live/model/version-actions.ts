import { liveProgramDocumentSchema, type FinalizeLiveProgramVersionRequest, type LiveProgramDocument } from "@kakeai/contracts";
import { z } from "zod";
import { ApiError } from "../../api/client";

export interface LiveProgramRevisionConflict {
  programId: string;
  currentRevision: number;
  currentDocument: LiveProgramDocument;
}

const revisionConflictDetailsSchema = z.object({
  programId: z.string().min(1),
  currentRevision: z.number().int().nonnegative(),
  currentDocument: liveProgramDocumentSchema,
});

/**
 * Parses the 409 details contract. Finalize can also report a P2002 conflict
 * with only `programId`; that has no reloadable document and returns null so
 * the UI shows a plain retry message.
 */
export function parseLiveProgramRevisionConflict(
  error: unknown,
): LiveProgramRevisionConflict | null {
  if (!(error instanceof ApiError) || error.code !== "LIVE_PROGRAM_REVISION_CONFLICT") {
    return null;
  }
  const parsed = revisionConflictDetailsSchema.safeParse(error.details);
  return parsed.success ? parsed.data : null;
}

export interface LiveProgramServerIssue {
  path: (string | number)[];
  code: string;
  message: string;
}

const serverIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  code: z.string(),
  message: z.string(),
});

const serverIssuesDetailsSchema = z.object({
  issues: z.array(serverIssueSchema),
});

export function parseLiveProgramServerIssues(error: unknown): LiveProgramServerIssue[] {
  if (!(error instanceof ApiError) || error.details === undefined) {
    return [];
  }
  const parsed = serverIssuesDetailsSchema.safeParse(error.details);
  return parsed.success ? parsed.data.issues : [];
}

export interface SaveDraftRequest {
  expectedRevision: number;
  document: LiveProgramDocument;
}

export function buildSaveDraftRequest(
  expectedRevision: number,
  document: LiveProgramDocument,
): SaveDraftRequest {
  return { expectedRevision, document };
}

/**
 * Finalize uses the server's saved draft, not the editor's unsaved document.
 * Callers must only finalize when the editor is clean and the revision matches.
 */
export function buildFinalizeVersionRequest(
  expectedRevision: number,
  note: string,
): FinalizeLiveProgramVersionRequest {
  const trimmed = note.trim();
  return trimmed.length === 0
    ? { expectedRevision }
    : { expectedRevision, note: trimmed };
}

export function buildRestoreVersionDraftRequest(expectedRevision: number): {
  expectedRevision: number;
} {
  return { expectedRevision };
}
