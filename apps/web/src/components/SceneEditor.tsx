import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { OctagonAlert, Plus, Save, TriangleAlert, Video } from "lucide-react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import {
  contentDocumentSchema,
  resolveCharacterName,
  type BulkTtsJobExclusion,
  type CharacterLibraryEntry,
  type ContentDocument,
  type ScriptOperation,
  type ScriptVersion,
  type Warning,
  type TtsJobResult,
} from "@kakeai/contracts";
import { ApiError } from "../api/client";
import {
  diagnosticTarget,
  type Diagnostic,
  type DiagnosticTarget,
} from "../content/diagnostics";
import { resolveTimeline } from "@kakeai/video/timeline";
import {
  useAdapterVoicesMap,
  useAssets,
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
  generatedTakePolicy,
  mergeTake,
  newAppearanceId,
  newCharacterId,
  newSceneId,
  newSpeakerId,
  nextPointLabel,
  toFormValues,
  DEFAULT_BGM_GAIN_DB,
  type CharacterFormValue,
  type DocumentFormValues,
  type SceneFormValue,
  type SpeakerFormValue,
} from "../content/form";
import {
  applyStructuralOperation,
  commitBgmStructural,
  commitCueStructural,
  commitSceneAudioStructural,
  commitStandingStructural,
  copyCueStructural,
  copyStandingsStructural,
  moveCueStructural,
  removeCueStructural,
  transferStandingsStructural,
  type StandingTransferMode,
  type StructuralEditResult,
} from "../content/structural";
import { sceneDisplayName } from "../content/labels";
import { sceneNavProjection } from "../content/navProjection";
import {
  captureEditorScrollAnchor,
  restoreEditorScrollAnchor,
  scrollEditorTargetIntoView,
  type EditorScrollAnchor,
} from "../lib/editorScroll";
import { errorMessage } from "../lib/errorMessage";
import type { UnsavedDocumentState } from "../lib/useDraftPreview";
import {
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  formLabelClass,
  metaTextClass,
  sectionCardClass,
  sectionSummaryClass,
  sectionTitleClass,
  textFieldClass,
} from "../ui";
import { CharacterFields } from "./CharacterFields";
import {
  Collapsible,
  useCollapsibleStore,
  useStoredCollapsible,
} from "./Collapsible";
import { sceneFoldKey } from "../lib/collapseState";
import { ScriptSkinProvider } from "./CueList";
import { MediaPicker } from "./MediaPicker";
import { ScenePickerModal, type ScenePickerTarget } from "./ScenePickerModal";
import { ScriptImportModal } from "./ScriptImportModal";
import { SceneBlock } from "./scene-editor/SceneBlock";
import { hasConfiguredStanding, isMiddleScene } from "./scene-editor/shared";

const DRAFT_PREVIEW_DEBOUNCE_MS = 800;

type PendingEditorScroll =
  | { kind: "anchor"; anchor: EditorScrollAnchor }
  | { kind: "reveal"; targetId: string };

function resolveInsertionTargetId(
  scenes: readonly Pick<SceneFormValue, "id" | "kind">[],
  selectedId: string | null,
): string | null {
  const candidates = scenes.filter((scene) => scene.kind !== "intro");
  if (candidates.length === 0) {
    return null;
  }
  if (
    selectedId !== null &&
    candidates.some((scene) => scene.id === selectedId)
  ) {
    return selectedId;
  }
  const outro = candidates.find((scene) => scene.kind === "outro");
  return outro?.id ?? candidates[candidates.length - 1]?.id ?? null;
}

interface SceneEditorProps {
  base: ContentDocument;
  editionId: string;
  scriptVersionId: string;
  onSaved?: (scriptVersion: ScriptVersion) => void;
  onValuesChange?: (
    scenes: SceneFormValue[],
    speakers: SpeakerFormValue[],
    characters: CharacterFormValue[],
  ) => void;
  onJumpToLine?: (lineId: string) => void;
  onJumpToTarget?: (targetId: string, seek: DiagnosticTarget["seek"]) => void;
  onDocumentChange?: (state: UnsavedDocumentState) => void;
  onDirtyChange?: (dirty: boolean) => void;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
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
        issues: {
          path?: (string | number)[];
          code?: string;
          message: string;
        }[];
      }
    ).issues.map((issue) => ({
      path: issue.path,
      code: issue.code,
      message: issue.message ?? "入力エラーが発生しました",
    }));
  }
  return [{ message: errorMessage(error) }];
}

type ScenePickerRequest =
  | { kind: "move-cue" | "copy-cue"; sceneId: string; cueId: string }
  | {
      kind: "move-standing" | "copy-standing" | "swap-standing";
      sceneId: string;
    };

const SCENE_PICKER_COPY: Record<
  ScenePickerRequest["kind"],
  {
    title: string;
    description: string;
    mode: "single" | "multiple";
    confirmLabel: string;
  }
