export const CHARACTER_LIBRARY_ROUTE_PATH = "/characters";
export const COMPOSITION_LIBRARY_ROUTE_PATH = "/compositions";
export const FACE_SETS_ROUTE_PATH = "/face-sets";
export const VOICE_PROFILES_ROUTE_PATH = "/voice-profiles";
export const THEMES_ROUTE_PATH = "/themes";

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
