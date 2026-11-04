import { useEffect, useMemo, useState } from "react";
import type { FaceSetUsageAppearance } from "@kakeai/contracts";
import { assetContentUrl } from "../../api/client";
import { errorTextClass, metaTextClass, textFieldClass } from "../../ui";
import {
  FACE_PREVIEW_STILL,
  buildFacePreviewSchedule,
  buildFacePreviewStack,
  facePreviewMotionAt,
  isMotionVisible,
  resolveFacePreviewVariants,
  type FacePreviewMotion,
  type FaceSetPreviewExpression,
  type FaceSetPreviewLayer,
} from "./facePreviewAnimation";

interface FaceSetUsagePreviewProps {
  usages: FaceSetUsageAppearance[] | undefined;
  usagesLoading: boolean;
  usagesError: boolean;
  layers: readonly FaceSetPreviewLayer[];
  expressions: readonly FaceSetPreviewExpression[];
  assetsById: ReadonlyMap<string, { widthPx: number | null; heightPx: number | null }>;
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
  const layerById = useMemo(
    () => new Map(layers.map((layer) => [layer.id, layer])),
    [layers],
  );
  const variants = useMemo(
    () => resolveFacePreviewVariants(expression, layers),
    [expression, layers],
  );
  const stack = useMemo(
    () => buildFacePreviewStack(expression, layers),
    [expression, layers],
  );
  const schedule = useMemo(() => buildFacePreviewSchedule(), []);
  const canAnimate =
    variants.eyeVariantId !== null || variants.mouthVariantId !== null;
  const [animate, setAnimate] = useState(false);
  const [motion, setMotion] = useState<FacePreviewMotion>(FACE_PREVIEW_STILL);

  useEffect(() => {
    if (!canAnimate) {
      setAnimate(false);
    }
  }, [canAnimate]);

  useEffect(() => {
    if (!animate || !canAnimate) {
      setMotion(FACE_PREVIEW_STILL);
      return;
    }
    const startedAt = performance.now();
    const tick = () => {
      const next = facePreviewMotionAt(
        schedule,
        performance.now() - startedAt,
      );
      setMotion((current) =>
        current.eyesClosed === next.eyesClosed &&
        current.mouthOpen === next.mouthOpen
          ? current
          : next,
      );
    };
    tick();
    const timer = window.setInterval(tick, 40);
    return () => window.clearInterval(timer);
  }, [animate, canAnimate, schedule]);

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
      <div className="mb-2 flex flex-wrap items-center gap-3">
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
        <label className="inline-flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={animate}
            disabled={!canAnimate}
            onChange={(event) => setAnimate(event.target.checked)}
          />
          瞬き・口パクを確認
        </label>
        {!canAnimate && (
          <span className={metaTextClass}>
            閉眼・開口を登録すると動きを確認できます。
          </span>
        )}
      </div>
      <ul className="flex flex-wrap gap-3">
        {usages.map((usage) => {
          const issue = faceSetDimensionIssue(usage, layers, assetsById);
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
                {stack.map((item) => {
                  const layer = layerById.get(item.layerId);
                  if (layer === undefined || layer.assetId === null) {
                    return null;
                  }
                  return (
                    <img
                      key={item.key}
                      src={assetContentUrl(layer.assetId)}
                      alt=""
                      className="absolute inset-0 h-full w-full object-contain"
                      loading="lazy"
                      style={{
                        opacity: isMotionVisible(item, motion) ? 1 : 0,
                      }}
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
