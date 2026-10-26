import type { SceneFormValue } from "./types";
import { STANDING_TEMPLATE_ID } from "./constants";
import { readStanding } from "./read";
import {
  DEFAULT_SCENE_ACCENT,
  THEME_ACCENT_TOKENS,
  type SceneAccent,
  type TransitionPolicy,
  type TransitionPreset,
  type VisualCue,
} from "@kakeai/contracts";

export function normalizeStandingEnum<T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" &&
    (options as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function normalizeScale(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function buildSceneAccent(sceneValue: SceneFormValue): SceneAccent {
  if (sceneValue.accentKind === "custom") {
    const color = (sceneValue.accentColor ?? "").trim();
    if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
      return { kind: "custom", color: color.toUpperCase() };
    }
  } else if (
    (THEME_ACCENT_TOKENS as readonly string[]).includes(sceneValue.accentToken)
  ) {
    return { kind: "theme", token: sceneValue.accentToken };
  }
  return { ...DEFAULT_SCENE_ACCENT };
}

export function intOrZero(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

interface TransitionEdgesFormValue {
  enterPreset: TransitionPreset;
  enterDurationMs: number;
  exitPreset: TransitionPreset;
  exitDurationMs: number;
}

export function buildTransition(
  transition: TransitionEdgesFormValue,
  policy: TransitionPolicy,
): VisualCue["transition"] {
  const enterPreset = policy.presets.includes(transition.enterPreset)
    ? transition.enterPreset
    : policy.defaultEnter.preset;
  const exitPreset = policy.presets.includes(transition.exitPreset)
    ? transition.exitPreset
    : policy.defaultExit.preset;
  return {
    enter: {
      preset: enterPreset,
      durationMs:
        enterPreset === "none"
          ? 0
          : Math.min(
              policy.maxDurationMs,
              intOrZero(transition.enterDurationMs),
            ),
    },
    exit: {
      preset: exitPreset,
      durationMs:
        exitPreset === "none"
          ? 0
          : Math.min(
              policy.maxDurationMs,
              intOrZero(transition.exitDurationMs),
            ),
    },
  };
}

export function standingReferencesMissing(
  cue: VisualCue,
  characterIds: ReadonlySet<string>,
  appearanceIdsByCharacter: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  if (cue.template.id !== STANDING_TEMPLATE_ID) {
    return false;
  }
  const standing = readStanding(cue);
  if (standing === null) {
    return false;
  }
  const appearanceIds = appearanceIdsByCharacter.get(standing.characterId);
  if (!characterIds.has(standing.characterId) || appearanceIds === undefined) {
    return true;
  }
  return !appearanceIds.has(standing.appearanceId);
}
