import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, OctagonAlert, TriangleAlert } from "lucide-react";
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
} from "@kakeai/contracts";
import { ApiError } from "../api/client";
import { diagnosticTarget, type Diagnostic, type DiagnosticTarget } from "../content/diagnostics";
import { resolveTimeline } from "@kakeai/video/timeline";
import {
  useAdapterVoicesMap,
  useBulkGenerateTtsTakes,
  useCharacters,
  useFaceSets,
  useSaveScriptVersion,
  useThemes,
  useVoiceProfiles,
  type BulkTtsFailure,
} from "../api/hooks";
import {
  buildContentDocument,
  bulkTtsCandidateLineIds,
  cloneSceneFormValue,
  collectSceneIds,
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
  type SpeakerFormValue,
} from "../content/form";
import { SCENE_LABELS } from "../content/labels";
import { errorMessage } from "../lib/errorMessage";
import type { UnsavedDocumentState } from "../lib/useDraftPreview";
import {
  badgeInfoClass,
  badgeNeutralClass,
  buttonDangerClass,
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  iconButtonClass,
  metaTextClass,
  sectionCardClass,
  sectionSummaryClass,
  sectionTitleClass,
  textFieldClass,
} from "../ui";
import { CharacterFields } from "./CharacterFields";
import { Collapsible, useStoredCollapsible } from "./Collapsible";
import { CueList } from "./CueList";
import { LinesEditor } from "./LinesEditor";
import { MediaPicker } from "./MediaPicker";
import { ScriptImportModal } from "./ScriptImportModal";
import { StandingFields } from "./StandingFields";
import { SceneAudioFields } from "./SceneAudioFields";

const DRAFT_PREVIEW_DEBOUNCE_MS = 800;

interface SceneEditorProps {
  base: ContentDocument;
  editionId: string;
  scriptVersionId: string;
  onSaved?: (scriptVersion: ScriptVersion) => void;
  onValuesChange?: (scenes: SceneFormValue[], speakers: SpeakerFormValue[], characters: CharacterFormValue[]) => void;
  onJumpToLine?: (lineId: string) => void;
  onJumpToTarget?: (targetId: string, seek: DiagnosticTarget["seek"]) => void;
  onDocumentChange?: (state: UnsavedDocumentState) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

function extractServerErrors(error: unknown): Diagnostic[] {
  if (
    error instanceof ApiError &&
    error.details &&
    typeof error.details === "object" &&
    "issues" in error.details &&
    Array.isArray((error.details as { issues: unknown }).issues)
  ) {
    return (
      error.details as {
        issues: { path?: (string | number)[]; code?: string; message: string }[];
      }
    ).issues.map((issue) => ({
      path: issue.path,
      code: issue.code,
      message: issue.message ?? "入力エラーが発生しました",
    }));
  }
  return [{ message: errorMessage(error) }];
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

const SCENE_TRANSITION_LABELS: Record<string, string> = {
  cut: "カット",
  fade: "フェード",
  crossfade: "クロスフェード",
};

function sceneSettingsSummary(scene: SceneFormValue, sceneIndex: number): string {
  const parts = [scene.accentKind === "custom" ? "自由色" : "テーマ色"];
  parts.push(scene.timingMode === "fixed" ? `固定 ${scene.durationMs}ms` : "自動");
  if (sceneIndex > 0) {
    parts.push(SCENE_TRANSITION_LABELS[scene.transitionPreset] ?? scene.transitionPreset);
  }
  return parts.join(" / ");
}

export function SceneEditor({ base, editionId, scriptVersionId, onSaved, onValuesChange, onJumpToLine, onJumpToTarget, onDocumentChange, onDirtyChange }: SceneEditorProps) {
  const save = useSaveScriptVersion(editionId);
  const voiceProfiles = useVoiceProfiles();
  const characterLibrary = useCharacters();
  const faceSets = useFaceSets();
  const adapterVoices = useAdapterVoicesMap();
  const themesQuery = useThemes();
  const [diagnostics, setDiagnostics] = useState<{ errors: Diagnostic[]; warnings: Diagnostic[] }>({
    errors: [],
    warnings: [],
  });
  const [openKind, setOpenKind] = useState<"error" | "warning" | null>(null);
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

  const isFormDirty = formState.isDirty;
  const lastEmittedDirtyRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (lastEmittedDirtyRef.current !== isFormDirty) {
      lastEmittedDirtyRef.current = isFormDirty;
      onDirtyChange?.(isFormDirty);
    }
  }, [isFormDirty, onDirtyChange]);
  const { fields, insert, remove, move, replace: replaceScenes } = useFieldArray({
    control,
    name: "scenes",
  });
  const {
    fields: characterFields,
    append: appendCharacter,
    remove: removeCharacter,
  } = useFieldArray({ control, name: "characters" });
  const [charactersOpen, setCharactersOpen] = useStoredCollapsible(
    "characters",
    characterFields.length === 0,
  );

