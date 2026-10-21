import { z } from "zod";

/**
 * Inline marks available in a rich text value. Delimiters are ASCII symbols
 * chosen to avoid collisions with Japanese punctuation and prose:
 *
 * - `**bold**`
 * - `*italic*`
 * - `==accent==`
 * - `%%outline%%`
 *
 * `\` escapes the next markup character (`*`, `=`, `%`, `\`). Before any other
 * character it stays a literal backslash. Marks may nest in any order and are
 * applied as independent attributes. A delimiter that does not form a pair is
 * rendered literally, so stray symbols never block saving.
 */
export const RICH_TEXT_MARKS = ["bold", "italic", "accent", "outline"] as const;
export const richTextMarkSchema = z.enum(RICH_TEXT_MARKS);
export type RichTextMark = z.infer<typeof richTextMarkSchema>;

export const RICH_TEXT_DELIMITERS: readonly { mark: RichTextMark; token: string }[] = [
  { mark: "bold", token: "**" },
  { mark: "accent", token: "==" },
  { mark: "outline", token: "%%" },
  { mark: "italic", token: "*" },
];

const ESCAPABLE = new Set(["\\", "*", "=", "%"]);

export type RichTextErrorCode = "unsupported_mark";

export interface RichTextParseError {
  code: RichTextErrorCode;
  offset: number;
  mark: RichTextMark;
  message: string;
}

export interface RichTextSpan {
  /** Unescaped source text. Callers must escape it before emitting markup. */
  text: string;
  /** Applied marks in canonical order. */
  marks: readonly RichTextMark[];
}

export interface RichTextParseResult {
  spans: RichTextSpan[];
  errors: RichTextParseError[];
  /** Marks that actually decorate text, in canonical order. */
  usedMarks: RichTextMark[];
}

export interface RichTextParseOptions {
  /** Marks the owning field accepts. Omitted means all marks are accepted. */
  allowedMarks?: readonly RichTextMark[];
}

interface TextToken {
  kind: "text";
  text: string;
}

interface MarkToken {
  kind: "mark";
  mark: RichTextMark;
  token: string;
}

type Token = TextToken | MarkToken;

function canonicalMarks(marks: readonly RichTextMark[]): RichTextMark[] {
  return RICH_TEXT_MARKS.filter((mark) => marks.includes(mark));
}

function sameMarks(a: readonly RichTextMark[], b: readonly RichTextMark[]): boolean {
  return a.length === b.length && a.every((mark, index) => mark === b[index]);
}

function tokenize(text: string, allowedMarks: readonly RichTextMark[] | undefined): {
  tokens: Token[];
  errors: RichTextParseError[];
} {
  const tokens: Token[] = [];
  const errors: RichTextParseError[] = [];
  const reported = new Set<RichTextMark>();
  let buffer = "";
  const flush = (): void => {
    if (buffer.length > 0) {
      tokens.push({ kind: "text", text: buffer });
      buffer = "";
    }
  };

  let index = 0;
  while (index < text.length) {
    const character = text[index]!;
    if (character === "\\") {
      const escaped = text[index + 1];
      if (escaped !== undefined && ESCAPABLE.has(escaped)) {
        buffer += escaped;
        index += 2;
      } else {
        buffer += "\\";
        index += 1;
      }
      continue;
    }
    const delimiter = RICH_TEXT_DELIMITERS.find((candidate) =>
      text.startsWith(candidate.token, index),
    );
    if (delimiter === undefined) {
      buffer += character;
      index += 1;
      continue;
    }
    if (allowedMarks !== undefined && !allowedMarks.includes(delimiter.mark)) {
      if (!reported.has(delimiter.mark)) {
        reported.add(delimiter.mark);
        errors.push({
          code: "unsupported_mark",
          offset: index,
          mark: delimiter.mark,
          message: `この項目では「${delimiter.token}」による装飾を使えません。`,
        });
      }
      buffer += delimiter.token;
      index += delimiter.token.length;
      continue;
    }
    flush();
    tokens.push({
      kind: "mark",
      mark: delimiter.mark,
      token: delimiter.token,
    });
    index += delimiter.token.length;
  }
  flush();
  return { tokens, errors };
}

/**
 * Pairs the delimiter tokens of each mark in order. Leftover tokens are kept
 * as literal text, so an unmatched `**` or `==` never blocks validation.
 */
function pairedTokenPositions(tokens: readonly Token[]): Set<number> {
  const positions = new Map<RichTextMark, number[]>();
  tokens.forEach((token, position) => {
    if (token.kind === "mark") {
      const list = positions.get(token.mark);
      if (list === undefined) {
        positions.set(token.mark, [position]);
      } else {
        list.push(position);
      }
    }
  });
  const paired = new Set<number>();
  for (const list of positions.values()) {
    const usable = list.length - (list.length % 2);
    for (let index = 0; index < usable; index += 1) {
      paired.add(list[index]!);
    }
  }
  return paired;
}

export function parseRichText(
  text: string,
  options: RichTextParseOptions = {},
): RichTextParseResult {
  const { tokens, errors } = tokenize(text, options.allowedMarks);
  const paired = pairedTokenPositions(tokens);
  const spans: RichTextSpan[] = [];
  const active = new Set<RichTextMark>();

  const append = (piece: string): void => {
    if (piece.length === 0) {
      return;
    }
    const marks = canonicalMarks([...active]);
    const previous = spans[spans.length - 1];
    if (previous !== undefined && sameMarks(previous.marks, marks)) {
      spans[spans.length - 1] = { text: previous.text + piece, marks: previous.marks };
    } else {
      spans.push({ text: piece, marks });
    }
  };

  tokens.forEach((token, position) => {
    if (token.kind === "text") {
      append(token.text);
      return;
    }
    if (!paired.has(position)) {
      append(token.token);
      return;
    }
    if (active.has(token.mark)) {
      active.delete(token.mark);
    } else {
      active.add(token.mark);
    }
  });

  const used = new Set<RichTextMark>();
  for (const span of spans) {
    for (const mark of span.marks) {
      used.add(mark);
    }
  }
  return { spans, errors, usedMarks: canonicalMarks([...used]) };
}

/**
 * Zod schema for a text field that accepts the given inline marks. The value
 * stays a plain string, so saved documents keep `schemaVersion: 1`.
 */
export function richTextStringSchema(allowedMarks: readonly RichTextMark[]) {
  return z.string().superRefine((value, context) => {
    for (const error of parseRichText(value, { allowedMarks }).errors) {
      context.addIssue({ code: "custom", message: error.message });
    }
  });
}
