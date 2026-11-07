import {
  voiceProfileExtrasSchemaFor,
  type ContentDocument,
  type LiveCueInput,
  type LiveScriptCueInput,
  type LiveShowProfile,
  type LiveSide,
  type LiveVoiceProfileSnapshot,
  type NarrationSegment,
  type Scene,
} from "@kakeai/contracts";
import { LiveExportError } from "./errors";

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
  origin: "script" | "live";
  sourceLineId?: string;
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

export interface ResolvedLiveProfile {
  cues: ResolvedCueSeed[];
  speakers: ResolvedSpeaker[];
  sideBySpeakerId: Map<string, LiveSide>;
  speakerBySide: Map<LiveSide, ResolvedSpeaker>;
}

interface FoundLine {
  scene: Scene;
  line: NarrationSegment;
}

function fail(message: string, id: string | null = null): never {
  throw new LiveExportError("LIVE_EXPORT_INPUT_INVALID", "input", message, id);
}

function findLine(content: ContentDocument, lineId: string): FoundLine {
  let found: FoundLine | undefined;
  for (const scene of content.scenes) {
    for (const line of scene.lines) {
      if (line.id !== lineId) {
        continue;
      }
      if (found !== undefined) {
        fail(`lineId が複数見つかりました: ${lineId}`, lineId);
      }
      found = { scene, line };
    }
  }
  if (found === undefined) {
    fail(`lineId が見つかりません: ${lineId}`, lineId);
  }
  return found;
}

function sideForSpeaker(
  speaker: { id: string; characterId: string | null },
  profile: LiveShowProfile,
  explicitSides: Map<string, LiveSide>,
): LiveSide | undefined {
  const explicit = explicitSides.get(speaker.id);
  if (explicit !== undefined) {
    const expected = profile.show.characters[explicit];
    if (expected === null) {
      return undefined;
    }
    if (speaker.characterId !== null && speaker.characterId !== expected) {
      return undefined;
    }
    return explicit;
  }
  if (speaker.characterId !== null && speaker.characterId === profile.show.characters.left) {
    return "left";
  }
  if (
    profile.show.characters.right !== null &&
    speaker.characterId === profile.show.characters.right
  ) {
    return "right";
  }
  return undefined;
}

function resolveSideForSpeaker(
  speaker: { id: string; characterId: string | null },
  profile: LiveShowProfile,
  explicitSides: Map<string, LiveSide>,
): LiveSide {
  const side = sideForSpeaker(speaker, profile, explicitSides);
  if (side === undefined) {
    fail(
      `話者 ${speaker.id} の左右を解決できません。show.speakerSides を指定してください。`,
      speaker.id,
    );
  }
  return side;
}

function requireVoiceProfile(
  speaker: ResolvedSpeaker,
  voiceProfileById: Map<string, LiveVoiceProfileSnapshot>,
): string {
  if (speaker.voiceProfileId === null) {
    fail(`話者 ${speaker.id} に声プロファイルがありません。`, speaker.id);
  }
  const profile = voiceProfileById.get(speaker.voiceProfileId);
  if (profile === undefined) {
    fail(`声プロファイルが見つかりません: ${speaker.voiceProfileId}`, speaker.voiceProfileId);
  }
  try {
    voiceProfileExtrasSchemaFor(profile.adapterId).parse(profile.settings);
  } catch {
    fail(`声プロファイルの設定が不正です: ${profile.id}`, profile.id);
  }
  return speaker.voiceProfileId;
}

function findSpeakerBySide(
  content: ContentDocument,
  profile: LiveShowProfile,
  speakerIdBySide: Map<LiveSide, string>,
  explicitSides: Map<string, LiveSide>,
  side: LiveSide,
): ResolvedSpeaker {
  const existing = speakerIdBySide.get(side);
  if (existing !== undefined) {
    const speaker = content.speakers.find((entry) => entry.id === existing);
    if (speaker === undefined) {
      fail(`話者が見つかりません: ${existing}`, existing);
    }
    return {
      id: speaker.id,
      name: speaker.name,
      side,
      characterId: speaker.characterId,
      voiceProfileId: speaker.voiceProfileId,
    };
  }
  const candidates = content.speakers.filter(
    (speaker) => sideForSpeaker(speaker, profile, explicitSides) === side,
  );
  if (candidates.length === 0) {
    fail(`side ${side} の話者が見つかりません。`, null);
  }
  if (candidates.length > 1) {
    fail(`side ${side} に複数の話者があります。v1では左右1話者ずつにしてください。`, null);
  }
  const speaker = candidates[0]!;
  speakerIdBySide.set(side, speaker.id);
  return {
    id: speaker.id,
    name: speaker.name,
    side,
    characterId: speaker.characterId,
    voiceProfileId: speaker.voiceProfileId,
  };
}

/**
 * Resolves every Show Profile reference against the frozen ScriptVersion.
 * This function is used both when the Job is created (so invalid input fails
 * synchronously) and by the worker (so it never re-reads mutable content).
 */
