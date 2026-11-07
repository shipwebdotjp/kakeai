import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { livePackageRelativePathSchema } from "@kakeai/contracts";
import { packageError } from "./errors.ts";

export interface FileDigest {
  sha256: string;
  byteSize: number;
}

export function assertInsideRoot(rootDir: string, absolutePath: string, label: string): void {
  const root = resolve(rootDir);
  const target = resolve(absolutePath);
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (target !== root && !target.startsWith(rootPrefix)) {
    throw packageError("unsafe_path", `${label} がパッケージ外を指しています: ${absolutePath}`);
  }
}

/** Resolves a package-relative path and enforces that it stays inside the root. */
export function resolveContainedPath(rootDir: string, relativePath: string): string {
  const parsed = livePackageRelativePathSchema.safeParse(relativePath);
  if (!parsed.success) {
    throw packageError("unsafe_path", `パッケージ内のパスが不正です: ${relativePath}`);
  }
  const absolutePath = resolve(rootDir, parsed.data);
  assertInsideRoot(rootDir, absolutePath, parsed.data);
  return absolutePath;
}

/**
 * Lists every regular file in the package as POSIX-style paths. Symbolic links
 * and special files are rejected; a package is never allowed to point outside
 * its own root.
 */
export async function walkPackageFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = join(current, entry.name);
      const info = await lstat(absolutePath);
      const displayPath = relative(rootDir, absolutePath).split(sep).join("/");
      if (info.isSymbolicLink()) {
        throw packageError(
          "symlink",
          `パッケージ内にシンボリックリンクがあります: ${displayPath}`,
          displayPath,
        );
      }
      if (info.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!info.isFile()) {
        throw packageError(
          "invalid_package",
          `パッケージ内に不正なファイルがあります: ${displayPath}`,
          displayPath,
        );
      }
      files.push(displayPath);
    }
  }

  await walk(resolve(rootDir));
  return files;
}

export async function hashFile(path: string): Promise<FileDigest> {
  const hash = createHash("sha256");
  let byteSize = 0;
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk: Buffer) => {
      byteSize += chunk.byteLength;
      hash.update(chunk);
    });
    stream.on("error", rejectPromise);
    stream.on("end", () => resolvePromise());
  });
  return { sha256: hash.digest("hex"), byteSize };
}

export function extensionOf(path: string): string {
  const name = path.split("/").pop() ?? "";
  const index = name.lastIndexOf(".");
  return index <= 0 ? "" : name.slice(index + 1).toLowerCase();
}

