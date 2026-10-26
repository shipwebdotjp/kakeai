import type { CueFormValue, LineFormValue, SceneFormValue } from "./types";
import {
  ANIMATION_DURATION_SUFFIX,
  CROP_X_SUFFIX,
  CROP_Y_SUFFIX,
  CROP_ZOOM_SUFFIX,
  FALLBACK_DURATION_MS,
  NESTED_COMPOSITION_FIT_SUFFIX,
  NESTED_COMPOSITION_POS_X_SUFFIX,
  NESTED_COMPOSITION_POS_Y_SUFFIX,
  NESTED_COMPOSITION_VERSION_SUFFIX,
  NESTED_COMPOSITION_ZOOM_SUFFIX,
  NESTED_MEDIA_FIT_SUFFIX,
  NESTED_MODE_MEDIA,
  NESTED_MODE_SUFFIX,
  STANDING_TEMPLATE_ID,
  VIDEO_PLAYBACK_SUFFIX,
} from "./constants";
import { emptyStandingSlots } from "./read";
import { defaultEffectsForVariant, toCueFormValue } from "./cue-read";
import {
  DEFAULT_ANIMATION_POLICY,
  DEFAULT_TRANSITION_POLICY,
  createInsertScene,
  defaultInsertLabel,
  defaultPointLabel,
  getTemplateInputFields,
  getVisualTemplate,
  pointSceneTextCues,
  type ContentDocument,
  type CueLayer,
} from "@kakeai/contracts";

export function newLineId(
  sceneId: string,
  existing: ReadonlySet<string>,
): string {
  const sceneToken = idTail(sceneId);
  return uniqueShortId((token) => `line-${sceneToken}-${token}`, existing);
}

export const DEFAULT_NEW_LINE_GAP_BEFORE_MS = 500;

export function createEmptyLine(
  sceneId: string,
  existing: ReadonlySet<string>,
): LineFormValue {
  return {
    id: newLineId(sceneId, existing),
    speakerId: null,
    captionText: "",
    speechText: "",
    selectedAudioTakeId: null,
    expressionId: null,
    gapBeforeMs: DEFAULT_NEW_LINE_GAP_BEFORE_MS,
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
          entry.id === takeId
            ? { ...entry, durationMs: take.durationMs }
            : entry,
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

export function generatedTakePolicy(
  trigger: GeneratedTakeTrigger,
): GeneratedTakePolicy {
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
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
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

export function collectSceneIds(
  scenes: readonly { id: string }[],
): ReadonlySet<string> {
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
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function newVisualCueId(sceneId: string, suffix: string): string {
  return `visual-${sceneId}-${suffix}-${randomId()}`;
}

function defaultCueFields(
  templateId: string,
  templateVersion: number,
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const field of getTemplateInputFields(templateId, templateVersion) ??
    []) {
    switch (field.kind) {
      case "select":
        fields[field.key] = field.optional
          ? ""
          : (field.options[0]?.value ?? "");
        break;
      case "nestedMedia":
        fields[field.key] = "";
        fields[`${field.key}${NESTED_MEDIA_FIT_SUFFIX}`] = "cover";
        fields[`${field.key}${NESTED_MODE_SUFFIX}`] = NESTED_MODE_MEDIA;
        if (field.videoPlayback === true) {
          fields[`${field.key}${VIDEO_PLAYBACK_SUFFIX}`] = "";
        }
        if (field.allowComposition) {
          fields[`${field.key}${NESTED_COMPOSITION_VERSION_SUFFIX}`] = "";
          fields[`${field.key}${NESTED_COMPOSITION_FIT_SUFFIX}`] = "contain";
          fields[`${field.key}${NESTED_COMPOSITION_ZOOM_SUFFIX}`] = "";
          fields[`${field.key}${NESTED_COMPOSITION_POS_X_SUFFIX}`] = "";
          fields[`${field.key}${NESTED_COMPOSITION_POS_Y_SUFFIX}`] = "";
        }
        break;
      case "media":
        fields[field.key] = "";
        if (field.videoPlayback === true) {
          fields[`${field.key}${VIDEO_PLAYBACK_SUFFIX}`] = "";
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
        fields[`${field.key}${ANIMATION_DURATION_SUFFIX}`] = String(
          DEFAULT_ANIMATION_POLICY.defaultDurationMs,
        );
        break;
      case "boolean":
        fields[field.key] = "";
        break;
      case "grid":
        fields[field.key] = defaultGridDataJson();
        break;
      case "decimal":
        fields[field.key] = String(field.defaultValue ?? 0);
        break;
      case "flow":
        fields[field.key] = JSON.stringify({
          nodes: [{ label: "開始" }, { label: "完了" }],
          edges: [{ from: 0, to: 1 }],
        });
        break;
      case "effects":
        fields[field.key] = JSON.stringify(
          defaultEffectsForVariant(field.variant),
        );
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

export const DEFAULT_OFFSET_RANGE_MS = 3000;

export function defaultOffsetEndMs(sceneDurationMs: number | null): number {
  if (sceneDurationMs === null || !Number.isFinite(sceneDurationMs)) {
    return DEFAULT_OFFSET_RANGE_MS;
  }
  return Math.max(
    1,
    Math.min(DEFAULT_OFFSET_RANGE_MS, Math.floor(sceneDurationMs)),
  );
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
    getVisualTemplate(options.templateId, options.templateVersion)
      ?.transitionPolicy ?? DEFAULT_TRANSITION_POLICY;
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

export function duplicateCueFormValue(
  source: CueFormValue,
  sceneId: string,
  cues: readonly CueFormValue[],
): CueFormValue | null {
  if (source.baseCue === null) {
    return null;
  }
  if (source.templateId === STANDING_TEMPLATE_ID) {
    return null;
  }
  const nextOrder =
    cues
      .filter(
        (cue) => cue?.layer === source.layer && Number.isFinite(cue?.order),
      )
      .reduce((max, cue) => Math.max(max, cue?.order ?? 0), -1) + 1;
  const id = newVisualCueId(sceneId, source.templateId.replace(/\W/g, "-"));
  return {
    ...source,
    id,
    baseCue: { ...structuredClone(source.baseCue), id },
    fields: { ...source.fields },
    order: nextOrder,
  };
}

export function nextPointLabel(
  scenes: readonly SceneFormValue[],
  insertIndex: number,
): string {
  const ordinal =
    scenes.slice(0, insertIndex).filter((scene) => scene.kind === "point")
      .length + 1;
  return defaultPointLabel(ordinal);
}

export function nextInsertLabel(
  scenes: readonly SceneFormValue[],
  insertIndex: number,
): string {
  const ordinal =
    scenes.slice(0, insertIndex).filter((scene) => scene.kind === "insert")
      .length + 1;
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
        baseCue:
          cue.baseCue === null ? null : { ...structuredClone(cue.baseCue), id },
      };
    }),
    standings: source.standings.map((standing) => ({
      ...standing,
      cueId: null,
    })),
    audioCues: [],
    mainVisualCueId: "",
    embeddedAudio: true,
    embeddedAudioGainDb: 0,
  };
}
