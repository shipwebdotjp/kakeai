import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  link,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import type { Artifact } from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { ApiError } from "../http/errors.ts";
import { validationError } from "../http/validation.ts";
import { logger } from "../logger.ts";
import type { DataDirectories } from "../storage/paths.ts";
import { getArtifact, resolveArtifactContent } from "./artifacts.ts";

export interface ExportArtifactInput {
  artifactId: string;
  outputDir: string;
  filename?: string | undefined;
}

export interface ExportedArtifact {
  artifact: Artifact;
  sourcePath: string;
  exportedPath: string;
}

function extensionForFormat(format: Artifact["format"]): string {
  switch (format) {
    case "mp4":
      return "mp4";
    case "png":
      return "png";
    case "jpeg":
      return "jpg";
    case "vtt":
      return "vtt";
    default:
      throw new ApiError(500, "EXPORT_FAILED", "Artifactの形式が不正です。");
  }
}

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

function sanitizeStem(value: string, maxBytes: number): string {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/gu, "-")
    .replace(/\s+/gu, " ")
    .replace(/^[.\s]+|[.\s]+$/gu, "")
    .trim();
  const segments: string[] = [];
  let bytes = 0;
  for (const { segment } of graphemeSegmenter.segment(cleaned)) {
    const size = Buffer.byteLength(segment, "utf8");
    if (bytes + size > maxBytes) {
      break;
    }
    segments.push(segment);
    bytes += size;
  }
  const stem = segments.join("").trim();
  return stem.length > 0 ? stem : "artifact";
}

async function defaultFilename(
  prisma: PrismaClient,
  artifact: Artifact,
): Promise<string> {
  const job = await prisma.job.findUnique({
    where: { id: artifact.jobId },
    select: { workId: true },
  });
  const work =
    job?.workId === null || job?.workId === undefined
      ? null
      : await prisma.work.findUnique({
          where: { id: job.workId },
          select: { title: true },
        });
  const suffix = `-${artifact.id}.${extensionForFormat(artifact.format)}`;
  const budget = Math.max(1, 255 - Buffer.byteLength(suffix, "utf8"));
  const stem = sanitizeStem(work?.title ?? "artifact", budget);
  return `${stem}${suffix}`;
}

function assertFilename(filename: string, format: Artifact["format"]): void {
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : "";
  const invalid =
    filename !== basename(filename) ||
    filename.includes("\\") ||
    filename === "." ||
    filename === ".." ||
    stem.length === 0 ||
    /[<>:"|?*\u0000-\u001f]/u.test(filename) ||
    /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu.test(filename) ||
    Buffer.byteLength(filename, "utf8") > 255;
  if (invalid) {
    throw validationError([
      {
        path: ["filename"],
        code: "invalid_value",
        message:
          "ファイル名はパス区切りを含まない、255バイト以内の名前にしてください。",
      },
    ]);
  }
  const suffixes =
    format === "jpeg" ? [".jpg", ".jpeg"] : [`.${extensionForFormat(format)}`];
  const lower = filename.toLowerCase();
  if (!suffixes.some((suffix) => lower.endsWith(suffix))) {
    throw validationError([
      {
        path: ["filename"],
        code: "invalid_value",
        message: `拡張子は ${suffixes.join(" または ")} にしてください。`,
      },
    ]);
  }
}

function targetExists(): ApiError {
  return new ApiError(409, "EXPORT_TARGET_EXISTS", undefined, {
    issues: [
      {
        path: ["filename"],
        code: "custom",
        message:
          "同名のファイルまたはディレクトリが既に存在します。別のファイル名を指定してください。",
      },
    ],
  });
}

/**
 * Publishes the temp file without replacing an existing target. A hard link is
 * atomic and fails with EEXIST when the name was taken. Filesystems without
 * hard links fall back to an exclusive copy.
 */
async function publishWithoutOverwrite(
  tempPath: string,
  targetPath: string,
): Promise<void> {
  try {
    await link(tempPath, targetPath);
    return;
  } catch (error) {
    if (isErrnoCode(error, "EEXIST")) {
      throw targetExists();
    }
  }
  try {
    await copyFile(tempPath, targetPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if (isErrnoCode(error, "EEXIST")) {
      throw targetExists();
    }
    // With O_EXCL, a non-EEXIST failure means the target, if it exists at all,
    // is the partial file this call created (a concurrent writer would have
    // produced EEXIST above). Remove it so a failed export does not
    // permanently occupy the name.
    await rm(targetPath, { force: true }).catch(() => undefined);
    throw new ApiError(500, "EXPORT_FAILED", "ファイルを書き出せませんでした。");
  }
}

function isErrnoCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === code
  );
}

