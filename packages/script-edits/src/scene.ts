import {
  createInsertScene,
  createPointScene,
  defaultInsertLabel,
  defaultPointLabel,
  type ContentDocument,
  type PointScene,
  type Scene,
  type SceneAccent,
  type SceneTiming,
  type SceneTransitionEdge,
  type SceneAddInsertOperation,
  type SceneAddPointOperation,
} from "@kakeai/contracts";
import { resolveTimeline } from "@kakeai/video/timeline";
import type { ScriptContext } from "./context.ts";
import { invalidOperation, preconditionFailed, targetNotFound } from "./errors.ts";
import { assertNewLineSpeaker, createLine } from "./line-utils.ts";

export interface SceneEditResult {
  document: ContentDocument;
  sceneIds: string[];
  lineIds: string[];
  cueIds: string[];
  primaryId: string;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

function findSceneIndex(document: ContentDocument, sceneId: string): number {
  const index = document.scenes.findIndex((scene) => scene.id === sceneId);
  if (index === -1) {
    throw targetNotFound(["sceneId"], `Sceneが見つかりません: ${sceneId}`);
  }
  return index;
}

function replaceScene(
  document: ContentDocument,
  sceneId: string,
  update: (scene: Scene) => Scene,
): ContentDocument {
  const index = findSceneIndex(document, sceneId);
  const scene = document.scenes[index]!;
  const scenes = [...document.scenes];
  scenes[index] = update(scene);
  return { ...document, scenes };
}

function assertFraming(document: ContentDocument): void {
  const first = document.scenes[0];
  const last = document.scenes[document.scenes.length - 1];
  if (
    document.scenes.length < 2 ||
    first === undefined ||
    first.kind !== "intro" ||
    last === undefined ||
    last.kind !== "outro"
  ) {
    throw preconditionFailed([], "Sceneは導入で始まり結びで終わる必要があります。");
  }
}

function insertMiddleScene(
  document: ContentDocument,
  scene: Scene,
  requestedIndex: number | undefined,
): ContentDocument {
  assertFraming(document);
  const lastIndex = document.scenes.length - 1;
  const at = clamp(requestedIndex ?? lastIndex, 1, lastIndex);
  const scenes = [
    ...document.scenes.slice(0, at),
    scene,
    ...document.scenes.slice(at),
  ];
  return { ...document, scenes };
}

function nextLabel(
  document: ContentDocument,
  requestedIndex: number | undefined,
  kind: "point" | "insert",
): string {
  const lastIndex = document.scenes.length - 1;
  const at = clamp(requestedIndex ?? lastIndex, 1, lastIndex);
  const before = document.scenes.slice(1, at);
  const ordinal = before.filter((scene) => scene.kind === kind).length + 1;
  return kind === "point" ? defaultPointLabel(ordinal) : defaultInsertLabel(ordinal);
}

function requireVideoAsset(
  assetId: string,
  durationMs: number,
  embeddedAudio: boolean,
  context: ScriptContext,
): void {
  const asset = context.assets.get(assetId);
  if (asset === null || asset.status !== "ready") {
    throw preconditionFailed(["assetId"], `readyなAssetが見つかりません: ${assetId}`);
  }
  if (asset.kind !== "video") {
    throw preconditionFailed(["assetId"], "insert Sceneはvideo Assetだけを参照できます。");
  }
  if (asset.durationMs === null) {
    throw preconditionFailed(["assetId"], "動画の尺が確定していません。");
  }
  if (asset.durationMs !== durationMs) {
    throw preconditionFailed(
      ["durationMs"],
      "insert Sceneの尺は使用区間の尺と一致する必要があります。",
    );
  }
  if (embeddedAudio && !asset.hasAudio) {
    throw preconditionFailed(
      ["embeddedAudio"],
      "音声のないAssetはembeddedAudio: trueで使えません。",
    );
  }
}

export function addPointScene(
  document: ContentDocument,
  operation: SceneAddPointOperation,
  context: ScriptContext,
): SceneEditResult {
  const sceneIds = new Set(document.scenes.map((scene) => scene.id));
  const existingLines = new Set(
    document.scenes.flatMap((scene) => scene.lines.map((line) => line.id)),
  );
  const sceneId = context.ids.scene(sceneIds);
  const label = operation.label?.trim() || nextLabel(document, operation.index, "point");
  const scene: PointScene = createPointScene(sceneId, label);
  const lines = (operation.lines ?? []).map((input) => {
    assertNewLineSpeaker(document, input);
    return createLine(sceneId, input, context, existingLines);
  });
  const withLines: PointScene = { ...scene, lines };
  return {
    document: insertMiddleScene(document, withLines, operation.index),
    sceneIds: [sceneId],
    lineIds: lines.map((line) => line.id),
    cueIds: withLines.visualCues.map((cue) => cue.id),
    primaryId: sceneId,
  };
}

export function addInsertScene(
  document: ContentDocument,
  operation: SceneAddInsertOperation,
  context: ScriptContext,
): SceneEditResult {
  const assetId = operation.assetId;
  const sceneIds = new Set(document.scenes.map((scene) => scene.id));
  const sceneId = context.ids.scene(sceneIds);
  const label = operation.label?.trim() || nextLabel(document, operation.index, "insert");
  requireVideoAsset(
    assetId,
    operation.durationMs,
    operation.embeddedAudio ?? true,
    context,
  );
  const scene = createInsertScene(
    sceneId,
    label,
    assetId,
    operation.durationMs,
    operation.embeddedAudio ?? true,
  );
  return {
    document: insertMiddleScene(document, scene, operation.index),
    sceneIds: [sceneId],
    lineIds: [],
    cueIds: scene.visualCues.map((cue) => cue.id),
    primaryId: sceneId,
  };
}

export function removeScene(document: ContentDocument, sceneId: string): SceneEditResult {
  const index = findSceneIndex(document, sceneId);
  const scene = document.scenes[index]!;
  if (scene.kind === "intro" || scene.kind === "outro") {
    throw preconditionFailed(["sceneId"], "導入と結びは削除できません。");
  }
  const lineIds = new Set(scene.lines.map((line) => line.id));
  return {
    document: {
      ...document,
      scenes: document.scenes.filter((entry) => entry.id !== sceneId),
      audioTakes: document.audioTakes.filter(
        (take) => !lineIds.has(take.narrationSegmentId),
      ),
      audioCues: document.audioCues.filter(
        (cue) => !(cue.range.kind === "scene" && cue.range.sceneId === sceneId),
      ),
    },
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: sceneId,
  };
}

export function moveScene(
  document: ContentDocument,
  sceneId: string,
  index: number,
): SceneEditResult {
  const from = findSceneIndex(document, sceneId);
  const scene = document.scenes[from]!;
  if (scene.kind === "intro" || scene.kind === "outro") {
    throw preconditionFailed(["sceneId"], "導入と結びは移動できません。");
  }
  const to = clamp(index, 1, document.scenes.length - 2);
  if (to === from) {
    return { document, sceneIds: [], lineIds: [], cueIds: [], primaryId: sceneId };
  }
  const scenes = [...document.scenes];
  const [moved] = scenes.splice(from, 1);
  if (moved === undefined) {
    throw targetNotFound(["sceneId"], `Sceneが見つかりません: ${sceneId}`);
  }
  scenes.splice(to, 0, moved);
  return {
    document: { ...document, scenes },
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: sceneId,
  };
}

export function setSceneLabel(
  document: ContentDocument,
  sceneId: string,
  label: string,
): SceneEditResult {
  const trimmed = label.trim();
  if (trimmed.length === 0) {
    throw invalidOperation(["label"], "Sceneの名称は必須です。");
  }
  return {
    document: replaceScene(document, sceneId, (scene) => ({ ...scene, label: trimmed })),
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: sceneId,
  };
}

export function setSceneAccent(
  document: ContentDocument,
  sceneId: string,
  accent: SceneAccent,
): SceneEditResult {
  return {
    document: replaceScene(document, sceneId, (scene) => ({ ...scene, accent })),
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: sceneId,
  };
}

function withTiming(scene: Scene, timing: SceneTiming): Scene {
  if (scene.kind === "insert" || scene.kind === "intro" || scene.kind === "outro") {
    if (timing.mode !== "fixed") {
      throw preconditionFailed(["timing"], "このSceneは固定尺だけを使えます。");
    }
    return { ...scene, timing };
  }
  return { ...scene, timing };
}

export function setSceneTiming(
  document: ContentDocument,
  sceneId: string,
  timing: SceneTiming,
): SceneEditResult {
  const index = findSceneIndex(document, sceneId);
  const scene = document.scenes[index]!;
  if (scene.kind === "insert") {
    if (timing.mode !== "fixed" || timing.durationMs !== scene.timing.durationMs) {
      throw preconditionFailed(
        ["timing"],
        "insert Sceneの尺は主動画の使用区間と一致させる必要があります。",
      );
    }
  } else if (scene.kind === "intro" || scene.kind === "outro") {
    if (timing.mode !== "fixed") {
      throw preconditionFailed(["timing"], "導入と結びは固定尺だけを使えます。");
    }
  } else if (timing.mode === "fixed") {
    const takes = new Map(document.audioTakes.map((take) => [take.id, take]));
    let audioMs = 0;
    for (const line of scene.lines) {
      if (line.selectedAudioTakeId === null) {
        continue;
      }
      const take = takes.get(line.selectedAudioTakeId);
      if (take === undefined || take.narrationSegmentId !== line.id) {
        throw preconditionFailed(
          ["timing"],
          "選択中の音声が見つからないため固定尺を検証できません。",
        );
      }
      audioMs += take.durationMs;
    }
    const gapMs = scene.lines.reduce((sum, line) => sum + (line.gapBeforeMs ?? 0), 0);
    if (audioMs + gapMs > timing.durationMs) {
      throw preconditionFailed(
        ["timing"],
        "音声と間の合計が固定尺を超えています。",
      );
    }
  }
  return {
    document: replaceScene(document, sceneId, (entry) => withTiming(entry, timing)),
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: sceneId,
  };
}

export function setSceneTransition(
  document: ContentDocument,
  sceneId: string,
  enter: SceneTransitionEdge,
): SceneEditResult {
  const index = findSceneIndex(document, sceneId);
  if (index === 0 && enter.durationMs !== 0) {
    throw preconditionFailed(["enter"], "先頭Sceneのトランジションは尺0に限ります。");
  }
  let timeline;
  try {
    timeline = resolveTimeline(document);
  } catch {
    throw preconditionFailed(["enter"], "Sceneの尺を解決できません。");
  }
  const current = timeline.scenes[index];
  const previous = timeline.scenes[index - 1];
  if (current === undefined) {
    throw targetNotFound(["sceneId"], `Sceneが見つかりません: ${sceneId}`);
  }
  const limit = previous === undefined ? 0 : Math.min(current.durationMs, previous.durationMs);
  if (enter.durationMs > limit) {
    throw preconditionFailed(
      ["enter"],
      "トランジションの尺が前後のScene尺を超えています。",
    );
  }
  return {
    document: replaceScene(document, sceneId, (scene) => ({
      ...scene,
      transition: { enter },
    })),
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: sceneId,
  };
}
