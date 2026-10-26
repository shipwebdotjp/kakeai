import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  OctagonAlert,
  Plus,
  Save,
  Trash2,
  TriangleAlert,
  Video,
} from "lucide-react";
import {
  useFieldArray,
  useForm,
  useWatch,
  type Control,
  type UseFormGetValues,
  type UseFormRegister,
  type UseFormSetValue,
} from "react-hook-form";
import {
  contentDocumentSchema,
  DEFAULT_VISUAL_THEME_REF,
  getVisualTheme,
  resolveCharacterName,
  type Asset,
  type BulkTtsJobExclusion,
  type CharacterLibraryEntry,
  type ContentDocument,
  type FaceSet,
  type ScriptOperation,
  type ScriptVersion,
  type VoiceAdapterId,
  type VoiceProfile,
  type Warning,
  type ThemeAccentToken,
  type TtsJobResult,
} from "@kakeai/contracts";
import { ApiError } from "../api/client";
import { diagnosticTarget, type Diagnostic, type DiagnosticTarget } from "../content/diagnostics";
import { resolveTimeline } from "@kakeai/video/timeline";
import {
  useAdapterVoicesMap,
  useAssets,
  useBulkGenerateTtsTakes,
  useCharacters,
  useFaceSets,
  useSaveScriptVersion,
  useThemes,
  useVoiceProfiles,
  type BulkTtsFailure,
} from "../api/hooks";
import {
  buildContentDocument,
  bulkTtsCandidateLineIds,
  cloneSceneFormValue,
  collectSceneIds,
  countCharacterFormUsage,
  generatedTakePolicy,
  mergeTake,
  newAppearanceId,
  newCharacterId,
  newSceneId,
  newSpeakerId,
  nextPointLabel,
  toFormValues,
  DEFAULT_BGM_GAIN_DB,
  type CharacterFormValue,
  type DocumentFormValues,
  type SceneAccentKind,
  type SceneFormValue,
  type SpeakerFormValue,
} from "../content/form";
import {
  applyStructuralOperation,
  commitBgmStructural,
  commitCueStructural,
  commitSceneAudioStructural,
  commitStandingStructural,
  copyCueStructural,
  copyStandingsStructural,
  moveCueStructural,
  removeCueStructural,
  transferStandingsStructural,
  type StandingTransferMode,
  type StructuralEditResult,
} from "../content/structural";
import { SCENE_LABELS, sceneDisplayName } from "../content/labels";
import { sceneNavProjection } from "../content/navProjection";
import { AssetThumbnail, assetLabel } from "../lib/assets";
import type { AdapterVoicesState } from "../lib/voiceAdapters";
import {
  captureEditorScrollAnchor,
  restoreEditorScrollAnchor,
  scrollEditorTargetIntoView,
  type EditorScrollAnchor,
} from "../lib/editorScroll";
import { errorMessage } from "../lib/errorMessage";
import type { UnsavedDocumentState } from "../lib/useDraftPreview";
import {
  badgeDangerClass,
  badgeInfoClass,
  badgeNeutralClass,
  badgeWarningClass,
  buttonDangerClass,
  buttonNeutralClass,
  buttonPrimaryClass,
  colorFieldClass,
  detailsSummaryClass,
  editAreaClass,
  errorTextClass,
  formLabelClass,
  iconButtonLargeClass,
  metaTextClass,
  sectionCardClass,
  sectionSummaryClass,
  sectionTitleClass,
  textFieldClass,
} from "../ui";
import { CharacterFields } from "./CharacterFields";
import { Collapsible, useCollapsibleStore, useStoredCollapsible } from "./Collapsible";
import {
  sceneFoldKey,
  sectionFoldKey,
} from "../lib/collapseState";
import { CueList, ScriptSkinProvider } from "./CueList";
import { LinesEditor } from "./LinesEditor";
import { MediaPicker } from "./MediaPicker";
import { ScenePickerModal, type ScenePickerTarget } from "./ScenePickerModal";
import { ScriptImportModal } from "./ScriptImportModal";
import { StandingFields } from "./StandingFields";
import { SceneAudioFields } from "./SceneAudioFields";

const DRAFT_PREVIEW_DEBOUNCE_MS = 800;

type PendingEditorScroll =
  | { kind: "anchor"; anchor: EditorScrollAnchor }
  | { kind: "reveal"; targetId: string };

function resolveInsertionTargetId(
  scenes: readonly Pick<SceneFormValue, "id" | "kind">[],
  selectedId: string | null,
): string | null {
  const candidates = scenes.filter((scene) => scene.kind !== "intro");
  if (candidates.length === 0) {
    return null;
  }
  if (selectedId !== null && candidates.some((scene) => scene.id === selectedId)) {
    return selectedId;
  }
  const outro = candidates.find((scene) => scene.kind === "outro");
  return outro?.id ?? candidates[candidates.length - 1]?.id ?? null;
}

interface SceneEditorProps {
  base: ContentDocument;
  editionId: string;
  scriptVersionId: string;
  onSaved?: (scriptVersion: ScriptVersion) => void;
  onValuesChange?: (scenes: SceneFormValue[], speakers: SpeakerFormValue[], characters: CharacterFormValue[]) => void;
  onJumpToLine?: (lineId: string) => void;
  onJumpToTarget?: (targetId: string, seek: DiagnosticTarget["seek"]) => void;
  onDocumentChange?: (state: UnsavedDocumentState) => void;
  onDirtyChange?: (dirty: boolean) => void;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
}

function extractServerErrors(error: unknown): Diagnostic[] {
  if (
    error instanceof ApiError &&
    error.details &&
    typeof error.details === "object" &&
    "issues" in error.details &&
    Array.isArray((error.details as { issues: unknown }).issues)
  ) {
    return (
      error.details as {
        issues: { path?: (string | number)[]; code?: string; message: string }[];
      }
    ).issues.map((issue) => ({
      path: issue.path,
      code: issue.code,
      message: issue.message ?? "入力エラーが発生しました",
    }));
  }
  return [{ message: errorMessage(error) }];
}

interface TimingFieldsProps {
  control: Control<DocumentFormValues>;
  register: UseFormRegister<DocumentFormValues>;
  setValue: UseFormSetValue<DocumentFormValues>;
  sceneIndex: number;
  sceneKind: "intro" | "point" | "outro" | "insert";
  insertLoop?: boolean;
}

const THEME_ACCENTS = getVisualTheme(
  DEFAULT_VISUAL_THEME_REF.id,
  DEFAULT_VISUAL_THEME_REF.version,
)?.accents ?? { primary: "#19736D", secondary: "#A84D3E", tertiary: "#80600F" };

const ACCENT_TOKEN_OPTIONS: readonly { value: ThemeAccentToken; label: string }[] = [
  { value: "primary", label: `プライマリ（${THEME_ACCENTS.primary}）` },
  { value: "secondary", label: `セカンダリ（${THEME_ACCENTS.secondary}）` },
  { value: "tertiary", label: `ターシャリ（${THEME_ACCENTS.tertiary}）` },
];

