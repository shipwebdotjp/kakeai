import type {
  ContentDocument,
  Speaker,
  SpeakerAddOperation,
  SpeakerSetVoiceProfileOperation,
} from "@kakeai/contracts";
import type { ScriptContext, ScriptVoiceProfileInfo } from "./context.ts";
import { preconditionFailed, targetNotFound } from "./errors.ts";
import type { SceneEditResult } from "./scene.ts";

export interface SpeakerEditResult extends SceneEditResult {
  speakerIds?: string[];
}

function requireProfile(
  document: ContentDocument,
  voiceProfileId: string,
  context: ScriptContext,
): ScriptVoiceProfileInfo {
  const profiles = context.voiceProfiles;
  if (profiles === undefined) {
    throw preconditionFailed(
      ["voiceProfileId"],
      "声プロファイルを参照できません。",
    );
  }
  const profile = profiles.get(voiceProfileId);
  if (profile === null) {
    throw targetNotFound(
      ["voiceProfileId"],
      `声プロファイルが見つかりません: ${voiceProfileId}`,
    );
  }
  if (profile.locale !== document.locale) {
    throw preconditionFailed(
      ["voiceProfileId"],
      "声プロファイルの言語が台本の言語と一致しません。",
    );
  }
  return profile;
}

/**
 * Creates a Speaker that is not linked to a Character. The Voice Profile is
 * required for creation because a voice-only Speaker exists to speak; a caller
 * can clear it later with `speaker.setVoiceProfile` when reconfiguring the
 * script. The caller may give the operation a `key` and use it from a later
 * `line.add` / `line.setSpeaker` in the same edit.
 */
export function addSpeaker(
  document: ContentDocument,
  operation: SpeakerAddOperation,
  context: ScriptContext,
): SpeakerEditResult {
  requireProfile(document, operation.voiceProfileId, context);

  const existing = new Set(document.speakers.map((speaker) => speaker.id));
  const speakerId = context.ids.speaker(existing);
  const speaker: Speaker = {
    id: speakerId,
    name: operation.name.trim(),
    characterId: null,
    voiceProfileId: operation.voiceProfileId,
  };

  return {
    document: { ...document, speakers: [...document.speakers, speaker] },
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    speakerIds: [speakerId],
    primaryId: speakerId,
  };
}

/**
 * Changes the Voice Profile of an existing Speaker.
 *
 * The Character Voice is authoritative for a Character-linked Speaker: when the
 * Character has a Voice for the document locale, the Speaker must keep that
 * Voice (so `null` is rejected too). When the Character has no Voice for the
 * locale, a non-null assignment is rejected because the human should add the
 * Character Voice first; clearing to `null` is allowed. A voice-only Speaker
 * only needs an existing Profile whose locale matches the document.
 */
export function setSpeakerVoiceProfile(
  document: ContentDocument,
  operation: SpeakerSetVoiceProfileOperation,
  context: ScriptContext,
): SpeakerEditResult {
  const speakerIndex = document.speakers.findIndex(
    (speaker) => speaker.id === operation.speakerId,
  );
  if (speakerIndex === -1) {
    throw targetNotFound(
      ["speakerId"],
      `話者が見つかりません: ${operation.speakerId}`,
    );
  }
  const speaker = document.speakers[speakerIndex]!;

  if (operation.voiceProfileId !== null) {
    requireProfile(document, operation.voiceProfileId, context);
  }

  if (speaker.characterId !== null) {
    const character = document.characters.find(
      (entry) => entry.id === speaker.characterId,
    );
    if (character === undefined) {
      throw preconditionFailed(
        ["speakerId"],
        `話者に対応するキャラクターが見つかりません: ${speaker.characterId}`,
      );
    }
    const characterVoice = character.voices.find(
      (voice) => voice.locale === document.locale,
    );
    if (operation.voiceProfileId === null) {
      if (characterVoice !== undefined) {
        throw preconditionFailed(
          ["voiceProfileId"],
          "キャラクターの声が設定されている話者の声は解除できません。",
        );
      }
    } else if (characterVoice === undefined) {
      throw preconditionFailed(
        ["voiceProfileId"],
        "キャラクターにこの言語の声が設定されていません。",
      );
    } else if (characterVoice.voiceProfileId !== operation.voiceProfileId) {
      throw preconditionFailed(
        ["voiceProfileId"],
        "話者の声はキャラクターの声と一致させる必要があります。",
      );
    }
  }

  const updated: Speaker = {
    ...speaker,
    voiceProfileId: operation.voiceProfileId,
  };
  const speakers = [...document.speakers];
  speakers[speakerIndex] = updated;

  return {
    document: { ...document, speakers },
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    speakerIds: [],
    primaryId: speaker.id,
  };
}
