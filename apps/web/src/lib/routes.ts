export const CHARACTER_LIBRARY_ROUTE_PATH = "/characters";
export const COMPOSITION_LIBRARY_ROUTE_PATH = "/compositions";
export const FACE_SETS_ROUTE_PATH = "/face-sets";
export const VOICE_PROFILES_ROUTE_PATH = "/voice-profiles";
export const THEMES_ROUTE_PATH = "/themes";
export const LIVE_PROGRAMS_ROUTE_PATH = "/live-programs";
export const LIVE_FORMATS_ROUTE_PATH = "/live-formats";
export const LIVE_RUNS_ROUTE_PATH = "/live-runs";

export function workRoute(workId: string): string {
  return `/works/${encodeURIComponent(workId)}`;
}

export function workEditionRoute(workId: string, editionId: string): string {
  return `/works/${encodeURIComponent(workId)}/editions/${encodeURIComponent(editionId)}`;
}

export function thumbnailsRoute(workId: string, editionId: string): string {
  return `/works/${encodeURIComponent(workId)}/editions/${encodeURIComponent(editionId)}/thumbnails`;
}

export function youtubeSettingsRoute(workId: string, editionId: string): string {
  return `/works/${encodeURIComponent(workId)}/editions/${encodeURIComponent(editionId)}/youtube-settings`;
}

export function themeDetailRoute(themeId: string): string {
  return `/themes/${encodeURIComponent(themeId)}`;
}

export function liveProgramsRoute(): string {
  return LIVE_PROGRAMS_ROUTE_PATH;
}

export function liveProgramNewRoute(): string {
  return `${LIVE_PROGRAMS_ROUTE_PATH}/new`;
}

export function liveProgramRoute(programId: string): string {
  return `${LIVE_PROGRAMS_ROUTE_PATH}/${encodeURIComponent(programId)}`;
}

export function liveFormatsRoute(): string {
  return LIVE_FORMATS_ROUTE_PATH;
}

export function liveFormatNewRoute(): string {
  return `${LIVE_FORMATS_ROUTE_PATH}/new`;
}

export function liveFormatRoute(formatId: string): string {
  return `${LIVE_FORMATS_ROUTE_PATH}/${encodeURIComponent(formatId)}`;
}

export function liveRunsRoute(): string {
  return LIVE_RUNS_ROUTE_PATH;
}

export function liveRunNewRoute(query?: {
  programId?: string;
  programVersionId?: string;
  /** `export` opens the package-export-only flow on the same page. */
  mode?: "export";
}): string {
  const params = new URLSearchParams();
  if (query?.programId !== undefined) {
    params.set("programId", query.programId);
  }
  if (query?.programVersionId !== undefined) {
    params.set("programVersionId", query.programVersionId);
  }
  if (query?.mode !== undefined) {
    params.set("mode", query.mode);
  }
  const suffix = params.toString();
  return `${LIVE_RUNS_ROUTE_PATH}/new${suffix.length === 0 ? "" : `?${suffix}`}`;
}
