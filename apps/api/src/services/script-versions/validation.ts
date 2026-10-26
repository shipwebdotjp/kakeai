import { renderSourceDurationMs, type AssetWithRenditions } from "./references";
import {
  CompositionCompileError,
  collectGatedMediaReferences,
  resolveCueWindow,
  resolveTimeline,
} from "@kakeai/video";
import {
  mediaFullBleedInputSchema,
  type ContentDocument,
  type InsertScene,
  type MediaFullBleedInput,
  type Warning,
} from "@kakeai/contracts";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.ts";
import {
  validationError,
  type ValidationIssue,
} from "../../http/validation.ts";

function insertMainCueInput(scene: InsertScene): MediaFullBleedInput | null {
  const cue = scene.visualCues.find(
    (entry) => entry.id === scene.mainVisualCueId,
  );
  if (cue === undefined) {
    return null;
  }
  const parsed = mediaFullBleedInputSchema.safeParse(cue.input);
  return parsed.success ? parsed.data : null;
}

function insertMainAssetId(scene: InsertScene): string | null {
  return insertMainCueInput(scene)?.assetId ?? null;
}

export function assertInsertScenes(
  content: ContentDocument,
  assetById: Map<string, AssetWithRenditions>,
): void {
  const issues: ValidationIssue[] = [];
  content.scenes.forEach((scene, sceneIndex) => {
    if (scene.kind !== "insert") {
      return;
    }
    const input = insertMainCueInput(scene);
    if (input === null) {
      return;
    }
    const asset = assetById.get(input.assetId);
    if (asset === undefined) {
      return;
    }
    if (asset.kind !== "video") {
      issues.push({
        path: ["scenes", sceneIndex, "mainVisualCueId"],
        code: "invalid_type",
        message: "インサートSceneの主動画には動画素材を指定してください。",
      });
      return;
    }
    const sourceMs = renderSourceDurationMs(asset);
    if (sourceMs === null) {
      issues.push({
        path: ["scenes", sceneIndex, "timing", "durationMs"],
        code: "invalid_value",
        message: "尺が不明な動画はインサートSceneの主動画に指定できません。",
      });
      return;
    }
    const trimStartMs = input.trimStartMs ?? 0;
    const trimEndMs = input.trimEndMs ?? sourceMs;
    if (trimStartMs >= trimEndMs || trimEndMs > sourceMs) {
      issues.push({
        path: ["scenes", sceneIndex, "mainVisualCueId"],
        code: "invalid_value",
        message: "動画トリムの範囲が素材の尺を超えているか、開始 ≧ 終了です。",
      });
      return;
    }
    const clipMs = trimEndMs - trimStartMs;
    if (input.loop === true) {
      if (scene.timing.durationMs < clipMs) {
        issues.push({
          path: ["scenes", sceneIndex, "timing", "durationMs"],
          code: "invalid_value",
          message:
            "ループ再生ではScene尺をトリム後の動画尺以上にしてください。",
        });
      }
    } else if (scene.timing.durationMs !== clipMs) {
      issues.push({
        path: ["scenes", sceneIndex, "timing", "durationMs"],
        code: "invalid_value",
        message: "Scene尺が主動画のトリム後の尺と一致しません。",
      });
    }
  });
  if (issues.length > 0) {
    throw validationError(issues);
  }
}

