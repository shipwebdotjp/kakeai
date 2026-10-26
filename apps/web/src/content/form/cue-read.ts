import type { CueFormValue } from "./types";
import {
  ANIMATION_DURATION_SUFFIX,
  CROP_X_SUFFIX,
  CROP_Y_SUFFIX,
  CROP_ZOOM_SUFFIX,
  NESTED_COMPOSITION_FIT_SUFFIX,
  NESTED_COMPOSITION_POS_X_SUFFIX,
  NESTED_COMPOSITION_POS_Y_SUFFIX,
  NESTED_COMPOSITION_VERSION_SUFFIX,
  NESTED_COMPOSITION_ZOOM_SUFFIX,
  NESTED_MEDIA_FIT_SUFFIX,
  NESTED_MODE_COMPOSITION,
  NESTED_MODE_MEDIA,
  NESTED_MODE_SUFFIX,
  VIDEO_PLAYBACK_SUFFIX,
} from "./constants";
import { getAtPath, readInputObject } from "./paths";
import {
  DEFAULT_ANIMATION_POLICY,
  getVisualTemplate,
  chartEffectsSchema,
  chatEffectsSchema,
  CHART_APPEAR_PRESETS,
  flowEffectsSchema,
  quoteEffectsSchema,
  statEffectsSchema,
  tableEffectsSchema,
  videoPlaybackSchema,
  type AnimationPreset,
  type VisualCue,
  type VisualTemplateDefinition,
  type VideoPlayback,
} from "@kakeai/contracts";

