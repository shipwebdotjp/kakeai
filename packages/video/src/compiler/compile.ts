import { STYLES, surfaceStyleCss, textStyleCss } from "./styles";
import { toSecondsText } from "./animation";
import { bounceTweenLines, type BounceUnit } from "./characters";
import { buildLoopAudios, buildWorkAudioSegments } from "./audio";
import { applySceneTransitions } from "./transitions";
import {
  resolveCaptionSettings,
  resolveCaptionSpeakerStyle,
  resolveThemeCaptionLayout,
  resolveVisualThemeSkin,
  type CaptionLayout,
  type ContentDocument,
  type VisualThemeDefinition,
} from "@kakeai/contracts";
import type {
  CompositionVersionResolver,
  CompositionVersionResolved,
} from "../composition-resolver";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlAttribute } from "../escape";
import { captionLayoutStyle } from "../caption-layout";
import { getGsapBundleSource } from "../gsap-bundle";
import { OUTPUT_FPS, OUTPUT_HEIGHT, OUTPUT_WIDTH } from "../meta";
import type {
  AssetResolver,
  FaceSetResolver,
  StillResolver,
} from "../resolver";
import { type VideoPlaybackPlan } from "../video-playback";
import {
  overlayToRgba,
  resolveTextStyleFontFamilyCss,
  resolveVisualTheme,
  themeRootStyle,
} from "../theme";
import { resolveVisualSkin } from "../skins/registry";
import type { ResolvedVisualSkin } from "../skins/types";
import { resolveTimeline } from "../timeline";
import { gainToVolume } from "../templates/shared";
import { renderScenes } from "./scene";

export const COMPOSITION_ID = "kakeai-main";

export interface CompileDocumentOptions {
  document: ContentDocument;
  assetResolver: AssetResolver;
  compositionResolver?: CompositionVersionResolver;
  faceSetResolver?: FaceSetResolver;
  themeResolver?: (
    id: string,
    version: number,
  ) => VisualThemeDefinition | undefined;
  resolvedTheme?: VisualThemeDefinition;
  resolvedSkin?: ResolvedVisualSkin;
  /** `deriveVideoPlaybackPlans` で一度だけ導出した Plan 群。 */
  videoPlaybackPlans?: ReadonlyMap<string, VideoPlaybackPlan>;
  /** セリフゲート保持区間の静止フレームURL解決器。 */
  stillResolver?: StillResolver;
}

export interface CompiledComposition {
  html: string;
  assetIds: string[];
  compositionVersions: CompositionVersionResolved[];
  durationMs: number;
}

