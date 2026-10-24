import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Clapperboard, Copy, Trash2 } from "lucide-react";
import {
  useFieldArray,
  useWatch,
  type Control,
  type UseFormGetValues,
  type UseFormRegister,
  type UseFormSetValue,
} from "react-hook-form";
import {
  ANIMATION_PRESETS,
  DEFAULT_ANIMATION_POLICY,
  DEFAULT_VISUAL_THEME_REF,
  compositionSkinRelation,
  getVisualTemplate,
  listVisualTemplateCatalog,
  resolveVisualThemeSkin,
  textBlockV1,
  type AnimationPreset,
  type CanvasProfile,
  type CompositionStyleProvenance,
  type CueLayer,
  type TemplateFieldSpec,
  type VisualSkinRef,
} from "@kakeai/contracts";
import {
  CROP_CENTER_PERCENT,
  CROP_X_SUFFIX,
  CROP_Y_SUFFIX,
  CROP_ZOOM_MAX_PERCENT,
  CROP_ZOOM_MIN_PERCENT,
  CROP_ZOOM_SUFFIX,
  NESTED_MEDIA_FIT_SUFFIX,
  NESTED_COMPOSITION_FIT_SUFFIX,
  NESTED_COMPOSITION_POS_X_SUFFIX,
  NESTED_COMPOSITION_POS_Y_SUFFIX,
  NESTED_COMPOSITION_VERSION_SUFFIX,
  NESTED_COMPOSITION_ZOOM_SUFFIX,
  NESTED_MODE_COMPOSITION,
  NESTED_MODE_MEDIA,
  NESTED_MODE_SUFFIX,
  STANDING_TEMPLATE_ID,
  VIDEO_PLAYBACK_SUFFIX,
  compositionVersionOptions,
  createCueFormValue,
  duplicateCueFormValue,
  lineIndex,
  lineOptionLabel,
  lineRangeEndCandidates,
  lineSummary,
  nextEndLineId,
  type CueFormValue,
  type DocumentFormValues,
  type LineFormValue,
  type SpeakerFormValue,
} from "../content/form";
import { FLOW_EFFECTS_FIELD_KEY } from "../content/flow";
import {
  PRESET_LABELS,
  badgeNeutralClass,
  buttonDangerClass,
  buttonNeutralClass,
  colorFieldClass,
  editAreaClass,
  errorTextClass,
  formLabelBlockClass,
  formLabelClass,
  formLabelSpacedClass,
  formLabelTextClass,
  itemCardClass,
  metaTextClass,
  textFieldClass,
} from "../ui";
import { useCompositions, useTheme } from "../api/hooks";
import { Collapsible } from "./Collapsible";
import { MediaPicker } from "./MediaPicker";
import { VideoPlaybackField } from "./VideoPlaybackField";
import { DataGridField } from "./DataGridField";
import { EffectsField } from "./EffectsField";
import { CalloutItemsField } from "./CalloutItemsField";
import { MessagesField } from "./MessagesField";
import { FlowField } from "./FlowField";

const COMPOSITION_VERSION_FIELD_KEY = "compositionVersionId";
const IDENTITY_ZOOM_PERCENT = "100";

const LAYER_LABELS: Record<CueLayer, string> = {
  background: "背景",
  card: "カード",
  standing: "立ち絵",
  overlay: "オーバーレイ",
};

const RANGE_LABELS: Record<string, string> = {
  scene: "Scene全体",
  lines: "セリフ区間",
  offset: "オフセット",
};

const TEXT_BLOCK_PRIMARY_KEYS: ReadonlySet<string> = new Set(["text", "role"]);

const ScriptSkinContext = createContext<VisualSkinRef | null>(null);

export function ScriptSkinProvider({
  control,
  children,
}: {
  control: Control<DocumentFormValues>;
  children: ReactNode;
}) {
  const visualThemeRef = useWatch({ control, name: "visualTheme" });
  const themeQuery = useTheme(visualThemeRef?.id);
  const scriptSkin = useMemo(() => {
    const theme = themeQuery.data;
    if (theme === undefined || visualThemeRef === undefined) {
      return null;
    }
    const revision = theme.revisions.find((entry) => entry.version === visualThemeRef.version);
    return revision === undefined ? null : resolveVisualThemeSkin(revision.definition);
  }, [themeQuery.data, visualThemeRef]);
  return <ScriptSkinContext.Provider value={scriptSkin}>{children}</ScriptSkinContext.Provider>;
}

