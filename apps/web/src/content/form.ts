import {
  CANVAS_PROFILE_LABELS,
  DEFAULT_ANIMATION_POLICY,
  DEFAULT_SCENE_ACCENT,
  DEFAULT_TRANSITION_POLICY,
  TEMPLATE_ID,
  TEMPLATE_VERSION,
  THEME_ACCENT_TOKENS,
  canvasProfileOf,
  characterStandingV1,
  createInsertScene,
  defaultInsertLabel,
  defaultPointLabel,
  getTemplateInputFields,
  getVisualTemplate,
  MEDIA_ZOOM_MAX,
  MEDIA_ZOOM_MIN,
  mediaCardV1,
  mediaFullBleedV1,
  pointSceneTextCues,
  sceneDeviceFrameV1,
  chartDataSchema,
  chartEffectsSchema,
  chatEffectsSchema,
  chatMessagesSchema,
  CHART_APPEAR_PRESETS,
  flowDiagramSchema,
  flowEffectsSchema,
  listCalloutItemsSchema,
  quoteEffectsSchema,
  statEffectsSchema,
  tableDataSchema,
  tableEffectsSchema,
  type AnimationPreset,
  type AudioCueRole,
  type Character,
  type CharacterVoice,
  type ContentDocument,
  type CueLayer,
  type Scene,
  type SceneAccent,
  type SceneTransitionPreset,
  type Speaker,
  type TemplateFieldSpec,
  type ThemeAccentToken,
  type TransitionPolicy,
  type TransitionPreset,
  type VisualCue,
  type VisualTemplateDefinition,
  type CanvasProfile,
  type Composition,
} from "@kakeai/contracts";

export function compositionVersionOptions(
  compositions: readonly Composition[],
  profiles?: readonly CanvasProfile[],
): { value: string; label: string }[] {
  return compositions.flatMap((composition) =>
    (composition.versions ?? [])
      .filter(
        (version) => profiles === undefined || profiles.includes(canvasProfileOf(version.manifest)),
      )
      .map((version) => ({
        value: version.id,
        label: `${composition.name} v${version.versionNumber}・${CANVAS_PROFILE_LABELS[canvasProfileOf(version.manifest)]}`,
      })),
  );
}

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

export type StandingSide = "left" | "right";
export type CueRangeKind = "scene" | "lines" | "offset";

