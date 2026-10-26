import { LEGACY_FACE_SET_VERSION } from "@kakeai/contracts";
import type {
  CharacterFormValue,
  DocumentFormValues,
  SpeakerFormValue,
  StandingCueInput,
  StandingFormValue,
  TakeFormValue,
} from "./types";
import {
  DEFAULT_BGM_GAIN_DB,
  DEFAULT_BGM_LOOP,
  DEFAULT_STANDING_SCALE,
  STANDING_TRANSITION_POLICY,
  FALLBACK_DURATION_MS,
  STANDING_SIDES,
  STANDING_TEMPLATE_ID,
  defaultAudioGainDb,
} from "./constants";
import { toCueFormValue } from "./cue-read";
import {
  DEFAULT_SCENE_ACCENT,
  characterStandingV1,
  DEFAULT_STANDING_EDGE,
  DEFAULT_STANDING_VERTICAL,
  type ContentDocument,
  type Scene,
  type StandingSide,
  type VisualCue,
} from "@kakeai/contracts";

export function readStanding(
  cue: VisualCue | undefined,
): StandingCueInput | null {
  if (
    cue === undefined ||
    cue.template.id !== characterStandingV1.id ||
    cue.template.version !== characterStandingV1.version
  ) {
    return null;
  }
  const parsed = characterStandingV1.inputSchema.safeParse(cue.input);
  if (!parsed.success) {
    return null;
  }
  const data = parsed.data as StandingCueInput;
  return {
    characterId: data.characterId,
    appearanceId: data.appearanceId,
    side: data.side,
    scale: data.scale,
    edge: data.edge,
    vertical: data.vertical,
  };
}

export interface SelectedStandingCue {
  cue: VisualCue;
  standing: StandingCueInput;
}

export function selectManagedStandingCues(scene: Scene): SelectedStandingCue[] {
  const parsed = scene.visualCues
    .filter(
      (cue) =>
        cue.template.id === STANDING_TEMPLATE_ID && cue.range.kind === "scene",
    )
    .map((cue) => ({ cue, standing: readStanding(cue) }))
    .filter((entry): entry is SelectedStandingCue => entry.standing !== null)
    .sort((a, b) => b.cue.template.version - a.cue.template.version);
  const seenSides = new Set<StandingSide>();
  const selected: SelectedStandingCue[] = [];
  for (const entry of parsed) {
    if (
      !STANDING_SIDES.includes(entry.standing.side) ||
      seenSides.has(entry.standing.side)
    ) {
      continue;
    }
    seenSides.add(entry.standing.side);
    selected.push(entry);
  }
  return selected;
}

export function emptyStandingSlots(): StandingFormValue[] {
  return STANDING_SIDES.map((side) => ({
    cueId: null,
    characterId: null,
    appearanceId: null,
    side,
    scale: DEFAULT_STANDING_SCALE,
    edge: DEFAULT_STANDING_EDGE,
    vertical: DEFAULT_STANDING_VERTICAL,
    enterPreset: STANDING_TRANSITION_POLICY.defaultEnter.preset,
    enterDurationMs: STANDING_TRANSITION_POLICY.defaultEnter.durationMs,
    exitPreset: STANDING_TRANSITION_POLICY.defaultExit.preset,
    exitDurationMs: STANDING_TRANSITION_POLICY.defaultExit.durationMs,
  }));
}

function readStandings(scene: Scene): StandingFormValue[] {
  const bySide = new Map<StandingSide, StandingFormValue>();
  for (const { cue, standing } of selectManagedStandingCues(scene)) {
    bySide.set(standing.side, {
      cueId: cue.id,
      characterId: standing.characterId,
      appearanceId: standing.appearanceId,
      side: standing.side,
      scale: standing.scale,
      edge: standing.edge,
      vertical: standing.vertical,
      enterPreset: cue.transition.enter.preset,
      enterDurationMs: cue.transition.enter.durationMs,
      exitPreset: cue.transition.exit.preset,
      exitDurationMs: cue.transition.exit.durationMs,
    });
  }
  return emptyStandingSlots().map((slot) => bySide.get(slot.side) ?? slot);
}

