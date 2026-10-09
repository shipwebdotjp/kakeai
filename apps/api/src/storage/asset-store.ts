import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { DataDirectories } from "./paths.ts";

export function assetStorageKey(sha256: string): string {
  return `assets/${sha256}`;
}

export function renditionStorageKey(sha256: string): string {
  return `assets/renditions/${sha256}`;
}

export function resolveStoragePath(directories: DataDirectories, storageKey: string): string {
  const resolved = resolve(directories.root, storageKey);
  const rootPrefix = directories.root.endsWith(sep) ? directories.root : `${directories.root}${sep}`;
  if (resolved !== directories.root && !resolved.startsWith(rootPrefix)) {
    throw new Error(`storageKey がデータルートの外を指しています: ${storageKey}`);
  }
  return resolved;
}

export interface FileDigest {
  sha256: string;
  byteSize: number;
}

export async function hashFile(filePath: string): Promise<FileDigest> {
  const hash = createHash("sha256");
  let byteSize = 0;
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => {
      hash.update(chunk);
      byteSize += chunk.length;
    });
    stream.on("error", rejectPromise);
    stream.on("end", resolvePromise);
  });
  return { sha256: hash.digest("hex"), byteSize };
}

export async function fileMatches(
  filePath: string,
  sha256: string,
  byteSize: number,
): Promise<boolean> {
  try {
    const info = await stat(filePath);
    if (!info.isFile() || info.size !== byteSize) {
      return false;
    }
    const digest = await hashFile(filePath);
    return digest.sha256 === sha256 && digest.byteSize === byteSize;
  } catch {
    return false;
  }
}

export async function commitFile(
  tempPath: string,
  storageKey: string,
  directories: DataDirectories,
): Promise<string> {
  const destination = resolveStoragePath(directories, storageKey);
  await mkdir(dirname(destination), { recursive: true });
  try {
    await rename(tempPath, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") {
      throw error;
    }
    await copyFile(tempPath, destination);
    await rm(tempPath, { force: true });
  }
  return destination;
}

export async function removeStorageFile(
  directories: DataDirectories,
  storageKey: string,
): Promise<void> {
  await rm(resolveStoragePath(directories, storageKey), { force: true });
}
