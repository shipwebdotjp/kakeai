/**
 * Empty text removes an optional contract field. Keeping the key with
 * `undefined` works for JSON but makes in-memory snapshots inconsistent, so the
 * editors delete it instead.
 */
export function setOptionalText<T>(value: T, key: string, text: string): T {
  const next = { ...(value as Record<string, unknown>) };
  if (text === "") {
    delete next[key];
  } else {
    next[key] = text;
  }
  return next as T;
}
