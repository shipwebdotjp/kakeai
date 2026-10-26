import {
  characterStandingV1,
  characterStandingV1InputSchema,
  type CaptionLayout,
  type ContentDocument,
  type CueLayer,
  type Scene,
  type Speaker,
  type VisualCue,
  type VisualThemeDefinition,
} from "@kakeai/contracts";
import type {
  CompositionVersionResolver,
  CompositionVersionResolved,
} from "../composition-resolver";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlText } from "../escape";
import type {
  AssetResolver,
  FaceSetResolver,
  StillResolver,
} from "../resolver";
import { cueScope } from "../scope";
import { seededRandom } from "../random";
import type { LineInterval } from "../render-context";
import { type VideoPlaybackPlan } from "../video-playback";
import {
  overlayToRgba,
  resolveFontFamilyCss,
  resolveSceneAccentHex,
} from "../theme";
import type { ResolvedVisualSkin } from "../skins/types";
import {
  compositionTransitionOverflowMessage,
  cueTransitionTotalMs,
  resolveCueWindow,
  type ResolvedTimeline,
} from "../timeline";
import { gainToVolume } from "../templates/shared";
import {
  FADE_START_EPSILON_MS,
  actionEase,
  actionVars,
  applyCueTiming,
  presetVars,
  secondsText,
  stateIntervalTweenLines,
  toSecondsText,
  valueTweenLine,
} from "./animation";
import {
  blinkSchedule,
  expressionIntervalsForCharacter,
  expressionTweenLines,
  faceVariantTweenLines,
  mergeIntervals,
  mouthSchedule,
  type BounceUnit,
  type FaceEvent,
  type SpeakingInterval,
} from "./characters";
import { dispatchTemplate, makeContext } from "./nested";
import { audioElement } from "./audio";
import { surfaceBackgroundCss, surfaceStyleCss, textStyleCss } from "./styles";

export interface SceneRenderContext {
  document: ContentDocument;
  theme: VisualThemeDefinition;
  skin: ResolvedVisualSkin;
  timeline: ResolvedTimeline;
  sceneById: ReadonlyMap<string, Scene>;
  assetResolver: AssetResolver;
  compositionResolver?: CompositionVersionResolver;
  faceSetResolver?: FaceSetResolver;
  videoPlaybackPlans?: ReadonlyMap<string, VideoPlaybackPlan>;
  stillResolver?: StillResolver;
  characterIdBySpeakerId: ReadonlyMap<string, string | null>;
  speakerById: ReadonlyMap<string, Speaker>;
  takeById: ReadonlyMap<string, ContentDocument["audioTakes"][number]>;
  captionLayout: CaptionLayout;
  showSpeakerName: boolean;
  captionSpeakerTextStyle: string;
  trackAsset: (id: string) => void;
  recordComposition: (resolved: CompositionVersionResolved) => void;
  resolveAudio: (
    assetId: string,
    path: (string | number)[],
  ) => { url: string; durationMs: number | null };
  sceneClipGroups: string[][];
  audios: string[];
  tweenLines: string[];
  bounces: BounceUnit[];
}

const LAYER_ORDER: Record<CueLayer, number> = {
  background: 0,
  card: 1,
  standing: 2,
  overlay: 3,
};

/**
 * 全シーンを走査し、クリップHTML・音声要素・tween行を context で渡された配列へ破壊的に追記する。
 * 呼び出し順序の契約: compileDocument は renderScenes → applySceneTransitions（sceneClipGroups の
 * クロスフェード延長と tween 追記）→ audioCues → bounceLines の順に呼ぶこと。
 * 順序を入れ替えると生成 HTML が変わる。
 */
