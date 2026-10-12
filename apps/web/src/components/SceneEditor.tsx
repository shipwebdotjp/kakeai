import { useEffect, useMemo, useRef, useState } from "react";
import {
  useFieldArray,
  useForm,
  useWatch,
  type Control,
  type UseFormRegister,
  type UseFormSetValue,
} from "react-hook-form";
import {
  contentDocumentSchema,
  DEFAULT_VISUAL_THEME_REF,
  getVisualTheme,
  type BulkTtsJobExclusion,
  type CharacterLibraryEntry,
  type ContentDocument,
  type ScriptVersion,
  type ThemeAccentToken,
  type TtsJobResult,
  type Warning,
} from "@kakeai/contracts";
import { resolveTimeline } from "@kakeai/video/timeline";
import {
  useAdapterVoicesMap,
  useBulkGenerateTtsTakes,
  useCharacters,
  useSaveScriptVersion,
  useVoiceProfiles,
  type BulkTtsFailure,
} from "../api/hooks";
import {
  buildContentDocument,
  bulkTtsCandidateLineIds,
  cloneSceneFormValue,
  countCharacterFormUsage,
  createPointSceneFormValue,
  generatedTakePolicy,
  mergeTake,
  newAppearanceId,
  newCharacterId,
  newSceneId,
  newSpeakerId,
  nextPointLabel,
  splitPointScene,
  toFormValues,
  DEFAULT_BGM_GAIN_DB,
  type CharacterFormValue,
  type DocumentFormValues,
  type SceneAccentKind,
  type SceneFormValue,
} from "../content/form";
import { SCENE_LABELS } from "../content/labels";
import { errorMessage } from "../lib/errorMessage";
import { buttonNeutralClass, buttonPrimaryClass, errorTextClass, metaTextClass, textFieldClass } from "../ui";
import { CharacterFields } from "./CharacterFields";
import { CueList } from "./CueList";
import { LinesEditor } from "./LinesEditor";
import { MediaPicker } from "./MediaPicker";
import { ScriptImportModal } from "./ScriptImportModal";
import { StandingFields } from "./StandingFields";

interface SceneEditorProps {
  base: ContentDocument;
  editionId: string;
  scriptVersionId: string;
  onSaved?: (scriptVersion: ScriptVersion) => void;
  onValuesChange?: (scenes: SceneFormValue[]) => void;
  onJumpToLine?: (lineId: string) => void;
}