export function assertVideoPlayback(
  content: ContentDocument,
  assetById: Map<string, AssetWithRenditions>,
): void {
  interface GatedCue {
    sceneIndex: number;
    cueIndex: number;
    refs: ReturnType<typeof collectGatedMediaReferences>;
  }
  const gatedCues: GatedCue[] = [];
  content.scenes.forEach((scene, sceneIndex) => {
    scene.visualCues.forEach((cue, cueIndex) => {
      const cuePath: (string | number)[] = [
        "scenes",
        sceneIndex,
        "visualCues",
        cueIndex,
      ];
      const refs = collectGatedMediaReferences(cue.input, cuePath);
      if (refs.length > 0) {
        gatedCues.push({ sceneIndex, cueIndex, refs });
      }
    });
  });
  if (gatedCues.length === 0) {
    return;
  }

  const issues: ValidationIssue[] = [];
  let timeline: ReturnType<typeof resolveTimeline>;
  try {
    timeline = resolveTimeline(content);
  } catch (error) {
    if (error instanceof CompositionCompileError) {
      throw validationError(error.issues as ValidationIssue[]);
    }
    throw error;
  }
  const placementBySceneIndex = new Map(
    timeline.scenes.map((placement) => [placement.sceneIndex, placement]),
  );
  for (const gated of gatedCues) {
    const placement = placementBySceneIndex.get(gated.sceneIndex);
    const scene = content.scenes[gated.sceneIndex];
    const cue = scene?.visualCues[gated.cueIndex];
    if (placement === undefined || scene === undefined || cue === undefined) {
      continue;
    }
    const cuePath: (string | number)[] = [
      "scenes",
      gated.sceneIndex,
      "visualCues",
      gated.cueIndex,
    ];
    if (scene.kind === "insert") {
      issues.push({
        path: cuePath,
        code: "invalid_value",
        message:
          "インサートSceneの主動画にはセリフゲート再生を設定できません。",
      });
      continue;
    }
    const lineIndexById = new Map(
      scene.lines.map((line, index) => [line.id, index]),
    );
    const lineStartById = new Map(
      placement.lines.map((line) => [line.lineId, line.startMs]),
    );
    let window: ReturnType<typeof resolveCueWindow>;
    try {
      window = resolveCueWindow(placement, cue, cuePath);
    } catch (error) {
      if (error instanceof CompositionCompileError) {
        throw validationError(error.issues as ValidationIssue[]);
      }
      throw error;
    }
    if (window === null) {
      continue;
    }
    const windowStartMs = placement.startMs + window.startMs;
    const windowEndMs = placement.startMs + window.endMs;
    let rangeStartIndex = -1;
    let rangeEndIndex = Number.POSITIVE_INFINITY;
    if (cue.range.kind === "lines") {
      rangeStartIndex = lineIndexById.get(cue.range.startLineId) ?? -1;
      rangeEndIndex =
        lineIndexById.get(cue.range.endLineId) ?? Number.POSITIVE_INFINITY;
    }
    for (const ref of gated.refs) {
      const asset = assetById.get(ref.assetId);
      if (asset === undefined) {
        continue;
      }
      if (asset.kind !== "video") {
        issues.push({
          path: [...ref.path, "videoPlayback"],
          code: "invalid_type",
          message: "セリフゲート再生は動画素材にだけ指定できます。",
        });
        continue;
      }
      const durationMs = renderSourceDurationMs(asset);
      if (durationMs === null) {
        issues.push({
          path: [...ref.path, "videoPlayback"],
          code: "invalid_value",
          message:
            "尺が確定していない動画にはセリフゲート再生を設定できません。",
        });
        continue;
      }
      const sourceEndMs = ref.playback.sourceEndMs ?? durationMs;
      if (sourceEndMs <= 0 || sourceEndMs > durationMs) {
        issues.push({
          path: [...ref.path, "videoPlayback", "sourceEndMs"],
          code: "invalid_value",
          message: "セリフゲート再生の終端は素材の尺の範囲内にしてください。",
        });
        continue;
      }
      let previousLineIndex = -1;
      let previousStartMs = -1;
      ref.playback.gates.forEach((gate, gateIndex) => {
        const gatePath = [...ref.path, "videoPlayback", "gates", gateIndex];
        if (gate.sourceMs >= sourceEndMs) {
          issues.push({
            path: [...gatePath, "sourceMs"],
            code: "invalid_value",
            message: "Gate の sourceMs は sourceEndMs より前にしてください。",
          });
        }
        const lineIndex = lineIndexById.get(gate.narrationSegmentId);
        const startMs = lineStartById.get(gate.narrationSegmentId);
        if (lineIndex === undefined || startMs === undefined) {
          issues.push({
            path: [...gatePath, "narrationSegmentId"],
            code: "invalid_value",
            message:
              "Gate の Narration Segment が親Cueと同じSceneにありません。",
          });
          return;
        }
        if (lineIndex <= previousLineIndex) {
          issues.push({
            path: [...gatePath, "narrationSegmentId"],
            code: "invalid_value",
            message: "Gate は Scene の登録順に並べてください。",
          });
        }
        if (startMs <= previousStartMs) {
          issues.push({
            path: [...gatePath, "narrationSegmentId"],
            code: "invalid_value",
            message: "Gate の Narration Segment 開始時刻は昇順にしてください。",
          });
        }
        previousLineIndex = lineIndex;
        previousStartMs = startMs;
        if (startMs < windowStartMs || startMs >= windowEndMs) {
          issues.push({
            path: [...gatePath, "narrationSegmentId"],
            code: "invalid_value",
            message:
              "Gate の Narration Segment は親Cueの表示区間内にしてください。",
          });
        }
        if (
          cue.range.kind === "lines" &&
          (lineIndex < rangeStartIndex || lineIndex > rangeEndIndex)
        ) {
          issues.push({
            path: [...gatePath, "narrationSegmentId"],
            code: "invalid_value",
            message: "range: lines のCueではGateをlines範囲内にしてください。",
          });
        }
        const audio = gate.audio;
        if (audio !== undefined && audio.enabled) {
          const nextSourceMs =
            gateIndex + 1 < ref.playback.gates.length
              ? (ref.playback.gates[gateIndex + 1]?.sourceMs ?? sourceEndMs)
              : sourceEndMs;
          const segmentMs = nextSourceMs - gate.sourceMs;
          const fadeTotalMs = (audio.fadeInMs ?? 0) + (audio.fadeOutMs ?? 0);
          if (fadeTotalMs > segmentMs) {
            issues.push({
              path: [...gatePath, "audio"],
              code: "invalid_value",
              message: "フェードの合計がGate区間を超えています。",
            });
          }
        }
      });
    }
  }
  if (issues.length > 0) {
    throw validationError(issues);
  }
}

export async function collectInsertWarnings(
  client: PrismaClient | Prisma.TransactionClient,
  content: ContentDocument,
): Promise<Warning[]> {
  const assetIds = [
    ...new Set(
      content.scenes
        .filter(
          (scene): scene is InsertScene =>
            scene.kind === "insert" && scene.embeddedAudio,
        )
        .map((scene) => insertMainAssetId(scene))
        .filter((id): id is string => id !== null),
    ),
  ];
  if (assetIds.length === 0) {
    return [];
  }
  const assets = await client.asset.findMany({
    where: { id: { in: assetIds } },
  });
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const warnings: Warning[] = [];
  content.scenes.forEach((scene, sceneIndex) => {
    if (scene.kind !== "insert" || !scene.embeddedAudio) {
      return;
    }
    const assetId = insertMainAssetId(scene);
    const asset = assetId === null ? undefined : assetById.get(assetId);
    if (asset === undefined || asset.kind !== "video" || asset.hasAudio) {
      return;
    }
    warnings.push({
      path: ["scenes", sceneIndex, "embeddedAudio"],
      code: "insert_video_without_audio",
      message:
        "この動画には音声ストリームがないため、インサート区間は無音になります。",
    });
  });
  return warnings;
}
