import type {
  AppearanceFormValue,
  CharacterFormValue,
  CueFormValue,
  DocumentFormValues,
  LineFormValue,
  SceneFormValue,
  SpeakerFormValue,
  StandingCueInput,
} from "./types";
import {
  DEFAULT_APPEARANCE_EXPRESSION,
  DEFAULT_APPEARANCE_POSE,
  STANDING_TEMPLATE_ID,
  VIDEO_PLAYBACK_SUFFIX,
} from "./constants";
import { randomId } from "./factories";
import { readStanding } from "./read";
import { parseVideoPlayback, serializeVideoPlayback } from "./cue-read";
import {
  CANVAS_PROFILE_LABELS,
  canvasProfileOf,
  getVisualTemplate,
  type ContentDocument,
  type VisualCue,
  type VisualTemplateDefinition,
  type CanvasProfile,
  type Composition,
  type VideoGate,
} from "@kakeai/contracts";

export function compositionVersionOptions(
  compositions: readonly Composition[],
  profiles?: readonly CanvasProfile[],
): { value: string; label: string }[] {
  return compositions.flatMap((composition) =>
    (composition.versions ?? [])
      .filter(
        (version) =>
          profiles === undefined ||
          profiles.includes(canvasProfileOf(version.manifest)),
      )
      .map((version) => ({
        value: version.id,
        label: `${composition.name} v${version.versionNumber}・${CANVAS_PROFILE_LABELS[canvasProfileOf(version.manifest)]}`,
      })),
  );
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
  return {
    id: newCharacterId(),
    name: "",
    names: [],
    voiceProfileId: null,
    voices: [],
    appearances: [],
  };
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
  const expression =
    appearance.expression.trim() || DEFAULT_APPEARANCE_EXPRESSION;
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
  return countStandingReferences(
    content,
    (standing) => standing.characterId === characterId,
    {
      countSpeakers: true,
      speakerCharacterId: characterId,
    },
  );
}

