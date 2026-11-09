import {
  collectAssetReferences,
  type ContentDocument,
  type LiveMaterialFormat,
  type Scene,
} from "@kakeai/contracts";
import { LiveExportError } from "./errors.ts";

const UNSUPPORTED_TEMPLATES = new Set(["character.standing", "composition.full-bleed"]);

export interface MaterialSceneInput {
  id: string;
  sceneId: string;
  format: LiveMaterialFormat;
  durationMs: number;
}

function fail(message: string, id: string | null = null): never {
  throw new LiveExportError("LIVE_EXPORT_MATERIAL_FAILED", "material", message, id);
}

function cardDocument(content: ContentDocument, scene: Scene, durationMs: number): ContentDocument {
  return {
    ...content,
    scenes: [
      {
        ...scene,
        timing: { mode: "fixed", durationMs },
        lines: [],
        visualCues: [...scene.visualCues],
        standingStates: [],
      } as Scene,
    ],
    audioTakes: [],
    audioCues: [],
    characters: [],
    speakers: [],
  };
}

/**
 * Structural validation shared by Live Material import and package export. It
 * rejects scenes that a static material card cannot represent before any
 * expensive rendering starts.
 */
export function validateMaterialScene(
  material: MaterialSceneInput,
  content: ContentDocument,
  assetById: ReadonlyMap<string, { kind: string }>,
): void {
  const scene = content.scenes.find((entry) => entry.id === material.sceneId);
  if (scene === undefined) {
    fail(`素材 Scene が見つかりません: ${material.sceneId}`, material.sceneId);
  }
  if (scene.lines.length > 0) {
    fail("素材カードの Scene にセリフがあります。", material.id);
  }
  if ((scene.standingStates ?? []).length > 0) {
    fail("素材カードの Scene に立ち絵状態があります。", material.id);
  }
  if (
    content.audioCues.some(
      (cue) => cue.range.kind === "scene" && cue.range.sceneId === scene.id,
    )
  ) {
    fail("素材カードの Scene に音声キューがあります。", material.id);
  }
  for (const cue of scene.visualCues) {
    if (cue.range.kind !== "scene") {
      fail("素材カードの VisualCue は range: scene だけを使えます。", material.id);
    }
    if (UNSUPPORTED_TEMPLATES.has(cue.template.id)) {
      fail(`素材カードでは ${cue.template.id} を使えません。`, material.id);
    }
  }
  const document = cardDocument(content, scene, material.durationMs);
  for (const reference of collectAssetReferences(document)) {
    const asset = assetById.get(reference.assetId);
    if (asset === undefined) {
      fail(`素材カードの Asset が見つかりません: ${reference.assetId}`, material.id);
    }
    if (asset.kind !== "image") {
      fail("素材カードに画像以外の Asset は使えません。", material.id);
    }
  }
}
