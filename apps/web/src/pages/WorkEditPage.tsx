import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useBeforeUnload, useBlocker, useParams } from "react-router-dom";
import type { UseQueryResult } from "@tanstack/react-query";
import { defaultPointLabel, type ScriptVersion } from "@kakeai/contracts";
import { useCurrentScriptVersion, useUpdateWork, useWork } from "../api/hooks";
import { CueMap } from "../components/CueMap";
import { PreviewSection } from "../components/PreviewSection";
import { RenderSection } from "../components/RenderSection";
import { SceneEditor } from "../components/SceneEditor";
import { CollapsibleStateProvider } from "../components/Collapsible";
import { errorMessage } from "../lib/errorMessage";
import { PreviewControllerProvider, usePreviewActions } from "../lib/PreviewController";
import { useDraftPreview, type UnsavedDocumentState } from "../lib/useDraftPreview";
import type { CharacterFormValue, SceneFormValue, SpeakerFormValue } from "../content/form";
import { SCENE_LABELS } from "../content/labels";
import {
  EDITOR_LAYOUT_DEFAULT_RATIOS,
  EDITOR_LAYOUT_MAX_LEFT_PX,
  EDITOR_LAYOUT_MIN_LEFT_PX,
  EDITOR_LAYOUT_MIN_PREVIEW_PX,
  loadLayoutRatios,
  resetLayoutRatios,
  resolvePaneWidths,
  saveLayoutRatios,
  shiftLayoutRatio,
  type EditorLayoutRatios,
  type LayoutStorage,
} from "../lib/editorLayout";
import { EDITOR_WIDE_MEDIA_QUERY, useMediaQuery } from "../lib/useMediaQuery";
import { thumbnailsRoute } from "../lib/routes";
import {
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
  textFieldClass,
} from "../ui";

function renderDownloadName(title: string, versionNumber: number): string {
  const base = title.trim().replace(/[\\/:*?"<>|]/g, "_");
  return `${base.length > 0 ? base : "render"}_v${versionNumber}.mp4`;
}

function escapeId(id: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(id)
    : id.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function findTarget(root: HTMLElement, targetId: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`#${escapeId(targetId)}`);
}

function stickyOffset(root: HTMLElement): number {
  const actionBar = root.querySelector<HTMLElement>("#editor-actionbar");
  return (actionBar?.offsetHeight ?? 0) + 8;
}

function getLayoutStorage(): LayoutStorage | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

function PaneDivider({
  ariaValue,
  ariaMin,
  ariaMax,
  onMove,
}: {
  ariaValue: number;
  ariaMin: number;
  ariaMax: number;
  onMove: (deltaX: number) => void;
}) {
  const lastX = useRef(0);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(ariaValue)}
      aria-valuemin={ariaMin}
      aria-valuemax={ariaMax}
      tabIndex={0}
      className="w-1.5 shrink-0 cursor-col-resize bg-border focus:bg-brand-500 focus:outline-none"
      onPointerDown={(event) => {
        lastX.current = event.clientX;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // pointer capture may already be released
        }
      }}
      onPointerMove={(event) => {
        if (event.buttons !== 1) {
          return;
        }
        const deltaX = event.clientX - lastX.current;
        lastX.current = event.clientX;
        onMove(deltaX);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onMove(-16);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          onMove(16);
        }
      }}
    />
  );
}

type PreviewSeekTarget =
  | { kind: "scene"; id: string }
  | { kind: "cue"; id: string }
  | { kind: "line"; id: string };

