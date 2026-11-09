import {
  liveProgramVersionDocumentSchema,
  type LiveProgramVersionDetail,
} from "@kakeai/contracts";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { ApiError } from "../../http/errors.ts";
import { validationErrorFromZod } from "../../http/validation.ts";
import { canonicalJson } from "../../live/canonical-json.ts";
import { sha256Hex } from "../../live/hash.ts";
import { resolveLiveProgramVersion } from "../../live/version-resolution.ts";
import { assertExpectedRevision, isPrismaCode, toVersionDetail } from "./common.ts";

export interface FinalizeLiveProgramVersionInput {
  expectedRevision: number;
  note?: string;
}

/**
 * Freezes the current draft as an immutable version in one transaction. The
 * draft revision guard and the document/reference validation run inside the
 * same transaction as the insert, and the draft itself is never changed.
 */
export async function finalizeLiveProgramVersion(
  prisma: PrismaClient,
  id: string,
  input: FinalizeLiveProgramVersionInput,
): Promise<LiveProgramVersionDetail> {
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.liveProgram.findUnique({ where: { id } });
      if (row === null) {
        throw new ApiError(404, "RESOURCE_NOT_FOUND", undefined, {
          resource: "live_program",
          id,
        });
      }
      assertExpectedRevision(row, input.expectedRevision);

      let raw: unknown;
      try {
        raw = JSON.parse(row.draftJson);
      } catch {
        throw new ApiError(500, "INTERNAL_ERROR", "保存済みの Live Program を解釈できません。");
      }
      const parsed = liveProgramVersionDocumentSchema.safeParse(raw);
      if (!parsed.success) {
        throw validationErrorFromZod(parsed.error);
      }
      const document = parsed.data;
      const resolutionSnapshot = await resolveLiveProgramVersion(tx, id, document);

      const documentJson = canonicalJson(document);
      const resolutionSnapshotJson = canonicalJson(resolutionSnapshot);
      const max = await tx.liveProgramVersion.aggregate({
        where: { programId: id },
        _max: { versionNumber: true },
      });
      const versionNumber = (max._max.versionNumber ?? 0) + 1;
      const created = await tx.liveProgramVersion.create({
        data: {
          programId: id,
          versionNumber,
          schemaVersion: document.schemaVersion,
          documentJson,
          documentSha256: sha256Hex(documentJson),
          resolutionSnapshotJson,
          resolutionSnapshotSha256: sha256Hex(resolutionSnapshotJson),
          ...(input.note === undefined ? {} : { note: input.note }),
        },
      });
      return toVersionDetail(created);
    });
  } catch (error) {
    if (isPrismaCode(error, "P2002")) {
      throw new ApiError(
        409,
        "LIVE_PROGRAM_REVISION_CONFLICT",
        "他の版確定と競合しました。再試行してください。",
        { programId: id },
      );
    }
    throw error;
  }
}
