import type {
  CharacterFormValue,
  DocumentFormValues,
  SceneFormValue,
  SpeakerFormValue,
  TakeFormValue,
} from "./types";
import {
  DEFAULT_APPEARANCE_EXPRESSION,
  DEFAULT_APPEARANCE_POSE,
  FALLBACK_DURATION_MS,
  defaultAudioGainDb,
} from "./constants";
import {
  buildStandingCues,
  buildVisualCues,
  type BuildCueOptions,
} from "./build-cue";
import { buildSceneAccent, intOrZero } from "./build-common";
import { randomId } from "./factories";
import {
  TEMPLATE_ID,
  TEMPLATE_VERSION,
  type Character,
  type CharacterVoice,
  type ContentDocument,
  type Scene,
  type Speaker,
} from "@kakeai/contracts";

function isValidTake(take: TakeFormValue): boolean {
  return (
    Number.isInteger(take.durationMs) &&
    take.durationMs > 0 &&
    take.assetId.length > 0
  );
}

function buildLines(
  sceneValue: SceneFormValue,
  speakerIds: ReadonlySet<string>,
): Scene["lines"] {
  return sceneValue.lines.map((line) => {
    const selected =
      line.selectedAudioTakeId !== null &&
      line.takes.some(
        (take) => take.id === line.selectedAudioTakeId && isValidTake(take),
      )
        ? line.selectedAudioTakeId
        : null;
    const speakerId =
      line.speakerId !== null && speakerIds.has(line.speakerId)
        ? line.speakerId
        : null;
    const gapBeforeMs = intOrZero(line.gapBeforeMs);
    return {
      id: line.id,
      speakerId,
      captionText: line.captionText,
      speechText: line.speechText,
      selectedAudioTakeId: selected,
      expressionId: speakerId !== null ? line.expressionId : null,
      ...(gapBeforeMs > 0 ? { gapBeforeMs } : {}),
    };
  });
}

function buildAudioTakes(
  values: DocumentFormValues,
): ContentDocument["audioTakes"] {
  return values.scenes.flatMap((scene) =>
    scene.lines.flatMap((line) =>
      line.takes.filter(isValidTake).map((take) => ({
        id: take.id,
        narrationSegmentId: line.id,
        source: take.source,
        assetId: take.assetId,
        durationMs: take.durationMs,
      })),
    ),
  );
}

export function buildSceneAudioCues(
  values: DocumentFormValues,
): ContentDocument["audioCues"] {
  return values.scenes.flatMap((scene) =>
    scene.audioCues
      .filter((cue) => cue.assetId !== null && cue.assetId.length > 0)
      .map((cue) => ({
        id: cue.cueId ?? `audio-scene-${randomId()}`,
        role: cue.role,
        assetId: cue.assetId as string,
        range: { kind: "scene" as const, sceneId: scene.id },
        gainDb: Number.isFinite(cue.gainDb)
          ? cue.gainDb
          : defaultAudioGainDb(cue.role),
        loop: cue.loop,
      })),
  );
}

function mergeLocaleVoice(
  voices: CharacterVoice[],
  locale: CharacterVoice["locale"],
  voiceProfileId: string | null,
): CharacterVoice[] {
  if (voiceProfileId === null) {
    return voices.filter((entry) => entry.locale !== locale);
  }
  const merged = voices.map((entry) =>
    entry.locale === locale ? { locale, voiceProfileId } : entry,
  );
  return merged.some((entry) => entry.locale === locale)
    ? merged
    : [...merged, { locale, voiceProfileId }];
}

