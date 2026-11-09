import { useEffect, useRef, useState } from "react";
import type { LiveProgramDocument, LiveVisualRef } from "@kakeai/contracts";
import {
  createLiveCardPreview,
  createLiveCardRenderer,
  type LiveCardRenderer,
} from "@kakeai/live-cards";
import { assetContentUrl } from "../../api/client";
import { describeVisual } from "../model/visual";
import { buttonNeutralClass, metaTextClass } from "../../ui";

interface LivePreviewProps {
  document: LiveProgramDocument;
  visual: LiveVisualRef | null | undefined;
  /** Describes where the visual came from (cue override vs segment default). */
  sourceLabel?: string;
  className?: string;
  replayable?: boolean;
}

/**
 * Editor preview backed by the same renderer as the live stage. The first
 * snapshot is always settled; the replay button is the only animated path.
 */
export function LivePreview({
  document,
  visual,
  sourceLabel,
  className,
  replayable = true,
}: LivePreviewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<LiveCardRenderer | null>(null);
  const [replayToken, setReplayToken] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }
    let disposed = false;
    const fail = () => {
      if (!disposed) {
        setRenderError("カードを描画できませんでした。");
      }
    };
    setRenderError(null);
    const animate = replayToken > 0;
    const renderer = animate
      ? createLiveCardRenderer(host, {
          resolveAsset: (assetId) => assetContentUrl(assetId),
          animate: true,
          onError: fail,
        })
      : createLiveCardPreview(host, {
          resolveAsset: (assetId) => assetContentUrl(assetId),
          onError: fail,
        });
    rendererRef.current = renderer;
    renderer.setCards(document.cards);
    if (animate) {
      // Establish the first snapshot silently, settle, then re-enter the same
      // visual with animation enabled.
      renderer.setVisual(visual);
      renderer.markSettled();
      const frame = requestAnimationFrame(() => {
        if (disposed) {
          return;
        }
        renderer.setVisual(null);
        renderer.setVisual(visual, { animate: true });
      });
      return () => {
        disposed = true;
        cancelAnimationFrame(frame);
        renderer.dispose();
        if (rendererRef.current === renderer) {
          rendererRef.current = null;
        }
      };
    }
    renderer.setVisual(visual);
    return () => {
      disposed = true;
      renderer.dispose();
      if (rendererRef.current === renderer) {
        rendererRef.current = null;
      }
    };
    // The renderer is recreated only for an explicit replay; document and
    // visual changes are applied through the update effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayToken]);

  useEffect(() => {
    rendererRef.current?.setCards(document.cards);
  }, [document.cards]);

  useEffect(() => {
    rendererRef.current?.setVisual(visual);
  }, [visual]);

  const hidden = visual === null || visual === undefined || visual.kind === "material";
  const label =
    visual === undefined
      ? "中央ビジュアルは未指定です（セグメント既定もありません）"
      : visual === null
        ? "このCueでは中央ビジュアルを隠します"
        : visual.kind === "material"
          ? `素材: ${
              document.materials.find((material) => material.id === visual.materialId)?.name ??
              visual.materialId
            }（素材カードは書き出し時に解決されます）`
          : describeVisual(document.cards, document.materials, visual);

  return (
    <div className={className}>
      <div className="relative h-56 overflow-hidden rounded-md border border-border bg-surface-muted">
        <div ref={hostRef} className="h-full w-full" />
        {hidden && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center">
            <p className={metaTextClass}>{label}</p>
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className={metaTextClass}>
          {sourceLabel === undefined ? label : `${sourceLabel}: ${label}`}
        </p>
        {replayable && visual !== null && visual !== undefined && visual.kind === "card" && (
          <button
            type="button"
            className={buttonNeutralClass}
            onClick={() => setReplayToken((token) => token + 1)}
          >
            アニメーションを再生
          </button>
        )}
      </div>
      {renderError !== null && <p className="mt-1 text-sm text-red-600">{renderError}</p>}
    </div>
  );
}