function skinMismatchMessage(
  relation: ReturnType<typeof compositionSkinRelation>,
  scriptSkin: VisualSkinRef,
  provenance: CompositionStyleProvenance | undefined,
): string | undefined {
  const scriptLabel = `${scriptSkin.id}@${scriptSkin.version}`;
  if (relation === "neutral") {
    return `このCompositionはスキン未指定（neutral）で作られています。台本のスキン ${scriptLabel} と調和しない可能性があります。`;
  }
  if (relation === "legacy") {
    return `このCompositionの作風情報がありません（legacy）。台本のスキン ${scriptLabel} と調和しない可能性があります。`;
  }
  if (relation === "different" && provenance?.kind === "authored") {
    return `このCompositionは ${provenance.skin.id}@${provenance.skin.version} で作られています。台本のスキン ${scriptLabel} と異なります。`;
  }
  return undefined;
}

interface AddableTemplate {
  id: string;
  version: number;
  label: string;
  layers: readonly CueLayer[];
}

function addableTemplates(): AddableTemplate[] {
  const byId = new Map<string, AddableTemplate>();
  for (const entry of listVisualTemplateCatalog()) {
    if (!entry.editable || entry.id === STANDING_TEMPLATE_ID) {
      continue;
    }
    const existing = byId.get(entry.id);
    if (existing === undefined || entry.version > existing.version) {
      byId.set(entry.id, {
        id: entry.id,
        version: entry.version,
        label: entry.label,
        layers: entry.layers,
      });
    }
  }
  return [...byId.values()];
}

interface CueListProps {
  control: Control<DocumentFormValues>;
  register: UseFormRegister<DocumentFormValues>;
  setValue: UseFormSetValue<DocumentFormValues>;
  getValues: UseFormGetValues<DocumentFormValues>;
  sceneIndex: number;
  sceneId: string;
  lines: LineFormValue[];
  speakers: SpeakerFormValue[];
  sceneDurationMs: number | null;
  onRemoveCue: (cueId: string) => void;
  onCommitCue: (cueId: string) => void;
  /** SceneEditor側の折りたたみ内に置くときは外枠と見出しを出さない */
  bare?: boolean;
}

interface CueRowProps {
  register: UseFormRegister<DocumentFormValues>;
  setValue: UseFormSetValue<DocumentFormValues>;
  getValues: UseFormGetValues<DocumentFormValues>;
  sceneIndex: number;
  cueIndex: number;
  cue: CueFormValue;
  lines: LineFormValue[];
  speakers: SpeakerFormValue[];
  sceneDurationMs: number | null;
  onRemove: () => void;
  onDuplicate: (() => void) | null;
  onCommitCue: () => void;
}

