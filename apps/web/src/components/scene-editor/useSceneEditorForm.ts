import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type RefObject,
} from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { contentDocumentSchema, type ContentDocument } from "@kakeai/contracts";
import {
  buildContentDocument,
  toFormValues,
  type CharacterFormValue,
  type DocumentFormValues,
  type SceneFormValue,
  type SpeakerFormValue,
} from "../../content/form";
import {
  captureEditorScrollAnchor,
  restoreEditorScrollAnchor,
  scrollEditorTargetIntoView,
  type EditorScrollAnchor,
} from "../../lib/editorScroll";
import type { UnsavedDocumentState } from "../../lib/useDraftPreview";
import { sceneNavProjection } from "../../content/navProjection";
import { sceneFoldKey } from "../../lib/collapseState";
import { useCollapsibleStore, useStoredCollapsible } from "../Collapsible";

const DRAFT_PREVIEW_DEBOUNCE_MS = 800;

type PendingEditorScroll =
  | { kind: "anchor"; anchor: EditorScrollAnchor }
  | { kind: "reveal"; targetId: string };

export interface SceneEditorFormOptions {
  base: ContentDocument;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  onValuesChange?: (
    scenes: SceneFormValue[],
    speakers: SpeakerFormValue[],
    characters: CharacterFormValue[],
  ) => void;
  onDocumentChange?: (state: UnsavedDocumentState) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export function useSceneEditorForm({
  base,
  scrollContainerRef,
  onValuesChange,
  onDocumentChange,
  onDirtyChange,
}: SceneEditorFormOptions) {
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

  return {
    register,
    control,
    handleSubmit,
    reset,
    getValues,
    setValue,
    formState,
    fields,
    insert,
    replaceScenes,
    characterFields,
    appendCharacter,
    removeCharacter,
    charactersOpen,
    setCharactersOpen,
    watchedScenes,
    watchedCharacters,
    watchedSpeakers,
    foldStore,
    openScene,
    keepScrollAnchor,
    revealTarget,
    savedVoiceByLineId,
    allValues,
    // 外部からは keepScrollAnchor / revealTarget 経由で操作し、エラー時に null クリアする。
    pendingScrollRef,
    // BGM の比較用スナップショット。SceneEditor 側が保存・復元時に読み書きする。
    bgmSnapshotRef,
  };
}
