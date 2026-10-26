import { describe, expect, it } from "vitest";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import { ONSET_PRESETS, createInsertScene, getVisualTheme, type SnapshotFaceSet, type VisualCue } from "@kakeai/contracts";
import type { AssetResolver, FaceSetResolver } from "../resolver";
import type { CompositionVersionResolver } from "../composition-resolver";
import { CompositionCompileError } from "../compile-error";
import { compileDocument } from "../compiler";
import { cueScope } from "../scope";
import { mixHex } from "../theme";

export const resolver: AssetResolver = (assetId) => {
  if (assetId.includes("audio") || assetId.includes("bgm")) {
    return { url: `/preview/${assetId}`, kind: "audio", durationMs: 3000 };
  }
  return { url: `/preview/${assetId}`, kind: assetId.includes("video") ? "video" : "image" };
};

export const videoResolver: AssetResolver = videoResolverWithDuration(2000);

export function videoResolverWithDuration(durationMs: number): AssetResolver {
  return (assetId) => {
    if (assetId.includes("audio") || assetId.includes("bgm")) {
      return { url: `/preview/${assetId}`, kind: "audio", durationMs: 3000 };
    }
    return {
      url: `/preview/${assetId}`,
      kind: assetId.includes("video") ? "video" : "image",
      durationMs: assetId.includes("video") ? durationMs : null,
    };
  };
}

export const compositionResolver: CompositionVersionResolver = compositionResolverWithDuration(5000);

export function compositionResolverWithDuration(durationMs: number): CompositionVersionResolver {
  return (versionId) => ({
    id: versionId,
    runtimeCompositionId: "cmp.test",
    entrypoint: "index.html",
    bundleHash: "bundle-hash",
    storageKey: "compositions/test",
    previewUrl: "/preview/composition",
    manifest: {
      entrypoint: "index.html",
      runtimeCompositionId: "cmp.test",
      width: 1920,
      height: 1080,
      durationMs,
      dependencies: [],
    },
  });
}

export const transition = {
  enter: { preset: "fade", durationMs: 350 },
  exit: { preset: "none", durationMs: 0 },
} as const;

export function cue(partial: Partial<VisualCue> & Pick<VisualCue, "id" | "template" | "input">): VisualCue {
  return {
    range: { kind: "scene" },
    layer: "background",
    order: 0,
    transition,
    ...partial,
  } as VisualCue;
}

export function clipId(id: string): string {
  return cueScope(id).id("clip");
}