function CueRow({
  register,
  setValue,
  getValues,
  sceneIndex,
  cueIndex,
  cue,
  lines,
  speakers,
  sceneDurationMs,
  onRemove,
  onDuplicate,
  onCommitCue,
}: CueRowProps) {
  const base = `scenes.${sceneIndex}.cues.${cueIndex}` as const;
  const snapshotRef = useRef(JSON.stringify(cue));
  const definition = getVisualTemplate(cue.templateId, cue.templateVersion);
  const layerOptions = definition?.layers ?? ["background"];
  const fields = definition?.inputFields;
  const fieldsPath = `${base}.fields` as const;
  const getFields = (): Record<string, string> => getValues(fieldsPath) ?? {};
  const setFields = (patch: Record<string, string>) => {
    const current = getValues(fieldsPath) ?? {};
    setValue(fieldsPath, { ...current, ...patch }, { shouldDirty: true });
  };
  const setField = (key: string, value: string) => setFields({ [key]: value });
  const startIndex = lineIndex(lines, cue.startLineId);
  const endIndex = lineIndex(lines, cue.endLineId);
  const endCandidates = lineRangeEndCandidates(lines, cue.startLineId);
  const offsetStartMs = Number(cue.startMs);
  const offsetEndMs = Number(cue.endMs);
  const offsetOutOfScene =
    cue.rangeKind === "offset" &&
    sceneDurationMs !== null &&
    Number.isFinite(offsetStartMs) &&
    Number.isFinite(offsetEndMs) &&
    (offsetStartMs < 0 ||
      offsetEndMs < 0 ||
      offsetStartMs >= offsetEndMs ||
      offsetStartMs >= sceneDurationMs ||
      offsetEndMs > sceneDurationMs);

  const isTextBlock = cue.templateId === textBlockV1.id && cue.templateVersion === textBlockV1.version;
  const contentFields = fields ?? [];
  const primaryFields = isTextBlock
    ? contentFields.filter((field) => TEXT_BLOCK_PRIMARY_KEYS.has(field.key))
    : contentFields;
  const styleFields = isTextBlock
    ? contentFields.filter((field) => !TEXT_BLOCK_PRIMARY_KEYS.has(field.key))
    : [];
  const displaySummary = `${LAYER_LABELS[cue.layer] ?? cue.layer} / 順序 ${cue.order} / ${
    RANGE_LABELS[cue.rangeKind] ?? cue.rangeKind
  }`;
  const rangeStartLineId = cue.rangeKind === "lines" ? cue.startLineId : null;
  const renderCueField = (field: TemplateFieldSpec) => (
    <CueField
      key={field.key}
      field={field}
      values={cue.fields}
      setField={setField}
      setFields={setFields}
      getFields={getFields}
      multiline={isTextBlock && field.key === "text"}
      animationPresets={definition?.animationPolicy.presets ?? ANIMATION_PRESETS}
      lines={lines}
      speakers={speakers}
      rangeStartLineId={rangeStartLineId}
    />
  );

  return (
    <div
      id={`cue-${cue.id}`}
      className={itemCardClass}
      onFocus={(event) => {
        const related = event.relatedTarget as Node | null;
        if (related === null) {
          return;
        }
        if (event.currentTarget.contains(related)) {
          return;
        }
        if (
          related instanceof Element &&
          related.closest('[role="dialog"]') !== null
        ) {
          return;
        }
        snapshotRef.current = JSON.stringify(getValues(base));
      }}
      onBlur={(event) => {
        const related = event.relatedTarget as Node | null;
        if (related === null || event.currentTarget.contains(related)) {
          return;
        }
        if (
          related instanceof Element &&
          related.closest('[role="dialog"]') !== null
        ) {
          return;
        }
        const current = JSON.stringify(getValues(base));
        if (current === snapshotRef.current) {
          return;
        }
        snapshotRef.current = current;
        onCommitCue();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={badgeNeutralClass}>
          {definition?.display.label ?? cue.templateId}@{cue.templateVersion}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {onDuplicate !== null && (
            <button type="button" className={buttonNeutralClass} onClick={onDuplicate}>
              <Copy aria-hidden="true" className="h-4 w-4" />
              複製
            </button>
          )}
          <button type="button" className={buttonDangerClass} onClick={onRemove}>
            <Trash2 aria-hidden="true" className="h-4 w-4" />
            削除
          </button>
        </span>
      </div>

      {fields === undefined || fields.length === 0 ? (
        <p className={metaTextClass}>
          このテンプレートはUI未対応のため、内容は非破壊で保持されます。
        </p>
      ) : (
        <div className="mt-1">{primaryFields.map(renderCueField)}</div>
      )}

      {styleFields.length > 0 && (
        <Collapsible title="文字スタイル" storageKey={`cue-style-${cue.id}`}>
          <p className={metaTextClass}>
            未指定の項目はテーマ（{DEFAULT_VISUAL_THEME_REF.id}@{DEFAULT_VISUAL_THEME_REF.version}）の役割別スタイルで描画されます
          </p>
          {styleFields.map(renderCueField)}
        </Collapsible>
      )}

      <Collapsible title="表示の詳細" summary={displaySummary} storageKey={`cue-display-${cue.id}`}>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className={formLabelClass}>
            レイヤー
            <select className={textFieldClass} {...register(`${base}.layer`)}>
              {layerOptions.map((layer) => (
                <option key={layer} value={layer}>
                  {LAYER_LABELS[layer] ?? layer}
                </option>
              ))}
            </select>
          </label>
          <label className={formLabelClass}>
            順序
            <input
              type="number"
              min={0}
              className={`w-20 ${textFieldClass}`}
              {...register(`${base}.order`, { valueAsNumber: true })}
            />
          </label>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className={formLabelClass}>
            表示区間
            <select className={textFieldClass} {...register(`${base}.rangeKind`)}>
              <option value="scene">Scene全体</option>
              <option value="lines">セリフ区間</option>
              <option value="offset">オフセット</option>
            </select>
          </label>
          {cue.rangeKind === "lines" && (
            <>
              <label className={formLabelClass}>
                開始
                <select
                  className={textFieldClass}
                  value={cue.startLineId}
                  onChange={(event) => {
                    const nextId = event.target.value;
                    setValue(`${base}.startLineId`, nextId, { shouldDirty: true });
                    setValue(`${base}.endLineId`, nextEndLineId(lines, nextId, cue.endLineId), {
                      shouldDirty: true,
                    });
                  }}
                >
                  <option value="">選択</option>
                  {lines.map((line, index) => (
                    <option key={line.id} value={line.id}>
                      {lineOptionLabel(lines, index, speakers)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={formLabelClass}>
                終了
                <select
                  className={textFieldClass}
                  value={cue.endLineId}
                  onChange={(event) =>
                    setValue(`${base}.endLineId`, event.target.value, { shouldDirty: true })
                  }
                >
                  <option value="">選択</option>
                  {endCandidates.map((line) => (
                    <option key={line.id} value={line.id}>
                      {lineOptionLabel(lines, lineIndex(lines, line.id), speakers)}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {cue.rangeKind === "offset" && (
            <>
              <label className={formLabelClass}>
                開始(ms)
                <input
                  type="number"
                  min={0}
                  max={sceneDurationMs ?? undefined}
                  className={`w-24 ${textFieldClass}`}
                  {...register(`${base}.startMs`, { valueAsNumber: true })}
                />
              </label>
              <label className={formLabelClass}>
                終了(ms)
                <input
                  type="number"
                  min={0}
                  max={sceneDurationMs ?? undefined}
                  className={`w-24 ${textFieldClass}`}
                  {...register(`${base}.endMs`, { valueAsNumber: true })}
                />
              </label>
            </>
          )}
        </div>

        {cue.rangeKind === "offset" && sceneDurationMs !== null && (
          <p className={`mt-1 ${offsetOutOfScene ? errorTextClass : metaTextClass}`}>
            シーン尺 {sceneDurationMs}ms
            {offsetOutOfScene && " — 区間がシーンに収まらないため、保存時に警告されます"}
          </p>
        )}

        {cue.rangeKind === "lines" && (cue.startLineId !== "" || cue.endLineId !== "") && (
          <p className={`mt-1 ${metaTextClass}`}>
            開始: {startIndex === -1 ? "未選択" : lineSummary(lines[startIndex]!, speakers)}
            {" / "}
            終了: {endIndex === -1 ? "未選択" : lineSummary(lines[endIndex]!, speakers)}
          </p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className={formLabelClass}>
            入場
            <select className={textFieldClass} {...register(`${base}.enterPreset`)}>
              {(definition?.transitionPolicy.presets ?? ["none"]).map((preset) => (
                <option key={preset} value={preset}>
                  {PRESET_LABELS[preset] ?? preset}
                </option>
              ))}
            </select>
          </label>
          {cue.enterPreset !== "none" && (
            <label className={formLabelClass}>
              尺(ms)
              <input
                type="number"
                min={0}
                className={`w-20 ${textFieldClass}`}
                {...register(`${base}.enterDurationMs`, { valueAsNumber: true })}
              />
            </label>
          )}
          <label className={formLabelClass}>
            退場
            <select className={textFieldClass} {...register(`${base}.exitPreset`)}>
              {(definition?.transitionPolicy.presets ?? ["none"]).map((preset) => (
                <option key={preset} value={preset}>
                  {PRESET_LABELS[preset] ?? preset}
                </option>
              ))}
            </select>
          </label>
          {cue.exitPreset !== "none" && (
            <label className={formLabelClass}>
              尺(ms)
              <input
                type="number"
                min={0}
                className={`w-20 ${textFieldClass}`}
                {...register(`${base}.exitDurationMs`, { valueAsNumber: true })}
              />
            </label>
          )}
        </div>
      </Collapsible>
    </div>
  );
}

interface CueFieldProps {
  field: TemplateFieldSpec;
  values: Record<string, string>;
  setField: (key: string, value: string) => void;
  setFields: (patch: Record<string, string>) => void;
  getFields: () => Record<string, string>;
  multiline?: boolean;
  animationPresets: readonly AnimationPreset[];
  lines: LineFormValue[];
  speakers: SpeakerFormValue[];
  rangeStartLineId: string | null;
}

interface CompositionVersionFieldProps {
  label: string;
  value: string;
  setField: (key: string, value: string) => void;
  fieldKey: string;
  profiles?: readonly CanvasProfile[];
}

function CompositionVersionField({ label, value, setField, fieldKey, profiles }: CompositionVersionFieldProps) {
  const compositions = useCompositions();
  const scriptSkin = useContext(ScriptSkinContext);
  const options = compositionVersionOptions(compositions.data ?? [], profiles);
  const knowsCurrent = value.length === 0 || options.some((option) => option.value === value);
  const provenanceByVersionId = useMemo(() => {
    const map = new Map<string, CompositionStyleProvenance | undefined>();
    for (const composition of compositions.data ?? []) {
      for (const version of composition.versions ?? []) {
        map.set(version.id, version.styleProvenance);
      }
    }
    return map;
  }, [compositions.data]);
  const provenance = provenanceByVersionId.get(value);
  const knownInLibrary = provenanceByVersionId.has(value);
  const mismatch =
    scriptSkin !== null && value.length > 0 && knownInLibrary
      ? skinMismatchMessage(
          compositionSkinRelation(scriptSkin, provenance),
          scriptSkin,
          provenance,
        )
      : undefined;
  return (
    <div className="my-2">
      <label className={formLabelClass}>
        {label}
        <select
          className={textFieldClass}
          value={value}
          onChange={(event) => setField(fieldKey, event.target.value)}
        >
          <option value="">未指定</option>
          {!knowsCurrent && <option value={value}>{value}（未公開または不明）</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {compositions.isLoading && <p className={metaTextClass}>公開バージョンを読み込み中…</p>}
      {compositions.isError && (
        <p className={errorTextClass}>公開バージョンを取得できませんでした。</p>
      )}
      {!compositions.isLoading && compositions.data !== undefined && options.length === 0 && (
        <p className={metaTextClass}>公開済みのCompositionVersionがありません。</p>
      )}
      {mismatch !== undefined && (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{mismatch}</p>
      )}
    </div>
  );
}

function PositionZoomControls({
  label,
  xKey,
  yKey,
  zoomKey,
  values,
  setField,
  setFields,
  getFields,
}: {
  label?: string;
  xKey: string;
  yKey: string;
  zoomKey?: string;
  values: Record<string, string>;
  setField: (key: string, value: string) => void;
  setFields: (values: Record<string, string>) => void;
  getFields: () => Record<string, string>;
}) {
  const center = String(CROP_CENTER_PERCENT);
  const xValue = values[xKey] ?? "";
  const yValue = values[yKey] ?? "";
  const zoomValue = zoomKey !== undefined ? (values[zoomKey] ?? "") : "";
  const xDisplay = xValue.length > 0 ? xValue : center;
  const yDisplay = yValue.length > 0 ? yValue : center;
  const zoomDisplay = zoomValue.length > 0 ? zoomValue : IDENTITY_ZOOM_PERCENT;
  const isCentered = xValue.length === 0 && yValue.length === 0;
  const moveAxis = (axisKey: string, otherKey: string, next: string) => {
    const otherValue = getFields()[otherKey] ?? "";
    setFields(
      otherValue.length === 0 ? { [axisKey]: next, [otherKey]: center } : { [axisKey]: next },
    );
  };
  return (
    <div className="my-2">
      <div className="flex flex-wrap items-center gap-2">
        {label !== undefined && <span className={formLabelTextClass}>{label}</span>}
        <span className={metaTextClass}>
          横 {xDisplay}% / 縦 {yDisplay}%
        </span>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
          disabled={isCentered}
          onClick={() => setFields({ [xKey]: "", [yKey]: "" })}
        >
          中央に戻す
        </button>
      </div>
      <label className="mt-1 flex items-center gap-2">
        <span className="w-6 text-xs">横</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          className="w-48"
          value={xDisplay}
          onChange={(event) => moveAxis(xKey, yKey, event.target.value)}
        />
      </label>
      <label className="mt-1 flex items-center gap-2">
        <span className="w-6 text-xs">縦</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          className="w-48"
          value={yDisplay}
          onChange={(event) => moveAxis(yKey, xKey, event.target.value)}
        />
      </label>
      {zoomKey !== undefined && (
        <label className="mt-1 flex items-center gap-2">
          <span className="w-6 text-xs">倍率</span>
          <input
            type="range"
            min={CROP_ZOOM_MIN_PERCENT}
            max={CROP_ZOOM_MAX_PERCENT}
            step={1}
            className="w-48"
            value={zoomDisplay}
            onChange={(event) => setField(zoomKey, event.target.value)}
          />
          <span className={metaTextClass}>{zoomDisplay}%</span>
          {zoomValue.length > 0 && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setField(zoomKey, "")}
            >
              等倍に戻す
            </button>
          )}
        </label>
      )}
    </div>
  );
}

function NestedScreenField({
  field,
  values,
  setField,
  setFields,
  getFields,
  lines,
  speakers,
  rangeStartLineId,
}: {
  field: Extract<TemplateFieldSpec, { kind: "nestedMedia" }>;
  values: Record<string, string>;
  setField: (key: string, value: string) => void;
  setFields: (values: Record<string, string>) => void;
  getFields: () => Record<string, string>;
  lines: LineFormValue[];
  speakers: SpeakerFormValue[];
  rangeStartLineId: string | null;
}) {
  const mode = values[`${field.key}${NESTED_MODE_SUFFIX}`] ?? NESTED_MODE_MEDIA;
  const isComposition = mode === NESTED_MODE_COMPOSITION;
  return (
    <div>
      <div className="my-2 flex flex-wrap items-center gap-2">
        <span className={formLabelTextClass}>{field.label}</span>
        <div className="inline-flex overflow-hidden rounded border border-border">
          <button
            type="button"
            aria-pressed={!isComposition}
            className={`px-2 py-0.5 text-xs ${isComposition ? "text-muted-foreground" : "bg-muted font-semibold"}`}
            onClick={() => setField(`${field.key}${NESTED_MODE_SUFFIX}`, NESTED_MODE_MEDIA)}
          >
            素材
          </button>
          <button
            type="button"
            aria-pressed={isComposition}
            className={`px-2 py-0.5 text-xs ${isComposition ? "bg-muted font-semibold" : "text-muted-foreground"}`}
            onClick={() => setField(`${field.key}${NESTED_MODE_SUFFIX}`, NESTED_MODE_COMPOSITION)}
          >
            Composition
          </button>
        </div>
      </div>
      {isComposition ? (
        <div>
          <CompositionVersionField
            label="Composition"
            value={values[`${field.key}${NESTED_COMPOSITION_VERSION_SUFFIX}`] ?? ""}
            setField={setField}
            fieldKey={`${field.key}${NESTED_COMPOSITION_VERSION_SUFFIX}`}
          />
          <label className={formLabelSpacedClass}>
            表示方法
            <select
              className={textFieldClass}
              value={values[`${field.key}${NESTED_COMPOSITION_FIT_SUFFIX}`] ?? "contain"}
              onChange={(event) => setField(`${field.key}${NESTED_COMPOSITION_FIT_SUFFIX}`, event.target.value)}
            >
              <option value="contain">全体を収める</option>
              <option value="cover">全体を覆う（切り抜き）</option>
            </select>
          </label>
          <PositionZoomControls
            xKey={`${field.key}${NESTED_COMPOSITION_POS_X_SUFFIX}`}
            yKey={`${field.key}${NESTED_COMPOSITION_POS_Y_SUFFIX}`}
            zoomKey={`${field.key}${NESTED_COMPOSITION_ZOOM_SUFFIX}`}
            values={values}
            setField={setField}
            setFields={setFields}
            getFields={getFields}
          />
        </div>
      ) : (
        <div>
          <MediaPicker
            label={field.label}
            kinds={field.assetKinds}
            selectedAssetId={(values[field.key] ?? "").length > 0 ? (values[field.key] ?? "") : null}
            onSelect={videoAssetSelectHandler(field.key, values[field.key] ?? "", setField, setFields)}
          />
          <label className={formLabelSpacedClass}>
            表示方法
            <select
              className={textFieldClass}
              value={values[`${field.key}${NESTED_MEDIA_FIT_SUFFIX}`] ?? "cover"}
              onChange={(event) => setField(`${field.key}${NESTED_MEDIA_FIT_SUFFIX}`, event.target.value)}
            >
              <option value="cover">全体を覆う（切り抜き）</option>
              <option value="contain">全体を収める</option>
            </select>
          </label>
          <CueVideoPlaybackField
            field={field}
            values={values}
            setField={setField}
            lines={lines}
            speakers={speakers}
            rangeStartLineId={rangeStartLineId}
          />
        </div>
      )}
    </div>
  );
}

function messageTargetLabels(values: Record<string, string>): string[] | undefined {
  const raw = values.messages;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return undefined;
    }
    return parsed.map((entry, index) => {
      const body =
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { body?: unknown }).body === "string"
          ? (entry as { body: string }).body
          : "";
      const first = body.split("\n")[0].trim();
      if (first.length === 0) {
        return `メッセージ ${index + 1}`;
      }
      return first.length > 24 ? `${first.slice(0, 24)}…` : first;
    });
  } catch {
    return undefined;
  }
}

function videoAssetSelectHandler(
  fieldKey: string,
  current: string,
  setField: (key: string, value: string) => void,
  setFields: (patch: Record<string, string>) => void,
): (assetId: string | null) => void {
  return (assetId) => {
    const next = assetId ?? "";
    if (next !== current) {
      setFields({ [fieldKey]: next, [`${fieldKey}${VIDEO_PLAYBACK_SUFFIX}`]: "" });
    } else {
      setField(fieldKey, next);
    }
  };
}

function CueVideoPlaybackField({
  field,
  values,
  setField,
  lines,
  speakers,
  rangeStartLineId,
}: {
  field: TemplateFieldSpec;
  values: Record<string, string>;
  setField: (key: string, value: string) => void;
  lines: LineFormValue[];
  speakers: SpeakerFormValue[];
  rangeStartLineId: string | null;
}) {
  if (
    (field.kind !== "media" && field.kind !== "nestedMedia") ||
    field.videoPlayback !== true ||
    (values[field.key] ?? "").length === 0
  ) {
    return null;
  }
  return (
    <VideoPlaybackField
      assetId={values[field.key] ?? ""}
      value={values[`${field.key}${VIDEO_PLAYBACK_SUFFIX}`] ?? ""}
      onChange={(next) => setField(`${field.key}${VIDEO_PLAYBACK_SUFFIX}`, next)}
      lines={lines}
      speakers={speakers}
      rangeStartLineId={rangeStartLineId}
    />
  );
}

function CueField({ field, values, setField, setFields, getFields, multiline = false, animationPresets, lines, speakers, rangeStartLineId }: CueFieldProps) {
  const value = values[field.key] ?? "";
  if (field.key === COMPOSITION_VERSION_FIELD_KEY) {
    return (
      <CompositionVersionField
        label={field.label}
        value={value}
        setField={setField}
        fieldKey={field.key}
        profiles={["landscape"]}
      />
    );
  }
  switch (field.kind) {
    case "media":
      return (
        <div>
          <MediaPicker
            label={field.label}
            kinds={field.assetKinds}
            selectedAssetId={value.length > 0 ? value : null}
            onSelect={videoAssetSelectHandler(field.key, value, setField, setFields)}
          />
          <CueVideoPlaybackField
            field={field}
            values={values}
            setField={setField}
            lines={lines}
            speakers={speakers}
            rangeStartLineId={rangeStartLineId}
          />
        </div>
      );
    case "nestedMedia":
      if (field.allowComposition) {
        return (
          <NestedScreenField
            field={field}
            values={values}
            setField={setField}
            setFields={setFields}
            getFields={getFields}
            lines={lines}
            speakers={speakers}
            rangeStartLineId={rangeStartLineId}
          />
        );
      }
      return (
        <div>
          <MediaPicker
            label={field.label}
            kinds={field.assetKinds}
            selectedAssetId={value.length > 0 ? value : null}
            onSelect={videoAssetSelectHandler(field.key, value, setField, setFields)}
          />
          <label className={formLabelSpacedClass}>
            表示方法
            <select
              className={textFieldClass}
              value={values[`${field.key}${NESTED_MEDIA_FIT_SUFFIX}`] ?? "cover"}
              onChange={(event) => setField(`${field.key}${NESTED_MEDIA_FIT_SUFFIX}`, event.target.value)}
            >
              <option value="cover">全体を覆う（切り抜き）</option>
              <option value="contain">全体を収める</option>
            </select>
          </label>
          <CueVideoPlaybackField
            field={field}
            values={values}
            setField={setField}
            lines={lines}
            speakers={speakers}
            rangeStartLineId={rangeStartLineId}
          />
        </div>
      );
    case "mediaCrop": {
      return (
        <PositionZoomControls
          label={field.label}
          xKey={`${field.key}${CROP_X_SUFFIX}`}
          yKey={`${field.key}${CROP_Y_SUFFIX}`}
          zoomKey={field.zoomKey !== undefined ? `${field.key}${CROP_ZOOM_SUFFIX}` : undefined}
          values={values}
          setField={setField}
          setFields={setFields}
          getFields={getFields}
        />
      );
    }
    case "text":
    case "optionalText":
      return (
        <label className={formLabelBlockClass}>
          {field.label}
          {multiline ? (
            <textarea
              rows={3}
              className={`mt-1 block w-full ${textFieldClass}`}
              value={value}
              onChange={(event) => setField(field.key, event.target.value)}
            />
          ) : (
            <input
              className={`mt-1 block w-full ${textFieldClass}`}
              value={value}
              onChange={(event) => setField(field.key, event.target.value)}
            />
          )}
        </label>
      );
    case "select":
      return (
        <label className={formLabelSpacedClass}>
          {field.label}
          <select
            className={textFieldClass}
            value={value}
            onChange={(event) => setField(field.key, event.target.value)}
          >
            {field.optional && <option value="">未指定</option>}
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      );
    case "color": {
      const hasColor = value.length > 0;
      const isHexColor = /^#[0-9A-Fa-f]{6}$/.test(value);
      const fallback = isHexColor ? value : "#FFFFFF";
      return (
        <label className={formLabelSpacedClass}>
          {field.label}
          <input
            type="color"
            className={colorFieldClass}
            value={fallback}
            onChange={(event) => setField(field.key, event.target.value)}
          />
          {hasColor ? (
            <>
              <span className="text-xs">{value}</span>
              {field.optional && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setField(field.key, "")}
                >
                  既定
                </button>
              )}
            </>
          ) : (
            <span className="text-xs text-muted-foreground">既定</span>
          )}
        </label>
      );
    }
    case "number":
    case "decimal":
      return (
        <label className={formLabelSpacedClass}>
          {field.label}
          <input
            type="number"
            min={field.min}
            max={field.max}
            step={field.kind === "number" ? (field.step ?? 1) : "any"}
            className={`w-24 ${textFieldClass}`}
            value={value}
            onChange={(event) => setField(field.key, event.target.value)}
          />
        </label>
      );
    case "grid":
      return (
        <DataGridField
          label={field.label}
          fieldKey={field.key}
          value={value}
          setField={setField}
          maxColumns={field.maxColumns}
          maxRows={field.maxRows}
        />
      );
    case "effects":
      return (
        <EffectsField
          label={field.label}
          fieldKey={field.key}
          variant={field.variant}
          value={value}
          setField={setField}
          lines={lines}
          speakers={speakers}
          messageLabels={field.variant === "chat" ? messageTargetLabels(values) : undefined}
        />
      );
    case "calloutItems":
      return (
        <CalloutItemsField
          label={field.label}
          fieldKey={field.key}
          value={value}
          setField={setField}
          lines={lines}
          speakers={speakers}
        />
      );
    case "messages":
      return (
        <MessagesField
          label={field.label}
          fieldKey={field.key}
          value={value}
          setField={setField}
          maxMessages={field.maxMessages}
        />
      );
    case "flow":
      return (
        <FlowField
          label={field.label}
          fieldKey={field.key}
          value={value}
          effectsKey={FLOW_EFFECTS_FIELD_KEY}
          effectsValue={values[FLOW_EFFECTS_FIELD_KEY] ?? ""}
          setField={setField}
          setFields={setFields}
          maxNodes={field.maxNodes}
          maxEdges={field.maxEdges}
        />
      );
    case "boolean": {
      const options = [
        { value: "", label: "既定" },
        { value: "true", label: "オン" },
        { value: "false", label: "オフ" },
      ];
      return (
        <div className="my-2 flex items-center gap-1.5">
          <span className={formLabelTextClass}>{field.label}</span>
          <div className="inline-flex overflow-hidden rounded border border-border">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`px-2 py-0.5 text-xs ${
                  value === option.value
                    ? "bg-brand-500 text-white"
                    : "bg-surface hover:bg-surface-muted"
                }`}
                onClick={() => setField(field.key, option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      );
    }
    case "animation":
      return (
        <div className="my-2 flex flex-wrap items-center gap-3">
          <label className={formLabelClass}>
            {field.label}
            <select
              className={textFieldClass}
              value={value.length > 0 ? value : "none"}
              onChange={(event) => setField(field.key, event.target.value)}
            >
              {animationPresets.map((preset) => (
                <option key={preset} value={preset}>
                  {PRESET_LABELS[preset] ?? preset}
                </option>
              ))}
            </select>
          </label>
          {(value.length > 0 ? value : "none") !== "none" && (
            <label className={formLabelClass}>
              尺(ms)
              <input
                type="number"
                min={0}
                className={`w-20 ${textFieldClass}`}
                value={values[`${field.key}__duration`] ?? String(DEFAULT_ANIMATION_POLICY.defaultDurationMs)}
                onChange={(event) => setField(`${field.key}__duration`, event.target.value)}
              />
            </label>
          )}
        </div>
      );
    default:
      return null;
  }
}

export function CueList({
  control,
  register,
  setValue,
  getValues,
  sceneIndex,
  sceneId,
  lines,
  speakers,
  sceneDurationMs,
  onRemoveCue,
  onCommitCue,
  bare = false,
}: CueListProps) {
  const { fields, append } = useFieldArray({ control, name: `scenes.${sceneIndex}.cues` });
  const watched = useWatch({ control, name: `scenes.${sceneIndex}.cues` }) ?? [];
  const templates = addableTemplates();
  const [addTemplate, setAddTemplate] = useState<string>(templates[0]?.id ?? "");

  const handleAdd = () => {
    const entry = templates.find((candidate) => candidate.id === addTemplate) ?? templates[0];
    if (entry === undefined) {
      return;
    }
    const layer = entry.layers[0] ?? "background";
    const cues = getValues(`scenes.${sceneIndex}.cues`) ?? [];
    const nextOrder =
      cues
        .filter((cue) => cue?.layer === layer && Number.isFinite(cue?.order))
        .reduce((max, cue) => Math.max(max, cue?.order ?? 0), -1) + 1;
    append(
      createCueFormValue({
        sceneId,
        templateId: entry.id,
        templateVersion: entry.version,
        layer,
        order: nextOrder,
      }),
    );
  };

  const handleDuplicate = (cueId: string) => {
    const cues = getValues(`scenes.${sceneIndex}.cues`) ?? [];
    const source = cues.find((cue) => cue?.id === cueId);
    if (source === undefined) {
      return;
    }
    const copy = duplicateCueFormValue(source, sceneId, cues);
    if (copy === null) {
      return;
    }
    append(copy);
  };

  return (
    <div className={bare ? undefined : editAreaClass}>
      {!bare && <h4 className="text-sm font-semibold text-foreground">映像演出</h4>}
      {fields.map((field, cueIndex) => {
        const cue = watched[cueIndex];
        if (cue === undefined) {
          return null;
        }
        return (
          <CueRow
            key={field.id}
            register={register}
            setValue={setValue}
            getValues={getValues}
            sceneIndex={sceneIndex}
            cueIndex={cueIndex}
            cue={cue}
            lines={lines}
            speakers={speakers}
            sceneDurationMs={sceneDurationMs}
            onRemove={() => onRemoveCue(cue.id)}
            onDuplicate={cue.baseCue === null ? null : () => handleDuplicate(cue.id)}
            onCommitCue={() => onCommitCue(cue.id)}
          />
        );
      })}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className={formLabelClass}>
          新しい映像演出
          <select
            className={textFieldClass}
            value={addTemplate}
            onChange={(event) => setAddTemplate(event.target.value)}
          >
            {templates.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={buttonNeutralClass} onClick={handleAdd}>
          <Clapperboard aria-hidden="true" className="h-4 w-4" />
          映像演出を追加
        </button>
      </div>
    </div>
  );
}