function readCharacters(content: ContentDocument): CharacterFormValue[] {
  return content.characters.map((character) => {
    const speaker = content.speakers.find(
      (entry) => entry.characterId === character.id,
    );
    const localeVoice = character.voices.find(
      (entry) => entry.locale === content.locale,
    );
    return {
      id: character.id,
      name: character.name,
      names: character.names.map((entry) => ({ ...entry })),
      voiceProfileId:
        localeVoice?.voiceProfileId ?? speaker?.voiceProfileId ?? null,
      voices: character.voices.map((entry) => ({ ...entry })),
      libraryCharacterId: character.libraryCharacterId,
      appearances: character.appearances.map((appearance) => ({
        id: appearance.id,
        assetId: appearance.assetId,
        expression: appearance.expression,
        pose: appearance.pose,
        label: appearance.label ?? "",
        faceSetId: appearance.faceSetId,
        faceSetVersion:
          appearance.faceSetId === null
            ? null
            : (appearance.faceSetVersion ?? LEGACY_FACE_SET_VERSION),
        libraryAppearanceId: appearance.libraryAppearanceId,
      })),
    };
  });
}

function readSpeakers(content: ContentDocument): SpeakerFormValue[] {
  return content.speakers.map((speaker) => ({
    id: speaker.id,
    name: speaker.name,
    characterId: speaker.characterId,
    voiceProfileId: speaker.voiceProfileId,
  }));
}

export function toFormValues(content: ContentDocument): DocumentFormValues {
  const takesByLine = new Map<string, TakeFormValue[]>();
  for (const take of content.audioTakes) {
    const list = takesByLine.get(take.narrationSegmentId) ?? [];
    list.push({
      id: take.id,
      assetId: take.assetId,
      durationMs: take.durationMs,
      source: take.source,
    });
    takesByLine.set(take.narrationSegmentId, list);
  }
  const bgmCue = content.audioCues.find(
    (cue) => cue.role === "bgm" && cue.range.kind === "work",
  );
  return {
    visualTheme: content.visualTheme,
    caption: { showSpeakerName: content.caption?.showSpeakerName ?? false },
    scenes: content.scenes.map((scene) => {
      const cues = scene.visualCues
        .filter((cue) => cue.template.id !== STANDING_TEMPLATE_ID)
        .map(toCueFormValue);
      const accent = scene.accent ?? { ...DEFAULT_SCENE_ACCENT };
      return {
        id: scene.id,
        kind: scene.kind,
        label: scene.label ?? "",
        accentKind: accent.kind,
        accentToken: accent.kind === "theme" ? accent.token : "primary",
        accentColor: accent.kind === "custom" ? accent.color : "",
        timingMode: scene.kind === "point" ? scene.timing.mode : "fixed",
        durationMs:
          scene.timing.mode === "fixed"
            ? scene.timing.durationMs
            : FALLBACK_DURATION_MS,
        transitionPreset: scene.transition?.enter.preset ?? "cut",
        transitionDurationMs: scene.transition?.enter.durationMs ?? 0,
        lines: scene.lines.map((line) => ({
          id: line.id,
          speakerId: line.speakerId,
          captionText: line.captionText,
          speechText: line.speechText,
          selectedAudioTakeId: line.selectedAudioTakeId,
          expressionId: line.expressionId,
          gapBeforeMs: line.gapBeforeMs ?? 0,
          takes: takesByLine.get(line.id) ?? [],
        })),
        cues,
        standings: readStandings(scene),
        audioCues: content.audioCues
          .filter(
            (cue) =>
              cue.range.kind === "scene" && cue.range.sceneId === scene.id,
          )
          .map((cue) => ({
            cueId: cue.id,
            assetId: cue.assetId,
            role: cue.role,
            gainDb: cue.gainDb ?? defaultAudioGainDb(cue.role),
            loop: cue.loop ?? false,
          })),
        mainVisualCueId: scene.kind === "insert" ? scene.mainVisualCueId : "",
        embeddedAudio: scene.kind === "insert" ? scene.embeddedAudio : true,
        embeddedAudioGainDb:
          scene.kind === "insert" &&
          typeof scene.embeddedAudioGainDb === "number" &&
          Number.isFinite(scene.embeddedAudioGainDb)
            ? scene.embeddedAudioGainDb
            : 0,
      };
    }),
    bgm: {
      cueId: bgmCue?.id ?? null,
      assetId: bgmCue?.assetId ?? null,
      gainDb: bgmCue?.gainDb ?? DEFAULT_BGM_GAIN_DB,
      loop: bgmCue?.loop ?? DEFAULT_BGM_LOOP,
    },
    characters: readCharacters(content),
    speakers: readSpeakers(content),
  };
}
