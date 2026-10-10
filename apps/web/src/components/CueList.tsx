import { useState } from "react";
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
  getVisualTemplate,
  listVisualTemplateCatalog,
  type AnimationPreset,
  type CueLayer,
  type TemplateFieldSpec,
} from "@kakeai/contracts";
import {
  STANDING_TEMPLATE_ID,
  createCueFormValue,
  type CueFormValue,
  type DocumentFormValues,
  type LineFormValue,
} from "../content/form";
import { buttonNeutralClass, metaTextClass, textFieldClass } from "../ui";
import { MediaPicker } from "./MediaPicker";

const LAYER_LABELS: Record<CueLayer, string> = {
  background: "背景",
  card: "カード",
  standing: "立ち絵",
  overlay: "オーバーレイ",
};

const PRESET_LABELS: Record<string, string> = {
  none: "なし",
  fade: "フェード",
  "slide-up": "上へスライド",
  "slide-down": "下へスライド",
  "slide-left": "左へスライド",
  "slide-right": "右へスライド",
  "scale-in": "拡大",
  pulse: "パルス",
};

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
}

interface CueRowProps {
  register: UseFormRegister<DocumentFormValues>;
  setValue: UseFormSetValue<DocumentFormValues>;
  getValues: UseFormGetValues<DocumentFormValues>;
  sceneIndex: number;
  cueIndex: number;
  cue: CueFormValue;
  lines: LineFormValue[];
  onRemove: () => void;
}

