import type {
  AudioTake,
  ContentDocument,
  LineSplitPart,
  NarrationSegment,
  NewNarrationLineInput,
  PointScene,
  Warning,
} from "@kakeai/contracts";
import type { ScriptContext } from "./context.ts";
import { invalidOperation, preconditionFailed, targetNotFound } from "./errors.ts";
import type { SceneEditResult } from "./scene.ts";
import {
  assertNewLineSpeaker,
  createLine,
  existingLineIds,
  findLineIndex,
  findPointScene,
  findSpeaker,
  isVoiceOnlySpeaker,
  NO_SPEAKER_EXPRESSION_MESSAGE,
  VOICE_ONLY_SPEAKER_EXPRESSION_MESSAGE,
  withScene,
} from "./line-utils.ts";
import { pruneCueForLines } from "./prune.ts";
import { assertFixedSceneCapacity } from "./timing.ts";

export interface LineEditResult extends SceneEditResult {
  audioTakeIds?: string[];
  warnings?: Warning[];
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

function replaceLine(
  scene: PointScene,
  lineIndex: number,
  line: NarrationSegment,
): PointScene {
  const lines = [...scene.lines];
  lines[lineIndex] = line;
  return { ...scene, lines };
}

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

export function addLine(
  document: ContentDocument,
  sceneId: string,
  index: number | undefined,
  input: NewNarrationLineInput,
  context: ScriptContext,
): LineEditResult {
  const { scene, sceneIndex } = findPointScene(document, sceneId);
  assertNewLineSpeaker(document, input);
  const line = createLine(sceneId, input, context, existingLineIds(document));
  const at = clamp(index ?? scene.lines.length, 0, scene.lines.length);
  const lines = [...scene.lines];
  lines.splice(at, 0, line);
  const next = withScene(document, sceneIndex, { ...scene, lines });
  assertFixedSceneCapacity(next, sceneId);
  return {
    document: next,
    sceneIds: [],
    lineIds: [line.id],
    cueIds: [],
    primaryId: line.id,
  };
}

export function removeLine(
  document: ContentDocument,
  sceneId: string,
  lineId: string,
): LineEditResult {
  const { scene, sceneIndex } = findPointScene(document, sceneId);
  const lineIndex = findLineIndex(scene, lineId);
  const deletedId = scene.lines[lineIndex]!.id;
  const indexById = new Map(
    scene.lines.map((line, index) => [line.id, index]),
  );
  const nextLines = scene.lines.filter((_line, index) => index !== lineIndex);
  const allowedLineIds = new Set(nextLines.map((line) => line.id));
  const warnings: Warning[] = [];

  const dropCue = (cueId: string): [] => {
    warnings.push({
      path: ["scenes", sceneIndex, "visualCues", cueId],
      code: "cue_removed_after_line_removal",
      message: `行の削除でCueを削除しました: ${cueId}`,
    });
    return [];
  };

  const keepCue = (cueId: string, pruned: ReturnType<typeof pruneCueForLines>): [] | [NonNullable<typeof pruned>] => {
    if (pruned === null) {
      return dropCue(cueId);
    }
    return [pruned];
  };

  const visualCues = scene.visualCues.flatMap((cue) => {
    if (cue.range.kind !== "lines") {
      return keepCue(cue.id, pruneCueForLines(cue, allowedLineIds));
    }
    const start = indexById.get(cue.range.startLineId);
    const end = indexById.get(cue.range.endLineId);
    if (start === undefined || end === undefined) {
      if (
        cue.range.startLineId === deletedId ||
        cue.range.endLineId === deletedId
      ) {
        return dropCue(cue.id);
      }
      return keepCue(cue.id, pruneCueForLines(cue, allowedLineIds));
    }
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    if (lineIndex < low || lineIndex > high) {
      return keepCue(cue.id, pruneCueForLines(cue, allowedLineIds));
    }
    if (low === high) {
      return dropCue(cue.id);
    }
    const adjusted = {
      ...cue,
      range: {
        kind: "lines" as const,
        startLineId:
          lineIndex === low ? scene.lines[low + 1]!.id : scene.lines[low]!.id,
        endLineId:
          lineIndex === high ? scene.lines[high - 1]!.id : scene.lines[high]!.id,
      },
    };
    return keepCue(cue.id, pruneCueForLines(adjusted, allowedLineIds));
  });

  return {
    document: {
      ...withScene(document, sceneIndex, { ...scene, lines: nextLines, visualCues }),
      audioTakes: document.audioTakes.filter(
        (take) => take.narrationSegmentId !== deletedId,
      ),
    },
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: deletedId,
    warnings,
  };
}

export function moveLine(
  document: ContentDocument,
  sceneId: string,
  lineId: string,
  index: number,
): LineEditResult {
  const { scene, sceneIndex } = findPointScene(document, sceneId);
  const from = findLineIndex(scene, lineId);
  const to = clamp(index, 0, scene.lines.length - 1);
  if (from === to) {
    return {
      document,
      sceneIds: [],
      lineIds: [],
      cueIds: [],
      primaryId: lineId,
    };
  }
  const lines = [...scene.lines];
  const [moved] = lines.splice(from, 1);
  if (moved === undefined) {
    throw targetNotFound(["lineId"], `行が見つかりません: ${lineId}`);
  }
  lines.splice(to, 0, moved);
  const indexById = new Map(lines.map((line, entryIndex) => [line.id, entryIndex]));
  const visualCues = scene.visualCues.map((cue) => {
    if (cue.range.kind !== "lines") {
      return cue;
    }
    const start = indexById.get(cue.range.startLineId);
    const end = indexById.get(cue.range.endLineId);
    if (start === undefined || end === undefined || start <= end) {
      return cue;
    }
    return {
      ...cue,
      range: {
        kind: "lines" as const,
        startLineId: cue.range.endLineId,
        endLineId: cue.range.startLineId,
      },
    };
  });
  const next = withScene(document, sceneIndex, { ...scene, lines, visualCues });
  assertFixedSceneCapacity(next, sceneId);
  return {
    document: next,
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: lineId,
  };
}

export function setLineText(
  document: ContentDocument,
  sceneId: string,
  lineId: string,
  captionText: string | undefined,
  speechText: string | undefined,
): LineEditResult {
  const { scene, sceneIndex } = findPointScene(document, sceneId);
  const lineIndex = findLineIndex(scene, lineId);
  const line = { ...scene.lines[lineIndex]! };
  if (captionText !== undefined) {
    line.captionText = captionText;
  }
  if (speechText !== undefined) {
    line.speechText = speechText;
  }
  return {
    document: withScene(
      document,
      sceneIndex,
      replaceLine(scene, lineIndex, line),
    ),
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: lineId,
  };
}

export function setLineSpeaker(
  document: ContentDocument,
  sceneId: string,
  lineId: string,
  speakerId: string | null,
): LineEditResult {
  const { scene, sceneIndex } = findPointScene(document, sceneId);
  const lineIndex = findLineIndex(scene, lineId);
  const line = { ...scene.lines[lineIndex]!, speakerId };
  const speaker = findSpeaker(document, speakerId);
  if (speakerId !== null && speaker === undefined) {
    throw targetNotFound(["speakerId"], `話者が見つかりません: ${speakerId}`);
  }
  if (speakerId === null || isVoiceOnlySpeaker(speaker)) {
    line.expressionId = null;
  }
  return {
    document: withScene(
      document,
      sceneIndex,
      replaceLine(scene, lineIndex, line),
    ),
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: lineId,
  };
}

export function setLineExpression(
  document: ContentDocument,
  sceneId: string,
  lineId: string,
  expressionId: string | null,
): LineEditResult {
  const { scene, sceneIndex } = findPointScene(document, sceneId);
  const lineIndex = findLineIndex(scene, lineId);
  const line = scene.lines[lineIndex]!;
  if (expressionId !== null) {
    if (line.speakerId === null) {
      throw preconditionFailed(
        ["expressionId"],
        NO_SPEAKER_EXPRESSION_MESSAGE,
      );
    }
    const speaker = findSpeaker(document, line.speakerId);
    if (isVoiceOnlySpeaker(speaker)) {
      throw preconditionFailed(
        ["expressionId"],
        VOICE_ONLY_SPEAKER_EXPRESSION_MESSAGE,
      );
    }
  }
  return {
    document: withScene(
      document,
      sceneIndex,
      replaceLine(scene, lineIndex, { ...line, expressionId }),
    ),
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: lineId,
  };
}

export function setLineGap(
  document: ContentDocument,
  sceneId: string,
  lineId: string,
  gapBeforeMs: number,
): LineEditResult {
  const { scene, sceneIndex } = findPointScene(document, sceneId);
  const lineIndex = findLineIndex(scene, lineId);
  const line = { ...scene.lines[lineIndex]! };
  if (gapBeforeMs === 0) {
    delete line.gapBeforeMs;
  } else {
    line.gapBeforeMs = gapBeforeMs;
  }
  const next = withScene(document, sceneIndex, replaceLine(scene, lineIndex, line));
  assertFixedSceneCapacity(next, sceneId);
  return {
    document: next,
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: lineId,
  };
}

export function assignTake(
  document: ContentDocument,
  sceneId: string,
  lineId: string,
  assetId: string,
  source: AudioTake["source"],
  context: ScriptContext,
): LineEditResult {
  const { scene, sceneIndex } = findPointScene(document, sceneId);
  const lineIndex = findLineIndex(scene, lineId);
  const asset = context.assets.get(assetId);
  if (asset === null || asset.status !== "ready") {
    throw preconditionFailed(["assetId"], `readyなAssetが見つかりません: ${assetId}`);
  }
  if (asset.kind !== "audio") {
    throw preconditionFailed(["assetId"], "行へ割り当てられるのはaudio Assetだけです。");
  }
  if (asset.durationMs === null || asset.durationMs <= 0) {
    throw preconditionFailed(["assetId"], "音声の尺が確定していません。");
  }
  const takeId = context.ids.audioTake(
    lineId,
    new Set(document.audioTakes.map((take) => take.id)),
  );
  const take: AudioTake = {
    id: takeId,
    narrationSegmentId: lineId,
    source,
    assetId,
    durationMs: asset.durationMs,
  };
  const next = {
    ...withScene(
      document,
      sceneIndex,
      replaceLine(scene, lineIndex, {
        ...scene.lines[lineIndex]!,
        selectedAudioTakeId: takeId,
      }),
    ),
    audioTakes: [...document.audioTakes, take],
  };
  assertFixedSceneCapacity(next, sceneId);
  return {
    document: next,
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    audioTakeIds: [takeId],
    primaryId: takeId,
  };
}

export function selectTake(
  document: ContentDocument,
  sceneId: string,
  lineId: string,
  takeId: string | null,
): LineEditResult {
  const { scene, sceneIndex } = findPointScene(document, sceneId);
  const lineIndex = findLineIndex(scene, lineId);
  if (takeId !== null) {
    const take = document.audioTakes.find((entry) => entry.id === takeId);
    if (take === undefined || take.narrationSegmentId !== lineId) {
      throw targetNotFound(["takeId"], `行の音声が見つかりません: ${takeId}`);
    }
  }
  const next = withScene(
    document,
    sceneIndex,
    replaceLine(scene, lineIndex, {
      ...scene.lines[lineIndex]!,
      selectedAudioTakeId: takeId,
    }),
  );
  assertFixedSceneCapacity(next, sceneId);
  return {
    document: next,
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: lineId,
  };
}

export function removeTake(
  document: ContentDocument,
  sceneId: string,
  lineId: string,
  takeId: string,
): LineEditResult {
  const { scene, sceneIndex } = findPointScene(document, sceneId);
  const lineIndex = findLineIndex(scene, lineId);
  const take = document.audioTakes.find((entry) => entry.id === takeId);
  if (take === undefined || take.narrationSegmentId !== lineId) {
    throw targetNotFound(["takeId"], `行の音声が見つかりません: ${takeId}`);
  }
  const line = scene.lines[lineIndex]!;
  const nextLine =
    line.selectedAudioTakeId === takeId
      ? { ...line, selectedAudioTakeId: null }
      : line;
  const next = {
    ...withScene(document, sceneIndex, replaceLine(scene, lineIndex, nextLine)),
    audioTakes: document.audioTakes.filter((entry) => entry.id !== takeId),
  };
  assertFixedSceneCapacity(next, sceneId);
  return {
    document: next,
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: lineId,
  };
}