export interface StandingFormValue {
  cueId: string | null;
  characterId: string | null;
  appearanceId: string | null;
  side: StandingSide;
  scale: number;
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

import type { VisualThemeRef } from "@kakeai/contracts";

export interface DocumentFormValues {
  visualTheme: VisualThemeRef;
  scenes: SceneFormValue[];
  bgm: BgmFormValue;
  characters: CharacterFormValue[];
  speakers: SpeakerFormValue[];
}

const FALLBACK_DURATION_MS = 4000;
export const DEFAULT_BGM_GAIN_DB = -18;
export const DEFAULT_BGM_LOOP = true;
export const AUDIO_CUE_ROLES: readonly AudioCueRole[] = ["bgm", "sfx", "program"];
export const AUDIO_CUE_ROLE_LABELS: Record<AudioCueRole, string> = {
  bgm: "BGM",
  sfx: "効果音",
  program: "音源",
};

export function defaultAudioGainDb(role: AudioCueRole): number {
  return role === "bgm" ? DEFAULT_BGM_GAIN_DB : 0;
}
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
export const STANDING_TRANSITION_POLICY: TransitionPolicy = characterStandingV1.transitionPolicy;

export const CROP_X_SUFFIX = "__x";
export const CROP_Y_SUFFIX = "__y";
export const CROP_ZOOM_SUFFIX = "__zoom";
export const CROP_CENTER_PERCENT = 50;
export const CROP_ZOOM_MIN_PERCENT = MEDIA_ZOOM_MIN * 100;
export const CROP_ZOOM_MAX_PERCENT = MEDIA_ZOOM_MAX * 100;

export const NESTED_MODE_SUFFIX = "__mode";
export const NESTED_MEDIA_FIT_SUFFIX = "__fit";
export const NESTED_COMPOSITION_VERSION_SUFFIX = "__compver";
export const NESTED_COMPOSITION_FIT_SUFFIX = "__compfit";
export const NESTED_COMPOSITION_ZOOM_SUFFIX = "__compzoom";
export const NESTED_COMPOSITION_POS_X_SUFFIX = "__compposx";
export const NESTED_COMPOSITION_POS_Y_SUFFIX = "__compposy";
export const NESTED_MODE_MEDIA = "media";
export const NESTED_MODE_COMPOSITION = "composition";

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
    const speaker = content.speakers.find((entry) => entry.characterId === character.id);
    const localeVoice = character.voices.find((entry) => entry.locale === content.locale);
    return {
      id: character.id,
      name: character.name,
      voiceProfileId: localeVoice?.voiceProfileId ?? speaker?.voiceProfileId ?? null,
      voices: character.voices.map((entry) => ({ ...entry })),
      appearances: character.appearances.map((appearance) => ({
        id: appearance.id,
        assetId: appearance.assetId,
        expression: appearance.expression,
        pose: appearance.pose,
        label: appearance.label ?? "",
        faceSetId: appearance.faceSetId,
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

const CHART_PRESET_FALLBACK: Record<string, string> = {
  "slide-up": "fade",
  "slide-down": "fade",
  "slide-left": "fade",
  "slide-right": "fade",
  "scale-in": "grow",
};
const CHART_APPEAR_PRESET_SET = new Set<string>(CHART_APPEAR_PRESETS);

function normalizeChartEffect(entry: unknown): unknown {
  if (typeof entry !== "object" || entry === null) {
    return entry;
  }
  const effect = (entry as { effect?: unknown }).effect;
  if (typeof effect !== "object" || effect === null) {
    return entry;
  }
  const preset = (effect as { preset?: unknown }).preset;
  if (typeof preset !== "string" || CHART_APPEAR_PRESET_SET.has(preset)) {
    return entry;
  }
  return { ...entry, effect: { ...effect, preset: CHART_PRESET_FALLBACK[preset] ?? "grow" } };
}

function effectsSchemaForVariant(
  variant: "table" | "chart" | "flow" | "stat" | "quote" | "chat",
) {
  switch (variant) {
    case "chart":
      return chartEffectsSchema;
    case "flow":
      return flowEffectsSchema;
    case "stat":
      return statEffectsSchema;
    case "quote":
      return quoteEffectsSchema;
    case "chat":
      return chatEffectsSchema;
    case "table":
      return tableEffectsSchema;
  }
}

function defaultEffectsForVariant(
  variant: "table" | "chart" | "flow" | "stat" | "quote" | "chat",
): unknown[] {
  switch (variant) {
    case "chat":
      return [];
    case "chart":
      return [
        {
          target: { kind: "bars" },
          trigger: { kind: "cue" },
          effect: { kind: "appear", preset: "grow", durationMs: 600, staggerMs: 120 },
        },
      ];
    case "flow":
      return [
        {
          target: { kind: "nodes" },
          trigger: { kind: "cue" },
          effect: { kind: "appear", preset: "fade", durationMs: 400, staggerMs: 120 },
        },
      ];
    case "stat":
      return [
        {
          trigger: { kind: "cue" },
          effect: { kind: "value", durationMs: 1000 },
        },
      ];
    case "quote":
      return [
        {
          trigger: { kind: "cue" },
          effect: { kind: "appear", preset: "fade", durationMs: 400 },
        },
      ];
    case "table":
      return [
        {
          target: { kind: "rows" },
          trigger: { kind: "cue" },
          effect: { kind: "appear", preset: "fade", durationMs: 400, staggerMs: 150 },
        },
      ];
  }
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
        if (
          field.allowComposition === true &&
          typeof value === "object" &&
          value !== null &&
          (value as { kind?: unknown }).kind === "composition"
        ) {
          const composition = value as {
            compositionVersionId?: unknown;
            fit?: unknown;
            zoom?: unknown;
            position?: unknown;
          };
          const position =
            typeof composition.position === "object" && composition.position !== null
              ? (composition.position as { x?: unknown; y?: unknown })
              : null;
          result[field.key] = "";
          result[`${field.key}${NESTED_MODE_SUFFIX}`] = NESTED_MODE_COMPOSITION;
          result[`${field.key}${NESTED_COMPOSITION_VERSION_SUFFIX}`] =
            typeof composition.compositionVersionId === "string"
              ? composition.compositionVersionId
              : "";
          result[`${field.key}${NESTED_COMPOSITION_FIT_SUFFIX}`] =
            composition.fit === "cover" ? "cover" : "contain";
          result[`${field.key}${NESTED_COMPOSITION_ZOOM_SUFFIX}`] =
            typeof composition.zoom === "number"
              ? String(Math.round(composition.zoom * 100))
              : "";
          result[`${field.key}${NESTED_COMPOSITION_POS_X_SUFFIX}`] =
            typeof position?.x === "number" ? String(Math.round(position.x * 100)) : "";
          result[`${field.key}${NESTED_COMPOSITION_POS_Y_SUFFIX}`] =
            typeof position?.y === "number" ? String(Math.round(position.y * 100)) : "";
          break;
        }
        const media =
          typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "media"
            ? (value as { assetId?: unknown; fit?: unknown })
            : null;
        result[field.key] = typeof media?.assetId === "string" ? media.assetId : "";
        result[`${field.key}${NESTED_MEDIA_FIT_SUFFIX}`] = media?.fit === "contain" ? "contain" : "cover";
        result[`${field.key}${NESTED_MODE_SUFFIX}`] = NESTED_MODE_MEDIA;
        break;
      }
      case "mediaCrop": {
        const value = input[field.key];
        const point =
          typeof value === "object" && value !== null
            ? (value as { x?: unknown; y?: unknown })
            : null;
        result[`${field.key}${CROP_X_SUFFIX}`] =
          typeof point?.x === "number" ? String(Math.round(point.x * 100)) : "";
        result[`${field.key}${CROP_Y_SUFFIX}`] =
          typeof point?.y === "number" ? String(Math.round(point.y * 100)) : "";
        if (field.zoomKey !== undefined) {
          const zoom = input[field.zoomKey];
          result[`${field.key}${CROP_ZOOM_SUFFIX}`] =
            typeof zoom === "number" ? String(Math.round(zoom * 100)) : "";
        }
        break;
      }
      case "text":
      case "optionalText":
      case "color": {
        const value = getAtPath(input, field.key);
        result[field.key] = typeof value === "string" ? value : "";
        break;
      }
      case "number": {
        const value = getAtPath(input, field.key);
        result[field.key] = typeof value === "number" ? String(value) : "";
        break;
      }
      case "decimal": {
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
        const value = getAtPath(input, field.key);
        const text = typeof value === "string" ? value : "";
        const allowed = field.options.map((option) => option.value);
        result[field.key] = allowed.includes(text)
          ? text
          : field.optional
            ? ""
            : (field.options[0]?.value ?? "");
        break;
      }
      case "grid": {
        const value = getAtPath(input, field.key);
        result[field.key] =
          typeof value === "object" && value !== null ? JSON.stringify(value) : "";
        break;
      }
      case "flow": {
        const value = getAtPath(input, field.key);
        result[field.key] =
          typeof value === "object" && value !== null ? JSON.stringify(value) : "";
        break;
      }
      case "effects": {
        const value = getAtPath(input, field.key);
        if (!Array.isArray(value) || value.length === 0) {
          result[field.key] = "";
          break;
        }
        const entries = field.variant === "chart" ? value.map(normalizeChartEffect) : value;
        result[field.key] = JSON.stringify(entries);
        break;
      }
      case "calloutItems": {
        const value = getAtPath(input, field.key);
        result[field.key] = Array.isArray(value) ? JSON.stringify(value) : "";
        break;
      }
      case "messages": {
        const value = getAtPath(input, field.key);
        result[field.key] = Array.isArray(value) ? JSON.stringify(value) : "";
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
    visualTheme: content.visualTheme,
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
        durationMs: scene.timing.mode === "fixed" ? scene.timing.durationMs : FALLBACK_DURATION_MS,
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
          .filter((cue) => cue.range.kind === "scene" && cue.range.sceneId === scene.id)
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
    const speakerId =
      line.speakerId !== null && speakerIds.has(line.speakerId) ? line.speakerId : null;
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
        gainDb: Number.isFinite(cue.gainDb) ? cue.gainDb : defaultAudioGainDb(cue.role),
        loop: cue.loop,
      })),
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

function buildCharacters(values: CharacterFormValue[], locale: CharacterVoice["locale"]): Character[] {
  return values.map((character) => ({
    id: character.id,
    name: character.name,
    voices: mergeLocaleVoice(character.voices, locale, character.voiceProfileId),
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
        faceSetId: appearance.faceSetId,
      };
    }),
  }));
}

