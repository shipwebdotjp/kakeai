/**
 * Normalizes an optional agent identifier for storage. Surrounding whitespace
 * is removed and an empty value becomes null, so a blank handshake id and an
 * omitted id are stored the same way.
 */
export function normalizeAgentId(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
