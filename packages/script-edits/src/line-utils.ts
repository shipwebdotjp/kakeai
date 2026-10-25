import type {
  ContentDocument,
  NarrationSegment,
  NewNarrationLineInput,
  PointScene,
  Scene,
  Speaker,
} from "@kakeai/contracts";
import type { ScriptContext } from "./context.ts";
import { invalidOperation, preconditionFailed, targetNotFound } from "./errors.ts";

export const NO_SPEAKER_EXPRESSION_MESSAGE = "話者のいない行に表情は指定できません。";
export const VOICE_ONLY_SPEAKER_EXPRESSION_MESSAGE =
  "声だけの話者の行には表情を指定できません。";

export interface PointSceneLocation {
  scene: PointScene;
  sceneIndex: number;
}

export function findSpeaker(
  document: ContentDocument,
  speakerId: string | null | undefined,
): Speaker | undefined {
  return speakerId === null || speakerId === undefined
    ? undefined
    : document.speakers.find((entry) => entry.id === speakerId);
}

export function isVoiceOnlySpeaker(speaker: Speaker | undefined): boolean {
  return speaker?.characterId === null;
}

/** Shared preconditions for a new line created by `line.add` or `scene.add`. */
export function assertNewLineSpeaker(
  document: ContentDocument,
  input: NewNarrationLineInput,
): Speaker | undefined {
  const speaker = findSpeaker(document, input.speakerId);
  if (
    input.speakerId !== undefined &&
    input.speakerId !== null &&
    speaker === undefined
  ) {
    throw targetNotFound(
      ["speakerId"],
      `話者が見つかりません: ${input.speakerId}`,
    );
  }
  if (
    input.expressionId !== undefined &&
    input.expressionId !== null &&
    isVoiceOnlySpeaker(speaker)
  ) {
    throw invalidOperation(
      ["expressionId"],
      VOICE_ONLY_SPEAKER_EXPRESSION_MESSAGE,
    );
  }
  return speaker;
}

export function findPointScene(
  document: ContentDocument,
  sceneId: string,
): PointSceneLocation {
  const sceneIndex = document.scenes.findIndex((scene) => scene.id === sceneId);
  if (sceneIndex === -1) {
    throw targetNotFound(["sceneId"], `Sceneが見つかりません: ${sceneId}`);
  }
  const scene = document.scenes[sceneIndex]!;
  if (scene.kind !== "point") {
    throw preconditionFailed(["sceneId"], "この操作は要点Sceneだけを対象にできます。");
  }
  return { scene, sceneIndex };
}

export function findLineIndex(scene: PointScene, lineId: string): number {
  const index = scene.lines.findIndex((line) => line.id === lineId);
  if (index === -1) {
    throw targetNotFound(["lineId"], `行が見つかりません: ${lineId}`);
  }
  return index;
}

export function existingLineIds(document: ContentDocument): Set<string> {
  return new Set(
    document.scenes.flatMap((scene) => scene.lines.map((line) => line.id)),
  );
}

export function createLine(
  sceneId: string,
  input: NewNarrationLineInput,
  context: ScriptContext,
  existing: Set<string>,
): NarrationSegment {
  const id = context.ids.line(sceneId, existing);
  existing.add(id);
  const speakerId = input.speakerId ?? null;
  const expressionId = input.expressionId ?? null;
  if (speakerId === null && expressionId !== null) {
    throw invalidOperation(
      ["expressionId"],
      NO_SPEAKER_EXPRESSION_MESSAGE,
    );
  }
  const line: NarrationSegment = {
    id,
    speakerId,
    captionText: input.captionText ?? "",
    speechText: input.speechText ?? "",
    selectedAudioTakeId: null,
    expressionId,
  };
  if (input.gapBeforeMs !== undefined && input.gapBeforeMs > 0) {
    line.gapBeforeMs = input.gapBeforeMs;
  }
  return line;
}

export function withScene(
  document: ContentDocument,
  sceneIndex: number,
  scene: Scene,
): ContentDocument {
  const scenes = [...document.scenes];
  scenes[sceneIndex] = scene;
  return { ...document, scenes };
}
