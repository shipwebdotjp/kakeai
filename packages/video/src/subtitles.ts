import { type ContentDocument } from "@kakeai/contracts";
import { resolveTimeline } from "./timeline";

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

export function formatSrtTimestamp(totalMs: number): string {
  const clamped = Number.isFinite(totalMs) ? Math.max(0, Math.floor(totalMs)) : 0;
  const milliseconds = clamped % 1000;
  const totalSeconds = Math.floor(clamped / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(milliseconds, 3)}`;
}

function normalizeCaptionText(text: string): string {
  const unified = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return unified
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join("\n");
}

export function buildSrt(document: ContentDocument): string {
  const captions = new Map<string, string>();
  for (const scene of document.scenes) {
    for (const line of scene.lines) {
      captions.set(line.id, line.captionText);
    }
  }
  const cues: string[] = [];
  for (const placement of resolveTimeline(document).scenes) {
    for (const line of placement.lines) {
      if (line.endMs <= line.startMs) {
        continue;
      }
      const text = normalizeCaptionText(captions.get(line.lineId) ?? "");
      if (text === "") {
        continue;
      }
      cues.push(
        `${cues.length + 1}\n${formatSrtTimestamp(line.startMs)} --> ${formatSrtTimestamp(line.endMs)}\n${text}`,
      );
    }
  }
  return cues.length === 0 ? "" : `${cues.join("\n\n")}\n`;
}