export function parseVideoPlayback(
  raw: string | undefined,
): VideoPlayback | null {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }
  try {
    const parsed = videoPlaybackSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** VideoPlayback をフォーム内部フィールドの文字列へ直列化する。null は空文字。 */
export function serializeVideoPlayback(
  playback: VideoPlayback | null | undefined,
): string {
  if (playback === null || playback === undefined) {
    return "";
  }
  return JSON.stringify(playback);
}

const CHART_PRESET_FALLBACK: Record<string, string> = {
  "slide-up": "fade",
  "slide-down": "fade",
  "slide-left": "fade",
  "slide-right": "fade",
  "scale-in": "grow",
};
const CHART_APPEAR_PRESET_SET = new Set<string>(CHART_APPEAR_PRESETS);

function normalizeChartEffect(entry: unknown): unknown {
  if (typeof entry !== "object" || entry === null) {
    return entry;
  }
  const effect = (entry as { effect?: unknown }).effect;
  if (typeof effect !== "object" || effect === null) {
    return entry;
  }
  const preset = (effect as { preset?: unknown }).preset;
  if (typeof preset !== "string" || CHART_APPEAR_PRESET_SET.has(preset)) {
    return entry;
  }
  return {
    ...entry,
    effect: { ...effect, preset: CHART_PRESET_FALLBACK[preset] ?? "grow" },
  };
}

export function effectsSchemaForVariant(
  variant: "table" | "chart" | "flow" | "stat" | "quote" | "chat",
) {
  switch (variant) {
    case "chart":
      return chartEffectsSchema;
    case "flow":
      return flowEffectsSchema;
    case "stat":
      return statEffectsSchema;
    case "quote":
      return quoteEffectsSchema;
    case "chat":
      return chatEffectsSchema;
    case "table":
      return tableEffectsSchema;
  }
}

export function defaultEffectsForVariant(
  variant: "table" | "chart" | "flow" | "stat" | "quote" | "chat",
): unknown[] {
  switch (variant) {
    case "chat":
      return [];
    case "chart":
      return [
        {
          target: { kind: "bars" },
          trigger: { kind: "cue" },
          effect: {
            kind: "appear",
            preset: "grow",
            durationMs: 600,
            staggerMs: 120,
          },
        },
      ];
    case "flow":
      return [
        {
          target: { kind: "nodes" },
          trigger: { kind: "cue" },
          effect: {
            kind: "appear",
            preset: "fade",
            durationMs: 400,
            staggerMs: 120,
          },
        },
      ];
    case "stat":
      return [
        {
          trigger: { kind: "cue" },
          effect: { kind: "value", durationMs: 1000 },
        },
      ];
    case "quote":
      return [
        {
          trigger: { kind: "cue" },
          effect: { kind: "appear", preset: "fade", durationMs: 400 },
        },
      ];
    case "table":
      return [
        {
          target: { kind: "rows" },
          trigger: { kind: "cue" },
          effect: {
            kind: "appear",
            preset: "fade",
            durationMs: 400,
            staggerMs: 150,
          },
        },
      ];
  }
}

function readCueFields(
  input: Record<string, unknown>,
  definition: VisualTemplateDefinition,
): Record<string, string> {
  const fields = definition.inputFields ?? [];
  const result: Record<string, string> = {};
  for (const field of fields) {
    switch (field.kind) {
      case "media":
        result[field.key] =
          typeof input[field.key] === "string"
            ? (input[field.key] as string)
            : "";
        if (field.videoPlayback === true) {
          result[`${field.key}${VIDEO_PLAYBACK_SUFFIX}`] =
            serializeVideoPlayback(
              input.videoPlayback as VideoPlayback | undefined,
            );
        }
        break;
      case "nestedMedia": {
        const value = input[field.key];
        if (
          field.allowComposition === true &&
          typeof value === "object" &&
          value !== null &&
          (value as { kind?: unknown }).kind === "composition"
        ) {
          const composition = value as {
            compositionVersionId?: unknown;
            fit?: unknown;
            zoom?: unknown;
            position?: unknown;
          };
          const position =
            typeof composition.position === "object" &&
            composition.position !== null
              ? (composition.position as { x?: unknown; y?: unknown })
              : null;
          result[field.key] = "";
          result[`${field.key}${NESTED_MODE_SUFFIX}`] = NESTED_MODE_COMPOSITION;
          result[`${field.key}${NESTED_COMPOSITION_VERSION_SUFFIX}`] =
            typeof composition.compositionVersionId === "string"
              ? composition.compositionVersionId
              : "";
          result[`${field.key}${NESTED_COMPOSITION_FIT_SUFFIX}`] =
            composition.fit === "cover" ? "cover" : "contain";
          result[`${field.key}${NESTED_COMPOSITION_ZOOM_SUFFIX}`] =
            typeof composition.zoom === "number"
              ? String(Math.round(composition.zoom * 100))
              : "";
          result[`${field.key}${NESTED_COMPOSITION_POS_X_SUFFIX}`] =
            typeof position?.x === "number"
              ? String(Math.round(position.x * 100))
              : "";
          result[`${field.key}${NESTED_COMPOSITION_POS_Y_SUFFIX}`] =
            typeof position?.y === "number"
              ? String(Math.round(position.y * 100))
              : "";
          break;
        }
        const media =
          typeof value === "object" &&
          value !== null &&
          (value as { kind?: unknown }).kind === "media"
            ? (value as { assetId?: unknown; fit?: unknown })
            : null;
        result[field.key] =
          typeof media?.assetId === "string" ? media.assetId : "";
        result[`${field.key}${NESTED_MEDIA_FIT_SUFFIX}`] =
          media?.fit === "contain" ? "contain" : "cover";
        result[`${field.key}${NESTED_MODE_SUFFIX}`] = NESTED_MODE_MEDIA;
        if (field.videoPlayback === true) {
          result[`${field.key}${VIDEO_PLAYBACK_SUFFIX}`] =
            serializeVideoPlayback(
              (media as unknown as { videoPlayback?: VideoPlayback } | null)
                ?.videoPlayback,
            );
        }
        break;
      }
      case "mediaCrop": {
        const value = input[field.key];
        const point =
          typeof value === "object" && value !== null
            ? (value as { x?: unknown; y?: unknown })
            : null;
        result[`${field.key}${CROP_X_SUFFIX}`] =
          typeof point?.x === "number" ? String(Math.round(point.x * 100)) : "";
        result[`${field.key}${CROP_Y_SUFFIX}`] =
          typeof point?.y === "number" ? String(Math.round(point.y * 100)) : "";
        if (field.zoomKey !== undefined) {
          const zoom = input[field.zoomKey];
          result[`${field.key}${CROP_ZOOM_SUFFIX}`] =
            typeof zoom === "number" ? String(Math.round(zoom * 100)) : "";
        }
        break;
      }
      case "text":
      case "optionalText":
      case "color": {
        const value = getAtPath(input, field.key);
        result[field.key] = typeof value === "string" ? value : "";
        break;
      }
      case "number": {
        const value = getAtPath(input, field.key);
        result[field.key] = typeof value === "number" ? String(value) : "";
        break;
      }
      case "decimal": {
        const value = getAtPath(input, field.key);
        result[field.key] = typeof value === "number" ? String(value) : "";
        break;
      }
      case "boolean": {
        const value = getAtPath(input, field.key);
        result[field.key] = typeof value === "boolean" ? String(value) : "";
        break;
      }
      case "select": {
        const value = getAtPath(input, field.key);
        const text = typeof value === "string" ? value : "";
        const allowed = field.options.map((option) => option.value);
        if (allowed.includes(text)) {
          result[field.key] = text;
        } else if (field.optional) {
          result[field.key] = "";
        } else {
          result[field.key] = field.options[0]?.value ?? "";
        }
        break;
      }
      case "grid": {
        const value = getAtPath(input, field.key);
        result[field.key] =
          typeof value === "object" && value !== null
            ? JSON.stringify(value)
            : "";
        break;
      }
      case "flow": {
        const value = getAtPath(input, field.key);
        result[field.key] =
          typeof value === "object" && value !== null
            ? JSON.stringify(value)
            : "";
        break;
      }
      case "effects": {
        const value = getAtPath(input, field.key);
        if (!Array.isArray(value) || value.length === 0) {
          result[field.key] = "";
          break;
        }
        const entries =
          field.variant === "chart" ? value.map(normalizeChartEffect) : value;
        result[field.key] = JSON.stringify(entries);
        break;
      }
      case "calloutItems": {
        const value = getAtPath(input, field.key);
        result[field.key] = Array.isArray(value) ? JSON.stringify(value) : "";
        break;
      }
      case "messages": {
        const value = getAtPath(input, field.key);
        result[field.key] = Array.isArray(value) ? JSON.stringify(value) : "";
        break;
      }
      case "animation": {
        const value = input[field.key];
        const spec =
          typeof value === "object" && value !== null
            ? (value as { preset?: unknown; durationMs?: unknown })
            : null;
        const preset =
          typeof spec?.preset === "string" &&
          definition.animationPolicy.presets.includes(
            spec.preset as AnimationPreset,
          )
            ? (spec.preset as string)
            : "none";
        result[field.key] = preset;
        result[`${field.key}${ANIMATION_DURATION_SUFFIX}`] =
          typeof spec?.durationMs === "number"
            ? String(spec.durationMs)
            : String(DEFAULT_ANIMATION_POLICY.defaultDurationMs);
        break;
      }
    }
  }
  return result;
}

export function toCueFormValue(cue: VisualCue): CueFormValue {
  const input = readInputObject(cue);
  const definition = getVisualTemplate(cue.template.id, cue.template.version);
  const range = cue.range;
  return {
    id: cue.id,
    baseCue: cue,
    templateId: cue.template.id,
    templateVersion: cue.template.version,
    layer: cue.layer,
    order: cue.order,
    rangeKind: range.kind,
    startLineId: range.kind === "lines" ? range.startLineId : "",
    endLineId: range.kind === "lines" ? range.endLineId : "",
    startMs: range.kind === "offset" ? range.startMs : 0,
    endMs: range.kind === "offset" ? range.endMs : 0,
    enterPreset: cue.transition.enter.preset,
    enterDurationMs: cue.transition.enter.durationMs,
    exitPreset: cue.transition.exit.preset,
    exitDurationMs: cue.transition.exit.durationMs,
    fields: definition === undefined ? {} : readCueFields(input, definition),
  };
}