export function WorkEditPage() {
  const { workId } = useParams<{ workId: string }>();
  const work = useWork(workId);
  const editionId = work.data?.languageEditions[0]?.id;
  const current = useCurrentScriptVersion(editionId);
  const updateWork = useUpdateWork(workId);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [sceneEditorDirty, setSceneEditorDirty] = useState(false);
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const [unsaved, setUnsaved] = useState<UnsavedDocumentState>({ dirty: false, document: null });
  const draft = useDraftPreview(editionId, unsaved);
  const playerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setTitleDraft(null);
    setSceneEditorDirty(false);
    setPreviewVersionId(null);
    setUnsaved({ dirty: false, document: null });
  }, [workId, editionId]);

  const savedTitle = (work.data?.title ?? "").trim();
  const titleDraftTrimmed = titleDraft !== null ? titleDraft.trim() : null;
  const isTitleDirty =
    titleDraftTrimmed !== null &&
    titleDraftTrimmed.length > 0 &&
    titleDraftTrimmed !== savedTitle;
  const isDirty = sceneEditorDirty || isTitleDirty;

  const blocker = useBlocker(isDirty);
  const handledBlockerRef = useRef<typeof blocker | null>(null);

  useEffect(() => {
    if (blocker.state === "blocked") {
      if (handledBlockerRef.current === blocker) {
        return;
      }
      handledBlockerRef.current = blocker;
      const confirmed = window.confirm("編集内容が保存されていません。移動しますか？");
      if (confirmed) {
        blocker.proceed();
      } else {
        blocker.reset();
      }
    } else {
      handledBlockerRef.current = null;
    }
  }, [blocker]);

  useBeforeUnload(
    useCallback(
      (event) => {
        if (isDirty) {
          event.preventDefault();
          event.returnValue = "";
        }
      },
      [isDirty],
    ),
  );

  const onSaved = useCallback((scriptVersion: ScriptVersion) => {
    setPreviewVersionId(scriptVersion.id);
    setUnsaved({ dirty: false, document: null });
  }, []);

  const title = titleDraft ?? work.data?.title ?? "";

  const onRename = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed.length > 0) {
      updateWork.mutate(trimmed, { onSuccess: () => setTitleDraft(null) });
    }
  };

  const scriptVersionId = previewVersionId ?? current.data?.id;

  return (
    <section className="flex h-full min-h-0 flex-col">
      <p className="shrink-0 text-sm">
        <Link to="/" className="text-brand-700 hover:underline dark:text-brand-400">
          ← 作品一覧
        </Link>
      </p>

      {work.isLoading && <p className="shrink-0">読み込み中…</p>}
      {work.isError && <p className={`shrink-0 ${errorTextClass}`}>{errorMessage(work.error)}</p>}

      {work.data && (
        <form onSubmit={onRename} className="my-2 flex shrink-0 flex-wrap items-center gap-2">
          <input
            value={title}
            onChange={(event) => setTitleDraft(event.target.value)}
            className={`min-w-[200px] flex-1 ${textFieldClass}`}
          />
          <button type="submit" className={buttonPrimaryClass} disabled={updateWork.isPending}>
            作品名を保存
          </button>
        </form>
      )}
      {updateWork.isError && (
        <p className={`shrink-0 ${errorTextClass}`}>{errorMessage(updateWork.error)}</p>
      )}

      <PreviewControllerProvider playerRef={playerRef} scriptVersionId={scriptVersionId} draft={draft}>
        <WorkEditPanes
          workId={workId}
          editionId={editionId}
          workTitle={title}
          scriptVersionId={scriptVersionId}
          current={current}
          onSaved={onSaved}
          onDocumentChange={setUnsaved}
          onDirtyChange={setSceneEditorDirty}
        />
      </PreviewControllerProvider>
    </section>
  );
}

interface WorkEditPanesProps {
  workId: string | undefined;
  editionId: string | undefined;
  workTitle: string;
  scriptVersionId: string | undefined;
  current: UseQueryResult<ScriptVersion, Error>;
  onSaved: (scriptVersion: ScriptVersion) => void;
  onDocumentChange: (state: UnsavedDocumentState) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

function WorkEditPanes(props: WorkEditPanesProps) {
  return (
    <CollapsibleStateProvider resetKey={`${props.workId ?? ""}/${props.editionId ?? ""}`}>
      <WorkEditPanesContent {...props} />
    </CollapsibleStateProvider>
  );
}

function WorkEditPanesContent({
  workId,
  editionId,
  workTitle,
  scriptVersionId,
  current,
  onSaved,
  onDocumentChange,
  onDirtyChange,
}: WorkEditPanesProps) {
  const actions = usePreviewActions();
  const [formScenes, setFormScenes] = useState<SceneFormValue[] | null>(null);
  const [formCharacters, setFormCharacters] = useState<CharacterFormValue[]>([]);
  const [activeTargetId, setActiveTargetId] = useState<string | null>(null);
  const [ratios, setRatios] = useState<EditorLayoutRatios>(() => {
    const storage = getLayoutStorage();
    return storage === null ? { ...EDITOR_LAYOUT_DEFAULT_RATIOS } : loadLayoutRatios(storage);
  });
  const [workspacePx, setWorkspacePx] = useState(1440);
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const wide = useMediaQuery(EDITOR_WIDE_MEDIA_QUERY);
  const centerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);
  const [leftPanePx, setLeftPanePx] = useState(288);
  const ratiosRef = useRef(ratios);
  const workspaceRef = useRef(workspacePx);
  const wideRef = useRef(wide);
  const viewRef = useRef(view);
  const pendingTargetRef = useRef<string | null>(null);

  useEffect(() => {
    ratiosRef.current = ratios;
    workspaceRef.current = workspacePx;
    wideRef.current = wide;
    viewRef.current = view;
  });

  useEffect(() => {
    const element = containerRef.current;
    if (element === null) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0) {
        setWorkspacePx(width);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = asideRef.current;
    if (element === null) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0) {
        setLeftPanePx(width);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setFormScenes(null);
    setFormCharacters([]);
  }, [workId, editionId]);

