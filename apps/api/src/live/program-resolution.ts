import {
  voiceProfileExtrasSchemaFor,
  type LiveExportFailureStage,
  type LiveProgramDocument,
  type LiveResolutionSnapshot,
  type LiveResolutionVoice,
  type LiveSide,
  type LiveVoiceProfileSnapshot,
  type VoiceProfileExtras,
} from "@kakeai/contracts";
import { LiveExportError } from "./errors.ts";
import type {
  ResolvedAssetFile,
  ResolvedCueSeed,
  ResolvedCutIn,
  ResolvedLiveProgram,
  ResolvedSpeaker,
} from "./resolved-assets.ts";

const SIDES: readonly LiveSide[] = ["left", "right"];

function fail(
  message: string,
  id: string | null = null,
  stage: LiveExportFailureStage = "voice",
): never {
  throw new LiveExportError("LIVE_EXPORT_INPUT_INVALID", stage, message, id);
}

export interface ProgramVoices {
  profiles: Map<string, LiveVoiceProfileSnapshot>;
  bySide: Map<LiveSide, LiveResolutionVoice>;
}

/**
 * Rebuilds the voice profiles a program version froze. `refAudioAssetId` is
 * not part of the immutable voice settings, so it is restored from the
 * reference-audio Asset snapshot for the existing prepareVoices pipeline.
 */
export function buildProgramVoices(
  document: LiveProgramDocument,
  snapshot: LiveResolutionSnapshot,
): ProgramVoices {
  const profiles = new Map<string, LiveVoiceProfileSnapshot>();
  const bySide = new Map<LiveSide, LiveResolutionVoice>();
  for (const voice of snapshot.voices) {
    const settings = {
      ...(voice.settings as Record<string, unknown>),
      ...(voice.referenceAudio === null
        ? {}
        : { refAudioAssetId: voice.referenceAudio.assetId }),
    };
    let parsedSettings: VoiceProfileExtras;
    try {
      parsedSettings = voiceProfileExtrasSchemaFor(voice.adapterId).parse(settings);
    } catch {
      fail(`声プロファイルの設定が不正です: ${voice.voiceProfileId}`, voice.voiceProfileId);
    }
    profiles.set(voice.voiceProfileId, {
      id: voice.voiceProfileId,
      name: voice.voiceProfileId,
      adapterId: voice.adapterId,
      voiceId: voice.voiceId,
      locale: document.locale,
      settings: parsedSettings,
    });
    bySide.set(voice.side, voice);
  }
  return { profiles, bySide };
}

function speakerForSide(
  side: LiveSide,
  document: LiveProgramDocument,
  snapshot: LiveResolutionSnapshot,
  voices: ProgramVoices,
): ResolvedSpeaker {
  const cast = document.cast[side];
  if (cast === null) {
    fail(`キャストに ${side} がありません。`, null);
  }
  const voice = voices.bySide.get(side);
  if (voice === undefined) {
    fail(`side ${side} の声スナップショットがありません。`, cast.characterId);
  }
  if (voice.voiceProfileId !== cast.voiceProfileId) {
    fail(`side ${side} の声プロファイルが版と一致しません。`, cast.voiceProfileId);
  }
  const character = snapshot.characters.find((entry) => entry.side === side);
  if (character === undefined || character.characterId !== cast.characterId) {
    fail(`side ${side} のキャラクターが版と一致しません。`, cast.characterId);
  }
  return {
    id: cast.characterId,
    name: character.name,
    side,
    characterId: cast.characterId,
    voiceProfileId: cast.voiceProfileId,
  };
}

/**
 * Turns a Live Program Version document into the same resolved shape the v1
 * exporter already uses. Every audio reference must come from the frozen
 * resolution snapshot; there is no TTS fallback for `audioAssetId`.
 */
export function buildProgramResolution(
  document: LiveProgramDocument,
  snapshot: LiveResolutionSnapshot,
  assetById: ReadonlyMap<string, ResolvedAssetFile>,
): ResolvedLiveProgram {
  const voices = buildProgramVoices(document, snapshot);
  const speakers: ResolvedSpeaker[] = [];
  const speakerBySide = new Map<LiveSide, ResolvedSpeaker>();
  for (const side of SIDES) {
    if (document.cast[side] === null) {
      continue;
    }
    const speaker = speakerForSide(side, document, snapshot, voices);
    speakers.push(speaker);
    speakerBySide.set(side, speaker);
  }

  const audioByCueId = new Map(
    snapshot.audioAssets.map((entry) => [entry.cueId, entry.asset]),
  );
  const cues: ResolvedCueSeed[] = document.cues.map((cue) => {
    const speaker = speakerBySide.get(cue.speaker);
    if (speaker === undefined) {
      fail(`side ${cue.speaker} の話者が見つかりません。`, cue.id, "cue");
    }
    let audio: ResolvedCueSeed["audio"];
    if (cue.audioAssetId === undefined) {
      if (speaker.voiceProfileId === null) {
        fail(`話者 ${speaker.id} に声プロファイルがありません。`, cue.id);
      }
      audio = { kind: "tts", voiceProfileId: speaker.voiceProfileId };
    } else {
      const snapshotAsset = audioByCueId.get(cue.id);
      const asset = assetById.get(cue.audioAssetId);
      if (
        snapshotAsset === undefined ||
        snapshotAsset.assetId !== cue.audioAssetId ||
        snapshotAsset.kind !== "audio" ||
        asset === undefined
      ) {
        fail(
          `音声素材を版のスナップショットから解決できません: ${cue.audioAssetId}`,
          cue.id,
          "cue",
        );
      }
      audio = {
        kind: "asset",
        assetId: cue.audioAssetId,
        durationMsHint: snapshotAsset.durationMs,
      };
    }
    return {
      id: cue.id,
      origin: "live",
      ...(cue.visual === undefined ? {} : { visual: cue.visual }),
      speaker: cue.speaker,
      caption: cue.caption,
      speech: cue.speech,
      expression: cue.expression,
      audio,
    };
  });

  const cutIns: ResolvedCutIn[] = document.cutIns.map((cutIn) => {
    const snapshotCutIn = snapshot.cutIns.find((entry) => entry.cutInId === cutIn.id);
    if (
      snapshotCutIn === undefined ||
      snapshotCutIn.asset.assetId !== cutIn.assetId ||
      snapshotCutIn.asset.kind !== "video"
    ) {
      fail(`CutIn が版のスナップショットと一致しません: ${cutIn.id}`, cutIn.id, "material");
    }
    const asset = assetById.get(cutIn.assetId);
    if (asset === undefined || asset.kind !== "video") {
      fail(`CutIn の素材を利用できません: ${cutIn.assetId}`, cutIn.id, "material");
    }
    return { id: cutIn.id, assetId: cutIn.assetId };
  });

  return {
    cues,
    cutIns,
    speakers,
    sideBySpeakerId: new Map(speakers.map((speaker) => [speaker.id, speaker.side])),
    speakerBySide,
  };
}
