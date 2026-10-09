import {
  useFieldArray,
  useWatch,
  type Control,
  type UseFormGetValues,
  type UseFormRegister,
  type UseFormSetValue,
} from "react-hook-form";
import type { DocumentFormValues, TakeFormValue } from "../content/form";
import { createEmptyLine, newTakeId } from "../content/form";
import { useAssets } from "../api/hooks";
import { buttonNeutralClass, metaTextClass, textFieldClass } from "../ui";
import { MediaPicker } from "./MediaPicker";

interface LinesEditorProps {
  control: Control<DocumentFormValues>;
  register: UseFormRegister<DocumentFormValues>;
  getValues: UseFormGetValues<DocumentFormValues>;
  setValue: UseFormSetValue<DocumentFormValues>;
  sceneIndex: number;
  sceneId: string;
}

function formatDuration(durationMs: number): string {
  const seconds = durationMs / 1000;
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)}秒`;
}

export function LinesEditor({
  control,
  register,
  getValues,
  setValue,
  sceneIndex,
  sceneId,
}: LinesEditorProps) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: `scenes.${sceneIndex}.lines`,
  });
  const watchedLines = useWatch({ control, name: `scenes.${sceneIndex}.lines` }) ?? [];
  const assets = useAssets();

  const fileName = (assetId: string): string =>
    assets.data?.find((asset) => asset.id === assetId)?.originalFilename ?? assetId;

  const addTake = (lineIndex: number, assetId: string) => {
    const asset = assets.data?.find((entry) => entry.id === assetId);
    if (asset === undefined || asset.durationMs === null) {
      return;
    }
    const path = `scenes.${sceneIndex}.lines.${lineIndex}` as const;
    const lineId = getValues(`${path}.id`);
    if (lineId === undefined) {
      return;
    }
    const takes = (getValues(`${path}.takes`) ?? []) as TakeFormValue[];
    if (takes.some((take) => take.assetId === assetId)) {
      return;
    }
    const takeId = newTakeId(lineId);
    setValue(
      `${path}.takes`,
      [...takes, { id: takeId, assetId, durationMs: asset.durationMs, source: "manual" }],
      { shouldDirty: true },
    );
    setValue(`${path}.selectedAudioTakeId`, takeId, { shouldDirty: true });
  };

  const deleteTake = (lineIndex: number, takeId: string) => {
    const path = `scenes.${sceneIndex}.lines.${lineIndex}` as const;
    const takes = (getValues(`${path}.takes`) ?? []) as TakeFormValue[];
    setValue(
      `${path}.takes`,
      takes.filter((take) => take.id !== takeId),
      { shouldDirty: true },
    );
    if (getValues(`${path}.selectedAudioTakeId`) === takeId) {
      setValue(`${path}.selectedAudioTakeId`, null, { shouldDirty: true });
    }
  };

  return (
    <div className="mt-3 border-t border-dashed border-border pt-2">
      <h4 className="mb-2 font-semibold">セリフ</h4>
      {fields.map((field, lineIndex) => {
        const line = watchedLines[lineIndex];
        const takes = line?.takes ?? [];
        return (
          <div key={field.id} className="my-2 grid gap-1.5 rounded border border-border p-2">
            <textarea
              rows={2}
              placeholder="字幕テキスト"
              className={`block w-full ${textFieldClass}`}
              {...register(`scenes.${sceneIndex}.lines.${lineIndex}.captionText`)}
            />
            <input
              placeholder="読み上げテキスト（TTS用）"
              className={`block w-full ${textFieldClass}`}
              {...register(`scenes.${sceneIndex}.lines.${lineIndex}.speechText`)}
            />

            <div className="mt-1">
              {takes.length === 0 ? (
                <p className={metaTextClass}>音声なし（字幕のみ）</p>
              ) : (
                <ul className="m-0 list-none p-0">
                  {takes.map((take) => (
                    <li key={take.id} className="flex items-center gap-2 py-0.5">
                      <label className="inline-flex items-center gap-1.5 text-sm">
                        <input
                          type="radio"
                          name={`line-${field.id}`}
                          checked={line?.selectedAudioTakeId === take.id}
                          onChange={() =>
                            setValue(
                              `scenes.${sceneIndex}.lines.${lineIndex}.selectedAudioTakeId`,
                              take.id,
                              { shouldDirty: true },
                            )
                          }
                        />
                        {fileName(take.assetId)}（{formatDuration(take.durationMs)}）
                      </label>
                      <button
                        type="button"
                        className={buttonNeutralClass}
                        onClick={() => deleteTake(lineIndex, take.id)}
                      >
                        削除
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {line?.selectedAudioTakeId !== null && line?.selectedAudioTakeId !== undefined && (
                <button
                  type="button"
                  className={buttonNeutralClass}
                  onClick={() =>
                    setValue(
                      `scenes.${sceneIndex}.lines.${lineIndex}.selectedAudioTakeId`,
                      null,
                      { shouldDirty: true },
                    )
                  }
                >
                  音声を解除
                </button>
              )}
              <MediaPicker
                label="音声を追加"
                kinds={["audio"]}
                selectedAssetId={null}
                onSelect={(assetId) => {
                  if (assetId !== null) {
                    addTake(lineIndex, assetId);
                  }
                }}
              />
            </div>

            <button type="button" className={buttonNeutralClass} onClick={() => remove(lineIndex)}>
              セリフを削除
            </button>
          </div>
        );
      })}
      <button type="button" className={buttonNeutralClass} onClick={() => append(createEmptyLine(sceneId))}>
        セリフを追加
      </button>
    </div>
  );
}
