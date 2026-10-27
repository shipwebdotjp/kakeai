import { NORMAL_EXPRESSION_ID } from "@kakeai/contracts";
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { validationError, type ValidationIssue } from "../http/validation.ts";

/**
 * Validation shared by the full HTTP Face Set update and the agent partial
 * update. It lives in its own module to keep the library service within its
 * size budget.
 */
export type LayerInput = {
  id: string;
  part: "brow" | "eye" | "mouth" | "foreground";
  assetId: string;
  blinkLayerId: string | null;
  speakingLayerId: string | null;
};

export type PresetInput = {
  id: string;
  name: string;
  browLayerId: string | null;
  eyeLayerId: string | null;
  mouthLayerId: string | null;
};

export type LayerRow = {
  id: string;
  part: string;
  assetId: string;
  blinkLayerId: string | null;
  speakingLayerId: string | null;
};

export type PresetRow = {
  id: string;
  name: string;
  browLayerId: string | null;
  eyeLayerId: string | null;
  mouthLayerId: string | null;
};

function checkDuplicateIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      duplicates.add(id);
    } else {
      seen.add(id);
    }
  }
  return [...duplicates];
}

export async function assertLayersUsable(
  prisma: PrismaClient | Prisma.TransactionClient,
  layers: readonly LayerInput[],
): Promise<void> {
  const issues: ValidationIssue[] = [];
  const duplicates = checkDuplicateIds(layers.map((layer) => layer.id));
  if (duplicates.length > 0) {
    issues.push({
      path: ["layers"],
      code: "custom",
      message: `レイヤーのIDが重複しています: ${duplicates.join(", ")}`,
    });
  }
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  layers.forEach((layer, index) => {
    if (layer.blinkLayerId !== null && layer.part !== "eye") {
      issues.push({
        path: ["layers", index, "blinkLayerId"],
        code: "invalid_value",
        message: "閉眼レイヤーは目レイヤーにだけ指定できます。",
      });
    }
    if (layer.speakingLayerId !== null && layer.part !== "mouth") {
      issues.push({
        path: ["layers", index, "speakingLayerId"],
        code: "invalid_value",
        message: "開口レイヤーは口レイヤーにだけ指定できます。",
      });
    }
    for (const [key, targetId, expectedPart] of [
      ["blinkLayerId", layer.blinkLayerId, "eye"],
      ["speakingLayerId", layer.speakingLayerId, "mouth"],
    ] as const) {
      if (targetId === null) {
        continue;
      }
      const target = byId.get(targetId);
      if (target === undefined) {
        issues.push({
          path: ["layers", index, key],
          code: "invalid_value",
          message: "同じ表情セット内のレイヤーを指定してください。",
        });
      } else if (targetId === layer.id) {
        issues.push({
          path: ["layers", index, key],
          code: "invalid_value",
          message: "自身のレイヤーは指定できません。",
        });
      } else if (target.part !== expectedPart) {
        issues.push({
          path: ["layers", index, key],
          code: "invalid_value",
          message: "対応先の部位が一致しません。",
        });
      }
    }
  });
  const assetIds = [...new Set(layers.map((layer) => layer.assetId))];
  if (assetIds.length > 0) {
    const assets = await prisma.asset.findMany({
      where: { id: { in: assetIds } },
      select: { id: true, kind: true, status: true, widthPx: true, heightPx: true },
    });
    const byAssetId = new Map(assets.map((asset) => [asset.id, asset]));
    layers.forEach((layer, index) => {
      const asset = byAssetId.get(layer.assetId);
      if (asset === undefined) {
        issues.push({
          path: ["layers", index, "assetId"],
          code: "invalid_value",
          message: "素材が見つかりません。",
        });
        return;
      }
      if (asset.kind !== "image") {
        issues.push({
          path: ["layers", index, "assetId"],
          code: "invalid_type",
          message: "顔レイヤーには画像素材を選んでください。",
        });
        return;
      }
      if (asset.status !== "ready") {
        issues.push({
          path: ["layers", index, "assetId"],
          code: "invalid_value",
          message: "素材が準備完了していません。",
        });
      }
    });
    const sized = assets.filter(
      (asset): asset is typeof asset & { widthPx: number; heightPx: number } =>
        asset.widthPx !== null && asset.heightPx !== null,
    );
    if (sized.length !== assets.length) {
      issues.push({
        path: ["layers"],
        code: "invalid_value",
        message: "顔レイヤーの寸法を確認できません。",
      });
    } else if (sized.length > 0) {
      const first = sized[0]!;
      const mismatch = sized.some(
        (asset) => asset.widthPx !== first.widthPx || asset.heightPx !== first.heightPx,
      );
      if (mismatch) {
        issues.push({
          path: ["layers"],
          code: "invalid_value",
          message: "顔レイヤーは同じ寸法の画像にしてください。",
        });
      }
    }
  }
  if (issues.length > 0) {
    throw validationError(issues);
  }
}

