import type {
  AgentPreviewFrameInput,
  AgentPreviewFrameOutput,
} from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { resourceNotFound, validationError } from "../http/validation.ts";
import { parsePngDimensions } from "../media/png.ts";
import { readStillFramePng, stillFrameCacheDir } from "../media/still-frame.ts";
import { resolveArtifactContent } from "./artifacts.ts";
import type { DataDirectories } from "../storage/paths.ts";

export type PreviewFrameResult = AgentPreviewFrameOutput;

/**
 * Returns a full-resolution still PNG of a render artifact at the requested
 * time. Only `role: "render"` MP4 artifacts are eligible; this operation adds
 * no version and creates no artifact, so it is a read.
 */
export async function getPreviewFrame(
  prisma: PrismaClient,
  directories: DataDirectories,
  input: AgentPreviewFrameInput,
): Promise<PreviewFrameResult> {
  const row = await prisma.artifact.findUnique({ where: { id: input.artifactId } });
  if (row === null) {
    throw resourceNotFound("artifact", input.artifactId);
  }
  if (row.role !== "render" || row.format !== "mp4") {
    throw validationError([
      {
        path: ["artifactId"],
        code: "invalid_value",
        message: "preview.frame は render の MP4 成果物だけを対象にします。",
      },
    ]);
  }
  if (row.durationMs !== null && input.timeMs > row.durationMs) {
    throw validationError([
      {
        path: ["timeMs"],
        code: "invalid_value",
        message: "timeMs は成果物の確定尺の範囲内にしてください。",
      },
    ]);
  }
  const location = await resolveArtifactContent(prisma, directories, input.artifactId);
  const source = { filePath: location.path, sha256: row.sha256 };
  const { resolvedTimeMs, png } = await readStillFramePng(
    source,
    input.timeMs,
    stillFrameCacheDir(directories.tmp),
  );
  const { width, height } = parsePngDimensions(png);
  return {
    artifactId: row.id,
    requestedTimeMs: input.timeMs,
    resolvedTimeMs,
    width,
    height,
    mimeType: "image/png",
    pngBase64: png.toString("base64"),
  };
}