export function renderScenes(context: SceneRenderContext): void {
  const {
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
  } = context;

  for (const placement of timeline.scenes) {
    const scene = sceneById.get(placement.sceneId);
    if (scene === undefined) {
      throw new CompositionCompileError([
        {
          path: ["scenes"],
          code: "unknown_scene",
          message: "シーンを解決できません。",
        },
      ]);
    }
    const startSec = toSecondsText(placement.startMs);
    const durationSec = toSecondsText(placement.durationMs);
    const sceneClips: string[] = [];
    const bgId = `kakeai-scene-${placement.sceneIndex}-bg`;
    const accentHex = resolveSceneAccentHex(scene, theme);
    const background = skin.sceneBackground(accentHex, theme);
    sceneClips.push(
      `<section id="${bgId}" class="clip" data-start="${startSec}" data-duration="${durationSec}"><div id="${bgId}-body" class="kakeai-scenebg" style="background:${background}"></div></section>`,
    );

    const lineById = new Map(scene.lines.map((line) => [line.id, line]));
    const speakingIntervalsByCharacter = new Map<string, SpeakingInterval[]>();
    for (const linePlacement of placement.lines) {
      const line = lineById.get(linePlacement.lineId);
      if (line === undefined || line.speakerId === null) {
        continue;
      }
      const characterId = characterIdBySpeakerId.get(line.speakerId);
      if (characterId === null || characterId === undefined) {
        continue;
      }
      const intervals = speakingIntervalsByCharacter.get(characterId) ?? [];
      intervals.push({
        startMs: linePlacement.startMs,
        endMs: linePlacement.endMs,
      });
      speakingIntervalsByCharacter.set(characterId, intervals);
    }

    const emitCue = (cue: VisualCue, cueIndex: number): void => {
      const cuePath: (string | number)[] = [
        "scenes",
        placement.sceneIndex,
        "visualCues",
        cueIndex,
      ];
      const window = resolveCueWindow(placement, cue, cuePath);
      if (window === null) {
        return;
      }
      const span = window.endMs - window.startMs;
      const absStartMs = placement.startMs + window.startMs;
      const scope = cueScope(cue.id);
      const lineIntervals: LineInterval[] = placement.lines.map(
        (linePlacement) => ({
          lineId: linePlacement.lineId,
          startMs: linePlacement.startMs - absStartMs,
          endMs: linePlacement.endMs - absStartMs,
        }),
      );
      const context = makeContext(
        document,
        theme,
        skin,
        assetResolver,
        scope,
        cuePath,
        faceSetResolver,
        {
          startMs: absStartMs,
          spanMs: span,
        },
        lineIntervals,
        compositionResolver,
        recordComposition,
        videoPlaybackPlans,
        stillResolver,
      );
      if (
        scene.kind === "insert" &&
        scene.embeddedAudio &&
        cue.id === scene.mainVisualCueId
      ) {
        context.embeddedAudio = true;
        context.embeddedAudioGainDb = scene.embeddedAudioGainDb ?? 0;
      }
      const rendered = dispatchTemplate(
        `${cue.template.id}@${cue.template.version}`,
        cue.input,
        context,
      );
      for (const assetId of rendered.assetIds) {
        trackAsset(assetId);
      }
      const childDurationMs = rendered.compositionVersion?.manifest.durationMs;
      const effectiveSpanMs =
        childDurationMs === undefined ? span : Math.min(span, childDurationMs);
      if (cueTransitionTotalMs(cue) > effectiveSpanMs) {
        throw new CompositionCompileError([
          {
            path: cuePath,
            code: "transition_range_overflow",
            message: compositionTransitionOverflowMessage(effectiveSpanMs),
          },
        ]);
      }
      const absEndMs = absStartMs + effectiveSpanMs;
      if (rendered.compositionVersion) {
        recordComposition(rendered.compositionVersion);
      }
      if (rendered.html.length === 0) {
        return;
      }
      const cueHtml = applyCueTiming(
        rendered.html,
        absStartMs,
        effectiveSpanMs,
      );
      const clipId = scope.id("clip");
      const bodyId = scope.id("body");
      const compositionWindowAttr =
        childDurationMs === undefined
          ? ""
          : ` data-composition-duration-ms="${childDurationMs}"`;
      sceneClips.push(
        `<div id="${clipId}" class="clip" data-start="${toSecondsText(absStartMs)}" data-duration="${toSecondsText(effectiveSpanMs)}"${compositionWindowAttr}><div id="${bodyId}" class="kakeai-cuebody">${cueHtml}</div></div>`,
      );

      if (cue.transition.enter.durationMs > 0) {
        const vars = presetVars(cue.transition.enter.preset, "enter");
        if (vars !== null) {
          tweenLines.push(
            `tl.from(document.getElementById("${bodyId}"),{${vars},duration:${secondsText(cue.transition.enter.durationMs / 1000)},ease:"power1.out",immediateRender:false},${toSecondsText(absStartMs + FADE_START_EPSILON_MS)});`,
          );
        }
      }
      if (cue.transition.exit.durationMs > 0) {
        const vars = presetVars(cue.transition.exit.preset, "exit");
        if (vars !== null) {
          const exitStartMs = absEndMs - cue.transition.exit.durationMs;
          tweenLines.push(
            `tl.to(document.getElementById("${bodyId}"),{${vars},duration:${secondsText(cue.transition.exit.durationMs / 1000)},ease:"power1.in",immediateRender:false},${toSecondsText(exitStartMs)});`,
          );
        }
      }
      for (const stateLine of stateIntervalTweenLines(
        rendered.stateIntervals ?? [],
        absStartMs,
        effectiveSpanMs,
      )) {
        tweenLines.push(stateLine);
      }

      for (const item of rendered.animation) {
        if (item.durationMs <= 0) {
          continue;
        }
        const vars = actionVars(item.action, item.axis);
        if (vars !== null) {
          tweenLines.push(
            `tl.from(document.getElementById("${item.targetId}"),{${vars},duration:${secondsText(item.durationMs / 1000)},ease:"${actionEase(item.ease)}",immediateRender:false},${toSecondsText(absStartMs + item.startMs)});`,
          );
        }
      }

      for (const item of rendered.valueAnimations ?? []) {
        const valueLine = valueTweenLine(item, absStartMs, document.locale);
        if (valueLine !== null) {
          tweenLines.push(valueLine);
        }
      }

      for (const nested of rendered.nestedCompositionWindows ?? []) {
        if (nested.durationMs > 0 && nested.durationMs < span) {
          tweenLines.push(
            `tl.set(document.getElementById("${nested.targetId}"),{opacity:0},${toSecondsText(absStartMs + nested.durationMs)});`,
          );
        }
      }

      if (
        rendered.motionTargetId !== undefined &&
        cue.template.id === characterStandingV1.id &&
        cue.template.version === characterStandingV1.version
      ) {
        const parsed = characterStandingV1InputSchema.safeParse(cue.input);
        if (parsed.success) {
          const intervals = speakingIntervalsByCharacter.get(
            parsed.data.characterId,
          );
          if (intervals !== undefined) {
            const cueStartMs = absStartMs;
            const cueEndMs = absEndMs;
            for (const interval of mergeIntervals(intervals)) {
              const startMs = Math.max(interval.startMs, cueStartMs);
              const endMs = Math.min(interval.endMs, cueEndMs);
              if (endMs > startMs) {
                bounces.push({
                  elementId: rendered.motionTargetId,
                  startMs,
                  endMs,
                });
              }
            }
          }
        }
      }

      if (
        rendered.expressionTargets !== undefined &&
        rendered.expressionTargets.length > 0 &&
        cue.template.id === characterStandingV1.id &&
        cue.template.version === characterStandingV1.version
      ) {
        const parsed = characterStandingV1InputSchema.safeParse(cue.input);
        if (parsed.success) {
          const knownPresets = new Set(
            rendered.expressionTargets.map((target) => target.presetId),
          );
          const intervals = expressionIntervalsForCharacter(
            parsed.data.characterId,
            placement.lines,
            lineById,
            characterIdBySpeakerId,
            knownPresets,
            absStartMs,
            absEndMs,
          );
          for (const line of expressionTweenLines(
            rendered.expressionTargets,
            intervals,
          )) {
            tweenLines.push(line);
          }
          const seedKey = `${cue.id}|${parsed.data.characterId}`;
          const hasBlink = rendered.expressionTargets.some(
            (target) => target.eyeBlinkId !== undefined,
          );
          const hasMouth = rendered.expressionTargets.some(
            (target) => target.mouthSpeakingId !== undefined,
          );
          const blinks =
            hasBlink && absEndMs > absStartMs
              ? blinkSchedule(
                  seededRandom(`${seedKey}|blink`),
                  absStartMs,
                  absEndMs,
                )
              : [];
          let mouths: FaceEvent[] = [];
          if (hasMouth) {
            const speaking =
              speakingIntervalsByCharacter.get(parsed.data.characterId) ?? [];
            const windows: FaceEvent[] = [];
            for (const interval of mergeIntervals(speaking)) {
              const startMs = Math.max(interval.startMs, absStartMs);
              const endMs = Math.min(interval.endMs, absEndMs);
              if (endMs > startMs) {
                windows.push({ startMs, endMs });
              }
            }
            mouths = mouthSchedule(seededRandom(`${seedKey}|mouth`), windows);
          }
          for (const line of faceVariantTweenLines(
            rendered.expressionTargets,
            intervals,
            blinks,
            mouths,
          )) {
            tweenLines.push(line);
          }
        }
      }
    };

    const orderedCues = scene.visualCues
      .map((cue, cueIndex) => ({ cue, cueIndex }))
      .sort(
        (a, b) =>
          LAYER_ORDER[a.cue.layer] - LAYER_ORDER[b.cue.layer] ||
          a.cue.order - b.cue.order ||
          a.cueIndex - b.cueIndex,
      );

    for (const { cue, cueIndex } of orderedCues) {
      if (LAYER_ORDER[cue.layer] <= LAYER_ORDER.standing) {
        emitCue(cue, cueIndex);
      }
    }

    placement.lines.forEach((linePlacement, lineIndex) => {
      const line = lineById.get(linePlacement.lineId);
      if (line === undefined) {
        throw new CompositionCompileError([
          {
            path: ["scenes", placement.sceneIndex, "lines", lineIndex],
            code: "unknown_line",
            message: "ラインを解決できません。",
          },
        ]);
      }
      const captionText = line.captionText.trim();
      if (captionText.length > 0) {
        const captionToken = theme.textRoles.caption;
        const fontFamily = resolveFontFamilyCss(
          captionToken.fontFace,
          captionToken.font,
        );

        const captionSurface = theme.surfaces?.caption;
        const captionScrim = `background:${overlayToRgba(theme.scrim)}`;
        const captionSurfaceBackground = surfaceBackgroundCss(
          captionSurface,
          captionScrim,
        );
        const surfaceBgStyle = surfaceStyleCss(captionSurface, captionScrim);
        const captionStyle = textStyleCss(
          captionToken,
          fontFamily,
          surfaceBgStyle,
        );
        const isBand = captionLayout === "band";
        const captionOuterClass = isBand
          ? "kakeai-caption kakeai-caption-band"
          : "kakeai-caption";
        const captionOuterStyle = isBand ? captionSurfaceBackground : "";
        const captionInnerStyle = isBand
          ? textStyleCss(captionToken, fontFamily, "background:transparent")
          : captionStyle;
        let speakerLabelHtml = "";
        if (showSpeakerName && line.speakerId !== null) {
          const speaker = speakerById.get(line.speakerId);
          const speakerName = speaker?.name.trim() ?? "";
          if (speakerName.length > 0) {
            const speakerStyleText = captionSpeakerTextStyle;
            speakerLabelHtml = `<span class="kakeai-captionspeaker" style="${speakerStyleText}">${escapeHtmlText(speakerName)}</span>`;
          }
        }
        sceneClips.push(
          `<div id="kakeai-caption-${placement.sceneIndex}-${lineIndex}" class="clip" data-start="${toSecondsText(linePlacement.startMs)}" data-duration="${toSecondsText(linePlacement.durationMs)}"><div class="${captionOuterClass}"${captionOuterStyle.length > 0 ? ` style="${captionOuterStyle}"` : ""}><div class="kakeai-captionwrap">${speakerLabelHtml}<p class="kakeai-captiontext" style="${captionInnerStyle}">${escapeHtmlText(captionText)}</p></div></div></div>`,
        );
      }
      if (line.selectedAudioTakeId === null) {
        return;
      }
      const take = takeById.get(line.selectedAudioTakeId);
      if (take === undefined) {
        throw new CompositionCompileError([
          {
            path: ["scenes", placement.sceneIndex, "lines", lineIndex],
            code: "unknown_take",
            message: "音声テイクを解決できません。",
          },
        ]);
      }
      const audio = resolveAudio(take.assetId, [
        "audioTakes",
        document.audioTakes.indexOf(take),
        "assetId",
      ]);
      audios.push(
        audioElement({
          id: `kakeai-audio-take-${line.id}`,
          url: audio.url,
          startMs: linePlacement.startMs,
          durationMs: Math.min(
            audio.durationMs ?? linePlacement.durationMs,
            linePlacement.durationMs,
          ),
          volume: gainToVolume(0),
        }),
      );
    });

    for (const { cue, cueIndex } of orderedCues) {
      if (LAYER_ORDER[cue.layer] === LAYER_ORDER.overlay) {
        emitCue(cue, cueIndex);
      }
    }

    sceneClipGroups.push(sceneClips);
  }
}
