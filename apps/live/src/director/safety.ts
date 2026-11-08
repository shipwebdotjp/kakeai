import { directorOutputSchema, type DirectorOutput } from "@kakeai/contracts";
import type { DirectorContext } from "./prompt.ts";

export interface DirectorSafetyPolicy {
  maxResponseChars: number;
  maxResponseCues: number;
  blockedTopics: readonly string[];
  expressions: readonly string[];
}

export type DirectorValidationResult =
  | { ok: true; output: DirectorOutput; normalized: boolean }
  | { ok: false; reason: "invalid" | "unsafe"; message: string };

export function directorSafetyPolicyFromContext(
  context: DirectorContext,
): DirectorSafetyPolicy {
  return {
    maxResponseChars: context.maxResponseChars,
    maxResponseCues: context.maxResponseCues,
    blockedTopics: context.blockedTopics,
    expressions: context.expressions,
  };
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, "");
}

// The filter stays intentionally narrow to avoid rejecting ordinary Japanese
// commentary. The analyst has already removed most PII; this is defence in depth.
const URL_PATTERN =
  /(?:https?:\/\/|www\.)[^\s<>"']+|(?:bit\.ly|t\.co|goo\.gl|tinyurl\.com|is\.gd|buff\.ly|ow\.ly|x\.gd|youtu\.be|amzn\.to|discord\.gg|line\.me)\/[^\s<>"']*|[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\/[^\s<>"']*/iu;
const BARE_DOMAIN_PATTERN =
  /\b[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:com|jp|net|org|io|co|ly|tv|me|dev|app|info|biz|xyz)\b/iu;
const HTML_PATTERN = /<\/?[A-Za-z][^>]*>/u;
const MARKDOWN_LINK_PATTERN = /\[[^\]]*\]\([^)]*\)/u;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u;
const PHONE_PATTERN = /(?:\+81[-\s]?|0)\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}/u;
const COMPACT_PHONE_PATTERN = /(?<!\d)0\d{9,10}(?!\d)/u;
const POSTAL_PATTERN = /〒\s*\d{3}[-－ー]?\d{4}/u;
const ADDRESS_PATTERN =
  /(?:東京都|北海道|京都府|大阪府|[\u4e00-\u9faf]{2,3}県)[^\s、。,.!?]{0,12}?(?:市|区|町|村)[^\s、。,.!?]{0,16}/u;

/** Strong factual assertions that a live persona should never make. */
const ASSERTION_PATTERN = /(?:絶対(?:に)?|間違いなく|100\s*[%％]|確実に|必ず(?!しも))/u;

function containsUnsafeText(text: string, topics: readonly string[]): string | null {
  if (URL_PATTERN.test(text) || BARE_DOMAIN_PATTERN.test(text)) {
    return "URL が含まれています。";
  }
  if (HTML_PATTERN.test(text)) return "HTML タグが含まれています。";
  if (MARKDOWN_LINK_PATTERN.test(text)) return "Markdown リンクが含まれています。";
  if (EMAIL_PATTERN.test(text)) return "メールアドレスが含まれています。";
  if (PHONE_PATTERN.test(text) || COMPACT_PHONE_PATTERN.test(text)) {
    return "電話番号が含まれています。";
  }
  if (POSTAL_PATTERN.test(text) || ADDRESS_PATTERN.test(text)) {
    return "住所が含まれています。";
  }
  if (ASSERTION_PATTERN.test(text)) {
    return "強い断定表現が含まれています。";
  }
  const normalized = normalize(text);
  for (const topic of topics) {
    const needle = normalize(topic);
    if (needle.length > 0 && normalized.includes(needle)) {
      return `禁止話題が含まれています: ${topic}`;
    }
  }
  return null;
}

function safeExpression(expression: string, allowed: readonly string[]): string {
  return allowed.includes(expression) ? expression : "normal";
}

/**
 * Validates schema and safety in one pass. Expressions outside the character
 * sheet are normalized to `normal`; every other violation rejects the whole
 * output so the caller can regenerate once.
 */
export function validateDirectorOutput(
  value: unknown,
  policy: DirectorSafetyPolicy,
): DirectorValidationResult {
  const parsed = directorOutputSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid",
      message: parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join(" / "),
    };
  }
  const output = parsed.data;
  if (output.skip) {
    return { ok: true, output, normalized: false };
  }
  if (output.cues.length > policy.maxResponseCues) {
    return {
      ok: false,
      reason: "unsafe",
      message: `キュー数が上限 ${policy.maxResponseCues} を超えています。`,
    };
  }

  let normalized = false;
  const cues = output.cues.map((cue) => {
    if (cue.caption.length > policy.maxResponseChars) {
      return { cue, violation: "caption が長すぎます。" };
    }
    if (cue.speech.length > policy.maxResponseChars * 2) {
      return { cue, violation: "speech が長すぎます。" };
    }
    const captionViolation = containsUnsafeText(cue.caption, policy.blockedTopics);
    if (captionViolation !== null) {
      return { cue, violation: captionViolation };
    }
    const speechViolation = containsUnsafeText(cue.speech, policy.blockedTopics);
    if (speechViolation !== null) {
      return { cue, violation: speechViolation };
    }
    const expression = safeExpression(cue.expression, policy.expressions);
    if (expression !== cue.expression) {
      normalized = true;
    }
    return { cue: { ...cue, expression }, violation: null };
  });

  const violation = cues.find((entry) => entry.violation !== null);
  if (violation !== undefined) {
    return { ok: false, reason: "unsafe", message: violation.violation ?? "安全違反です。" };
  }
  return {
    ok: true,
    output: { ...output, cues: cues.map((entry) => entry.cue) },
    normalized,
  };
}
