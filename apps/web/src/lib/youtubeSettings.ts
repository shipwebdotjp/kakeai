export function utcIsoToLocalDatetimeInput(utcIso: string | null): string {
  if (utcIso === null || utcIso === "") {
    return "";
  }
  const date = new Date(utcIso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function localDatetimeInputToUtcIso(localStr: string): string | null {
  if (localStr === "") {
    return null;
  }
  const match = localStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u);
  if (!match) {
    return null;
  }
  const [, y, mo, d, h, mi, s] = match;
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? 0),
  );
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

export function insertChaptersIntoDescription(
  currentDescription: string,
  chaptersText: string,
  selectionStart?: number,
  selectionEnd?: number,
): string {
  const trimmed = chaptersText.trim();
  if (trimmed.length === 0) {
    return currentDescription;
  }

  let start = Math.max(0, Math.min(selectionStart ?? currentDescription.length, currentDescription.length));
  let end = Math.max(0, Math.min(selectionEnd ?? currentDescription.length, currentDescription.length));
  if (start > end) {
    [start, end] = [end, start];
  }

  const before = currentDescription.slice(0, start);
  const after = currentDescription.slice(end);

  const prefix = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
  const suffix = after.length > 0 && !after.startsWith("\n") ? "\n" : "";

  return before + prefix + trimmed + suffix + after;
}