function CueRow({
  register,
  setValue,
  getValues,
  sceneIndex,
  cueIndex,
  cue,
  lines,
  onRemove,
}: CueRowProps) {
  const base = `scenes.${sceneIndex}.cues.${cueIndex}` as const;
  const definition = getVisualTemplate(cue.templateId, cue.templateVersion);
  const layerOptions = definition?.layers ?? ["background"];
  const fields = definition?.inputFields;
  const fieldsPath = `${base}.fields` as const;
  const setField = (key: string, value: string) => {
    const current = getValues(fieldsPath) ?? {};
    setValue(fieldsPath, { ...current, [key]: value }, { shouldDirty: true });
  };

  return (
    <div className="mt-2 rounded border border-border p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {definition?.display.label ?? cue.templateId}@{cue.templateVersion}
        </span>
        <label className="inline-flex items-center gap-1.5">
          レイヤー
          <select className={textFieldClass} {...register(`${base}.layer`)}>
            {layerOptions.map((layer) => (
              <option key={layer} value={layer}>
                {LAYER_LABELS[layer] ?? layer}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-1.5">
          順序
          <input
            type="number"
            min={0}
            className={`w-20 ${textFieldClass}`}
            {...register(`${base}.order`, { valueAsNumber: true })}
          />
        </label>
        <button type="button" className={`ml-auto ${buttonNeutralClass}`} onClick={onRemove}>
          削除
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1.5">
          表示区間
          <select className={textFieldClass} {...register(`${base}.rangeKind`)}>
            <option value="scene">Scene全体</option>
            <option value="lines">セリフ区間</option>
            <option value="offset">オフセット</option>
          </select>
        </label>
        {cue.rangeKind === "lines" && (
          <>
            <label className="inline-flex items-center gap-1.5">
              開始
              <select className={textFieldClass} {...register(`${base}.startLineId`)}>
                <option value="">選択</option>
                {lines.map((line, index) => (
                  <option key={line.id} value={line.id}>
                    {index + 1}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-flex items-center gap-1.5">
              終了
              <select className={textFieldClass} {...register(`${base}.endLineId`)}>
                <option value="">選択</option>
                {lines.map((line, index) => (
                  <option key={line.id} value={line.id}>
                    {index + 1}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {cue.rangeKind === "offset" && (
          <>
            <label className="inline-flex items-center gap-1.5">
              開始(ms)
              <input
                type="number"
                min={0}
                className={`w-24 ${textFieldClass}`}
                {...register(`${base}.startMs`, { valueAsNumber: true })}
              />
            </label>
            <label className="inline-flex items-center gap-1.5">
              終了(ms)
              <input
                type="number"
                min={0}
                className={`w-24 ${textFieldClass}`}
                {...register(`${base}.endMs`, { valueAsNumber: true })}
              />
            </label>
          </>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1.5">
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
          <label className="inline-flex items-center gap-1.5">
            尺(ms)
            <input
              type="number"
              min={0}
              className={`w-20 ${textFieldClass}`}
              {...register(`${base}.enterDurationMs`, { valueAsNumber: true })}
            />
          </label>
        )}
        <label className="inline-flex items-center gap-1.5">
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
          <label className="inline-flex items-center gap-1.5">
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

      {fields === undefined || fields.length === 0 ? (
        <p className={metaTextClass}>
          このテンプレートはUI未対応のため、内容は非破壊で保持されます。
        </p>
      ) : (
        <div className="mt-2 border-t border-dashed border-border pt-2">
          {fields.map((field) => (
            <CueField
              key={field.key}
              field={field}
              values={cue.fields}
              setField={setField}
              animationPresets={definition?.animationPolicy.presets ?? ANIMATION_PRESETS}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface CueFieldProps {
  field: TemplateFieldSpec;
  values: Record<string, string>;
  setField: (key: string, value: string) => void;
  animationPresets: readonly AnimationPreset[];
}

function CueField({ field, values, setField, animationPresets }: CueFieldProps) {
  const value = values[field.key] ?? "";
  switch (field.kind) {
    case "media":
    case "nestedMedia":
      return (
        <div>
          <MediaPicker
            label={field.label}
            kinds={field.assetKinds}
            selectedAssetId={value.length > 0 ? value : null}
            onSelect={(assetId) => setField(field.key, assetId ?? "")}
          />
          {field.kind === "nestedMedia" && (
            <label className="my-2 inline-flex items-center gap-1.5">
              fit
              <select
                className={textFieldClass}
                value={values[`${field.key}__fit`] ?? "cover"}
                onChange={(event) => setField(`${field.key}__fit`, event.target.value)}
              >
                <option value="cover">cover</option>
                <option value="contain">contain</option>
              </select>
            </label>
          )}
        </div>
      );
    case "text":
    case "optionalText":
      return (
        <label className="my-2 block">
          {field.label}
          <input
            className={`mt-1 block w-full ${textFieldClass}`}
            value={value}
            onChange={(event) => setField(field.key, event.target.value)}
          />
        </label>
      );
    case "select":
      return (
        <label className="my-2 inline-flex items-center gap-1.5">
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
    case "color":
      return (
        <label className="my-2 inline-flex items-center gap-1.5">
          {field.label}
          <input
            type="text"
            placeholder="#RRGGBB"
            className={`w-32 ${textFieldClass}`}
            value={value}
            onChange={(event) => setField(field.key, event.target.value)}
          />
        </label>
      );
    case "number":
      return (
        <label className="my-2 inline-flex items-center gap-1.5">
          {field.label}
          <input
            type="number"
            min={field.min}
            max={field.max}
            step={field.step}
            className={`w-24 ${textFieldClass}`}
            value={value}
            onChange={(event) => setField(field.key, event.target.value)}
          />
        </label>
      );
    case "boolean":
      return (
        <label className="my-2 inline-flex items-center gap-1.5">
          {field.label}
          <select
            className={textFieldClass}
            value={value}
            onChange={(event) => setField(field.key, event.target.value)}
          >
            <option value="">未指定</option>
            <option value="true">オン</option>
            <option value="false">オフ</option>
          </select>
        </label>
      );
    case "animation":
      return (
        <div className="my-2 flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-1.5">
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
            <label className="inline-flex items-center gap-1.5">
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
}: CueListProps) {
  const { fields, append, remove } = useFieldArray({ control, name: `scenes.${sceneIndex}.cues` });
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

  return (
    <div className="mt-3 border-t border-dashed border-border pt-2">
      <span className="text-sm font-medium">Cue</span>
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
            onRemove={() => remove(cueIndex)}
          />
        );
      })}
      <div className="mt-2 flex flex-wrap items-center gap-2">
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
        <button type="button" className={buttonNeutralClass} onClick={handleAdd}>
          Cueを追加
        </button>
      </div>
    </div>
  );
}
