import { z } from "zod";
import {
  AGENT_ERROR_CODES,
  bulkTtsJobExclusionSchema,
  ttsJobSnapshotSchema,
  type AgentTtsAttachBulkOutput,
  type BulkTtsJobExclusion,
  type ContentDocument,
  type ScriptOperation,
} from "@kakeai/contracts";
import { AgentOperationError, agentIssue } from "../agent/errors.ts";
import { deserializeContent } from "../domain/content-json.ts";
import { toJob, toScriptVersion } from "../dto/mappers.ts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { editAgentScript } from "./agent-script.ts";
import { findAgentRequest, normalizeLedgerAgentId } from "./agent-requests.ts";
import {
  invalidResultReference,
  parseResultReference,
  type ResultReferenceLogDetail,
} from "./agent-result-references.ts";

/**
 * The stored reference of the bulk TTS operation. `tts.attachBulk` restores
 * this reference from the idempotency ledger instead of letting the caller
 * pick Jobs or lines, so an agent never has to build a 100+ entry
 * `line.assignTake` table by hand.
 */
export const bulkTtsResultReferenceSchema = z.strictObject({
  entries: z.array(
    z.strictObject({
      narrationSegmentId: z.string().min(1),
      jobId: z.string().min(1),
    }),
  ),
  excluded: z.array(bulkTtsJobExclusionSchema),
});

export type BulkTtsResultReference = z.infer<typeof bulkTtsResultReferenceSchema>;

export function bulkTtsResultRefOf(
  operation: string,
  resultRef: string,
  detail: ResultReferenceLogDetail = {},
): BulkTtsResultReference {
  const parsed = bulkTtsResultReferenceSchema.safeParse(
    parseResultReference(operation, resultRef, detail),
  );
  if (!parsed.success) {
    throw invalidResultReference(operation, detail);
  }
  return parsed.data;
}

export interface TtsAttachBulkInput {
  scriptVersionId: string;
  bulkRequestId: string;
  requestId: string;
}

/** Failure codes reported in `failures` that have no shared constant. */
const ATTACH_JOB_FAILED_CODE = "TTS_SYNTHESIS_FAILED";
const ATTACH_JOB_CANCELLED_CODE = "CANCELLED";
const ATTACH_LINE_MISSING_CODE = "RESOURCE_NOT_FOUND";
const ATTACH_TEXT_CHANGED_CODE = "TTS_INPUT_INVALID";

function zeroCounts(): AgentTtsAttachBulkOutput["counts"] {
  return { queued: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 };
}

function bulkNotFound(): AgentOperationError {
  return new AgentOperationError("RESOURCE_NOT_FOUND", [
    agentIssue(
      ["bulkRequestId"],
      "not_found",
      "元の一括生成が見つかりません。requestId付きのtts.createBulkで開始したものだけ確定できます。",
    ),
  ]);
}

function baseStale(): AgentOperationError {
  return new AgentOperationError(AGENT_ERROR_CODES.SCRIPT_BASE_STALE, [
    agentIssue(
      ["scriptVersionId"],
      "stale",
      "基準の台本版が現在の版ではありません。最新の版を取得して再試行してください。",
    ),
  ]);
}

type PointLineLocation = {
  sceneId: string;
  line: ContentDocument["scenes"][number]["lines"][number];
};

/** Indexes every point-scene line once so verification is a map lookup. */
function indexPointLines(content: ContentDocument): Map<string, PointLineLocation> {
  const lineById = new Map<string, PointLineLocation>();
  for (const scene of content.scenes) {
    if (scene.kind !== "point") {
      continue;
    }
    for (const line of scene.lines) {
      lineById.set(line.id, { sceneId: scene.id, line });
    }
  }
  return lineById;
}

