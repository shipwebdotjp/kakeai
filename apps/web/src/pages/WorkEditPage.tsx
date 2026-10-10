import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { getVisualTemplate, type ScriptVersion } from "@kakeai/contracts";
import { resolveCueWindow, resolveTimeline } from "@kakeai/video/timeline";
import { useCurrentScriptVersion, useUpdateWork, useWork } from "../api/hooks";
import { PreviewSection } from "../components/PreviewSection";
import { RenderSection } from "../components/RenderSection";
import { SceneEditor } from "../components/SceneEditor";
import { errorMessage } from "../lib/errorMessage";
import type { CueFormValue, SceneFormValue } from "../content/form";
import { SCENE_LABELS, TEXT_ROLE_LABELS } from "../content/labels";
import { asSeekablePlayer, seekTo } from "../lib/player";
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

export function WorkEditPage() {
  const { workId } = useParams<{ workId: string }>();
  const work = useWork(workId);
  const editionId = work.data?.languageEditions[0]?.id;
  const current = useCurrentScriptVersion(editionId);
  const updateWork = useUpdateWork(workId);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const [formScenes, setFormScenes] = useState<SceneFormValue[] | null>(null);
  const [activeTargetId, setActiveTargetId] = useState<string | null>(null);
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(420);
  const playerRef = useRef<HTMLElement | null>(null);
  const centerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setTitleDraft(null);
    setPreviewVersionId(null);
    setFormScenes(null);
  }, [workId, editionId]);

  const onSaved = useCallback((scriptVersion: ScriptVersion) => {
    setPreviewVersionId(scriptVersion.id);
  }, []);

  const onValuesChange = useCallback((scenes: SceneFormValue[]) => {
    setFormScenes(scenes);
  }, []);

  const base = current.data?.content;
  const timeline = useMemo(() => {
    if (base === undefined) {
      return null;
    }
    try {
      return resolveTimeline(base);
    } catch {
      return null;
    }
  }, [base]);

  const sceneStartById = useMemo(
    () =>
      new Map((timeline?.scenes ?? []).map((placement) => [placement.sceneId, placement.startMs])),
    [timeline],
  );
  const lineStartById = useMemo(() => {
    const map = new Map<string, number>();
    for (const placement of timeline?.scenes ?? []) {
      for (const line of placement.lines) {
        map.set(line.lineId, line.startMs);
      }
    }
    return map;
  }, [timeline]);

  const cueSeekById = useMemo(() => {
    const map = new Map<string, number>();
    if (timeline === null || base === undefined) {
      return map;
    }
    for (const placement of timeline.scenes) {
      const scene = base.scenes[placement.sceneIndex];
      if (scene === undefined) {
        continue;
      }
      for (const cue of scene.visualCues) {
        try {
          const window = resolveCueWindow(placement, cue, []);
          if (window !== null) {
            map.set(cue.id, placement.startMs + window.startMs);
          }
        } catch {
          // unresolvable range: leave the cue out so jump only scrolls
        }
      }
    }
    return map;
  }, [timeline, base]);

  const jump = useCallback((targetId: string, seekMs: number | null) => {
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
    if (seekMs === null) {
      return;
    }
    const player = asSeekablePlayer(playerRef.current);
    const duration = player?.duration;
    if (typeof duration === "number" && duration > 0) {
      seekTo(player, seekMs / 1000);
    }
  }, []);

  const pointOrdinals = useMemo(() => {
    let count = 0;
    return (formScenes ?? []).map((scene) => {
      if (scene.kind !== "point") {
        return 0;
      }
      count += 1;
      return count;
    });
  }, [formScenes]);

  const sceneLabels = useMemo(() => {
    const map = new Map<string, string>();
    (formScenes ?? []).forEach((scene, index) => {
      const ordinal = scene.kind === "point" ? ` ${pointOrdinals[index]}` : "";
      map.set(scene.id, `${SCENE_LABELS[scene.kind] ?? scene.kind}${ordinal}`);
    });
    return map;
  }, [formScenes, pointOrdinals]);

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

  const title = titleDraft ?? work.data?.title ?? "";

  const onRename = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed.length > 0) {
      updateWork.mutate(trimmed, { onSuccess: () => setTitleDraft(null) });
    }
  };

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

      <div className="flex min-h-0 flex-1">
        <aside
          style={{ width: leftWidth }}
          className="min-h-0 shrink-0 overflow-auto rounded border border-border p-2 text-sm"
        >
          <h2 className="mb-2 text-sm font-semibold">構成</h2>
          {formScenes === null ? (
            <p className={metaTextClass}>読み込み中…</p>
          ) : (
            <nav>
              <ul className="m-0 list-none p-0">
                {formScenes.map((scene, sceneIndex) => (
                  <li key={scene.id} className="mb-1.5">
                    <button
                      type="button"
                      aria-current={activeTargetId === `scene-${scene.id}` ? "true" : undefined}
                      className={
                        activeTargetId === `scene-${scene.id}`
                          ? "w-full rounded bg-border/60 px-1 text-left font-semibold"
                          : "w-full text-left font-medium hover:underline"
                      }
                      onClick={() => jump(`scene-${scene.id}`, sceneStartById.get(scene.id) ?? null)}
                    >
                      {SCENE_LABELS[scene.kind] ?? scene.kind}
                      {scene.kind === "point" ? ` ${pointOrdinals[sceneIndex]}` : ""}
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
                            onClick={() => jump(`cue-${cue.id}`, cueSeekById.get(cue.id) ?? null)}
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
                            onClick={() =>
                              jump(`line-${line.id}`, lineStartById.get(line.id) ?? null)
                            }
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
              scriptVersionId={previewVersionId ?? current.data.id}
              onSaved={onSaved}
              onValuesChange={onValuesChange}
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
              <PreviewSection
                scriptVersionId={previewVersionId ?? current.data.id}
                playerRef={playerRef}
                sceneLabels={sceneLabels}
              />
              <RenderSection
                workId={workId}
                scriptVersionId={previewVersionId ?? current.data.id}
              />
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