function TimingFields({ control, register, setValue, sceneIndex, sceneKind, insertLoop = false }: TimingFieldsProps) {
  const mode = useWatch({ control, name: `scenes.${sceneIndex}.timingMode` });
  const accentKind = useWatch({ control, name: `scenes.${sceneIndex}.accentKind` });
  const accentColor = useWatch({ control, name: `scenes.${sceneIndex}.accentColor` });
  const transitionPreset = useWatch({ control, name: `scenes.${sceneIndex}.transitionPreset` });
  const fixedOnly = sceneKind !== "point";
  return (
    <div className="my-2 flex flex-wrap items-center gap-3">
      <label className={formLabelClass}>
        アクセント
        <select
          className={textFieldClass}
          value={accentKind}
          onChange={(event) => {
            const next = event.target.value as SceneAccentKind;
            setValue(`scenes.${sceneIndex}.accentKind`, next, { shouldDirty: true });
            if (next === "custom" && !/^#[0-9A-Fa-f]{6}$/.test(accentColor)) {
              setValue(`scenes.${sceneIndex}.accentColor`, THEME_ACCENTS.primary, {
                shouldDirty: true,
              });
            }
          }}
        >
          <option value="theme">テーマ色</option>
          <option value="custom">自由色</option>
        </select>
      </label>
      {accentKind === "custom" ? (
        <label className={formLabelClass}>
          自由色
          <input
            type="color"
            className={colorFieldClass}
            {...register(`scenes.${sceneIndex}.accentColor`)}
          />
        </label>
      ) : (
        <label className={formLabelClass}>
          テーマ色
          <select className={textFieldClass} {...register(`scenes.${sceneIndex}.accentToken`)}>
            {ACCENT_TOKEN_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className={formLabelClass}>
        尺
        <select className={textFieldClass} {...register(`scenes.${sceneIndex}.timingMode`)}>
          {!fixedOnly && <option value="auto">自動</option>}
          <option value="fixed">固定</option>
        </select>
      </label>
      {mode === "fixed" && (sceneKind !== "insert" || insertLoop) && (
        <label className={formLabelClass}>
          固定尺(ms)
          <input
            type="number"
            min={1}
            className={`w-24 ${textFieldClass}`}
            {...register(`scenes.${sceneIndex}.durationMs`, { valueAsNumber: true })}
          />
        </label>
      )}
      {sceneIndex > 0 && (
        <>
          <label className={formLabelClass}>
            シーン切替
            <select
              className={textFieldClass}
              {...register(`scenes.${sceneIndex}.transitionPreset`)}
            >
              <option value="cut">カット</option>
              <option value="fade">フェード</option>
              <option value="crossfade">クロスフェード</option>
            </select>
          </label>
          {transitionPreset !== "cut" && (
            <label className={formLabelClass}>
              切替尺(ms)
              <input
                type="number"
                min={1}
                className={`w-24 ${textFieldClass}`}
                {...register(`scenes.${sceneIndex}.transitionDurationMs`, { valueAsNumber: true, min: 1 })}
              />
            </label>
          )}
        </>
      )}
    </div>
  );
}

const SCENE_TRANSITION_LABELS: Record<string, string> = {
  cut: "カット",
  fade: "フェード",
  crossfade: "クロスフェード",
};

type ScenePickerRequest =
  | { kind: "move-cue" | "copy-cue"; sceneId: string; cueId: string }
  | { kind: "move-standing" | "copy-standing" | "swap-standing"; sceneId: string };

const SCENE_PICKER_COPY: Record<
  ScenePickerRequest["kind"],
  { title: string; description: string; mode: "single" | "multiple"; confirmLabel: string }
> = {
  "move-cue": {
    title: "別のシーンへ移動",
    description:
      "移動すると表示区間はシーン全体に戻り、セリフ同期のトリガーはシーン全体に変わります。移動先で選び直してください。",
    mode: "single",
    confirmLabel: "移動する",
  },
  "copy-cue": {
    title: "別のシーンへ複製",
    description:
      "複製すると表示区間はシーン全体に戻り、セリフ同期のトリガーはシーン全体に変わります。複製先で選び直してください。",
    mode: "multiple",
    confirmLabel: "別のシーンへ複製",
  },
  "move-standing": {
    title: "立ち絵を別のシーンへ移動",
    description: "移動先の立ち絵（左・右）はこのシーンの設定で置き換わり、このシーンの立ち絵は削除されます。",
    mode: "single",
    confirmLabel: "移動する",
  },
  "copy-standing": {
    title: "立ち絵を別のシーンへ複製",
    description: "複製先の立ち絵（左・右）はこのシーンの設定で置き換わります。このシーンの立ち絵はそのまま残ります。",
    mode: "multiple",
    confirmLabel: "別のシーンへ複製",
  },
  "swap-standing": {
    title: "立ち絵を別のシーンと入れ替え",
    description: "2つのシーンの立ち絵（左・右）を丸ごと入れ替えます。",
    mode: "single",
    confirmLabel: "入れ替え",
  },
};

function standingTransferModeOf(
  kind: Extract<ScenePickerRequest["kind"], `${string}-standing`>,
): StandingTransferMode {
  const modeMap = {
    "move-standing": "move",
    "copy-standing": "copy",
    "swap-standing": "swap",
  } as const;
  return modeMap[kind];
}

function hasConfiguredStanding(standing: {
  characterId: string | null;
  appearanceId: string | null;
}): boolean {
  return standing.characterId !== null && standing.appearanceId !== null;
}

function pickerTargets(
  scenes: readonly SceneFormValue[],
  excludeSceneId: string,
): ScenePickerTarget[] {
  return scenes
    .filter((scene) => scene.id !== excludeSceneId && scene.kind !== "insert")
    .map((scene) => ({
      id: scene.id,
      label: scene.label,
      kind: scene.kind,
      lineCount: scene.lines.length,
      cueCount: scene.cues.length,
      standingCount: scene.standings.filter(hasConfiguredStanding).length,
    }));
}

function isMiddleScene(kind: SceneFormValue["kind"] | undefined): boolean {
  return kind === "point" || kind === "insert";
}

function sceneHasStandings(scene: SceneFormValue): boolean {
  return scene.standings.some(hasConfiguredStanding);
}

function resolveMainCueIndex(
  cues: readonly { id: string }[],
  mainVisualCueId: string,
): number {
  return cues.findIndex((cue) => cue.id === mainVisualCueId);
}

function insertAssetStatusMessage(
  assetId: string,
  isLoading: boolean,
  isError: boolean,
): string {
  if (assetId.length === 0) {
    return "動画を選択してください";
  }
  if (isLoading) {
    return "素材を確認しています…";
  }
  if (isError) {
    return "素材を確認できません";
  }
  return "選択中の動画が見つかりません（削除された可能性）";
}

function assetAudioLabel(asset: Asset | undefined): string {
  if (asset === undefined) {
    return "音声ストリーム不明";
  }
  return asset.hasAudio ? "音声ストリームあり" : "音声ストリームなし";
}

function sceneSettingsSummary(scene: SceneFormValue, sceneIndex: number): string {
  const parts = [scene.accentKind === "custom" ? "自由色" : "テーマ色"];
  parts.push(scene.timingMode === "fixed" ? `固定 ${scene.durationMs}ms` : "自動");
  if (sceneIndex > 0) {
    parts.push(SCENE_TRANSITION_LABELS[scene.transitionPreset] ?? scene.transitionPreset);
  }
  return parts.join(" / ");
}

interface InsertSceneFieldsProps {
  scene: SceneFormValue;
  sceneIndex: number;
  assets: readonly Asset[];
  assetsLoading: boolean;
  assetsError: boolean;
  register: UseFormRegister<DocumentFormValues>;
  setValue: UseFormSetValue<DocumentFormValues>;
  onError: (message: string) => void;
  /** SceneEditor側の折りたたみ内に置くときは外枠を出さない */
  bare?: boolean;
}

function InsertSceneFields({
  scene,
  sceneIndex,
  assets,
  assetsLoading,
  assetsError,
  register,
  setValue,
  onError,
  bare = false,
}: InsertSceneFieldsProps) {
  const mainCueIndex = resolveMainCueIndex(scene.cues, scene.mainVisualCueId);
  const mainCue = mainCueIndex === -1 ? undefined : scene.cues[mainCueIndex];
  const fields = mainCue?.fields ?? {};
  const assetId = fields.assetId ?? "";
  const asset = assets.find((entry) => entry.id === assetId);
  const assetDurationMs = asset?.durationMs ?? null;
  const loop = fields.loop === "true";
  const rawTrimStart = fields.trimStartMs ?? "";
  const rawTrimEnd = fields.trimEndMs ?? "";
  const parsedTrimStart = rawTrimStart === "" ? 0 : Number(rawTrimStart);
  const parsedTrimEnd = rawTrimEnd === "" ? null : Number(rawTrimEnd);
  const trimStartMs =
    Number.isInteger(parsedTrimStart) && parsedTrimStart >= 0 ? parsedTrimStart : 0;
  const trimEndValid =
    parsedTrimEnd === null ||
    (Number.isInteger(parsedTrimEnd) &&
      parsedTrimEnd > trimStartMs &&
      (assetDurationMs === null || parsedTrimEnd <= assetDurationMs));
  const trimStartValid =
    rawTrimStart === "" ||
    (Number.isInteger(parsedTrimStart) &&
      parsedTrimStart >= 0 &&
      (assetDurationMs === null || parsedTrimStart < assetDurationMs));
  const trimEndMs =
    parsedTrimEnd !== null && trimEndValid ? parsedTrimEnd : assetDurationMs;
  const clipMs =
    trimStartValid && trimEndValid && trimEndMs !== null && assetDurationMs !== null
      ? trimEndMs - trimStartMs
      : null;
  let trimError: string | null = null;
  if (!trimStartValid) {
    trimError = "トリム開始はミリ秒の整数（0以上、動画尺未満）で入力してください。";
  } else if (!trimEndValid) {
    trimError =
      parsedTrimEnd !== null && assetDurationMs !== null && parsedTrimEnd > assetDurationMs
        ? "トリム終了が動画の尺を超えています。"
        : "トリム終了は開始より大きく、ミリ秒の整数で入力してください。";
  }

  useEffect(() => {
    if (clipMs === null || clipMs <= 0) {
      return;
    }
    if (loop && scene.durationMs >= clipMs) {
      return;
    }
    if (!loop && scene.durationMs === clipMs) {
      return;
    }
    setValue(`scenes.${sceneIndex}.durationMs`, clipMs, { shouldDirty: true });
  }, [clipMs, loop, scene.durationMs, sceneIndex, setValue]);

  const setField = (key: string, value: string) => {
    if (mainCueIndex === -1) {
      return;
    }
    setValue(`scenes.${sceneIndex}.cues.${mainCueIndex}.fields.${key}`, value, {
      shouldDirty: true,
    });
  };

  return (
    <div className={bare ? "flex flex-col gap-2" : `${editAreaClass} flex flex-col gap-2`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">インサート動画</span>
        {asset === undefined ? (
          <span className={metaTextClass}>
            {insertAssetStatusMessage(assetId, assetsLoading, assetsError)}
          </span>
        ) : (
          <>
            <AssetThumbnail asset={asset} />
            <span className="truncate text-xs">{assetLabel(asset)}</span>
          </>
        )}
        <MediaPicker
          label="動画を差し替え"
          kinds={["video"]}
          selectedAssetId={assetId.length > 0 ? assetId : null}
          onSelect={(nextId) => {
            if (nextId === null) {
              return;
            }
            const next = assets.find((entry) => entry.id === nextId);
            if (next === undefined) {
              onError("素材一覧を確認できません。読み込み後に選び直してください。");
              return;
            }
            if (next.kind !== "video") {
              onError("インサートSceneには動画素材だけを指定できます。");
              return;
            }
            if (next.durationMs === null || next.durationMs <= 0) {
              onError("尺が確定していない動画はインサートSceneに指定できません。");
              return;
            }
            if (mainCue === undefined) {
              onError("主動画の映像演出を特定できません。動画を追加し直してください。");
              return;
            }
            setValue(`scenes.${sceneIndex}.cues.${mainCueIndex}.fields.assetId`, next.id, {
              shouldDirty: true,
            });
            setValue(`scenes.${sceneIndex}.cues.${mainCueIndex}.fields.trimStartMs`, "", {
              shouldDirty: true,
            });
            setValue(`scenes.${sceneIndex}.cues.${mainCueIndex}.fields.trimEndMs`, "", {
              shouldDirty: true,
            });
            setValue(`scenes.${sceneIndex}.durationMs`, next.durationMs, { shouldDirty: true });
          }}
          inline
        />
      </div>
      <p className={metaTextClass}>
        動画尺:{" "}
        {assetDurationMs !== null && Number.isFinite(assetDurationMs)
          ? `${(assetDurationMs / 1000).toFixed(2)}秒`
          : "不明"}
        {clipMs !== null && clipMs > 0 && (
          <> ／ 使用区間: {(trimStartMs / 1000).toFixed(2)}〜{((trimStartMs + clipMs) / 1000).toFixed(2)}秒（{(clipMs / 1000).toFixed(2)}秒）</>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className={formLabelClass}>
          トリム開始(ms)
          <input
            type="number"
            min={0}
            step={1}
            className={`w-24 ${textFieldClass}`}
            placeholder="0"
            value={fields.trimStartMs ?? ""}
            onChange={(event) => setField("trimStartMs", event.target.value)}
          />
        </label>
        <label className={formLabelClass}>
          トリム終了(ms)
          <input
            type="number"
            min={0}
            step={1}
            className={`w-24 ${textFieldClass}`}
            placeholder={assetDurationMs !== null ? String(assetDurationMs) : ""}
            value={fields.trimEndMs ?? ""}
            onChange={(event) => setField("trimEndMs", event.target.value)}
          />
        </label>
        <label className={formLabelClass}>
          <input
            type="checkbox"
            checked={loop}
            onChange={(event) => setField("loop", event.target.checked ? "true" : "")}
          />
          ループ再生
        </label>
      </div>
      {trimError !== null && <p className={errorTextClass}>{trimError}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <span className={asset?.hasAudio === true ? badgeInfoClass : badgeNeutralClass}>
          {assetAudioLabel(asset)}
        </span>
        <label className={formLabelClass}>
          <input
            type="checkbox"
            {...register(`scenes.${sceneIndex}.embeddedAudio`)}
          />
          埋め込み音声を再生
        </label>
        <label className={formLabelClass}>
          音量
          <input
            type="number"
            step={1}
            min={-60}
            max={12}
            disabled={!scene.embeddedAudio || asset?.hasAudio !== true}
            className={`w-20 ${textFieldClass}`}
            {...register(`scenes.${sceneIndex}.embeddedAudioGainDb`, {
              setValueAs: (value) => {
                const parsed = Number(value);
                return value === "" || !Number.isFinite(parsed) ? 0 : parsed;
              },
            })}
          />
          dB
        </label>
        {scene.embeddedAudio && <span className={badgeNeutralClass}>作品全体BGMをこの区間で抑制</span>}
        {scene.embeddedAudio && asset !== undefined && asset.hasAudio === false && (
          <span className={badgeNeutralClass}>この区間は無音になります</span>
        )}
      </div>
      {mainCueIndex === -1 && (
        <p className={errorTextClass}>主動画の映像演出が見つかりません。動画を選び直してください。</p>
      )}
      {asset !== undefined && asset.kind !== "video" && (
        <p className={errorTextClass}>動画以外の素材は主動画に指定できません。</p>
      )}
      <p className={metaTextClass}>
        初期版では速度変更・逆再生には対応していません。ループ時は使用区間をScene尺まで繰り返します。
      </p>
    </div>
  );
}

interface SceneBlockProps {
  control: Control<DocumentFormValues>;
  register: UseFormRegister<DocumentFormValues>;
  getValues: UseFormGetValues<DocumentFormValues>;
  setValue: UseFormSetValue<DocumentFormValues>;
  base: ContentDocument;
  scene: SceneFormValue;
  sceneIndex: number;
  pointOrdinal: number;
  prevKind: SceneFormValue["kind"] | undefined;
  nextKind: SceneFormValue["kind"] | undefined;
  durationMs: number | null;
  durationError: string | null;
  durationLines: readonly {
    lineId: string;
    startMs: number;
    endMs: number;
    gapBeforeMs: number;
    durationMs: number;
  }[];
  errorCount: number;
  warningCount: number;
  assets: readonly Asset[];
  assetsLoading: boolean;
  assetsError: boolean;
  speakers: SpeakerFormValue[];
  characters: CharacterFormValue[];
  voiceProfiles: VoiceProfile[];
  adapterVoices: Record<VoiceAdapterId, AdapterVoicesState>;
  savedVoiceByLineId: ReadonlyMap<string, string | null>;
  bulkRunning: boolean;
  faceSets: FaceSet[];
  faceSetsReady: boolean;
  scriptVersionId: string;
  onMove: (sceneIndex: number, direction: -1 | 1) => void;
  onRemoveScene: (sceneIndex: number) => void;
  onClonePrevious: (sceneIndex: number) => void;
  onRemoveCue: (sceneIndex: number, cueId: string) => void;
  onCommitCue: (sceneIndex: number, cueId: string) => void;
  onMoveCueRequest: (sceneIndex: number, cueId: string) => void;
  onCopyCueRequest: (sceneIndex: number, cueId: string) => void;
  onCommitStanding: (sceneIndex: number, side: "left" | "right") => void;
  onTransferStandingsRequest: (sceneIndex: number, mode: StandingTransferMode) => void;
  onCommitAudioCue: (sceneIndex: number, cueIndex: number) => void;
  onSplitScene: (sceneIndex: number, lineIndex: number) => void;
  onJumpToLine?: (lineId: string) => void;
  onWarnings: (warnings: Warning[]) => void;
  onError: (message: string) => void;
}

function SceneBlock(props: SceneBlockProps) {
  const { scene, sceneIndex } = props;
  const [sceneOpen, setSceneOpen] = useStoredCollapsible(sceneFoldKey(scene.id), false);
  const bodyId = useId();
  const displayName = sceneDisplayName(scene, props.pointOrdinal);
  const lineCount = scene.lines.length;
  const cueCount = scene.cues.length;
  const audioCount = scene.audioCues.length;
  const unvoicedCount =
    scene.kind === "point"
      ? scene.lines.filter((line) => line.selectedAudioTakeId === null).length
      : 0;
  const durationText =
    props.durationMs !== null
      ? `${(props.durationMs / 1000).toFixed(1)}秒`
      : (props.durationError ?? "尺不明");
  const headerSummary =
    scene.kind === "point"
      ? `セリフ${lineCount}件・映像演出${cueCount}件・${durationText}`
      : `映像演出${cueCount}件・${durationText}`;

  return (
    <section id={`scene-${scene.id}`} className={sectionCardClass}>
      <div className="mt-0 mb-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={sceneOpen}
          aria-controls={bodyId}
          aria-label={`シーン「${displayName}」を${sceneOpen ? "閉じる" : "開く"}`}
          onClick={() => setSceneOpen(!sceneOpen)}
          className={detailsSummaryClass}
        >
          <ChevronDown
            aria-hidden="true"
            className={`h-4 w-4 shrink-0 transition-transform ${sceneOpen ? "" : "-rotate-90"}`}
          />
          <span className="font-normal text-muted-foreground">{headerSummary}</span>
          {unvoicedCount > 0 && (
            <span className={badgeWarningClass}>未音声{unvoicedCount}件</span>
          )}
          {props.errorCount > 0 && (
            <span className={badgeDangerClass}>エラー{props.errorCount}件</span>
          )}
          {props.warningCount > 0 && (
            <span className={badgeWarningClass}>警告{props.warningCount}件</span>
          )}
        </button>
        <input
          aria-label="シーン名"
          placeholder="シーン名"
          className={`min-w-[160px] flex-1 font-semibold ${textFieldClass}`}
          {...props.register(`scenes.${sceneIndex}.label`)}
        />
        <span className={scene.kind === "point" ? badgeInfoClass : badgeNeutralClass}>
          {SCENE_LABELS[scene.kind] ?? scene.kind}
        </span>
        <span className="font-mono text-xs text-muted-foreground">{scene.id}</span>
        {(scene.kind === "point" || scene.kind === "insert") && (
          <span className="ml-auto flex gap-1">
            {scene.kind === "point" && (
              <button
                type="button"
                className={buttonNeutralClass}
                disabled={props.prevKind !== "point"}
                onClick={() => props.onClonePrevious(sceneIndex)}
              >
                <Copy aria-hidden="true" className="h-4 w-4" />
                前のシーンを複製
              </button>
            )}
            <button
              type="button"
              className={iconButtonLargeClass}
              aria-label="上へ移動"
              title="上へ移動"
              disabled={!isMiddleScene(props.prevKind)}
              onClick={() => props.onMove(sceneIndex, -1)}
            >
              <ChevronUp aria-hidden="true" className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={iconButtonLargeClass}
              aria-label="下へ移動"
              title="下へ移動"
              disabled={!isMiddleScene(props.nextKind)}
              onClick={() => props.onMove(sceneIndex, 1)}
            >
              <ChevronDown aria-hidden="true" className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={buttonDangerClass}
              onClick={() => props.onRemoveScene(sceneIndex)}
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
              削除
            </button>
          </span>
        )}
      </div>

      <div id={bodyId} hidden={!sceneOpen}>
        <Collapsible title="シーン設定" summary={sceneSettingsSummary(scene, sceneIndex)} storageKey={`scene-settings-${scene.id}`}>
          <TimingFields
            control={props.control}
            register={props.register}
            setValue={props.setValue}
            sceneIndex={sceneIndex}
            sceneKind={scene.kind}
            insertLoop={
              scene.kind === "insert" &&
              scene.cues.find((cue) => cue.id === scene.mainVisualCueId)?.fields.loop ===
                "true"
            }
          />

          <Collapsible title="尺の内訳" className="mt-1 text-xs" storageKey={`scene-duration-${scene.id}`}>
            {(() => {
              if (props.durationMs === null) {
                return props.durationError !== null ? <p>尺の計算: {props.durationError}</p> : null;
              }
              return (
                <>
                  <p>シーン尺: {(props.durationMs / 1000).toFixed(1)}秒</p>
                  {props.durationLines.length > 0 && (
                    <ol className="my-1 ml-4 list-decimal p-0">
                      {props.durationLines.flatMap((line) => {
                        const entries: { key: string; text: string }[] = [];
                        if (line.gapBeforeMs > 0) {
                          entries.push({
                            key: `${line.lineId}-gap`,
                            text: `間 ${((line.startMs - line.gapBeforeMs) / 1000).toFixed(2)}s 〜 ${(line.startMs / 1000).toFixed(2)}s（${(line.gapBeforeMs / 1000).toFixed(2)}秒）`,
                          });
                        }
                        entries.push({
                          key: line.lineId,
                          text: `${(line.startMs / 1000).toFixed(2)}s 〜 ${(line.endMs / 1000).toFixed(2)}s（${(line.durationMs / 1000).toFixed(2)}秒）`,
                        });
                        return entries;
                      }).map((entry) => (
                        <li key={entry.key}>{entry.text}</li>
                      ))}
                    </ol>
                  )}
                </>
              );
            })()}
          </Collapsible>
        </Collapsible>

        <Collapsible
          title={
            scene.kind === "insert"
              ? `映像演出（インサート動画）`
              : `映像演出（${cueCount}件）`
          }
          storageKey={sectionFoldKey(scene.id, "visual")}
          defaultOpen
          className={editAreaClass}
        >
          {scene.kind === "insert" ? (
            <InsertSceneFields
              scene={scene}
              sceneIndex={sceneIndex}
              assets={props.assets}
              assetsLoading={props.assetsLoading}
              assetsError={props.assetsError}
              register={props.register}
              setValue={props.setValue}
              onError={props.onError}
              bare
            />
          ) : (
            <CueList
              control={props.control}
              register={props.register}
              setValue={props.setValue}
              getValues={props.getValues}
              sceneIndex={sceneIndex}
              sceneId={scene.id}
              lines={scene.lines}
              speakers={props.speakers}
              sceneDurationMs={props.durationMs}
              onRemoveCue={(cueId) => props.onRemoveCue(sceneIndex, cueId)}
              onCommitCue={(cueId) => props.onCommitCue(sceneIndex, cueId)}
              onMoveCue={(cueId) => props.onMoveCueRequest(sceneIndex, cueId)}
              onCopyCue={(cueId) => props.onCopyCueRequest(sceneIndex, cueId)}
              bare
            />
          )}
        </Collapsible>

        {scene.kind !== "insert" && (
          <StandingFields
            control={props.control}
            register={props.register}
            getValues={props.getValues}
            setValue={props.setValue}
            sceneIndex={sceneIndex}
            sceneId={scene.id}
            characters={props.characters}
            onCommitStanding={(side) => props.onCommitStanding(sceneIndex, side)}
            onMoveStandings={
              sceneHasStandings(scene)
                ? () => props.onTransferStandingsRequest(sceneIndex, "move")
                : null
            }
            onCopyStandings={
              sceneHasStandings(scene)
                ? () => props.onTransferStandingsRequest(sceneIndex, "copy")
                : null
            }
            onSwapStandings={() => props.onTransferStandingsRequest(sceneIndex, "swap")}
          />
        )}

        <Collapsible
          title={
            audioCount === 0 ? "シーン音声（未設定）" : `シーン音声（${audioCount}件）`
          }
          storageKey={sectionFoldKey(scene.id, "audio")}
          defaultOpen
          className={editAreaClass}
        >
          <SceneAudioFields
            control={props.control}
            register={props.register}
            getValues={props.getValues}
            setValue={props.setValue}
            sceneIndex={sceneIndex}
            onCommitAudioCue={(cueIndex) => props.onCommitAudioCue(sceneIndex, cueIndex)}
            bare
          />
        </Collapsible>

        {scene.kind === "point" && (
          <Collapsible
            title={`セリフ（${lineCount}件）`}
            summary={unvoicedCount > 0 ? `未音声${unvoicedCount}件` : undefined}
            storageKey={sectionFoldKey(scene.id, "lines")}
            defaultOpen
            className={editAreaClass}
          >
            <LinesEditor
              control={props.control}
              register={props.register}
              getValues={props.getValues}
              setValue={props.setValue}
              base={props.base}
              onError={props.onError}
              sceneIndex={sceneIndex}
              sceneId={scene.id}
              scriptVersionId={props.scriptVersionId}
              speakers={props.speakers}
              characters={props.characters}
              voiceProfiles={props.voiceProfiles}
              adapterVoices={props.adapterVoices}
              savedVoiceByLineId={props.savedVoiceByLineId}
              bulkRunning={props.bulkRunning}
              faceSets={props.faceSets}
              faceSetsReady={props.faceSetsReady}
              onSplitScene={props.onSplitScene}
              onJumpToLine={props.onJumpToLine}
              onWarnings={props.onWarnings}
              bare
            />
          </Collapsible>
        )}
      </div>
    </section>
  );
}

export function SceneEditor({ base, editionId, scriptVersionId, onSaved, onValuesChange, onJumpToLine, onJumpToTarget, onDocumentChange, onDirtyChange, scrollContainerRef }: SceneEditorProps) {
  const save = useSaveScriptVersion(editionId);
  const voiceProfiles = useVoiceProfiles();
  const characterLibrary = useCharacters();
  const faceSets = useFaceSets();
  const adapterVoices = useAdapterVoicesMap();
  const themesQuery = useThemes();
  const assetsQuery = useAssets();
  const [diagnostics, setDiagnostics] = useState<{ errors: Diagnostic[]; warnings: Diagnostic[] }>({
    errors: [],
    warnings: [],
  });
  const [openKind, setOpenKind] = useState<"error" | "warning" | null>(null);
  const [savedAtMs, setSavedAtMs] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [pickerRequest, setPickerRequest] = useState<ScenePickerRequest | null>(null);
  const [addBeforeSceneId, setAddBeforeSceneId] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkResult, setBulkResult] = useState<{
    succeeded: number;
    excluded: BulkTtsJobExclusion[];
    failed: BulkTtsFailure[];
  } | null>(null);
  const bulkGenerate = useBulkGenerateTtsTakes(scriptVersionId);

  useEffect(() => {
    if (savedAtMs === null) {
      return;
    }
    const timer = setTimeout(() => setSavedAtMs(null), 4000);
    return () => clearTimeout(timer);
  }, [savedAtMs]);

  const { register, control, handleSubmit, reset, getValues, setValue, formState } =
    useForm<DocumentFormValues>({
      defaultValues: toFormValues(base),
    });

  const isFormDirty = formState.isDirty;
  const lastEmittedDirtyRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (lastEmittedDirtyRef.current !== isFormDirty) {
      lastEmittedDirtyRef.current = isFormDirty;
      onDirtyChange?.(isFormDirty);
    }
  }, [isFormDirty, onDirtyChange]);
  const { fields, insert, replace: replaceScenes } = useFieldArray({
    control,
    name: "scenes",
  });
  const {
    fields: characterFields,
    append: appendCharacter,
    remove: removeCharacter,
  } = useFieldArray({ control, name: "characters" });
  const [charactersOpen, setCharactersOpen] = useStoredCollapsible(
    "characters",
    characterFields.length === 0,
  );

  useEffect(() => {
    if (characterFields.length === 0) {
      setCharactersOpen(true);
    }
  }, [characterFields.length, setCharactersOpen]);
  const watchedScenesValue = useWatch({ control, name: "scenes" });
  const watchedScenes = useMemo(() => watchedScenesValue ?? [], [watchedScenesValue]);
  const watchedCharacters = useWatch({ control, name: "characters" }) ?? [];
  const watchedSpeakers = useWatch({ control, name: "speakers" }) ?? [];

  const foldStore = useCollapsibleStore();
  const openScene = useCallback(
    (sceneId: string) => {
      foldStore?.set(sceneFoldKey(sceneId), true);
    },
    [foldStore],
  );

  const pendingScrollRef = useRef<PendingEditorScroll | null>(null);

  useLayoutEffect(() => {
    const container = scrollContainerRef?.current;
    if (container === null || container === undefined) {
      return;
    }
    const pending = pendingScrollRef.current;
    if (pending === null) {
      return;
    }
    const apply = (): boolean => {
      if (pendingScrollRef.current !== pending) {
        return true;
      }
      if (pending.kind === "reveal") {
        if (!scrollEditorTargetIntoView(container, pending.targetId)) {
          return false;
        }
      } else {
        restoreEditorScrollAnchor(container, pending.anchor);
      }
      pendingScrollRef.current = null;
      return true;
    };
    if (apply()) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (!apply()) {
        pendingScrollRef.current = null;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [watchedScenes, scrollContainerRef]);

  const keepScrollAnchor = (targetId: string): void => {
    const container = scrollContainerRef?.current;
    if (container === null || container === undefined) {
      return;
    }
    const anchor = captureEditorScrollAnchor(container, targetId);
    pendingScrollRef.current = anchor === null ? null : { kind: "anchor", anchor };
  };

  const revealTarget = (targetId: string): void => {
    const container = scrollContainerRef?.current;
    if (container === null || container === undefined) {
      return;
    }
    pendingScrollRef.current = { kind: "reveal", targetId };
  };

  const navProjection = useMemo(
    () => sceneNavProjection(watchedScenes, watchedSpeakers, watchedCharacters),
    [watchedScenes, watchedSpeakers, watchedCharacters],
  );
  const lastEmittedNavProjection = useRef<string | null>(null);

  useEffect(() => {
    if (navProjection === lastEmittedNavProjection.current) {
      return;
    }
    const snapshot = [...watchedScenes];
    const speakerSnapshot = [...(watchedSpeakers ?? [])];
    const characterSnapshot = [...(watchedCharacters ?? [])];
    const timer = setTimeout(() => {
      if (navProjection === lastEmittedNavProjection.current) {
        return;
      }
      lastEmittedNavProjection.current = navProjection;
      onValuesChange?.(snapshot, speakerSnapshot, characterSnapshot);
    }, 150);
    return () => clearTimeout(timer);
  }, [watchedScenes, watchedSpeakers, watchedCharacters, navProjection, onValuesChange]);
  const savedVoiceByLineId = useMemo(() => {
    const speakerById = new Map(base.speakers.map((speaker) => [speaker.id, speaker]));
    const map = new Map<string, string | null>();
    for (const scene of base.scenes) {
      for (const line of scene.lines) {
        const speaker = line.speakerId === null ? undefined : speakerById.get(line.speakerId);
        map.set(line.id, speaker?.voiceProfileId ?? null);
      }
    }
    return map;
  }, [base]);

  const lastBaseRef = useRef(base);
  const bgmSnapshotRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastBaseRef.current !== base) {
      lastBaseRef.current = base;
      if (!formState.isDirty) {
        reset(toFormValues(base));
      }
    }
  }, [base, reset, formState.isDirty]);

  const allValues = useWatch({ control }) as DocumentFormValues | undefined;
  useEffect(() => {
    if (onDocumentChange === undefined || allValues === undefined) {
      return;
    }
    if (!formState.isDirty) {
      onDocumentChange({ dirty: false, document: null });
      return;
    }
    const timer = setTimeout(() => {
      let document: ContentDocument | null = null;
      try {
        const built = buildContentDocument(base, allValues);
        if (contentDocumentSchema.safeParse(built).success) {
          document = built;
        }
      } catch {
        document = null;
      }
      onDocumentChange({ dirty: true, document });
    }, DRAFT_PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [allValues, base, formState.isDirty, onDocumentChange]);

  const onSubmit = handleSubmit(
    (values) => {
      let document: ContentDocument;
      try {
        document = buildContentDocument(base, values);
      } catch (error) {
        setDiagnostics({ errors: [{ message: errorMessage(error) }], warnings: [] });
        setOpenKind("error");
        return;
      }
      const parsed = contentDocumentSchema.safeParse(document);
      if (!parsed.success) {
        setDiagnostics({
          errors: parsed.error.issues.map((issue) => ({
            path: issue.path as (string | number)[],
            code: issue.code,
            message: issue.message,
          })),
          warnings: [],
        });
        setOpenKind("error");
        return;
      }
      save.mutate(parsed.data, {
        onSuccess: (result) => {
          reset(toFormValues(result.scriptVersion.content));
          const warnings = result.warnings.map((warning) => ({
            path: warning.path,
            code: warning.code,
            message: warning.message,
          }));
          setDiagnostics({ errors: [], warnings });
          setOpenKind(warnings.length > 0 ? "warning" : null);
          setSavedAtMs(Date.now());
          setBulkResult(null);
          onSaved?.(result.scriptVersion);
        },
        onError: (error) => {
          setDiagnostics((prev) => ({ ...prev, errors: extractServerErrors(error) }));
          setOpenKind("error");
        },
      });
    },
  );

  const showMessage = (message: string): void => {
    setDiagnostics((prev) => ({ ...prev, errors: [{ message }] }));
    setOpenKind("error");
  };

  const showError = (error: unknown): void => {
    showMessage(errorMessage(error));
  };

  const showWarnings = (warnings: Warning[]): void => {
    setDiagnostics((prev) => ({
      ...prev,
      warnings: warnings.map((warning) => ({
        path: warning.path,
        code: warning.code,
        message: warning.message,
      })),
    }));
    if (warnings.length > 0) {
      setOpenKind("warning");
      return;
    }
    setOpenKind((prev) => (prev === "warning" ? null : prev));
  };

  const runStructural = (operation: ScriptOperation): StructuralEditResult | null => {
    try {
      const next = applyStructuralOperation(
        base,
        getValues(),
        operation,
        assetsQuery.data ?? [],
      );
      replaceScenes(next.values.scenes);
      showWarnings(next.result.warnings);
      return next;
    } catch (error) {
      pendingScrollRef.current = null;
      showError(error);
      return null;
    }
  };

  const onRemoveCue = (sceneIndex: number, cueId: string) => {
    const scene = getValues(`scenes.${sceneIndex}`);
    if (scene === undefined) {
      return;
    }
    try {
      const next = removeCueStructural(
        base,
        getValues(),
        scene.id,
        cueId,
        assetsQuery.data ?? [],
      );
      if (next === null) {
        showMessage("映像演出を削除できませんでした。Sceneの状態を確認してください。");
        return;
      }
      keepScrollAnchor(`scene-${scene.id}`);
      replaceScenes(next.values.scenes);
      showWarnings(next.result.warnings);
    } catch (error) {
      pendingScrollRef.current = null;
      showError(error);
    }
  };

  const onCommitCue = (sceneIndex: number, cueId: string) => {
    const scene = getValues(`scenes.${sceneIndex}`);
    if (scene === undefined) {
      return;
    }
    try {
      const next = commitCueStructural(
        base,
        getValues(),
        scene.id,
        cueId,
        assetsQuery.data ?? [],
      );
      if (next !== null) {
        const nextCue = next.values.scenes
          .find((entry) => entry.id === scene.id)
          ?.cues.find((entry) => entry.id === cueId);
        const cueIndex = getValues(`scenes.${sceneIndex}.cues`).findIndex(
          (entry) => entry.id === cueId,
        );
        if (nextCue !== undefined && cueIndex !== -1) {
          setValue(`scenes.${sceneIndex}.cues.${cueIndex}`, nextCue, {
            shouldDirty: true,
          });
        } else {
          replaceScenes(next.values.scenes);
        }
        showWarnings(next.result.warnings);
      }
    } catch (error) {
      showError(error);
    }
  };

  const onMoveCueRequest = (sceneIndex: number, cueId: string) => {
    const scene = getValues(`scenes.${sceneIndex}`);
    if (scene === undefined) {
      return;
    }
    setPickerRequest({ kind: "move-cue", sceneId: scene.id, cueId });
  };

  const onCopyCueRequest = (sceneIndex: number, cueId: string) => {
    const scene = getValues(`scenes.${sceneIndex}`);
    if (scene === undefined) {
      return;
    }
    setPickerRequest({ kind: "copy-cue", sceneId: scene.id, cueId });
  };

  const onTransferStandingsRequest = (sceneIndex: number, mode: StandingTransferMode) => {
    const scene = getValues(`scenes.${sceneIndex}`);
    if (scene === undefined) {
      return;
    }
    const requestKind = {
      move: "move-standing",
      copy: "copy-standing",
      swap: "swap-standing",
    } as const;
    setPickerRequest({ kind: requestKind[mode], sceneId: scene.id });
  };

  const runTransferStructural = (
    apply: () => StructuralEditResult | null,
    openSceneIds: readonly string[],
    reveal: string | null | ((next: StructuralEditResult) => string | null),
    failureMessage: string,
  ): void => {
    try {
      const next = apply();
      if (next === null) {
        showMessage(failureMessage);
        return;
      }
      replaceScenes(next.values.scenes);
      for (const sceneId of openSceneIds) {
        openScene(sceneId);
      }
      const anchor = typeof reveal === "function" ? reveal(next) : reveal;
      if (anchor !== null) {
        revealTarget(anchor);
      }
      showWarnings(next.result.warnings);
    } catch (error) {
      pendingScrollRef.current = null;
      showError(error);
    }
  };

  const onMoveCue = (sceneId: string, cueId: string, toSceneId: string) => {
    runTransferStructural(
      () =>
        moveCueStructural(
          base,
          getValues(),
          sceneId,
          cueId,
          toSceneId,
          assetsQuery.data ?? [],
        ),
      [toSceneId],
      `cue-${cueId}`,
      "映像演出を移動できませんでした。Sceneの状態を確認してください。",
    );
  };

  const onCopyCue = (sceneId: string, cueId: string, toSceneIds: string[]) => {
    runTransferStructural(
      () =>
        copyCueStructural(
          base,
          getValues(),
          sceneId,
          cueId,
          toSceneIds,
          assetsQuery.data ?? [],
        ),
      toSceneIds,
      (next) => {
        const [firstCreated] = next.result.created.cueIds;
        return firstCreated === undefined ? null : `cue-${firstCreated}`;
      },
      "映像演出を複製できませんでした。Sceneの状態を確認してください。",
    );
  };

  const onTransferStandings = (
    fromSceneId: string,
    toSceneId: string,
    mode: StandingTransferMode,
  ) => {
    runTransferStructural(
      () =>
        transferStandingsStructural(
          base,
          getValues(),
          fromSceneId,
          toSceneId,
          mode,
          assetsQuery.data ?? [],
        ),
      [toSceneId],
      `scene-${toSceneId}`,
      "立ち絵を変更できませんでした。Sceneの状態を確認してください。",
    );
  };

  const onCopyStandings = (fromSceneId: string, toSceneIds: string[]) => {
    runTransferStructural(
      () =>
        copyStandingsStructural(
          base,
          getValues(),
          fromSceneId,
          toSceneIds,
          assetsQuery.data ?? [],
        ),
      toSceneIds,
      toSceneIds.length > 0 ? `scene-${toSceneIds[0]}` : null,
      "立ち絵を複製できませんでした。Sceneの状態を確認してください。",
    );
  };

  const onPickerSelect = (toSceneIds: string[]) => {
    const request = pickerRequest;
    setPickerRequest(null);
    if (request === null) {
      return;
    }
    if (request.kind === "move-cue") {
      const [toSceneId] = toSceneIds;
      if (toSceneId === undefined) {
        return;
      }
      onMoveCue(request.sceneId, request.cueId, toSceneId);
      return;
    }
    if (request.kind === "copy-cue") {
      if (toSceneIds.length === 0) {
        return;
      }
      onCopyCue(request.sceneId, request.cueId, toSceneIds);
      return;
    }
    if (request.kind === "copy-standing") {
      if (toSceneIds.length === 0) {
        return;
      }
      onCopyStandings(request.sceneId, toSceneIds);
      return;
    }
    const [toSceneId] = toSceneIds;
    if (toSceneId === undefined) {
      return;
    }
    onTransferStandings(
      request.sceneId,
      toSceneId,
      standingTransferModeOf(request.kind),
    );
  };

  const onCommitStanding = (
    sceneIndex: number,
    side: "left" | "right",
  ) => {
    const scene = getValues(`scenes.${sceneIndex}`);
    if (scene === undefined) {
      return;
    }
    try {
      const next = commitStandingStructural(
        base,
        getValues(),
        scene.id,
        side,
        assetsQuery.data ?? [],
      );
      if (next === null) {
        return;
      }
      const nextScene = next.values.scenes.find((entry) => entry.id === scene.id);
      if (nextScene !== undefined) {
        setValue(`scenes.${sceneIndex}.standings`, nextScene.standings, {
          shouldDirty: true,
        });
      }
      showWarnings(next.result.warnings);
    } catch (error) {
      showError(error);
    }
  };

  const onCommitBgm = () => {
    try {
      const next = commitBgmStructural(
        base,
        getValues(),
        assetsQuery.data ?? [],
      );
      if (next === null) {
        return;
      }
      setValue("bgm", next.values.bgm, { shouldDirty: true });
      showWarnings(next.result.warnings);
    } catch (error) {
      showError(error);
    }
  };

  const onCommitAudioCue = (sceneIndex: number, cueIndex: number) => {
    const scene = getValues(`scenes.${sceneIndex}`);
    if (scene === undefined) {
      return;
    }
    try {
      const next = commitSceneAudioStructural(
        base,
        getValues(),
        scene.id,
        cueIndex,
        assetsQuery.data ?? [],
      );
      if (next === null) {
        return;
      }
      const nextScene = next.values.scenes.find((entry) => entry.id === scene.id);
      if (nextScene !== undefined) {
        setValue(`scenes.${sceneIndex}.audioCues`, nextScene.audioCues, {
          shouldDirty: true,
        });
      }
      showWarnings(next.result.warnings);
    } catch (error) {
      showError(error);
    }
  };

  const resolveInsertIndex = (): number => {
    const scenes = getValues("scenes");
    const targetId = resolveInsertionTargetId(scenes, addBeforeSceneId);
    if (targetId === null) {
      return scenes.length;
    }
    const index = scenes.findIndex((scene) => scene.id === targetId);
    return index === -1 ? scenes.length : index;
  };

  const onAddPoint = () => {
    const next = runStructural({
      op: "scene.add",
      kind: "point",
      index: resolveInsertIndex(),
    });
    const newSceneId = next?.result.created.sceneIds[0];
    if (newSceneId !== undefined) {
      openScene(newSceneId);
      revealTarget(`scene-${newSceneId}`);
    }
  };

  const onClonePrevious = (index: number) => {
    const scenes = getValues("scenes");
    const previous = scenes[index - 1];
    if (previous === undefined || previous.kind !== "point") {
      return;
    }
    const clonedSceneId = newSceneId(collectSceneIds(scenes));
    insert(
      index,
      cloneSceneFormValue(
        previous as SceneFormValue & { kind: "point" },
        clonedSceneId,
        nextPointLabel(scenes, index),
      ),
    );
    openScene(clonedSceneId);
    revealTarget(`scene-${clonedSceneId}`);
  };

  const onInsertVideo = (assetId: string | null) => {
    if (assetId === null) {
      return;
    }
    const asset = (assetsQuery.data ?? []).find((entry) => entry.id === assetId);
    if (
      asset === undefined ||
      asset.kind !== "video" ||
      asset.durationMs === null ||
      asset.durationMs <= 0
    ) {
      showMessage("尺が確定した動画だけを挿入できます。素材の取り込み完了後に選び直してください。");
      return;
    }
    const next = runStructural({
      op: "scene.add",
      kind: "insert",
      index: resolveInsertIndex(),
      assetId: asset.id,
      durationMs: asset.durationMs,
      embeddedAudio: asset.hasAudio,
    });
    const newSceneId = next?.result.created.sceneIds[0];
    if (newSceneId !== undefined) {
      openScene(newSceneId);
      revealTarget(`scene-${newSceneId}`);
    }
  };

  const onMove = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    const scenes = getValues("scenes");
    const scene = scenes[index];
    if (
      scene === undefined ||
      !isMiddleScene(scene.kind) ||
      !isMiddleScene(scenes[target]?.kind)
    ) {
      return;
    }
    keepScrollAnchor(`scene-${scene.id}`);
    runStructural({ op: "scene.move", sceneId: scene.id, index: target });
  };

  const onRemoveScene = (sceneIndex: number) => {
    const scene = getValues(`scenes.${sceneIndex}`);
    if (scene === undefined) {
      return;
    }
    runStructural({ op: "scene.remove", sceneId: scene.id });
  };

  const onSplitScene = (sceneIndex: number, lineIndex: number) => {
    const scene = getValues(`scenes.${sceneIndex}`);
    const lineId = scene?.lines[lineIndex]?.id;
    if (scene === undefined || scene.kind !== "point" || lineId === undefined) {
      return;
    }
    const next = runStructural({
      op: "scene.splitAtLine",
      sceneId: scene.id,
      lineId,
    });
    const created = next?.result.created.sceneIds ?? [];
    for (const createdId of created) {
      openScene(createdId);
    }
    if (created[0] !== undefined) {
      revealTarget(`scene-${created[0]}`);
    }
  };

  const bulkCandidateCount = useMemo(() => bulkTtsCandidateLineIds(base).length, [base]);

  const addBulkTake = (narrationSegmentId: string, result: TtsJobResult) => {
    const scenes = getValues("scenes");
    for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex += 1) {
      const scene = scenes[sceneIndex];
      if (scene === undefined) {
        continue;
      }
      const lineIndex = scene.lines.findIndex((line) => line.id === narrationSegmentId);
      if (lineIndex === -1) {
        continue;
      }
      const line = scene.lines[lineIndex];
      if (line === undefined) {
        continue;
      }
      const next = mergeTake(
        line,
        { assetId: result.assetId, durationMs: result.durationMs, source: "tts" },
        generatedTakePolicy("bulk").select,
      );
      setValue(`scenes.${sceneIndex}.lines.${lineIndex}.takes`, next.takes, { shouldDirty: true });
      setValue(`scenes.${sceneIndex}.lines.${lineIndex}.selectedAudioTakeId`, next.selectedAudioTakeId, {
        shouldDirty: true,
      });
      return;
    }
  };

  const onBulkGenerate = () => {
    setBulkResult(null);
    setBulkProgress(null);
    bulkGenerate.mutate(
      {
        onProgress: (done, total) => setBulkProgress({ done, total }),
        onJobSucceeded: (result) => addBulkTake(result.narrationSegmentId, result),
      },
      {
        onSuccess: (summary) => {
          setBulkResult({
            succeeded: summary.succeeded,
            excluded: summary.excluded,
            failed: summary.failed,
          });
          setBulkProgress(null);
        },
        onError: () => setBulkProgress(null),
      },
    );
  };

  const addSpeakerFor = (characterId: string, name: string, voiceProfileId: string | null) => {
    const speakers = getValues("speakers");
    setValue(
      "speakers",
      [...speakers, { id: newSpeakerId(), name, characterId, voiceProfileId }],
      { shouldDirty: true },
    );
  };

  const addCharacterFromLibrary = (entry: CharacterLibraryEntry) => {
    const characterId = newCharacterId();
    const voiceProfileId =
      entry.voices.find((voice) => voice.locale === base.locale)?.voiceProfileId ?? null;
    const resolvedName = resolveCharacterName(entry, base.locale);
    const character: CharacterFormValue = {
      id: characterId,
      name: resolvedName,
      names: entry.names.map((name) => ({ ...name })),
      voiceProfileId,
      voices: entry.voices.map((voice) => ({ ...voice })),
      appearances: entry.appearances.map((appearance) => ({
        id: newAppearanceId(),
        assetId: appearance.assetId,
        expression: appearance.expression,
        pose: appearance.pose,
        label: appearance.label ?? "",
        faceSetId: appearance.faceSetId,
      })),
    };
    appendCharacter(character);
    addSpeakerFor(characterId, resolvedName, voiceProfileId);
  };

  const addVoiceOnlySpeaker = () => {
    const characterId = newCharacterId();
    appendCharacter({ id: characterId, name: "ナレーター", names: [], voiceProfileId: null, voices: [], appearances: [] });
    addSpeakerFor(characterId, "ナレーター", null);
  };

  const deleteCharacter = (index: number, character: CharacterFormValue) => {
    const usage = countCharacterFormUsage(getValues(), character.id);
    const details: string[] = [];
    if (usage.lines > 0) {
      details.push(`セリフ ${usage.lines} 件`);
    }
    if (usage.standing > 0) {
      details.push(`立ち絵 ${usage.standing} 件（${usage.scenes} シーン）`);
    }
    const usageText =
      details.length === 0 ? "" : `\n使用中: ${details.join("、")}。保存するとこれらの参照を解除します。`;
    if (!window.confirm(`「${character.name || character.id}」を削除しますか？${usageText}`)) {
      return;
    }
    const speakerIds = new Set(
      getValues("speakers")
        .filter((speaker) => speaker.characterId === character.id)
        .map((speaker) => speaker.id),
    );
    removeCharacter(index);
    setValue(
      "speakers",
      getValues("speakers").filter((speaker) => speaker.characterId !== character.id),
      { shouldDirty: true },
    );
    getValues("scenes").forEach((scene, sceneIndex) => {
      scene?.lines.forEach((line, lineIndex) => {
        if (line?.speakerId !== null && line?.speakerId !== undefined && speakerIds.has(line.speakerId)) {
          setValue(`scenes.${sceneIndex}.lines.${lineIndex}.speakerId`, null, {
            shouldDirty: true,
          });
        }
      });
      (scene?.standings ?? []).forEach((standing, standingIndex) => {
        if (standing?.characterId !== character.id) {
          return;
        }
        setValue(`scenes.${sceneIndex}.standings.${standingIndex}.characterId`, null, {
          shouldDirty: true,
        });
        setValue(`scenes.${sceneIndex}.standings.${standingIndex}.appearanceId`, null, {
          shouldDirty: true,
        });
      });
    });
  };

  const pointOrdinals = useMemo(() => {
    let count = 0;
    return watchedScenes.map((scene) => {
      if (scene?.kind !== "point") {
        return 0;
      }
      count += 1;
      return count;
    });
  }, [watchedScenes]);

  const pointCount = pointOrdinals.filter((ordinal) => ordinal > 0).length;

  const insertionOptions = watchedScenes.flatMap((scene, index) => {
    if (scene.kind === "intro") {
      return [];
    }
    if (scene.kind === "outro") {
      return [{ id: scene.id, text: "結びの前" }];
    }
    const name = sceneDisplayName(scene, pointOrdinals[index] ?? 0);
    return [{ id: scene.id, text: `「${name}」の前` }];
  });
  const insertionSelectValue =
    resolveInsertionTargetId(watchedScenes, addBeforeSceneId) ?? "";

  const timing = useMemo(() => {
    if (allValues === undefined || allValues.scenes === undefined) {
      return { placements: [] as ReturnType<typeof resolveTimeline>["scenes"], error: null };
    }
    try {
      const document = buildContentDocument(base, allValues);
      return { placements: resolveTimeline(document).scenes, error: null };
    } catch (error) {
      return { placements: [], error: errorMessage(error) };
    }
  }, [allValues, base]);

  const placementBySceneId = useMemo(
    () => new Map(timing.placements.map((placement) => [placement.sceneId, placement])),
    [timing.placements],
  );

  const diagBySceneId = useMemo(() => {
    const map = new Map<string, { errors: number; warnings: number }>();
    const add = (path: (string | number)[] | undefined, kind: "errors" | "warnings") => {
      if (
        path === undefined ||
        path.length < 2 ||
        path[0] !== "scenes" ||
        typeof path[1] !== "number"
      ) {
        return;
      }
      const scene = watchedScenes[path[1]];
      if (scene === undefined) {
        return;
      }
      const entry = map.get(scene.id) ?? { errors: 0, warnings: 0 };
      entry[kind] += 1;
      map.set(scene.id, entry);
    };
    for (const diag of diagnostics.errors) {
      add(diag.path, "errors");
    }
    for (const diag of diagnostics.warnings) {
      add(diag.path, "warnings");
    }
    return map;
  }, [diagnostics, watchedScenes]);

  const watchedBgm = allValues?.bgm;

  const pickerCopy = pickerRequest === null ? null : SCENE_PICKER_COPY[pickerRequest.kind];

  return (
    <>
    <form onSubmit={onSubmit}>
      <fieldset disabled={save.isPending} className="contents border-0 m-0 p-0">
      <div
        id="editor-actionbar"
        className="sticky top-0 z-10 flex flex-wrap items-center gap-3 bg-surface py-2.5"
      >
        <button
          type="submit"
          className={buttonPrimaryClass}
          disabled={save.isPending || bulkGenerate.isPending}
        >
          <Save aria-hidden="true" className="h-4 w-4" />
          保存
        </button>
        <button
          type="button"
          className={buttonNeutralClass}
          disabled={watchedScenes.length === 0}
          onClick={() =>
            foldStore?.setMany(
              watchedScenes.map((scene) => sceneFoldKey(scene.id)),
              true,
            )
          }
        >
          すべて開く
        </button>
        <button
          type="button"
          className={buttonNeutralClass}
          disabled={watchedScenes.length === 0}
          onClick={() =>
            foldStore?.setMany(
              watchedScenes.map((scene) => sceneFoldKey(scene.id)),
              false,
            )
          }
        >
          すべて閉じる
        </button>
        {diagnostics.errors.length > 0 && (
          <button
            type="button"
            className={`inline-flex cursor-pointer items-center gap-1 rounded px-2.5 py-1 text-xs font-medium ${
              openKind === "error"
                ? "border border-red-400 bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-100"
                : "bg-red-100 text-red-800 hover:bg-red-200 dark:bg-red-950/60 dark:text-red-200"
            }`}
            onClick={() => setOpenKind(openKind === "error" ? null : "error")}
          >
            <OctagonAlert className="h-4 w-4 shrink-0" />
            <span>エラー({diagnostics.errors.length})</span>
          </button>
        )}
        {diagnostics.warnings.length > 0 && (
          <button
            type="button"
            className={`inline-flex cursor-pointer items-center gap-1 rounded px-2.5 py-1 text-xs font-medium ${
              openKind === "warning"
                ? "border border-amber-400 bg-amber-200 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100"
                : "bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-950/60 dark:text-amber-200"
            }`}
            onClick={() => setOpenKind(openKind === "warning" ? null : "warning")}
          >
            <TriangleAlert className="h-4 w-4 shrink-0" />
            <span>警告({diagnostics.warnings.length})</span>
          </button>
        )}
        <button
          type="button"
          className={buttonNeutralClass}
          disabled={formState.isDirty || bulkGenerate.isPending || bulkCandidateCount === 0}
          onClick={onBulkGenerate}
        >
          {bulkGenerate.isPending ? "一括生成中…" : `未音声を一括生成（${bulkCandidateCount}）`}
        </button>
        {bulkProgress !== null && (
          <span className={metaTextClass}>
            進捗 {bulkProgress.done}/{bulkProgress.total}
          </span>
        )}
        {formState.isDirty && !bulkGenerate.isPending && bulkCandidateCount > 0 && (
          <span className={metaTextClass}>保存すると一括生成できます</span>
        )}
        {savedAtMs !== null && (
          <span className={metaTextClass}>
            保存しました（{new Date(savedAtMs).toLocaleTimeString("ja-JP")}）
          </span>
        )}
        {bulkGenerate.isError && (
          <span className={errorTextClass}>{errorMessage(bulkGenerate.error)}</span>
        )}
        {openKind !== null && (
          <div
            role="region"
            aria-label={openKind === "error" ? "エラー一覧" : "警告一覧"}
            className={`absolute left-0 right-0 top-full max-h-60 overflow-auto rounded border p-3 text-sm shadow-lg ${
              openKind === "error"
                ? "border-red-400 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200"
                : "border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
            }`}
          >
            <div className="mb-1 font-semibold">
              {openKind === "error" ? "エラー一覧" : "警告一覧"}
            </div>
            <ul className="m-0 list-disc space-y-1 pl-5">
              {(openKind === "error" ? diagnostics.errors : diagnostics.warnings).map((diag, index) => {
                const target = diagnosticTarget(diag.path, watchedScenes);
                const pathStr = diag.path ? diag.path.join(".") : null;
                return (
                  <li key={index}>
                    {pathStr !== null && (
                      <>
                        {target !== null ? (
                          <button
                            type="button"
                            className="mr-1.5 cursor-pointer font-mono underline hover:no-underline"
                            onClick={() => onJumpToTarget?.(target.targetId, target.seek)}
                          >
                            {pathStr}
                          </button>
                        ) : (
                          <span className="mr-1.5 font-mono text-muted-foreground">{pathStr}</span>
                        )}
                        :{" "}
                      </>
                    )}
                    <span>{diag.message}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>


      {bulkResult !== null && (
        <div className="rounded border border-yellow-400 bg-yellow-50 p-3 text-sm dark:bg-yellow-950/40">
          <strong>一括生成の結果</strong>
          <p>
            成功 {bulkResult.succeeded} 件 / 対象外 {bulkResult.excluded.length} 件 / 失敗{" "}
            {bulkResult.failed.length} 件（追加した音声は「保存」で台本に反映されます）
          </p>
          {bulkResult.excluded.length > 0 && (
            <ul>
              {bulkResult.excluded.map((entry) => (
                <li key={`excluded-${entry.narrationSegmentId}`}>
                  対象外: {entry.message}
                </li>
              ))}
            </ul>
          )}
          {bulkResult.failed.length > 0 && (
            <ul>
              {bulkResult.failed.map((entry) => (
                <li key={`failed-${entry.narrationSegmentId}`}>失敗: {entry.message}</li>
              ))}
            </ul>
          )}
          {(bulkResult.failed.length > 0 || bulkResult.excluded.length > 0) && (
            <p>
              未音声が残っています。成功分を保存した後、もう一度「未音声を一括生成」で再試行できます。
            </p>
          )}
        </div>
      )}

      <Collapsible
        title="テーマ（Visual Theme）"
        storageKey="theme"
        summary={(() => {
          const themeId = allValues?.visualTheme?.id;
          const themeVersion = allValues?.visualTheme?.version;
          const theme = (themesQuery.data ?? []).find((entry) => entry.id === themeId);
          if (theme === undefined || themeId === undefined || themeVersion === undefined) {
            return "未選択";
          }
          return `${theme.name} (v${themeVersion})`;
        })()}
        className={sectionCardClass}
      >
        <h3 className={sectionTitleClass}>テーマ（Visual Theme）</h3>
        <p className={sectionSummaryClass}>
          作品全体の文字デザイン・配色テーマを指定します。選択変更後に「保存」すると新しい台本版が作成されます。
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label className={formLabelClass}>
            選択中テーマ:
            <select
              className={textFieldClass}
              value={`${getValues("visualTheme.id")}@${getValues("visualTheme.version")}`}
              onChange={(e) => {
                const [id, verStr] = e.target.value.split("@");
                if (id && verStr) {
                  setValue("visualTheme.id", id, { shouldDirty: true });
                  setValue("visualTheme.version", Number(verStr), { shouldDirty: true });
                }
              }}
            >
              {(themesQuery.data ?? [])
                .filter((t) => t.latestRevision !== null)
                .map((t) => {
                  const version = t.latestRevision!.version;
                  const valueKey = `${t.id}@${version}`;
                  return (
                    <option key={valueKey} value={valueKey}>
                      {t.name} (v{version}) {t.isBuiltIn ? "【組み込み】" : ""}
                    </option>
                  );
                })}
            </select>
          </label>
        </div>
      </Collapsible>

      <Collapsible
        title="BGM（作品全体）"
        storageKey="bgm"
        summary={
          watchedBgm?.assetId === null || watchedBgm?.assetId === undefined
            ? "未設定"
            : `設定あり（ループ${watchedBgm.loop ? "あり" : "なし"}・${watchedBgm.gainDb}dB）`
        }
        className={sectionCardClass}
      >
        <h3 className={sectionTitleClass}>BGM（作品全体）</h3>
        <div
          onFocus={(event) => {
            const related = event.relatedTarget as Node | null;
            if (
              related !== null &&
              event.currentTarget.contains(related)
            ) {
              return;
            }
            if (
              related instanceof Element &&
              related.closest('[role="dialog"]') !== null
            ) {
              return;
            }
            if (related === null && bgmSnapshotRef.current !== null) {
              return;
            }
            bgmSnapshotRef.current = JSON.stringify(getValues("bgm"));
          }}
          onBlur={(event) => {
            const related = event.relatedTarget as Node | null;
            if (
              related === null ||
              event.currentTarget.contains(related)
            ) {
              return;
            }
            if (
              related instanceof Element &&
              related.closest('[role="dialog"]') !== null
            ) {
              return;
            }
            const current = JSON.stringify(getValues("bgm"));
            if (current === bgmSnapshotRef.current) {
              return;
            }
            bgmSnapshotRef.current = current;
            onCommitBgm();
          }}
        >
          <MediaPicker
            label="BGM"
            kinds={["audio"]}
            selectedAssetId={watchedBgm?.assetId ?? null}
            onSelect={(assetId) => setValue("bgm.assetId", assetId, { shouldDirty: true })}
          />
          {watchedBgm?.assetId !== null && watchedBgm?.assetId !== undefined && (
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <label className={formLabelClass}>
                <input type="checkbox" {...register("bgm.loop")} />
                ループ
              </label>
              <label className={formLabelClass}>
                音量
                <input
                  type="number"
                  step="1"
                  className={`w-24 ${textFieldClass}`}
                  {...register("bgm.gainDb", {
                    setValueAs: (value) =>
                      value === "" || Number.isNaN(Number(value))
                        ? DEFAULT_BGM_GAIN_DB
                        : Number(value),
                  })}
                />
                dB
              </label>
            </div>
          )}
        </div>
      </Collapsible>

      <Collapsible
        title="キャラクター"
        summary={characterFields.length === 0 ? "未登録" : `${characterFields.length}件`}
        open={charactersOpen}
        onOpenChange={setCharactersOpen}
        className={sectionCardClass}
      >
        <h3 className={sectionTitleClass}>キャラクター</h3>
        <p className={sectionSummaryClass}>
          この作品で使うキャラクターです。声プロファイルを割り当てると、そのキャラクターのセリフをTTSで生成できます。外観はライブラリから取り込んだ後に、この作品内で追加・編集できます。
        </p>
        {voiceProfiles.isError && (
          <p className={errorTextClass}>声プロファイルを読み込めませんでした。</p>
        )}
        {characterLibrary.isError && (
          <p className={errorTextClass}>キャラクターライブラリを読み込めませんでした。</p>
        )}
        {faceSets.isError && (
          <p className={errorTextClass}>表情セットを読み込めませんでした。</p>
        )}
        {characterFields.map((field, characterIndex) => (
          <CharacterFields
            key={`${field.id}-${characterIndex}`}
            control={control}
            register={register}
            getValues={getValues}
            setValue={setValue}
            characterIndex={characterIndex}
            voiceProfiles={voiceProfiles.data ?? []}
            faceSets={faceSets.data ?? []}
            onDelete={deleteCharacter}
          />
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <label className={formLabelClass}>
            ライブラリから追加
            <select
              className={textFieldClass}
              value=""
              disabled={characterLibrary.isLoading}
              onChange={(event) => {
                const entry = characterLibrary.data?.find(
                  (candidate) => candidate.id === event.target.value,
                );
                if (entry !== undefined) {
                  addCharacterFromLibrary(entry);
                }
              }}
            >
              <option value="">選択してください</option>
              {(characterLibrary.data ?? []).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name || entry.id}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={buttonNeutralClass} onClick={addVoiceOnlySpeaker}>
            声だけの話者を追加
          </button>
        </div>
        {characterFields.length === 0 && (
          <p className={metaTextClass}>
            キャラクターがありません。「ライブラリから追加」で追加してください。
          </p>
        )}
      </Collapsible>

      <ScriptSkinProvider control={control}>
      {fields.map((field, sceneIndex) => {
        const scene = watchedScenes[sceneIndex];
        if (scene === undefined) {
          return null;
        }
        const placement = placementBySceneId.get(scene.id);
        const diag = diagBySceneId.get(scene.id) ?? { errors: 0, warnings: 0 };
        return (
          <SceneBlock
            key={field.id}
            control={control}
            register={register}
            getValues={getValues}
            setValue={setValue}
            base={base}
            scene={scene}
            sceneIndex={sceneIndex}
            pointOrdinal={pointOrdinals[sceneIndex] ?? 0}
            prevKind={watchedScenes[sceneIndex - 1]?.kind}
            nextKind={watchedScenes[sceneIndex + 1]?.kind}
            durationMs={placement?.durationMs ?? null}
            durationError={timing.error}
            durationLines={placement?.lines ?? []}
            errorCount={diag.errors}
            warningCount={diag.warnings}
            assets={assetsQuery.data ?? []}
            assetsLoading={assetsQuery.isLoading}
            assetsError={assetsQuery.isError}
            speakers={watchedSpeakers}
            characters={watchedCharacters}
            voiceProfiles={voiceProfiles.data ?? []}
            adapterVoices={adapterVoices}
            savedVoiceByLineId={savedVoiceByLineId}
            bulkRunning={bulkGenerate.isPending}
            faceSets={faceSets.data ?? []}
            faceSetsReady={faceSets.isSuccess}
            scriptVersionId={scriptVersionId}
            onMove={onMove}
            onRemoveScene={onRemoveScene}
            onClonePrevious={onClonePrevious}
            onRemoveCue={onRemoveCue}
            onCommitCue={onCommitCue}
            onMoveCueRequest={onMoveCueRequest}
            onCopyCueRequest={onCopyCueRequest}
            onCommitStanding={onCommitStanding}
            onTransferStandingsRequest={onTransferStandingsRequest}
            onCommitAudioCue={onCommitAudioCue}
            onSplitScene={onSplitScene}
            onJumpToLine={onJumpToLine}
            onWarnings={showWarnings}
            onError={showMessage}
          />
        );
      })}
      </ScriptSkinProvider>

      <div className="flex flex-wrap items-center gap-3">
        {insertionOptions.length > 0 && (
          <label className={formLabelClass}>
            追加位置
            <select
              className={textFieldClass}
              value={insertionSelectValue}
              onChange={(event) => setAddBeforeSceneId(event.target.value)}
            >
              {insertionOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.text}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className={buttonNeutralClass} onClick={onAddPoint}>
          <Plus aria-hidden="true" className="h-4 w-4" />
          要点を追加
        </button>
        <MediaPicker
          label="動画を挿入"
          kinds={["video"]}
          selectedAssetId={null}
          onSelect={onInsertVideo}
          variant="add"
          inline
          icon={Video}
        />
        <button
          type="button"
          className={buttonNeutralClass}
          onClick={() => setImportOpen(true)}
        >
          台本をインポート
        </button>
      </div>
      {pointCount === 0 && (
        <p className={metaTextClass}>要点Sceneがありません。追加してください。</p>
      )}
      </fieldset>
    </form>
    <ScenePickerModal
      open={pickerCopy !== null}
      title={pickerCopy?.title ?? ""}
      description={pickerCopy?.description ?? ""}
      mode={pickerCopy?.mode ?? "single"}
      confirmLabel={pickerCopy?.confirmLabel ?? ""}
      scenes={pickerRequest === null ? [] : pickerTargets(watchedScenes, pickerRequest.sceneId)}
      onClose={() => setPickerRequest(null)}
      onSelect={onPickerSelect}
    />
    <ScriptImportModal
      open={importOpen}
      onClose={() => setImportOpen(false)}
      scenes={watchedScenes}
      speakers={watchedSpeakers}
      disabled={save.isPending}
      onApply={(nextScenes) => {
        const prevIds = new Set(getValues("scenes").map((scene) => scene.id));
        replaceScenes(nextScenes);
        foldStore?.setMany(
          nextScenes
            .filter((scene) => !prevIds.has(scene.id))
            .map((scene) => sceneFoldKey(scene.id)),
          true,
        );
      }}
    />
    </>
  );
}
