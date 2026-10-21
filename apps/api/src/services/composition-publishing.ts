import type { CompositionManifest, CompositionVersion } from "@kakeai/contracts";
import { logger } from "../logger.ts";
import type { CompositionAuthoringService } from "./authoring-context.ts";
import type { CompositionService } from "./compositions.ts";

/**
 * One publish/validate outcome. The HTTP route and the Agent Access binding
 * both call `publishOrValidateComposition` so `dryRun` keeps the same meaning
 * in every binding.
 */
export type CompositionPublishOutcome =
  | { dryRun: true; manifest: CompositionManifest; fontDiagnostics: string[] }
  | { dryRun: false; version: CompositionVersion; fontDiagnostics: string[] };

export interface PublishCompositionInput {
  entrypoint?: string;
}

/**
 * Font diagnostics are advisory: a broken theme or font catalog must not turn
 * the validation outcome into an error, so the failure is reported as a note.
 */
export async function diagnoseCompositionFonts(
  compositionService: CompositionService,
  authoringService: CompositionAuthoringService | undefined,
  compositionId: string,
): Promise<string[]> {
  if (authoringService === undefined) {
    return [];
  }
  try {
    const composition = await compositionService.getCompositionById(compositionId);
    return await authoringService.diagnoseStyleFonts(composition.draft?.styleProvenance);
  } catch (error) {
    // The detail stays in the server log; clients only need the fact that the
    // advisory font diagnostics were skipped.
    logger.warn("composition_font_diagnostics_failed", {
      compositionId,
      message: error instanceof Error ? error.message : String(error),
    });
    return ["Font診断を省略しました。"];
  }
}

export async function publishOrValidateComposition(
  compositionService: CompositionService,
  authoringService: CompositionAuthoringService | undefined,
  compositionId: string,
  input: PublishCompositionInput,
  options: { dryRun: boolean },
): Promise<CompositionPublishOutcome> {
  if (options.dryRun) {
    const [manifest, fontDiagnostics] = await Promise.all([
      compositionService.validateDraft(compositionId, input),
      diagnoseCompositionFonts(compositionService, authoringService, compositionId),
    ]);
    return { dryRun: true, manifest, fontDiagnostics };
  }
  const [version, fontDiagnostics] = await Promise.all([
    compositionService.publish(compositionId, input),
    diagnoseCompositionFonts(compositionService, authoringService, compositionId),
  ]);
  return { dryRun: false, version, fontDiagnostics };
}