function normalizeScale(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function buildSceneAccent(sceneValue: SceneFormValue): SceneAccent {
  if (sceneValue.accentKind === "custom") {
    const color = (sceneValue.accentColor ?? "").trim();
    if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
      return { kind: "custom", color: color.toUpperCase() };
    }
  } else if (
    (THEME_ACCENT_TOKENS as readonly string[]).includes(sceneValue.accentToken)
  ) {
    return { kind: "theme", token: sceneValue.accentToken };
  }
  return { ...DEFAULT_SCENE_ACCENT };
}

function intOrZero(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

interface TransitionEdgesFormValue {
  enterPreset: TransitionPreset;
  enterDurationMs: number;
  exitPreset: TransitionPreset;
  exitDurationMs: number;
}

function buildTransition(
  transition: TransitionEdgesFormValue,
  policy: TransitionPolicy,
): VisualCue["transition"] {
  const enterPreset = policy.presets.includes(transition.enterPreset)
    ? transition.enterPreset
    : policy.defaultEnter.preset;
  const exitPreset = policy.presets.includes(transition.exitPreset)
    ? transition.exitPreset
    : policy.defaultExit.preset;
  return {
    enter: {
      preset: enterPreset,
      durationMs: enterPreset === "none" ? 0 : Math.min(policy.maxDurationMs, intOrZero(transition.enterDurationMs)),
    },
    exit: {
      preset: exitPreset,
      durationMs: exitPreset === "none" ? 0 : Math.min(policy.maxDurationMs, intOrZero(transition.exitDurationMs)),
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

function parseCropPercent(value: string | undefined, label: string): number | null {
  const trimmed = (value ?? "").trim();
  if (trimmed.length === 0) {
    return null;
  }
  const percent = Number(trimmed);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error(`${label}は 0〜100% の範囲で入力してください`);
  }
  return percent;
}

function parseCropZoomPercent(value: string | undefined, label: string): number | null {
  const trimmed = (value ?? "").trim();
  if (trimmed.length === 0) {
    return null;
  }
  const percent = Number(trimmed);
  if (
    !Number.isFinite(percent) ||
    percent < CROP_ZOOM_MIN_PERCENT ||
    percent > CROP_ZOOM_MAX_PERCENT
  ) {
    throw new Error(
      `${label}の拡大率は ${CROP_ZOOM_MIN_PERCENT}〜${CROP_ZOOM_MAX_PERCENT}% の範囲で入力してください`,
    );
  }
  return percent;
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
        const mode = cue.fields[`${field.key}${NESTED_MODE_SUFFIX}`] ?? NESTED_MODE_MEDIA;
        if (mode === NESTED_MODE_COMPOSITION && field.allowComposition === true) {
          const versionId = cue.fields[`${field.key}${NESTED_COMPOSITION_VERSION_SUFFIX}`] ?? "";
          if (versionId.length === 0) {
            hasMedia = false;
            break;
          }
          const fit =
            cue.fields[`${field.key}${NESTED_COMPOSITION_FIT_SUFFIX}`] === "cover"
              ? "cover"
              : "contain";
          const zoomPercent = parseCropZoomPercent(
            cue.fields[`${field.key}${NESTED_COMPOSITION_ZOOM_SUFFIX}`],
            field.label,
          );
          const posXPercent = parseCropPercent(
            cue.fields[`${field.key}${NESTED_COMPOSITION_POS_X_SUFFIX}`],
            field.label,
          );
          const posYPercent = parseCropPercent(
            cue.fields[`${field.key}${NESTED_COMPOSITION_POS_Y_SUFFIX}`],
            field.label,
          );
          const node: Record<string, unknown> = {
            kind: "composition",
            compositionVersionId: versionId,
            fit,
          };
          if (zoomPercent !== null) {
            node.zoom = zoomPercent / 100;
          }
          if (posXPercent !== null && posYPercent !== null) {
            node.position = { x: posXPercent / 100, y: posYPercent / 100 };
          } else if (posXPercent !== null || posYPercent !== null) {
            throw new Error(`${field.label}の位置は横と縦の両方を指定してください`);
          }
          input[field.key] = node;
          break;
        }
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
          const fit = cue.fields[`${field.key}${NESTED_MEDIA_FIT_SUFFIX}`] === "contain" ? "contain" : "cover";
          input[field.key] = { kind: "media", assetId: raw, fit };
        }
        break;
      }
      case "mediaCrop": {
        const xPercent = parseCropPercent(
          cue.fields[`${field.key}${CROP_X_SUFFIX}`],
          field.label,
        );
        const yPercent = parseCropPercent(
          cue.fields[`${field.key}${CROP_Y_SUFFIX}`],
          field.label,
        );
        if (xPercent === null && yPercent === null) {
          deleteAtPath(input, field.key);
        } else if (xPercent === null || yPercent === null) {
          throw new Error(`${field.label}は横と縦の両方を指定してください`);
        } else {
          setAtPath(input, field.key, { x: xPercent / 100, y: yPercent / 100 });
        }
        if (field.zoomKey !== undefined) {
          const zoomPercent = parseCropZoomPercent(
            cue.fields[`${field.key}${CROP_ZOOM_SUFFIX}`],
            field.label,
          );
          if (zoomPercent === null) {
            deleteAtPath(input, field.zoomKey);
          } else {
            setAtPath(input, field.zoomKey, zoomPercent / 100);
          }
        }
        break;
      }
      case "text":
        setAtPath(input, field.key, raw);
        break;
      case "optionalText":
        if (raw.length > 0) {
          setAtPath(input, field.key, raw);
        } else {
          deleteAtPath(input, field.key);
        }
        break;
      case "select": {
        const allowed = field.options.map((option) => option.value);
        if (allowed.includes(raw)) {
          setAtPath(input, field.key, raw);
        } else if (field.optional) {
          deleteAtPath(input, field.key);
        } else {
          setAtPath(input, field.key, field.options[0]?.value ?? "");
        }
        break;
      }
      case "grid": {
        const trimmed = raw.trim();
        if (trimmed.length === 0) {
          deleteAtPath(input, field.key);
          break;
        }
        let parsedJson: unknown;
        const isChart = field.dataKind === "chart";
        const errorMessage = isChart
          ? "グラフデータを正しく入力してください"
          : "表データを正しく入力してください";
        try {
          parsedJson = JSON.parse(trimmed);
        } catch {
          throw new Error(errorMessage);
        }
        const schema = isChart ? chartDataSchema : tableDataSchema;
        const validated = schema.safeParse(parsedJson);
        if (!validated.success) {
          throw new Error(errorMessage);
        }
        setAtPath(input, field.key, validated.data);
        break;
      }
      case "flow": {
        const trimmed = raw.trim();
        if (trimmed.length === 0) {
          deleteAtPath(input, field.key);
          break;
        }
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(trimmed);
        } catch {
          throw new Error("ノードと辺を正しく入力してください");
        }
        const validated = flowDiagramSchema.safeParse(parsedJson);
        if (!validated.success) {
          const detail = validated.error.issues[0];
          const where = detail && detail.path.length > 0 ? `（${detail.path.join(".")}）` : "";
          throw new Error(`ノードと辺を正しく入力してください${where}`);
        }
        setAtPath(input, field.key, validated.data);
        break;
      }
      case "effects": {
        const trimmed = raw.trim();
        if (trimmed.length === 0) {
          deleteAtPath(input, field.key);
          break;
        }
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(trimmed);
        } catch {
          throw new Error("セリフ同期の効果を正しく入力してください");
        }
        const schema = effectsSchemaForVariant(field.variant);
        const validated = schema.safeParse(parsedJson);
        if (!validated.success) {
          throw new Error("セリフ同期の効果を正しく入力してください");
        }
        setAtPath(input, field.key, validated.data);
        break;
      }
      case "calloutItems": {
        const trimmed = raw.trim();
        if (trimmed.length === 0) {
          throw new Error("ポイントを1つ以上入力してください");
        }
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(trimmed);
        } catch {
          throw new Error("ポイントを正しく入力してください");
        }
        const validated = listCalloutItemsSchema.safeParse(parsedJson);
        if (!validated.success) {
          const detail = validated.error.issues[0];
          const where = detail && detail.path.length > 0 ? `（${detail.path.join(".")}）` : "";
          throw new Error(`ポイントを正しく入力してください${where}`);
        }
        setAtPath(input, field.key, validated.data);
        break;
      }
      case "messages": {
        const trimmed = raw.trim();
        if (trimmed.length === 0) {
          throw new Error("メッセージを1つ以上入力してください");
        }
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(trimmed);
        } catch {
          throw new Error("メッセージを正しく入力してください");
        }
        const validated = chatMessagesSchema.safeParse(parsedJson);
        if (!validated.success) {
          const detail = validated.error.issues[0];
          const where = detail && detail.path.length > 0 ? `（${detail.path.join(".")}）` : "";
          throw new Error(`メッセージを正しく入力してください${where}`);
        }
        setAtPath(input, field.key, validated.data);
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
      case "decimal": {
        const trimmed = raw.trim();
        if (trimmed.length === 0) {
          if (field.optional) {
            deleteAtPath(input, field.key);
          } else {
            setAtPath(input, field.key, 0);
          }
        } else {
          const value = Number(trimmed);
          if (!Number.isFinite(value)) {
            throw new Error(`${field.label}は数値で入力してください`);
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
      template: { id: characterStandingV1.id, version: characterStandingV1.version },
      range: { kind: "scene" },
      layer: "standing",
      order,
      transition: buildTransition(standing, STANDING_TRANSITION_POLICY),
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
        throw new Error(`insert Scene ${sceneValue.id} の主動画Cueが存在しません`);
      }
      return {
        ...common,
        kind: "insert",
        timing: { mode: "fixed", durationMs: fixedDurationMs },
        lines: [],
        visualCues: buildVisualCues(baseScene, { ...sceneValue, cues: mainCues, standings: [] }),
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
    template: { id: TEMPLATE_ID, version: TEMPLATE_VERSION },
    speakers,
    characters,
    scenes,
    audioTakes,
    audioCues,
  };
}

export function newLineId(sceneId: string, existing: ReadonlySet<string>): string {
  const sceneToken = idTail(sceneId);
  return uniqueShortId((token) => `line-${sceneToken}-${token}`, existing);
}

export function createEmptyLine(sceneId: string, existing: ReadonlySet<string>): LineFormValue {
  return {
    id: newLineId(sceneId, existing),
    speakerId: null,
    captionText: "",
    speechText: "",
    selectedAudioTakeId: null,
    expressionId: null,
    gapBeforeMs: 0,
    takes: [],
  };
}

export function newTakeId(lineId: string): string {
  return `take-${lineId}-${randomId()}`;
}

export interface GeneratedTakeInput {
  assetId: string;
  durationMs: number;
  source: "manual" | "tts";
}

export type GeneratedTakeSelect = "always" | "ifEmpty";

export function mergeTake(
  line: LineFormValue,
  take: GeneratedTakeInput,
  select: GeneratedTakeSelect,
): LineFormValue {
  const existing = line.takes.find(
    (entry) => entry.assetId === take.assetId && entry.source === take.source,
  );
  const takeId = existing?.id ?? newTakeId(line.id);
  const takes =
    existing === undefined
      ? [...line.takes, { id: takeId, ...take }]
      : line.takes.map((entry) =>
          entry.id === takeId ? { ...entry, durationMs: take.durationMs } : entry,
        );
  const shouldSelect = select === "always" || line.selectedAudioTakeId === null;
  return {
    ...line,
    takes,
    selectedAudioTakeId: shouldSelect ? takeId : line.selectedAudioTakeId,
  };
}

export type GeneratedTakeTrigger = "individual" | "bulk";

export interface GeneratedTakePolicy {
  select: GeneratedTakeSelect;
  autoplay: boolean;
}

export function generatedTakePolicy(trigger: GeneratedTakeTrigger): GeneratedTakePolicy {
  return trigger === "individual"
    ? { select: "always", autoplay: true }
    : { select: "ifEmpty", autoplay: false };
}

export function bulkTtsCandidateLineIds(content: ContentDocument): string[] {
  const ids: string[] = [];
  for (const scene of content.scenes) {
    if (scene.kind !== "point") {
      continue;
    }
    for (const line of scene.lines) {
      if (line.selectedAudioTakeId === null) {
        ids.push(line.id);
      }
    }
  }
  return ids;
}

const SHORT_ID_LENGTH = 3;
const SHORT_ID_ATTEMPTS = 32;
const HEX_ALPHABET = "0123456789abcdef";

function randomHexToken(length: number): string {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let token = "";
  for (const value of bytes) {
    token += HEX_ALPHABET[value & 0x0f];
  }
  return token;
}

function uniqueShortId(
  build: (token: string) => string,
  existing: ReadonlySet<string>,
): string {
  for (let length = SHORT_ID_LENGTH; ; length += 1) {
    for (let attempt = 0; attempt < SHORT_ID_ATTEMPTS; attempt += 1) {
      const candidate = build(randomHexToken(length));
      if (!existing.has(candidate)) {
        return candidate;
      }
    }
  }
}

function idTail(id: string): string {
  const index = id.lastIndexOf("-");
  return index === -1 ? id : id.slice(index + 1);
}

export function newSceneId(existing: ReadonlySet<string>): string {
  return uniqueShortId((token) => `scene-point-${token}`, existing);
}

export function collectSceneIds(scenes: readonly { id: string }[]): ReadonlySet<string> {
  return new Set(scenes.map((scene) => scene.id));
}

export function collectLineIds(
  scenes: readonly { lines: readonly { id: string }[] }[],
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const scene of scenes) {
    for (const line of scene.lines) {
      ids.add(line.id);
    }
  }
  return ids;
}

