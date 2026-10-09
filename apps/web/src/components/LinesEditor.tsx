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
  MAX_TTS_SPEECH_TEXT_LENGTH,
  MAX_TTS_SPEED_SCALE,
  MIN_TTS_SPEED_SCALE,
  type VoiceAdapterId,
  type VoiceProfile,
} from "@kakeai/contracts";
import type {
  CharacterFormValue,
  DocumentFormValues,
  LineFormValue,
  SpeakerFormValue,
  TakeFormValue,
} from "../content/form";
import { createEmptyLine, newSpeakerId, newTakeId } from "../content/form";
import { useAssets, useGenerateTtsTake } from "../api/hooks";
import { type AdapterVoicesState, adapterLabel } from "../lib/voiceAdapters";
import {
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
  textFieldClass,
} from "../ui";
import { MediaPicker } from "./MediaPicker";
import { TakeAudioPlayer } from "./TakeAudioPlayer";

interface LinesEditorProps {
  control: Control<DocumentFormValues>;
  register: UseFormRegister<DocumentFormValues>;
  getValues: UseFormGetValues<DocumentFormValues>;
  setValue: UseFormSetValue<DocumentFormValues>;
  sceneIndex: number;
  sceneId: string;
  scriptVersionId: string;
  speakers: SpeakerFormValue[];
  characters: CharacterFormValue[];
  voiceProfiles: VoiceProfile[];
  adapterVoices: Record<VoiceAdapterId, AdapterVoicesState>;
  savedVoiceByLineId: ReadonlyMap<string, string | null>;
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
  characters,
  voiceProfiles,
  adapterVoices,
  savedVoiceByLineId,
  scriptVersionId,
}: LineEditorProps) {
  const assets = useAssets();
  const generate = useGenerateTtsTake(scriptVersionId);
  const [styleId, setStyleId] = useState<number | null>(null);
  const [speedScale, setSpeedScale] = useState(1);

  const speaker = speakers.find((entry) => entry.id === line.speakerId);
  const characterId = speaker?.characterId ?? null;
  const character = characters.find((entry) => entry.id === characterId);
  const profileId = character?.voiceProfileId ?? speaker?.voiceProfileId ?? null;
  const profile = voiceProfiles.find((entry) => entry.id === profileId);
  const adapterState = profile === undefined ? undefined : adapterVoices[profile.adapterId];
  const adapterName = profile === undefined ? "" : adapterLabel(profile.adapterId);
  const voice = adapterState?.voices?.find(
    (entry) => entry.voiceId === profile?.settings.speakerUuid,
  );
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

  const onChangeCharacter = (nextId: string) => {
    if (nextId === "") {
      setValue(`${path}.speakerId`, null, { shouldDirty: true });
      return;
    }
    const existing = speakers.find((entry) => entry.characterId === nextId);
    if (existing !== undefined) {
      setValue(`${path}.speakerId`, existing.id, { shouldDirty: true });
      return;
    }
    const selected = characters.find((entry) => entry.id === nextId);
    const speakerId = newSpeakerId();
    setValue(
      "speakers",
      [
        ...getValues("speakers"),
        {
          id: speakerId,
          name: selected?.name ?? "",
          characterId: nextId,
          voiceProfileId: selected?.voiceProfileId ?? null,
        },
      ],
      { shouldDirty: true },
    );
    setValue(`${path}.speakerId`, speakerId, { shouldDirty: true });
  };

  const onGenerate = () => {
    if (styleId === null) {
      return;
    }
    generate.mutate(
      { narrationSegmentId: line.id, styleId, speedScale, speechText: line.speechText },
      {
        onSuccess: (result) => {
          addTake(result.assetId, result.durationMs, "tts");
        },
      },
    );
  };

  const takes = line.takes;
  const saved = savedVoiceByLineId.has(line.id);
  const savedVoice = savedVoiceByLineId.get(line.id) ?? null;
  const voiceMatches = saved && profileId === savedVoice;
  const speechLength = line.speechText.trim().length;
  const speechReady = speechLength > 0 && speechLength <= MAX_TTS_SPEECH_TEXT_LENGTH;
  const ttsDisabled = generate.isPending || styleId === null || !voiceMatches || !speechReady;

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
        キャラクター
        <select
          className={textFieldClass}
          value={characterId ?? ""}
          onChange={(event) => onChangeCharacter(event.target.value)}
        >
          <option value="">なし</option>
          {characters.map((entry) => (
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
              <li key={take.id} className="flex flex-wrap items-center gap-2 py-0.5">
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
                <TakeAudioPlayer assetId={take.assetId} />
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
        <p className={metaTextClass}>TTS生成</p>
        {profileId === null ? (
          <p className={metaTextClass}>
            キャラクターを選び、声プロファイルを設定すると TTS を生成できます。
          </p>
        ) : profile === undefined ? (
          <p className={metaTextClass}>
            この話者に声プロファイルが設定されていません。
          </p>
        ) : adapterState?.loading ? (
          <p className={metaTextClass}>音声一覧を読み込み中…</p>
        ) : adapterState === undefined || adapterState.failed ? (
          <p className={errorTextClass}>
            {adapterName} ENGINE に接続できません。起動しているか確認してください。
          </p>
        ) : voice === undefined ? (
          <p className={errorTextClass}>
            声プロファイルの話者が {adapterName} ENGINE に見つかりません。
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
              disabled={ttsDisabled}
              onClick={onGenerate}
            >
              {generate.isPending ? "生成中…" : "TTS生成"}
            </button>
          </div>
        )}
        {!saved && (
          <p className={metaTextClass}>新しいセリフは一度保存してから生成できます。</p>
        )}
        {saved && !voiceMatches && profileId !== null && (
          <p className={metaTextClass}>声の変更は保存後に生成できます。</p>
        )}
        {saved && voiceMatches && speechLength === 0 && profileId !== null && (
          <p className={metaTextClass}>読み上げテキストを入力してください。</p>
        )}
        {saved && voiceMatches && speechLength > MAX_TTS_SPEECH_TEXT_LENGTH && (
          <p className={metaTextClass}>読み上げテキストが長すぎます。</p>
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
  characters,
  voiceProfiles,
  adapterVoices,
  savedVoiceByLineId,
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
            characters={characters}
            voiceProfiles={voiceProfiles}
            adapterVoices={adapterVoices}
            savedVoiceByLineId={savedVoiceByLineId}
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
