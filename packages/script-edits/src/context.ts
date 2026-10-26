import type {
  CharacterAppearance,
  CharacterName,
  CharacterVoice,
  ContentDocument,
} from "@kakeai/contracts";

/** A locale-specific display name copied from the character library. */
export type ScriptLibraryName = CharacterName;

export type ScriptAssetKind = "image" | "video" | "audio";
export type ScriptAssetStatus = "processing" | "ready" | "failed";

export interface ScriptAssetInfo {
  kind: ScriptAssetKind;
  status: ScriptAssetStatus;
  durationMs: number | null;
  hasAudio: boolean;
}

export interface ScriptAssetLookup {
  get(assetId: string): ScriptAssetInfo | null;
}

/** A locale-specific voice assignment copied from the character library. */
export type ScriptLibraryVoice = CharacterVoice;

/**
 * An appearance copied from the character library, minus the library ID that
 * the operation replaces with a new local ID. `faceSetId` stays a reference:
 * the Face Set itself is never copied into the document.
 */
export type ScriptLibraryAppearance = Omit<CharacterAppearance, "id">;

/**
 * Read-only projection of a character library entry. Callers (HTTP API, Web UI)
 * adapt their own store to this shape; the operation core never reads Prisma.
 */
export interface ScriptLibraryCharacter {
  id: string;
  name: string;
  names: ScriptLibraryName[];
  voices: ScriptLibraryVoice[];
  appearances: ScriptLibraryAppearance[];
}

export interface ScriptLibraryCharacterLookup {
  get(characterId: string): ScriptLibraryCharacter | null;
}

/** A Voice Profile projection: the operation core needs its locale only. */
export interface ScriptVoiceProfileInfo {
  id: string;
  locale: ContentDocument["locale"];
}

export interface ScriptVoiceProfileLookup {
  get(voiceProfileId: string): ScriptVoiceProfileInfo | null;
}

/**
 * Selectable Visual Theme revisions. The lookup answers only "may a new
 * Script Version select this revision?", so it excludes Theme Drafts, archived
 * Themes, and non-latest revisions. Existing Script Versions are validated by
 * the save path, not by this lookup.
 */
export interface ScriptThemeLookup {
  isSelectable(themeId: string, version: number): boolean;
}

export interface ScriptIdGenerator {
  scene(existing: ReadonlySet<string>): string;
  line(sceneId: string, existing: ReadonlySet<string>): string;
  cue(sceneId: string, suffix: string, existing: ReadonlySet<string>): string;
  audioCue(existing: ReadonlySet<string>): string;
  audioTake(lineId: string, existing: ReadonlySet<string>): string;
  character(existing: ReadonlySet<string>): string;
  appearance(existing: ReadonlySet<string>): string;
  speaker(existing: ReadonlySet<string>): string;
}

export interface ScriptContext {
  assets: ScriptAssetLookup;
  ids: ScriptIdGenerator;
  /** Optional: only operations that copy from the library require it. */
  libraryCharacters?: ScriptLibraryCharacterLookup;
  /** Optional: only operations that assign a Voice Profile require it. */
  voiceProfiles?: ScriptVoiceProfileLookup;
  /** Optional: only `document.setVisualTheme` requires it. */
  themes?: ScriptThemeLookup;
}
