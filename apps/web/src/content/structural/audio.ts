import {
  applyToDocument,
  buildStructuralDocument,
  emptyResult,
  type StructuralAsset,
  type StructuralEditResult,
} from "./common";
import type { ContentDocument } from "@kakeai/contracts";
import { toFormValues, type DocumentFormValues } from "../form";

export function commitBgmStructural(
  base: ContentDocument,
  values: DocumentFormValues,
  assets: readonly StructuralAsset[] = [],
): StructuralEditResult | null {
  const document = buildStructuralDocument(base, values);
  const existing =
    (values.bgm.cueId === null
      ? undefined
      : document.audioCues.find((cue) => cue.id === values.bgm.cueId)) ??
    document.audioCues.find(
      (cue) => cue.role === "bgm" && cue.range.kind === "work",
    );

  if (values.bgm.assetId === null) {
    if (existing !== undefined) {
      return applyToDocument(
        document,
        values,
        [{ op: "audio.remove", audioCueId: existing.id }],
        assets,
      );
    }
    if (values.bgm.cueId === null) {
      return null;
    }
    return {
      values: toFormValues(document),
      document,
      result: emptyResult(document),
    };
  }

  if (existing === undefined) {
    return applyToDocument(
      document,
      values,
      [
        {
          op: "audio.add",
          role: "bgm",
          assetId: values.bgm.assetId,
          range: { kind: "work" },
          gainDb: values.bgm.gainDb,
          loop: values.bgm.loop,
        },
      ],
      assets,
    );
  }

  return applyToDocument(
    document,
    values,
    [
      {
        op: "audio.set",
        audioCueId: existing.id,
        role: "bgm",
        assetId: values.bgm.assetId,
        range: { kind: "work" },
        gainDb: values.bgm.gainDb,
        loop: values.bgm.loop,
      },
    ],
    assets,
  );
}

export function commitCueStructural(
  base: ContentDocument,
  values: DocumentFormValues,
  sceneId: string,
  cueId: string,
  assets: readonly StructuralAsset[] = [],
): StructuralEditResult | null {
  const document = buildStructuralDocument(base, values);
  const scene = document.scenes.find((entry) => entry.id === sceneId);
  const cue = scene?.visualCues.find((entry) => entry.id === cueId);
  if (cue === undefined) {
    return null;
  }
  return applyToDocument(
    document,
    values,
    [
      { op: "cue.setRange", sceneId, cueId, range: cue.range },
      {
        op: "cue.setInput",
        sceneId,
        cueId,
        input: cue.input,
        replace: true,
      },
      {
        op: "cue.setPlacement",
        sceneId,
        cueId,
        layer: cue.layer,
        order: cue.order,
      },
      {
        op: "cue.setTransition",
        sceneId,
        cueId,
        enter: cue.transition.enter,
        exit: cue.transition.exit,
      },
    ],
    assets,
  );
}
