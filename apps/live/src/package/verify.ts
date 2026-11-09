import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  liveCharacterSheetSchema,
  liveExtensionForMediaType,
  livePackageManifestSchema,
  livePackageShowSchema,
  type LiveCharacterSheet,
  type LiveMediaType,
  type LivePackageFile,
  type LivePackageManifest,
  type LivePackageShow,
} from "@kakeai/contracts";
import { packageError } from "./errors.ts";
import {
  extensionOf,
  hashFile,
  resolveContainedPath,
  type FileDigest,
} from "./paths.ts";

const IMAGE_MEDIA_TYPES = new Set<LiveMediaType>(["image/png", "image/jpeg", "image/webp"]);
const AUDIO_MEDIA_TYPES = new Set<LiveMediaType>(["audio/wav", "audio/mpeg"]);

export async function readJsonFile(path: string, label: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw packageError("missing_file", `${label} がありません: ${path}`, label);
    }
    throw error;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw packageError(
      "invalid_json",
      `${label} を JSON として読めません: ${error instanceof Error ? error.message : String(error)}`,
      label,
    );
  }
}

export async function readManifest(rootDir: string): Promise<LivePackageManifest> {
  const value = await readJsonFile(join(rootDir, "manifest.json"), "manifest.json");
  try {
    return livePackageManifestSchema.parse(value);
  } catch (error) {
    throw packageError(
      "invalid_manifest",
      `manifest.json が不正です: ${error instanceof Error ? error.message : String(error)}`,
      "manifest.json",
    );
  }
}

export async function readShow(rootDir: string): Promise<LivePackageShow> {
  const value = await readJsonFile(join(rootDir, "show.json"), "show.json");
  try {
    return livePackageShowSchema.parse(value);
  } catch (error) {
    throw packageError(
      "invalid_package",
      `show.json が不正です: ${error instanceof Error ? error.message : String(error)}`,
      "show.json",
    );
  }
}

export async function readCharacters(rootDir: string): Promise<LiveCharacterSheet> {
  const value = await readJsonFile(join(rootDir, "characters.json"), "characters.json");
  try {
    return liveCharacterSheetSchema.parse(value);
  } catch (error) {
    throw packageError(
      "invalid_package",
      `characters.json が不正です: ${error instanceof Error ? error.message : String(error)}`,
      "characters.json",
    );
  }
}

export function expectedExtensions(mediaType: LiveMediaType): string[] {
  if (mediaType === "image/jpeg") {
    return ["jpg", "jpeg"];
  }
  return [liveExtensionForMediaType(mediaType)];
}

export function manifestFileMap(manifest: LivePackageManifest): Map<string, LivePackageFile> {
  return new Map(manifest.files.map((file) => [file.path, file]));
}

export function verifyFileSet(
  actualFiles: readonly string[],
  manifest: LivePackageManifest,
): void {
  const expected = manifestFileMap(manifest);
  const actual = new Set(actualFiles);
  actual.delete("manifest.json");
  for (const path of expected.keys()) {
    if (!actual.has(path)) {
      throw packageError("missing_file", `manifest にあるファイルがありません: ${path}`, path);
    }
  }
  for (const path of actual) {
    if (!expected.has(path)) {
      throw packageError("extra_file", `manifest にないファイルがあります: ${path}`, path);
    }
  }
}

export async function verifyFileIntegrity(
  rootDir: string,
  manifest: LivePackageManifest,
): Promise<Map<string, FileDigest>> {
  const digests = new Map<string, FileDigest>();
  for (const file of manifest.files) {
    const absolutePath = resolveContainedPath(rootDir, file.path);
    const digest = await hashFile(absolutePath);
    if (digest.byteSize !== file.byteSize) {
      throw packageError(
        "size_mismatch",
        `ファイルのサイズが一致しません: ${file.path} (${digest.byteSize} != ${file.byteSize})`,
        file.path,
      );
    }
    if (digest.sha256 !== file.sha256) {
      throw packageError("hash_mismatch", `ファイルのハッシュが一致しません: ${file.path}`, file.path);
    }
    const extensions = expectedExtensions(file.mediaType);
    if (!extensions.includes(extensionOf(file.path))) {
      throw packageError(
        "media_type_mismatch",
        `mediaType と拡張子が一致しません: ${file.path} (${file.mediaType})`,
        file.path,
      );
    }
    digests.set(file.path, digest);
  }
  return digests;
}

