import {
  SCENE_PADDING_MS,
  SILENT_CAPTION_DURATION_MS,
  type ContentDocument,
  type Scene,
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
