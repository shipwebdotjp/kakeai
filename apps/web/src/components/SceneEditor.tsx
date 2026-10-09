import { useEffect, useMemo, useState } from "react";
import {
  useFieldArray,
  useForm,
  useWatch,
  type Control,
  type UseFormRegister,
} from "react-hook-form";
import {
  contentDocumentSchema,
  type ContentDocument,
  type Warning,
} from "@kakeai/contracts";
import { resolveTimeline } from "@kakeai/video/timeline";
import { useSaveScriptVersion } from "../api/hooks";
import {
  buildContentDocument,
  createPointSceneFormValue,
  toFormValues,
  DEFAULT_BGM_GAIN_DB,
  type DocumentFormValues,
} from "../content/form";
import { errorMessage } from "../lib/errorMessage";
import { buttonNeutralClass, buttonPrimaryClass, errorTextClass, metaTextClass, textFieldClass } from "../ui";
import { LinesEditor } from "./LinesEditor";
import { MediaPicker } from "./MediaPicker";
import { StandingFields } from "./StandingFields";

interface SceneEditorProps {
  base: ContentDocument;
  editionId: string;
  workId: string;
}

const SCENE_LABELS: Record<string, string> = {
  intro: "導入",
  point: "要点",
  outro: "結び",
};

interface TimingFieldsProps {
  control: Control<DocumentFormValues>;
  register: UseFormRegister<DocumentFormValues>;
  sceneIndex: number;
  sceneKind: "intro" | "point" | "outro";
}

function TimingFields({ control, register, sceneIndex, sceneKind }: TimingFieldsProps) {
  const mode = useWatch({ control, name: `scenes.${sceneIndex}.timingMode` });
  const fixedOnly = sceneKind !== "point";
  return (
    <div className="my-2 flex flex-wrap items-center gap-3">
      <label className="inline-flex items-center gap-1.5">
        アクセント色
        <input
          type="color"
          className="h-8 w-12 cursor-pointer rounded border border-border"
          {...register(`scenes.${sceneIndex}.accentColor`)}
        />
      </label>
      <label className="inline-flex items-center gap-1.5">
        尺
        <select className={textFieldClass} {...register(`scenes.${sceneIndex}.timingMode`)}>
          {!fixedOnly && <option value="auto">自動</option>}
          <option value="fixed">固定</option>
        </select>
      </label>
      {mode === "fixed" && (
        <label className="inline-flex items-center gap-1.5">
          固定尺(ms)
          <input
            type="number"
            min={1}
            className={`w-24 ${textFieldClass}`}
            {...register(`scenes.${sceneIndex}.durationMs`, { valueAsNumber: true })}
          />
        </label>
      )}
    </div>
  );
}

interface CueFieldsProps {
  register: UseFormRegister<DocumentFormValues>;
  sceneIndex: number;
  backgroundAssetId: string | null;
  cardAssetId: string | null;
  onBackground: (assetId: string | null) => void;
  onCard: (assetId: string | null) => void;
}

function CueFields({
  register,
  sceneIndex,
  backgroundAssetId,
  cardAssetId,
  onBackground,
  onCard,
}: CueFieldsProps) {
  return (
    <div className="mt-3 border-t border-dashed border-border pt-2">
      <MediaPicker
        label="背景"
        kinds={["image", "video"]}
        selectedAssetId={backgroundAssetId}
        onSelect={onBackground}
      />
      <MediaPicker
        label="カード"
        kinds={["image", "video"]}
        selectedAssetId={cardAssetId}
        onSelect={onCard}
      />
      {cardAssetId !== null && (
        <>
          <label className="my-2 block">
            カード見出し
            <input
              className={`mt-1 block w-full ${textFieldClass}`}
              {...register(`scenes.${sceneIndex}.cardHeading`)}
            />
          </label>
          <label className="my-2 block">
            カード補足文
            <input
              className={`mt-1 block w-full ${textFieldClass}`}
              {...register(`scenes.${sceneIndex}.cardCaption`)}
            />
          </label>
        </>
      )}
    </div>
  );
}

