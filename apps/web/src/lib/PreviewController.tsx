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

export interface PreviewTimeValue {
  savedPreview: SavedPreviewState;
  timeline: PreviewTimeline | undefined;
  totalSeconds: number;
  frameStepSeconds: number;
  currentTime: number;
  paused: boolean;
}

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
  children,
}: {
  playerRef: RefObject<HTMLElement | null>;
  scriptVersionId: string | undefined;
  children: ReactNode;
}) {
  const savedPreview = useScriptVersionPreview(scriptVersionId);
  const timeline = savedPreview.data?.timeline;
  const [currentTime, setCurrentTime] = useState(0);
  const [paused, setPaused] = useState(true);

  useEffect(() => {
    setCurrentTime(0);
    setPaused(true);
  }, [scriptVersionId]);

  const latest = useRef({ timeline, currentTime, paused });
  useEffect(() => {
    latest.current = { timeline, currentTime, paused };
  });

  useEffect(() => {
    const timer = setInterval(() => {
      const player = asSeekablePlayer(playerRef.current ?? null);
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
      const active = latest.current.timeline;
      if (active === undefined) {
        return;
      }
      const clamped = clampPreviewTime(seconds, active.totalDurationMs);
      applyMove(asSeekablePlayer(playerRef.current ?? null), clamped);
      setCurrentTime(clamped);
    },
    [playerRef],
  );

  const jumpToStartSeconds = useCallback(
    (startSeconds: number | null) => {
      const active = latest.current.timeline;
      if (startSeconds === null || active === undefined) {
        return;
      }
      moveToSeconds(
        semanticSeekTarget(startSeconds * 1000, active.totalDurationMs, active.fps),
      );
    },
    [moveToSeconds],
  );

  const jumpToScene = useCallback(
    (sceneId: string) => {
      const active = latest.current.timeline;
      if (active === undefined) {
        return;
      }
      jumpToStartSeconds(sceneStartSeconds(active, sceneId));
    },
    [jumpToStartSeconds],
  );

  const jumpToLine = useCallback(
    (lineId: string) => {
      const active = latest.current.timeline;
      if (active === undefined) {
        return;
      }
      jumpToStartSeconds(lineStartSeconds(active, lineId));
    },
    [jumpToStartSeconds],
  );

  const jumpToCue = useCallback(
    (cueId: string) => {
      const active = latest.current.timeline;
      if (active === undefined) {
        return;
      }
      jumpToStartSeconds(cueStartSeconds(active, cueId));
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
      const active = latest.current.timeline;
      moveToSeconds(readTime() + frames * frameStepSeconds(active?.fps ?? 30));
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
      const active = latest.current.timeline;
      if (active === undefined) {
        return;
      }
      jumpToStartSeconds(adjacentStartSeconds(active, readTime(), "line", direction));
    },
    [jumpToStartSeconds, readTime],
  );

  const moveToScene = useCallback(
    (direction: 1 | -1) => {
      const active = latest.current.timeline;
      if (active === undefined) {
        return;
      }
      jumpToStartSeconds(adjacentStartSeconds(active, readTime(), "scene", direction));
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
  const time = useMemo<PreviewTimeValue>(
    () => ({
      savedPreview: savedState,
      timeline,
      totalSeconds: totalMs / 1000,
      frameStepSeconds: frameStepSeconds(fps),
      currentTime,
      paused,
    }),
    [savedState, timeline, totalMs, fps, currentTime, paused],
  );

  return (
    <PreviewActionsContext.Provider value={actions}>
      <PreviewTimeContext.Provider value={time}>{children}</PreviewTimeContext.Provider>
    </PreviewActionsContext.Provider>
  );
}
