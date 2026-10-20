import type { ContentDocument } from "@kakeai/contracts";
import { preconditionFailed } from "./errors.ts";

export function assertFixedSceneCapacity(
  document: ContentDocument,
  sceneId: string,
): void {
  const scene = document.scenes.find((entry) => entry.id === sceneId);
  if (scene === undefined || scene.timing.mode !== "fixed") {
    return;
  }
  const takes = new Map(document.audioTakes.map((take) => [take.id, take]));
  let audioMs = 0;
  for (const line of scene.lines) {
    if (line.selectedAudioTakeId === null) {
      continue;
    }
    const take = takes.get(line.selectedAudioTakeId);
    if (take === undefined || take.narrationSegmentId !== line.id) {
      throw preconditionFailed(
        ["lineId"],
        "選択中の音声が見つからないため固定尺を検証できません。",
      );
    }
    audioMs += take.durationMs;
  }
  const gapMs = scene.lines.reduce(
    (sum, line) => sum + (line.gapBeforeMs ?? 0),
    0,
  );
  if (audioMs + gapMs > scene.timing.durationMs) {
    throw preconditionFailed(
      ["lineId"],
      "音声と間の合計が固定尺を超えています。",
    );
  }
}
