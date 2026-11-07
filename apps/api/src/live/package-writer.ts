import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  liveExtensionForMediaType,
  livePackageRelativePathSchema,
  type LiveFileKind,
  type LiveMediaType,
  type LivePackageFile,
  type LivePackageManifest,
} from "@kakeai/contracts";
import { hashFile } from "../storage/asset-store.ts";
import { LiveExportError } from "./errors";

export interface PackageFileMeta {
  mediaType: LiveMediaType;
  kind: LiveFileKind;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  hasAudio: boolean;
}

function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export class PackageWriter {
  private readonly files = new Map<string, LivePackageFile>();

  constructor(readonly rootDir: string) {}

  resolvePath(relativePath: string): string {
    const parsed = livePackageRelativePathSchema.safeParse(relativePath);
    if (!parsed.success) {
      throw new LiveExportError(
        "LIVE_EXPORT_FAILED",
        "output",
        `パッケージ内のパスが不正です: ${relativePath}`,
      );
    }
    const destination = resolve(this.rootDir, parsed.data);
    const rootPrefix = this.rootDir.endsWith(sep) ? this.rootDir : `${this.rootDir}${sep}`;
    if (destination !== this.rootDir && !destination.startsWith(rootPrefix)) {
      throw new LiveExportError(
        "LIVE_EXPORT_FAILED",
        "output",
        `パッケージ外のパスです: ${parsed.data}`,
      );
    }
    return destination;
  }

  private record(file: LivePackageFile): void {
    const existing = this.files.get(file.path);
    if (existing !== undefined && existing.sha256 !== file.sha256) {
      throw new LiveExportError(
        "LIVE_EXPORT_FAILED",
        "output",
        `同じパスに異なる内容を書き込もうとしました: ${file.path}`,
      );
    }
    this.files.set(file.path, file);
  }

  async writeBuffer(
    relativePath: string,
    data: Uint8Array,
    meta: PackageFileMeta,
  ): Promise<string> {
    const destination = this.resolvePath(relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await mkdir(this.rootDir, { recursive: true });
    const tempPath = join(this.rootDir, `.write-${randomUUID()}.tmp`);
    try {
      await writeFile(tempPath, data);
      const digest = await hashFile(tempPath);
      await rename(tempPath, destination);
      this.record({
        path: relativePath,
        sha256: digest.sha256,
        byteSize: digest.byteSize,
        mediaType: meta.mediaType,
        kind: meta.kind,
        durationMs: meta.durationMs ?? null,
        width: meta.width ?? null,
        height: meta.height ?? null,
        hasAudio: meta.hasAudio,
      });
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
    return relativePath;
  }

  async writeText(
    relativePath: string,
    text: string,
    meta: PackageFileMeta,
  ): Promise<string> {
    return this.writeBuffer(relativePath, Buffer.from(text, "utf8"), meta);
  }

  async writeJson(
    relativePath: string,
    value: unknown,
    meta: PackageFileMeta,
  ): Promise<string> {
    return this.writeText(relativePath, jsonText(value), meta);
  }

  async copyFile(
    sourcePath: string,
    relativePath: string,
    meta: PackageFileMeta,
  ): Promise<string> {
    const destination = this.resolvePath(relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await mkdir(this.rootDir, { recursive: true });
    const tempPath = join(this.rootDir, `.copy-${randomUUID()}.tmp`);
    try {
      await pipeline(createReadStream(sourcePath), createWriteStream(tempPath));
      const digest = await hashFile(tempPath);
      await rename(tempPath, destination);
      this.record({
      path: relativePath,
      sha256: digest.sha256,
      byteSize: digest.byteSize,
      mediaType: meta.mediaType,
      kind: meta.kind,
      durationMs: meta.durationMs ?? null,
      width: meta.width ?? null,
      height: meta.height ?? null,
        hasAudio: meta.hasAudio,
      });
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
    return relativePath;
  }

  /**
   * Copies an Asset into the content-addressed asset area. The same bytes are
   * only written once, and the returned path is independent of user IDs.
   */
  async writeAsset(
    sourcePath: string,
    meta: PackageFileMeta & { mediaType: LiveMediaType },
  ): Promise<string> {
    // Copy to a temporary file first so the destination name and the recorded
    // hash describe exactly the bytes that are committed.
    await mkdir(this.rootDir, { recursive: true });
    const tempPath = join(this.rootDir, `.asset-${randomUUID()}.tmp`);
    await copyFile(sourcePath, tempPath);
    try {
      const digest = await hashFile(tempPath);
      const relativePath = `media/assets/${digest.sha256}.${liveExtensionForMediaType(meta.mediaType)}`;
      const existing = this.files.get(relativePath);
      if (existing !== undefined) {
        if (
          existing.kind !== meta.kind ||
          existing.mediaType !== meta.mediaType ||
          existing.durationMs !== (meta.durationMs ?? null) ||
          existing.width !== (meta.width ?? null) ||
          existing.height !== (meta.height ?? null) ||
          existing.hasAudio !== meta.hasAudio
        ) {
          throw new LiveExportError(
            "LIVE_EXPORT_FAILED",
            "output",
            `同じ Asset を異なる種別で使っています: ${relativePath}`,
          );
        }
        return relativePath;
      }
      const destination = this.resolvePath(relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await rename(tempPath, destination);
      this.record({
        path: relativePath,
        sha256: digest.sha256,
        byteSize: digest.byteSize,
        mediaType: meta.mediaType,
        kind: meta.kind,
        durationMs: meta.durationMs ?? null,
        width: meta.width ?? null,
        height: meta.height ?? null,
        hasAudio: meta.hasAudio,
      });
      return relativePath;
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  fileList(): LivePackageFile[] {
    return [...this.files.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  async writeManifest(manifest: LivePackageManifest): Promise<string> {
    const destination = join(this.rootDir, "manifest.json");
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, jsonText(manifest), "utf8");
    return destination;
  }

}