  useEffect(() => {
    if (characterFields.length === 0) {
      setCharactersOpen(true);
    }
  }, [characterFields.length, setCharactersOpen]);
  const watchedScenesValue = useWatch({ control, name: "scenes" });
  const watchedScenes = useMemo(() => watchedScenesValue ?? [], [watchedScenesValue]);
  const watchedCharacters = useWatch({ control, name: "characters" }) ?? [];
  const watchedSpeakers = useWatch({ control, name: "speakers" }) ?? [];

  const navProjection = useMemo(
    () =>
      JSON.stringify({
        scenes: watchedScenes.map((scene) => ({
          id: scene?.id,
          kind: scene?.kind,
          label: scene?.label,
          cues: (scene?.cues ?? []).map((cue) => ({
            id: cue?.id,
            templateId: cue?.templateId,
            templateVersion: cue?.templateVersion,
            role: cue?.fields?.role ?? "",
            text: cue?.fields?.text ?? "",
          })),
          lines: (scene?.lines ?? []).map((line) => ({
            id: line?.id,
            speakerId: line?.speakerId,
            captionText: line?.captionText,
          })),
        })),
        speakers: (watchedSpeakers ?? []).map((speaker) => ({
          id: speaker?.id,
          name: speaker?.name,
        })),
        characters: (watchedCharacters ?? []).map((character) => ({
          id: character?.id,
          name: character?.name,
          appearances: (character?.appearances ?? []).map((appearance) => ({
            id: appearance?.id,
            assetId: appearance?.assetId,
          })),
        })),
      }),
    [watchedScenes, watchedSpeakers, watchedCharacters],
  );
  const lastEmittedNavProjection = useRef<string | null>(null);

  useEffect(() => {
    if (navProjection === lastEmittedNavProjection.current) {
      return;
    }
    const snapshot = [...watchedScenes];
    const speakerSnapshot = [...(watchedSpeakers ?? [])];
    const characterSnapshot = [...(watchedCharacters ?? [])];
    const timer = setTimeout(() => {
      if (navProjection === lastEmittedNavProjection.current) {
        return;
      }
      lastEmittedNavProjection.current = navProjection;
      onValuesChange?.(snapshot, speakerSnapshot, characterSnapshot);
    }, 150);
    return () => clearTimeout(timer);
  }, [watchedScenes, watchedSpeakers, watchedCharacters, navProjection, onValuesChange]);
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

  const lastBaseRef = useRef(base);
  useEffect(() => {
    if (lastBaseRef.current !== base) {
      lastBaseRef.current = base;
      if (!formState.isDirty) {
        reset(toFormValues(base));
      }
    }
  }, [base, reset, formState.isDirty]);

