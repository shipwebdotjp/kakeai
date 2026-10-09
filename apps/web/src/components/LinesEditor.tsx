import { useEffect, useState } from "react";
import {
  useFieldArray,
  useWatch,
  type Control,
  type UseFormGetValues,
  type UseFormRegister,
  type UseFormSetValue,
} from "react-hook-form";
import {
  MAX_TTS_SPEED_SCALE,
  MIN_TTS_SPEED_SCALE,
  type TtsVoice,
  type VoiceProfile,
} from "@kakeai/contracts";
import type {
  DocumentFormValues,
  LineFormValue,
  SpeakerFormValue,
  TakeFormValue,
} from "../content/form";
import { createEmptyLine, newTakeId } from "../content/form";
import { useAssets, useGenerateTtsTake } from "../api/hooks";
import {
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
  textFieldClass,
} from "../ui";
import { MediaPicker } from "./MediaPicker";

interface LinesEditorProps {
  control: Control<DocumentFormValues>;
  register: UseFormRegister<DocumentFormValues>;
  getValues: UseFormGetValues<DocumentFormValues>;
  setValue: UseFormSetValue<DocumentFormValues>;
  sceneIndex: number;
  sceneId: string;
  scriptVersionId: string;
  speakers: SpeakerFormValue[];
  voiceProfiles: VoiceProfile[];
  voices: TtsVoice[] | undefined;
  voicesLoading: boolean;
  formDirty: boolean;
}

