import {
  DEFAULT_POINT_ACCENT_COLOR,
  TEMPLATE_ID,
  TEMPLATE_VERSION,
  characterStandingV1,
  mediaCardV1,
  mediaFullBleedV1,
  type Character,
  type ContentDocument,
  type Scene,
  type Speaker,
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
  takes: TakeFormValue[];
}

export interface BgmFormValue {
  cueId: string | null;
  assetId: string | null;
  gainDb: number;
  loop: boolean;
}

export interface AppearanceFormValue {
  id: string;
  assetId: string | null;
  expression: string;
  pose: string;
  label: string;
}

export interface CharacterFormValue {
  id: string;
  name: string;
  voiceProfileId: string | null;
  appearances: AppearanceFormValue[];
}

export interface SpeakerFormValue {
  id: string;
  name: string;
  characterId: string | null;
  voiceProfileId: string | null;
}

export interface StandingFormValue {
  characterId: string | null;
  appearanceId: string | null;
  x: number;
  y: number;
  scale: number;
}

export interface SceneFormValue {
  id: string;
  kind: "intro" | "point" | "outro";
  accentColor: string;
  timingMode: "auto" | "fixed";
  durationMs: number;
  slots: {
    title: string;
    subtitle: string;
    heading: string;
    body: string;
    closing: string;
  };
  lines: LineFormValue[];
  backgroundAssetId: string | null;
  backgroundCueId: string | null;
  cardAssetId: string | null;
  cardCueId: string | null;
  cardHeading: string;
  cardCaption: string;
  standingCueId: string | null;
  standingCharacterId: string | null;
  standingAppearanceId: string | null;
  standingX: number;
  standingY: number;
  standingScale: number;
}

export interface DocumentFormValues {
  scenes: SceneFormValue[];
  bgm: BgmFormValue;
  characters: CharacterFormValue[];
  speakers: SpeakerFormValue[];
}

const FALLBACK_DURATION_MS = 4000;
export const DEFAULT_BGM_GAIN_DB = -18;
export const DEFAULT_BGM_LOOP = true;
export const DEFAULT_STANDING_X = 0.85;
export const DEFAULT_STANDING_Y = 0.85;
export const DEFAULT_STANDING_SCALE = 1;
export const MIN_STANDING_SCALE = 0.1;
export const MAX_STANDING_SCALE = 3;
export const STANDING_SCALE_STEP = 0.05;
export const DEFAULT_APPEARANCE_EXPRESSION = "normal";
export const DEFAULT_APPEARANCE_POSE = "front";

const FULL_BLEED_KEY = `${mediaFullBleedV1.id}@${mediaFullBleedV1.version}`;
const CARD_KEY = `${mediaCardV1.id}@${mediaCardV1.version}`;
const STANDING_KEY = `${characterStandingV1.id}@${characterStandingV1.version}`;

function cueKey(cue: VisualCue): string {
  return `${cue.template.id}@${cue.template.version}`;
}

function findManagedCue(
  scene: Scene | undefined,
  key: string,
): VisualCue | undefined {
  return scene?.visualCues.find((cue) => cueKey(cue) === key && cue.range.kind === "scene");
}

function readAssetId(cue: VisualCue | undefined): string | null {
  if (cue === undefined || typeof cue.input !== "object" || cue.input === null) {
    return null;
  }
  const assetId = (cue.input as { assetId?: unknown }).assetId;
  return typeof assetId === "string" ? assetId : null;
}

