import type { SceneFormValue } from "./form";

export interface Diagnostic {
  path?: (string | number)[];
  code?: string;
  message: string;
}

export interface DiagnosticTarget {
  targetId: string;
  seek: {
    kind: "scene" | "cue" | "line";
    id: string;
  };
}

const SCENE_LEVEL_KEYS = new Set([
  "label",
  "kind",
  "accent",
  "accentKind",
  "accentToken",
  "accentColor",
  "timing",
  "timingMode",
  "durationMs",
  "transition",
  "transitionPreset",
  "transitionDurationMs",
]);

export function diagnosticTarget(
  path: (string | number)[] | undefined,
  scenes: SceneFormValue[],
): DiagnosticTarget | null {
  if (!path || path.length < 2 || path[0] !== "scenes" || typeof path[1] !== "number") {
    return null;
  }

  const sceneIndex = path[1];
  const scene = scenes[sceneIndex];
  if (!scene) {
    return null;
  }

  if (path.length === 2) {
    return {
      targetId: `scene-${scene.id}`,
      seek: { kind: "scene", id: scene.id },
    };
  }

  const segment = path[2];
  if (typeof segment === "string" && SCENE_LEVEL_KEYS.has(segment)) {
    return {
      targetId: `scene-${scene.id}`,
      seek: { kind: "scene", id: scene.id },
    };
  }

  if (segment === "lines" && path.length >= 4 && typeof path[3] === "number") {
    const lineIndex = path[3];
    const line = scene.lines[lineIndex];
    if (line) {
      return {
        targetId: `line-${line.id}`,
        seek: { kind: "line", id: line.id },
      };
    }
    return null;
  }

  if (segment === "visualCues" && path.length >= 4 && typeof path[3] === "number") {
    const cueIndex = path[3];
    const cue = scene.cues[cueIndex];
    if (cue) {
      return {
        targetId: `cue-${cue.id}`,
        seek: { kind: "cue", id: cue.id },
      };
    }
    return null;
  }

  return null;
}
