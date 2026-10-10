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
  getVisualTemplate,
  listVisualTemplateCatalog,
  type CueLayer,
} from "@kakeai/contracts";
import {
  createCueFormValue,
  isEditableTemplate,
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

const ADDABLE_TEMPLATE_IDS = ["media.full-bleed", "media.card", "scene.device-frame"] as const;

interface CueListProps {
  control: Control<DocumentFormValues>;
  register: UseFormRegister<DocumentFormValues>;
  setValue: UseFormSetValue<DocumentFormValues>;
  getValues: UseFormGetValues<DocumentFormValues>;
  sceneIndex: number;
  sceneId: string;
  lines: LineFormValue[];
}

function allowedLayersFor(templateId: string, version: number): readonly CueLayer[] {
  return getVisualTemplate(templateId, version)?.layers ?? ["background"];
}

interface CueRowProps {
  register: UseFormRegister<DocumentFormValues>;
  setValue: UseFormSetValue<DocumentFormValues>;
  sceneIndex: number;
  cueIndex: number;
  cue: CueFormValue;
  lines: LineFormValue[];
  onRemove: () => void;
}

function CueRow({
  register,
  setValue,
  sceneIndex,
  cueIndex,
  cue,
  lines,
  onRemove,
}: CueRowProps) {
  const base = `scenes.${sceneIndex}.cues.${cueIndex}` as const;
  const layerOptions = allowedLayersFor(cue.templateId, cue.templateVersion);
  const definition = getVisualTemplate(cue.templateId, cue.templateVersion);
  const editable = isEditableTemplate(cue.templateId);
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
            <option value="none">なし</option>
            <option value="fade">フェード</option>
          </select>
        </label>
        {cue.enterPreset === "fade" && (
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
            <option value="none">なし</option>
            <option value="fade">フェード</option>
          </select>
        </label>
        {cue.exitPreset === "fade" && (
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

      {!editable && (
        <p className={metaTextClass}>
          このテンプレートはUI未対応のため、内容は非破壊で保持されます。
        </p>
      )}
      {editable && (
        <div className="mt-2 border-t border-dashed border-border pt-2">
          <MediaPicker
            label={cue.templateId === "scene.device-frame" ? "画面" : "素材"}
            kinds={["image", "video"]}
            selectedAssetId={cue.assetId}
            onSelect={(assetId) => setValue(`${base}.assetId`, assetId, { shouldDirty: true })}
          />
          <label className="my-2 inline-flex items-center gap-1.5">
            fit
            <select className={textFieldClass} {...register(`${base}.fit`)}>
              <option value="cover">cover</option>
              <option value="contain">contain</option>
            </select>
          </label>
          {cue.templateId === "media.card" && (
            <>
              <label className="my-2 block">
                カード見出し
                <input className={`mt-1 block w-full ${textFieldClass}`} {...register(`${base}.heading`)} />
              </label>
              <label className="my-2 block">
                カード補足文
                <input className={`mt-1 block w-full ${textFieldClass}`} {...register(`${base}.caption`)} />
              </label>
            </>
          )}
          {cue.templateId === "scene.device-frame" && (
            <div className="my-2 flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-1.5">
                フレーム
                <select className={textFieldClass} {...register(`${base}.frame`)}>
                  <option value="laptop">ラップトップ</option>
                  <option value="phone">スマートフォン</option>
                </select>
              </label>
              <label className="inline-flex items-center gap-1.5">
                背景色
                <input
                  type="text"
                  placeholder="#F1F5F9"
                  className={`w-32 ${textFieldClass}`}
                  {...register(`${base}.backgroundColor`)}
                />
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
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
  const [addTemplate, setAddTemplate] = useState<string>(ADDABLE_TEMPLATE_IDS[0]);

  const catalog = listVisualTemplateCatalog().filter((entry) =>
    (ADDABLE_TEMPLATE_IDS as readonly string[]).includes(entry.id),
  );

  const handleAdd = () => {
    const entry =
      catalog.find((candidate) => candidate.id === addTemplate) ?? catalog[0];
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
          {catalog.map((entry) => (
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
