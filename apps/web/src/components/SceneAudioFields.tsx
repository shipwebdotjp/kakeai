import { useRef } from "react";
import {
  useFieldArray,
  useWatch,
  type Control,
  type UseFormGetValues,
  type UseFormRegister,
  type UseFormSetValue,
} from "react-hook-form";
import type { AudioCueRole } from "@kakeai/contracts";
import {
  AUDIO_CUE_ROLES,
  AUDIO_CUE_ROLE_LABELS,
  defaultAudioGainDb,
  type DocumentFormValues,
} from "../content/form";
import { buttonDangerClass, metaTextClass, textFieldClass } from "../ui";
import { MediaPicker } from "./MediaPicker";

interface SceneAudioFieldsProps {
  control: Control<DocumentFormValues>;
  register: UseFormRegister<DocumentFormValues>;
  getValues: UseFormGetValues<DocumentFormValues>;
  setValue: UseFormSetValue<DocumentFormValues>;
  sceneIndex: number;
  onCommitAudioCue: (cueIndex: number) => void;
}

export function SceneAudioFields({
  control,
  register,
  getValues,
  setValue,
  sceneIndex,
  onCommitAudioCue,
}: SceneAudioFieldsProps) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: `scenes.${sceneIndex}.audioCues`,
  });
  const watched = useWatch({ control, name: `scenes.${sceneIndex}.audioCues` }) ?? [];
  const snapshotRef = useRef(new Map<number, string>());
  const readSlot = (cueIndex: number) =>
    (getValues(`scenes.${sceneIndex}.audioCues`) ?? [])[cueIndex];

  return (
    <div className="mt-3 border-t border-dashed border-border pt-2">
      <h4 className="text-sm font-semibold">シーン音声</h4>
      <p className={metaTextClass}>
        このシーンの先頭から終端まで再生する音声です。開始オフセット・フェード・ダッキングはありません。
      </p>
      <ul className="m-0 list-none p-0">
        {fields.map((field, cueIndex) => {
          const cue = watched[cueIndex];
          if (cue === undefined) {
            return null;
          }
          const path = `scenes.${sceneIndex}.audioCues.${cueIndex}` as const;
          return (
            <li
              key={field.id}
              className="my-2 grid gap-1.5 rounded border border-border p-2"
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
                if (
                  related === null &&
                  snapshotRef.current.has(cueIndex)
                ) {
                  return;
                }
                const slot = readSlot(cueIndex);
                snapshotRef.current.set(
                  cueIndex,
                  slot === undefined ? "" : JSON.stringify(slot),
                );
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
                const slot = readSlot(cueIndex);
                const current =
                  slot === undefined ? "" : JSON.stringify(slot);
                if (current === (snapshotRef.current.get(cueIndex) ?? "")) {
                  return;
                }
                snapshotRef.current.set(cueIndex, current);
                onCommitAudioCue(cueIndex);
              }}
            >
              <MediaPicker
                label={`音声 ${cueIndex + 1}`}
                kinds={["audio"]}
                selectedAssetId={cue.assetId}
                onSelect={(assetId) =>
                  setValue(`${path}.assetId`, assetId, { shouldDirty: true })
                }
              />
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-1.5 text-sm">
                  役割
                  <select className={textFieldClass} {...register(`${path}.role`)}>
                    {AUDIO_CUE_ROLES.map((role: AudioCueRole) => (
                      <option key={role} value={role}>
                        {AUDIO_CUE_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="inline-flex items-center gap-1.5 text-sm">
                  <input type="checkbox" {...register(`${path}.loop`)} />
                  ループ
                </label>
                <label className="inline-flex items-center gap-1.5 text-sm">
                  音量
                  <input
                    type="number"
                    step="1"
                    className={`w-24 ${textFieldClass}`}
                    {...register(`${path}.gainDb`, {
                      setValueAs: (value) => {
                        if (value === "" || Number.isNaN(Number(value))) {
                          const role = getValues(`${path}.role`) ?? cue.role;
                          return defaultAudioGainDb(role);
                        }
                        return Number(value);
                      },
                    })}
                  />
                  dB
                </label>
                <button
                  type="button"
                  className={`ml-auto ${buttonDangerClass}`}
                  onClick={() => remove(cueIndex)}
                >
                  削除
                </button>
              </div>
              {cue.assetId === null && (
                <p className={metaTextClass}>素材が未選択です。保存時に除外されます。</p>
              )}
            </li>
          );
        })}
      </ul>
      <MediaPicker
        label="音声を追加"
        inline
        kinds={["audio"]}
        selectedAssetId={null}
        variant="add"
        onSelect={(assetId) => {
          if (assetId !== null) {
            append({
              cueId: null,
              assetId,
              role: "bgm",
              gainDb: defaultAudioGainDb("bgm"),
              loop: false,
            });
          }
        }}
      />
    </div>
  );
}
