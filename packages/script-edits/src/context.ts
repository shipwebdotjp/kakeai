import type { CharacterAppearance, CharacterVoice } from "@kakeai/contracts";

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
  voices: ScriptLibraryVoice[];
  appearances: ScriptLibraryAppearance[];
}

export interface ScriptLibraryCharacterLookup {
  get(characterId: string): ScriptLibraryCharacter | null;
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
}
