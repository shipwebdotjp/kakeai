import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { PreviewTimeline, ScriptVersionPreview } from "@kakeai/contracts";
import { useScriptVersionPreview } from "../api/hooks";
import {
  applyMove,
  asSeekablePlayer,
  clampPreviewTime,
  frameStepSeconds,
  normalizeOutputFps,
  semanticSeekTarget,
} from "./player";
import {
  adjacentStartSeconds,
  cueStartSeconds,
  lineStartSeconds,
  sceneStartSeconds,
} from "./previewNavigation";
import {
  selectActivePreview,
  type ActivePreview,
  type DraftPreviewSlot,
} from "./useDraftPreview";

export interface PreviewActionsValue {
  playerRef: RefObject<HTMLElement | null>;
  moveToSeconds: (seconds: number) => void;
  jumpToScene: (sceneId: string) => void;
  jumpToLine: (lineId: string) => void;
  jumpToCue: (cueId: string) => void;
  stepBySeconds: (deltaSeconds: number) => void;
  frameBy: (frames: number) => void;
  togglePlay: () => void;
  moveToLine: (direction: 1 | -1) => void;
  moveToScene: (direction: 1 | -1) => void;
}

export interface SavedPreviewState {
  data: ScriptVersionPreview | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
  refetch: UseQueryResult<ScriptVersionPreview, Error>["refetch"];
}

export interface DraftPreviewView {
  error: unknown;
  isPending: boolean;
  unreflected: boolean;
  canRetry: boolean;
  retry: () => void;
}

export interface PreviewTimeValue {
  savedPreview: SavedPreviewState;
  draft: DraftPreviewView;
  active: ActivePreview | undefined;
  timeline: PreviewTimeline | undefined;
  totalSeconds: number;
  frameStepSeconds: number;
  currentTime: number;
  paused: boolean;
}

const RESTORE_TIMEOUT_MS = 5000;

const PreviewActionsContext = createContext<PreviewActionsValue | null>(null);
const PreviewTimeContext = createContext<PreviewTimeValue | null>(null);

export function usePreviewActions(): PreviewActionsValue {
  const value = useContext(PreviewActionsContext);
  if (value === null) {
    throw new Error("PreviewControllerProvider がありません");
  }
  return value;
}

export function usePreviewTime(): PreviewTimeValue {
  const value = useContext(PreviewTimeContext);
  if (value === null) {
    throw new Error("PreviewControllerProvider がありません");
  }
  return value;
}

