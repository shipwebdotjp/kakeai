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

export interface ScriptIdGenerator {
  scene(existing: ReadonlySet<string>): string;
  line(sceneId: string, existing: ReadonlySet<string>): string;
  cue(sceneId: string, suffix: string, existing: ReadonlySet<string>): string;
  audioCue(existing: ReadonlySet<string>): string;
  audioTake(lineId: string, existing: ReadonlySet<string>): string;
}

export interface ScriptContext {
  assets: ScriptAssetLookup;
  ids: ScriptIdGenerator;
}