function buildCharacters(
  values: CharacterFormValue[],
  locale: CharacterVoice["locale"],
): Character[] {
  return values.map((character) => ({
    id: character.id,
    name: character.name,
    names: character.names.map((entry) => ({ ...entry })),
    libraryCharacterId: character.libraryCharacterId,
    voices: mergeLocaleVoice(
      character.voices,
      locale,
      character.voiceProfileId,
    ),
    appearances: character.appearances.map((appearance, appearanceIndex) => {
      if (appearance.assetId === null || appearance.assetId.length === 0) {
        const name = character.name.trim() || character.id;
        throw new Error(
          `キャラクター「${name}」の外観 ${appearanceIndex + 1} の画像が選択されていません`,
        );
      }
      return {
        id: appearance.id,
        assetId: appearance.assetId,
        expression:
          appearance.expression.trim() || DEFAULT_APPEARANCE_EXPRESSION,
        pose: appearance.pose.trim() || DEFAULT_APPEARANCE_POSE,
        ...(appearance.label.trim().length === 0
          ? {}
          : { label: appearance.label.trim() }),
        faceSetId: appearance.faceSetId,
        faceSetVersion:
          appearance.faceSetId === null ? null : appearance.faceSetVersion,
        libraryAppearanceId: appearance.libraryAppearanceId,
      };
    }),
  }));
}

function normalizeProfileId(value: string | null): string | null {
  return value !== null && value.length > 0 ? value : null;
}

function buildSpeakers(
  characters: CharacterFormValue[],
  existingSpeakers: SpeakerFormValue[],
  referencedSpeakerIds: ReadonlySet<string>,
): Speaker[] {
  const characterIds = new Set(characters.map((character) => character.id));
  const narratorSpeakers = existingSpeakers
    .filter(
      (speaker) =>
        speaker.characterId === null && referencedSpeakerIds.has(speaker.id),
    )
    .map((speaker) => ({
      id: speaker.id,
      name: speaker.name,
      characterId: null,
      voiceProfileId: normalizeProfileId(speaker.voiceProfileId),
    }));
  const producedIds = new Set(narratorSpeakers.map((speaker) => speaker.id));
  const characterSpeakers = characters.map((character) => {
    const existing = existingSpeakers.find(
      (speaker) => speaker.characterId === character.id,
    );
    const speaker = {
      id: existing?.id ?? `speaker-${character.id}`,
      name: character.name,
      characterId: character.id,
      voiceProfileId: normalizeProfileId(character.voiceProfileId),
    };
    producedIds.add(speaker.id);
    return speaker;
  });
  const extraReferenced = existingSpeakers
    .filter(
      (speaker) =>
        referencedSpeakerIds.has(speaker.id) &&
        !producedIds.has(speaker.id) &&
        (speaker.characterId === null || characterIds.has(speaker.characterId)),
    )
    .map((speaker) => ({
      id: speaker.id,
      name: speaker.name,
      characterId:
        speaker.characterId !== null && characterIds.has(speaker.characterId)
          ? speaker.characterId
          : null,
      voiceProfileId: normalizeProfileId(speaker.voiceProfileId),
    }));
  return [...narratorSpeakers, ...characterSpeakers, ...extraReferenced];
}

