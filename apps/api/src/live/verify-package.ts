import { readFile, readdir, lstat, open, stat } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";
import {
  liveCharacterSheetSchema,
  liveExtensionForMediaType,
  livePackageManifestSchema,
  livePackageShowSchema,
  type LiveMediaType,
  type LivePackageFile,
  type LivePackageManifest,
  type LivePackageShow,
} from "@kakeai/contracts";
import { assertStaticHtml } from "@kakeai/video";
import { hashFile } from "../storage/asset-store.ts";
import { probeMedia } from "../media/probe.ts";
import { canonicalJson } from "./canonical-json.ts";
import { LiveExportError } from "./errors";

export interface VerifiedPackage {
  fileCount: number;
  show: LivePackageShow;
}

async function walkFiles(rootDir: string, current = rootDir): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      throw new LiveExportError(
        "LIVE_EXPORT_FAILED",
        "manifest",
        `パッケージ内にシンボリックリンクがあります: ${relative(rootDir, path)}`,
      );
    }
    if (info.isDirectory()) {
      files.push(...(await walkFiles(rootDir, path)));
    } else if (info.isFile()) {
      files.push(relative(rootDir, path).split(sep).join("/"));
    } else {
      throw new LiveExportError(
        "LIVE_EXPORT_FAILED",
        "manifest",
        `パッケージ内に不正なファイルがあります: ${relative(rootDir, path)}`,
      );
    }
  }
  return files;
}

function fail(message: string): never {
  throw new LiveExportError("LIVE_EXPORT_FAILED", "manifest", message);
}

function expectedExtensions(mediaType: LiveMediaType): string[] {
  if (mediaType === "image/jpeg") {
    return ["jpg", "jpeg"];
  }
  return [liveExtensionForMediaType(mediaType)];
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (
    buffer.length < 24 ||
    !buffer.subarray(0, 8).equals(PNG_SIGNATURE) ||
    buffer.toString("ascii", 12, 16) !== "IHDR"
  ) {
    return null;
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function readPngHeader(path: string): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(24);
    await handle.read(header, 0, header.length, 0);
    return header;
  } finally {
    await handle.close();
  }
}

function referencedUrls(attribute: string, value: string): string[] {
  if (attribute.toLowerCase() !== "srcset") {
    return [value];
  }
  return value
    .split(",")
    .map((entry) => entry.trim().split(/\s+/)[0] ?? "")
    .filter((entry) => entry.length > 0);
}

const URL_ATTRIBUTE =
  /(src|href|srcset|poster|data|action|formaction|xlink:href)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;

function checkHtmlReference(
  url: string,
  filePath: string,
  expected: Map<string, LivePackageManifest["files"][number]>,
): void {
  const lower = url.toLowerCase();
  if (lower.startsWith("data:")) {
    if (!lower.startsWith("data:image/") || lower.includes("svg+xml")) {
      fail(`素材 HTML に許可されていない data URL があります: ${url}`);
    }
    return;
  }
  if (lower.startsWith("http:") || lower.startsWith("https:") || url.startsWith("#")) {
    return;
  }
  if (/^[a-z][a-z0-9+.-]*:/.test(lower)) {
    fail(`素材 HTML に許可されていない URL スキームがあります: ${url}`);
  }
  if (url.startsWith("/")) {
    fail(`素材 HTML に絶対 URL があります: ${url}`);
  }
  const referenced = posix.normalize(posix.join(posix.dirname(filePath), url));
  if (!expected.has(referenced)) {
    fail(`素材 HTML が参照するファイルがありません: ${referenced}`);
  }
}

/**
 * Cross-checks the CutIns declared by show.json against their manifest
 * entries. The packaged MP4 is probed separately; this catches a show/manifest
 * disagreement before the (more expensive) probe runs.
 */
export function verifyShowCutIns(
  show: LivePackageShow,
  files: ReadonlyMap<string, LivePackageFile>,
): void {
  for (const cutIn of show.cutIns) {
    const entry = files.get(cutIn.file);
    if (entry === undefined) {
      fail(`CutIn が参照するファイルが manifest にありません: ${cutIn.file}`);
    }
    if (entry.kind !== "cut-in") {
      fail(`CutIn の manifest kind が cut-in ではありません: ${cutIn.file}`);
    }
    if (entry.mediaType !== "video/mp4") {
      fail(`CutIn の mediaType が video/mp4 ではありません: ${cutIn.file}`);
    }
    if (entry.durationMs !== cutIn.durationMs) {
      fail(
        `CutIn の尺が manifest と一致しません: ${cutIn.file} (${entry.durationMs} != ${cutIn.durationMs})`,
      );
    }
    if (entry.hasAudio !== cutIn.hasAudio) {
      fail(`CutIn の音声情報が manifest と一致しません: ${cutIn.file}`);
    }
    if (entry.width !== cutIn.width || entry.height !== cutIn.height) {
      fail(`CutIn の寸法が manifest と一致しません: ${cutIn.file}`);
    }
  }
}

