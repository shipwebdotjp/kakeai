import { describe, expect, it } from "vitest";
import {
  createInitialContentDocument,
  DEFAULT_SCENE_IDS,
  DEFAULT_TRANSITION_POLICY,
  type ContentDocument,
  type PointScene,
  type VisualCue,
} from "@kakeai/contracts";
import {
  createCueFormValue,
  toFormValues,
} from "../form";
import {
  applyStructuralOperation,
  applyStructuralOperations,
  commitBgmStructural,
  commitCueStructural,
  commitSceneAudioStructural,
  commitStandingStructural,
  copyCueStructural,
  copyStandingsStructural,
  moveCueStructural,
  removeCueStructural,
  transferStandingsStructural,
} from "../structural";

export function pointScene(document: ContentDocument): PointScene {
  const scene = document.scenes.find((entry) => entry.id === DEFAULT_SCENE_IDS.point1);
  if (scene === undefined || scene.kind !== "point") {
    throw new Error("要点Sceneがありません。");
  }
  return scene;
}

export function textCue(range: VisualCue["range"], text: string): VisualCue {
  return {
    id: "cue-text",
    template: { id: "text.block", version: 1 },
    range,
    layer: "overlay",
    order: 10,
    transition: {
      enter: { ...DEFAULT_TRANSITION_POLICY.defaultEnter },
      exit: { ...DEFAULT_TRANSITION_POLICY.defaultExit },
    },
    input: { text, role: "body" },
  };
}

export function lines(document: ContentDocument, ids: string[]): void {
  pointScene(document).lines = ids.map((id) => ({
    id,
    speakerId: null,
    captionText: id,
    speechText: id,
    selectedAudioTakeId: null,
    expressionId: null,
  }));
}