/**
 * Copies one Artifact into a caller-chosen directory. The canonical Artifact
 * stays in the app data root, and an existing target is never replaced, so
 * this operation only creates a new file outside the app.
 *
 * `outputDir` may be any absolute directory (same-user trust model). The copy
 * uses a copy-on-write clone when the filesystem supports it, falls back to a
 * normal copy, and is published with an atomic hard link from a temp file.
 */
export async function exportArtifact(
  prisma: PrismaClient,
  directories: DataDirectories,
  input: ExportArtifactInput,
): Promise<ExportedArtifact> {
  if (input.outputDir.includes("\0")) {
    throw validationError([
      {
        path: ["outputDir"],
        code: "invalid_value",
        message: "outputDir に NUL 文字を含められません。",
      },
    ]);
  }
  if (!isAbsolute(input.outputDir)) {
    throw validationError([
      {
        path: ["outputDir"],
        code: "invalid_value",
        message: "outputDir は絶対パスで指定してください。",
      },
    ]);
  }
  const directoryInfo = await stat(input.outputDir).catch((error: unknown) => {
    // Only a missing path or a non-directory component is an input problem.
    // Other failures (e.g. EACCES) mean the path exists but is unusable.
    if (isErrnoCode(error, "ENOENT") || isErrnoCode(error, "ENOTDIR")) {
      return null;
    }
    throw new ApiError(
      500,
      "EXPORT_FAILED",
      "書き出し先ディレクトリにアクセスできませんでした。",
    );
  });
  if (directoryInfo === null || !directoryInfo.isDirectory()) {
    throw validationError([
      {
        path: ["outputDir"],
        code: "invalid_value",
        message: "存在するディレクトリを指定してください。",
      },
    ]);
  }

  const [artifact, location] = await Promise.all([
    getArtifact(prisma, input.artifactId),
    resolveArtifactContent(prisma, directories, input.artifactId),
  ]);
  const filename =
    input.filename === undefined
      ? await defaultFilename(prisma, artifact)
      : input.filename;
  assertFilename(filename, artifact.format);

  let directory: string;
  try {
    directory = await realpath(input.outputDir);
  } catch (error) {
    if (isErrnoCode(error, "ENOENT") || isErrnoCode(error, "ENOTDIR")) {
      throw validationError([
        {
          path: ["outputDir"],
          code: "invalid_value",
          message: "存在するディレクトリを指定してください。",
        },
      ]);
    }
    throw new ApiError(
      500,
      "EXPORT_FAILED",
      "書き出し先ディレクトリにアクセスできませんでした。",
    );
  }
  const targetPath = join(directory, filename);
  const existing = await stat(targetPath).catch(() => null);
  if (existing !== null) {
    throw targetExists();
  }

  const tempPath = join(directory, `.${randomUUID()}.tmp`);
  try {
    await copyFile(location.path, tempPath, constants.COPYFILE_FICLONE);
    const copied = await stat(tempPath);
    if (copied.size !== location.byteSize) {
      throw new ApiError(
        500,
        "EXPORT_FAILED",
        "書き出したファイルのサイズが記録と一致しません。",
      );
    }
    await publishWithoutOverwrite(tempPath, targetPath);
    return {
      artifact,
      sourcePath: location.path,
      exportedPath: targetPath,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 500) {
        logger.error("artifact_export_failed", {
          artifactId: input.artifactId,
          outputDir: input.outputDir,
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    }
    logger.error("artifact_export_failed", {
      artifactId: input.artifactId,
      outputDir: input.outputDir,
      code: (error as NodeJS.ErrnoException).code,
      message: error instanceof Error ? error.message : String(error),
    });
    throw new ApiError(500, "EXPORT_FAILED", "ファイルを書き出せませんでした。");
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}
