import type { CommentEvent } from "@kakeai/contracts";

export type CommentFilterDecision = "accepted" | "review" | "blocked";

export type CommentFilterReason =
  | "url"
  | "pii"
  | "spam"
  | "ng_word"
  | "blocked_topic"
  | "too_long"
  | "rate_limited"
  | "attack";

export interface FilteredComment {
  event: CommentEvent;
  decision: CommentFilterDecision;
  reasons: CommentFilterReason[];
  /** URL, email, phone, postal code, address and SNS handle replaced for display. */
  redactedText: string;
  /** True when the author was explicitly blocked after this comment arrived. */
  blockedAuthor: boolean;
}

export interface CommentFilterConfig {
  ngWords: readonly string[];
  blockedTopics: readonly string[];
  maxLength: number;
  maxPerAuthorPerMinute: number;
}

const RATE_WINDOW_MS = 60_000;

const PREFECTURES =
  "北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県";

const URL_PATTERN =
  /(?:https?:\/\/|www\.)[^\s<>"']+|(?:bit\.ly|t\.co|goo\.gl|tinyurl\.com|is\.gd|buff\.ly|ow\.ly|x\.gd|youtu\.be|amzn\.to|discord\.gg|line\.me)\/[^\s<>"']*|[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\/[^\s<>"']*/giu;

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu;
const PHONE_PATTERN = /(?:\+81[-\s]?|0)\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}/gu;
const COMPACT_PHONE_PATTERN = /(?<!\d)0\d{9,10}(?!\d)/gu;
const POSTAL_PATTERN = /〒\s*\d{3}[-－ー]?\d{4}/gu;
const ADDRESS_PATTERN = new RegExp(
  `(?:${PREFECTURES})[^\\s、。,.!?]{0,12}?(?:市|区|町|村)[^\\s、。,.!?]{0,16}`,
  "gu",
);
const SNS_PATTERN =
  /@[A-Za-z0-9_.]{2,30}|(?:LINE|Instagram|Twitter|TikTok|Discord)\s*(?:ID|id)?\s*[:：=]\s*\S{2,40}/gu;

const ATTACK_PATTERN =
  /(?:死ね|しね|氏ね|殺す|ころす|殺して|無能|バカ(?!ンス)|馬鹿|消えろ|黙れ|きもい|キモい)/iu;

const PROMO_PATTERN =
  /(?:チャンネル登録(?:お願い|よろしく|してね)|フォローお願い|プレゼント企画|無料相談|簡単に稼|月収|副業|案件|LINE追加|DMください|お小遣い稼ぎ|投資案件|仮想通貨)/iu;

const EMOJI_ONLY_PATTERN = /^[\p{Extended_Pictographic}\p{Emoji_Component}\uFE0F\u200D\s]+$/u;
const SYMBOL_ONLY_PATTERN = /^[\p{P}\p{S}\s]+$/u;
const REPEATED_CHAR_PATTERN = /(.)\1{7,}/u;

/** NFKC + lowercase so full-width and half-width words match consistently. */
function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function normalizeTerm(value: string): string {
  return normalize(value).replace(/\s+/gu, "");
}

function hasMatch(pattern: RegExp, value: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(value);
}

function replaceAll(pattern: RegExp, value: string, replacement: string): string {
  pattern.lastIndex = 0;
  return value.replace(pattern, replacement);
}

function normalizePhones(value: string): string {
  return replaceAll(COMPACT_PHONE_PATTERN, replaceAll(PHONE_PATTERN, value, "[電話番号]"), "[電話番号]");
}

export function redactCommentText(text: string): string {
  let result = text;
  result = replaceAll(URL_PATTERN, result, "[URL]");
  result = replaceAll(EMAIL_PATTERN, result, "[メール]");
  result = normalizePhones(result);
  result = replaceAll(POSTAL_PATTERN, result, "[郵便番号]");
  result = replaceAll(ADDRESS_PATTERN, result, "[住所]");
  result = replaceAll(SNS_PATTERN, result, "[SNS]");
  return result;
}

export class CommentFilter {
  private readonly config: CommentFilterConfig;
  private readonly ngWords: string[];
  private readonly blockedTopics: Set<string>;
  private readonly blockedAuthors = new Set<string>();
  private readonly authorTimestamps = new Map<string, number[]>();

  constructor(config: CommentFilterConfig) {
    this.config = config;
    this.ngWords = config.ngWords.map(normalizeTerm).filter((word) => word.length > 0);
    this.blockedTopics = new Set(
      config.blockedTopics.map(normalizeTerm).filter((topic) => topic.length > 0),
    );
  }

  /** Adds an author to the block list and re-blocks future comments. */
  blockAuthor(author: string): void {
    const key = normalizeTerm(author);
    if (key.length > 0) {
      this.blockedAuthors.add(key);
    }
  }