export function randomId(): string {
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
        fields[`${field.key}${NESTED_MEDIA_FIT_SUFFIX}`] = "cover";
        fields[`${field.key}${NESTED_MODE_SUFFIX}`] = NESTED_MODE_MEDIA;
        if (field.allowComposition) {
          fields[`${field.key}${NESTED_COMPOSITION_VERSION_SUFFIX}`] = "";
          fields[`${field.key}${NESTED_COMPOSITION_FIT_SUFFIX}`] = "contain";
          fields[`${field.key}${NESTED_COMPOSITION_ZOOM_SUFFIX}`] = "";
          fields[`${field.key}${NESTED_COMPOSITION_POS_X_SUFFIX}`] = "";
          fields[`${field.key}${NESTED_COMPOSITION_POS_Y_SUFFIX}`] = "";
        }
        break;
      case "mediaCrop":
        fields[`${field.key}${CROP_X_SUFFIX}`] = "";
        fields[`${field.key}${CROP_Y_SUFFIX}`] = "";
        if (field.zoomKey !== undefined) {
          fields[`${field.key}${CROP_ZOOM_SUFFIX}`] = "";
        }
        break;
      case "animation":
        fields[field.key] = "none";
        fields[`${field.key}__duration`] = String(DEFAULT_ANIMATION_POLICY.defaultDurationMs);
        break;
      case "boolean":
        fields[field.key] = "";
        break;
      case "grid":
        fields[field.key] = defaultGridDataJson();
        break;
      case "decimal":
        fields[field.key] = "0";
        break;
      case "flow":
        fields[field.key] = JSON.stringify({
          nodes: [{ label: "開始" }, { label: "完了" }],
          edges: [{ from: 0, to: 1 }],
        });
        break;
      case "effects":
        fields[field.key] = JSON.stringify(defaultEffectsForVariant(field.variant));
        break;
      case "calloutItems":
        fields[field.key] = JSON.stringify([{ text: "ポイント" }]);
        break;
      case "messages":
        fields[field.key] = JSON.stringify([
          { name: "相手", body: "こんにちは", side: "left" },
          { name: "自分", body: "よろしくお願いします", side: "right" },
        ]);
        break;
      default:
        fields[field.key] = "";
    }
  }
  return fields;
}