export function assertPresetsUsable(
  layers: readonly LayerInput[],
  presets: readonly PresetInput[],
): void {
  const issues: ValidationIssue[] = [];
  const duplicates = checkDuplicateIds(presets.map((preset) => preset.id));
  if (duplicates.length > 0) {
    issues.push({
      path: ["expressions"],
      code: "custom",
      message: `表情のIDが重複しています: ${duplicates.join(", ")}`,
    });
  }
  if (!presets.some((preset) => preset.id === NORMAL_EXPRESSION_ID)) {
    issues.push({
      path: ["expressions"],
      code: "custom",
      message: "normal の表情が必要です。",
    });
  }
  const layerIds = new Map(layers.map((layer) => [layer.id, layer]));
  presets.forEach((preset, index) => {
    for (const [key, targetId, expectedPart] of [
      ["browLayerId", preset.browLayerId, "brow"],
      ["eyeLayerId", preset.eyeLayerId, "eye"],
      ["mouthLayerId", preset.mouthLayerId, "mouth"],
    ] as const) {
      if (targetId === null) {
        continue;
      }
      const target = layerIds.get(targetId);
      if (target === undefined) {
        issues.push({
          path: ["expressions", index, key],
          code: "invalid_value",
          message: "同じ表情セット内のレイヤーを指定してください。",
        });
      } else if (target.part !== expectedPart) {
        issues.push({
          path: ["expressions", index, key],
          code: "invalid_value",
          message: "対応先の部位が一致しません。",
        });
      }
    }
  });
  if (issues.length > 0) {
    throw validationError(issues);
  }
}

export async function assertCompatibleWithLibraryAppearances(
  prisma: PrismaClient | Prisma.TransactionClient,
  faceSetId: string,
  layers: readonly LayerInput[],
): Promise<void> {
  if (layers.length === 0) {
    return;
  }
  const appearances = await prisma.characterAppearance.findMany({
    where: { faceSetId },
    select: {
      id: true,
      assetId: true,
      label: true,
      character: { select: { name: true } },
    },
  });
  if (appearances.length === 0) {
    return;
  }
  const assetIds = [
    ...new Set([
      ...layers.map((layer) => layer.assetId),
      ...appearances.map((appearance) => appearance.assetId),
    ]),
  ];
  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds } },
    select: { id: true, widthPx: true, heightPx: true },
  });
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const layerSizes = layers.map((layer) => byId.get(layer.assetId));
  const layerSize = layerSizes[0];
  if (
    layerSize === undefined ||
    layerSize.widthPx === null ||
    layerSize.heightPx === null
  ) {
    // The layer assets are validated by assertLayersUsable; this guard only
    // keeps the comparison meaningful if that validation changes.
    return;
  }
  const issues: ValidationIssue[] = [];
  for (const appearance of appearances) {
    const base = byId.get(appearance.assetId);
    if (
      base === undefined ||
      base.widthPx === null ||
      base.heightPx === null
    ) {
      issues.push({
        path: ["layers"],
        code: "invalid_value",
        message: `「${appearance.character.name}」のベース画像の寸法を確認できません。`,
      });
      continue;
    }
    if (
      base.widthPx !== layerSize.widthPx ||
      base.heightPx !== layerSize.heightPx
    ) {
      const label =
        appearance.label === null || appearance.label.length === 0
          ? appearance.id
          : appearance.label;
      issues.push({
        path: ["layers"],
        code: "invalid_value",
        message: `「${appearance.character.name}」の外観「${label}」のベース画像（${base.widthPx}×${base.heightPx}）と顔レイヤーの寸法（${layerSize.widthPx}×${layerSize.heightPx}）が一致しません。`,
      });
    }
  }
  if (issues.length > 0) {
    throw validationError(issues);
  }
}