/**
 * Finalizes one `tts.createBulk` run by attaching every succeeded Job as an
 * Audio Take in a single Script Version.
 *
 * The Job set and the line ids come from the idempotency ledger entry of the
 * original bulk call (`tts.createBulk` + the same agent + `bulkRequestId`),
 * never from caller supplied ids. Only bulk runs started with a `requestId`
 * can be finalized; a run without one, or one started by another agent, is
 * `RESOURCE_NOT_FOUND` so nothing is ever mis-attached.
 *
 * - While any Job is still queued or running, the script is left untouched
 *   and `{ status: "pending", ... }` is returned.
 * - Once every Job is terminal, the succeeded Jobs are verified (the line
 *   still exists in a point scene, the snapshot speech text matches the saved
 *   line, the generated asset is a ready audio asset) and attached atomically
 *   through the same edit path as `script.edit`. Failed, cancelled and
 *   unverifiable lines are reported in `failures` instead of blocking the
 *   rest. The attach itself is idempotent on `requestId`: resending it
 *   returns the existing Script Version.
 */
export async function attachBulkTts(
  prisma: PrismaClient,
  input: TtsAttachBulkInput,
  agentId: string | undefined,
): Promise<AgentTtsAttachBulkOutput> {
  const ledgerRow = await findAgentRequest(prisma, {
    operation: "tts.createBulk",
    agentId: normalizeLedgerAgentId(agentId),
    requestId: input.bulkRequestId,
  });
  if (ledgerRow === null || ledgerRow.resultRef === null) {
    throw bulkNotFound();
  }
  const reference = bulkTtsResultRefOf("tts.createBulk", ledgerRow.resultRef, {
    requestId: input.bulkRequestId,
  });
  const excluded: BulkTtsJobExclusion[] = reference.excluded;

  if (reference.entries.length === 0) {
    return {
      status: "finalized",
      counts: zeroCounts(),
      excluded,
      failures: [],
      scriptVersion: null,
    };
  }

  const jobIds = reference.entries.map((entry) => entry.jobId);
  const rows = await prisma.job.findMany({
    where: { id: { in: jobIds } },
    include: { artifacts: true },
  });
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const entryRows: Array<{ entry: (typeof reference.entries)[number]; row: (typeof rows)[number] }> = [];
  for (const entry of reference.entries) {
    const row = rowById.get(entry.jobId);
    if (row === undefined) {
      throw bulkNotFound();
    }
    entryRows.push({ entry, row });
  }
  if (
    rows.some((row) => row.kind !== "tts" || row.scriptVersionId !== input.scriptVersionId)
  ) {
    throw bulkNotFound();
  }

  const base = await prisma.scriptVersion.findUnique({
    where: { id: input.scriptVersionId },
    include: {
      languageEdition: { select: { id: true, currentScriptVersionId: true } },
    },
  });
  if (base === null) {
    throw new AgentOperationError(AGENT_ERROR_CODES.WORK_NOT_FOUND, [
      agentIssue(["scriptVersionId"], "not_found", "基準の台本版が見つかりません。"),
    ]);
  }

  const counts = zeroCounts();
  const failures: AgentTtsAttachBulkOutput["failures"] = [];
  let pendingCount = 0;
  const succeededJobs: Array<{
    narrationSegmentId: string;
    jobId: string;
    assetId: string;
    speechText: string;
  }> = [];

  for (const { entry, row } of entryRows) {
    const job = toJob(row);
    switch (job.status) {
      case "queued":
        counts.queued += 1;
        pendingCount += 1;
        break;
      case "running":
        counts.running += 1;
        pendingCount += 1;
        break;
      case "succeeded": {
        counts.succeeded += 1;
        if (job.ttsResult === null) {
          throw new AgentOperationError("INTERNAL_ERROR");
        }
        let speechText: string;
        try {
          const snapshot = ttsJobSnapshotSchema.parse(
            JSON.parse(row.inputSnapshotJson) as unknown,
          );
          speechText = snapshot.speechText;
        } catch {
          throw new AgentOperationError("INTERNAL_ERROR");
        }
        succeededJobs.push({
          narrationSegmentId: entry.narrationSegmentId,
          jobId: job.id,
          assetId: job.ttsResult.assetId,
          speechText,
        });
        break;
      }
      case "failed":
        counts.failed += 1;
        failures.push({
          narrationSegmentId: entry.narrationSegmentId,
          jobId: job.id,
          status: "failed",
          code: row.errorCode ?? ATTACH_JOB_FAILED_CODE,
          message: row.errorMessage ?? "音声生成に失敗しました。",
        });
        break;
      case "cancelled":
        counts.cancelled += 1;
        failures.push({
          narrationSegmentId: entry.narrationSegmentId,
          jobId: job.id,
          status: "cancelled",
          code: row.errorCode ?? ATTACH_JOB_CANCELLED_CODE,
          message: row.errorMessage ?? "生成が取り消されました。",
        });
        break;
    }
  }

  if (pendingCount > 0) {
    if (base.languageEdition.currentScriptVersionId !== base.id) {
      throw baseStale();
    }
    return { status: "pending", counts, excluded, failures, scriptVersion: null };
  }

  if (succeededJobs.length === 0) {
    return { status: "finalized", counts, excluded, failures, scriptVersion: null };
  }

  const content = deserializeContent(base.contentJson);
  const lineById = indexPointLines(content);
  const assetIds = [...new Set(succeededJobs.map((succeeded) => succeeded.assetId))];
  const assetRows = await prisma.asset.findMany({ where: { id: { in: assetIds } } });
  const assetById = new Map(assetRows.map((row) => [row.id, row]));
  const operations: ScriptOperation[] = [];
  const markUnverifiable = (
    succeeded: { narrationSegmentId: string; jobId: string },
    code: string,
    message: string,
  ): void => {
    failures.push({
      narrationSegmentId: succeeded.narrationSegmentId,
      jobId: succeeded.jobId,
      status: "failed",
      code,
      message,
    });
    counts.succeeded -= 1;
    counts.failed += 1;
  };
  for (const succeeded of succeededJobs) {
    const located = lineById.get(succeeded.narrationSegmentId);
    if (located === undefined) {
      markUnverifiable(
        succeeded,
        ATTACH_LINE_MISSING_CODE,
        "セリフが見つかりません。生成し直してください。",
      );
      continue;
    }
    if (located.line.speechText.trim() !== succeeded.speechText) {
      markUnverifiable(
        succeeded,
        ATTACH_TEXT_CHANGED_CODE,
        "読み上げテキストが変更されています。生成し直してください。",
      );
      continue;
    }
    const asset = assetById.get(succeeded.assetId);
    if (
      asset === undefined ||
      asset.kind !== "audio" ||
      asset.status !== "ready" ||
      asset.durationMs === null ||
      asset.durationMs <= 0
    ) {
      markUnverifiable(
        succeeded,
        AGENT_ERROR_CODES.ASSET_UNAVAILABLE,
        "生成した音声が利用できません。生成し直してください。",
      );
      continue;
    }
    operations.push({
      op: "line.assignTake",
      sceneId: located.sceneId,
      lineId: succeeded.narrationSegmentId,
      assetId: succeeded.assetId,
      source: "tts",
    });
  }

  if (operations.length === 0) {
    // Nothing attachable. If the same attach already created a version, the
    // world changed since (for example an asset was removed after the
    // attach); a resend still returns that version instead of null.
    const existingAttach = await prisma.scriptVersion.findFirst({
      where: { languageEditionId: base.languageEditionId, agentRequestId: input.requestId },
    });
    if (existingAttach !== null) {
      return {
        status: "finalized",
        counts,
        excluded,
        failures,
        scriptVersion: toScriptVersion(
          existingAttach,
          deserializeContent(existingAttach.contentJson),
        ),
      };
    }
    return { status: "finalized", counts, excluded, failures, scriptVersion: null };
  }

  // The attach itself is idempotent on `requestId` through the same version
  // path as `script.edit`: a resend returns the existing version, a stale
  // base fails without attaching, and a changed world fails as a conflict.
  const edited = await editAgentScript(
    prisma,
    {
      baseScriptVersionId: input.scriptVersionId,
      requestId: input.requestId,
      operations,
    },
    agentId,
  );
  return {
    status: "finalized",
    counts,
    excluded,
    failures,
    scriptVersion: edited.scriptVersion,
  };
}
