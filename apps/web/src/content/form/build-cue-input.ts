import type { CueFormValue } from "./types";
import {
  ANIMATION_DURATION_SUFFIX,
  CROP_X_SUFFIX,
  CROP_Y_SUFFIX,
  CROP_ZOOM_MAX_PERCENT,
  CROP_ZOOM_MIN_PERCENT,
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
import { effectsSchemaForVariant, parseVideoPlayback } from "./cue-read";
import { deleteAtPath, readInputObject, setAtPath } from "./paths";
import { intOrZero } from "./build-common";
import {
  chartDataSchema,
  chatMessagesSchema,
  flowDiagramSchema,
  listCalloutItemsSchema,
  tableDataSchema,
  DEFAULT_STANDING_EDGE,
  DEFAULT_STANDING_VERTICAL,
  type AnimationPreset,
  type StandingSide,
  type VisualCue,
  type VisualTemplateDefinition,
} from "@kakeai/contracts";

export function buildRange(cue: CueFormValue): VisualCue["range"] {
  if (cue.rangeKind === "offset") {
    if (intOrZero(cue.startMs) > intOrZero(cue.endMs)) {
      throw new Error("表示区間のオフセットは開始 <= 終了にしてください");
    }
    return {
      kind: "offset",
      startMs: intOrZero(cue.startMs),
      endMs: intOrZero(cue.endMs),
    };
  }
  if (cue.rangeKind === "lines") {
    if (cue.startLineId.length === 0 || cue.endLineId.length === 0) {
      throw new Error("表示区間のセリフ（開始・終了）を選択してください");
    }
    return {
      kind: "lines",
      startLineId: cue.startLineId,
      endLineId: cue.endLineId,
    };
  }
  return { kind: "scene" };
}

function parseCropPercent(
  value: string | undefined,
  label: string,
): number | null {
  const trimmed = (value ?? "").trim();
  if (trimmed.length === 0) {
    return null;
  }
  const percent = Number(trimmed);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error(`${label}は 0〜100% の範囲で入力してください`);
  }
  return percent;
}

function parseCropZoomPercent(
  value: string | undefined,
  label: string,
): number | null {
  const trimmed = (value ?? "").trim();
  if (trimmed.length === 0) {
    return null;
  }
  const percent = Number(trimmed);
  if (
    !Number.isFinite(percent) ||
    percent < CROP_ZOOM_MIN_PERCENT ||
    percent > CROP_ZOOM_MAX_PERCENT
  ) {
    throw new Error(
      `${label}の拡大率は ${CROP_ZOOM_MIN_PERCENT}〜${CROP_ZOOM_MAX_PERCENT}% の範囲で入力してください`,
    );
  }
  return percent;
}

