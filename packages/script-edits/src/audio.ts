import type {
  AudioCue,
  AudioCueRole,
  ContentDocument,
  Warning,
} from "@kakeai/contracts";
import type { ScriptContext } from "./context.ts";
import {
  invalidOperation,
  preconditionFailed,
  targetNotFound,
} from "./errors.ts";
import type { SceneEditResult } from "./scene.ts";

export interface AudioEditResult extends SceneEditResult {
  audioCueIds?: string[];
  warnings?: Warning[];
}

function requireAudioAsset(assetId: string, context: ScriptContext): void {
  const asset = context.assets.get(assetId);
  if (asset === null || asset.status !== "ready") {
    throw preconditionFailed(["assetId"], `readyなAssetが見つかりません: ${assetId}`);
  }
  if (asset.kind !== "audio") {
    throw preconditionFailed(["assetId"], "音声Cueはaudio Assetだけを参照できます。");
  }
}

function validateAudioCue(
  document: ContentDocument,
  role: AudioCueRole,
  range: AudioCue["range"],
  excludeId: string | null,
): void {
  if (range.kind === "work" && role !== "bgm") {
    throw invalidOperation(
      ["range"],
      "作品全体に鳴らせるのはbgmだけです。",
    );
  }
  if (
    range.kind === "scene" &&
    !document.scenes.some((scene) => scene.id === range.sceneId)
  ) {
    throw targetNotFound(["range"], `Sceneが見つかりません: ${range.sceneId}`);
  }
  if (role === "bgm" && range.kind === "work") {
    const existing = document.audioCues.find(
      (cue) =>
        cue.role === "bgm" &&
        cue.range.kind === "work" &&
        cue.id !== excludeId,
    );
    if (existing !== undefined) {
      throw preconditionFailed(["role"], "作品全体のBGMは1件だけです。");
    }
  }
}

export function addAudio(
  document: ContentDocument,
  role: AudioCueRole,
  assetId: string,
  range: AudioCue["range"],
  gainDb: number | undefined,
  loop: boolean | undefined,
  context: ScriptContext,
): AudioEditResult {
  requireAudioAsset(assetId, context);
  validateAudioCue(document, role, range, null);
  const cueId = context.ids.audioCue(
    new Set(document.audioCues.map((cue) => cue.id)),
  );
  const cue: AudioCue = { id: cueId, role, assetId, range };
  if (gainDb !== undefined) {
    cue.gainDb = gainDb;
  }
  if (loop !== undefined) {
    cue.loop = loop;
  }
  return {
    document: { ...document, audioCues: [...document.audioCues, cue] },
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    audioCueIds: [cueId],
    primaryId: cueId,
  };
}

export function updateAudio(
  document: ContentDocument,
  audioCueId: string,
  update: {
    role?: AudioCueRole;
    assetId?: string;
    range?: AudioCue["range"];
    gainDb?: number | null;
    loop?: boolean | null;
  },
  context: ScriptContext,
): AudioEditResult {
  const cue = document.audioCues.find((entry) => entry.id === audioCueId);
  if (cue === undefined) {
    throw targetNotFound(["audioCueId"], `音声Cueが見つかりません: ${audioCueId}`);
  }
  const role = update.role ?? cue.role;
  const assetId = update.assetId ?? cue.assetId;
  const range = update.range ?? cue.range;
  if (update.assetId !== undefined) {
    requireAudioAsset(assetId, context);
  }
  validateAudioCue(document, role, range, audioCueId);
  const nextCue: AudioCue = { ...cue, role, assetId, range };
  if (update.gainDb !== undefined) {
    if (update.gainDb === null) {
      delete nextCue.gainDb;
    } else {
      nextCue.gainDb = update.gainDb;
    }
  }
  if (update.loop !== undefined) {
    if (update.loop === null) {
      delete nextCue.loop;
    } else {
      nextCue.loop = update.loop;
    }
  }
  return {
    document: {
      ...document,
      audioCues: document.audioCues.map((entry) =>
        entry.id === audioCueId ? nextCue : entry,
      ),
    },
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: audioCueId,
  };
}

export function removeAudio(
  document: ContentDocument,
  audioCueId: string,
): AudioEditResult {
  if (!document.audioCues.some((cue) => cue.id === audioCueId)) {
    throw targetNotFound(["audioCueId"], `音声Cueが見つかりません: ${audioCueId}`);
  }
  return {
    document: {
      ...document,
      audioCues: document.audioCues.filter((cue) => cue.id !== audioCueId),
    },
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: audioCueId,
  };
}
