import {
  DEFAULT_ANIMATION_POLICY,
  DEFAULT_POINT_ACCENT_COLOR,
  DEFAULT_TRANSITION_POLICY,
  TEMPLATE_ID,
  TEMPLATE_VERSION,
  characterStandingV1,
  characterStandingV2,
  getTemplateInputFields,
  getVisualTemplate,
  mediaCardV1,
  mediaFullBleedV1,
  pointSceneTextCues,
  sceneDeviceFrameV1,
  type AnimationPreset,
  type Character,
  type ContentDocument,
  type CueLayer,
  type Scene,
  type SceneTransitionPreset,
  type Speaker,
  type TemplateFieldSpec,
  type TransitionPolicy,
  type TransitionPreset,
  type VisualCue,
  type VisualTemplateDefinition,
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

export type StandingSide = "left" | "right";
export type CueRangeKind = "scene" | "lines" | "offset";

export interface StandingFormValue {
  cueId: string | null;
  characterId: string | null;
  appearanceId: string | null;
  side: StandingSide;
  scale: number;
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

export interface SceneFormValue {
  id: string;
  kind: "intro" | "point" | "outro";
  accentColor: string;
  timingMode: "auto" | "fixed";
  durationMs: number;
  transitionPreset: SceneTransitionPreset;
  transitionDurationMs: number;
  lines: LineFormValue[];
  cues: CueFormValue[];
  standings: StandingFormValue[];
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
export const DEFAULT_STANDING_SCALE = 1;
export const MIN_STANDING_SCALE = 0.1;
export const MAX_STANDING_SCALE = 3;
export const STANDING_SCALE_STEP = 0.05;
export const STANDING_SIDES: readonly StandingSide[] = ["left", "right"];
export const DEFAULT_APPEARANCE_EXPRESSION = "normal";
export const DEFAULT_APPEARANCE_POSE = "front";

export const MEDIA_FULL_BLEED_ID = mediaFullBleedV1.id;
export const MEDIA_CARD_ID = mediaCardV1.id;
export const DEVICE_FRAME_ID = sceneDeviceFrameV1.id;
export const STANDING_TEMPLATE_ID = characterStandingV1.id;

function readInputObject(cue: VisualCue | null): Record<string, unknown> {
  if (cue === null || typeof cue.input !== "object" || cue.input === null) {
    return {};
  }
  return { ...(cue.input as Record<string, unknown>) };
}

function getAtPath(source: Record<string, unknown>, path: string): unknown {
  let current: unknown = source;
  for (const part of path.split(".")) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setAtPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index]!;
    const next = current[key];
    const cloned =
      typeof next === "object" && next !== null && !Array.isArray(next)
        ? { ...(next as Record<string, unknown>) }
        : {};
    current[key] = cloned;
    current = cloned;
  }
  current[parts[parts.length - 1]!] = value;
}

function deleteAtPath(target: Record<string, unknown>, path: string): void {
  const parts = path.split(".");
  let current: Record<string, unknown> | undefined = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const next: unknown = current?.[parts[index]!];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      return;
    }
    const cloned: Record<string, unknown> = { ...(next as Record<string, unknown>) };
    current![parts[index]!] = cloned;
    current = cloned;
  }
  if (current !== undefined) {
    delete current[parts[parts.length - 1]!];
  }
}

export interface StandingCueInput {
  characterId: string;
  appearanceId: string;
  side: StandingSide;
  scale: number;
}

function readStanding(cue: VisualCue | undefined): StandingCueInput | null {
  if (cue === undefined) {
    return null;
  }
  if (
    cue.template.id === characterStandingV2.id &&
    cue.template.version === characterStandingV2.version
  ) {
    const parsed = characterStandingV2.inputSchema.safeParse(cue.input);
    if (!parsed.success) {
      return null;
    }
    const data = parsed.data as StandingCueInput;
    return {
      characterId: data.characterId,
      appearanceId: data.appearanceId,
      side: data.side,
      scale: data.scale,
    };
  }
  if (
    cue.template.id !== characterStandingV1.id ||
    cue.template.version !== characterStandingV1.version
  ) {
    return null;
  }
  const parsed = characterStandingV1.inputSchema.safeParse(cue.input);
  if (!parsed.success) {
    return null;
  }
  const data = parsed.data as { characterId: string; appearanceId: string; x: number; scale: number };
  return {
    characterId: data.characterId,
    appearanceId: data.appearanceId,
    side: data.x < 0.5 ? "left" : "right",
    scale: data.scale,
  };
}