export function defaultGridDataJson(): string {
  return JSON.stringify({
    columns: [
      { key: "col1", label: "項目", type: "text" },
      { key: "col2", label: "値", type: "number" },
    ],
    rows: [{ col1: "", col2: "" }],
  });
}

export function createCueFormValue(options: {
  sceneId: string;
  templateId: string;
  templateVersion: number;
  layer: CueLayer;
  order: number;
}): CueFormValue {
  const fields = defaultCueFields(options.templateId, options.templateVersion);
  const policy =
    getVisualTemplate(options.templateId, options.templateVersion)?.transitionPolicy ??
    DEFAULT_TRANSITION_POLICY;
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
    enterPreset: policy.defaultEnter.preset,
    enterDurationMs: policy.defaultEnter.durationMs,
    exitPreset: policy.defaultExit.preset,
    exitDurationMs: policy.defaultExit.durationMs,
    fields,
  };
}

export function nextPointLabel(
  scenes: readonly SceneFormValue[],
  insertIndex: number,
): string {
  const ordinal =
    scenes.slice(0, insertIndex).filter((scene) => scene.kind === "point").length + 1;
  return defaultPointLabel(ordinal);
}

export function nextInsertLabel(
  scenes: readonly SceneFormValue[],
  insertIndex: number,
): string {
  const ordinal =
    scenes.slice(0, insertIndex).filter((scene) => scene.kind === "insert").length + 1;
  return defaultInsertLabel(ordinal);
}

