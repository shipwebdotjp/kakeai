export const CHARACTER_LIBRARY_ROUTE_PATH = "/characters";
export const COMPOSITION_LIBRARY_ROUTE_PATH = "/compositions";
export const VOICE_PROFILES_ROUTE_PATH = "/voice-profiles";

export function workRoute(workId: string): string {
  return `/works/${encodeURIComponent(workId)}`;
}
