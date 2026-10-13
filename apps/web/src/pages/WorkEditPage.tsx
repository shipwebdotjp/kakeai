import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useBeforeUnload, useBlocker, useParams } from "react-router-dom";
import type { UseQueryResult } from "@tanstack/react-query";
import { defaultPointLabel, getVisualTemplate, type ScriptVersion } from "@kakeai/contracts";
import { useCurrentScriptVersion, useUpdateWork, useWork } from "../api/hooks";
import { PreviewSection } from "../components/PreviewSection";
import { RenderSection } from "../components/RenderSection";
import { SceneEditor } from "../components/SceneEditor";
import { errorMessage } from "../lib/errorMessage";
import { PreviewControllerProvider, usePreviewActions } from "../lib/PreviewController";
import { useDraftPreview, type UnsavedDocumentState } from "../lib/useDraftPreview";
import type { CueFormValue, SceneFormValue } from "../content/form";
import { SCENE_LABELS, TEXT_ROLE_LABELS } from "../content/labels";
import { buttonPrimaryClass, errorTextClass, metaTextClass, textFieldClass } from "../ui";

function clampWidth(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

function cueLabel(cue: CueFormValue): string {
  const definition = getVisualTemplate(cue.templateId, cue.templateVersion);
  const base = definition?.display.label ?? cue.templateId;
  if (cue.templateId === "text.block") {
    const role = cue.fields.role;
    const roleLabel =
      role !== undefined && role in TEXT_ROLE_LABELS
        ? TEXT_ROLE_LABELS[role as keyof typeof TEXT_ROLE_LABELS]
        : undefined;
    return roleLabel === undefined ? base : `テキスト: ${roleLabel}`;
  }
  return base;
}

type PreviewSeekTarget =
  | { kind: "scene"; id: string }
  | { kind: "cue"; id: string }
  | { kind: "line"; id: string };

function LeftPane({
  scenes,
  sceneLabels,
  activeTargetId,
  onJump,
}: {
  scenes: SceneFormValue[];
  sceneLabels: ReadonlyMap<string, string>;
  activeTargetId: string | null;
  onJump: (targetId: string, seek: PreviewSeekTarget) => void;
}) {
  return (
    <nav>
      <ul className="m-0 list-none p-0">
        {scenes.map((scene) => (
          <li key={scene.id} className="mb-1.5">
            <button
              type="button"
              aria-current={activeTargetId === `scene-${scene.id}` ? "true" : undefined}
              className={
                activeTargetId === `scene-${scene.id}`
                  ? "w-full rounded bg-border/60 px-1 text-left font-semibold"
                  : "w-full text-left font-medium hover:underline"
              }
              onClick={() => onJump(`scene-${scene.id}`, { kind: "scene", id: scene.id })}
            >
              {sceneLabels.get(scene.id) ?? scene.id}
            </button>
            <ul className="m-0 ml-3 list-none p-0">
              {scene.cues.map((cue) => (
                <li key={cue.id}>
                  <button
                    type="button"
                    aria-current={activeTargetId === `cue-${cue.id}` ? "true" : undefined}
                    className={
                      activeTargetId === `cue-${cue.id}`
                        ? "w-full rounded bg-border/60 px-1 text-left text-xs font-semibold"
                        : "w-full text-left text-xs text-muted-foreground hover:underline"
                    }
                    onClick={() => onJump(`cue-${cue.id}`, { kind: "cue", id: cue.id })}
                  >
                    {cueLabel(cue)}
                  </button>
                </li>
              ))}
              {scene.lines.map((line, lineIndex) => (
                <li key={line.id}>
                  <button
                    type="button"
                    aria-current={activeTargetId === `line-${line.id}` ? "true" : undefined}
                    className={
                      activeTargetId === `line-${line.id}`
                        ? "w-full truncate rounded bg-border/60 px-1 text-left text-xs font-semibold"
                        : "w-full truncate text-left text-xs text-muted-foreground hover:underline"
                    }
                    onClick={() => onJump(`line-${line.id}`, { kind: "line", id: line.id })}
                  >
                    {lineIndex + 1}. {line.captionText.trim() || "(字幕なし)"}
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}

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

  const isDirty = sceneEditorDirty || titleDraft !== null;

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

function WorkEditPanes({
  workId,
  editionId,
  scriptVersionId,
  current,
  onSaved,
  onDocumentChange,
  onDirtyChange,
}: {
  workId: string | undefined;
  editionId: string | undefined;
  scriptVersionId: string | undefined;
  current: UseQueryResult<ScriptVersion, Error>;
  onSaved: (scriptVersion: ScriptVersion) => void;
  onDocumentChange: (state: UnsavedDocumentState) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const actions = usePreviewActions();
  const [formScenes, setFormScenes] = useState<SceneFormValue[] | null>(null);
  const [activeTargetId, setActiveTargetId] = useState<string | null>(null);
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(420);
  const centerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setFormScenes(null);
  }, [workId, editionId]);

  const onValuesChange = useCallback((scenes: SceneFormValue[]) => {
    setFormScenes(scenes);
  }, []);

  const jump = useCallback(
    (targetId: string, seek: PreviewSeekTarget) => {
      const root = centerRef.current;
      if (root !== null) {
        const element = findTarget(root, targetId);
        if (element !== null) {
          const top =
            element.getBoundingClientRect().top -
            root.getBoundingClientRect().top +
            root.scrollTop;
          root.scrollTo({ top: Math.max(0, top - stickyOffset(root)), behavior: "smooth" });
        }
      }
      if (seek.kind === "scene") {
        actions.jumpToScene(seek.id);
      } else if (seek.kind === "cue") {
        actions.jumpToCue(seek.id);
      } else {
        actions.jumpToLine(seek.id);
      }
    },
    [actions.jumpToScene, actions.jumpToCue, actions.jumpToLine],
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

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        style={{ width: leftWidth }}
        className="min-h-0 shrink-0 overflow-auto rounded border border-border p-2 text-sm"
      >
        <h2 className="mb-2 text-sm font-semibold">構成</h2>
        {formScenes === null ? (
          <p className={metaTextClass}>読み込み中…</p>
        ) : (
          <LeftPane
            scenes={formScenes}
            sceneLabels={sceneLabels}
            activeTargetId={activeTargetId}
            onJump={jump}
          />
        )}
      </aside>

      <PaneDivider
        ariaValue={leftWidth}
        ariaMin={160}
        ariaMax={420}
        onMove={(deltaX) => setLeftWidth((width) => clampWidth(width + deltaX, 160, 420))}
      />

      <div ref={centerRef} className="min-h-0 min-w-0 flex-1 overflow-auto px-3">
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

      <PaneDivider
        ariaValue={rightWidth}
        ariaMin={320}
        ariaMax={760}
        onMove={(deltaX) => setRightWidth((width) => clampWidth(width - deltaX, 320, 760))}
      />

      <aside
        style={{ width: rightWidth }}
        className="min-h-0 shrink-0 overflow-auto rounded border border-border p-2"
      >
        {current.data && editionId !== undefined && workId !== undefined && (
          <>
            <PreviewSection sceneLabels={sceneLabels} />
            <RenderSection workId={workId} scriptVersionId={scriptVersionId ?? current.data.id} />
          </>
        )}
      </aside>
    </div>
  );
}
