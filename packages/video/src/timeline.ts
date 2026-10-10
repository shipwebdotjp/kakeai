import {
  SCENE_PADDING_MS,
  SILENT_CAPTION_DURATION_MS,
  type ContentDocument,
  type Scene,
  type SceneTransitionPreset,
  type VisualCue,
} from "@kakeai/contracts";
import { CompositionCompileError } from "./compile-error";

export interface TimelineIssue {
  path: (string | number)[];
  code: string;
  message: string;
}

export interface LinePlacement {
  lineId: string;
  startMs: number;
  durationMs: number;
  endMs: number;
}

export interface ScenePlacement {
  sceneId: string;
  sceneIndex: number;
  startMs: number;
  durationMs: number;
  endMs: number;
  lines: LinePlacement[];
}

export interface ResolvedTimeline {
  scenes: ScenePlacement[];
  totalDurationMs: number;
}

function takeDurationById(document: ContentDocument): Map<string, number> {
  return new Map(document.audioTakes.map((take) => [take.id, take.durationMs]));
}

function takeDurationMs(
  takes: Map<string, number>,
  line: { id: string; selectedAudioTakeId: string | null },
  sceneIndex: number,
): number | null {
  if (line.selectedAudioTakeId === null) {
    return null;
  }
  const durationMs = takes.get(line.selectedAudioTakeId);
  if (durationMs === undefined) {
    throw new CompositionCompileError([
      {
        path: ["scenes", sceneIndex],
        code: "unknown_take",
        message: "音声テイクを解決できません。",
      },
    ]);
  }
  return durationMs;
}

function placeAutoLines(
  scene: Scene,
  takes: Map<string, number>,
  sceneStartMs: number,
  sceneIndex: number,
): LinePlacement[] {
  const placements: LinePlacement[] = [];
  let cursor = sceneStartMs + SCENE_PADDING_MS;
  for (const line of scene.lines) {
    const durationMs = takeDurationMs(takes, line, sceneIndex) ?? SILENT_CAPTION_DURATION_MS;
    placements.push({ lineId: line.id, startMs: cursor, durationMs, endMs: cursor + durationMs });
    cursor += durationMs;
  }
  return placements;
}

function placeFixedLines(
  scene: Scene,
  takes: Map<string, number>,
  sceneStartMs: number,
  sceneIndex: number,
): { lines: LinePlacement[]; issues: TimelineIssue[] } {
  if (scene.timing.mode !== "fixed") {
    return { lines: [], issues: [] };
  }
  const durationMs = scene.timing.durationMs;
  const audioTotalMs = scene.lines.reduce(
    (total, line) => total + (takeDurationMs(takes, line, sceneIndex) ?? 0),
    0,
  );
  if (audioTotalMs > durationMs) {
    return {
      lines: [],
      issues: [
        {
          path: ["scenes", sceneIndex, "timing"],
          code: "fixed_duration_overflow",
          message: `選択済み音声の合計尺が固定尺を超えています。`,
        },
      ],
    };
  }
  const silentLines = scene.lines.filter((line) => line.selectedAudioTakeId === null);
  const remainderMs = durationMs - audioTotalMs;
  const baseMs = silentLines.length === 0 ? 0 : Math.floor(remainderMs / silentLines.length);
  let extraMs = silentLines.length === 0 ? 0 : remainderMs % silentLines.length;
  const lines: LinePlacement[] = [];
  let cursor = sceneStartMs;
  for (const line of scene.lines) {
    let lineDurationMs: number;
    if (line.selectedAudioTakeId === null) {
      lineDurationMs = baseMs + (extraMs > 0 ? 1 : 0);
      if (extraMs > 0) {
        extraMs -= 1;
      }
    } else {
      lineDurationMs = takeDurationMs(takes, line, sceneIndex) ?? 0;
    }
    lines.push({ lineId: line.id, startMs: cursor, durationMs: lineDurationMs, endMs: cursor + lineDurationMs });
    cursor += lineDurationMs;
  }
  return { lines, issues: [] };
}

export function resolveTimeline(document: ContentDocument): ResolvedTimeline {
  const takes = takeDurationById(document);
  const scenes: ScenePlacement[] = [];
  let cursor = 0;
  for (const [sceneIndex, scene] of document.scenes.entries()) {
    if (scene.timing.mode === "fixed") {
      const { lines, issues } = placeFixedLines(scene, takes, cursor, sceneIndex);
      if (issues.length > 0) {
        throw new CompositionCompileError(issues);
      }
      const durationMs = scene.timing.durationMs;
      scenes.push({
        sceneId: scene.id,
        sceneIndex,
        startMs: cursor,
        durationMs,
        endMs: cursor + durationMs,
        lines,
      });
      cursor += durationMs;
      continue;
    }
    const lines = placeAutoLines(scene, takes, cursor, sceneIndex);
    const linesTotalMs = lines.reduce((total, line) => total + line.durationMs, 0);
    const durationMs = SCENE_PADDING_MS + linesTotalMs + SCENE_PADDING_MS;
    scenes.push({
      sceneId: scene.id,
      sceneIndex,
      startMs: cursor,
      durationMs,
      endMs: cursor + durationMs,
      lines,
    });
    cursor += durationMs;
  }
  return { scenes, totalDurationMs: cursor };
}

