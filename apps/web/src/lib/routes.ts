export const CHARACTERS_ROUTE_PATH = "/works/:workId/characters";
export const VOICE_PROFILES_ROUTE_PATH = "/voice-profiles";

export function workRoute(workId: string): string {
  return `/works/${encodeURIComponent(workId)}`;
}

export function charactersRoute(workId: string): string {
  return `${workRoute(workId)}/characters`;
}