export function PreviewControllerProvider({
  playerRef,
  scriptVersionId,
  draft,
  children,
}: {
  playerRef: RefObject<HTMLElement | null>;
  scriptVersionId: string | undefined;
  draft: DraftPreviewSlot;
  children: ReactNode;
}) {
  const savedPreview = useScriptVersionPreview(scriptVersionId);
  const active = useMemo(
    () => selectActivePreview(savedPreview.data, draft.data, draft.seq),
    [savedPreview.data, draft.data, draft.seq],
  );
  const timeline = active?.timeline;
  const identity = active?.identity ?? null;
  const [currentTime, setCurrentTime] = useState(0);
  const [paused, setPaused] = useState(true);

  const restoreRef = useRef<{ time: number; resume: boolean } | null>(null);
  const appliedIdentityRef = useRef<string | null>(null);
  const appliedElementRef = useRef<HTMLElement | null>(null);
  const prevVersionRef = useRef(scriptVersionId);

  useEffect(() => {
    setCurrentTime(0);
    setPaused(true);
    restoreRef.current = null;
  }, [scriptVersionId]);

  const latest = useRef({ timeline, currentTime, paused });
  useEffect(() => {
    latest.current = { timeline, currentTime, paused };
  });

  useEffect(() => {
    const versionChanged = prevVersionRef.current !== scriptVersionId;
    prevVersionRef.current = scriptVersionId;
    if (versionChanged || identity === null) {
      return;
    }
    const previous = appliedIdentityRef.current;
    if (previous !== null && previous !== identity) {
      const { currentTime: time, paused: isPaused } = latest.current;
      restoreRef.current = { time, resume: !isPaused };
    }
  }, [identity, scriptVersionId]);

  useEffect(() => {
    if (identity === null) {
      return;
    }
    const element = playerRef.current;
    if (element === null) {
      return;
    }
    let settled = false;
    const markApplied = () => {
      if (settled) {
        return;
      }
      settled = true;
      appliedIdentityRef.current = identity;
      appliedElementRef.current = element;
    };
    const settle = () => {
      markApplied();
      const pending = restoreRef.current;
      restoreRef.current = null;
      if (pending === null) {
        return;
      }
      const target = asSeekablePlayer(element);
      if (target === null || typeof target.seek !== "function") {
        return;
      }
      const clamped = clampPreviewTime(pending.time, timeline?.totalDurationMs ?? 0);
      target.seek(clamped);
      setCurrentTime(clamped);
      if (pending.resume) {
        Promise.resolve(target.play?.()).catch(() => {
          // playback can be rejected before the user interacts with the page
        });
        setPaused(false);
      } else {
        setPaused(true);
      }
    };
    const onReady = () => settle();
    element.addEventListener("ready", onReady);
    const fallback = setTimeout(markApplied, RESTORE_TIMEOUT_MS);
    return () => {
      element.removeEventListener("ready", onReady);
      clearTimeout(fallback);
    };
  }, [identity, playerRef, timeline]);

  useEffect(() => {
    const timer = setInterval(() => {
      const element = playerRef.current ?? null;
      if (element === null || element !== appliedElementRef.current) {
        return;
      }
      const player = asSeekablePlayer(element);
      if (player === null) {
        return;
      }
      if (typeof player.currentTime === "number" && Number.isFinite(player.currentTime)) {
        const next = player.currentTime;
        setCurrentTime((previous) => (previous === next ? previous : next));
      }
      if (typeof player.paused === "boolean") {
        const next = player.paused;
        setPaused((previous) => (previous === next ? previous : next));
      }
    }, 200);
    return () => clearInterval(timer);
  }, [playerRef, scriptVersionId]);

  const readTime = useCallback((): number => {
    const value = asSeekablePlayer(playerRef.current ?? null)?.currentTime;
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    return latest.current.currentTime;
  }, [playerRef]);

  const moveToSeconds = useCallback(
    (seconds: number) => {
      const activeTimeline = latest.current.timeline;
      if (activeTimeline === undefined) {
        return;
      }
      const clamped = clampPreviewTime(seconds, activeTimeline.totalDurationMs);
      applyMove(asSeekablePlayer(playerRef.current ?? null), clamped);
      setCurrentTime(clamped);
    },
    [playerRef],
  );

  const jumpToStartSeconds = useCallback(
    (startSeconds: number | null) => {
      const activeTimeline = latest.current.timeline;
      if (startSeconds === null || activeTimeline === undefined) {
        return;
      }
      moveToSeconds(
        semanticSeekTarget(startSeconds * 1000, activeTimeline.totalDurationMs, activeTimeline.fps),
      );
    },
    [moveToSeconds],
  );

  const jumpToScene = useCallback(
    (sceneId: string) => {
      const activeTimeline = latest.current.timeline;
      if (activeTimeline === undefined) {
        return;
      }
      jumpToStartSeconds(sceneStartSeconds(activeTimeline, sceneId));
    },
    [jumpToStartSeconds],
  );

  const jumpToLine = useCallback(
    (lineId: string) => {
      const activeTimeline = latest.current.timeline;
      if (activeTimeline === undefined) {
        return;
      }
      jumpToStartSeconds(lineStartSeconds(activeTimeline, lineId));
    },
    [jumpToStartSeconds],
  );

  const jumpToCue = useCallback(
    (cueId: string) => {
      const activeTimeline = latest.current.timeline;
      if (activeTimeline === undefined) {
        return;
      }
      jumpToStartSeconds(cueStartSeconds(activeTimeline, cueId));
    },
    [jumpToStartSeconds],
  );

  const stepBySeconds = useCallback(
    (deltaSeconds: number) => {
      moveToSeconds(readTime() + deltaSeconds);
    },
    [moveToSeconds, readTime],
  );

  const frameBy = useCallback(
    (frames: number) => {
      const activeTimeline = latest.current.timeline;
      moveToSeconds(readTime() + frames * frameStepSeconds(activeTimeline?.fps ?? 30));
    },
    [moveToSeconds, readTime],
  );

  const togglePlay = useCallback(() => {
    const target = asSeekablePlayer(playerRef.current ?? null);
    if (target === null) {
      return;
    }
    const stopped =
      typeof target.paused === "boolean" ? target.paused : latest.current.paused;
    if (stopped) {
      Promise.resolve(target.play?.()).catch(() => {
        // playback can be rejected before the user interacts with the page
      });
      setPaused(false);
    } else {
      target.pause?.();
      setPaused(true);
    }
  }, [playerRef]);

  const moveToLine = useCallback(
    (direction: 1 | -1) => {
      const activeTimeline = latest.current.timeline;
      if (activeTimeline === undefined) {
        return;
      }
      jumpToStartSeconds(adjacentStartSeconds(activeTimeline, readTime(), "line", direction));
    },
    [jumpToStartSeconds, readTime],
  );

  const moveToScene = useCallback(
    (direction: 1 | -1) => {
      const activeTimeline = latest.current.timeline;
      if (activeTimeline === undefined) {
        return;
      }
      jumpToStartSeconds(adjacentStartSeconds(activeTimeline, readTime(), "scene", direction));
    },
    [jumpToStartSeconds, readTime],
  );

  const actions = useMemo<PreviewActionsValue>(
    () => ({
      playerRef,
      moveToSeconds,
      jumpToScene,
      jumpToLine,
      jumpToCue,
      stepBySeconds,
      frameBy,
      togglePlay,
      moveToLine,
      moveToScene,
    }),
    [
      playerRef,
      moveToSeconds,
      jumpToScene,
      jumpToLine,
      jumpToCue,
      stepBySeconds,
      frameBy,
      togglePlay,
      moveToLine,
      moveToScene,
    ],
  );

  const totalMs = timeline?.totalDurationMs ?? 0;
  const fps = normalizeOutputFps(timeline?.fps);
  const savedState = useMemo<SavedPreviewState>(
    () => ({
      data: savedPreview.data,
      isLoading: savedPreview.isLoading,
      isFetching: savedPreview.isFetching,
      isError: savedPreview.isError,
      error: savedPreview.error,
      refetch: savedPreview.refetch,
    }),
    [
      savedPreview.data,
      savedPreview.isLoading,
      savedPreview.isFetching,
      savedPreview.isError,
      savedPreview.error,
      savedPreview.refetch,
    ],
  );
  const draftView = useMemo<DraftPreviewView>(
    () => ({
      error: draft.error,
      isPending: draft.isPending,
      unreflected: draft.unreflected,
      canRetry: draft.canRetry,
      retry: draft.retry,
    }),
    [draft.error, draft.isPending, draft.unreflected, draft.canRetry, draft.retry],
  );
  const time = useMemo<PreviewTimeValue>(
    () => ({
      savedPreview: savedState,
      draft: draftView,
      active,
      timeline,
      totalSeconds: totalMs / 1000,
      frameStepSeconds: frameStepSeconds(fps),
      currentTime,
      paused,
    }),
    [savedState, draftView, active, timeline, totalMs, fps, currentTime, paused],
  );

  return (
    <PreviewActionsContext.Provider value={actions}>
      <PreviewTimeContext.Provider value={time}>{children}</PreviewTimeContext.Provider>
    </PreviewActionsContext.Provider>
  );
}