export interface CueWindow {
  startMs: number;
  endMs: number;
}

export function resolveCueWindow(
  placement: ScenePlacement,
  cue: VisualCue,
  cuePath: (string | number)[],
): CueWindow | null {
  switch (cue.range.kind) {
    case "scene":
      return { startMs: 0, endMs: placement.durationMs };
    case "offset": {
      const startMs = Math.max(0, cue.range.startMs);
      const endMs = Math.min(placement.durationMs, cue.range.endMs);
      return startMs < endMs ? { startMs, endMs } : null;
    }
    case "lines": {
      const byId = new Map(placement.lines.map((line) => [line.lineId, line]));
      const start = byId.get(cue.range.startLineId);
      const end = byId.get(cue.range.endLineId);
      if (start === undefined || end === undefined) {
        throw new CompositionCompileError([
          { path: cuePath, code: "unresolvable_range", message: "表示区間を解決できません。" },
        ]);
      }
      const startMs = start.startMs - placement.startMs;
      const endMs = end.endMs - placement.startMs;
      if (endMs <= startMs) {
        throw new CompositionCompileError([
          { path: cuePath, code: "unresolvable_range", message: "表示区間を解決できません。" },
        ]);
      }
      return { startMs, endMs };
    }
    default:
      throw new CompositionCompileError([
        { path: cuePath, code: "unresolvable_range", message: "表示区間を解決できません。" },
      ]);
  }
}

export function cueTransitionTotalMs(cue: VisualCue): number {
  return cue.transition.enter.durationMs + cue.transition.exit.durationMs;
}

export interface ResolvedSceneTransition {
  preset: SceneTransitionPreset;
  durationMs: number;
}

export function sceneTransitionOf(scene: Scene): ResolvedSceneTransition {
  const edge = scene.transition?.enter;
  if (edge === undefined || edge.durationMs === 0) {
    return { preset: "cut", durationMs: 0 };
  }
  return { preset: edge.preset, durationMs: edge.durationMs };
}

export function sceneTransitionOverflowIssue(
  index: number,
  previousDurationMs: number,
  currentDurationMs: number,
  durationMs: number,
): TimelineIssue | undefined {
  const maxMs = Math.min(previousDurationMs, currentDurationMs);
  if (durationMs <= maxMs) {
    return undefined;
  }
  return {
    path: ["scenes", index, "transition", "enter", "durationMs"],
    code: "scene_transition_overflow",
    message: `シーン間トランジションの尺が隣接シーン（最小${maxMs}ms）を超えています。`,
  };
}

function sceneTransitionIssues(
  document: ContentDocument,
  timeline: ResolvedTimeline,
): TimelineIssue[] {
  const issues: TimelineIssue[] = [];
  for (let index = 1; index < timeline.scenes.length; index += 1) {
    const current = timeline.scenes[index];
    const previous = timeline.scenes[index - 1];
    const scene = current === undefined ? undefined : document.scenes[current.sceneIndex];
    if (scene === undefined || current === undefined || previous === undefined) {
      continue;
    }
    const { preset, durationMs } = sceneTransitionOf(scene);
    if (preset === "cut" || durationMs === 0) {
      continue;
    }
    const issue = sceneTransitionOverflowIssue(
      current.sceneIndex,
      previous.durationMs,
      current.durationMs,
      durationMs,
    );
    if (issue !== undefined) {
      issues.push(issue);
    }
  }
  return issues;
}

export function collectSceneTransitionIssues(
  document: ContentDocument,
  timeline: ResolvedTimeline = resolveTimeline(document),
): TimelineIssue[] {
  return sceneTransitionIssues(document, timeline);
}

function cueTransitionIssues(
  document: ContentDocument,
  timeline: ResolvedTimeline,
): TimelineIssue[] {
  const issues: TimelineIssue[] = [];
  for (const placement of timeline.scenes) {
    const scene = document.scenes[placement.sceneIndex];
    if (scene === undefined) {
      continue;
    }
    scene.visualCues.forEach((cue, cueIndex) => {
      const cuePath: (string | number)[] = ["scenes", placement.sceneIndex, "visualCues", cueIndex];
      const window = resolveCueWindow(placement, cue, cuePath);
      if (window === null) {
        return;
      }
      const span = window.endMs - window.startMs;
      if (cueTransitionTotalMs(cue) > span) {
        issues.push({
          path: cuePath,
          code: "transition_range_overflow",
          message: `transition の合計尺がCue範囲（${span}ms）を超えています。`,
        });
      }
    });
  }
  return issues;
}

export function collectCueTransitionIssues(
  document: ContentDocument,
  timeline: ResolvedTimeline = resolveTimeline(document),
): TimelineIssue[] {
  return cueTransitionIssues(document, timeline);
}

export function collectTimelineIssues(document: ContentDocument): TimelineIssue[] {
  const timeline = resolveTimeline(document);
  return [
    ...cueTransitionIssues(document, timeline),
    ...sceneTransitionIssues(document, timeline),
  ];
}
