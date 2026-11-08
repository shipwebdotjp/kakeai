import { lstat, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { isSafeGeneratedAudioFileName } from "@kakeai/contracts";

export interface GeneratedAudioFile {
  path: string;
  mediaType: "audio/wav" | "audio/mpeg";
}

function isInside(root: string, target: string): boolean {
  return target !== root && target.startsWith(`${root}${sep}`);
}

/**
 * Resolves `/run/generated/<file>` against the current run directory. Only a
 * flat wav/mp3 file directly under `generated/` is accepted; traversal,
 * absolute paths, other subdirectories and symlinks are rejected.
 */
export async function resolveGeneratedAudioFile(
  runDir: string,
  requestPath: string,
): Promise<GeneratedAudioFile | null> {
  if (!requestPath.startsWith("generated/") || requestPath.includes("\0")) {
    return null;
  }
  const fileName = requestPath.slice("generated/".length);
  if (!isSafeGeneratedAudioFileName(fileName)) {
    return null;
  }
  const generatedDir = resolve(runDir, "generated");
  const candidate = join(generatedDir, fileName);
  let info;
  try {
    info = await lstat(candidate);
  } catch {
    return null;
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    return null;
  }
  let canonicalFile: string;
  let canonicalDir: string;
  try {
    [canonicalFile, canonicalDir] = await Promise.all([
      realpath(candidate),
      realpath(generatedDir),
    ]);
  } catch {
    return null;
  }
  if (!isInside(canonicalDir, canonicalFile)) {
    return null;
  }
  return {
    path: canonicalFile,
    mediaType: fileName.endsWith(".mp3") ? "audio/mpeg" : "audio/wav",
  };
}
