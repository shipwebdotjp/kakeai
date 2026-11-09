import type { LiveSide, LiveVisualRef } from "@kakeai/contracts";

/** A package-ready Asset file resolved from a Job snapshot. */
export interface ResolvedAssetFile {
  assetId: string;
  path: string;
  kind: "image" | "video" | "audio";
  mediaType: string;
  sha256: string;
  byteSize: number;
  durationMs: number | null;
  widthPx: number | null;
  heightPx: number | null;
  hasAudio: boolean;
}

export interface ResolvedCueSeed {
  id: string;
  origin: "live";
  visual?: LiveVisualRef | null;
  speaker: LiveSide;
  caption: string;
  speech: string;
  expression: string;
  audio:
    | {
        kind: "asset";
        assetId: string;
        takeId?: string;
        durationMsHint: number | null;
      }
    | {
        kind: "tts";
        voiceProfileId: string;
      };
}

export interface ResolvedSpeaker {
  id: string;
  name: string;
  side: LiveSide;
  characterId: string | null;
  voiceProfileId: string | null;
}

export interface ResolvedCutIn {
  id: string;
  assetId: string;
}

export interface ResolvedLiveProgram {
  cues: ResolvedCueSeed[];
  cutIns: ResolvedCutIn[];
  speakers: ResolvedSpeaker[];
  sideBySpeakerId: Map<string, LiveSide>;
  speakerBySide: Map<LiveSide, ResolvedSpeaker>;
}