> = {
  "move-cue": {
    title: "別のシーンへ移動",
    description:
      "移動すると表示区間はシーン全体に戻り、セリフ同期のトリガーはシーン全体に変わります。移動先で選び直してください。",
    mode: "single",
    confirmLabel: "移動する",
  },
  "copy-cue": {
    title: "別のシーンへ複製",
    description:
      "複製すると表示区間はシーン全体に戻り、セリフ同期のトリガーはシーン全体に変わります。複製先で選び直してください。",
    mode: "multiple",
    confirmLabel: "別のシーンへ複製",
  },
  "move-standing": {
    title: "立ち絵を別のシーンへ移動",
    description:
      "移動先の立ち絵（左・右）はこのシーンの設定で置き換わり、このシーンの立ち絵は削除されます。",
    mode: "single",
    confirmLabel: "移動する",
  },
  "copy-standing": {
    title: "立ち絵を別のシーンへ複製",
    description:
      "複製先の立ち絵（左・右）はこのシーンの設定で置き換わります。このシーンの立ち絵はそのまま残ります。",
    mode: "multiple",
    confirmLabel: "別のシーンへ複製",
  },
  "swap-standing": {
    title: "立ち絵を別のシーンと入れ替え",
    description: "2つのシーンの立ち絵（左・右）を丸ごと入れ替えます。",
    mode: "single",
    confirmLabel: "入れ替え",
  },
};

function standingTransferModeOf(
  kind: Extract<ScenePickerRequest["kind"], `${string}-standing`>,
): StandingTransferMode {
  const modeMap = {
    "move-standing": "move",
    "copy-standing": "copy",
    "swap-standing": "swap",
  } as const;
  return modeMap[kind];
}

function pickerTargets(
  scenes: readonly SceneFormValue[],
  excludeSceneId: string,
): ScenePickerTarget[] {
  return scenes
    .filter((scene) => scene.id !== excludeSceneId && scene.kind !== "insert")
    .map((scene) => ({
      id: scene.id,
      label: scene.label,
      kind: scene.kind,
      lineCount: scene.lines.length,
      cueCount: scene.cues.length,
      standingCount: scene.standings.filter(hasConfiguredStanding).length,
    }));
}