function readString(cue: VisualCue | undefined, field: string): string {
  if (cue === undefined || typeof cue.input !== "object" || cue.input === null) {
    return "";
  }
  const value = (cue.input as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}

export interface StandingCueInput {
  characterId: string;
  appearanceId: string;
  x: number;
  y: number;
  scale: number;
}

function readStanding(cue: VisualCue | undefined): StandingCueInput | null {
  if (cue === undefined) {
    return null;
  }
  const parsed = characterStandingV1.inputSchema.safeParse(cue.input);
  if (!parsed.success) {
    return null;
  }
  return {
    characterId: parsed.data.characterId,
    appearanceId: parsed.data.appearanceId,
    x: parsed.data.x,
    y: parsed.data.y,
    scale: parsed.data.scale,
  };
}

function readCharacters(content: ContentDocument): CharacterFormValue[] {
  return content.characters.map((character) => {
    const speaker = content.speakers.find((entry) => entry.characterId === character.id);
    return {
      id: character.id,
      name: character.name,
      voiceProfileId: speaker?.voiceProfileId ?? null,
      appearances: character.appearances.map((appearance) => ({
        id: appearance.id,
        assetId: appearance.assetId,
        expression: appearance.expression,
        pose: appearance.pose,
        label: appearance.label ?? "",
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
    list.push({ id: take.id, assetId: take.assetId, durationMs: take.durationMs, source: take.source });
    takesByLine.set(take.narrationSegmentId, list);
  }
  const bgmCue = content.audioCues.find(
    (cue) => cue.role === "bgm" && cue.range.kind === "work",
  );
  return {
    scenes: content.scenes.map((scene) => {
      const background = findManagedCue(scene, FULL_BLEED_KEY);
      const card = findManagedCue(scene, CARD_KEY);
      const standingCue = findManagedCue(scene, STANDING_KEY);
      const standing = readStanding(standingCue);
      return {
        id: scene.id,
        kind: scene.kind,
        accentColor: scene.accentColor,
        timingMode: scene.kind === "point" ? scene.timing.mode : "fixed",
        durationMs: scene.timing.mode === "fixed" ? scene.timing.durationMs : FALLBACK_DURATION_MS,
        slots: {
          title: scene.kind === "intro" ? scene.slots.title : "",
          subtitle: scene.kind === "intro" ? scene.slots.subtitle : "",
          heading: scene.kind === "point" ? scene.slots.heading : "",
          body: scene.kind === "point" ? scene.slots.body : "",
          closing: scene.kind === "outro" ? scene.slots.closing : "",
        },
        lines: scene.lines.map((line) => ({
          id: line.id,
          speakerId: line.speakerId,
          captionText: line.captionText,
          speechText: line.speechText,
          selectedAudioTakeId: line.selectedAudioTakeId,
          takes: takesByLine.get(line.id) ?? [],
        })),
        backgroundAssetId: readAssetId(background),
        backgroundCueId: background?.id ?? null,
        cardAssetId: readAssetId(card),
        cardCueId: card?.id ?? null,
        cardHeading: readString(card, "heading"),
        cardCaption: readString(card, "caption"),
        standingCueId: standingCue?.id ?? null,
        standingCharacterId: standing?.characterId ?? null,
        standingAppearanceId: standing?.appearanceId ?? null,
        standingX: standing?.x ?? DEFAULT_STANDING_X,
        standingY: standing?.y ?? DEFAULT_STANDING_Y,
        standingScale: standing?.scale ?? DEFAULT_STANDING_SCALE,
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

function isValidTake(take: TakeFormValue): boolean {
  return Number.isInteger(take.durationMs) && take.durationMs > 0 && take.assetId.length > 0;
}

function buildLines(sceneValue: SceneFormValue, speakerIds: ReadonlySet<string>): Scene["lines"] {
  return sceneValue.lines.map((line) => {
    const selected =
      line.selectedAudioTakeId !== null &&
      line.takes.some((take) => take.id === line.selectedAudioTakeId && isValidTake(take))
        ? line.selectedAudioTakeId
        : null;
    return {
      id: line.id,
      speakerId:
        line.speakerId !== null && speakerIds.has(line.speakerId) ? line.speakerId : null,
      captionText: line.captionText,
      speechText: line.speechText,
      selectedAudioTakeId: selected,
    };
  });
}

function buildAudioTakes(values: DocumentFormValues): ContentDocument["audioTakes"] {
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

function readInputObject(cue: VisualCue | undefined): Record<string, unknown> {
  if (cue === undefined || typeof cue.input !== "object" || cue.input === null) {
    return {};
  }
  return { ...(cue.input as Record<string, unknown>) };
}

function standingReferencesMissing(
  cue: VisualCue,
  characterIds: ReadonlySet<string>,
  appearanceIdsByCharacter: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  if (cueKey(cue) !== STANDING_KEY) {
    return false;
  }
  const standing = readStanding(cue);
  if (standing === null) {
    return false;
  }
  const appearanceIds = appearanceIdsByCharacter.get(standing.characterId);
  if (!characterIds.has(standing.characterId) || appearanceIds === undefined) {
    return true;
  }
  return !appearanceIds.has(standing.appearanceId);
}

function buildCharacters(values: CharacterFormValue[]): Character[] {
  return values.map((character) => ({
    id: character.id,
    name: character.name,
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
        expression: appearance.expression.trim() || DEFAULT_APPEARANCE_EXPRESSION,
        pose: appearance.pose.trim() || DEFAULT_APPEARANCE_POSE,
        ...(appearance.label.trim().length === 0 ? {} : { label: appearance.label.trim() }),
      };
    }),
  }));
}

function normalizeUnit(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

function normalizeScale(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function buildVisualCues(
  baseScene: Scene | undefined,
  sceneValue: SceneFormValue,
  characterIds: ReadonlySet<string>,
  appearanceIdsByCharacter: ReadonlyMap<string, ReadonlySet<string>>,
): VisualCue[] {
  const managedIds = new Set(
    [sceneValue.backgroundCueId, sceneValue.cardCueId, sceneValue.standingCueId].filter(
      (id): id is string => id !== null,
    ),
  );
  const kept = (baseScene?.visualCues ?? []).filter(
    (cue) =>
      !managedIds.has(cue.id) &&
      !standingReferencesMissing(cue, characterIds, appearanceIdsByCharacter),
  );
  const cues: VisualCue[] = [...kept];
  if (sceneValue.backgroundAssetId !== null) {
    const baseCue = baseScene?.visualCues.find((cue) => cue.id === sceneValue.backgroundCueId);
    const input = readInputObject(baseCue);
    input.assetId = sceneValue.backgroundAssetId;
    if (baseCue === undefined) {
      input.fit = "cover";
    }
    cues.push({
      id: sceneValue.backgroundCueId ?? newVisualCueId(sceneValue.id, "bg"),
      template: { id: mediaFullBleedV1.id, version: mediaFullBleedV1.version },
      range: { kind: "scene" },
      input,
    });
  }
  if (sceneValue.cardAssetId !== null) {
    const baseCue = baseScene?.visualCues.find((cue) => cue.id === sceneValue.cardCueId);
    const input = readInputObject(baseCue);
    input.assetId = sceneValue.cardAssetId;
    input.heading = sceneValue.cardHeading;
    if (sceneValue.cardCaption.length > 0) {
      input.caption = sceneValue.cardCaption;
    } else {
      delete input.caption;
    }
    cues.push({
      id: sceneValue.cardCueId ?? newVisualCueId(sceneValue.id, "card"),
      template: { id: mediaCardV1.id, version: mediaCardV1.version },
      range: { kind: "scene" },
      input,
    });
  }
  if (sceneValue.standingCharacterId !== null && sceneValue.standingAppearanceId !== null) {
    const appearanceIds = appearanceIdsByCharacter.get(sceneValue.standingCharacterId);
    if (appearanceIds === undefined || !appearanceIds.has(sceneValue.standingAppearanceId)) {
      return cues;
    }
    const baseCue = baseScene?.visualCues.find((cue) => cue.id === sceneValue.standingCueId);
    const input = readInputObject(baseCue);
    input.characterId = sceneValue.standingCharacterId;
    input.appearanceId = sceneValue.standingAppearanceId;
    input.x = normalizeUnit(sceneValue.standingX, DEFAULT_STANDING_X);
    input.y = normalizeUnit(sceneValue.standingY, DEFAULT_STANDING_Y);
    input.scale = normalizeScale(sceneValue.standingScale, DEFAULT_STANDING_SCALE);
    cues.push({
      id: sceneValue.standingCueId ?? newVisualCueId(sceneValue.id, "standing"),
      template: { id: characterStandingV1.id, version: characterStandingV1.version },
      range: { kind: "scene" },
      input,
    });
  }
  return cues;
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
    .filter((speaker) => speaker.characterId === null && referencedSpeakerIds.has(speaker.id))
    .map((speaker) => ({
      id: speaker.id,
      name: speaker.name,
      characterId: null,
      voiceProfileId: normalizeProfileId(speaker.voiceProfileId),
    }));
  const producedIds = new Set(narratorSpeakers.map((speaker) => speaker.id));
  const characterSpeakers = characters.map((character) => {
    const existing = existingSpeakers.find((speaker) => speaker.characterId === character.id);
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
): ContentDocument {
  const characters = buildCharacters(values.characters);
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
  const speakers = buildSpeakers(values.characters, values.speakers, referencedSpeakerIds);
  const speakerIds = new Set(speakers.map((speaker) => speaker.id));
  const baseById = new Map(base.scenes.map((scene) => [scene.id, scene]));
  const scenes: Scene[] = values.scenes.map((sceneValue) => {
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
    const common = {
      id: sceneValue.id,
      accentColor: (sceneValue.accentColor || DEFAULT_POINT_ACCENT_COLOR).toUpperCase(),
      timing,
      lines: buildLines(sceneValue, speakerIds),
      visualCues: buildVisualCues(
        baseScene,
        sceneValue,
        characterIds,
        appearanceIdsByCharacter,
      ),
    };
    if (sceneValue.kind === "intro") {
      return {
        ...common,
        kind: "intro",
        slots: { title: sceneValue.slots.title, subtitle: sceneValue.slots.subtitle },
      };
    }
    if (sceneValue.kind === "point") {
      return {
        ...common,
        kind: "point",
        slots: { heading: sceneValue.slots.heading, body: sceneValue.slots.body },
      };
    }
    return {
      ...common,
      kind: "outro",
      slots: { closing: sceneValue.slots.closing },
    };
  });
  const sceneIds = new Set(scenes.map((scene) => scene.id));
  const audioTakes = buildAudioTakes(values);
  const managedBgmId = values.bgm.cueId;
  const audioCues = base.audioCues.filter(
    (cue) =>
      cue.id !== managedBgmId &&
      (cue.range.kind !== "scene" || sceneIds.has(cue.range.sceneId)),
  );
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
    template: { id: TEMPLATE_ID, version: TEMPLATE_VERSION },
    speakers,
    characters,
    scenes,
    audioTakes,
    audioCues,
  };
}

let lineCounter = 0;

export function newLineId(sceneId: string): string {
  lineCounter += 1;
  return `line-${sceneId}-${Date.now()}-${lineCounter}`;
}

export function createEmptyLine(sceneId: string): LineFormValue {
  return {
    id: newLineId(sceneId),
    speakerId: null,
    captionText: "",
    speechText: "",
    selectedAudioTakeId: null,
    takes: [],
  };
}

export function newTakeId(lineId: string): string {
  return `take-${lineId}-${randomId()}`;
}

export function newSceneId(): string {
  return `scene-point-${randomId()}`;
}

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function newVisualCueId(sceneId: string, suffix: string): string {
  return `visual-${sceneId}-${suffix}`;
}

export function createPointSceneFormValue(): SceneFormValue {
  const id = newSceneId();
  return {
    id,
    kind: "point",
    accentColor: DEFAULT_POINT_ACCENT_COLOR,
    timingMode: "auto",
    durationMs: FALLBACK_DURATION_MS,
    slots: { title: "", subtitle: "", heading: "", body: "", closing: "" },
    lines: [],
    backgroundAssetId: null,
    backgroundCueId: null,
    cardAssetId: null,
    cardCueId: null,
    cardHeading: "",
    cardCaption: "",
    standingCueId: null,
    standingCharacterId: null,
    standingAppearanceId: null,
    standingX: DEFAULT_STANDING_X,
    standingY: DEFAULT_STANDING_Y,
    standingScale: DEFAULT_STANDING_SCALE,
  };
}

export function newCharacterId(): string {
  return `character-${randomId()}`;
}

export function newSpeakerId(): string {
  return `speaker-${randomId()}`;
}

export function newAppearanceId(): string {
  return `appearance-${randomId()}`;
}

export function createEmptyCharacter(): CharacterFormValue {
  return { id: newCharacterId(), name: "", voiceProfileId: null, appearances: [] };
}

export function createEmptyAppearance(): AppearanceFormValue {
  return {
    id: newAppearanceId(),
    assetId: null,
    expression: DEFAULT_APPEARANCE_EXPRESSION,
    pose: DEFAULT_APPEARANCE_POSE,
    label: "",
  };
}

export interface CharacterFormUsage {
  scenes: number;
  standing: number;
  lines: number;
}

export function countCharacterFormUsage(
  values: DocumentFormValues,
  characterId: string,
): CharacterFormUsage {
  const speakerIds = new Set(
    values.speakers
      .filter((speaker) => speaker.characterId === characterId)
      .map((speaker) => speaker.id),
  );
  const sceneIds = new Set<string>();
  let standing = 0;
  let lines = 0;
  for (const scene of values.scenes) {
    if (scene.standingCharacterId === characterId) {
      standing += 1;
      sceneIds.add(scene.id);
    }
    for (const line of scene.lines) {
      if (line.speakerId !== null && speakerIds.has(line.speakerId)) {
        lines += 1;
      }
    }
  }
  return { scenes: sceneIds.size, standing, lines };
}

export interface ReferenceUsage {
  scenes: number;
  cues: number;
  speakers: number;
}

export function countCharacterReferences(
  content: ContentDocument,
  characterId: string,
): ReferenceUsage {
  return countStandingReferences(content, (standing) => standing.characterId === characterId, {
    countSpeakers: true,
    speakerCharacterId: characterId,
  });
}

export function countAppearanceReferences(
  content: ContentDocument,
  characterId: string,
  appearanceId: string,
): ReferenceUsage {
  return countStandingReferences(
    content,
    (standing) =>
      standing.characterId === characterId && standing.appearanceId === appearanceId,
    { countSpeakers: false, speakerCharacterId: null },
  );
}

function countStandingReferences(
  content: ContentDocument,
  matches: (standing: StandingCueInput) => boolean,
  options: { countSpeakers: boolean; speakerCharacterId: string | null },
): ReferenceUsage {
  let cues = 0;
  let speakers = 0;
  const sceneIds = new Set<string>();
  for (const scene of content.scenes) {
    for (const cue of scene.visualCues) {
      if (cueKey(cue) !== STANDING_KEY) {
        continue;
      }
      const standing = readStanding(cue);
      if (standing === null || !matches(standing)) {
        continue;
      }
      cues += 1;
      sceneIds.add(scene.id);
    }
  }
  if (options.countSpeakers && options.speakerCharacterId !== null) {
    for (const speaker of content.speakers) {
      if (speaker.characterId === options.speakerCharacterId) {
        speakers += 1;
      }
    }
  }
  return { scenes: sceneIds.size, cues, speakers };
}