export function resolveLiveProfile(
  content: ContentDocument,
  profile: LiveShowProfile,
  assetById: Map<string, ResolvedAssetFile>,
  voiceProfileById: Map<string, LiveVoiceProfileSnapshot>,
): ResolvedLiveProfile {
  const explicitSides = new Map<string, LiveSide>(
    Object.entries(profile.show.speakerSides ?? {}),
  );
  for (const speakerId of explicitSides.keys()) {
    if (!content.speakers.some((speaker) => speaker.id === speakerId)) {
      fail(`show.speakerSides の話者が見つかりません: ${speakerId}`, speakerId);
    }
  }

  const speakerIdBySide = new Map<LiveSide, string>();
  const speakerBySide = new Map<LiveSide, ResolvedSpeaker>();
  const cues: ResolvedCueSeed[] = [];

  for (const cue of profile.scriptCues) {
    const { line } = findLine(content, cue.lineId);
    if (line.speakerId === null) {
      fail(`lineId ${cue.lineId} に話者が設定されていません。`, cue.lineId);
    }
    const speaker = content.speakers.find((entry) => entry.id === line.speakerId);
    if (speaker === undefined) {
      fail(`lineId ${cue.lineId} の話者が見つかりません。`, cue.lineId);
    }
    const side = resolveSideForSpeaker(speaker, profile, explicitSides);
    const previous = speakerIdBySide.get(side);
    if (previous !== undefined && previous !== speaker.id) {
      fail(
        `side ${side} に複数の話者があります: ${previous} / ${speaker.id}`,
        cue.lineId,
      );
    }
    speakerIdBySide.set(side, speaker.id);
    const resolvedSpeaker: ResolvedSpeaker = {
      id: speaker.id,
      name: speaker.name,
      side,
      characterId: speaker.characterId,
      voiceProfileId: speaker.voiceProfileId,
    };
    speakerBySide.set(side, resolvedSpeaker);

    if (line.captionText.trim().length === 0 || line.speechText.trim().length === 0) {
      fail(`lineId ${cue.lineId} の字幕または読み上げが空です。`, cue.lineId);
    }
    const expression = cue.expressionId ?? line.expressionId ?? "normal";
    let audio: ResolvedCueSeed["audio"];
    if (line.selectedAudioTakeId !== null) {
      const take = content.audioTakes.find((entry) => entry.id === line.selectedAudioTakeId);
      if (take === undefined) {
        fail(
          `lineId ${cue.lineId} の Audio Take が見つかりません: ${line.selectedAudioTakeId}`,
          line.selectedAudioTakeId,
        );
      }
      const asset = assetById.get(take.assetId);
      if (asset === undefined) {
        fail(`Audio Take の素材が見つかりません: ${take.assetId}`, take.assetId);
      }
      if (asset.kind !== "audio") {
        fail(`Audio Take の素材が音声ではありません: ${take.assetId}`, take.assetId);
      }
      audio = {
        kind: "asset",
        assetId: take.assetId,
        takeId: take.id,
        durationMsHint: take.durationMs,
      };
    } else {
      audio = {
        kind: "tts",
        voiceProfileId: requireVoiceProfile(resolvedSpeaker, voiceProfileById),
      };
    }
    cues.push({
      id: cue.id,
      origin: "script",
      sourceLineId: line.id,
      speaker: side,
      caption: line.captionText,
      speech: line.speechText,
      expression,
      audio,
    });
  }

  for (const cue of profile.liveCues) {
    const speaker = findSpeakerBySide(
      content,
      profile,
      speakerIdBySide,
      explicitSides,
      cue.speaker,
    );
    speakerBySide.set(cue.speaker, speaker);
    const audio =
      cue.audioAssetId === undefined
        ? ({
            kind: "tts",
            voiceProfileId: requireVoiceProfile(speaker, voiceProfileById),
          } satisfies ResolvedCueSeed["audio"])
        : ({
            kind: "asset",
            assetId: cue.audioAssetId,
            durationMsHint: assetById.get(cue.audioAssetId)?.durationMs ?? null,
          } satisfies ResolvedCueSeed["audio"]);
    if (cue.audioAssetId !== undefined) {
      const asset = assetById.get(cue.audioAssetId);
      if (asset === undefined) {
        fail(`音声素材が見つかりません: ${cue.audioAssetId}`, cue.id);
      }
      if (asset.kind !== "audio") {
        fail(`音声素材ではありません: ${cue.audioAssetId}`, cue.id);
      }
    }
    cues.push({
      id: cue.id,
      origin: "live",
      speaker: cue.speaker,
      caption: cue.caption,
      speech: cue.speech,
      expression: cue.expression,
      audio,
    });
  }

  // A character may be present on stage without speaking in any cue. It still
  // needs a voice and a speaker for characters.json and future generated lines.
  for (const side of ["left", "right"] as const) {
    const characterId = profile.show.characters[side];
    if (characterId === null || speakerBySide.has(side)) {
      continue;
    }
    const candidates = content.speakers.filter(
      (speaker) => speaker.characterId === characterId,
    );
    if (candidates.length === 0) {
      fail(`キャラクター ${characterId} の話者が見つかりません。`, characterId);
    }
    if (candidates.length > 1) {
      fail(
        `キャラクター ${characterId} に複数の話者があります。v1では1キャラクター1話者にしてください。`,
        characterId,
      );
    }
    const speaker = candidates[0]!;
    speakerBySide.set(side, {
      id: speaker.id,
      name: speaker.name,
      side,
      characterId: speaker.characterId,
      voiceProfileId: speaker.voiceProfileId,
    });
  }

  return {
    cues,
    speakers: [...speakerBySide.values()],
    sideBySpeakerId: new Map(
      [...speakerBySide.values()].map((speaker) => [speaker.id, speaker.side]),
    ),
    speakerBySide: speakerBySide,
  };
}

export function resolveSideForCue(
  cue: ResolvedCueSeed,
  speakers: readonly ResolvedSpeaker[],
): ResolvedSpeaker {
  const speaker = speakers.find((entry) => entry.side === cue.speaker);
  if (speaker === undefined) {
    throw new LiveExportError(
      "LIVE_EXPORT_INPUT_INVALID",
      "cue",
      `side ${cue.speaker} の話者が見つかりません。`,
      cue.id,
    );
  }
  return speaker;
}
