import { useState } from "react";
import type { FaceSetUsageAppearance } from "@kakeai/contracts";
import { assetContentUrl } from "../../api/client";
import { errorTextClass, metaTextClass, textFieldClass } from "../../ui";

type PreviewPart = "brow" | "eye" | "mouth" | "foreground";

export interface FaceSetPreviewLayer {
  id: string;
  part: PreviewPart;
  assetId: string | null;
}

export interface FaceSetPreviewExpression {
  id: string;
  name: string;
  browLayerId: string | null;
  eyeLayerId: string | null;
  mouthLayerId: string | null;
}

interface FaceSetUsagePreviewProps {
  usages: FaceSetUsageAppearance[] | undefined;
  usagesLoading: boolean;
  usagesError: boolean;
  layers: readonly FaceSetPreviewLayer[];
  expressions: readonly FaceSetPreviewExpression[];
  assetsById: ReadonlyMap<string, { widthPx: number | null; heightPx: number | null }>;
}

const PART_ORDER: PreviewPart[] = ["brow", "eye", "mouth", "foreground"];

function layerIdsFor(
  expression: FaceSetPreviewExpression | undefined,
  layers: readonly FaceSetPreviewLayer[],
): string[] {
  const foreground = layers
    .filter((layer) => layer.part === "foreground" && layer.assetId !== null)
    .map((layer) => layer.id);
  if (expression === undefined) {
    return foreground;
  }
  return [
    expression.browLayerId,
    expression.eyeLayerId,
    expression.mouthLayerId,
    ...foreground,
  ].filter((id): id is string => id !== null);
}

export function faceSetDimensionIssue(
  usage: FaceSetUsageAppearance,
  layers: readonly FaceSetPreviewLayer[],
  assetsById: ReadonlyMap<string, { widthPx: number | null; heightPx: number | null }>,
): string | null {
  if (layers.length === 0) {
    return null;
  }
  if (usage.widthPx === null || usage.heightPx === null) {
    return "ベース画像の寸法を確認できません。";
  }
  for (const layer of layers) {
    if (layer.assetId === null) {
      return "画像が未選択のレイヤーがあります。";
    }
    const asset = assetsById.get(layer.assetId);
    if (asset === undefined || asset.widthPx === null || asset.heightPx === null) {
      return "顔レイヤーの寸法を確認できません。";
    }
    if (asset.widthPx !== usage.widthPx || asset.heightPx !== usage.heightPx) {
      return `顔レイヤー（${asset.widthPx}×${asset.heightPx}）がベース画像（${usage.widthPx}×${usage.heightPx}）と一致しません。`;
    }
  }
  return null;
}

/**
 * Previews a draft Face Set on each library Appearance that references it.
 * Dimension mismatches are shown before save, because a revision that does not
 * fit a library Appearance can never become the latest revision.
 */
export function FaceSetUsagePreview({
  usages,
  usagesLoading,
  usagesError,
  layers,
  expressions,
  assetsById,
}: FaceSetUsagePreviewProps) {
  const [expressionId, setExpressionId] = useState("normal");
  const expression =
    expressions.find((entry) => entry.id === expressionId) ??
    expressions.find((entry) => entry.id === "normal") ??
    expressions[0];
  const orderedLayers = [...layers].sort(
    (left, right) =>
      PART_ORDER.indexOf(left.part) - PART_ORDER.indexOf(right.part),
  );
  const layerById = new Map(orderedLayers.map((layer) => [layer.id, layer]));

  if (usagesLoading) {
    return <p className={metaTextClass}>使用中のキャラクターを読み込み中…</p>;
  }
  if (usagesError) {
    return <p className={errorTextClass}>使用中のキャラクターを読み込めませんでした。</p>;
  }
  if (usages === undefined || usages.length === 0) {
    return (
      <p className={metaTextClass}>
        この表情セットを使うライブラリキャラクターはまだありません。外観に割り当てると、ここに合成プレビューと寸法診断が出ます。
      </p>
    );
  }

  return (
    <div className="mb-3 rounded border border-border p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">使用中のキャラクター</span>
        <label className="inline-flex items-center gap-1.5 text-sm">
          表情
          <select
            className={textFieldClass}
            value={expression?.id ?? ""}
            onChange={(event) => setExpressionId(event.target.value)}
          >
            {expressions.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name || entry.id}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ul className="flex flex-wrap gap-3">
        {usages.map((usage) => {
          const issue = faceSetDimensionIssue(usage, layers, assetsById);
          const compositeIds = layerIdsFor(expression, orderedLayers);
          return (
            <li key={usage.appearanceId} className="w-52">
              <div
                className={`relative overflow-hidden rounded border ${
                  issue === null ? "border-border" : "border-red-500"
                } bg-black/5`}
              >
                <img
                  src={assetContentUrl(usage.assetId)}
                  alt=""
                  className="relative block w-full"
                  loading="lazy"
                />
                {compositeIds.map((layerId) => {
                  const layer = layerById.get(layerId);
                  if (layer === undefined || layer.assetId === null) {
                    return null;
                  }
                  return (
                    <img
                      key={layerId}
                      src={assetContentUrl(layer.assetId)}
                      alt=""
                      className="absolute inset-0 h-full w-full object-contain"
                      loading="lazy"
                    />
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-foreground">
                {usage.characterName}
                {usage.label === null || usage.label.length === 0
                  ? ""
                  : ` / ${usage.label}`}
              </p>
              <p className="text-xs text-muted-foreground">
                ベース {usage.widthPx ?? "?"}×{usage.heightPx ?? "?"}
              </p>
              {issue !== null && <p className={errorTextClass}>{issue}</p>}
            </li>
          );
        })}
      </ul>
      <p className={`mt-2 ${metaTextClass}`}>
        ライブラリのキャラクターは常に最新版を参照します。寸法が一致しない内容は最新版として保存できません。
      </p>
    </div>
  );
}
