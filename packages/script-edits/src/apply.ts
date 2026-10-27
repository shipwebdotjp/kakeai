import type {
  ContentDocument,
  ScriptCueRange,
  ScriptIdRef,
  ScriptOperation,
  ScriptOperationCreated,
  VisualCueRange,
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
import {
  addLine,
  assignTake,
  moveLine,
  removeLine,
  removeTake,
  selectTake,
  setLineExpression,
  setLineGap,
  setLineSpeaker,
  updateLineText,
  splitLine,
} from "./line.ts";
import { splitPointSceneAtLine } from "./split.ts";
import {
  addCue,
  copyCue,
  moveCue,
  removeCue,
  setCueInput,
  updateCueInput,
  setCuePlacement,
  setCueRange,
  updateCueTransition,
} from "./cue.ts";
import { removeStanding, upsertStanding } from "./standing.ts";
import { addAudio, removeAudio, updateAudio } from "./audio.ts";
import { addCharacterFromLibrary } from "./character.ts";
import { addSpeaker, setSpeakerVoiceProfile } from "./speaker.ts";
import { setCaption, setVisualTheme } from "./theme.ts";

export type { ScriptOperationCreated };

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
    characterIds: [],
    appearanceIds: [],
    speakerIds: [],
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

function resolveCueRange(
  range: ScriptCueRange,
  keys: ReadonlyMap<string, string>,
): VisualCueRange {
  if (range.kind !== "lines") {
    return range;
  }
  return {
    kind: "lines",
    startLineId: resolveId(range.startLineId, keys, ["range", "startLineId"]),
    endLineId: resolveId(range.endLineId, keys, ["range", "endLineId"]),
  };
}

function toResult(
  result: SceneEditResult & {
    warnings?: Warning[];
    audioTakeIds?: string[];
    audioCueIds?: string[];
    characterIds?: string[];
    appearanceIds?: string[];
    speakerIds?: string[];
  },
): ScriptOperationResult {
  return {
    document: result.document,
    created: {
      ...emptyCreated(),
      sceneIds: result.sceneIds,
      lineIds: result.lineIds,
      cueIds: result.cueIds,
      audioCueIds: result.audioCueIds ?? [],
      audioTakeIds: result.audioTakeIds ?? [],
      characterIds: result.characterIds ?? [],
      appearanceIds: result.appearanceIds ?? [],
      speakerIds: result.speakerIds ?? [],
    },
    warnings: result.warnings ?? [],
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
    case "scene.splitAtLine": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      const lineId = resolveId(operation.lineId, keys, ["lineId"]);
      const result = splitPointSceneAtLine(
        document,
        sceneId,
        lineId,
        operation.label,
        context,
      );
      registerKey(operation.key, keys, result.primaryId);
      return toResult(result);
    }
    case "line.split": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      const lineId = resolveId(operation.lineId, keys, ["lineId"]);
      const result = splitLine(
        document,
        sceneId,
        lineId,
        operation.first,
        operation.second,
        context,
      );
      registerKey(operation.key, keys, result.primaryId);
      return toResult(result);
    }
    case "line.add": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      const speakerId =
        operation.speakerId === undefined || operation.speakerId === null
          ? operation.speakerId
          : resolveId(operation.speakerId, keys, ["speakerId"]);
      const result = addLine(
        document,
        sceneId,
        operation.index,
        {
          captionText: operation.captionText,
          speechText: operation.speechText,
          speakerId,
          expressionId: operation.expressionId,
          gapBeforeMs: operation.gapBeforeMs,
        },
        context,
      );
      registerKey(operation.key, keys, result.primaryId);
      return toResult(result);
    }
    case "line.remove": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      const lineId = resolveId(operation.lineId, keys, ["lineId"]);
      return toResult(removeLine(document, sceneId, lineId));
    }
    case "line.move": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      const lineId = resolveId(operation.lineId, keys, ["lineId"]);
      return toResult(moveLine(document, sceneId, lineId, operation.index));
    }
    case "line.updateText": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      const lineId = resolveId(operation.lineId, keys, ["lineId"]);
      return toResult(
        updateLineText(
          document,
          sceneId,
          lineId,
          operation.captionText,
          operation.speechText,
        ),
      );
    }
    case "line.setSpeaker": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      const lineId = resolveId(operation.lineId, keys, ["lineId"]);
      const speakerId =
        operation.speakerId === null
          ? null
          : resolveId(operation.speakerId, keys, ["speakerId"]);
      return toResult(
        setLineSpeaker(document, sceneId, lineId, speakerId),
      );
    }
    case "line.setExpression": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      const lineId = resolveId(operation.lineId, keys, ["lineId"]);
      return toResult(
        setLineExpression(document, sceneId, lineId, operation.expressionId),
      );
    }
    case "line.setGap": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      const lineId = resolveId(operation.lineId, keys, ["lineId"]);
      return toResult(
        setLineGap(document, sceneId, lineId, operation.gapBeforeMs),
      );
    }
    case "line.assignTake": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      const lineId = resolveId(operation.lineId, keys, ["lineId"]);
      const result = assignTake(
        document,
        sceneId,
        lineId,
        operation.assetId,
        operation.source,
        context,
      );
      registerKey(operation.key, keys, result.primaryId);
      return toResult(result);
    }
    case "line.selectTake": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      const lineId = resolveId(operation.lineId, keys, ["lineId"]);
      const takeId =
        operation.takeId === null
          ? null
          : resolveId(operation.takeId, keys, ["takeId"]);
      return toResult(selectTake(document, sceneId, lineId, takeId));
    }
    case "line.removeTake": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      const lineId = resolveId(operation.lineId, keys, ["lineId"]);
      const takeId = resolveId(operation.takeId, keys, ["takeId"]);
      return toResult(removeTake(document, sceneId, lineId, takeId));
    }
    case "cue.add": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      const result = addCue(
        document,
        sceneId,
        {
          template: operation.template,
          range: resolveCueRange(operation.range, keys),
          layer: operation.layer,
          order: operation.order,
          transition: operation.transition,
          input: operation.input,
        },
        context,
      );
      registerKey(operation.key, keys, result.primaryId);
      return toResult(result);
    }
    case "cue.remove": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      const cueId = resolveId(operation.cueId, keys, ["cueId"]);
      return toResult(removeCue(document, sceneId, cueId));
    }
    case "cue.setRange": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      const cueId = resolveId(operation.cueId, keys, ["cueId"]);
      return toResult(
        setCueRange(
          document,
          sceneId,
          cueId,
          resolveCueRange(operation.range, keys),
        ),
      );
    }
    case "cue.setInput": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      const cueId = resolveId(operation.cueId, keys, ["cueId"]);
      return toResult(
        setCueInput(
          document,
          sceneId,
          cueId,
          operation.input,
        ),
      );
    }
    case "cue.updateInput": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      const cueId = resolveId(operation.cueId, keys, ["cueId"]);
      return toResult(
        updateCueInput(
          document,
          sceneId,
          cueId,
          operation.input,
        ),
      );
    }
    case "cue.setPlacement": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      const cueId = resolveId(operation.cueId, keys, ["cueId"]);
      return toResult(
        setCuePlacement(
          document,
          sceneId,
          cueId,
          operation.layer,
          operation.order,
        ),
      );
    }
    case "cue.updateTransition": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      const cueId = resolveId(operation.cueId, keys, ["cueId"]);
      return toResult(
        updateCueTransition(
          document,
          sceneId,
          cueId,
          operation.enter,
          operation.exit,
        ),
      );
    }
    case "cue.move": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      const cueId = resolveId(operation.cueId, keys, ["cueId"]);
      const toSceneId = resolveId(operation.toSceneId, keys, ["toSceneId"]);
      return toResult(moveCue(document, sceneId, cueId, toSceneId));
    }
    case "cue.copy": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      const cueId = resolveId(operation.cueId, keys, ["cueId"]);
      const toSceneIds = operation.toSceneIds.map((entry, index) =>
        resolveId(entry, keys, ["toSceneIds", index]),
      );
      const result = copyCue(document, sceneId, cueId, toSceneIds, context);
      registerKey(operation.key, keys, result.primaryId);
      return toResult(result);
    }
    case "standing.upsert": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      const result = upsertStanding(
        document,
        sceneId,
        operation.side,
        operation.characterId,
        operation.appearanceId,
        operation.scale,
        operation.transition,
        context,
        operation.edge,
        operation.vertical,
      );
      registerKey(operation.key, keys, result.primaryId);
      return toResult(result);
    }
    case "standing.remove": {
      const sceneId = resolveId(operation.sceneId, keys, ["sceneId"]);
      return toResult(removeStanding(document, sceneId, operation.side));
    }
    case "audio.add": {
      const result = addAudio(
        document,
        operation.role,
        operation.assetId,
        operation.range,
        operation.gainDb,
        operation.loop,
        context,
      );
      registerKey(operation.key, keys, result.primaryId);
      return toResult(result);
    }
    case "audio.update": {
      const audioCueId = resolveId(operation.audioCueId, keys, ["audioCueId"]);
      return toResult(
        updateAudio(
          document,
          audioCueId,
          {
            role: operation.role,
            assetId: operation.assetId,
            range: operation.range,
            gainDb: operation.gainDb,
            loop: operation.loop,
          },
          context,
        ),
      );
    }
    case "audio.remove": {
      const audioCueId = resolveId(operation.audioCueId, keys, ["audioCueId"]);
      return toResult(removeAudio(document, audioCueId));
    }
    case "character.addFromLibrary": {
      return toResult(addCharacterFromLibrary(document, operation, context));
    }
    case "speaker.add": {
      const result = addSpeaker(document, operation, context);
      registerKey(operation.key, keys, result.primaryId);
      return toResult(result);
    }
    case "speaker.setVoiceProfile": {
      const speakerId = resolveId(operation.speakerId, keys, ["speakerId"]);
      return toResult(
        setSpeakerVoiceProfile(
          document,
          {
            op: "speaker.setVoiceProfile",
            speakerId,
            voiceProfileId: operation.voiceProfileId,
          },
          context,
        ),
      );
    }
    case "document.setVisualTheme": {
      return toResult(
        setVisualTheme(document, operation.id, operation.version, context),
      );
    }
    case "document.setCaption": {
      return toResult(setCaption(document, operation.showSpeakerName));
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
      created.characterIds.push(...result.created.characterIds);
      created.appearanceIds.push(...result.created.appearanceIds);
      created.speakerIds.push(...result.created.speakerIds);
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