export function createInsertSceneFormValue(
  label: string,
  assetId: string,
  durationMs: number,
  existingSceneIds: ReadonlySet<string>,
): SceneFormValue {
  const id = newSceneId(existingSceneIds);
  const scene = createInsertScene(id, label, assetId, durationMs, true);
  return {
    id,
    kind: "insert",
    label,
    accentKind: "theme",
    accentToken: "primary",
    accentColor: "",
    timingMode: "fixed",
    durationMs,
    transitionPreset: "cut",
    transitionDurationMs: 0,
    lines: [],
    cues: scene.visualCues.map(toCueFormValue),
    standings: [],
    audioCues: [],
    mainVisualCueId: scene.mainVisualCueId,
    embeddedAudio: true,
    embeddedAudioGainDb: 0,
  };
}

export function createPointSceneFormValue(
  label: string,
  existingSceneIds: ReadonlySet<string>,
): SceneFormValue {
  const id = newSceneId(existingSceneIds);
  return {
    id,
    kind: "point",
    label,
    accentKind: "theme",
    accentToken: "primary",
    accentColor: "",
    timingMode: "auto",
    durationMs: FALLBACK_DURATION_MS,
    transitionPreset: "cut",
    transitionDurationMs: 0,
    lines: [],
    cues: pointSceneTextCues(id).map(toCueFormValue),
    standings: emptyStandingSlots(),
    audioCues: [],
    mainVisualCueId: "",
    embeddedAudio: true,
    embeddedAudioGainDb: 0,
  };
}

