import type { ContentDocument, PointScene, VisualCue } from "@kakeai/contracts";

export const transition = {
  enter: { preset: "fade", durationMs: 350 },
  exit: { preset: "none", durationMs: 0 },
} as const;

export function vc(partial: Partial<VisualCue> & Pick<VisualCue, "id" | "template" | "input">): VisualCue {
  return {
    range: { kind: "scene" },
    layer: "background",
    order: 0,
    transition,
    ...partial,
  } as VisualCue;
}

export function pointScenes(document: ContentDocument): PointScene[] {
  return document.scenes.filter((scene): scene is PointScene => scene.kind === "point");
}

export function sceneTextCue(scene: { visualCues: VisualCue[] }, role: string): VisualCue | undefined {
  return scene.visualCues.find((cue) => (cue.input as { role?: string }).role === role);
}

export function setSceneText(scene: { visualCues: VisualCue[] }, role: string, text: string): void {
  const cue = sceneTextCue(scene, role);
  if (cue !== undefined) {
    (cue.input as { text: string }).text = text;
  }
}

export function readSceneText(scene: { visualCues: VisualCue[] }, role: string): string {
  const input = sceneTextCue(scene, role)?.input as { text?: string } | undefined;
  return input?.text ?? "";
}

export function standingInput(cue: { input: unknown }): {
  characterId: string;
  appearanceId: string;
  side: "left" | "right";
  scale: number;
  edge: string;
  vertical: string;
} {
  return cue.input as {
    characterId: string;
    appearanceId: string;
    side: "left" | "right";
    scale: number;
    edge: string;
    vertical: string;
  };
}

export function standingCue(id: string, side: "left" | "right", scale = 1): VisualCue {
  return vc({
    id,
    template: { id: "character.standing", version: 1 },
    layer: "standing",
    input: {
      characterId: "character-rin",
      appearanceId: "appearance-smile",
      side,
      scale,
      edge: "margin",
      vertical: "standard",
    },
  });
}
