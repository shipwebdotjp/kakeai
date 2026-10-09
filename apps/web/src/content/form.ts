import { type ContentDocument, type Scene } from "@kakeai/contracts";

export interface LineFormValue {
  id: string;
  speakerId: string | null;
  captionText: string;
  speechText: string;
  selectedAudioTakeId: string | null;
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
}

export interface DocumentFormValues {
  scenes: SceneFormValue[];
}

const FALLBACK_DURATION_MS = 4000;

export function toFormValues(content: ContentDocument): DocumentFormValues {
  return {
    scenes: content.scenes.map((scene) => ({
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
      })),
    })),
  };
}

function buildLines(sceneValue: SceneFormValue): Scene["lines"] {
  return sceneValue.lines.map((line) => ({
    id: line.id,
    speakerId: line.speakerId,
    captionText: line.captionText,
    speechText: line.speechText,
    selectedAudioTakeId: line.selectedAudioTakeId,
  }));
}

export function buildContentDocument(
  base: ContentDocument,
  values: DocumentFormValues,
): ContentDocument {
  const scenes: Scene[] = values.scenes.map((sceneValue, index) => {
    const baseScene = base.scenes[index];
    if (baseScene === undefined) {
      throw new Error(`Scene ${index} の元データがありません`);
    }
    const flooredDurationMs = Math.floor(sceneValue.durationMs);
    const fixedDurationMs =
      Number.isFinite(sceneValue.durationMs) && flooredDurationMs > 0
        ? flooredDurationMs
        : FALLBACK_DURATION_MS;
    const timing: Scene["timing"] =
      baseScene.kind === "point" && sceneValue.timingMode !== "fixed"
        ? { mode: "auto" }
        : { mode: "fixed", durationMs: fixedDurationMs };
    const common = {
      id: baseScene.id,
      accentColor: sceneValue.accentColor.toUpperCase(),
      timing,
      lines: buildLines(sceneValue),
      visualCues: baseScene.visualCues,
    };
    if (baseScene.kind === "intro") {
      return {
        ...common,
        kind: "intro",
        slots: { title: sceneValue.slots.title, subtitle: sceneValue.slots.subtitle },
      };
    }
    if (baseScene.kind === "point") {
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
  return { ...base, scenes };
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
  };
}
