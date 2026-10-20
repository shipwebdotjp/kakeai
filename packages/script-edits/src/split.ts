import {
  createPointScene,
  defaultPointLabel,
  type ContentDocument,
  type PointScene,
  type VisualCue,
  type Warning,
} from "@kakeai/contracts";
import { resolveTimeline } from "@kakeai/video/timeline";
import type { ScriptContext } from "./context.ts";
import { preconditionFailed, targetNotFound } from "./errors.ts";
import { pruneCueForLines } from "./prune.ts";
import type { SceneEditResult } from "./scene.ts";

function nextPointLabel(document: ContentDocument, insertIndex: number): string {
  const before = document.scenes.slice(1, insertIndex);
  return defaultPointLabel(
    before.filter((scene) => scene.kind === "point").length + 1,
  );
}

function resolveSplitOffsetMs(
  document: ContentDocument,
  sceneId: string,
  lineId: string,
): number {
  let timeline;
  try {
    timeline = resolveTimeline(document);
  } catch {
    throw preconditionFailed(["sceneId"], "Sceneの尺を解決できません。");
  }
  const scene = timeline.scenes.find((entry) => entry.sceneId === sceneId);
  const line = scene?.lines.find((entry) => entry.lineId === lineId);
  if (scene === undefined || line === undefined) {
    throw targetNotFound(["lineId"], `分割位置を解決できません: ${lineId}`);
  }
  const offsetMs = line.startMs - scene.startMs;
  if (offsetMs < 0) {
    throw preconditionFailed(["lineId"], "分割位置を解決できません。");
  }
  return offsetMs;
}

function cueIdSuffix(cue: VisualCue): string {
  return cue.template.id.replace(/\W/g, "-");
}

export function splitPointSceneAtLine(
  document: ContentDocument,
  sceneId: string,
  lineId: string,
  label: string | undefined,
  context: ScriptContext,
): SceneEditResult & { warnings: Warning[] } {
  const sceneIndex = document.scenes.findIndex((scene) => scene.id === sceneId);
  if (sceneIndex === -1) {
    throw targetNotFound(["sceneId"], `Sceneが見つかりません: ${sceneId}`);
  }
  const scene = document.scenes[sceneIndex]!;
  if (scene.kind !== "point") {
    throw preconditionFailed(["sceneId"], "分割できるのは要点Sceneだけです。");
  }
  const splitAt = scene.lines.findIndex((line) => line.id === lineId);
  if (splitAt === -1) {
    throw targetNotFound(["lineId"], `行が見つかりません: ${lineId}`);
  }
  if (splitAt === 0) {
    throw preconditionFailed(["lineId"], "分割点の前後に1行以上必要です。");
  }

  const lines = scene.lines;
  const lineIndexById = new Map(lines.map((line, index) => [line.id, index]));
  const priorCueIds = new Set(
    document.scenes.flatMap((entry) => entry.visualCues.map((cue) => cue.id)),
  );
  const existingCueIds = new Set(priorCueIds);
  const existingSceneIds = new Set(document.scenes.map((entry) => entry.id));
  const secondSceneId = context.ids.scene(existingSceneIds);
  const secondLabel = label?.trim() || nextPointLabel(document, sceneIndex + 1);
  const secondBase = createPointScene(secondSceneId, secondLabel);
  for (const cue of secondBase.visualCues) {
    existingCueIds.add(cue.id);
  }
  const splitOffsetMs = resolveSplitOffsetMs(document, sceneId, lineId);

  const firstCues: VisualCue[] = [];
  const secondCues: VisualCue[] = [...secondBase.visualCues];

  const nextCueId = (cue: VisualCue): string => {
    const id = context.ids.cue(secondSceneId, cueIdSuffix(cue), existingCueIds);
    existingCueIds.add(id);
    return id;
  };

  for (const cue of scene.visualCues) {
    const range = cue.range;
    if (range.kind === "scene") {
      firstCues.push(cue);
      continue;
    }
    if (range.kind === "offset") {
      if (range.endMs <= splitOffsetMs) {
        firstCues.push(cue);
        continue;
      }
      if (range.startMs >= splitOffsetMs) {
        secondCues.push({
          ...cue,
          range: {
            kind: "offset",
            startMs: range.startMs - splitOffsetMs,
            endMs: range.endMs - splitOffsetMs,
          },
        });
        continue;
      }
      firstCues.push({
        ...cue,
        range: { kind: "offset", startMs: range.startMs, endMs: splitOffsetMs },
      });
      secondCues.push({
        ...cue,
        id: nextCueId(cue),
        range: { kind: "offset", startMs: 0, endMs: range.endMs - splitOffsetMs },
      });
      continue;
    }

    const start = lineIndexById.get(range.startLineId);
    const end = lineIndexById.get(range.endLineId);
    if (start === undefined || end === undefined) {
      firstCues.push(cue);
      continue;
    }
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    if (high < splitAt) {
      firstCues.push({
        ...cue,
        range: {
          kind: "lines",
          startLineId: lines[low]!.id,
          endLineId: lines[high]!.id,
        },
      });
      continue;
    }
    if (low >= splitAt) {
      secondCues.push({
        ...cue,
        range: {
          kind: "lines",
          startLineId: lines[low]!.id,
          endLineId: lines[high]!.id,
        },
      });
      continue;
    }
    firstCues.push({
      ...cue,
      range: {
        kind: "lines",
        startLineId: lines[low]!.id,
        endLineId: lines[splitAt - 1]!.id,
      },
    });
    secondCues.push({
      ...cue,
      id: nextCueId(cue),
      range: {
        kind: "lines",
        startLineId: lines[splitAt]!.id,
        endLineId: lines[high]!.id,
      },
    });
  }

  const firstLineIds = new Set(lines.slice(0, splitAt).map((line) => line.id));
  const secondLineIds = new Set(lines.slice(splitAt).map((line) => line.id));
  const warnings: Warning[] = [];
  const firstVisualCues = firstCues.flatMap((cue) => {
    const pruned = pruneCueForLines(cue, firstLineIds);
    if (pruned === null) {
      warnings.push({
        path: ["scenes", sceneIndex, "visualCues", cue.id],
        code: "cue_removed_after_split",
        message: `行参照の剪定でCueを削除しました: ${cue.id}`,
      });
      return [];
    }
    return [pruned];
  });
  const secondVisualCues = secondCues.flatMap((cue) => {
    const pruned = pruneCueForLines(cue, secondLineIds);
    if (pruned === null) {
      warnings.push({
        path: ["scenes", sceneIndex + 1, "visualCues", cue.id],
        code: "cue_removed_after_split",
        message: `行参照の剪定でCueを削除しました: ${cue.id}`,
      });
      return [];
    }
    return [pruned];
  });
  const firstScene: PointScene = {
    ...scene,
    lines: lines.slice(0, splitAt),
    visualCues: firstVisualCues,
  };
  const secondScene: PointScene = {
    ...secondBase,
    accent: { ...scene.accent },
    lines: lines.slice(splitAt),
    visualCues: secondVisualCues,
  };

  const scenes = [...document.scenes];
  scenes[sceneIndex] = firstScene;
  scenes.splice(sceneIndex + 1, 0, secondScene);

  return {
    document: { ...document, scenes },
    sceneIds: [secondSceneId],
    lineIds: [],
    cueIds: secondScene.visualCues
      .map((cue) => cue.id)
      .filter((id) => !priorCueIds.has(id)),
    primaryId: secondSceneId,
    warnings,
  };
}