interface SelectedStandingCue {
  cue: VisualCue;
  standing: StandingCueInput;
}

function selectManagedStandingCues(scene: Scene): SelectedStandingCue[] {
  const parsed = scene.visualCues
    .filter((cue) => cue.template.id === STANDING_TEMPLATE_ID && cue.range.kind === "scene")
    .map((cue) => ({ cue, standing: readStanding(cue) }))
    .filter((entry): entry is SelectedStandingCue => entry.standing !== null)
    .sort((a, b) => b.cue.template.version - a.cue.template.version);
  const seenSides = new Set<StandingSide>();
  const selected: SelectedStandingCue[] = [];
  for (const entry of parsed) {
    if (!STANDING_SIDES.includes(entry.standing.side) || seenSides.has(entry.standing.side)) {
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
    });
  }
  return emptyStandingSlots().map((slot) => bySide.get(slot.side) ?? slot);
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

function readCueFields(
  input: Record<string, unknown>,
  definition: VisualTemplateDefinition,
): Record<string, string> {
  const fields = definition.inputFields ?? [];
  const result: Record<string, string> = {};
  for (const field of fields) {
    switch (field.kind) {
      case "media":
        result[field.key] = typeof input[field.key] === "string" ? (input[field.key] as string) : "";
        break;
      case "nestedMedia": {
        const value = input[field.key];
        const media =
          typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "media"
            ? (value as { assetId?: unknown; fit?: unknown })
            : null;
        result[field.key] = typeof media?.assetId === "string" ? media.assetId : "";
        result[`${field.key}__fit`] = media?.fit === "contain" ? "contain" : "cover";
        break;
      }
      case "text":
      case "optionalText":
      case "color":
        result[field.key] = typeof input[field.key] === "string" ? (input[field.key] as string) : "";
        break;
      case "number": {
        const value = getAtPath(input, field.key);
        result[field.key] = typeof value === "number" ? String(value) : "";
        break;
      }
      case "boolean": {
        const value = getAtPath(input, field.key);
        result[field.key] = typeof value === "boolean" ? String(value) : "";
        break;
      }
      case "select": {
        const value = typeof input[field.key] === "string" ? (input[field.key] as string) : "";
        const allowed = field.options.map((option) => option.value);
        result[field.key] = allowed.includes(value)
          ? value
          : field.optional
            ? ""
            : (field.options[0]?.value ?? "");
        break;
      }
      case "animation": {
        const value = input[field.key];
        const spec =
          typeof value === "object" && value !== null
            ? (value as { preset?: unknown; durationMs?: unknown })
            : null;
        const preset =
          typeof spec?.preset === "string" && definition.animationPolicy.presets.includes(spec.preset as AnimationPreset)
            ? (spec.preset as string)
            : "none";
        result[field.key] = preset;
        result[`${field.key}__duration`] =
          typeof spec?.durationMs === "number"
            ? String(spec.durationMs)
            : String(DEFAULT_ANIMATION_POLICY.defaultDurationMs);
        break;
      }
    }
  }
  return result;
}