export function compileDocument(
  options: CompileDocumentOptions,
): CompiledComposition {
  const { document, assetResolver, compositionResolver, faceSetResolver } =
    options;
  const videoPlaybackPlans = options.videoPlaybackPlans;
  const stillResolver = options.stillResolver;
  const theme =
    options.resolvedTheme ??
    (options.themeResolver
      ? options.themeResolver(
          document.visualTheme.id,
          document.visualTheme.version,
        )
      : undefined) ??
    resolveVisualTheme(document);
  const skin =
    options.resolvedSkin ?? resolveVisualSkin(resolveVisualThemeSkin(theme));
  const timeline = resolveTimeline(document);
  const sceneById = new Map(document.scenes.map((scene) => [scene.id, scene]));

  const assetIds: string[] = [];
  const seenAssetIds = new Set<string>();
  const compositionVersions: CompositionVersionResolved[] = [];
  const seenCompositionVersionIds = new Set<string>();
  const sceneClipGroups: string[][] = [];
  const audios: string[] = [];
  const tweenLines: string[] = [];

  const trackAsset = (id: string): void => {
    if (!seenAssetIds.has(id)) {
      seenAssetIds.add(id);
      assetIds.push(id);
    }
  };

  const recordComposition = (resolved: CompositionVersionResolved): void => {
    if (!seenCompositionVersionIds.has(resolved.id)) {
      seenCompositionVersionIds.add(resolved.id);
      compositionVersions.push(resolved);
    }
  };

  const takeById = new Map(document.audioTakes.map((take) => [take.id, take]));
  const characterIdBySpeakerId = new Map(
    document.speakers.map((speaker) => [speaker.id, speaker.characterId]),
  );
  const speakerById = new Map(
    document.speakers.map((speaker) => [speaker.id, speaker]),
  );
  const captionLayout: CaptionLayout = resolveThemeCaptionLayout(theme);
  const showSpeakerName = resolveCaptionSettings(document).showSpeakerName;
  const captionSpeakerStyle = resolveCaptionSpeakerStyle(theme);
  const captionSpeakerFontFamily = resolveTextStyleFontFamilyCss(
    captionSpeakerStyle.text,
    document.locale,
  );
  const captionSpeakerScrim = `background:${overlayToRgba(theme.scrim)}`;
  const captionSpeakerSurfaceStyle = surfaceStyleCss(
    captionSpeakerStyle.surface,
    captionSpeakerScrim,
  );
  const captionSpeakerTextStyle = textStyleCss(
    captionSpeakerStyle.text,
    captionSpeakerFontFamily,
    captionSpeakerSurfaceStyle,
  );
  const bounces: BounceUnit[] = [];

  const resolveAudio = (
    assetId: string,
    path: (string | number)[],
  ): { url: string; durationMs: number | null } => {
    const resolved = assetResolver(assetId);
    if (resolved.kind !== "audio") {
      throw new CompositionCompileError([
        {
          path,
          code: "invalid_asset_kind",
          message: "音声素材を指定してください。",
        },
      ]);
    }
    trackAsset(assetId);
    return { url: resolved.url, durationMs: resolved.durationMs ?? null };
  };

  renderScenes({
    document,
    theme,
    skin,
    timeline,
    sceneById,
    assetResolver,
    compositionResolver,
    faceSetResolver,
    videoPlaybackPlans,
    stillResolver,
    characterIdBySpeakerId,
    speakerById,
    takeById,
    captionLayout,
    showSpeakerName,
    captionSpeakerTextStyle,
    trackAsset,
    recordComposition,
    resolveAudio,
    sceneClipGroups,
    audios,
    tweenLines,
    bounces,
  });

  const clips = applySceneTransitions(
    document,
    theme,
    timeline,
    sceneClipGroups,
    tweenLines,
  );

  const placementBySceneId = new Map(
    timeline.scenes.map((placement) => [placement.sceneId, placement]),
  );
  const embeddedInsertWindows = timeline.scenes
    .filter((placement) => {
      const scene = sceneById.get(placement.sceneId);
      return scene?.kind === "insert" && scene.embeddedAudio;
    })
    .map((placement) => ({
      startMs: placement.startMs,
      endMs: placement.endMs,
    }));
  document.audioCues.forEach((cue, cueIndex) => {
    const cuePath: (string | number)[] = ["audioCues", cueIndex];
    const span =
      cue.range.kind === "work"
        ? { startMs: 0, endMs: timeline.totalDurationMs }
        : (() => {
            const placement = placementBySceneId.get(cue.range.sceneId);
            if (placement === undefined) {
              throw new CompositionCompileError([
                {
                  path: cuePath,
                  code: "unknown_scene",
                  message: "シーンを解決できません。",
                },
              ]);
            }
            return { startMs: placement.startMs, endMs: placement.endMs };
          })();
    const audio = resolveAudio(cue.assetId, [...cuePath, "assetId"]);
    const elements =
      cue.range.kind === "work"
        ? buildWorkAudioSegments({
            idPrefix: `kakeai-audio-cue-${cue.id}`,
            url: audio.url,
            workStartMs: span.startMs,
            workEndMs: span.endMs,
            muteWindows: embeddedInsertWindows,
            volume: gainToVolume(cue.gainDb),
            loop: cue.loop === true,
            sourceDurationMs: audio.durationMs,
            path: cuePath,
          })
        : buildLoopAudios({
            idPrefix: `kakeai-audio-cue-${cue.id}`,
            url: audio.url,
            spanStartMs: span.startMs,
            spanEndMs: span.endMs,
            volume: gainToVolume(cue.gainDb),
            loop: cue.loop === true,
            sourceDurationMs: audio.durationMs,
            path: cuePath,
          });
    audios.push(...elements);
  });

  const bounceLines = bounces.flatMap(bounceTweenLines);

  const html = [
    "<!doctype html>",
    `<html lang="${escapeHtmlAttribute(document.locale)}">`,
    "<head>",
    `<meta charset="UTF-8">`,
    `<meta name="viewport" content="width=${OUTPUT_WIDTH}, height=${OUTPUT_HEIGHT}">`,
    `<title>プレビュー</title>`,
    `<style>${STYLES}</style>`,
    "</head>",
    "<body>",
    `<div id="kakeai-root" data-composition-id="${COMPOSITION_ID}" data-width="${OUTPUT_WIDTH}" data-height="${OUTPUT_HEIGHT}" data-duration="${toSecondsText(timeline.totalDurationMs)}" data-fps="${OUTPUT_FPS}" style="${themeRootStyle(theme, document.locale)};${captionLayoutStyle(theme, captionLayout)}">`,
    ...clips,
    ...audios,
    "</div>",
    `<script>${getGsapBundleSource()}</script>`,
    "<script>",
    "const tl = gsap.timeline({ paused: true });",
    ...tweenLines,
    ...bounceLines,
    `window.__timelines["${COMPOSITION_ID}"] = tl;`,
    "</script>",
    "</body>",
    "</html>",
  ].join("\n");

  return {
    html,
    assetIds,
    compositionVersions,
    durationMs: timeline.totalDurationMs,
  };
}