export function cloneSceneFormValue(
  source: SceneFormValue & { kind: "point" },
  newId: string,
  label: string,
): SceneFormValue {
  return {
    id: newId,
    kind: "point",
    label,
    accentKind: source.accentKind,
    accentToken: source.accentToken,
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
    audioCues: [],
    mainVisualCueId: "",
    embeddedAudio: true,
    embeddedAudioGainDb: 0,
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
  return { id: newCharacterId(), name: "", voiceProfileId: null, voices: [], appearances: [] };
}

export function createEmptyAppearance(): AppearanceFormValue {
  return {
    id: newAppearanceId(),
    assetId: null,
    expression: DEFAULT_APPEARANCE_EXPRESSION,
    pose: DEFAULT_APPEARANCE_POSE,
    label: "",
    faceSetId: null,
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

export function lineSpeakerName(
  line: LineFormValue,
  speakers: readonly SpeakerFormValue[],
): string {
  if (line.speakerId === null) {
    return "話者なし";
  }
  const speaker = speakers.find((entry) => entry.id === line.speakerId);
  const name = speaker?.name.trim() ?? "";
  return name.length > 0 ? name : "話者なし";
}

export function lineCaptionText(line: LineFormValue): string {
  const caption = line.captionText.trim();
  return caption.length > 0 ? caption : "（字幕なし）";
}

export function lineSummary(
  line: LineFormValue,
  speakers: readonly SpeakerFormValue[],
): string {
  return `${lineSpeakerName(line, speakers)} — ${lineCaptionText(line)}`;
}

export function lineOptionLabel(
  lines: readonly LineFormValue[],
  index: number,
  speakers: readonly SpeakerFormValue[],
  captionLimit = 20,
): string {
  const line = lines[index];
  if (line === undefined) {
    return "";
  }
  const caption = lineCaptionText(line);
  const chars = Array.from(caption);
  const shown = chars.length > captionLimit ? `${chars.slice(0, captionLimit).join("")}…` : caption;
  return `${index + 1}. ${lineSpeakerName(line, speakers)} — ${shown}`;
}

export function lineIndex(lines: readonly LineFormValue[], lineId: string): number {
  return lines.findIndex((line) => line.id === lineId);
}

export function lineRangeEndCandidates(
  lines: readonly LineFormValue[],
  startLineId: string,
): LineFormValue[] {
  const start = lineIndex(lines, startLineId);
  return start === -1 ? [...lines] : lines.slice(start);
}

export function nextEndLineId(
  lines: readonly LineFormValue[],
  startLineId: string,
  currentEndLineId: string,
): string {
  const start = lineIndex(lines, startLineId);
  const end = lineIndex(lines, currentEndLineId);
  if (start !== -1 && end !== -1 && end < start) {
    return startLineId;
  }
  return currentEndLineId;
}

export function duplicateLineFormValue(
  line: LineFormValue,
  sceneId: string,
  existing: ReadonlySet<string>,
): LineFormValue {
  const copy = createEmptyLine(sceneId, existing);
  copy.speakerId = line.speakerId;
  copy.captionText = line.captionText;
  copy.speechText = line.speechText;
  copy.expressionId = line.expressionId;
  copy.gapBeforeMs = line.gapBeforeMs;
  return copy;
}

export function normalizeLineRangeCues(scene: SceneFormValue): SceneFormValue {
  const indexById = new Map(scene.lines.map((line, index) => [line.id, index]));
  const cues = scene.cues.map((cue) => {
    if (cue.rangeKind !== "lines") {
      return cue;
    }
    const start = indexById.get(cue.startLineId);
    const end = indexById.get(cue.endLineId);
    if (start === undefined || end === undefined || start <= end) {
      return cue;
    }
    return { ...cue, startLineId: cue.endLineId, endLineId: cue.startLineId };
  });
  return { ...scene, cues };
}

export function removeLineInScene(scene: SceneFormValue, lineIndex: number): SceneFormValue {
  const lines = scene.lines;
  if (lineIndex < 0 || lineIndex >= lines.length) {
    return scene;
  }
  const deletedId = lines[lineIndex]!.id;
  const indexById = new Map(lines.map((line, index) => [line.id, index]));
  const nextLines = lines.filter((_, index) => index !== lineIndex);
  const cues: CueFormValue[] = [];
  for (const cue of scene.cues) {
    if (cue.rangeKind !== "lines") {
      cues.push(cue);
      continue;
    }
    const start = indexById.get(cue.startLineId);
    const end = indexById.get(cue.endLineId);
    if (start === undefined || end === undefined) {
      if (cue.startLineId === deletedId || cue.endLineId === deletedId) {
        continue;
      }
      cues.push(cue);
      continue;
    }
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    if (lineIndex < low || lineIndex > high) {
      cues.push(cue);
      continue;
    }
    if (low === high) {
      continue;
    }
    cues.push({
      ...cue,
      startLineId: lineIndex === low ? lines[low + 1]!.id : lines[low]!.id,
      endLineId: lineIndex === high ? lines[high - 1]!.id : lines[high]!.id,
    });
  }
  return {
    ...scene,
    lines: nextLines,
    cues: cues.map((cue) => ({
      ...cue,
      fields: pruneCueEffectFields(
        cue.templateId,
        cue.templateVersion,
        cue.fields,
        (lineId) => lineId === deletedId,
      ),
      baseCue: pruneCueBaseCueTriggers(
        cue.baseCue,
        cue.templateId,
        cue.templateVersion,
        (lineId) => lineId === deletedId,
      ),
    })),
  };
}

function effectFieldKeys(
  templateId: string,
  templateVersion: number,
): string[] | null {
  const definition = getVisualTemplate(templateId, templateVersion);
  if (definition === undefined) {
    return null;
  }
  return (definition.inputFields ?? [])
    .filter((field) => field.kind === "effects" || field.kind === "calloutItems")
    .map((field) => field.key);
}

function pruneLineContainers(
  definition: VisualTemplateDefinition,
  input: unknown,
  isRemoved: (lineId: string) => boolean,
): unknown {
  if (
    definition.collectLineRefs === undefined ||
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input)
  ) {
    return input;
  }
  const refs = definition.collectLineRefs(input, []);
  if (refs.length === 0) {
    return input;
  }
  const removedKeys = new Set<string>();
  const removedIndices = new Map<string, Set<number>>();
  for (const ref of refs) {
    if (!isRemoved(ref.lineId)) {
      continue;
    }
    const key = ref.path[0];
    if (typeof key !== "string") {
      continue;
    }
    const second = ref.path[1];
    if (typeof second === "number") {
      const indices = removedIndices.get(key) ?? new Set<number>();
      indices.add(second);
      removedIndices.set(key, indices);
    } else {
      removedKeys.add(key);
    }
  }
  if (removedKeys.size === 0 && removedIndices.size === 0) {
    return input;
  }
  const source = input as Record<string, unknown>;
  const next: Record<string, unknown> = { ...source };
  for (const key of removedKeys) {
    delete next[key];
  }
  for (const [key, indices] of removedIndices) {
    const value = source[key];
    if (Array.isArray(value)) {
      next[key] = value.filter((_entry, index) => !indices.has(index));
    }
  }
  return next;
}

function pruneCueEffectFields(
  templateId: string,
  templateVersion: number,
  fields: Record<string, string>,
  isRemoved: (lineId: string) => boolean,
): Record<string, string> {
  const definition = getVisualTemplate(templateId, templateVersion);
  if (definition?.collectLineRefs === undefined) {
    return fields;
  }
  const keys = effectFieldKeys(templateId, templateVersion) ?? [];
  let changed = false;
  const next: Record<string, string> = { ...fields };
  for (const key of keys) {
    const value = fields[key];
    if (value === undefined) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      continue;
    }
    const pruned = pruneLineContainers(definition, { [key]: parsed }, isRemoved);
    if (pruned === null || typeof pruned !== "object") {
      continue;
    }
    const prunedValue = (pruned as Record<string, unknown>)[key];
    if (prunedValue !== parsed) {
      next[key] = JSON.stringify(prunedValue);
      changed = true;
    }
  }
  return changed ? next : fields;
}

function pruneCueBaseCueTriggers(
  baseCue: VisualCue | null,
  templateId: string,
  templateVersion: number,
  isRemoved: (lineId: string) => boolean,
): VisualCue | null {
  if (baseCue === null) {
    return baseCue;
  }
  const definition = getVisualTemplate(templateId, templateVersion);
  if (definition?.collectLineRefs === undefined) {
    return baseCue;
  }
  const pruned = pruneLineContainers(definition, baseCue.input, isRemoved);
  if (pruned === baseCue.input) {
    return baseCue;
  }
  return { ...baseCue, input: pruned };
}

function cueEffectReferencesLine(
  templateId: string,
  templateVersion: number,
  fields: Record<string, string>,
  baseCue: VisualCue | null,
  lineId: string,
): boolean {
  const definition = getVisualTemplate(templateId, templateVersion);
  if (definition?.collectLineRefs === undefined) {
    return false;
  }
  if (
    baseCue !== null &&
    definition.collectLineRefs(baseCue.input, []).some((ref) => ref.lineId === lineId)
  ) {
    return true;
  }
  const keys = effectFieldKeys(templateId, templateVersion) ?? [];
  for (const key of keys) {
    const value = fields[key];
    if (value === undefined) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) {
      continue;
    }
    if (definition.collectLineRefs({ [key]: parsed }, []).some((ref) => ref.lineId === lineId)) {
      return true;
    }
  }
  return false;
}