export function buildCueInput(
  cue: CueFormValue,
  definition: VisualTemplateDefinition,
): Record<string, unknown> | null {
  const fields = definition.inputFields ?? [];
  const base = readInputObject(cue.baseCue);
  const input: Record<string, unknown> = { ...base };
  let hasMedia = true;
  for (const field of fields) {
    const raw = cue.fields[field.key] ?? "";
    switch (field.kind) {
      case "media":
        if (raw.length === 0) {
          hasMedia = false;
          if (field.videoPlayback === true) {
            delete input.videoPlayback;
          }
        } else {
          input[field.key] = raw;
          if (field.videoPlayback === true) {
            const playback = parseVideoPlayback(
              cue.fields[`${field.key}${VIDEO_PLAYBACK_SUFFIX}`],
            );
            if (playback === null) {
              delete input.videoPlayback;
            } else {
              input.videoPlayback = playback;
            }
          }
        }
        break;
      case "nestedMedia": {
        const mode =
          cue.fields[`${field.key}${NESTED_MODE_SUFFIX}`] ?? NESTED_MODE_MEDIA;
        if (
          mode === NESTED_MODE_COMPOSITION &&
          field.allowComposition === true
        ) {
          const versionId =
            cue.fields[`${field.key}${NESTED_COMPOSITION_VERSION_SUFFIX}`] ??
            "";
          if (versionId.length === 0) {
            hasMedia = false;
            break;
          }
          const fit =
            cue.fields[`${field.key}${NESTED_COMPOSITION_FIT_SUFFIX}`] ===
            "cover"
              ? "cover"
              : "contain";
          const zoomPercent = parseCropZoomPercent(
            cue.fields[`${field.key}${NESTED_COMPOSITION_ZOOM_SUFFIX}`],
            field.label,
          );
          const posXPercent = parseCropPercent(
            cue.fields[`${field.key}${NESTED_COMPOSITION_POS_X_SUFFIX}`],
            field.label,
          );
          const posYPercent = parseCropPercent(
            cue.fields[`${field.key}${NESTED_COMPOSITION_POS_Y_SUFFIX}`],
            field.label,
          );
          const node: Record<string, unknown> = {
            kind: "composition",
            compositionVersionId: versionId,
            fit,
          };
          if (zoomPercent !== null) {
            node.zoom = zoomPercent / 100;
          }
          if (posXPercent !== null && posYPercent !== null) {
            node.position = { x: posXPercent / 100, y: posYPercent / 100 };
          } else if (posXPercent !== null || posYPercent !== null) {
            throw new Error(
              `${field.label}の位置は横と縦の両方を指定してください`,
            );
          }
          input[field.key] = node;
          break;
        }
        if (raw.length === 0) {
          const baseValue = base[field.key];
          const baseIsMedia =
            typeof baseValue === "object" &&
            baseValue !== null &&
            (baseValue as { kind?: unknown }).kind === "media";
          if (baseValue === undefined || baseIsMedia) {
            if (field.optional) {
              delete input[field.key];
            } else {
              hasMedia = false;
            }
          }
        } else {
          const fit =
            cue.fields[`${field.key}${NESTED_MEDIA_FIT_SUFFIX}`] === "contain"
              ? "contain"
              : "cover";
          const node: Record<string, unknown> = {
            kind: "media",
            assetId: raw,
            fit,
          };
          if (field.videoPlayback === true) {
            const playback = parseVideoPlayback(
              cue.fields[`${field.key}${VIDEO_PLAYBACK_SUFFIX}`],
            );
            if (playback !== null) {
              node.videoPlayback = playback;
            }
          }
          input[field.key] = node;
        }
        break;
      }
      case "mediaCrop": {
        const xPercent = parseCropPercent(
          cue.fields[`${field.key}${CROP_X_SUFFIX}`],
          field.label,
        );
        const yPercent = parseCropPercent(
          cue.fields[`${field.key}${CROP_Y_SUFFIX}`],
          field.label,
        );
        if (xPercent === null && yPercent === null) {
          deleteAtPath(input, field.key);
        } else if (xPercent === null || yPercent === null) {
          throw new Error(`${field.label}は横と縦の両方を指定してください`);
        } else {
          setAtPath(input, field.key, { x: xPercent / 100, y: yPercent / 100 });
        }
        if (field.zoomKey !== undefined) {
          const zoomPercent = parseCropZoomPercent(
            cue.fields[`${field.key}${CROP_ZOOM_SUFFIX}`],
            field.label,
          );
          if (zoomPercent === null) {
            deleteAtPath(input, field.zoomKey);
          } else {
            setAtPath(input, field.zoomKey, zoomPercent / 100);
          }
        }
        break;
      }
      case "text":
        setAtPath(input, field.key, raw);
        break;
      case "optionalText":
        if (raw.length > 0) {
          setAtPath(input, field.key, raw);
        } else {
          deleteAtPath(input, field.key);
        }
        break;
      case "select": {
        const allowed = field.options.map((option) => option.value);
        if (allowed.includes(raw)) {
          setAtPath(input, field.key, raw);
        } else if (field.optional) {
          deleteAtPath(input, field.key);
        } else {
          setAtPath(input, field.key, field.options[0]?.value ?? "");
        }
        break;
      }
      case "grid": {
        const trimmed = raw.trim();
        if (trimmed.length === 0) {
          deleteAtPath(input, field.key);
          break;
        }
        let parsedJson: unknown;
        const isChart = field.dataKind === "chart";
        const errorMessage = isChart
          ? "グラフデータを正しく入力してください"
          : "表データを正しく入力してください";
        try {
          parsedJson = JSON.parse(trimmed);
        } catch {
          throw new Error(errorMessage);
        }
        const schema = isChart ? chartDataSchema : tableDataSchema;
        const validated = schema.safeParse(parsedJson);
        if (!validated.success) {
          throw new Error(errorMessage);
        }
        setAtPath(input, field.key, validated.data);
        break;
      }
      case "flow": {
        const trimmed = raw.trim();
        if (trimmed.length === 0) {
          deleteAtPath(input, field.key);
          break;
        }
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(trimmed);
        } catch {
          throw new Error("ノードと辺を正しく入力してください");
        }
        const validated = flowDiagramSchema.safeParse(parsedJson);
        if (!validated.success) {
          const detail = validated.error.issues[0];
          const where =
            detail && detail.path.length > 0
              ? `（${detail.path.join(".")}）`
              : "";
          throw new Error(`ノードと辺を正しく入力してください${where}`);
        }
        setAtPath(input, field.key, validated.data);
        break;
      }
      case "effects": {
        const trimmed = raw.trim();
        if (trimmed.length === 0) {
          deleteAtPath(input, field.key);
          break;
        }
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(trimmed);
        } catch {
          throw new Error("セリフ同期の効果を正しく入力してください");
        }
        const schema = effectsSchemaForVariant(field.variant);
        const validated = schema.safeParse(parsedJson);
        if (!validated.success) {
          throw new Error("セリフ同期の効果を正しく入力してください");
        }
        setAtPath(input, field.key, validated.data);
        break;
      }
      case "calloutItems": {
        const trimmed = raw.trim();
        if (trimmed.length === 0) {
          throw new Error("ポイントを1つ以上入力してください");
        }
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(trimmed);
        } catch {
          throw new Error("ポイントを正しく入力してください");
        }
        const validated = listCalloutItemsSchema.safeParse(parsedJson);
        if (!validated.success) {
          const detail = validated.error.issues[0];
          const where =
            detail && detail.path.length > 0
              ? `（${detail.path.join(".")}）`
              : "";
          throw new Error(`ポイントを正しく入力してください${where}`);
        }
        setAtPath(input, field.key, validated.data);
        break;
      }
      case "messages": {
        const trimmed = raw.trim();
        if (trimmed.length === 0) {
          throw new Error("メッセージを1つ以上入力してください");
        }
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(trimmed);
        } catch {
          throw new Error("メッセージを正しく入力してください");
        }
        const validated = chatMessagesSchema.safeParse(parsedJson);
        if (!validated.success) {
          const detail = validated.error.issues[0];
          const where =
            detail && detail.path.length > 0
              ? `（${detail.path.join(".")}）`
              : "";
          throw new Error(`メッセージを正しく入力してください${where}`);
        }
        setAtPath(input, field.key, validated.data);
        break;
      }
      case "color": {
        const color = raw.trim();
        if (color.length > 0) {
          if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
            throw new Error("背景色は #RRGGBB 形式で入力してください");
          }
          setAtPath(input, field.key, color.toUpperCase());
        } else {
          deleteAtPath(input, field.key);
        }
        break;
      }
      case "number": {
        const trimmed = raw.trim();
        if (trimmed.length === 0) {
          deleteAtPath(input, field.key);
        } else {
          const value = Number(trimmed);
          if (!Number.isInteger(value)) {
            throw new Error(`${field.label}は整数で入力してください`);
          }
          if (
            (field.min !== undefined && value < field.min) ||
            (field.max !== undefined && value > field.max)
          ) {
            throw new Error(
              `${field.label}は ${field.min ?? ""}〜${field.max ?? ""} の範囲で入力してください`,
            );
          }
          setAtPath(input, field.key, value);
        }
        break;
      }
      case "decimal": {
        const trimmed = raw.trim();
        if (trimmed.length === 0) {
          if (field.optional) {
            deleteAtPath(input, field.key);
          } else {
            setAtPath(input, field.key, 0);
          }
        } else {
          const value = Number(trimmed);
          if (!Number.isFinite(value)) {
            throw new Error(`${field.label}は数値で入力してください`);
          }
          if (
            (field.min !== undefined && value < field.min) ||
            (field.max !== undefined && value > field.max)
          ) {
            throw new Error(
              `${field.label}は ${field.min ?? ""}〜${field.max ?? ""} の範囲で入力してください`,
            );
          }
          setAtPath(input, field.key, value);
        }
        break;
      }
      case "boolean": {
        if (raw === "") {
          deleteAtPath(input, field.key);
        } else {
          setAtPath(input, field.key, raw === "true");
        }
        break;
      }
      case "animation": {
        const policy = definition.animationPolicy;
        if (
          raw === "" ||
          raw === "none" ||
          !policy.presets.includes(raw as AnimationPreset)
        ) {
          delete input[field.key];
        } else {
          const durationMs = Math.min(
            policy.maxDurationMs,
            intOrZero(
              Number(
                cue.fields[`${field.key}${ANIMATION_DURATION_SUFFIX}`] ?? "0",
              ),
            ),
          );
          input[field.key] = { preset: raw, durationMs };
        }
        break;
      }
    }
  }
  if (!hasMedia) {
    return null;
  }
  return input;
}