function verifyKindMediaType(file: LivePackageFile): void {
  const fail = (expected: string): never => {
    throw packageError(
      "media_type_mismatch",
      `${file.path} の kind と mediaType が一致しません: kind=${file.kind} mediaType=${file.mediaType} (${expected})`,
      file.path,
    );
  };
  switch (file.kind) {
    case "theme":
      if (file.mediaType !== "text/css") fail("text/css");
      break;
    case "show":
    case "characters":
    case "fixture":
      if (file.mediaType !== "application/json") fail("application/json");
      break;
    case "asset":
    case "card-asset":
      if (!IMAGE_MEDIA_TYPES.has(file.mediaType)) fail("image/*");
      break;
    case "voice-ref":
    case "prepared-audio":
      if (!AUDIO_MEDIA_TYPES.has(file.mediaType)) fail("audio/*");
      break;
    case "material":
      if (
        !IMAGE_MEDIA_TYPES.has(file.mediaType) &&
        file.mediaType !== "video/mp4" &&
        file.mediaType !== "text/html"
      ) {
        fail("image/*, video/mp4 or text/html");
      }
      break;
    case "cut-in":
      if (file.mediaType !== "video/mp4") fail("video/mp4");
      break;
    default: {
      const exhaustive: never = file.kind;
      throw new Error(`Unsupported live file kind: ${String(exhaustive)}`);
    }
  }
}

function requireEntry(
  files: Map<string, LivePackageFile>,
  path: string,
  label: string,
): LivePackageFile {
  const entry = files.get(path);
  if (entry === undefined) {
    throw packageError(
      "reference_missing",
      `${label} が参照するファイルが manifest にありません: ${path}`,
      path,
    );
  }
  return entry;
}

function requireKind(
  entry: LivePackageFile,
  kinds: readonly LivePackageFile["kind"][],
  label: string,
): void {
  if (!kinds.includes(entry.kind)) {
    throw packageError(
      "media_type_mismatch",
      `${label} の kind が想定と異なります: ${entry.path} (${entry.kind})`,
      entry.path,
    );
  }
}

function requireMedia(
  entry: LivePackageFile,
  mediaTypes: ReadonlySet<LiveMediaType>,
  label: string,
): void {
  if (!mediaTypes.has(entry.mediaType)) {
    throw packageError(
      "media_type_mismatch",
      `${label} の mediaType が想定と異なります: ${entry.path} (${entry.mediaType})`,
      entry.path,
    );
  }
}

function verifyMaterialCards(show: LivePackageShow, files: Map<string, LivePackageFile>): void {
  for (const card of show.materials) {
    const entry = requireEntry(files, card.file, `素材 ${card.id}`);
    requireKind(entry, ["material"], `素材 ${card.id}`);
    if (card.hasAudio || entry.hasAudio) {
      throw packageError(
        "material_audio",
        `素材カードに音声が含まれています: ${card.file}`,
        card.file,
      );
    }
    switch (card.kind) {
      case "image":
        requireMedia(entry, IMAGE_MEDIA_TYPES, `画像素材 ${card.id}`);
        break;
      case "video":
        requireMedia(entry, new Set<LiveMediaType>(["video/mp4"]), `動画素材 ${card.id}`);
        if (entry.durationMs === null || entry.durationMs <= 0) {
          throw packageError(
            "media_type_mismatch",
            `動画素材の尺が manifest にありません: ${card.file}`,
            card.file,
          );
        }
        break;
      case "html":
        requireMedia(entry, new Set<LiveMediaType>(["text/html"]), `HTML 素材 ${card.id}`);
        break;
      default: {
        const exhaustive: never = card.kind;
        throw new Error(`Unsupported material kind: ${String(exhaustive)}`);
      }
    }
  }
}