export function SceneEditor({
  base,
  editionId,
  scriptVersionId,
  onSaved,
  onValuesChange,
  onJumpToLine,
  onJumpToTarget,
  onDocumentChange,
  onDirtyChange,
  scrollContainerRef,
}: SceneEditorProps) {
  const save = useSaveScriptVersion(editionId);
  const voiceProfiles = useVoiceProfiles();
  const characterLibrary = useCharacters();
  const faceSets = useFaceSets();
  const adapterVoices = useAdapterVoicesMap();
  const themesQuery = useThemes();
  const assetsQuery = useAssets();
  const [diagnostics, setDiagnostics] = useState<{
    errors: Diagnostic[];
    warnings: Diagnostic[];
  }>({
    errors: [],
    warnings: [],
  });
  const [openKind, setOpenKind] = useState<"error" | "warning" | null>(null);
  const [savedAtMs, setSavedAtMs] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [pickerRequest, setPickerRequest] = useState<ScenePickerRequest | null>(
    null,
  );
  const [addBeforeSceneId, setAddBeforeSceneId] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
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

  const {
    register,
    control,
    handleSubmit,
    reset,
    getValues,
    setValue,
    formState,
  } = useForm<DocumentFormValues>({
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
  const {
    fields,
    insert,
    replace: replaceScenes,
  } = useFieldArray({
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
  const watchedScenes = useMemo(
    () => watchedScenesValue ?? [],
    [watchedScenesValue],
  );
  const watchedCharacters = useWatch({ control, name: "characters" }) ?? [];
  const watchedSpeakers = useWatch({ control, name: "speakers" }) ?? [];

  const foldStore = useCollapsibleStore();
  const openScene = useCallback(
    (sceneId: string) => {
      foldStore?.set(sceneFoldKey(sceneId), true);
    },
    [foldStore],
  );

  const pendingScrollRef = useRef<PendingEditorScroll | null>(null);

  useLayoutEffect(() => {
    const container = scrollContainerRef?.current;
    if (container === null || container === undefined) {
      return;
    }
    const pending = pendingScrollRef.current;
    if (pending === null) {
      return;
    }
    const apply = (): boolean => {
      if (pendingScrollRef.current !== pending) {
        return true;
      }
      if (pending.kind === "reveal") {
        if (!scrollEditorTargetIntoView(container, pending.targetId)) {
          return false;
        }
      } else {
        restoreEditorScrollAnchor(container, pending.anchor);
      }
      pendingScrollRef.current = null;
      return true;
    };
    if (apply()) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (!apply()) {
        pendingScrollRef.current = null;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [watchedScenes, scrollContainerRef]);

  const keepScrollAnchor = (targetId: string): void => {
    const container = scrollContainerRef?.current;
    if (container === null || container === undefined) {
      return;
    }
    const anchor = captureEditorScrollAnchor(container, targetId);
    pendingScrollRef.current =
      anchor === null ? null : { kind: "anchor", anchor };
  };

  const revealTarget = (targetId: string): void => {
    const container = scrollContainerRef?.current;
    if (container === null || container === undefined) {
      return;
    }
    pendingScrollRef.current = { kind: "reveal", targetId };
  };

  const navProjection = useMemo(
    () => sceneNavProjection(watchedScenes, watchedSpeakers, watchedCharacters),
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
  }, [
    watchedScenes,
    watchedSpeakers,
    watchedCharacters,
    navProjection,
    onValuesChange,
  ]);
  const savedVoiceByLineId = useMemo(() => {
    const speakerById = new Map(
      base.speakers.map((speaker) => [speaker.id, speaker]),
    );
    const map = new Map<string, string | null>();
    for (const scene of base.scenes) {
      for (const line of scene.lines) {
        const speaker =
          line.speakerId === null ? undefined : speakerById.get(line.speakerId);
        map.set(line.id, speaker?.voiceProfileId ?? null);
      }
    }
    return map;
  }, [base]);

  const lastBaseRef = useRef(base);
  const bgmSnapshotRef = useRef<string | null>(null);
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

  const onSubmit = handleSubmit((values) => {
    let document: ContentDocument;
    try {
      document = buildContentDocument(base, values);
    } catch (error) {
      setDiagnostics({
        errors: [{ message: errorMessage(error) }],
        warnings: [],
      });
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
        setDiagnostics((prev) => ({
          ...prev,
          errors: extractServerErrors(error),
        }));
        setOpenKind("error");
      },
    });
  });

  const showMessage = (message: string): void => {
    setDiagnostics((prev) => ({ ...prev, errors: [{ message }] }));
    setOpenKind("error");
  };

  const showError = (error: unknown): void => {
    showMessage(errorMessage(error));
  };

  const showWarnings = (warnings: Warning[]): void => {
    setDiagnostics((prev) => ({
      ...prev,
      warnings: warnings.map((warning) => ({
        path: warning.path,
        code: warning.code,
        message: warning.message,
      })),
    }));
    if (warnings.length > 0) {
      setOpenKind("warning");
      return;
    }
    setOpenKind((prev) => (prev === "warning" ? null : prev));
  };

  const runStructural = (
    operation: ScriptOperation,
  ): StructuralEditResult | null => {
    try {
      const next = applyStructuralOperation(
        base,
        getValues(),
        operation,
        assetsQuery.data ?? [],
      );
      replaceScenes(next.values.scenes);
      showWarnings(next.result.warnings);
      return next;
    } catch (error) {
      pendingScrollRef.current = null;
      showError(error);
      return null;
    }
  };

  const onRemoveCue = (sceneIndex: number, cueId: string) => {
    const scene = getValues(`scenes.${sceneIndex}`);
    if (scene === undefined) {
      return;
    }
    try {
      const next = removeCueStructural(
        base,
        getValues(),
        scene.id,
        cueId,
        assetsQuery.data ?? [],
      );
      if (next === null) {
        showMessage(
          "映像演出を削除できませんでした。Sceneの状態を確認してください。",
        );
        return;
      }
      keepScrollAnchor(`scene-${scene.id}`);
      replaceScenes(next.values.scenes);
      showWarnings(next.result.warnings);
    } catch (error) {
      pendingScrollRef.current = null;
      showError(error);
    }
  };

  const onCommitCue = (sceneIndex: number, cueId: string) => {
    const scene = getValues(`scenes.${sceneIndex}`);
    if (scene === undefined) {
      return;
    }
    try {
      const next = commitCueStructural(
        base,
        getValues(),
        scene.id,
        cueId,
        assetsQuery.data ?? [],
      );
      if (next !== null) {
        const nextCue = next.values.scenes
          .find((entry) => entry.id === scene.id)
          ?.cues.find((entry) => entry.id === cueId);
        const cueIndex = getValues(`scenes.${sceneIndex}.cues`).findIndex(
          (entry) => entry.id === cueId,
        );
        if (nextCue !== undefined && cueIndex !== -1) {
          setValue(`scenes.${sceneIndex}.cues.${cueIndex}`, nextCue, {
            shouldDirty: true,
          });
        } else {
          replaceScenes(next.values.scenes);
        }
        showWarnings(next.result.warnings);
      }
    } catch (error) {
      showError(error);
    }
  };

  const onMoveCueRequest = (sceneIndex: number, cueId: string) => {
    const scene = getValues(`scenes.${sceneIndex}`);
    if (scene === undefined) {
      return;
    }
    setPickerRequest({ kind: "move-cue", sceneId: scene.id, cueId });
  };

  const onCopyCueRequest = (sceneIndex: number, cueId: string) => {
    const scene = getValues(`scenes.${sceneIndex}`);
    if (scene === undefined) {
      return;
    }
    setPickerRequest({ kind: "copy-cue", sceneId: scene.id, cueId });
  };

  const onTransferStandingsRequest = (
    sceneIndex: number,
    mode: StandingTransferMode,
  ) => {
    const scene = getValues(`scenes.${sceneIndex}`);
    if (scene === undefined) {
      return;
    }
    const requestKind = {
      move: "move-standing",
      copy: "copy-standing",
      swap: "swap-standing",
    } as const;
    setPickerRequest({ kind: requestKind[mode], sceneId: scene.id });
  };

  const runTransferStructural = (
    apply: () => StructuralEditResult | null,
    openSceneIds: readonly string[],
    reveal: string | null | ((next: StructuralEditResult) => string | null),
    failureMessage: string,
  ): void => {
    try {
      const next = apply();
      if (next === null) {
        showMessage(failureMessage);
        return;
      }
      replaceScenes(next.values.scenes);
      for (const sceneId of openSceneIds) {
        openScene(sceneId);
      }
      const anchor = typeof reveal === "function" ? reveal(next) : reveal;
      if (anchor !== null) {
        revealTarget(anchor);
      }
      showWarnings(next.result.warnings);
    } catch (error) {
      pendingScrollRef.current = null;
      showError(error);
    }
  };

  const onMoveCue = (sceneId: string, cueId: string, toSceneId: string) => {
    runTransferStructural(
      () =>
        moveCueStructural(
          base,
          getValues(),
          sceneId,
          cueId,
          toSceneId,
          assetsQuery.data ?? [],
        ),
      [toSceneId],
      `cue-${cueId}`,
      "映像演出を移動できませんでした。Sceneの状態を確認してください。",
    );
  };

  const onCopyCue = (sceneId: string, cueId: string, toSceneIds: string[]) => {
    runTransferStructural(
      () =>
        copyCueStructural(
          base,
          getValues(),
          sceneId,
          cueId,
          toSceneIds,
          assetsQuery.data ?? [],
        ),
      toSceneIds,
      (next) => {
        const [firstCreated] = next.result.created.cueIds;
        return firstCreated === undefined ? null : `cue-${firstCreated}`;
      },
      "映像演出を複製できませんでした。Sceneの状態を確認してください。",
    );
  };

  const onTransferStandings = (
    fromSceneId: string,
    toSceneId: string,
    mode: StandingTransferMode,
  ) => {
    runTransferStructural(
      () =>
        transferStandingsStructural(
          base,
          getValues(),
          fromSceneId,
          toSceneId,
          mode,
          assetsQuery.data ?? [],
        ),
      [toSceneId],
      `scene-${toSceneId}`,
      "立ち絵を変更できませんでした。Sceneの状態を確認してください。",
    );
  };

  const onCopyStandings = (fromSceneId: string, toSceneIds: string[]) => {
    runTransferStructural(
      () =>
        copyStandingsStructural(
          base,
          getValues(),
          fromSceneId,
          toSceneIds,
          assetsQuery.data ?? [],
        ),
      toSceneIds,
      toSceneIds.length > 0 ? `scene-${toSceneIds[0]}` : null,
      "立ち絵を複製できませんでした。Sceneの状態を確認してください。",
    );
  };

  const onPickerSelect = (toSceneIds: string[]) => {
    const request = pickerRequest;
    setPickerRequest(null);
    if (request === null) {
      return;
    }
    if (request.kind === "move-cue") {
      const [toSceneId] = toSceneIds;
      if (toSceneId === undefined) {
        return;
      }
      onMoveCue(request.sceneId, request.cueId, toSceneId);
      return;
    }
    if (request.kind === "copy-cue") {
      if (toSceneIds.length === 0) {
        return;
      }
      onCopyCue(request.sceneId, request.cueId, toSceneIds);
      return;
    }
    if (request.kind === "copy-standing") {
      if (toSceneIds.length === 0) {
        return;
      }
      onCopyStandings(request.sceneId, toSceneIds);
      return;
    }
    const [toSceneId] = toSceneIds;
    if (toSceneId === undefined) {
      return;
    }
    onTransferStandings(
      request.sceneId,
      toSceneId,
      standingTransferModeOf(request.kind),
    );
  };

  const onCommitStanding = (sceneIndex: number, side: "left" | "right") => {
    const scene = getValues(`scenes.${sceneIndex}`);
    if (scene === undefined) {
      return;
    }
    try {
      const next = commitStandingStructural(
        base,
        getValues(),
        scene.id,
        side,
        assetsQuery.data ?? [],
      );
      if (next === null) {
        return;
      }
      const nextScene = next.values.scenes.find(
        (entry) => entry.id === scene.id,
      );
      if (nextScene !== undefined) {
        setValue(`scenes.${sceneIndex}.standings`, nextScene.standings, {
          shouldDirty: true,
        });
      }
      showWarnings(next.result.warnings);
    } catch (error) {
      showError(error);
    }
  };

  const onCommitBgm = () => {
    try {
      const next = commitBgmStructural(
        base,
        getValues(),
        assetsQuery.data ?? [],
      );
      if (next === null) {
        return;
      }
      setValue("bgm", next.values.bgm, { shouldDirty: true });
      showWarnings(next.result.warnings);
    } catch (error) {
      showError(error);
    }
  };

  const onCommitAudioCue = (sceneIndex: number, cueIndex: number) => {
    const scene = getValues(`scenes.${sceneIndex}`);
    if (scene === undefined) {
      return;
    }
    try {
      const next = commitSceneAudioStructural(
        base,
        getValues(),
        scene.id,
        cueIndex,
        assetsQuery.data ?? [],
      );
      if (next === null) {
        return;
      }
      const nextScene = next.values.scenes.find(
        (entry) => entry.id === scene.id,
      );
      if (nextScene !== undefined) {
        setValue(`scenes.${sceneIndex}.audioCues`, nextScene.audioCues, {
          shouldDirty: true,
        });
      }
      showWarnings(next.result.warnings);
    } catch (error) {
      showError(error);
    }
  };

  const resolveInsertIndex = (): number => {
    const scenes = getValues("scenes");
    const targetId = resolveInsertionTargetId(scenes, addBeforeSceneId);
    if (targetId === null) {
      return scenes.length;
    }
    const index = scenes.findIndex((scene) => scene.id === targetId);
    return index === -1 ? scenes.length : index;
  };

  const onAddPoint = () => {
    const next = runStructural({
      op: "scene.add",
      kind: "point",
      index: resolveInsertIndex(),
    });
    const newSceneId = next?.result.created.sceneIds[0];
    if (newSceneId !== undefined) {
      openScene(newSceneId);
      revealTarget(`scene-${newSceneId}`);
    }
  };

  const onClonePrevious = (index: number) => {
    const scenes = getValues("scenes");
    const previous = scenes[index - 1];
    if (previous === undefined || previous.kind !== "point") {
      return;
    }
    const clonedSceneId = newSceneId(collectSceneIds(scenes));
    insert(
      index,
      cloneSceneFormValue(
        previous as SceneFormValue & { kind: "point" },
        clonedSceneId,
        nextPointLabel(scenes, index),
      ),
    );
    openScene(clonedSceneId);
    revealTarget(`scene-${clonedSceneId}`);
  };

  const onInsertVideo = (assetId: string | null) => {
    if (assetId === null) {
      return;
    }
    const asset = (assetsQuery.data ?? []).find(
      (entry) => entry.id === assetId,
    );
    if (
      asset === undefined ||
      asset.kind !== "video" ||
      asset.durationMs === null ||
      asset.durationMs <= 0
    ) {
      showMessage(
        "尺が確定した動画だけを挿入できます。素材の取り込み完了後に選び直してください。",
      );
      return;
    }
    const next = runStructural({
      op: "scene.add",
      kind: "insert",
      index: resolveInsertIndex(),
      assetId: asset.id,
      durationMs: asset.durationMs,
      embeddedAudio: asset.hasAudio,
    });
    const newSceneId = next?.result.created.sceneIds[0];
    if (newSceneId !== undefined) {
      openScene(newSceneId);
      revealTarget(`scene-${newSceneId}`);
    }
  };

  const onMove = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    const scenes = getValues("scenes");
    const scene = scenes[index];
    if (
      scene === undefined ||
      !isMiddleScene(scene.kind) ||
      !isMiddleScene(scenes[target]?.kind)
    ) {
      return;
    }
    keepScrollAnchor(`scene-${scene.id}`);
    runStructural({ op: "scene.move", sceneId: scene.id, index: target });
  };

  const onRemoveScene = (sceneIndex: number) => {
    const scene = getValues(`scenes.${sceneIndex}`);
    if (scene === undefined) {
      return;
    }
    runStructural({ op: "scene.remove", sceneId: scene.id });
  };

  const onSplitScene = (sceneIndex: number, lineIndex: number) => {
    const scene = getValues(`scenes.${sceneIndex}`);
    const lineId = scene?.lines[lineIndex]?.id;
    if (scene === undefined || scene.kind !== "point" || lineId === undefined) {
      return;
    }
    const next = runStructural({
      op: "scene.splitAtLine",
      sceneId: scene.id,
      lineId,
    });
    const created = next?.result.created.sceneIds ?? [];
    for (const createdId of created) {
      openScene(createdId);
    }
    if (created[0] !== undefined) {
      revealTarget(`scene-${created[0]}`);
    }
  };

  const bulkCandidateCount = useMemo(
    () => bulkTtsCandidateLineIds(base).length,
    [base],
  );

  const addBulkTake = (narrationSegmentId: string, result: TtsJobResult) => {
    const scenes = getValues("scenes");
    for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex += 1) {
      const scene = scenes[sceneIndex];
      if (scene === undefined) {
        continue;
      }
      const lineIndex = scene.lines.findIndex(
        (line) => line.id === narrationSegmentId,
      );
      if (lineIndex === -1) {
        continue;
      }
      const line = scene.lines[lineIndex];
      if (line === undefined) {
        continue;
      }
      const next = mergeTake(
        line,
        {
          assetId: result.assetId,
          durationMs: result.durationMs,
          source: "tts",
        },
        generatedTakePolicy("bulk").select,
      );
      setValue(`scenes.${sceneIndex}.lines.${lineIndex}.takes`, next.takes, {
        shouldDirty: true,
      });
      setValue(
        `scenes.${sceneIndex}.lines.${lineIndex}.selectedAudioTakeId`,
        next.selectedAudioTakeId,
        {
          shouldDirty: true,
        },
      );
      return;
    }
  };

  const onBulkGenerate = () => {
    setBulkResult(null);
    setBulkProgress(null);
    bulkGenerate.mutate(
      {
        onProgress: (done, total) => setBulkProgress({ done, total }),
        onJobSucceeded: (result) =>
          addBulkTake(result.narrationSegmentId, result),
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

  const addSpeakerFor = (
    characterId: string,
    name: string,
    voiceProfileId: string | null,
  ) => {
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
      entry.voices.find((voice) => voice.locale === base.locale)
        ?.voiceProfileId ?? null;
    const resolvedName = resolveCharacterName(entry, base.locale);
    const character: CharacterFormValue = {
      id: characterId,
      name: resolvedName,
      names: entry.names.map((name) => ({ ...name })),
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
    addSpeakerFor(characterId, resolvedName, voiceProfileId);
  };

  const addVoiceOnlySpeaker = () => {
    const characterId = newCharacterId();
    appendCharacter({
      id: characterId,
      name: "ナレーター",
      names: [],
      voiceProfileId: null,
      voices: [],
      appearances: [],
    });
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
      details.length === 0
        ? ""
        : `\n使用中: ${details.join("、")}。保存するとこれらの参照を解除します。`;
    if (
      !window.confirm(
        `「${character.name || character.id}」を削除しますか？${usageText}`,
      )
    ) {
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
      getValues("speakers").filter(
        (speaker) => speaker.characterId !== character.id,
      ),
      { shouldDirty: true },
    );
    getValues("scenes").forEach((scene, sceneIndex) => {
      scene?.lines.forEach((line, lineIndex) => {
        if (
          line?.speakerId !== null &&
          line?.speakerId !== undefined &&
          speakerIds.has(line.speakerId)
        ) {
          setValue(`scenes.${sceneIndex}.lines.${lineIndex}.speakerId`, null, {
            shouldDirty: true,
          });
        }
      });
      (scene?.standings ?? []).forEach((standing, standingIndex) => {
        if (standing?.characterId !== character.id) {
          return;
        }
        setValue(
          `scenes.${sceneIndex}.standings.${standingIndex}.characterId`,
          null,
          {
            shouldDirty: true,
          },
        );
        setValue(
          `scenes.${sceneIndex}.standings.${standingIndex}.appearanceId`,
          null,
          {
            shouldDirty: true,
          },
        );
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

  const insertionOptions = watchedScenes.flatMap((scene, index) => {
    if (scene.kind === "intro") {
      return [];
    }
    if (scene.kind === "outro") {
      return [{ id: scene.id, text: "結びの前" }];
    }
    const name = sceneDisplayName(scene, pointOrdinals[index] ?? 0);
    return [{ id: scene.id, text: `「${name}」の前` }];
  });
  const insertionSelectValue =
    resolveInsertionTargetId(watchedScenes, addBeforeSceneId) ?? "";

  const timing = useMemo(() => {
    if (allValues === undefined || allValues.scenes === undefined) {
      return {
        placements: [] as ReturnType<typeof resolveTimeline>["scenes"],
        error: null,
      };
    }
    try {
      const document = buildContentDocument(base, allValues);
      return { placements: resolveTimeline(document).scenes, error: null };
    } catch (error) {
      return { placements: [], error: errorMessage(error) };
    }
  }, [allValues, base]);

  const placementBySceneId = useMemo(
    () =>
      new Map(
        timing.placements.map((placement) => [placement.sceneId, placement]),
      ),
    [timing.placements],
  );

  const diagBySceneId = useMemo(() => {
    const map = new Map<string, { errors: number; warnings: number }>();
    const add = (
      path: (string | number)[] | undefined,
      kind: "errors" | "warnings",
    ) => {
      if (
        path === undefined ||
        path.length < 2 ||
        path[0] !== "scenes" ||
        typeof path[1] !== "number"
      ) {
        return;
      }
      const scene = watchedScenes[path[1]];
      if (scene === undefined) {
        return;
      }
      const entry = map.get(scene.id) ?? { errors: 0, warnings: 0 };
      entry[kind] += 1;
      map.set(scene.id, entry);
    };
    for (const diag of diagnostics.errors) {
      add(diag.path, "errors");
    }
    for (const diag of diagnostics.warnings) {
      add(diag.path, "warnings");
    }
    return map;
  }, [diagnostics, watchedScenes]);

  const watchedBgm = allValues?.bgm;

  const pickerCopy =
    pickerRequest === null ? null : SCENE_PICKER_COPY[pickerRequest.kind];

  return (
    <>
      <form onSubmit={onSubmit}>
        <fieldset
          disabled={save.isPending}
          className="contents border-0 m-0 p-0"
        >
          <div
            id="editor-actionbar"
            className="sticky top-0 z-10 flex flex-wrap items-center gap-3 bg-surface py-2.5"
          >
            <button
              type="submit"
              className={buttonPrimaryClass}
              disabled={save.isPending || bulkGenerate.isPending}
            >
              <Save aria-hidden="true" className="h-4 w-4" />
              保存
            </button>
            <button
              type="button"
              className={buttonNeutralClass}
              disabled={watchedScenes.length === 0}
              onClick={() =>
                foldStore?.setMany(
                  watchedScenes.map((scene) => sceneFoldKey(scene.id)),
                  true,
                )
              }
            >
              すべて開く
            </button>
            <button
              type="button"
              className={buttonNeutralClass}
              disabled={watchedScenes.length === 0}
              onClick={() =>
                foldStore?.setMany(
                  watchedScenes.map((scene) => sceneFoldKey(scene.id)),
                  false,
                )
              }
            >
              すべて閉じる
            </button>
            {diagnostics.errors.length > 0 && (
              <button
                type="button"
                className={`inline-flex cursor-pointer items-center gap-1 rounded px-2.5 py-1 text-xs font-medium ${
                  openKind === "error"
                    ? "border border-red-400 bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-100"
                    : "bg-red-100 text-red-800 hover:bg-red-200 dark:bg-red-950/60 dark:text-red-200"
                }`}
                onClick={() =>
                  setOpenKind(openKind === "error" ? null : "error")
                }
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
                onClick={() =>
                  setOpenKind(openKind === "warning" ? null : "warning")
                }
              >
                <TriangleAlert className="h-4 w-4 shrink-0" />
                <span>警告({diagnostics.warnings.length})</span>
              </button>
            )}
            <button
              type="button"
              className={buttonNeutralClass}
              disabled={
                formState.isDirty ||
                bulkGenerate.isPending ||
                bulkCandidateCount === 0
              }
              onClick={onBulkGenerate}
            >
              {bulkGenerate.isPending
                ? "一括生成中…"
                : `未音声を一括生成（${bulkCandidateCount}）`}
            </button>
            {bulkProgress !== null && (
              <span className={metaTextClass}>
                進捗 {bulkProgress.done}/{bulkProgress.total}
              </span>
            )}
            {formState.isDirty &&
              !bulkGenerate.isPending &&
              bulkCandidateCount > 0 && (
                <span className={metaTextClass}>
                  保存すると一括生成できます
                </span>
              )}
            {savedAtMs !== null && (
              <span className={metaTextClass}>
                保存しました（{new Date(savedAtMs).toLocaleTimeString("ja-JP")}
                ）
              </span>
            )}
            {bulkGenerate.isError && (
              <span className={errorTextClass}>
                {errorMessage(bulkGenerate.error)}
              </span>
            )}
            {openKind !== null && (
              <div
                role="region"
                aria-label={openKind === "error" ? "エラー一覧" : "警告一覧"}
                className={`absolute left-0 right-0 top-full max-h-60 overflow-auto rounded border p-3 text-sm shadow-lg ${
                  openKind === "error"
                    ? "border-red-400 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200"
                    : "border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                }`}
              >
                <div className="mb-1 font-semibold">
                  {openKind === "error" ? "エラー一覧" : "警告一覧"}
                </div>
                <ul className="m-0 list-disc space-y-1 pl-5">
                  {(openKind === "error"
                    ? diagnostics.errors
                    : diagnostics.warnings
                  ).map((diag, index) => {
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
                                onClick={() =>
                                  onJumpToTarget?.(target.targetId, target.seek)
                                }
                              >
                                {pathStr}
                              </button>
                            ) : (
                              <span className="mr-1.5 font-mono text-muted-foreground">
                                {pathStr}
                              </span>
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
          </div>

          {bulkResult !== null && (
            <div className="rounded border border-yellow-400 bg-yellow-50 p-3 text-sm dark:bg-yellow-950/40">
              <strong>一括生成の結果</strong>
              <p>
                成功 {bulkResult.succeeded} 件 / 対象外{" "}
                {bulkResult.excluded.length} 件 / 失敗{" "}
                {bulkResult.failed.length}{" "}
                件（追加した音声は「保存」で台本に反映されます）
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
                    <li key={`failed-${entry.narrationSegmentId}`}>
                      失敗: {entry.message}
                    </li>
                  ))}
                </ul>
              )}
              {(bulkResult.failed.length > 0 ||
                bulkResult.excluded.length > 0) && (
                <p>
                  未音声が残っています。成功分を保存した後、もう一度「未音声を一括生成」で再試行できます。
                </p>
              )}
            </div>
          )}

          <Collapsible
            title="テーマ（Visual Theme）"
            storageKey="theme"
            summary={(() => {
              const themeId = allValues?.visualTheme?.id;
              const themeVersion = allValues?.visualTheme?.version;
              const theme = (themesQuery.data ?? []).find(
                (entry) => entry.id === themeId,
              );
              if (
                theme === undefined ||
                themeId === undefined ||
                themeVersion === undefined
              ) {
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
              <label className={formLabelClass}>
                選択中テーマ:
                <select
                  className={textFieldClass}
                  value={`${getValues("visualTheme.id")}@${getValues("visualTheme.version")}`}
                  onChange={(e) => {
                    const [id, verStr] = e.target.value.split("@");
                    if (id && verStr) {
                      setValue("visualTheme.id", id, { shouldDirty: true });
                      setValue("visualTheme.version", Number(verStr), {
                        shouldDirty: true,
                      });
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
                          {t.name} (v{version}){" "}
                          {t.isBuiltIn ? "【組み込み】" : ""}
                        </option>
                      );
                    })}
                </select>
              </label>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  {...register("caption.showSpeakerName")}
                />
                字幕に話者名を表示（焼き込みのみ・SRTは名前なし）
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
            <div
              onFocus={(event) => {
                const related = event.relatedTarget as Node | null;
                if (related !== null && event.currentTarget.contains(related)) {
                  return;
                }
                if (
                  related instanceof Element &&
                  related.closest('[role="dialog"]') !== null
                ) {
                  return;
                }
                if (related === null && bgmSnapshotRef.current !== null) {
                  return;
                }
                bgmSnapshotRef.current = JSON.stringify(getValues("bgm"));
              }}
              onBlur={(event) => {
                const related = event.relatedTarget as Node | null;
                if (related === null || event.currentTarget.contains(related)) {
                  return;
                }
                if (
                  related instanceof Element &&
                  related.closest('[role="dialog"]') !== null
                ) {
                  return;
                }
                const current = JSON.stringify(getValues("bgm"));
                if (current === bgmSnapshotRef.current) {
                  return;
                }
                bgmSnapshotRef.current = current;
                onCommitBgm();
              }}
            >
              <MediaPicker
                label="BGM"
                kinds={["audio"]}
                selectedAssetId={watchedBgm?.assetId ?? null}
                onSelect={(assetId) =>
                  setValue("bgm.assetId", assetId, { shouldDirty: true })
                }
              />
              {watchedBgm?.assetId !== null &&
                watchedBgm?.assetId !== undefined && (
                  <div className="mt-2 flex flex-wrap items-center gap-4">
                    <label className={formLabelClass}>
                      <input type="checkbox" {...register("bgm.loop")} />
                      ループ
                    </label>
                    <label className={formLabelClass}>
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
            </div>
          </Collapsible>

          <Collapsible
            title="キャラクター"
            summary={
              characterFields.length === 0
                ? "未登録"
                : `${characterFields.length}件`
            }
            open={charactersOpen}
            onOpenChange={setCharactersOpen}
            className={sectionCardClass}
          >
            <h3 className={sectionTitleClass}>キャラクター</h3>
            <p className={sectionSummaryClass}>
              この作品で使うキャラクターです。声プロファイルを割り当てると、そのキャラクターのセリフをTTSで生成できます。外観はライブラリから取り込んだ後に、この作品内で追加・編集できます。
            </p>
            {voiceProfiles.isError && (
              <p className={errorTextClass}>
                声プロファイルを読み込めませんでした。
              </p>
            )}
            {characterLibrary.isError && (
              <p className={errorTextClass}>
                キャラクターライブラリを読み込めませんでした。
              </p>
            )}
            {faceSets.isError && (
              <p className={errorTextClass}>
                表情セットを読み込めませんでした。
              </p>
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
              <label className={formLabelClass}>
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
              <button
                type="button"
                className={buttonNeutralClass}
                onClick={addVoiceOnlySpeaker}
              >
                声だけの話者を追加
              </button>
            </div>
            {characterFields.length === 0 && (
              <p className={metaTextClass}>
                キャラクターがありません。「ライブラリから追加」で追加してください。
              </p>
            )}
          </Collapsible>

          <ScriptSkinProvider control={control}>
            {fields.map((field, sceneIndex) => {
              const scene = watchedScenes[sceneIndex];
              if (scene === undefined) {
                return null;
              }
              const placement = placementBySceneId.get(scene.id);
              const diag = diagBySceneId.get(scene.id) ?? {
                errors: 0,
                warnings: 0,
              };
              return (
                <SceneBlock
                  key={field.id}
                  control={control}
                  register={register}
                  getValues={getValues}
                  setValue={setValue}
                  base={base}
                  scene={scene}
                  sceneIndex={sceneIndex}
                  pointOrdinal={pointOrdinals[sceneIndex] ?? 0}
                  prevKind={watchedScenes[sceneIndex - 1]?.kind}
                  nextKind={watchedScenes[sceneIndex + 1]?.kind}
                  durationMs={placement?.durationMs ?? null}
                  durationError={timing.error}
                  durationLines={placement?.lines ?? []}
                  errorCount={diag.errors}
                  warningCount={diag.warnings}
                  assets={assetsQuery.data ?? []}
                  assetsLoading={assetsQuery.isLoading}
                  assetsError={assetsQuery.isError}
                  speakers={watchedSpeakers}
                  characters={watchedCharacters}
                  voiceProfiles={voiceProfiles.data ?? []}
                  adapterVoices={adapterVoices}
                  savedVoiceByLineId={savedVoiceByLineId}
                  bulkRunning={bulkGenerate.isPending}
                  faceSets={faceSets.data ?? []}
                  faceSetsReady={faceSets.isSuccess}
                  scriptVersionId={scriptVersionId}
                  onMove={onMove}
                  onRemoveScene={onRemoveScene}
                  onClonePrevious={onClonePrevious}
                  onRemoveCue={onRemoveCue}
                  onCommitCue={onCommitCue}
                  onMoveCueRequest={onMoveCueRequest}
                  onCopyCueRequest={onCopyCueRequest}
                  onCommitStanding={onCommitStanding}
                  onTransferStandingsRequest={onTransferStandingsRequest}
                  onCommitAudioCue={onCommitAudioCue}
                  onSplitScene={onSplitScene}
                  onJumpToLine={onJumpToLine}
                  onWarnings={showWarnings}
                  onError={showMessage}
                />
              );
            })}
          </ScriptSkinProvider>

          <div className="flex flex-wrap items-center gap-3">
            {insertionOptions.length > 0 && (
              <label className={formLabelClass}>
                追加位置
                <select
                  className={textFieldClass}
                  value={insertionSelectValue}
                  onChange={(event) => setAddBeforeSceneId(event.target.value)}
                >
                  {insertionOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.text}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              className={buttonNeutralClass}
              onClick={onAddPoint}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              要点を追加
            </button>
            <MediaPicker
              label="動画を挿入"
              kinds={["video"]}
              selectedAssetId={null}
              onSelect={onInsertVideo}
              variant="add"
              inline
              icon={Video}
            />
            <button
              type="button"
              className={buttonNeutralClass}
              onClick={() => setImportOpen(true)}
            >
              台本をインポート
            </button>
          </div>
          {pointCount === 0 && (
            <p className={metaTextClass}>
              要点Sceneがありません。追加してください。
            </p>
          )}
        </fieldset>
      </form>
      <ScenePickerModal
        open={pickerCopy !== null}
        title={pickerCopy?.title ?? ""}
        description={pickerCopy?.description ?? ""}
        mode={pickerCopy?.mode ?? "single"}
        confirmLabel={pickerCopy?.confirmLabel ?? ""}
        scenes={
          pickerRequest === null
            ? []
            : pickerTargets(watchedScenes, pickerRequest.sceneId)
        }
        onClose={() => setPickerRequest(null)}
        onSelect={onPickerSelect}
      />
      <ScriptImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        scenes={watchedScenes}
        speakers={watchedSpeakers}
        disabled={save.isPending}
        onApply={(nextScenes) => {
          const prevIds = new Set(getValues("scenes").map((scene) => scene.id));
          replaceScenes(nextScenes);
          foldStore?.setMany(
            nextScenes
              .filter((scene) => !prevIds.has(scene.id))
              .map((scene) => sceneFoldKey(scene.id)),
            true,
          );
        }}
      />
    </>
  );
}
