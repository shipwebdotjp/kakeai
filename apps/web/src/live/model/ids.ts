/** Local-only ids for newly added editor entities. The server accepts any non-empty id. */
export function createLiveLocalId(prefix: string): string {
  const globalCrypto = globalThis.crypto;
  if (globalCrypto !== undefined && typeof globalCrypto.randomUUID === "function") {
    return `${prefix}-${globalCrypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
