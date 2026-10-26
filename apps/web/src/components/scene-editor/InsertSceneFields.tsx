import { useEffect } from "react";
import { type UseFormRegister, type UseFormSetValue } from "react-hook-form";
import { type Asset } from "@kakeai/contracts";
import {
  type DocumentFormValues,
  type SceneFormValue,
} from "../../content/form";
import { AssetThumbnail, assetLabel } from "../../lib/assets";
import {
  badgeInfoClass,
  badgeNeutralClass,
  editAreaClass,
  errorTextClass,
  formLabelClass,
  metaTextClass,
  textFieldClass,
} from "../../ui";
import { MediaPicker } from "../MediaPicker";

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

export function InsertSceneFields({
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
    Number.isInteger(parsedTrimStart) && parsedTrimStart >= 0
      ? parsedTrimStart
      : 0;
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
    trimStartValid &&
    trimEndValid &&
    trimEndMs !== null &&
    assetDurationMs !== null
      ? trimEndMs - trimStartMs
      : null;
  let trimError: string | null = null;
  if (!trimStartValid) {
    trimError =
      "トリム開始はミリ秒の整数（0以上、動画尺未満）で入力してください。";
  } else if (!trimEndValid) {
    trimError =
      parsedTrimEnd !== null &&
      assetDurationMs !== null &&
      parsedTrimEnd > assetDurationMs
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
    <div
      className={
        bare ? "flex flex-col gap-2" : `${editAreaClass} flex flex-col gap-2`
      }
    >
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
              onError(
                "素材一覧を確認できません。読み込み後に選び直してください。",
              );
              return;
            }
            if (next.kind !== "video") {
              onError("インサートSceneには動画素材だけを指定できます。");
              return;
            }
            if (next.durationMs === null || next.durationMs <= 0) {
              onError(
                "尺が確定していない動画はインサートSceneに指定できません。",
              );
              return;
            }
            if (mainCue === undefined) {
              onError(
                "主動画の映像演出を特定できません。動画を追加し直してください。",
              );
              return;
            }
            setValue(
              `scenes.${sceneIndex}.cues.${mainCueIndex}.fields.assetId`,
              next.id,
              {
                shouldDirty: true,
              },
            );
            setValue(
              `scenes.${sceneIndex}.cues.${mainCueIndex}.fields.trimStartMs`,
              "",
              {
                shouldDirty: true,
              },
            );
            setValue(
              `scenes.${sceneIndex}.cues.${mainCueIndex}.fields.trimEndMs`,
              "",
              {
                shouldDirty: true,
              },
            );
            setValue(`scenes.${sceneIndex}.durationMs`, next.durationMs, {
              shouldDirty: true,
            });
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
          <>
            {" "}
            ／ 使用区間: {(trimStartMs / 1000).toFixed(2)}〜
            {((trimStartMs + clipMs) / 1000).toFixed(2)}秒（
            {(clipMs / 1000).toFixed(2)}秒）
          </>
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
            placeholder={
              assetDurationMs !== null ? String(assetDurationMs) : ""
            }
            value={fields.trimEndMs ?? ""}
            onChange={(event) => setField("trimEndMs", event.target.value)}
          />
        </label>
        <label className={formLabelClass}>
          <input
            type="checkbox"
            checked={loop}
            onChange={(event) =>
              setField("loop", event.target.checked ? "true" : "")
            }
          />
          ループ再生
        </label>
      </div>
      {trimError !== null && <p className={errorTextClass}>{trimError}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={
            asset?.hasAudio === true ? badgeInfoClass : badgeNeutralClass
          }
        >
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
        {scene.embeddedAudio && (
          <span className={badgeNeutralClass}>作品全体BGMをこの区間で抑制</span>
        )}
        {scene.embeddedAudio &&
          asset !== undefined &&
          asset.hasAudio === false && (
            <span className={badgeNeutralClass}>この区間は無音になります</span>
          )}
      </div>
      {mainCueIndex === -1 && (
        <p className={errorTextClass}>
          主動画の映像演出が見つかりません。動画を選び直してください。
        </p>
      )}
      {asset !== undefined && asset.kind !== "video" && (
        <p className={errorTextClass}>
          動画以外の素材は主動画に指定できません。
        </p>
      )}
      <p className={metaTextClass}>
        初期版では速度変更・逆再生には対応していません。ループ時は使用区間をScene尺まで繰り返します。
      </p>
    </div>
  );
}
