import {
  DEFAULT_POINT_ACCENT_COLOR,
  TEMPLATE_ID,
  TEMPLATE_VERSION,
  mediaCardV1,
  mediaFullBleedV1,
  type ContentDocument,
  type Scene,
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
}

export interface DocumentFormValues {
  scenes: SceneFormValue[];
  bgm: BgmFormValue;
}

const FALLBACK_DURATION_MS = 4000;
export const DEFAULT_BGM_GAIN_DB = -18;
export const DEFAULT_BGM_LOOP = true;

const FULL_BLEED_KEY = `${mediaFullBleedV1.id}@${mediaFullBleedV1.version}`;
const CARD_KEY = `${mediaCardV1.id}@${mediaCardV1.version}`;

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
      };
    }),
    bgm: {
      cueId: bgmCue?.id ?? null,
      assetId: bgmCue?.assetId ?? null,
      gainDb: bgmCue?.gainDb ?? DEFAULT_BGM_GAIN_DB,
      loop: bgmCue?.loop ?? DEFAULT_BGM_LOOP,
    },
  };
}

function isValidTake(take: TakeFormValue): boolean {
  return Number.isInteger(take.durationMs) && take.durationMs > 0 && take.assetId.length > 0;
}

function buildLines(sceneValue: SceneFormValue): Scene["lines"] {
  return sceneValue.lines.map((line) => {
    const selected =
      line.selectedAudioTakeId !== null &&
      line.takes.some((take) => take.id === line.selectedAudioTakeId && isValidTake(take))
        ? line.selectedAudioTakeId
        : null;
    return {
      id: line.id,
      speakerId: line.speakerId,
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

function buildVisualCues(baseScene: Scene | undefined, sceneValue: SceneFormValue): VisualCue[] {
  const managedIds = new Set(
    [sceneValue.backgroundCueId, sceneValue.cardCueId].filter(
      (id): id is string => id !== null,
    ),
  );
  const kept = (baseScene?.visualCues ?? []).filter(
    (cue) => !managedIds.has(cue.id),
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
  return cues;
}

export function buildContentDocument(
  base: ContentDocument,
  values: DocumentFormValues,
): ContentDocument {
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
      lines: buildLines(sceneValue),
      visualCues: buildVisualCues(baseScene, sceneValue),
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
  };
}
