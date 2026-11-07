import {
  collectAssetReferences,
  type ContentDocument,
  type Scene,
  type VisualThemeDefinition,
} from "@kakeai/contracts";
import { compileDocument, type CompiledComposition } from "../compiler";
import { CompositionCompileError } from "../compile-error";
import type { AssetResolver } from "../resolver";
import { assertStaticHtml, stripScripts } from "./strip-scripts";

export interface CompileMaterialCardOptions {
  document: ContentDocument;
  sceneId: string;
  theme: VisualThemeDefinition;
  durationMs: number;
  assetResolver: AssetResolver;
}

export interface CompiledMaterialCard {
  html: string;
  assetIds: string[];
  durationMs: number;
}

const UNSUPPORTED_TEMPLATES = new Set(["character.standing", "composition.full-bleed"]);

function unsupported(sceneId: string, message: string): never {
  throw new CompositionCompileError([
    {
      path: ["scenes", sceneId],
      code: "unsupported_material_card",
      message,
    },
  ]);
}

/**
 * Compiles one Scene into a standalone card HTML. v1 cards are intentionally
 * narrow: a single Scene with scene-range visual cues, no lines, no audio, no
 * standing states, no nested Composition and no video playback. This keeps the
 * card static and avoids a live mini-player.
 */
export function compileMaterialCardRaw(
  options: CompileMaterialCardOptions,
): CompiledMaterialCard {
  if (
    !Number.isSafeInteger(options.durationMs) ||
    options.durationMs <= 0 ||
    options.durationMs > 30_000
  ) {
    unsupported(options.sceneId, "素材カードの durationMs が不正です。");
  }
  const scene = options.document.scenes.find((entry) => entry.id === options.sceneId);
  if (scene === undefined) {
    unsupported(options.sceneId, `素材 Scene が見つかりません: ${options.sceneId}`);
  }
  if (scene.lines.length > 0) {
    unsupported(options.sceneId, "素材カードの Scene にセリフがあります。");
  }
  if ((scene.standingStates ?? []).length > 0) {
    unsupported(options.sceneId, "素材カードの Scene に立ち絵状態があります。");
  }
  for (const cue of scene.visualCues) {
    if (cue.range.kind !== "scene") {
      unsupported(options.sceneId, "素材カードの VisualCue は range: scene だけを使えます。");
    }
    if (UNSUPPORTED_TEMPLATES.has(cue.template.id)) {
      unsupported(
        options.sceneId,
        `素材カードでは ${cue.template.id} を使えません。`,
      );
    }
  }

  const cardScene = {
    ...scene,
    timing: { mode: "fixed", durationMs: options.durationMs },
    lines: [],
    visualCues: [...scene.visualCues],
    standingStates: [],
  } as Scene;
  const cardDocument: ContentDocument = {
    ...options.document,
    scenes: [cardScene],
    audioTakes: [],
    audioCues: [],
    characters: [],
    speakers: [],
  };

  // Resolve every asset before compiling: AssetResolver is synchronous and the
  // caller needs to copy or inline the files it references.
  const references = collectAssetReferences(cardDocument);
  const assetIds = [...new Set(references.map((reference) => reference.assetId))];
  for (const assetId of assetIds) {
    let resolved;
    try {
      resolved = options.assetResolver(assetId);
    } catch (error) {
      unsupported(
        options.sceneId,
        `素材カードの Asset を解決できません: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (resolved.kind === "video" || resolved.kind === "audio") {
      unsupported(options.sceneId, "素材カードに動画・音声素材は使えません。");
    }
  }

  const compiled: CompiledComposition = compileDocument({
    document: cardDocument,
    resolvedTheme: options.theme,
    assetResolver: options.assetResolver,
    outputProfile: "landscape",
  });
  if (compiled.compositionVersions.length > 0) {
    unsupported(options.sceneId, "素材カードに nested Composition は使えません。");
  }
  return {
    html: compiled.html,
    assetIds: compiled.assetIds,
    durationMs: compiled.durationMs,
  };
}

/**
 * Safe variant for HTML cards: strips the GSAP/caption runtime and rejects any
 * remaining executable markup before the HTML can be written to a package.
 */
export function compileStaticMaterialCard(
  options: CompileMaterialCardOptions,
): CompiledMaterialCard {
  const compiled = compileMaterialCardRaw(options);
  const html = stripScripts(compiled.html);
  assertStaticHtml(html, options.sceneId);
  return { ...compiled, html };
}