function verifyCardAssets(show: LivePackageShow, files: Map<string, LivePackageFile>): void {
  for (const asset of show.cardAssets) {
    const entry = requireEntry(files, asset.file, `カード画像 ${asset.id}`);
    requireKind(entry, ["card-asset"], `カード画像 ${asset.id}`);
    requireMedia(entry, IMAGE_MEDIA_TYPES, `カード画像 ${asset.id}`);
    if (entry.mediaType !== asset.mediaType) {
      throw packageError(
        "media_type_mismatch",
        `カード画像の mediaType が show.json と一致しません: ${asset.file}`,
        asset.file,
      );
    }
    if (entry.width !== asset.width || entry.height !== asset.height) {
      throw packageError(
        "media_type_mismatch",
        `カード画像の寸法が show.json と一致しません: ${asset.file}`,
        asset.file,
      );
    }
    if (entry.hasAudio) {
      throw packageError(
        "media_type_mismatch",
        `カード画像に音声が含まれています: ${asset.file}`,
        asset.file,
      );
    }
  }
}

function verifyCutIns(show: LivePackageShow, files: Map<string, LivePackageFile>): void {
  const cutInIds = new Set(show.cutIns.map((cutIn) => cutIn.id));
  for (const [index, segment] of show.segments.entries()) {
    if (segment.kind === "cut_in" && !cutInIds.has(segment.cutInId)) {
      // The show schema already rejects this; keep a defensive check so a
      // hand-built object cannot reach the runtime.
      throw packageError(
        "reference_missing",
        `CutIn が見つかりません: ${segment.cutInId}`,
        `segments.${index}.cutInId`,
      );
    }
  }
  for (const cutIn of show.cutIns) {
    const entry = requireEntry(files, cutIn.file, `CutIn ${cutIn.id}`);
    requireKind(entry, ["cut-in"], `CutIn ${cutIn.id}`);
    requireMedia(entry, new Set<LiveMediaType>(["video/mp4"]), `CutIn ${cutIn.id}`);
    if (entry.durationMs === null || entry.durationMs <= 0) {
      throw packageError(
        "media_type_mismatch",
        `CutIn の尺が manifest にありません: ${cutIn.file}`,
        cutIn.file,
      );
    }
    if (entry.durationMs !== cutIn.durationMs) {
      throw packageError(
        "media_type_mismatch",
        `CutIn の尺が manifest と一致しません: ${cutIn.file} (${entry.durationMs} != ${cutIn.durationMs})`,
        cutIn.file,
      );
    }
    if (entry.hasAudio !== cutIn.hasAudio) {
      throw packageError(
        "media_type_mismatch",
        `CutIn の音声情報が manifest と一致しません: ${cutIn.file}`,
        cutIn.file,
      );
    }
    if (entry.width !== cutIn.width || entry.height !== cutIn.height) {
      throw packageError(
        "media_type_mismatch",
        `CutIn の寸法が manifest と一致しません: ${cutIn.file}`,
        cutIn.file,
      );
    }
  }
}

