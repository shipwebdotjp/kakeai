import {
  type ContentDocument,
  type YouTubeChapterWarning,
} from "@kakeai/contracts";
import { resolveTimeline } from "./timeline";

export interface BuildYouTubeChapterListResult {
  chaptersText: string;
  warnings: YouTubeChapterWarning[];
}

function formatChapterTimestamp(startMs: number, totalDurationMs: number): string {
  const totalSeconds = Math.floor(startMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const mStr = String(minutes).padStart(2, "0");
  const sStr = String(seconds).padStart(2, "0");

  if (totalDurationMs >= 3600 * 1000) {
    const hStr = String(hours).padStart(2, "0");
    return `${hStr}:${mStr}:${sStr}`;
  }

  return `${mStr}:${sStr}`;
}

export function buildYouTubeChapterList(
  document: ContentDocument,
): BuildYouTubeChapterListResult {
  // Throws CompositionCompileError if timeline cannot be resolved
  const timeline = resolveTimeline(document);

  const includedScenes: {
    sceneId: string;
    label: string;
    startMs: number;
    durationMs: number;
  }[] = [];

  for (const placement of timeline.scenes) {
    const scene = document.scenes[placement.sceneIndex];
    if (scene === undefined) {
      continue;
    }
    // Include narration scenes (intro, point, outro). Exclude insert scenes.
    if (scene.kind === "intro" || scene.kind === "point" || scene.kind === "outro") {
      includedScenes.push({
        sceneId: scene.id,
        label: scene.label,
        startMs: placement.startMs,
        durationMs: placement.durationMs,
      });
    }
  }

  const chapterLines = includedScenes.map((item) => {
    const timestamp = formatChapterTimestamp(item.startMs, timeline.totalDurationMs);
    const safeLabel = item.label.replace(/\s+/gu, " ").trim();
    return `${timestamp} ${safeLabel}`;
  });

  const chaptersText = chapterLines.join("\n");
  const warnings: YouTubeChapterWarning[] = [];

  if (includedScenes.length < 3) {
    warnings.push({
      code: "less_than_3_chapters",
      message: "YouTubeの動画チャプター機能を利用するには最低3つ以上のチャプターが必要です。",
    });
  }

  if (includedScenes.length > 0 && includedScenes[0]?.startMs !== 0) {
    warnings.push({
      code: "first_chapter_not_zero",
      message: "最初のチャプターは00:00から開始する必要があります。",
    });
  }

  for (const item of includedScenes) {
    if (item.durationMs < 10000) {
      warnings.push({
        code: "scene_under_10_seconds",
        message: `チャプター「${item.label}」の尺が10秒未満（${(item.durationMs / 1000).toFixed(1)}秒）です。各チャプターは10秒以上必要です。`,
        sceneId: item.sceneId,
      });
    }
  }

  return {
    chaptersText,
    warnings,
  };
}