export function SceneEditor({ base, editionId, workId }: SceneEditorProps) {
  const save = useSaveScriptVersion(editionId);
  const [issues, setIssues] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [savedAtMs, setSavedAtMs] = useState<number | null>(null);

  useEffect(() => {
    if (savedAtMs === null) {
      return;
    }
    const timer = setTimeout(() => setSavedAtMs(null), 4000);
    return () => clearTimeout(timer);
  }, [savedAtMs]);

  const { register, control, handleSubmit, reset, getValues, setValue } =
    useForm<DocumentFormValues>({
      defaultValues: toFormValues(base),
    });
  const { fields, insert, remove, move } = useFieldArray({ control, name: "scenes" });
  const watchedScenes = useWatch({ control, name: "scenes" }) ?? [];
  const watchedCharacters = useWatch({ control, name: "characters" }) ?? [];

  useEffect(() => {
    reset(toFormValues(base));
  }, [base, reset]);

  const onSubmit = handleSubmit((values) => {
    let document: ContentDocument;
    try {
      document = buildContentDocument(base, values);
    } catch (error) {
      setIssues([errorMessage(error)]);
      setWarnings([]);
      return;
    }
    const parsed = contentDocumentSchema.safeParse(document);
    if (!parsed.success) {
      setIssues(
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      );
      setWarnings([]);
      return;
    }
    setIssues([]);
    save.mutate(parsed.data, {
      onSuccess: (result) => {
        setWarnings(result.warnings);
        setSavedAtMs(Date.now());
      },
    });
  });

  const onAddPoint = () => {
    const outroIndex = getValues("scenes").findIndex((scene) => scene.kind === "outro");
    insert(outroIndex === -1 ? fields.length : outroIndex, createPointSceneFormValue());
  };

  const onMove = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    const scenes = getValues("scenes");
    if (scenes[index]?.kind !== "point" || scenes[target]?.kind !== "point") {
      return;
    }
    move(index, target);
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

  const allValues = useWatch({ control }) as DocumentFormValues | undefined;
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

  const watchedBgm = allValues?.bgm;

  return (
    <form onSubmit={onSubmit}>
      <div className="sticky top-0 z-10 flex items-center gap-3 bg-surface py-2.5">
        <button type="submit" className={buttonPrimaryClass} disabled={save.isPending}>
          保存
        </button>
        {savedAtMs !== null && (
          <span className={metaTextClass}>
            保存しました（{new Date(savedAtMs).toLocaleTimeString("ja-JP")}）
          </span>
        )}
        {save.isError && <span className={errorTextClass}>{errorMessage(save.error)}</span>}
      </div>

      {warnings.length > 0 && (
        <div className="rounded border border-yellow-400 bg-yellow-50 p-3 text-sm dark:bg-yellow-950/40">
          <strong>警告</strong>
          <ul>
            {warnings.map((warning, index) => (
              <li key={index}>
                {warning.path.join(".")}: {warning.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {issues.length > 0 && (
        <div className="rounded border border-red-400 bg-red-50 p-3 text-sm dark:bg-red-950/40">
          <strong>入力エラー</strong>
          <ul>
            {issues.map((issue, index) => (
              <li key={index}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {timing.error !== null && (
        <p className={errorTextClass}>尺の計算: {timing.error}</p>
      )}

      <section className="my-4 rounded-lg border border-border p-4">
        <h3 className="mt-0 mb-2 text-lg font-semibold">BGM（作品全体）</h3>
        <MediaPicker
          label="BGM"
          kinds={["audio"]}
          selectedAssetId={watchedBgm?.assetId ?? null}
          onSelect={(assetId) => setValue("bgm.assetId", assetId, { shouldDirty: true })}
        />
        {watchedBgm?.assetId !== null && watchedBgm?.assetId !== undefined && (
          <div className="mt-2 flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" {...register("bgm.loop")} />
              ループ
            </label>
            <label className="inline-flex items-center gap-1.5">
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
      </section>

      {fields.map((field, sceneIndex) => {
        const scene = watchedScenes[sceneIndex];
        if (scene === undefined) {
          return null;
        }
        return (
          <section
            key={field.id}
            className="my-4 rounded-lg border border-border p-4"
          >
            <div className="mt-0 mb-2 flex flex-wrap items-center gap-2">
              <h3 className="m-0 flex items-baseline gap-2 text-lg font-semibold">
                {SCENE_LABELS[scene.kind] ?? scene.kind}
                {scene.kind === "point" && ` ${pointOrdinals[sceneIndex]}`}
              </h3>
              <span className="text-xs font-normal text-muted-foreground">{scene.id}</span>
              {scene.kind === "point" && (
                <span className="ml-auto flex gap-1">
                  <button
                    type="button"
                    className={buttonNeutralClass}
                    disabled={watchedScenes[sceneIndex - 1]?.kind !== "point"}
                    onClick={() => onMove(sceneIndex, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={buttonNeutralClass}
                    disabled={watchedScenes[sceneIndex + 1]?.kind !== "point"}
                    onClick={() => onMove(sceneIndex, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={buttonNeutralClass}
                    onClick={() => remove(sceneIndex)}
                  >
                    削除
                  </button>
                </span>
              )}
            </div>

            {scene.kind === "intro" && (
              <>
                <label className="my-2 block">
                  タイトル
                  <input
                    className={`mt-1 block w-full ${textFieldClass}`}
                    {...register(`scenes.${sceneIndex}.slots.title`)}
                  />
                </label>
                <label className="my-2 block">
                  サブタイトル
                  <input
                    className={`mt-1 block w-full ${textFieldClass}`}
                    {...register(`scenes.${sceneIndex}.slots.subtitle`)}
                  />
                </label>
              </>
            )}
            {scene.kind === "point" && (
              <>
                <label className="my-2 block">
                  見出し
                  <input
                    className={`mt-1 block w-full ${textFieldClass}`}
                    {...register(`scenes.${sceneIndex}.slots.heading`)}
                  />
                </label>
                <label className="my-2 block">
                  本文
                  <textarea
                    rows={3}
                    className={`mt-1 block w-full ${textFieldClass}`}
                    {...register(`scenes.${sceneIndex}.slots.body`)}
                  />
                </label>
              </>
            )}
            {scene.kind === "outro" && (
              <label className="my-2 block">
                結びの文言
                <input
                  className={`mt-1 block w-full ${textFieldClass}`}
                  {...register(`scenes.${sceneIndex}.slots.closing`)}
                />
              </label>
            )}

            <TimingFields
              control={control}
              register={register}
              sceneIndex={sceneIndex}
              sceneKind={scene.kind}
            />

            {(() => {
              const placement = placementBySceneId.get(scene.id);
              if (placement === undefined) {
                return null;
              }
              return (
                <div className={`mt-1 text-xs ${metaTextClass}`}>
                  <p>シーン尺: {(placement.durationMs / 1000).toFixed(1)}秒</p>
                  {placement.lines.length > 0 && (
                    <ol className="my-1 ml-4 list-decimal p-0">
                      {placement.lines.map((line) => (
                        <li key={line.lineId}>
                          {(line.startMs / 1000).toFixed(2)}s 〜{" "}
                          {(line.endMs / 1000).toFixed(2)}s（{(line.durationMs / 1000).toFixed(2)}秒）
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              );
            })()}

            <CueFields
              register={register}
              sceneIndex={sceneIndex}
              backgroundAssetId={scene.backgroundAssetId}
              cardAssetId={scene.cardAssetId}
              onBackground={(assetId) =>
                setValue(`scenes.${sceneIndex}.backgroundAssetId`, assetId, { shouldDirty: true })
              }
              onCard={(assetId) => {
                setValue(`scenes.${sceneIndex}.cardAssetId`, assetId, { shouldDirty: true });
                if (assetId === null) {
                  setValue(`scenes.${sceneIndex}.cardHeading`, "", { shouldDirty: true });
                  setValue(`scenes.${sceneIndex}.cardCaption`, "", { shouldDirty: true });
                }
              }}
            />

            <StandingFields
              control={control}
              register={register}
              setValue={setValue}
              sceneIndex={sceneIndex}
              characters={watchedCharacters}
              workId={workId}
            />

            {scene.kind === "point" && (
                <LinesEditor
                  control={control}
                  register={register}
                  getValues={getValues}
                  setValue={setValue}
                  sceneIndex={sceneIndex}
                  sceneId={scene.id}
                />
            )}
          </section>
        );
      })}

      <button type="button" className={buttonNeutralClass} onClick={onAddPoint}>
        要点を追加
      </button>
      {pointCount === 0 && (
        <p className={metaTextClass}>要点Sceneがありません。追加してください。</p>
      )}
    </form>
  );
}
