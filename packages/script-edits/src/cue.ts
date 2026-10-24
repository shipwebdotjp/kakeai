import {
  characterStandingV1,
  collectLineReferences,
  getVisualTemplate,
  visualCueSchema,
  type ContentDocument,
  type CueLayer,
  type Scene,
  type VisualCue,
  type VisualCueRange,
  type Warning,
} from "@kakeai/contracts";
import { collectOffsetRangeWarnings, CompositionCompileError } from "@kakeai/video/timeline";
import type { ScriptContext } from "./context.ts";
import {
  invalidOperation,
  preconditionFailed,
  SCRIPT_EDIT_ERROR_CODES,
  ScriptEditError,
  targetNotFound,
} from "./errors.ts";
import { withScene } from "./line-utils.ts";
import type { SceneEditResult } from "./scene.ts";

export interface CueEditResult extends SceneEditResult {
  audioCueIds?: string[];
  warnings?: Warning[];
}

export interface EditableSceneLocation {
  scene: Scene;
  sceneIndex: number;
}

export function findEditableScene(
  document: ContentDocument,
  sceneId: string,
): EditableSceneLocation {
  const sceneIndex = document.scenes.findIndex((scene) => scene.id === sceneId);
  if (sceneIndex === -1) {
    throw targetNotFound(["sceneId"], `Sceneが見つかりません: ${sceneId}`);
  }
  const scene = document.scenes[sceneIndex]!;
  if (scene.kind === "insert") {
    throw preconditionFailed(
      ["sceneId"],
      "insert Sceneの主動画Cueは操作できません。",
    );
  }
  return { scene, sceneIndex };
}

export function findCue(scene: Scene, cueId: string): VisualCue {
  const cue = scene.visualCues.find((entry) => entry.id === cueId);
  if (cue === undefined) {
    throw targetNotFound(["cueId"], `Cueが見つかりません: ${cueId}`);
  }
  return cue;
}

