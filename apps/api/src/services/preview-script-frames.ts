import type {
  AgentPreviewScriptFrameInput,
  AgentPreviewScriptFrameOutput,
  ScriptVersionPreview,
} from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { resourceNotFound, validationError } from "../http/validation.ts";
import type { PreviewRasterizer } from "../media/preview-rasterize.ts";
import {
  compilePreview,
  getScriptVersionPreview,
} from "./script-versions.ts";
import type { CompiledPreview } from "./script-versions/preview.ts";
import { requireEdition } from "./script-versions/common.ts";
import { toOutputProfile } from "../dto/mappers.ts";
import type { DataDirectories } from "../storage/paths.ts";
import { rasterizePreviewFrame } from "./preview-frame-raster.ts";

interface ResolvedLineTime {
  lineId: string;
  startMs: number;
  durationMs: number;
}

/**
 * Resolves a line in the resolved timeline of the requested saved version.
 * The timeline is built from that version, so a line split or a duration
 * change in a newer version does not change where an older version points.
 */
function findLineTime(
  preview: ScriptVersionPreview | CompiledPreview,
  lineId: string,
): ResolvedLineTime | undefined {
  for (const scene of preview.timeline.scenes) {
    const line = scene.lines.find((entry) => entry.lineId === lineId);
    if (line !== undefined) {
      return {
        lineId: line.lineId,
        startMs: line.startMs,
        durationMs: line.durationMs,
      };
    }
  }
  return undefined;
}

/**
 * Rasterizes a saved ScriptVersion or an unsaved draft ContentDocument at a
 * resolved time without creating a render Job, a new ScriptVersion, or an
 * Artifact. The HTML comes from the same preview compiler as the Web UI
 * (`compilePreview` / `getScriptVersionPreview`). A saved version may instead
 * be addressed by `lineId` + `offsetMs`; the line's start and duration come
 * from that version's resolved timeline.
 */
export async function getScriptVersionFrame(
  prisma: PrismaClient,
  directories: DataDirectories,
  rasterizer: PreviewRasterizer,
  origin: string,
  input: AgentPreviewScriptFrameInput,
): Promise<AgentPreviewScriptFrameOutput> {
  let preview: ScriptVersionPreview | CompiledPreview;
  let scriptVersionId: string | null = null;
  let requestedTimeMs: number;
  let resolvedLine: ResolvedLineTime | undefined;

  if ("scriptVersionId" in input) {
    preview = await getScriptVersionPreview(
      prisma,
      directories,
      input.scriptVersionId,
    );
    scriptVersionId = input.scriptVersionId;
    if (input.lineId !== undefined) {
      resolvedLine = findLineTime(preview, input.lineId);
      if (resolvedLine === undefined) {
        throw validationError([
          {
            path: ["lineId"],
            code: "not_found",
            message: `指定した台本版の timeline に存在しない行です: ${input.lineId}`,
          },
        ]);
      }
      const offsetMs = input.offsetMs ?? 0;
      if (offsetMs > resolvedLine.durationMs) {
        throw validationError([
          {
            path: ["offsetMs"],
            code: "invalid_value",
            message: "offsetMs は対象行の尺の範囲内にしてください。",
          },
        ]);
      }
      requestedTimeMs = resolvedLine.startMs + offsetMs;
    } else {
      // The saved-version schema guarantees exactly one of timeMs / lineId.
      requestedTimeMs = input.timeMs ?? 0;
    }
  } else {
    const edition =
      input.languageEditionId === undefined
        ? null
        : await requireEdition(prisma, input.languageEditionId);
    if (edition !== null && input.content.locale !== edition.locale) {
      throw validationError([
        {
          path: ["content", "locale"],
          code: "invalid_value",
          message: `言語版のロケール(${edition.locale})と一致しません。`,
        },
      ]);
    }
    preview = await compilePreview(prisma, directories, input.content, {
      strictTakeDurations: true,
      outputProfile:
        edition === null
          ? undefined
          : toOutputProfile(edition.work.outputProfile),
    });
    requestedTimeMs = input.timeMs;
  }

  const durationMs = preview.timeline.totalDurationMs;
  if (requestedTimeMs > durationMs) {
    throw validationError([
      {
        path: ["timeMs"],
        code: "invalid_value",
        message: "timeMs は台本の解決済み尺の範囲内にしてください。",
      },
    ]);
  }

  const { png, width, height } = await rasterizePreviewFrame(
    rasterizer,
    preview.compositionHtml,
    requestedTimeMs,
    origin,
  );
  return {
    scriptVersionId,
    requestedTimeMs,
    ...(resolvedLine === undefined
      ? {}
      : {
          resolvedLineId: resolvedLine.lineId,
          resolvedTimeMs: requestedTimeMs,
        }),
    durationMs,
    width,
    height,
    mimeType: "image/png",
    imageBase64: png.toString("base64"),
  };
}