function verifyReferences(show: LivePackageShow, characters: LiveCharacterSheet, files: Map<string, LivePackageFile>): void {
  const theme = requireEntry(files, show.show.theme, "theme");
  requireKind(theme, ["theme"], "theme");
  requireMedia(theme, new Set<LiveMediaType>(["text/css"]), "theme");

  const showFile = requireEntry(files, "show.json", "show.json");
  requireKind(showFile, ["show"], "show.json");
  const charactersFile = requireEntry(files, "characters.json", "characters.json");
  requireKind(charactersFile, ["characters"], "characters.json");

  for (const cue of show.cues) {
    const entry = requireEntry(files, cue.audio, `キュー ${cue.id}`);
    requireKind(entry, ["prepared-audio"], `キュー ${cue.id}`);
    requireMedia(entry, AUDIO_MEDIA_TYPES, `キュー ${cue.id}`);
  }

  for (const speaker of show.speakers) {
    if (speaker.voice.refAudio === undefined) {
      continue;
    }
    const entry = requireEntry(files, speaker.voice.refAudio, `話者 ${speaker.id}`);
    requireKind(entry, ["voice-ref"], `話者 ${speaker.id}`);
    requireMedia(entry, AUDIO_MEDIA_TYPES, `話者 ${speaker.id}`);
  }

  for (const character of characters.characters) {
    for (const appearance of character.appearances) {
      const entry = requireEntry(files, appearance.image, `キャラクター ${character.id}`);
      requireKind(entry, ["asset"], `キャラクター ${character.id}`);
      requireMedia(entry, IMAGE_MEDIA_TYPES, `キャラクター ${character.id}`);
    }
    if (character.voice.refAudio !== undefined) {
      const entry = requireEntry(files, character.voice.refAudio, `キャラクター ${character.id}`);
      requireKind(entry, ["voice-ref"], `キャラクター ${character.id}`);
      requireMedia(entry, AUDIO_MEDIA_TYPES, `キャラクター ${character.id}`);
    }
  }

  for (const faceSet of characters.faceSets) {
    for (const layer of faceSet.layers) {
      const paths = [
        layer.file,
        ...(layer.blinkFile === undefined ? [] : [layer.blinkFile]),
        ...(layer.speakingFile === undefined ? [] : [layer.speakingFile]),
      ];
      for (const path of paths) {
        const entry = requireEntry(files, path, `顔レイヤー ${layer.id}`);
        requireKind(entry, ["asset"], `顔レイヤー ${layer.id}`);
        requireMedia(entry, IMAGE_MEDIA_TYPES, `顔レイヤー ${layer.id}`);
      }
    }
  }

  if (show.test !== undefined) {
    const entry = requireEntry(files, show.test.fixture, "fixture");
    requireKind(entry, ["fixture"], "fixture");
    requireMedia(entry, new Set<LiveMediaType>(["application/json"]), "fixture");
  }
}

export function verifyManifestVoices(
  manifest: LivePackageManifest,
  digests: Map<string, FileDigest>,
  files: Map<string, LivePackageFile>,
): void {
  for (const voice of manifest.voices) {
    if (voice.refAudio === null || voice.refAudioSha256 === null) {
      continue;
    }
    const entry = requireEntry(files, voice.refAudio, `参照音声 ${voice.speakerId}`);
    requireKind(entry, ["voice-ref"], `参照音声 ${voice.speakerId}`);
    requireMedia(entry, AUDIO_MEDIA_TYPES, `参照音声 ${voice.speakerId}`);
    const digest = digests.get(voice.refAudio);
    if (digest === undefined || digest.sha256 !== voice.refAudioSha256) {
      throw packageError(
        "hash_mismatch",
        `参照音声のハッシュが manifest と一致しません: ${voice.refAudio}`,
        voice.refAudio,
      );
    }
  }
}

export function verifyManifestKinds(manifest: LivePackageManifest): void {
  for (const file of manifest.files) {
    verifyKindMediaType(file);
  }
}

export function verifyPackageContent(
  manifest: LivePackageManifest,
  show: LivePackageShow,
  characters: LiveCharacterSheet,
  digests: Map<string, FileDigest>,
): string[] {
  const files = manifestFileMap(manifest);
  verifyCardAssets(show, files);
  verifyMaterialCards(show, files);
  verifyCutIns(show, files);
  verifyReferences(show, characters, files);
  verifyManifestVoices(manifest, digests, files);

  const warnings: string[] = [];
  for (const font of manifest.fonts) {
    if (!font.found && font.required) {
      throw packageError(
        "required_font_missing",
        `必須フォントが見つかりません: ${font.family} (${font.role})`,
      );
    }
    if (!font.found) {
      warnings.push(
        `フォントが見つかりません: ${font.family} (${font.role})。fallback を使用します: ${font.fallback}`,
      );
    }
  }
  return warnings;
}

