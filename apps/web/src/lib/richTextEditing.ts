import { RICH_TEXT_DELIMITERS, type RichTextMark } from "@kakeai/contracts";

/** Markup delimiter pair for each inline mark, derived from the parser contract. */
export const RICH_TEXT_DELIMITER = Object.fromEntries(
  RICH_TEXT_DELIMITERS.map(({ mark, token }) => [mark, token]),
) as Record<RichTextMark, string>;

export interface WrappedSelection {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) {
    return length;
  }
  return Math.min(length, Math.max(0, Math.trunc(index)));
}

function trailingBackslashes(text: string): number {
  let count = 0;
  for (let index = text.length - 1; index >= 0 && text[index] === "\\"; index -= 1) {
    count += 1;
  }
  return count;
}

/**
 * Wraps the given range with the delimiter pair for `mark`.
 *
 * - An empty range inserts an empty pair and leaves the caret between the
 *   delimiters.
 * - A range that is already wrapped by the same pair is unwrapped, so pressing
 *   the same toolbar button twice toggles the mark.
 * - Backslashes that would escape the inserted delimiters are doubled: a run
 *   directly before the opening delimiter and an odd trailing run inside the
 *   selection. Other escapes are left untouched.
 */
export function wrapSelection(
  value: string,
  start: number,
  end: number,
  mark: RichTextMark,
): WrappedSelection {
  const from = clampIndex(start, value.length);
  const to = clampIndex(end, value.length);
  const lower = Math.min(from, to);
  const upper = Math.max(from, to);
  const delimiter = RICH_TEXT_DELIMITER[mark];
  const openAt = lower - delimiter.length;
  const alreadyWrapped =
    upper > lower &&
    openAt >= 0 &&
    value.slice(openAt, lower) === delimiter &&
    value.slice(upper, upper + delimiter.length) === delimiter;
  if (alreadyWrapped) {
    return {
      value:
        value.slice(0, openAt) + value.slice(lower, upper) + value.slice(upper + delimiter.length),
      selectionStart: openAt,
      selectionEnd: openAt + (upper - lower),
    };
  }
  const selectedRaw = value.slice(lower, upper);
  const selected =
    trailingBackslashes(selectedRaw) % 2 === 1 ? `${selectedRaw}\\` : selectedRaw;
  const beforeRaw = value.slice(0, lower);
  const before = trailingBackslashes(beforeRaw) % 2 === 1 ? `${beforeRaw}\\` : beforeRaw;
  const after = value.slice(upper);
  const innerStart = before.length + delimiter.length;
  return {
    value: `${before}${delimiter}${selected}${delimiter}${after}`,
    selectionStart: innerStart,
    selectionEnd: innerStart + selected.length,
  };
}