export async function verifyPackage(
  rootDir: string,
  inputManifest: LivePackageManifest,
): Promise<VerifiedPackage> {
  let manifest: LivePackageManifest;
  try {
    manifest = livePackageManifestSchema.parse(inputManifest);
    const onDisk = livePackageManifestSchema.parse(
      JSON.parse(await readFile(join(rootDir, "manifest.json"), "utf8")),
    );
    if (canonicalJson(onDisk) !== canonicalJson(manifest)) {
      fail("manifest.json が検証対象と一致しません。");
    }
  } catch (error) {
    if (error instanceof LiveExportError) {
      throw error;
    }
    fail(`manifest.json が不正です: ${error instanceof Error ? error.message : String(error)}`);
  }

  const actualFiles = new Set(await walkFiles(rootDir));
  actualFiles.delete("manifest.json");
  const expected = new Map<string, LivePackageManifest["files"][number]>();
  for (const file of manifest.files) {
    if (expected.has(file.path)) {
      fail(`manifest のファイルが重複しています: ${file.path}`);
    }
    expected.set(file.path, file);
  }
  for (const path of expected.keys()) {
    if (!actualFiles.has(path)) {
      fail(`manifest にあるファイルがありません: ${path}`);
    }
  }
  for (const path of actualFiles) {
    if (!expected.has(path)) {
      fail(`manifest にないファイルがあります: ${path}`);
    }
  }

  let show: LivePackageShow;
  try {
    show = livePackageShowSchema.parse(
      JSON.parse(await readFile(join(rootDir, "show.json"), "utf8")),
    );
    const characters = liveCharacterSheetSchema.parse(
      JSON.parse(await readFile(join(rootDir, "characters.json"), "utf8")),
    );
    const showFilePaths = new Set([
      ...show.cues.map((cue) => cue.audio),
      ...show.materials.map((material) => material.file),
      ...show.cutIns.map((cutIn) => cutIn.file),
      ...show.speakers.flatMap((speaker) =>
        speaker.voice.refAudio === undefined ? [] : [speaker.voice.refAudio],
      ),
      ...characters.characters.flatMap((character) =>
        character.appearances.map((appearance) => appearance.image),
      ),
      ...characters.faceSets.flatMap((faceSet) =>
        faceSet.layers.flatMap((layer) => [
          layer.file,
          ...(layer.blinkFile === undefined ? [] : [layer.blinkFile]),
          ...(layer.speakingFile === undefined ? [] : [layer.speakingFile]),
        ]),
      ),
    ]);
    for (const path of showFilePaths) {
      if (!expected.has(path)) {
        fail(`show.json / characters.json が参照するファイルがありません: ${path}`);
      }
    }
    verifyShowCutIns(show, expected);
  } catch (error) {
    if (error instanceof LiveExportError) {
      throw error;
    }
    fail(`show.json または characters.json が不正です: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const file of manifest.files) {
    const path = join(rootDir, file.path);
    const info = await stat(path);
    if (info.size !== file.byteSize) {
      fail(`ファイルのサイズが一致しません: ${file.path}`);
    }
    const digest = await hashFile(path);
    if (digest.sha256 !== file.sha256 || digest.byteSize !== file.byteSize) {
      fail(`ファイルのハッシュまたはサイズが一致しません: ${file.path}`);
    }
    const extension = (file.path.split(".").pop() ?? "").toLowerCase();
    if (!expectedExtensions(file.mediaType).includes(extension)) {
      fail(`mediaType と拡張子が一致しません: ${file.path}`);
    }
    if (file.mediaType === "video/mp4") {
      const probe = await probeMedia(path, "video", "video/mp4");
      if (file.kind === "cut-in") {
        if (probe.durationMs === null || probe.durationMs <= 0) {
          fail(`CutIn の尺を取得できません: ${file.path}`);
        }
        if (file.durationMs === null || file.durationMs <= 0) {
          fail(`CutIn の尺が manifest にありません: ${file.path}`);
        }
        if (file.durationMs !== probe.durationMs) {
          fail(
            `CutIn の尺が manifest と一致しません: ${file.path} (${file.durationMs} != ${probe.durationMs})`,
          );
        }
        if (file.hasAudio !== (probe.audioCodec !== null)) {
          fail(`CutIn の音声情報が manifest と一致しません: ${file.path}`);
        }
        if (file.width !== probe.widthPx || file.height !== probe.heightPx) {
          fail(`CutIn の寸法が manifest と一致しません: ${file.path}`);
        }
      } else {
        if (probe.audioCodec !== null) {
          fail(`動画カードに音声が含まれています: ${file.path}`);
        }
        if (file.width !== probe.widthPx || file.height !== probe.heightPx) {
          fail(`動画カードの寸法が manifest と一致しません: ${file.path}`);
        }
      }
    } else if (file.mediaType === "image/png") {
      const dimensions = pngDimensions(await readPngHeader(path));
      if (
        dimensions === null ||
        file.width !== dimensions.width ||
        file.height !== dimensions.height
      ) {
        fail(`画像カードの寸法が manifest と一致しません: ${file.path}`);
      }
    } else if (file.mediaType === "text/html") {
      const html = await readFile(path, "utf8");
      try {
        assertStaticHtml(html, file.path);
      } catch (error) {
        fail(
          `素材 HTML が安全ではありません: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      for (const match of html.matchAll(URL_ATTRIBUTE)) {
        const attribute = match[1] ?? "";
        const value = match[2] ?? match[3] ?? match[4] ?? "";
        for (const url of referencedUrls(attribute, value)) {
          checkHtmlReference(url, file.path, expected);
        }
      }
      for (const match of html.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) {
        checkHtmlReference(match[2]!, file.path, expected);
      }
      for (const match of html.matchAll(/@import\s+(?:url\()?['"]?([^'")\s;]+)/gi)) {
        checkHtmlReference(match[1]!, file.path, expected);
      }
    } else if (file.mediaType === "audio/wav" || file.mediaType === "audio/mpeg") {
      const probe = await probeMedia(path, "audio", file.mediaType);
      if (probe.durationMs === null || probe.durationMs <= 0) {
        fail(`音声の尺を取得できません: ${file.path}`);
      }
    }
  }

  return { fileCount: manifest.files.length, show };
}