export function buildContentDocument(
  base: ContentDocument,
  values: DocumentFormValues,
  options: BuildCueOptions = {},
): ContentDocument {
  const characters = buildCharacters(values.characters, base.locale);
  const characterIds = new Set(characters.map((character) => character.id));
  const appearanceIdsByCharacter = new Map(
    characters.map((character) => [
      character.id,
      new Set(character.appearances.map((appearance) => appearance.id)),
    ]),
  );
  const referencedSpeakerIds = new Set(
    values.scenes
      .flatMap((scene) => scene.lines.map((line) => line.speakerId))
      .filter((id): id is string => id !== null),
  );
  const speakers = buildSpeakers(
    values.characters,
    values.speakers,
    referencedSpeakerIds,
  );
  const speakerIds = new Set(speakers.map((speaker) => speaker.id));
  const baseById = new Map(base.scenes.map((scene) => [scene.id, scene]));
  const scenes: Scene[] = values.scenes.map((sceneValue, sceneIndex) => {
    const baseScene = baseById.get(sceneValue.id);
    if (baseScene !== undefined && baseScene.kind !== sceneValue.kind) {
      throw new Error(`Scene ${sceneValue.id} の種別が元データと一致しません`);
    }
    const flooredDurationMs = Math.floor(sceneValue.durationMs);
    const fixedDurationMs =
      Number.isFinite(sceneValue.durationMs) && flooredDurationMs > 0
        ? flooredDurationMs
        : FALLBACK_DURATION_MS;
    const timing: Scene["timing"] =
      sceneValue.kind === "point" && sceneValue.timingMode !== "fixed"
        ? { mode: "auto" }
        : { mode: "fixed", durationMs: fixedDurationMs };
    const visualCues = [
      ...buildVisualCues(baseScene, sceneValue, options),
      ...buildStandingCues(
        baseScene,
        sceneValue,
        characterIds,
        appearanceIdsByCharacter,
      ),
    ];
    const transitionPreset = sceneValue.transitionPreset;
    const transitionPresetIsValid =
      transitionPreset === "fade" || transitionPreset === "crossfade";
    const transition =
      sceneIndex === 0 ||
      !transitionPresetIsValid ||
      intOrZero(sceneValue.transitionDurationMs) === 0
        ? undefined
        : {
            enter: {
              preset: transitionPreset,
              durationMs: intOrZero(sceneValue.transitionDurationMs),
            },
          };
    const common = {
      id: sceneValue.id,
      label: (sceneValue.label ?? "").trim(),
      accent: buildSceneAccent(sceneValue),
      timing,
      ...(transition === undefined ? {} : { transition }),
      lines: buildLines(sceneValue, speakerIds),
      visualCues,
    };
    if (sceneValue.kind === "intro") {
      return { ...common, kind: "intro" };
    }
    if (sceneValue.kind === "point") {
      return { ...common, kind: "point" };
    }
    if (sceneValue.kind === "insert") {
      const mainCues = sceneValue.cues.filter(
        (cue) => cue.id === sceneValue.mainVisualCueId,
      );
      const mainCue = mainCues[0];
      if (mainCue === undefined) {
        throw new Error(
          `insert Scene ${sceneValue.id} の主動画Cueが存在しません`,
        );
      }
      const mainVisualCues = visualCues.filter((cue) => cue.id === mainCue.id);
      if (mainVisualCues.length === 0 && options.tolerant !== true) {
        throw new Error("insert Sceneの主動画Cueの素材を選択してください");
      }
      return {
        ...common,
        kind: "insert",
        timing: { mode: "fixed", durationMs: fixedDurationMs },
        lines: [],
        visualCues: mainVisualCues,
        mainVisualCueId: mainCue.id,
        embeddedAudio: sceneValue.embeddedAudio,
        ...(Number.isFinite(sceneValue.embeddedAudioGainDb) &&
        sceneValue.embeddedAudioGainDb !== 0
          ? { embeddedAudioGainDb: sceneValue.embeddedAudioGainDb }
          : {}),
      };
    }
    return { ...common, kind: "outro" };
  });
  const audioTakes = buildAudioTakes(values);
  const managedBgmId = values.bgm.cueId;
  const preservedAudioCues = base.audioCues.filter((cue) => {
    if (cue.id === managedBgmId) {
      return false;
    }
    // Scene AudioCue は編集フォームが正本なので、work範囲だけを保持する。
    return cue.range.kind === "work";
  });
  const audioCues: ContentDocument["audioCues"] = [
    ...preservedAudioCues,
    ...buildSceneAudioCues(values),
  ];
  if (values.bgm.assetId !== null) {
    audioCues.push({
      id: managedBgmId ?? `audio-bgm-${randomId()}`,
      role: "bgm",
      assetId: values.bgm.assetId,
      range: { kind: "work" },
      gainDb: values.bgm.gainDb,
      loop: values.bgm.loop,
    });
  }
  return {
    ...base,
    visualTheme: values.visualTheme ?? base.visualTheme,
    caption: { showSpeakerName: values.caption?.showSpeakerName ?? false },
    template: { id: TEMPLATE_ID, version: TEMPLATE_VERSION },
    speakers,
    characters,
    scenes,
    audioTakes,
    audioCues,
  };
}
