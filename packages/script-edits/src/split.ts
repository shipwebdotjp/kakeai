import {
  characterStandingV1,
  characterStandingV1InputSchema,
  createPointScene,
  defaultPointLabel,
  type ContentDocument,
  type PointScene,
  type StandingLayout,
  type StandingSide,
  type StandingState,
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

interface CarriedStanding {
  side: StandingSide;
  characterId: string;
  appearanceId: string;
  layout: Partial<StandingLayout>;
}

function sceneStandingCue(
  scene: ContentDocument["scenes"][number],
  side: StandingSide,
): { cue: VisualCue; input: Record<string, unknown> } | null {
  for (const cue of scene.visualCues) {
    if (
      cue.template.id !== characterStandingV1.id ||
      cue.template.version !== characterStandingV1.version ||
      cue.range.kind !== "scene"
    ) {
      continue;
    }
    const parsed = characterStandingV1InputSchema.safeParse(cue.input);
    if (parsed.success && parsed.data.side === side) {
      return { cue, input: parsed.data as Record<string, unknown> };
    }
  }
  return null;
}

/**
 * The state that becomes the new scene's opening state at the split.
 * Returns the carried states per side plus a standing cue for each side that
 * is visible at the split. A scene without standing states still carries the
 * base standing cue, so splitting does not silently hide a character.
 */
function carryStandingStates(
  scene: ContentDocument["scenes"][number],
  splitAt: number,
  secondSceneId: string,
  context: ScriptContext,
  existingCueIds: Set<string>,
): {
  cues: VisualCue[];
  carried: Map<StandingSide, { characterId: string | null; appearanceId: string | null }>;
} {
  const states = scene.standingStates ?? [];
  const indexById = new Map(scene.lines.map((line, index) => [line.id, index]));
  const cues: VisualCue[] = [];
  const carried = new Map<
    StandingSide,
    { characterId: string | null; appearanceId: string | null }
  >();
  for (const side of ["left", "right"] as const) {
    const lastState = states
      .filter(
        (state) =>
          state.side === side &&
          (indexById.get(state.fromLineId) ?? Number.POSITIVE_INFINITY) <=
            splitAt,
      )
      .sort(
        (left, right) =>
          (indexById.get(left.fromLineId) ?? 0) -
          (indexById.get(right.fromLineId) ?? 0),
      )
      .at(-1);
    let resolved: CarriedStanding | null = null;
    if (lastState !== undefined) {
      if (lastState.characterId !== null && lastState.appearanceId !== null) {
        resolved = {
          side,
          characterId: lastState.characterId,
          appearanceId: lastState.appearanceId,
          // A state segment never carries a layout override; the look comes
          // from the appearance's Standing Layout, so the new scene's opening
          // state must use the same defaults rather than the old base override.
          layout: {},
        };
      }
    } else {
      const base = sceneStandingCue(scene, side);
      if (base !== null) {
        const characterId = base.input.characterId;
        const appearanceId = base.input.appearanceId;
        if (typeof characterId === "string" && typeof appearanceId === "string") {
          resolved = {
            side,
            characterId,
            appearanceId,
            layout: {
              ...(typeof base.input.scale === "number"
                ? { scale: base.input.scale }
                : {}),
              ...(base.input.edge === "tight" ||
              base.input.edge === "margin" ||
              base.input.edge === "center"
                ? { edge: base.input.edge }
                : {}),
              ...(base.input.vertical === "up" ||
              base.input.vertical === "standard" ||
              base.input.vertical === "down"
                ? { vertical: base.input.vertical }
                : {}),
            },
          };
        }
      }
    }
    carried.set(side, {
      characterId: resolved?.characterId ?? null,
      appearanceId: resolved?.appearanceId ?? null,
    });
    if (resolved === null) {
      continue;
    }
    const id = context.ids.cue(secondSceneId, `standing-${side}`, existingCueIds);
    existingCueIds.add(id);
    cues.push({
      id,
      template: {
        id: characterStandingV1.id,
        version: characterStandingV1.version,
      },
      range: { kind: "scene" },
      layer: "standing",
      order: cues.length,
      transition: {
        enter: { preset: "none", durationMs: 0 },
        exit: { preset: "none", durationMs: 0 },
      },
      input: {
        characterId: resolved.characterId,
        appearanceId: resolved.appearanceId,
        side,
        ...resolved.layout,
      },
    });
  }
  return { cues, carried };
}

function sameCarriedState(
  state: StandingState,
  carried: { characterId: string | null; appearanceId: string | null } | undefined,
): boolean {
  return (
    carried !== undefined &&
    state.characterId === carried.characterId &&
    state.appearanceId === carried.appearanceId
  );
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
  const splitLineId = lines[splitAt]!.id;
  const { cues: carriedCues, carried } = carryStandingStates(
    scene,
    splitAt,
    secondSceneId,
    context,
    existingCueIds,
  );
  const allStates = scene.standingStates ?? [];
  const firstStates = allStates.filter(
    (state) => (lineIndexById.get(state.fromLineId) ?? Number.POSITIVE_INFINITY) < splitAt,
  );
  const secondStates = allStates.filter(
    (state) =>
      (lineIndexById.get(state.fromLineId) ?? Number.NEGATIVE_INFINITY) >=
        splitAt &&
      !(
        state.fromLineId === splitLineId &&
        sameCarriedState(state, carried.get(state.side))
      ),
  );

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
    ...(firstStates.length === 0
      ? { standingStates: undefined }
      : { standingStates: firstStates }),
  };
  const secondScene: PointScene = {
    ...secondBase,
    accent: { ...scene.accent },
    lines: lines.slice(splitAt),
    visualCues: [...secondVisualCues, ...carriedCues],
    ...(secondStates.length === 0
      ? { standingStates: undefined }
      : { standingStates: secondStates }),
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
