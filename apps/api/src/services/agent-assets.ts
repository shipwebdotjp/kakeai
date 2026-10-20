import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  AGENT_ERROR_CODES,
  type AgentAssetProvenance,
  type Asset,
} from "@kakeai/contracts";
import type { LimitsConfig } from "../config.ts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { ApiError } from "../http/errors.ts";
import { logger } from "../logger.ts";
import type { DataDirectories } from "../storage/paths.ts";
import { AgentOperationError, agentIssue } from "../agent/errors.ts";
import { ingestUpload } from "./assets.ts";

export interface AgentAssetImportInput {
  path: string;
  originalFilename?: string;
  provenance?: AgentAssetProvenance;
}

export interface AgentAssetImportResult {
  asset: Asset;
  jobId: string | null;
  deduplicated: boolean;
}

function safeFilename(value: string): string {
  const cleaned = basename(value)
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim();
  if (cleaned.length === 0) {
    return "import";
  }
  return [...cleaned].slice(0, 255).join("");
}

/** Source-read failures are caller errors; everything else is ours. */
function isSourceReadFailure(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return (
    code === "ENOENT" ||
    code === "EACCES" ||
    code === "EPERM" ||
    code === "EISDIR" ||
    code === "ENOTDIR"
  );
}

function invalidSourcePath(): AgentOperationError {
  return new AgentOperationError(AGENT_ERROR_CODES.VALIDATION_ERROR, [
    agentIssue(["path"], "invalid_value", "読み取り可能なファイルを指定してください。"),
  ]);
}

/**
 * Copies the caller-provided local file into the app temp directory while
 * hashing it, so ingest code only ever sees an app-owned path.
 */
async function stageFile(
  sourcePath: string,
  tempPath: string,
  maxBytes: number,
): Promise<{ sha256: string; byteSize: number }> {
  const info = await stat(sourcePath).catch((error: unknown) => {
    if (isSourceReadFailure(error)) {
      return null;
    }
    throw error;
  });
  if (info === null || !info.isFile()) {
    throw invalidSourcePath();
  }
  if (info.size > maxBytes) {
    throw new ApiError(413, "FILE_TOO_LARGE", undefined, { maxBytes });
  }

  const hash = createHash("sha256");
  let byteSize = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      byteSize += chunk.length;
      if (byteSize > maxBytes) {
        callback(new ApiError(413, "FILE_TOO_LARGE", undefined, { maxBytes }));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      createReadStream(sourcePath),
      meter,
      createWriteStream(tempPath, { mode: 0o600 }),
    );
  } catch (error) {
    if (error instanceof ApiError || error instanceof AgentOperationError) {
      throw error;
    }
    if (isSourceReadFailure(error)) {
      throw new AgentOperationError(AGENT_ERROR_CODES.VALIDATION_ERROR, [
        agentIssue(["path"], "unreadable", "ファイルを読み取れませんでした。"),
      ]);
    }
    // Write-side failures (ENOSPC, EACCES on the temp directory, ...) are
    // server faults; keep the detail in the log, not in the wire response.
    logger.error("agent_asset_import_failed", {
      errorName: error instanceof Error ? error.name : typeof error,
      code: (error as NodeJS.ErrnoException).code,
    });
    throw new AgentOperationError("INTERNAL_ERROR");
  }
  return { sha256: hash.digest("hex"), byteSize };
}

export async function importAgentAsset(
  prisma: PrismaClient,
  directories: DataDirectories,
  limits: LimitsConfig,
  input: AgentAssetImportInput,
): Promise<AgentAssetImportResult> {
  const tempPath = join(directories.tmp, `agent-import-${randomUUID()}`);
  try {
    const { sha256, byteSize } = await stageFile(input.path, tempPath, limits.maxUploadBytes);
    const outcome = await ingestUpload(prisma, directories, limits, {
      tempPath,
      originalFilename: safeFilename(input.originalFilename ?? input.path),
      sha256,
      byteSize,
      ...(input.provenance === undefined ? {} : { origin: "generated" as const }),
      ...(input.provenance === undefined
        ? {}
        : { provenanceJson: JSON.stringify(input.provenance) }),
    });
    return {
      asset: outcome.asset,
      jobId: outcome.jobId,
      deduplicated: outcome.deduplicated,
    };
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}