export function parseCue(cue: VisualCue): VisualCue {
  const parsed = visualCueSchema.safeParse(cue);
  if (!parsed.success) {
    throw new ScriptEditError(
      SCRIPT_EDIT_ERROR_CODES.INVALID_INPUT,
      parsed.error.issues.map((issue) => ({
        path: issue.path.filter(
          (segment): segment is string | number =>
            typeof segment === "string" || typeof segment === "number",
        ),
        code: "invalid_input",
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

function normalizeRange(range: VisualCueRange, scene: Scene): VisualCueRange {
  if (range.kind === "lines") {
    const start = scene.lines.findIndex((line) => line.id === range.startLineId);
    const end = scene.lines.findIndex((line) => line.id === range.endLineId);
    if (start === -1 || end === -1) {
      throw invalidOperation(
        ["range"],
        "Cueの範囲は同一Scene内の行を指定してください。",
      );
    }
    if (start > end) {
      throw invalidOperation(
        ["range"],
        "Cueの範囲は開始行が終了行より前である必要があります。",
      );
    }
    return range;
  }
  if (range.kind === "offset" && range.startMs >= range.endMs) {
    throw invalidOperation(["range"], "offset範囲は startMs < endMs が必要です。");
  }
  return range;
}

function nextOrder(scene: Scene, layer: CueLayer): number {
  return (
    scene.visualCues
      .filter((cue) => cue.layer === layer)
      .reduce((max, cue) => Math.max(max, cue.order), -1) + 1
  );
}

function assertOrderAvailable(
  scene: Scene,
  layer: CueLayer,
  order: number,
  exceptCueId: string | null,
): void {
  const collision = scene.visualCues.find(
    (cue) =>
      cue.layer === layer && cue.order === order && cue.id !== exceptCueId,
  );
  if (collision !== undefined) {
    throw preconditionFailed(
      ["order"],
      `${layer}レイヤーのorder ${order}は既に使われています。`,
    );
  }
}

function assertCueLineReferences(
  document: ContentDocument,
  sceneId: string,
): void {
  const scene = document.scenes.find((entry) => entry.id === sceneId);
  if (scene === undefined) {
    return;
  }
  const allowed = new Set(scene.lines.map((line) => line.id));
  for (const reference of collectLineReferences(document)) {
    if (reference.sceneId === sceneId && !allowed.has(reference.lineId)) {
      throw invalidOperation(
        reference.path,
        `Cueの行参照が同一Scene内にありません: ${reference.lineId}`,
      );
    }
  }
}

function offsetWarnings(
  document: ContentDocument,
  sceneIndex: number,
): Warning[] {  try {
    return collectOffsetRangeWarnings(document).filter(
      (warning) =>
        warning.path[0] === "scenes" && warning.path[1] === sceneIndex,
    );
  } catch (error) {
    if (error instanceof CompositionCompileError) {
      throw preconditionFailed(["sceneId"], "Sceneの尺を解決できません。");
    }
    throw error;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeInput(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return patch;
  }
  const next: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = base[key];
    next[key] =
      isPlainObject(current) && isPlainObject(value)
        ? mergeInput(current, value)
        : value;
  }
  return next;
}

export interface CueAddInput {
  template: VisualCue["template"];
  range: VisualCueRange;
  layer: CueLayer;
  order?: number;
  transition?: VisualCue["transition"];
  input: unknown;
}

export function addCue(
  document: ContentDocument,
  sceneId: string,
  input: CueAddInput,
  context: ScriptContext,
): CueEditResult {
  const { scene, sceneIndex } = findEditableScene(document, sceneId);
  const definition = getVisualTemplate(
    input.template.id,
    input.template.version,
  );
  if (definition === undefined) {
    throw new ScriptEditError(SCRIPT_EDIT_ERROR_CODES.UNSUPPORTED_TEMPLATE, [
      {
        path: ["template"],
        code: "unsupported_template",
        message: `未対応のVisualTemplateです: ${input.template.id}@${input.template.version}`,
      },
    ]);
  }
  if (!definition.layers.includes(input.layer)) {
    throw invalidOperation(
      ["layer"],
      `${input.template.id}@${input.template.version} は ${input.layer} レイヤーに置けません。`,
    );
  }
  const range = normalizeRange(input.range, scene);
  const order = input.order ?? nextOrder(scene, input.layer);
  if (input.order !== undefined) {
    assertOrderAvailable(scene, input.layer, order, null);
  }
  const transition = input.transition ?? {
    enter: { ...definition.transitionPolicy.defaultEnter },
    exit: { ...definition.transitionPolicy.defaultExit },
  };
  const existingIds = new Set(
    document.scenes.flatMap((entry) =>
      entry.visualCues.map((cue) => cue.id),
    ),
  );
  const cueId = context.ids.cue(
    sceneId,
    input.template.id.replace(/\W/g, "-"),
    existingIds,
  );
  const cue = parseCue({
    id: cueId,
    template: input.template,
    range,
    layer: input.layer,
    order,
    transition,
    input: input.input,
  });
  const next = withScene(document, sceneIndex, {
    ...scene,
    visualCues: [...scene.visualCues, cue],
  });
  assertCueLineReferences(next, sceneId);
  return {
    document: next,
    sceneIds: [],
    lineIds: [],
    cueIds: [cueId],
    primaryId: cueId,
    warnings: offsetWarnings(next, sceneIndex),
  };
}

export function removeCue(
  document: ContentDocument,
  sceneId: string,
  cueId: string,
): CueEditResult {
  const { scene, sceneIndex } = findEditableScene(document, sceneId);
  findCue(scene, cueId);
  const next = withScene(document, sceneIndex, {
    ...scene,
    visualCues: scene.visualCues.filter((cue) => cue.id !== cueId),
  });
  return {
    document: next,
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: cueId,
  };
}

export function setCueRange(
  document: ContentDocument,
  sceneId: string,
  cueId: string,
  range: VisualCueRange,
): CueEditResult {
  const { scene, sceneIndex } = findEditableScene(document, sceneId);
  const cue = findCue(scene, cueId);
  const nextCue = parseCue({ ...cue, range: normalizeRange(range, scene) });
  const next = withScene(document, sceneIndex, {
    ...scene,
    visualCues: scene.visualCues.map((entry) =>
      entry.id === cueId ? nextCue : entry,
    ),
  });
  return {
    document: next,
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: cueId,
    warnings: offsetWarnings(next, sceneIndex),
  };
}

export function setCueInput(
  document: ContentDocument,
  sceneId: string,
  cueId: string,
  patch: unknown,
  replace = false,
): CueEditResult {
  const { scene, sceneIndex } = findEditableScene(document, sceneId);
  const cue = findCue(scene, cueId);
  const input = replace ? patch : mergeInput(cue.input, patch);
  const nextCue = parseCue({ ...cue, input });
  const next = withScene(document, sceneIndex, {
    ...scene,
    visualCues: scene.visualCues.map((entry) =>
      entry.id === cueId ? nextCue : entry,
    ),
  });
  assertCueLineReferences(next, sceneId);
  return {
    document: next,
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: cueId,
  };
}

export function setCuePlacement(
  document: ContentDocument,
  sceneId: string,
  cueId: string,
  layer: CueLayer,
  order: number,
): CueEditResult {
  const { scene, sceneIndex } = findEditableScene(document, sceneId);
  const cue = findCue(scene, cueId);
  const definition = getVisualTemplate(cue.template.id, cue.template.version);
  if (definition === undefined) {
    throw new ScriptEditError(SCRIPT_EDIT_ERROR_CODES.UNSUPPORTED_TEMPLATE, [
      {
        path: ["cueId"],
        code: "unsupported_template",
        message: `未対応のVisualTemplateです: ${cue.template.id}@${cue.template.version}`,
      },
    ]);
  }
  if (!definition.layers.includes(layer)) {
    throw invalidOperation(
      ["layer"],
      `${cue.template.id}@${cue.template.version} は ${layer} レイヤーに置けません。`,
    );
  }
  assertOrderAvailable(scene, layer, order, cueId);
  const nextCue = parseCue({ ...cue, layer, order });
  return {
    document: withScene(document, sceneIndex, {
      ...scene,
      visualCues: scene.visualCues.map((entry) =>
        entry.id === cueId ? nextCue : entry,
      ),
    }),
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: cueId,
  };
}

export function setCueTransition(
  document: ContentDocument,
  sceneId: string,
  cueId: string,
  enter: VisualCue["transition"]["enter"] | undefined,
  exit: VisualCue["transition"]["exit"] | undefined,
): CueEditResult {
  const { scene, sceneIndex } = findEditableScene(document, sceneId);
  const cue = findCue(scene, cueId);
  const nextCue = parseCue({
    ...cue,
    transition: {
      enter: enter ?? cue.transition.enter,
      exit: exit ?? cue.transition.exit,
    },
  });
  return {
    document: withScene(document, sceneIndex, {
      ...scene,
      visualCues: scene.visualCues.map((entry) =>
        entry.id === cueId ? nextCue : entry,
      ),
    }),
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: cueId,
  };
}

const STANDING_TEMPLATE_ID = characterStandingV1.id;

function cloneJson<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Sceneをまたぐ行参照を初期化する。`range: lines` は `range: scene` へ戻し、
 * 入力ツリー内の `{ kind: "lines" }` トリガーは `{ kind: "cue" }` へ置換する。
 * `videoPlayback` は `gates` が必須（min(1)）のため、ゲート設定ごと削除する
 * しかない。何かを変更したら true を返す。
 */
function resetCrossSceneRefs(cue: VisualCue): { cue: VisualCue; reset: boolean } {
  let reset = false;
  let range = cue.range;
  if (range.kind === "lines") {
    range = { kind: "scene" };
    reset = true;
  }
  const input = cloneJson(cue.input);
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        walk(entry);
      }
      return;
    }
    if (typeof value !== "object" || value === null) {
      return;
    }
    const record = value as Record<string, unknown>;
    const trigger = record.trigger;
    if (
      typeof trigger === "object" &&
      trigger !== null &&
      !Array.isArray(trigger) &&
      (trigger as Record<string, unknown>).kind === "lines"
    ) {
      record.trigger = { kind: "cue" };
      reset = true;
    }
    const playback = record.videoPlayback;
    if (
      typeof playback === "object" &&
      playback !== null &&
      !Array.isArray(playback) &&
      Array.isArray((playback as Record<string, unknown>).gates)
    ) {
      delete record.videoPlayback;
      reset = true;
    }
    for (const child of Object.values(record)) {
      walk(child);
    }
  };
  walk(input);
  if (!reset) {
    return { cue, reset: false };
  }
  return { cue: parseCue({ ...cue, range, input }), reset: true };
}

function resetWarning(sceneIndex: number, cueIndex: number): Warning {
  return {
    path: ["scenes", sceneIndex, "visualCues", cueIndex],
    code: "cue_line_refs_reset",
    message:
      "Sceneをまたぐ移動・複製のため、表示区間をScene全体へ戻し、セリフ同期のトリガーをScene全体へ変更しました。動画のセリフゲート再生の設定も外しました。移動先・複製先で選び直してください。",
  };
}

/**
 * Cueを宛先Sceneの同一レイヤー末尾へ移設する共通パイプライン。
 * 追加前の `visualCues.length` が新しいCueの配列indexになる。
 */
function relocateCue(
  document: ContentDocument,
  toSceneId: string,
  cue: VisualCue,
): { document: ContentDocument; warnings: Warning[] } {
  const targetIndex = document.scenes.findIndex(
    (entry) => entry.id === toSceneId,
  );
  const targetScene = document.scenes[targetIndex]!;
  const order = nextOrder(targetScene, cue.layer);
  const relocated = resetCrossSceneRefs({ ...cue, order });
  const cueIndex = targetScene.visualCues.length;
  const next = withScene(document, targetIndex, {
    ...targetScene,
    visualCues: [...targetScene.visualCues, relocated.cue],
  });
  assertCueLineReferences(next, toSceneId);
  return {
    document: next,
    warnings: [
      ...offsetWarnings(next, targetIndex),
      ...(relocated.reset ? [resetWarning(targetIndex, cueIndex)] : []),
    ],
  };
}

function assertMovableCue(scene: Scene, cueId: string): VisualCue {
  const cue = findCue(scene, cueId);
  if (cue.template.id === STANDING_TEMPLATE_ID) {
    throw invalidOperation(
      ["cueId"],
      "立ち絵Cueは立ち絵の操作で移動・複製してください。",
    );
  }
  return cue;
}

export function moveCue(
  document: ContentDocument,
  sceneId: string,
  cueId: string,
  toSceneId: string,
): CueEditResult {
  if (sceneId === toSceneId) {
    throw invalidOperation(
      ["toSceneId"],
      "移動先には異なるSceneを指定してください。",
    );
  }
  const { scene, sceneIndex } = findEditableScene(document, sceneId);
  const cue = assertMovableCue(scene, cueId);
  findEditableScene(document, toSceneId);
  const withoutSource = withScene(document, sceneIndex, {
    ...scene,
    visualCues: scene.visualCues.filter((entry) => entry.id !== cueId),
  });
  const relocated = relocateCue(withoutSource, toSceneId, cue);
  return {
    document: relocated.document,
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: cueId,
    warnings: relocated.warnings,
  };
}

export function copyCue(
  document: ContentDocument,
  sceneId: string,
  cueId: string,
  toSceneIds: readonly string[],
  context: ScriptContext,
): CueEditResult {
  if (toSceneIds.length === 0) {
    throw invalidOperation(["toSceneIds"], "複製先を1件以上指定してください。");
  }
  if (new Set(toSceneIds).size !== toSceneIds.length) {
    throw invalidOperation(["toSceneIds"], "複製先Sceneが重複しています。");
  }
  const { scene } = findEditableScene(document, sceneId);
  const cue = assertMovableCue(scene, cueId);
  for (const toSceneId of toSceneIds) {
    if (toSceneId === sceneId) {
      throw invalidOperation(
        ["toSceneIds"],
        "複製先には異なるSceneを指定してください。",
      );
    }
    findEditableScene(document, toSceneId);
  }
  const existingIds = new Set(
    document.scenes.flatMap((entry) => entry.visualCues.map((item) => item.id)),
  );
  let next = document;
  const createdIds: string[] = [];
  const warnings: Warning[] = [];
  for (const toSceneId of toSceneIds) {
    const cueIdForTarget = context.ids.cue(
      toSceneId,
      cue.template.id.replace(/\W/g, "-"),
      existingIds,
    );
    existingIds.add(cueIdForTarget);
    const relocated = relocateCue(next, toSceneId, {
      ...cue,
      id: cueIdForTarget,
    });
    next = relocated.document;
    createdIds.push(cueIdForTarget);
    warnings.push(...relocated.warnings);
  }
  return {
    document: next,
    sceneIds: [],
    lineIds: [],
    cueIds: createdIds,
    primaryId: createdIds[0]!,
    warnings,
  };
}