  const onValuesChange = useCallback(
    (
      scenes: SceneFormValue[],
      _speakers: SpeakerFormValue[],
      characters: CharacterFormValue[],
    ) => {
      setFormScenes(scenes);
      setFormCharacters(characters);
    },
    [],
  );

  const movePane = useCallback((pane: "left" | "preview", deltaX: number) => {
    const workspace = Math.max(0, workspaceRef.current - 12);
    const before = resolvePaneWidths(workspace, ratiosRef.current);
    const next = shiftLayoutRatio(ratiosRef.current, workspace, pane, deltaX);
    const after = resolvePaneWidths(workspace, next);
    if (
      before.left === after.left &&
      before.center === after.center &&
      before.preview === after.preview
    ) {
      return;
    }
    ratiosRef.current = next;
    setRatios(next);
    const storage = getLayoutStorage();
    if (storage !== null) {
      saveLayoutRatios(storage, next);
    }
  }, []);

  const resetLayout = useCallback(() => {
    const storage = getLayoutStorage();
    if (storage !== null) {
      resetLayoutRatios(storage);
    }
    const next = { ...EDITOR_LAYOUT_DEFAULT_RATIOS };
    ratiosRef.current = next;
    setRatios(next);
  }, []);

  const scrollToTarget = useCallback((targetId: string) => {
    const root = centerRef.current;
    if (root === null) {
      return;
    }
    const element = findTarget(root, targetId);
    if (element === null) {
      return;
    }
    const top =
      element.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
    root.scrollTo({ top: Math.max(0, top - stickyOffset(root)), behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (view !== "edit") {
      return;
    }
    const targetId = pendingTargetRef.current;
    if (targetId === null) {
      return;
    }
    pendingTargetRef.current = null;
    const frame = requestAnimationFrame(() => scrollToTarget(targetId));
    return () => cancelAnimationFrame(frame);
  }, [view, scrollToTarget]);

  const jump = useCallback(
    (targetId: string, seek: PreviewSeekTarget) => {
      if (wideRef.current || viewRef.current === "edit") {
        scrollToTarget(targetId);
      } else {
        pendingTargetRef.current = targetId;
        setView("edit");
      }
      setDrawerOpen(false);
      if (seek.kind === "scene") {
        actions.jumpToScene(seek.id);
      } else if (seek.kind === "cue") {
        actions.jumpToCue(seek.id);
      } else {
        actions.jumpToLine(seek.id);
      }
    },
    [scrollToTarget, actions.jumpToScene, actions.jumpToCue, actions.jumpToLine],
  );

  const onJumpToLine = useCallback(
    (lineId: string) => actions.jumpToLine(lineId),
    [actions.jumpToLine],
  );

  const sceneLabels = useMemo(() => {
    const map = new Map<string, string>();
    let pointOrdinal = 0;
    for (const scene of formScenes ?? []) {
      if (scene.kind === "point") {
        pointOrdinal += 1;
      }
      const label = (scene.label ?? "").trim();
      let display: string;
      if (label.length > 0) {
        display = label;
      } else if (scene.kind === "point") {
        display = defaultPointLabel(pointOrdinal);
      } else {
        display = SCENE_LABELS[scene.kind] ?? scene.kind;
      }
      map.set(scene.id, display);
    }
    return map;
  }, [formScenes]);

  const targetIds = useMemo(() => {
    const ids: string[] = [];
    for (const scene of formScenes ?? []) {
      ids.push(`scene-${scene.id}`);
      for (const cue of scene.cues) {
        ids.push(`cue-${cue.id}`);
      }
      for (const line of scene.lines) {
        ids.push(`line-${line.id}`);
      }
    }
    return ids;
  }, [formScenes]);

  useEffect(() => {
    const root = centerRef.current;
    if (root === null || targetIds.length === 0) {
      setActiveTargetId(null);
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const containerTop = root.getBoundingClientRect().top;
      let active: string | null = null;
      for (const id of targetIds) {
        const element = findTarget(root, id);
        if (element === null) {
          continue;
        }
        if (element.getBoundingClientRect().top >= containerTop - 4) {
          active = id;
          break;
        }
      }
      setActiveTargetId(active ?? targetIds[targetIds.length - 1] ?? null);
    };
    const onScroll = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(update);
      }
    };
    update();
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
    };
  }, [targetIds]);

  const widths = resolvePaneWidths(Math.max(0, workspacePx - 12), ratios);
  const maxPreviewPx = Math.max(EDITOR_LAYOUT_MIN_PREVIEW_PX, workspacePx * 0.5);
  const showCenter = wide || view === "edit";
  const showPreview = wide || view === "preview";

  return (
      <div ref={containerRef} className="flex min-h-0 flex-1 flex-col">
      {!wide && (
        <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
          <button type="button" className={buttonNeutralClass} onClick={() => setDrawerOpen(true)}>
            構成
          </button>
          <div
            role="group"
            aria-label="編集と確認の切替"
            className="inline-flex overflow-hidden rounded-md border border-border"
          >
            <button
              type="button"
              aria-pressed={view === "edit"}
              onClick={() => setView("edit")}
              className={
                view === "edit"
                  ? "bg-brand-600 px-3 py-1.5 text-sm font-medium text-white"
                  : "bg-surface px-3 py-1.5 text-sm text-foreground hover:bg-surface-muted"
              }
            >
              編集
            </button>
            <button
              type="button"
              aria-pressed={view === "preview"}
              onClick={() => setView("preview")}
              className={
                view === "preview"
                  ? "bg-brand-600 px-3 py-1.5 text-sm font-medium text-white"
                  : "bg-surface px-3 py-1.5 text-sm text-foreground hover:bg-surface-muted"
              }
            >
              確認
            </button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside
          ref={asideRef}
          style={wide ? { width: widths.left } : undefined}
          className={
            wide
              ? "min-h-0 shrink-0 overflow-auto rounded border border-border p-2 text-sm"
              : `fixed inset-y-0 left-0 z-30 min-h-0 w-72 max-w-[85vw] overflow-auto border-r border-border bg-surface p-2 text-sm shadow-xl transition-transform ${
                  drawerOpen ? "translate-x-0" : "-translate-x-full"
                }`
          }
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">構成</h2>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
              onClick={resetLayout}
            >
              レイアウトをリセット
            </button>
          </div>
          {formScenes === null ? (
            <p className={metaTextClass}>読み込み中…</p>
          ) : (
            <CueMap
              scenes={formScenes}
              characters={formCharacters}
              sceneLabels={sceneLabels}
              activeTargetId={activeTargetId}
              paneWidthPx={leftPanePx}
              onJump={jump}
            />
          )}
        </aside>

        {!wide && drawerOpen && (
          <button
            type="button"
            aria-label="構成を閉じる"
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 z-20 cursor-default bg-black/40"
          />
        )}

        {wide && (
          <PaneDivider
            ariaValue={widths.left}
            ariaMin={EDITOR_LAYOUT_MIN_LEFT_PX}
            ariaMax={EDITOR_LAYOUT_MAX_LEFT_PX}
            onMove={(deltaX) => movePane("left", deltaX)}
          />
        )}

        <div
          ref={centerRef}
          className={
            showCenter
              ? "min-h-0 min-w-0 flex-1 overflow-auto px-3"
              : "hidden min-h-0 min-w-0 flex-1 overflow-auto px-3"
          }
        >
          {current.isLoading && <p>台本を読み込み中…</p>}
          {current.isError && <p className={errorTextClass}>{errorMessage(current.error)}</p>}
          {editionId === undefined && <p>この作品には言語版がありません。</p>}
          {current.data && editionId !== undefined && (
            <SceneEditor
              key={editionId}
              base={current.data.content}
              editionId={editionId}
              scriptVersionId={scriptVersionId ?? current.data.id}
              onSaved={onSaved}
              onValuesChange={onValuesChange}
              onJumpToLine={onJumpToLine}
              onJumpToTarget={jump}
              onDocumentChange={onDocumentChange}
              onDirtyChange={onDirtyChange}
            />
          )}
        </div>

        {wide && (
          <PaneDivider
            ariaValue={widths.preview}
            ariaMin={EDITOR_LAYOUT_MIN_PREVIEW_PX}
            ariaMax={Math.round(maxPreviewPx)}
            onMove={(deltaX) => movePane("preview", deltaX)}
          />
        )}

        <aside
          style={wide ? { width: widths.preview } : undefined}
          className={
            !showPreview
              ? "hidden min-h-0 shrink-0 overflow-auto rounded border border-border p-2"
              : wide
                ? "min-h-0 shrink-0 overflow-auto rounded border border-border p-2"
                : "min-h-0 min-w-0 flex-1 overflow-auto rounded border border-border p-2"
          }
        >
          {current.data && editionId !== undefined && workId !== undefined && (
            <>
              <PreviewSection sceneLabels={sceneLabels} />
              <p className="px-1">
                <Link className={buttonNeutralClass} to={thumbnailsRoute(workId, editionId)}>
                  サムネイル
                </Link>
              </p>
              <RenderSection
                workId={workId}
                scriptVersionId={scriptVersionId ?? current.data.id}
                downloadName={renderDownloadName(workTitle, current.data.versionNumber)}
              />
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