function toCueFormValue(cue: VisualCue): CueFormValue {
  const input = readInputObject(cue);
  const definition = getVisualTemplate(cue.template.id, cue.template.version);
  const range = cue.range;
  return {
    id: cue.id,
    baseCue: cue,
    templateId: cue.template.id,
    templateVersion: cue.template.version,
    layer: cue.layer,
    order: cue.order,
    rangeKind: range.kind,
    startLineId: range.kind === "lines" ? range.startLineId : "",
    endLineId: range.kind === "lines" ? range.endLineId : "",
    startMs: range.kind === "offset" ? range.startMs : 0,
    endMs: range.kind === "offset" ? range.endMs : 0,
    enterPreset: cue.transition.enter.preset,
    enterDurationMs: cue.transition.enter.durationMs,
    exitPreset: cue.transition.exit.preset,
    exitDurationMs: cue.transition.exit.durationMs,
    fields: definition === undefined ? {} : readCueFields(input, definition),
  };
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
      const cues = scene.visualCues
        .filter((cue) => cue.template.id !== STANDING_TEMPLATE_ID)
        .map(toCueFormValue);
      return {
        id: scene.id,
        kind: scene.kind,
        accentColor: scene.accentColor,
        timingMode: scene.kind === "point" ? scene.timing.mode : "fixed",
        durationMs: scene.timing.mode === "fixed" ? scene.timing.durationMs : FALLBACK_DURATION_MS,
        transitionPreset: scene.transition?.enter.preset ?? "cut",
        transitionDurationMs: scene.transition?.enter.durationMs ?? 0,
        lines: scene.lines.map((line) => ({
          id: line.id,
          speakerId: line.speakerId,
          captionText: line.captionText,
          speechText: line.speechText,
          selectedAudioTakeId: line.selectedAudioTakeId,
          takes: takesByLine.get(line.id) ?? [],
        })),
        cues,
        standings: readStandings(scene),
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

function standingReferencesMissing(
  cue: VisualCue,
  characterIds: ReadonlySet<string>,
  appearanceIdsByCharacter: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  if (cue.template.id !== STANDING_TEMPLATE_ID) {
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

function normalizeScale(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function intOrZero(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function buildTransition(cue: CueFormValue, policy: TransitionPolicy): VisualCue["transition"] {
  const enterPreset = policy.presets.includes(cue.enterPreset)
    ? cue.enterPreset
    : policy.defaultEnter.preset;
  const exitPreset = policy.presets.includes(cue.exitPreset)
    ? cue.exitPreset
    : policy.defaultExit.preset;
  return {
    enter: {
      preset: enterPreset,
      durationMs: enterPreset === "none" ? 0 : Math.min(policy.maxDurationMs, intOrZero(cue.enterDurationMs)),
    },
    exit: {
      preset: exitPreset,
      durationMs: exitPreset === "none" ? 0 : Math.min(policy.maxDurationMs, intOrZero(cue.exitDurationMs)),
    },
  };
}

function buildRange(cue: CueFormValue): VisualCue["range"] {
  if (cue.rangeKind === "offset") {
    if (intOrZero(cue.startMs) > intOrZero(cue.endMs)) {
      throw new Error("表示区間のオフセットは開始 <= 終了にしてください");
    }
    return { kind: "offset", startMs: intOrZero(cue.startMs), endMs: intOrZero(cue.endMs) };
  }
  if (cue.rangeKind === "lines") {
    if (cue.startLineId.length === 0 || cue.endLineId.length === 0) {
      throw new Error("表示区間のセリフ（開始・終了）を選択してください");
    }
    return { kind: "lines", startLineId: cue.startLineId, endLineId: cue.endLineId };
  }
  return { kind: "scene" };
}

function buildCueInput(
  cue: CueFormValue,
  definition: VisualTemplateDefinition,
): Record<string, unknown> | null {
  const fields = definition.inputFields ?? [];
  const base = readInputObject(cue.baseCue);
  const input: Record<string, unknown> = { ...base };
  let hasMedia = true;
  for (const field of fields) {
    const raw = cue.fields[field.key] ?? "";
    switch (field.kind) {
      case "media":
        if (raw.length === 0) {
          hasMedia = false;
        } else {
          input[field.key] = raw;
        }
        break;
      case "nestedMedia": {
        if (raw.length === 0) {
          const baseValue = base[field.key];
          const baseIsMedia =
            typeof baseValue === "object" &&
            baseValue !== null &&
            (baseValue as { kind?: unknown }).kind === "media";
          if (baseValue === undefined || baseIsMedia) {
            if (field.optional) {
              delete input[field.key];
            } else {
              hasMedia = false;
            }
          }
        } else {
          const fit = cue.fields[`${field.key}__fit`] === "contain" ? "contain" : "cover";
          input[field.key] = { kind: "media", assetId: raw, fit };
        }
        break;
      }
      case "text":
        input[field.key] = raw;
        break;
      case "optionalText":
        if (raw.length > 0) {
          input[field.key] = raw;
        } else {
          delete input[field.key];
        }
        break;
      case "select": {
        const allowed = field.options.map((option) => option.value);
        if (allowed.includes(raw)) {
          input[field.key] = raw;
        } else if (field.optional) {
          delete input[field.key];
        } else {
          input[field.key] = field.options[0]?.value ?? "";
        }
        break;
      }
      case "color": {
        const color = raw.trim();
        if (color.length > 0) {
          if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
            throw new Error("背景色は #RRGGBB 形式で入力してください");
          }
          setAtPath(input, field.key, color.toUpperCase());
        } else {
          deleteAtPath(input, field.key);
        }
        break;
      }
      case "number": {
        const trimmed = raw.trim();
        if (trimmed.length === 0) {
          deleteAtPath(input, field.key);
        } else {
          const value = Number(trimmed);
          if (!Number.isInteger(value)) {
            throw new Error(`${field.label}は整数で入力してください`);
          }
          if (
            (field.min !== undefined && value < field.min) ||
            (field.max !== undefined && value > field.max)
          ) {
            throw new Error(
              `${field.label}は ${field.min ?? ""}〜${field.max ?? ""} の範囲で入力してください`,
            );
          }
          setAtPath(input, field.key, value);
        }
        break;
      }
      case "boolean": {
        if (raw === "") {
          deleteAtPath(input, field.key);
        } else {
          setAtPath(input, field.key, raw === "true");
        }
        break;
      }
      case "animation": {
        const policy = definition.animationPolicy;
        if (raw === "" || raw === "none" || !policy.presets.includes(raw as AnimationPreset)) {
          delete input[field.key];
        } else {
          const durationMs = Math.min(
            policy.maxDurationMs,
            intOrZero(Number(cue.fields[`${field.key}__duration`] ?? "0")),
          );
          input[field.key] = { preset: raw, durationMs };
        }
        break;
      }
    }
  }
  if (!hasMedia) {
    return null;
  }
  return input;
}

function buildVisualCues(
  baseScene: Scene | undefined,
  sceneValue: SceneFormValue,
): VisualCue[] {
  const managedStandingIds = (
    baseScene === undefined ? [] : selectManagedStandingCues(baseScene)
  ).map((entry) => entry.cue.id);
  const managedIds = new Set<string>(managedStandingIds);
  const cues: VisualCue[] = [];
  for (const cue of sceneValue.cues) {
    const definition = getVisualTemplate(cue.templateId, cue.templateVersion);
    const fields = definition?.inputFields;
    if (definition !== undefined && fields !== undefined && fields.length > 0) {
      const input = buildCueInput(cue, definition);
      if (input === null) {
        if (cue.baseCue === null) {
          throw new Error("追加したCueの素材を選択してください");
        }
        continue;
      }
      const layer =
        definition.layers.includes(cue.layer) ? cue.layer : (definition.layers[0] ?? "background");
      cues.push({
        id: cue.id,
        template: { id: cue.templateId, version: cue.templateVersion },
        range: buildRange(cue),
        layer,
        order: intOrZero(cue.order),
        transition: buildTransition(cue, definition.transitionPolicy),
        input,
      });
      continue;
    }
    if (cue.baseCue !== null && !managedIds.has(cue.baseCue.id)) {
      const baseDefinition = getVisualTemplate(
        cue.baseCue.template.id,
        cue.baseCue.template.version,
      );
      const allowedBaseLayers = baseDefinition?.layers;
      cues.push({
        ...cue.baseCue,
        range: buildRange(cue),
        layer:
          allowedBaseLayers !== undefined && allowedBaseLayers.includes(cue.layer)
            ? cue.layer
            : cue.baseCue.layer,
        order: intOrZero(cue.order),
        transition: buildTransition(cue, baseDefinition?.transitionPolicy ?? DEFAULT_TRANSITION_POLICY),
      });
    }
  }
  return cues;
}

function buildStandingCues(
  baseScene: Scene | undefined,
  sceneValue: SceneFormValue,
  characterIds: ReadonlySet<string>,
  appearanceIdsByCharacter: ReadonlyMap<string, ReadonlySet<string>>,
): VisualCue[] {
  const managedIds = new Set(
    (baseScene === undefined ? [] : selectManagedStandingCues(baseScene)).map(
      (entry) => entry.cue.id,
    ),
  );
  const kept = (baseScene?.visualCues ?? []).filter(
    (cue) =>
      cue.template.id === STANDING_TEMPLATE_ID &&
      !managedIds.has(cue.id) &&
      !standingReferencesMissing(cue, characterIds, appearanceIdsByCharacter),
  );
  const cues: VisualCue[] = [...kept];
  const emittedSides = new Set<StandingSide>();
  let order = kept.reduce((max, cue) => Math.max(max, cue.order), -1) + 1;
  for (const standing of sceneValue.standings) {
    if (standing.characterId === null || standing.appearanceId === null) {
      continue;
    }
    if (!STANDING_SIDES.includes(standing.side) || emittedSides.has(standing.side)) {
      continue;
    }
    const appearanceIds = appearanceIdsByCharacter.get(standing.characterId);
    if (appearanceIds === undefined || !appearanceIds.has(standing.appearanceId)) {
      continue;
    }
    emittedSides.add(standing.side);
    cues.push({
      id: standing.cueId ?? newVisualCueId(sceneValue.id, `standing-${standing.side}`),
      template: { id: characterStandingV2.id, version: characterStandingV2.version },
      range: { kind: "scene" },
      layer: "standing",
      order,
      transition: {
        enter: { preset: "fade", durationMs: 350 },
        exit: { preset: "none", durationMs: 0 },
      },
      input: {
        characterId: standing.characterId,
        appearanceId: standing.appearanceId,
        side: standing.side,
        scale: normalizeScale(standing.scale, DEFAULT_STANDING_SCALE),
      },
    });
    order += 1;
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
      ...buildVisualCues(baseScene, sceneValue),
      ...buildStandingCues(baseScene, sceneValue, characterIds, appearanceIdsByCharacter),
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
      accentColor: (sceneValue.accentColor || DEFAULT_POINT_ACCENT_COLOR).toUpperCase(),
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
    return { ...common, kind: "outro" };
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
  return `visual-${sceneId}-${suffix}-${randomId()}`;
}

function defaultCueFields(templateId: string, templateVersion: number): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const field of getTemplateInputFields(templateId, templateVersion) ?? []) {
    switch (field.kind) {
      case "select":
        fields[field.key] = field.optional ? "" : (field.options[0]?.value ?? "");
        break;
      case "nestedMedia":
        fields[field.key] = "";
        fields[`${field.key}__fit`] = "cover";
        break;
      case "animation":
        fields[field.key] = "none";
        fields[`${field.key}__duration`] = String(DEFAULT_ANIMATION_POLICY.defaultDurationMs);
        break;
      case "boolean":
        fields[field.key] = "";
        break;
      default:
        fields[field.key] = "";
    }
  }
  return fields;
}

export function createCueFormValue(options: {
  sceneId: string;
  templateId: string;
  templateVersion: number;
  layer: CueLayer;
  order: number;
}): CueFormValue {
  const fields = defaultCueFields(options.templateId, options.templateVersion);
  return {
    id: newVisualCueId(options.sceneId, options.templateId.replace(/\W/g, "-")),
    baseCue: null,
    templateId: options.templateId,
    templateVersion: options.templateVersion,
    layer: options.layer,
    order: options.order,
    rangeKind: "scene",
    startLineId: "",
    endLineId: "",
    startMs: 0,
    endMs: 0,
    enterPreset: "fade",
    enterDurationMs: 350,
    exitPreset: "none",
    exitDurationMs: 0,
    fields,
  };
}

export function createPointSceneFormValue(): SceneFormValue {
  const id = newSceneId();
  return {
    id,
    kind: "point",
    accentColor: DEFAULT_POINT_ACCENT_COLOR,
    timingMode: "auto",
    durationMs: FALLBACK_DURATION_MS,
    transitionPreset: "cut",
    transitionDurationMs: 0,
    lines: [],
    cues: pointSceneTextCues(id).map(toCueFormValue),
    standings: emptyStandingSlots(),
  };
}

export function cloneSceneFormValue(
  source: SceneFormValue & { kind: "point" },
  newId: string,
): SceneFormValue {
  return {
    id: newId,
    kind: "point",
    accentColor: source.accentColor,
    timingMode: source.timingMode,
    durationMs: source.durationMs,
    transitionPreset: source.transitionPreset,
    transitionDurationMs: source.transitionDurationMs,
    lines: [],
    cues: source.cues.map((cue) => {
      const id = newVisualCueId(newId, cue.templateId.replace(/\W/g, "-"));
      const isLineRange = cue.rangeKind === "lines";
      return {
        ...cue,
        id,
        fields: { ...cue.fields },
        rangeKind: isLineRange ? "scene" : cue.rangeKind,
        startLineId: isLineRange ? "" : cue.startLineId,
        endLineId: isLineRange ? "" : cue.endLineId,
        baseCue: cue.baseCue === null ? null : { ...structuredClone(cue.baseCue), id },
      };
    }),
    standings: source.standings.map((standing) => ({ ...standing, cueId: null })),
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

export function appearanceDisplayName(appearance: {
  label: string;
  expression: string;
  pose: string;
}): string {
  const expression = appearance.expression.trim() || DEFAULT_APPEARANCE_EXPRESSION;
  const pose = appearance.pose.trim() || DEFAULT_APPEARANCE_POSE;
  const tags = `${expression} / ${pose}`;
  const label = appearance.label.trim();
  return label.length > 0 ? `${label}（${tags}）` : tags;
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
    for (const entry of scene.standings) {
      if (entry.characterId === characterId) {
        standing += 1;
        sceneIds.add(scene.id);
      }
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
      if (cue.template.id !== STANDING_TEMPLATE_ID) {
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