  const allValues = useWatch({ control }) as DocumentFormValues | undefined;
  useEffect(() => {
    if (onDocumentChange === undefined || allValues === undefined) {
      return;
    }
    if (!formState.isDirty) {
      onDocumentChange({ dirty: false, document: null });
      return;
    }
    const timer = setTimeout(() => {
      let document: ContentDocument | null = null;
      try {
        const built = buildContentDocument(base, allValues);
        if (contentDocumentSchema.safeParse(built).success) {
          document = built;
        }
      } catch {
        document = null;
      }
      onDocumentChange({ dirty: true, document });
    }, DRAFT_PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [allValues, base, formState.isDirty, onDocumentChange]);

  const onSubmit = handleSubmit(
    (values) => {
      let document: ContentDocument;
      try {
        document = buildContentDocument(base, values);
      } catch (error) {
        setDiagnostics({ errors: [{ message: errorMessage(error) }], warnings: [] });
        setOpenKind("error");
        return;
      }
      const parsed = contentDocumentSchema.safeParse(document);
      if (!parsed.success) {
        setDiagnostics({
          errors: parsed.error.issues.map((issue) => ({
            path: issue.path as (string | number)[],
            code: issue.code,
            message: issue.message,
          })),
          warnings: [],
        });
        setOpenKind("error");
        return;
      }
      save.mutate(parsed.data, {
        onSuccess: (result) => {
          reset(toFormValues(result.scriptVersion.content));
          const warnings = result.warnings.map((warning) => ({
            path: warning.path,
            code: warning.code,
            message: warning.message,
          }));
          setDiagnostics({ errors: [], warnings });
          setOpenKind(warnings.length > 0 ? "warning" : null);
          setSavedAtMs(Date.now());
          setBulkResult(null);
          onSaved?.(result.scriptVersion);
        },
        onError: (error) => {
          setDiagnostics((prev) => ({ ...prev, errors: extractServerErrors(error) }));
          setOpenKind("error");
        },
      });
    },
  );

  const onAddPoint = () => {
    const scenes = getValues("scenes");
    const outroIndex = scenes.findIndex((scene) => scene.kind === "outro");
    const insertIndex = outroIndex === -1 ? scenes.length : outroIndex;
    insert(
      insertIndex,
      createPointSceneFormValue(nextPointLabel(scenes, insertIndex), collectSceneIds(scenes)),
    );
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
        newSceneId(collectSceneIds(scenes)),
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
    const placement = placementBySceneId.get(scene.id);
    const splitLineId = scene.lines[lineIndex]?.id;
    const splitLineStartMs = placement?.lines.find(
      (line) => line.lineId === splitLineId,
    )?.startMs;
    const rawSplitOffsetMs =
      placement !== undefined && splitLineStartMs !== undefined
        ? splitLineStartMs - placement.startMs
        : null;
    const splitOffsetMs =
      rawSplitOffsetMs !== null && Number.isFinite(rawSplitOffsetMs) && rawSplitOffsetMs >= 0
        ? rawSplitOffsetMs
        : null;
    let result: ReturnType<typeof splitPointScene>;
    try {
      result = splitPointScene(
        scene,
        lineIndex,
        nextPointLabel(scenes, sceneIndex + 1),
        collectSceneIds(scenes),
        splitOffsetMs,
      );
    } catch (error) {
      setDiagnostics((prev) => ({ ...prev, errors: [{ message: errorMessage(error) }] }));
      setOpenKind("error");
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
    const voiceProfileId =
      entry.voices.find((voice) => voice.locale === base.locale)?.voiceProfileId ?? null;
    const character: CharacterFormValue = {
      id: characterId,
      name: entry.name,
      voiceProfileId,
      voices: entry.voices.map((voice) => ({ ...voice })),
      appearances: entry.appearances.map((appearance) => ({
        id: newAppearanceId(),
        assetId: appearance.assetId,
        expression: appearance.expression,
        pose: appearance.pose,
        label: appearance.label ?? "",
        faceSetId: appearance.faceSetId,
      })),
    };
    appendCharacter(character);
    addSpeakerFor(characterId, entry.name, voiceProfileId);
  };

  const addVoiceOnlySpeaker = () => {
    const characterId = newCharacterId();
    appendCharacter({ id: characterId, name: "ナレーター", voiceProfileId: null, voices: [], appearances: [] });
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
      <fieldset disabled={save.isPending} className="contents border-0 m-0 p-0">
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
        {diagnostics.errors.length > 0 && (
          <button
            type="button"
            className={`inline-flex cursor-pointer items-center gap-1 rounded px-2.5 py-1 text-xs font-medium ${
              openKind === "error"
                ? "border border-red-400 bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-100"
                : "bg-red-100 text-red-800 hover:bg-red-200 dark:bg-red-950/60 dark:text-red-200"
            }`}
            onClick={() => setOpenKind(openKind === "error" ? null : "error")}
          >
            <OctagonAlert className="h-4 w-4 shrink-0" />
            <span>エラー({diagnostics.errors.length})</span>
          </button>
        )}
        {diagnostics.warnings.length > 0 && (
          <button
            type="button"
            className={`inline-flex cursor-pointer items-center gap-1 rounded px-2.5 py-1 text-xs font-medium ${
              openKind === "warning"
                ? "border border-amber-400 bg-amber-200 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100"
                : "bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-950/60 dark:text-amber-200"
            }`}
            onClick={() => setOpenKind(openKind === "warning" ? null : "warning")}
          >
            <TriangleAlert className="h-4 w-4 shrink-0" />
            <span>警告({diagnostics.warnings.length})</span>
          </button>
        )}
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
        {bulkGenerate.isError && (
          <span className={errorTextClass}>{errorMessage(bulkGenerate.error)}</span>
        )}
      </div>

      {openKind !== null && (
        <div
          className={`mt-2 max-h-60 overflow-auto rounded border p-3 text-sm ${
            openKind === "error"
              ? "border-red-400 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200"
              : "border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          }`}
        >
          <div className="mb-1 font-semibold">
            {openKind === "error" ? "エラー一覧" : "警告一覧"}
          </div>
          <ul className="m-0 list-disc space-y-1 pl-5">
            {(openKind === "error" ? diagnostics.errors : diagnostics.warnings).map((diag, index) => {
              const target = diagnosticTarget(diag.path, watchedScenes);
              const pathStr = diag.path ? diag.path.join(".") : null;
              return (
                <li key={index}>
                  {pathStr !== null && (
                    <>
                      {target !== null ? (
                        <button
                          type="button"
                          className="mr-1.5 cursor-pointer font-mono underline hover:no-underline"
                          onClick={() => onJumpToTarget?.(target.targetId, target.seek)}
                        >
                          {pathStr}
                        </button>
                      ) : (
                        <span className="mr-1.5 font-mono text-muted-foreground">{pathStr}</span>
                      )}
                      :{" "}
                    </>
                  )}
                  <span>{diag.message}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

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

      <Collapsible
        title="テーマ（Visual Theme）"
        storageKey="theme"
        summary={(() => {
          const themeId = allValues?.visualTheme?.id;
          const themeVersion = allValues?.visualTheme?.version;
          const theme = (themesQuery.data ?? []).find((entry) => entry.id === themeId);
          if (theme === undefined || themeId === undefined || themeVersion === undefined) {
            return "未選択";
          }
          return `${theme.name} (v${themeVersion})`;
        })()}
        className={sectionCardClass}
      >
        <h3 className={sectionTitleClass}>テーマ（Visual Theme）</h3>
        <p className={sectionSummaryClass}>
          作品全体の文字デザイン・配色テーマを指定します。選択変更後に「保存」すると新しい台本版が作成されます。
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-1.5 text-sm">
            選択中テーマ:
            <select
              className={textFieldClass}
              value={`${getValues("visualTheme.id")}@${getValues("visualTheme.version")}`}
              onChange={(e) => {
                const [id, verStr] = e.target.value.split("@");
                if (id && verStr) {
                  setValue("visualTheme.id", id, { shouldDirty: true });
                  setValue("visualTheme.version", Number(verStr), { shouldDirty: true });
                }
              }}
            >
              {(themesQuery.data ?? [])
                .filter((t) => t.latestRevision !== null)
                .map((t) => {
                  const version = t.latestRevision!.version;
                  const valueKey = `${t.id}@${version}`;
                  return (
                    <option key={valueKey} value={valueKey}>
                      {t.name} (v{version}) {t.isBuiltIn ? "【組み込み】" : ""}
                    </option>
                  );
                })}
            </select>
          </label>
        </div>
      </Collapsible>

      <Collapsible
        title="BGM（作品全体）"
        storageKey="bgm"
        summary={
          watchedBgm?.assetId === null || watchedBgm?.assetId === undefined
            ? "未設定"
            : `設定あり（ループ${watchedBgm.loop ? "あり" : "なし"}・${watchedBgm.gainDb}dB）`
        }
        className={sectionCardClass}
      >
        <h3 className={sectionTitleClass}>BGM（作品全体）</h3>
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
      </Collapsible>

      <Collapsible
        title="キャラクター"
        summary={characterFields.length === 0 ? "未登録" : `${characterFields.length}件`}
        open={charactersOpen}
        onOpenChange={setCharactersOpen}
        className={sectionCardClass}
      >
        <h3 className={sectionTitleClass}>キャラクター</h3>
        <p className={sectionSummaryClass}>
          この作品で使うキャラクターです。声プロファイルを割り当てると、そのキャラクターのセリフをTTSで生成できます。外観はライブラリから取り込んだ後に、この作品内で追加・編集できます。
        </p>
        {voiceProfiles.isError && (
          <p className={errorTextClass}>声プロファイルを読み込めませんでした。</p>
        )}
        {characterLibrary.isError && (
          <p className={errorTextClass}>キャラクターライブラリを読み込めませんでした。</p>
        )}
        {faceSets.isError && (
          <p className={errorTextClass}>表情セットを読み込めませんでした。</p>
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
            faceSets={faceSets.data ?? []}
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
      </Collapsible>

      {fields.map((field, sceneIndex) => {
        const scene = watchedScenes[sceneIndex];
        if (scene === undefined) {
          return null;
        }
        return (
          <section
            key={field.id}
            id={`scene-${scene.id}`}
            className={sectionCardClass}
          >
            <div className="mt-0 mb-2 flex flex-wrap items-center gap-2">
              <input
                aria-label="シーン名"
                placeholder="シーン名"
                className={`min-w-[160px] flex-1 font-semibold ${textFieldClass}`}
                {...register(`scenes.${sceneIndex}.label`)}
              />
              <span className={scene.kind === "point" ? badgeInfoClass : badgeNeutralClass}>
                {SCENE_LABELS[scene.kind] ?? scene.kind}
              </span>
              <span className="font-mono text-xs text-muted-foreground">{scene.id}</span>
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
                    className={iconButtonClass}
                    aria-label="上へ移動"
                    disabled={watchedScenes[sceneIndex - 1]?.kind !== "point"}
                    onClick={() => onMove(sceneIndex, -1)}
                  >
                    <ChevronUp aria-hidden="true" className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className={iconButtonClass}
                    aria-label="下へ移動"
                    disabled={watchedScenes[sceneIndex + 1]?.kind !== "point"}
                    onClick={() => onMove(sceneIndex, 1)}
                  >
                    <ChevronDown aria-hidden="true" className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className={buttonDangerClass}
                    onClick={() => remove(sceneIndex)}
                  >
                    削除
                  </button>
                </span>
              )}
            </div>

            <Collapsible title="シーン設定" summary={sceneSettingsSummary(scene, sceneIndex)} storageKey={`scene-settings-${scene.id}`}>
              <TimingFields
                control={control}
                register={register}
                setValue={setValue}
                sceneIndex={sceneIndex}
                sceneKind={scene.kind}
              />

              <Collapsible title="尺の内訳" className="mt-1 text-xs" storageKey={`scene-duration-${scene.id}`}>
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
                          {placement.lines.flatMap((line) => {
                            const entries: { key: string; text: string }[] = [];
                            if (line.gapBeforeMs > 0) {
                              entries.push({
                                key: `${line.lineId}-gap`,
                                text: `間 ${((line.startMs - line.gapBeforeMs) / 1000).toFixed(2)}s 〜 ${(line.startMs / 1000).toFixed(2)}s（${(line.gapBeforeMs / 1000).toFixed(2)}秒）`,
                              });
                            }
                            entries.push({
                              key: line.lineId,
                              text: `${(line.startMs / 1000).toFixed(2)}s 〜 ${(line.endMs / 1000).toFixed(2)}s（${(line.durationMs / 1000).toFixed(2)}秒）`,
                            });
                            return entries;
                          }).map((entry) => (
                            <li key={entry.key}>{entry.text}</li>
                          ))}
                        </ol>
                      )}
                    </>
                  );
                })()}
              </Collapsible>
            </Collapsible>

            <CueList
              control={control}
              register={register}
              setValue={setValue}
              getValues={getValues}
              sceneIndex={sceneIndex}
              sceneId={scene.id}
              lines={scene.lines}
              speakers={watchedSpeakers}
              sceneDurationMs={placementBySceneId.get(scene.id)?.durationMs ?? null}
            />

            <StandingFields
              control={control}
              register={register}
              setValue={setValue}
              sceneIndex={sceneIndex}
              sceneId={scene.id}
              characters={watchedCharacters}
            />

            <SceneAudioFields
              control={control}
              register={register}
              getValues={getValues}
              setValue={setValue}
              sceneIndex={sceneIndex}
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
                  faceSets={faceSets.data ?? []}
                  faceSetsReady={faceSets.isSuccess}
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
      </fieldset>
    </form>
    <ScriptImportModal
      open={importOpen}
      onClose={() => setImportOpen(false)}
      scenes={watchedScenes}
      speakers={watchedSpeakers}
      disabled={save.isPending}
      onApply={(nextScenes) => replaceScenes(nextScenes)}
    />
    </>
  );
}
