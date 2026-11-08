import { parseLiveAudioUrl } from "@kakeai/contracts";

export const RUN_AUDIO_HTTP_PREFIX = "/run/generated/";

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/**
 * Converts a contract `audioUrl` to the same-origin HTTP path the stage loads.
 * Package files stay under `/package/*`; run-generated audio uses the reserved
 * `/run/generated/*` route so it can never be confused with package content.
 */
export function audioUrlForStage(audioUrl: string): string {
  const parsed = parseLiveAudioUrl(audioUrl);
  if (parsed === null) {
    throw new Error(`音声 URL が不正です: ${audioUrl}`);
  }
  if (parsed.kind === "run") {
    return `${RUN_AUDIO_HTTP_PREFIX}${encodeURIComponent(parsed.fileName)}`;
  }
  return `/package/${encodePath(parsed.path)}`;
}