function formatDuration(durationMs: number): string {
  const seconds = durationMs / 1000;
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)}秒`;
}

interface LineEditorProps extends Omit<LinesEditorProps, "sceneId" | "control"> {
  lineIndex: number;
  line: LineFormValue;
  onRemove: () => void;
}

const MIN_SPEED = MIN_TTS_SPEED_SCALE;
const MAX_SPEED = MAX_TTS_SPEED_SCALE;
const SPEED_STEP = 0.05;

function LineEditor({
  register,
  getValues,
  setValue,
  sceneIndex,
  lineIndex,
  line,
  onRemove,
  speakers,
  voiceProfiles,
  voices,
  voicesLoading,
  formDirty,
  scriptVersionId,
}: LineEditorProps) {
  const assets = useAssets();
  const generate = useGenerateTtsTake(scriptVersionId);
  const [styleId, setStyleId] = useState<number | null>(null);
  const [speedScale, setSpeedScale] = useState(1);

  const speaker = speakers.find((entry) => entry.id === line.speakerId);
  const profile = voiceProfiles.find((entry) => entry.id === speaker?.voiceProfileId);
  const voice = voices?.find((entry) => entry.voiceId === profile?.settings.speakerUuid);
  const styles = voice?.styles;

  useEffect(() => {
    if (profile === undefined) {
      setStyleId(null);
      return;
    }
    const available = styles ?? [];
    setStyleId((previous) => {
      if (previous !== null && available.some((style) => style.styleId === previous)) {
        return previous;
      }
      const hasDefault = available.some(
        (style) => style.styleId === profile.settings.defaultStyleId,
      );
      return hasDefault ? profile.settings.defaultStyleId : (available[0]?.styleId ?? null);
    });
  }, [profile?.id, profile?.settings.defaultStyleId, voice?.voiceId, styles]);

  useEffect(() => {
    setSpeedScale(1);
  }, [profile?.id, voice?.voiceId]);

  const fileName = (assetId: string): string =>
    assets.data?.find((asset) => asset.id === assetId)?.originalFilename ?? assetId;

  const path = `scenes.${sceneIndex}.lines.${lineIndex}` as const;

  const addTake = (assetId: string, durationMs: number, source: "manual" | "tts") => {
    const takes = (getValues(`${path}.takes`) ?? []) as TakeFormValue[];
    const existing = takes.find(
      (take) => take.assetId === assetId && take.source === source,
    );
    const takeId = existing?.id ?? newTakeId(line.id);
    if (existing === undefined) {
      setValue(
        `${path}.takes`,
        [...takes, { id: takeId, assetId, durationMs, source }],
        { shouldDirty: true },
      );
    } else {
      setValue(
        `${path}.takes`,
        takes.map((take) => (take.id === takeId ? { ...take, durationMs } : take)),
        { shouldDirty: true },
      );
    }
    setValue(`${path}.selectedAudioTakeId`, takeId, { shouldDirty: true });
  };

  const addManualTake = (assetId: string) => {
    const asset = assets.data?.find((entry) => entry.id === assetId);
    if (asset === undefined || asset.durationMs === null) {
      return;
    }
    addTake(assetId, asset.durationMs, "manual");
  };

  const deleteTake = (takeId: string) => {
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

  const onGenerate = () => {
    if (styleId === null) {
      return;
    }
    generate.mutate(
      { narrationSegmentId: line.id, styleId, speedScale },
      {
        onSuccess: (result) => {
          addTake(result.assetId, result.durationMs, "tts");
        },
      },
    );
  };

  const takes = line.takes;

  return (
    <div className="my-2 grid gap-1.5 rounded border border-border p-2">
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
      <label className="inline-flex items-center gap-1.5 text-sm">
        話者
        <select
          className={textFieldClass}
          value={line.speakerId ?? ""}
          onChange={(event) =>
            setValue(`${path}.speakerId`, event.target.value === "" ? null : event.target.value, {
              shouldDirty: true,
            })
          }
        >
          <option value="">なし</option>
          {speakers.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name || entry.id}
            </option>
          ))}
        </select>
      </label>

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
                    name={`line-${line.id}`}
                    checked={line.selectedAudioTakeId === take.id}
                    onChange={() =>
                      setValue(`${path}.selectedAudioTakeId`, take.id, { shouldDirty: true })
                    }
                  />
                  {take.source === "tts" ? "TTS: " : ""}
                  {fileName(take.assetId)}（{formatDuration(take.durationMs)}）
                </label>
                <button
                  type="button"
                  className={buttonNeutralClass}
                  onClick={() => deleteTake(take.id)}
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}
        {line.selectedAudioTakeId !== null && (
          <button
            type="button"
            className={buttonNeutralClass}
            onClick={() => setValue(`${path}.selectedAudioTakeId`, null, { shouldDirty: true })}
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
              addManualTake(assetId);
            }
          }}
        />
      </div>

      <div className="mt-1 border-t border-dashed border-border pt-2">
        {formDirty ? (
          <p className={errorTextClass}>
            未保存の変更があります。TTSは保存済みの読み上げテキストを使うため、先に保存してください。
          </p>
        ) : (
          <p className={metaTextClass}>TTS生成（保存済みの読み上げテキストを使います）</p>
        )}
        {profile === undefined ? (
          <p className={metaTextClass}>
            話者に声プロファイルを設定すると TTS を生成できます。
          </p>
        ) : voicesLoading ? (
          <p className={metaTextClass}>音声一覧を読み込み中…</p>
        ) : voice === undefined ? (
          <p className={errorTextClass}>
            声プロファイルの話者が VOICEVOX ENGINE に見つかりません。
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-1.5">
              スタイル
              <select
                className={textFieldClass}
                value={styleId ?? ""}
                onChange={(event) => {
                  if (event.target.value === "") {
                    setStyleId(null);
                    return;
                  }
                  const next = Number(event.target.value);
                  setStyleId(Number.isInteger(next) ? next : null);
                }}
              >
                {(styles ?? []).map((style) => (
                  <option key={style.styleId} value={style.styleId}>
                    {style.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-flex items-center gap-1.5">
              話速
              <input
                type="number"
                min={MIN_SPEED}
                max={MAX_SPEED}
                step={SPEED_STEP}
                className={`w-20 ${textFieldClass}`}
                value={speedScale}
                onChange={(event) => {
                  const raw = event.target.value;
                  if (raw === "") {
                    return;
                  }
                  const next = Number(raw);
                  if (Number.isFinite(next)) {
                    setSpeedScale(Math.min(MAX_SPEED, Math.max(MIN_SPEED, next)));
                  }
                }}
              />
              倍
            </label>
            <button
              type="button"
              className={buttonPrimaryClass}
              disabled={generate.isPending || styleId === null || formDirty}
              onClick={onGenerate}
            >
              {generate.isPending ? "生成中…" : "TTS生成"}
            </button>
          </div>
        )}
        {generate.isError && <p className={errorTextClass}>{generate.error.message}</p>}
      </div>

      <button type="button" className={buttonNeutralClass} onClick={onRemove}>
        セリフを削除
      </button>
    </div>
  );
}

export function LinesEditor({
  control,
  register,
  getValues,
  setValue,
  sceneIndex,
  sceneId,
  scriptVersionId,
  speakers,
  voiceProfiles,
  voices,
  voicesLoading,
  formDirty,
}: LinesEditorProps) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: `scenes.${sceneIndex}.lines`,
  });
  const watchedLines = useWatch({ control, name: `scenes.${sceneIndex}.lines` }) ?? [];

  return (
    <div className="mt-3 border-t border-dashed border-border pt-2">
      <h4 className="mb-2 font-semibold">セリフ</h4>
      {fields.map((field, lineIndex) => {
        const line = watchedLines[lineIndex];
        if (line === undefined) {
          return null;
        }
        return (
          <LineEditor
            key={field.id}
            register={register}
            getValues={getValues}
            setValue={setValue}
            sceneIndex={sceneIndex}
            lineIndex={lineIndex}
            line={line}
            onRemove={() => remove(lineIndex)}
            scriptVersionId={scriptVersionId}
            speakers={speakers}
            voiceProfiles={voiceProfiles}
            voices={voices}
            voicesLoading={voicesLoading}
            formDirty={formDirty}
          />
        );
      })}
      <button
        type="button"
        className={buttonNeutralClass}
        onClick={() => append(createEmptyLine(sceneId))}
      >
        セリフを追加
      </button>
    </div>
  );
}