interface TimingFieldsProps {
  control: Control<DocumentFormValues>;
  register: UseFormRegister<DocumentFormValues>;
  setValue: UseFormSetValue<DocumentFormValues>;
  sceneIndex: number;
  sceneKind: "intro" | "point" | "outro";
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

function TimingFields({ control, register, setValue, sceneIndex, sceneKind }: TimingFieldsProps) {
  const mode = useWatch({ control, name: `scenes.${sceneIndex}.timingMode` });
  const accentKind = useWatch({ control, name: `scenes.${sceneIndex}.accentKind` });
  const accentColor = useWatch({ control, name: `scenes.${sceneIndex}.accentColor` });
  const transitionPreset = useWatch({ control, name: `scenes.${sceneIndex}.transitionPreset` });
  const fixedOnly = sceneKind !== "point";
  return (
    <div className="my-2 flex flex-wrap items-center gap-3">
      <label className="inline-flex items-center gap-1.5">
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
        <label className="inline-flex items-center gap-1.5">
          自由色
          <input
            type="color"
            className="h-8 w-12 cursor-pointer rounded border border-border"
            {...register(`scenes.${sceneIndex}.accentColor`)}
          />
        </label>
      ) : (
        <label className="inline-flex items-center gap-1.5">
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
      {sceneIndex > 0 && (
        <>
          <label className="inline-flex items-center gap-1.5">
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
            <label className="inline-flex items-center gap-1.5">
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

export function SceneEditor({ base, editionId, scriptVersionId, onSaved, onValuesChange, onJumpToLine }: SceneEditorProps) {
  const save = useSaveScriptVersion(editionId);
  const voiceProfiles = useVoiceProfiles();
  const characterLibrary = useCharacters();
  const adapterVoices = useAdapterVoicesMap();
  const [issues, setIssues] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [savedAtMs, setSavedAtMs] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
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
  const { fields, insert, remove, move, replace: replaceScenes } = useFieldArray({
    control,
    name: "scenes",
  });
  const {
    fields: characterFields,
    append: appendCharacter,
    remove: removeCharacter,
  } = useFieldArray({ control, name: "characters" });
  const watchedScenesValue = useWatch({ control, name: "scenes" });
  const watchedScenes = useMemo(() => watchedScenesValue ?? [], [watchedScenesValue]);
  const watchedCharacters = useWatch({ control, name: "characters" }) ?? [];
  const watchedSpeakers = useWatch({ control, name: "speakers" }) ?? [];

  const navProjection = useMemo(
    () =>
      JSON.stringify(
        watchedScenes.map((scene) => ({
          id: scene?.id,
          kind: scene?.kind,
          label: scene?.label,
          cues: (scene?.cues ?? []).map((cue) => ({
            id: cue?.id,
            templateId: cue?.templateId,
            templateVersion: cue?.templateVersion,
            role: cue?.fields?.role ?? "",
          })),
          lines: (scene?.lines ?? []).map((line) => ({
            id: line?.id,
            speakerId: line?.speakerId,
            captionText: line?.captionText,
          })),
        })),
      ),
    [watchedScenes],
  );
  const lastEmittedNavProjection = useRef<string | null>(null);

  useEffect(() => {
    if (navProjection === lastEmittedNavProjection.current) {
      return;
    }
    const snapshot = [...watchedScenes];
    const timer = setTimeout(() => {
      if (navProjection === lastEmittedNavProjection.current) {
        return;
      }
      lastEmittedNavProjection.current = navProjection;
      onValuesChange?.(snapshot);
    }, 150);
    return () => clearTimeout(timer);
  }, [watchedScenes, navProjection, onValuesChange]);
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

  useEffect(() => {
    reset(toFormValues(base));
  }, [base, reset]);

  const onSubmit = handleSubmit(
    (values) => {
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
          setBulkResult(null);
          onSaved?.(result.scriptVersion);
        },
      });
    },
  );

  const onAddPoint = () => {
    const scenes = getValues("scenes");
    const outroIndex = scenes.findIndex((scene) => scene.kind === "outro");
    const insertIndex = outroIndex === -1 ? scenes.length : outroIndex;
    insert(insertIndex, createPointSceneFormValue(nextPointLabel(scenes, insertIndex)));
  };

  const onClonePrevious = (index: number) => {
    const scenes = getValues("scenes");
    const previous = scenes[index - 1];
    if (previous === undefined || previous.kind !== "point") {
      return;
    }
    insert(
      index,
      cloneSceneFormValue(
        previous as SceneFormValue & { kind: "point" },
        newSceneId(),
        nextPointLabel(scenes, index),
      ),
    );
  };

  const onMove = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    const scenes = getValues("scenes");
    if (scenes[index]?.kind !== "point" || scenes[target]?.kind !== "point") {
      return;
    }
    move(index, target);
  };

  const onSplitScene = (sceneIndex: number, lineIndex: number) => {
    const scenes = getValues("scenes");
    const scene = scenes[sceneIndex];
    if (scene === undefined || scene.kind !== "point") {
      return;
    }
    let result: ReturnType<typeof splitPointScene>;
    try {
      result = splitPointScene(scene, lineIndex, nextPointLabel(scenes, sceneIndex + 1));
    } catch (error) {
      setIssues([errorMessage(error)]);
      return;
    }
    replaceScenes([
      ...scenes.slice(0, sceneIndex),
      result.first,
      result.second,
      ...scenes.slice(sceneIndex + 1),
    ]);
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
    const character: CharacterFormValue = {
      id: characterId,
      name: entry.name,
      voiceProfileId: entry.voiceProfileId,
      appearances: entry.appearances.map((appearance) => ({
        id: newAppearanceId(),
        assetId: appearance.assetId,
        expression: appearance.expression,
        pose: appearance.pose,
        label: appearance.label ?? "",
      })),
    };
    appendCharacter(character);
    addSpeakerFor(characterId, entry.name, entry.voiceProfileId);
  };

  const addVoiceOnlySpeaker = () => {
    const characterId = newCharacterId();
    appendCharacter({ id: characterId, name: "ナレーター", voiceProfileId: null, appearances: [] });
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
    <>
    <form onSubmit={onSubmit}>
      <div
        id="editor-actionbar"
        className="sticky top-0 z-10 flex flex-wrap items-center gap-3 bg-surface py-2.5"
      >
        <button
          type="submit"
          className={buttonPrimaryClass}
          disabled={save.isPending || bulkGenerate.isPending}
        >
          保存
        </button>
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
        {save.isError && <span className={errorTextClass}>{errorMessage(save.error)}</span>}
        {bulkGenerate.isError && (
          <span className={errorTextClass}>{errorMessage(bulkGenerate.error)}</span>
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
        </div>
      )}

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

      <section className="my-4 rounded-lg border border-border p-4">
        <h3 className="mt-0 mb-2 text-lg font-semibold">キャラクター</h3>
        <p className={metaTextClass}>
          この作品で使うキャラクターです。声プロファイルを割り当てると、そのキャラクターのセリフをTTSで生成できます。外観はライブラリから取り込んだ後に、この作品内で追加・編集できます。
        </p>
        {voiceProfiles.isError && (
          <p className={errorTextClass}>声プロファイルを読み込めませんでした。</p>
        )}
        {characterLibrary.isError && (
          <p className={errorTextClass}>キャラクターライブラリを読み込めませんでした。</p>
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
            onDelete={deleteCharacter}
          />
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-1.5">
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
      </section>

      {fields.map((field, sceneIndex) => {
        const scene = watchedScenes[sceneIndex];
        if (scene === undefined) {
          return null;
        }
        return (
          <section
            key={field.id}
            id={`scene-${scene.id}`}
            className="my-4 rounded-lg border border-border p-4"
          >
            <div className="mt-0 mb-2 flex flex-wrap items-center gap-2">
              <input
                aria-label="シーン名"
                placeholder="シーン名"
                className={`min-w-[160px] font-semibold ${textFieldClass}`}
                {...register(`scenes.${sceneIndex}.label`)}
              />
              <span className="text-xs font-normal text-muted-foreground">
                {SCENE_LABELS[scene.kind] ?? scene.kind}
              </span>
              <span className="text-xs font-normal text-muted-foreground">{scene.id}</span>
              {scene.kind === "point" && (
                <span className="ml-auto flex gap-1">
                  <button
                    type="button"
                    className={buttonNeutralClass}
                    disabled={watchedScenes[sceneIndex - 1]?.kind !== "point"}
                    onClick={() => onClonePrevious(sceneIndex)}
                  >
                    前のシーンを複製
                  </button>
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

            <TimingFields
              control={control}
              register={register}
              setValue={setValue}
              sceneIndex={sceneIndex}
              sceneKind={scene.kind}
            />

            <details className={`mt-1 text-xs ${metaTextClass}`}>
              <summary className="cursor-pointer text-muted-foreground select-none">
                尺を表示
              </summary>
              <div className="mt-1">
                {(() => {
                  const placement = placementBySceneId.get(scene.id);
                  if (placement === undefined) {
                    return timing.error !== null ? <p>尺の計算: {timing.error}</p> : null;
                  }
                  return (
                    <>
                      <p>シーン尺: {(placement.durationMs / 1000).toFixed(1)}秒</p>
                      {placement.lines.length > 0 && (
                        <ol className="my-1 ml-4 list-decimal p-0">
                          {placement.lines.map((line) => (
                            <li key={line.lineId}>
                              {(line.startMs / 1000).toFixed(2)}s 〜{" "}
                              {(line.endMs / 1000).toFixed(2)}s（
                              {(line.durationMs / 1000).toFixed(2)}秒）
                            </li>
                          ))}
                        </ol>
                      )}
                    </>
                  );
                })()}
              </div>
            </details>

            <CueList
              control={control}
              register={register}
              setValue={setValue}
              getValues={getValues}
              sceneIndex={sceneIndex}
              sceneId={scene.id}
              lines={scene.lines}
              speakers={watchedSpeakers}
            />

            <StandingFields
              control={control}
              register={register}
              setValue={setValue}
              sceneIndex={sceneIndex}
              characters={watchedCharacters}
            />

            {scene.kind === "point" && (
                <LinesEditor
                  control={control}
                  register={register}
                  getValues={getValues}
                  setValue={setValue}
                  sceneIndex={sceneIndex}
                  sceneId={scene.id}
                  scriptVersionId={scriptVersionId}
                  speakers={watchedSpeakers}
                  characters={watchedCharacters}
                  voiceProfiles={voiceProfiles.data ?? []}
                  adapterVoices={adapterVoices}
                  savedVoiceByLineId={savedVoiceByLineId}
                  bulkRunning={bulkGenerate.isPending}
                  onSplitScene={onSplitScene}
                  onJumpToLine={onJumpToLine}
                />
            )}
          </section>
        );
      })}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={buttonNeutralClass} onClick={onAddPoint}>
          要点を追加
        </button>
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
    </form>
    <ScriptImportModal
      open={importOpen}
      onClose={() => setImportOpen(false)}
      scenes={watchedScenes}
      speakers={watchedSpeakers}
      onApply={(nextScenes) => replaceScenes(nextScenes)}
    />
    </>
  );
}
