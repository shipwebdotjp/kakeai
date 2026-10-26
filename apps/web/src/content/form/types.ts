import type { VisualThemeRef } from "@kakeai/contracts";
import {
  type AudioCueRole,
  type CharacterName,
  type CharacterVoice,
  type CueLayer,
  type SceneTransitionPreset,
  type StandingSide,
  type StandingEdge,
  type StandingVertical,
  type ThemeAccentToken,
  type TransitionPreset,
  type VisualCue,
} from "@kakeai/contracts";

export interface TakeFormValue {
  id: string;
  assetId: string;
  durationMs: number;
  source: "manual" | "tts";
}

export interface LineFormValue {
  id: string;
  speakerId: string | null;
  captionText: string;
  speechText: string;
  selectedAudioTakeId: string | null;
  expressionId: string | null;
  gapBeforeMs: number;
  takes: TakeFormValue[];
}

export interface BgmFormValue {
  cueId: string | null;
  assetId: string | null;
  gainDb: number;
  loop: boolean;
}

export interface SceneAudioCueFormValue {
  cueId: string | null;
  assetId: string | null;
  role: AudioCueRole;
  gainDb: number;
  loop: boolean;
}

export interface AppearanceFormValue {
  id: string;
  assetId: string | null;
  expression: string;
  pose: string;
  label: string;
  faceSetId: string | null;
}

export interface CharacterFormValue {
  id: string;
  name: string;
  names: CharacterName[];
  voiceProfileId: string | null;
  voices: CharacterVoice[];
  appearances: AppearanceFormValue[];
}

export interface SpeakerFormValue {
  id: string;
  name: string;
  characterId: string | null;
  voiceProfileId: string | null;
}

export type {
  StandingSide,
  StandingEdge,
  StandingVertical,
} from "@kakeai/contracts";
export {
  DEFAULT_STANDING_EDGE,
  DEFAULT_STANDING_VERTICAL,
} from "@kakeai/contracts";
export type CueRangeKind = "scene" | "lines" | "offset";

export interface StandingFormValue {
  cueId: string | null;
  characterId: string | null;
  appearanceId: string | null;
  side: StandingSide;
  scale: number;
  edge: StandingEdge;
  vertical: StandingVertical;
  enterPreset: TransitionPreset;
  enterDurationMs: number;
  exitPreset: TransitionPreset;
  exitDurationMs: number;
}

export interface CueFormValue {
  id: string;
  baseCue: VisualCue | null;
  templateId: string;
  templateVersion: number;
  layer: CueLayer;
  order: number;
  rangeKind: CueRangeKind;
  startLineId: string;
  endLineId: string;
  startMs: number;
  endMs: number;
  enterPreset: TransitionPreset;
  enterDurationMs: number;
  exitPreset: TransitionPreset;
  exitDurationMs: number;
  fields: Record<string, string>;
}

export type SceneAccentKind = "theme" | "custom";

export interface SceneFormValue {
  id: string;
  kind: "intro" | "point" | "outro" | "insert";
  label: string;
  accentKind: SceneAccentKind;
  accentToken: ThemeAccentToken;
  accentColor: string;
  timingMode: "auto" | "fixed";
  durationMs: number;
  transitionPreset: SceneTransitionPreset;
  transitionDurationMs: number;
  lines: LineFormValue[];
  cues: CueFormValue[];
  standings: StandingFormValue[];
  audioCues: SceneAudioCueFormValue[];
  mainVisualCueId: string;
  embeddedAudio: boolean;
  embeddedAudioGainDb: number;
}

export interface DocumentFormValues {
  visualTheme: VisualThemeRef;
  caption: { showSpeakerName: boolean };
  scenes: SceneFormValue[];
  bgm: BgmFormValue;
  characters: CharacterFormValue[];
  speakers: SpeakerFormValue[];
}

export interface StandingCueInput {
  characterId: string;
  appearanceId: string;
  side: StandingSide;
  scale: number;
  edge: StandingEdge;
  vertical: StandingVertical;
}
