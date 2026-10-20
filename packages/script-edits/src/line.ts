import type {
  ContentDocument,
  LineSplitPart,
  NarrationSegment,
  PointScene,
} from "@kakeai/contracts";
import type { ScriptContext } from "./context.ts";
import { invalidOperation, preconditionFailed, targetNotFound } from "./errors.ts";
import type { SceneEditResult } from "./scene.ts";

function hasText(part: LineSplitPart): boolean {
  return part.captionText.trim().length > 0 || part.speechText.trim().length > 0;
}

export function splitLine(
  document: ContentDocument,
  sceneId: string,
  lineId: string,
  first: LineSplitPart,
  second: LineSplitPart,
  context: ScriptContext,
): SceneEditResult {
  const sceneIndex = document.scenes.findIndex((scene) => scene.id === sceneId);
  if (sceneIndex === -1) {
    throw targetNotFound(["sceneId"], `Sceneが見つかりません: ${sceneId}`);
  }
  const scene = document.scenes[sceneIndex]!;
  if (scene.kind !== "point") {
    throw preconditionFailed(["sceneId"], "行を分割できるのは要点Sceneだけです。");
  }
  const lineIndex = scene.lines.findIndex((line) => line.id === lineId);
  if (lineIndex === -1) {
    throw targetNotFound(["lineId"], `行が見つかりません: ${lineId}`);
  }
  const line = scene.lines[lineIndex]!;
  if (!hasText(first)) {
    throw invalidOperation(["first"], "前半の字幕または読みを指定してください。");
  }
  if (!hasText(second)) {
    throw invalidOperation(["second"], "後半の字幕または読みを指定してください。");
  }
  if (first.captionText === second.captionText && first.speechText === second.speechText) {
    throw invalidOperation(["second"], "同じ文章を2行へ複製することはできません。");
  }

  const existingLineIds = new Set(
    document.scenes.flatMap((entry) => entry.lines.map((entryLine) => entryLine.id)),
  );
  const secondLineId = context.ids.line(sceneId, existingLineIds);
  const secondLine: NarrationSegment = {
    id: secondLineId,
    speakerId: line.speakerId,
    captionText: second.captionText,
    speechText: second.speechText,
    selectedAudioTakeId: null,
    expressionId: line.expressionId,
  };
  const firstLine: NarrationSegment = {
    ...line,
    captionText: first.captionText,
    speechText: first.speechText,
    selectedAudioTakeId: null,
  };

  const lines = [...scene.lines];
  lines.splice(lineIndex, 1, firstLine, secondLine);
  const lineIndexById = new Map(lines.map((entry, index) => [entry.id, index]));

  const visualCues = scene.visualCues.map((cue) => {
    if (cue.range.kind !== "lines") {
      return cue;
    }
    const touchesStart = cue.range.startLineId === lineId;
    const touchesEnd = cue.range.endLineId === lineId;
    const remapped =
      touchesStart || touchesEnd
        ? {
            ...cue,
            range: {
              kind: "lines" as const,
              startLineId: touchesStart ? lineId : cue.range.startLineId,
              endLineId: touchesEnd ? secondLineId : cue.range.endLineId,
            },
          }
        : cue;
    if (remapped.range.kind !== "lines") {
      return remapped;
    }
    const start = lineIndexById.get(remapped.range.startLineId);
    const end = lineIndexById.get(remapped.range.endLineId);
    if (start === undefined || end === undefined || start <= end) {
      return remapped;
    }
    return {
      ...remapped,
      range: {
        kind: "lines" as const,
        startLineId: remapped.range.endLineId,
        endLineId: remapped.range.startLineId,
      },
    };
  });

  const updatedScene: PointScene = { ...scene, lines, visualCues };
  const scenes = [...document.scenes];
  scenes[sceneIndex] = updatedScene;

  return {
    document: {
      ...document,
      scenes,
      audioTakes: document.audioTakes.filter(
        (take) => take.narrationSegmentId !== lineId,
      ),
    },
    sceneIds: [],
    lineIds: [secondLineId],
    cueIds: [],
    primaryId: secondLineId,
  };
}
