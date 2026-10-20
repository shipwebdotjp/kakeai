import type {
  ContentDocument,
  ScriptIdRef,
  ScriptOperation,
  Warning,
} from "@kakeai/contracts";
import type { ScriptContext } from "./context.ts";
import { invalidOperation, ScriptEditError } from "./errors.ts";
import {
  addInsertScene,
  addPointScene,
  moveScene,
  removeScene,
  setSceneAccent,
  setSceneLabel,
  setSceneTiming,
  setSceneTransition,
  type SceneEditResult,
} from "./scene.ts";

export interface ScriptOperationCreated {
  sceneIds: string[];
  lineIds: string[];
  cueIds: string[];
  audioCueIds: string[];
  audioTakeIds: string[];
}

export interface ScriptOperationResult {
  document: ContentDocument;
  created: ScriptOperationCreated;
  warnings: Warning[];
}

function emptyCreated(): ScriptOperationCreated {
  return {
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    audioCueIds: [],
    audioTakeIds: [],
  };
}

function resolveId(
  reference: ScriptIdRef,
  keys: ReadonlyMap<string, string>,
  path: (string | number)[],
): string {
  if (typeof reference === "string") {
    return reference;
  }
  const id = keys.get(reference.key);
  if (id === undefined) {
    throw invalidOperation(path, `未解決のkeyです: ${reference.key}`);
  }
  return id;
}

function registerKey(
  key: string | undefined,
  keys: Map<string, string>,
  id: string,
): void {
  if (key === undefined) {
    return;
  }
  if (keys.has(key)) {
    throw invalidOperation(["key"], `keyが重複しています: ${key}`);
  }
  keys.set(key, id);
}

function toResult(result: SceneEditResult): ScriptOperationResult {
  return {
    document: result.document,
    created: {
      ...emptyCreated(),
      sceneIds: result.sceneIds,
      lineIds: result.lineIds,
      cueIds: result.cueIds,
    },
    warnings: [],
  };
}

export function applyScriptOperation(
  document: ContentDocument,
  operation: ScriptOperation,
  context: ScriptContext,
  keys: Map<string, string> = new Map(),
): ScriptOperationResult {
  switch (operation.op) {
    case "scene.add": {
      if (operation.kind === "point") {
        const result = addPointScene(document, operation, context);
        registerKey(operation.key, keys, result.primaryId);
        return toResult(result);
      }
      const result = addInsertScene(document, operation, context);
      registerKey(operation.key, keys, result.primaryId);
      return toResult(result);
    }
    case "scene.remove": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      return toResult(removeScene(document, sceneId));
    }
    case "scene.move": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      return toResult(moveScene(document, sceneId, operation.index));
    }
    case "scene.setLabel": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      return toResult(setSceneLabel(document, sceneId, operation.label));
    }
    case "scene.setAccent": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      return toResult(setSceneAccent(document, sceneId, operation.accent));
    }
    case "scene.setTiming": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      return toResult(setSceneTiming(document, sceneId, operation.timing));
    }
    case "scene.setTransition": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      return toResult(setSceneTransition(document, sceneId, operation.enter));
    }
    default: {
      throw invalidOperation([], "未対応の操作です。");
    }
  }
}

export function applyScriptOperations(
  document: ContentDocument,
  operations: readonly ScriptOperation[],
  context: ScriptContext,
): ScriptOperationResult {
  const keys = new Map<string, string>();
  const created = emptyCreated();
  const warnings: Warning[] = [];
  let current = document;

  for (const [index, operation] of operations.entries()) {
    try {
      const result = applyScriptOperation(current, operation, context, keys);
      current = result.document;
      created.sceneIds.push(...result.created.sceneIds);
      created.lineIds.push(...result.created.lineIds);
      created.cueIds.push(...result.created.cueIds);
      created.audioCueIds.push(...result.created.audioCueIds);
      created.audioTakeIds.push(...result.created.audioTakeIds);
      warnings.push(...result.warnings);
    } catch (error) {
      if (error instanceof ScriptEditError) {
        throw new ScriptEditError(
          error.code,
          error.issues.map((issue) => ({
            ...issue,
            path: ["operations", index, ...issue.path],
          })),
        );
      }
      throw error;
    }
  }

  return { document: current, created, warnings };
}