export function countLineCueReferences(scene: SceneFormValue, lineId: string): number {
  return scene.cues.filter((cue) => {
    if (cue.rangeKind === "lines" && (cue.startLineId === lineId || cue.endLineId === lineId)) {
      return true;
    }
    return cueEffectReferencesLine(
      cue.templateId,
      cue.templateVersion,
      cue.fields,
      cue.baseCue,
      lineId,
    );
  }).length;
}

export function moveLineInScene(
  scene: SceneFormValue,
  fromIndex: number,
  toIndex: number,
): SceneFormValue {
  const lines = [...scene.lines];
  if (
    fromIndex < 0 ||
    fromIndex >= lines.length ||
    toIndex < 0 ||
    toIndex >= lines.length ||
    fromIndex === toIndex
  ) {
    return scene;
  }
  const [moved] = lines.splice(fromIndex, 1);
  if (moved === undefined) {
    return scene;
  }
  lines.splice(toIndex, 0, moved);
  return normalizeLineRangeCues({ ...scene, lines });
}

export interface SplitSceneResult {
  first: SceneFormValue;
  second: SceneFormValue;
}

export function splitPointScene(
  scene: SceneFormValue,
  splitAt: number,
  secondLabel: string,
  existingSceneIds: ReadonlySet<string>,
  splitOffsetMs: number | null,
): SplitSceneResult {
  if (scene.kind !== "point" || splitAt <= 0 || splitAt >= scene.lines.length) {
    throw new Error("この位置ではシーンを分割できません。");
  }
  const lines = scene.lines;
  const indexById = new Map(lines.map((line, index) => [line.id, index]));
  const second = createPointSceneFormValue(secondLabel, existingSceneIds);
  const firstCues: CueFormValue[] = [];
  const secondCues: CueFormValue[] = [...second.cues];
  for (const cue of scene.cues) {
    if (cue.rangeKind === "scene") {
      firstCues.push(cue);
      continue;
    }
    if (cue.rangeKind === "offset") {
      if (splitOffsetMs === null || !Number.isFinite(splitOffsetMs) || splitOffsetMs < 0) {
        firstCues.push(cue);
        continue;
      }
      if (cue.endMs <= splitOffsetMs) {
        firstCues.push(cue);
        continue;
      }
      if (cue.startMs >= splitOffsetMs) {
        secondCues.push({
          ...cue,
          startMs: cue.startMs - splitOffsetMs,
          endMs: cue.endMs - splitOffsetMs,
        });
        continue;
      }
      const secondCueId = newVisualCueId(second.id, cue.templateId.replace(/\W/g, "-"));
      firstCues.push({ ...cue, endMs: splitOffsetMs });
      secondCues.push({
        ...cue,
        id: secondCueId,
        fields: { ...cue.fields },
        baseCue: cue.baseCue === null ? null : { ...structuredClone(cue.baseCue), id: secondCueId },
        startMs: 0,
        endMs: cue.endMs - splitOffsetMs,
      });
      continue;
    }
    const start = indexById.get(cue.startLineId);
    const end = indexById.get(cue.endLineId);
    if (start === undefined || end === undefined) {
      firstCues.push(cue);
      continue;
    }
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    if (high < splitAt) {
      firstCues.push({ ...cue, startLineId: lines[low]!.id, endLineId: lines[high]!.id });
      continue;
    }
    if (low >= splitAt) {
      secondCues.push({ ...cue, startLineId: lines[low]!.id, endLineId: lines[high]!.id });
      continue;
    }
    const secondCueId = newVisualCueId(second.id, cue.templateId.replace(/\W/g, "-"));
    firstCues.push({
      ...cue,
      startLineId: lines[low]!.id,
      endLineId: lines[splitAt - 1]!.id,
    });
    secondCues.push({
      ...cue,
      id: secondCueId,
      fields: { ...cue.fields },
      baseCue: cue.baseCue === null ? null : { ...structuredClone(cue.baseCue), id: secondCueId },
      startLineId: lines[splitAt]!.id,
      endLineId: lines[high]!.id,
    });
  }
  const firstLineIds = new Set(lines.slice(0, splitAt).map((line) => line.id));
  const secondLineIds = new Set(lines.slice(splitAt).map((line) => line.id));
  const toScene = (
    target: SceneFormValue,
    targetLines: LineFormValue[],
    targetCues: CueFormValue[],
    allowed: ReadonlySet<string>,
  ): SceneFormValue => ({
    ...target,
    lines: targetLines,
    cues: targetCues.map((cue) => ({
      ...cue,
      fields: pruneCueEffectFields(
        cue.templateId,
        cue.templateVersion,
        cue.fields,
        (lineId) => !allowed.has(lineId),
      ),
      baseCue: pruneCueBaseCueTriggers(
        cue.baseCue,
        cue.templateId,
        cue.templateVersion,
        (lineId) => !allowed.has(lineId),
      ),
    })),
  });
  return {
    first: toScene(scene, lines.slice(0, splitAt), firstCues, firstLineIds),
    second: toScene(second, lines.slice(splitAt), secondCues, secondLineIds),
  };
}