  blockTopic(topic: string): void {
    const key = normalizeTerm(topic);
    if (key.length > 0) {
      this.blockedTopics.add(key);
    }
  }

  /** Re-runs the content decisions without adding a new rate-limit hit. */
  reevaluate(comment: CommentEvent): FilteredComment {
    return this.evaluate(comment, false);
  }

  filter(comment: CommentEvent): FilteredComment {
    return this.evaluate(comment, true);
  }

  private evaluate(comment: CommentEvent, countForRate: boolean): FilteredComment {
    const authorKey = normalizeTerm(comment.authorName);
    const blockedAuthor = this.blockedAuthors.has(authorKey);
    const reasons: CommentFilterReason[] = [];

    if (!blockedAuthor) {
      const text = normalize(comment.text);
      const compact = normalizeTerm(comment.text);
      if (hasMatch(URL_PATTERN, comment.text)) {
        reasons.push("url");
      }
      if (hasPii(comment.text)) {
        reasons.push("pii");
      }
      if (hasMatch(ATTACK_PATTERN, text)) {
        reasons.push("attack");
      }
      if (this.ngWords.some((word) => compact.includes(word))) {
        reasons.push("ng_word");
      }
      if ([...this.blockedTopics].some((topic) => compact.includes(topic))) {
        reasons.push("blocked_topic");
      }
      if (isSpam(comment.text)) {
        reasons.push("spam");
      }
      if (comment.text.length > this.config.maxLength) {
        reasons.push("too_long");
      }
      if (countForRate && this.isRateLimited(authorKey, comment.receivedAt)) {
        reasons.push("rate_limited");
      }
    }

    if (countForRate && !blockedAuthor) {
      this.recordAuthorComment(authorKey, comment.receivedAt);
    }

    return {
      event: comment,
      decision: blockedAuthor
        ? "blocked"
        : decide(reasons),
      reasons,
      redactedText: redactCommentText(comment.text),
      blockedAuthor,
    };
  }

  private isRateLimited(authorKey: string, receivedAt: string): boolean {
    const previous = this.recentAuthorComments(authorKey, receivedAt);
    return previous.length >= this.config.maxPerAuthorPerMinute;
  }

  private recordAuthorComment(authorKey: string, receivedAt: string): void {
    const timestamp = Date.parse(receivedAt);
    if (Number.isNaN(timestamp)) {
      return;
    }
    this.pruneAuthorTimestamps(timestamp);
    const recent = this.recentAuthorComments(authorKey, receivedAt);
    recent.push(timestamp);
    this.authorTimestamps.set(authorKey, recent);
  }

  private pruneAuthorTimestamps(referenceMs: number): void {
    if (this.authorTimestamps.size < 512) {
      return;
    }
    for (const [author, values] of this.authorTimestamps) {
      const recent = values.filter(
        (value) => referenceMs - value >= 0 && referenceMs - value < RATE_WINDOW_MS,
      );
      if (recent.length === 0) {
        this.authorTimestamps.delete(author);
      } else if (recent.length !== values.length) {
        this.authorTimestamps.set(author, recent);
      }
    }
  }

  private recentAuthorComments(authorKey: string, receivedAt: string): number[] {
    const timestamp = Date.parse(receivedAt);
    if (Number.isNaN(timestamp)) {
      return [];
    }
    const recent = (this.authorTimestamps.get(authorKey) ?? []).filter(
      (value) => timestamp - value >= 0 && timestamp - value < RATE_WINDOW_MS,
    );
    if (recent.length === 0) {
      this.authorTimestamps.delete(authorKey);
    }
    return recent;
  }
}

function decide(reasons: readonly CommentFilterReason[]): CommentFilterDecision {
  const blocked = new Set<CommentFilterReason>([
    "url",
    "pii",
    "spam",
    "ng_word",
    "blocked_topic",
    "attack",
  ]);
  if (reasons.some((reason) => blocked.has(reason))) {
    return "blocked";
  }
  return reasons.length === 0 ? "accepted" : "review";
}

function hasPii(text: string): boolean {
  URL_PATTERN.lastIndex = 0;
  return (
    hasMatch(EMAIL_PATTERN, text) ||
    hasMatch(PHONE_PATTERN, text) ||
    hasMatch(COMPACT_PHONE_PATTERN, text) ||
    hasMatch(POSTAL_PATTERN, text) ||
    hasMatch(ADDRESS_PATTERN, text) ||
    hasMatch(SNS_PATTERN, text)
  );
}

function isSpam(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (EMOJI_ONLY_PATTERN.test(trimmed) || SYMBOL_ONLY_PATTERN.test(trimmed)) {
    return true;
  }
  if (hasMatch(REPEATED_CHAR_PATTERN, trimmed)) {
    return true;
  }
  return hasMatch(PROMO_PATTERN, normalize(trimmed));
}