export function countAppearanceReferences(
  content: ContentDocument,
  characterId: string,
  appearanceId: string,
): ReferenceUsage {
  return countStandingReferences(
    content,
    (standing) =>
      standing.characterId === characterId &&
      standing.appearanceId === appearanceId,
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
  const shown =
    chars.length > captionLimit
      ? `${chars.slice(0, captionLimit).join("")}…`
      : caption;
  return `${index + 1}. ${lineSpeakerName(line, speakers)} — ${shown}`;
}

export function lineIndex(
  lines: readonly LineFormValue[],
  lineId: string,
): number {
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

export interface VideoGateDefault {
  narrationSegmentId: string;
  sourceMs: number;
}

/**
 * 「ゲートを追加」の既定値を求める。台詞順で最後のゲートより後ろの未使用セリフを
 * 優先し、末尾へ追加することで既存ゲートの sourceMs を書き換えない。
 * 後ろに空きがない場合は先頭の未使用セリフにし、前後のゲートの間に収まる
 * sourceMs を選ぶ。収まる値がない場合は後続の持ち上げに任せる。
 */
export function defaultVideoGate(
  gates: readonly VideoGate[],
  lines: readonly LineFormValue[],
): VideoGateDefault | null {
  const used = new Set(gates.map((gate) => gate.narrationSegmentId));
  const firstUnused = lines.find((line) => !used.has(line.id));
  if (firstUnused === undefined) {
    return null;
  }
  const byLine = [...gates]
    .map((gate) => ({
      gate,
      position: lineIndex(lines, gate.narrationSegmentId),
    }))
    .filter((entry) => entry.position !== -1)
    .sort((a, b) => a.position - b.position);
  const lastPosition = byLine[byLine.length - 1]?.position ?? -1;
  const candidate =
    lines.find((line, index) => index > lastPosition && !used.has(line.id)) ??
    firstUnused;
  const position = lineIndex(lines, candidate.id);
  const previous = [...byLine]
    .reverse()
    .find((entry) => entry.position < position);
  const next = byLine.find((entry) => entry.position > position);
  const maxSourceMs = gates.reduce(
    (max, gate) => Math.max(max, gate.sourceMs),
    0,
  );
  if (next === undefined) {
    return { narrationSegmentId: candidate.id, sourceMs: maxSourceMs + 1000 };
  }
  const low = (previous?.gate.sourceMs ?? -1) + 1;
  const high = next.gate.sourceMs - 1;
  if (low <= high) {
    return {
      narrationSegmentId: candidate.id,
      sourceMs: Math.floor((low + high) / 2),
    };
  }
  return { narrationSegmentId: candidate.id, sourceMs: next.gate.sourceMs };
}

/**
 * セリフゲート有効化時の最初のゲートに選ぶセリフIDを求める。
 * 表示区間がセリフ区間で開始セリフがあればそれを優先し、なければ先頭セリフ。
 */
export function initialVideoGateLineId(
  lines: readonly LineFormValue[],
  rangeStartLineId: string | null,
): string | null {
  if (rangeStartLineId !== null) {
    const ranged = lines.find((line) => line.id === rangeStartLineId);
    if (ranged !== undefined) {
      return ranged.id;
    }
  }
  return lines[0]?.id ?? null;
}

function pruneVideoPlaybackFields(
  templateId: string,
  templateVersion: number,
  fields: Record<string, string>,
  isRemoved: (lineId: string) => boolean,
): Record<string, string> {
  const definition = getVisualTemplate(templateId, templateVersion);
  const gated = (definition?.inputFields ?? []).filter(
    (field) =>
      (field.kind === "media" || field.kind === "nestedMedia") &&
      field.videoPlayback === true,
  );
  if (gated.length === 0) {
    return fields;
  }
  let next = fields;
  for (const field of gated) {
    const key = `${field.key}${VIDEO_PLAYBACK_SUFFIX}`;
    const playback = parseVideoPlayback(next[key]);
    if (playback === null) {
      continue;
    }
    const gates = playback.gates.filter(
      (gate) => !isRemoved(gate.narrationSegmentId),
    );
    if (gates.length === playback.gates.length) {
      continue;
    }
    if (next === fields) {
      next = { ...fields };
    }
    next[key] =
      gates.length === 0 ? "" : serializeVideoPlayback({ ...playback, gates });
  }
  return next;
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
    .filter(
      (field) => field.kind === "effects" || field.kind === "calloutItems",
    )
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
    const pruned = pruneLineContainers(
      definition,
      { [key]: parsed },
      isRemoved,
    );
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
    definition
      .collectLineRefs(baseCue.input, [])
      .some((ref) => ref.lineId === lineId)
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
    if (
      definition
        .collectLineRefs({ [key]: parsed }, [])
        .some((ref) => ref.lineId === lineId)
    ) {
      return true;
    }
  }
  return false;
}

export function countLineCueReferences(
  scene: SceneFormValue,
  lineId: string,
): number {
  return scene.cues.filter((cue) => {
    if (
      cue.rangeKind === "lines" &&
      (cue.startLineId === lineId || cue.endLineId === lineId)
    ) {
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

export function pruneDraftCueForLines(
  cue: CueFormValue,
  allowedLineIds: ReadonlySet<string>,
): CueFormValue {
  const isRemoved = (lineId: string): boolean => !allowedLineIds.has(lineId);
  return {
    ...cue,
    fields: pruneVideoPlaybackFields(
      cue.templateId,
      cue.templateVersion,
      pruneCueEffectFields(
        cue.templateId,
        cue.templateVersion,
        cue.fields,
        isRemoved,
      ),
      isRemoved,
    ),
    baseCue: pruneCueBaseCueTriggers(
      cue.baseCue,
      cue.templateId,
      cue.templateVersion,
      isRemoved,
    ),
  };
}
