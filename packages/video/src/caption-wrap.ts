import { createTextWidthCounter } from "@kakeai/contracts";

/**
 * 焼き込み字幕の自動折り返しコア。
 *
 * ここで決めるのは「どの境界で折るか」だけであり、`captionText` や SRT には
 * 一切書き戻さない。実幅の測定は呼び出し側（レンダー HTML のブラウザ実行時 /
 * 単体テストの偽測定）から `measure` として渡す。
 *
 * `createCaptionWrapCore` は自己完結した関数で、`toString()` によりレンダー
 * HTML のインラインスクリプトへ埋め込める。ブラウザとテストが同じ候補生成・
 * 禁則・選択規則を使うための唯一の実装とする。
 */

export interface CaptionWrapLimits {
  /** 1行に保つ上限の幅（半角単位）。全角28文字相当なら56。 */
  wrapUnitsPerLine: number;
  /** 出力形式が許す最大行数（横型2・縦型3）。 */
  maxLines: number;
}

/**
 * 複数の行幅を一度に測る。DOM では1回のレイアウトでまとめて読むために、
 * 単行ずつではなく配列で受け取る。
 */
export type CaptionMeasureBatch = (lines: readonly string[]) => readonly number[];

export interface CaptionParagraphWrapOptions {
  limits: CaptionWrapLimits;
  /** 1行の表示可能幅（CSS px）。 */
  maxWidthPx: number;
  measure: CaptionMeasureBatch;
}

export interface CaptionParagraphWrapResult {
  /** 段落を自動改行した結果。明示改行は含まない。 */
  lines: string[];
  /** 禁則を満たし幅に収まる候補がなく、改行せずに返した。 */
  overflow: boolean;
}

export interface CaptionWrapResult {
  /** 明示改行を保持した、焼き込み用の最終行。 */
  lines: string[];
  /** 少なくとも1段落が改行なしのはみ出しになった。 */
  overflow: boolean;
}

export interface CaptionWrapCore {
  splitExplicitLines(text: string): string[];
  segmentGraphemes(text: string): string[];
  isHeadForbidden(cluster: string): boolean;
  isTailForbidden(cluster: string): boolean;
  candidateBoundaries(clusters: readonly string[]): number[];
  planParagraph(text: string, options: CaptionParagraphWrapOptions): CaptionParagraphWrapResult;
  plan(text: string, options: CaptionParagraphWrapOptions): CaptionWrapResult;
}

interface SizedCandidate {
  lines: string[];
  widths: number[];
  /** 段落先頭からの折り返し位置（書記素クラスタ数）。 */
  cuts: number[];
  /** 境界の列挙順。同点時に先に現れる境界を選ぶために使う。 */
  order: number;
}

export function createCaptionWrapCore(
  widthUnits: (text: string) => number,
): CaptionWrapCore {
  /**
   * 行頭に置かない文字（JIS X 4051 の行頭禁則に相当する実用集合）。
   * 句読点、閉じ括弧・閉じ引用符、終端記号、長音、小書き仮名、繰り返し記号。
   */
  const HEAD_FORBIDDEN =
    "、。，．,｡.!?！？:;：；)）]］}｝〕〉》」』】〙〗〟｣'\"”’»…‥・ー〜～" +
    "ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ々ゝゞヽヾ゛゜";
  /** 行末に置かない文字（開き括弧・開き引用符）。 */
  const TAIL_FORBIDDEN = "([｢（［｛〔〈《「『【〘〖〝'\"“‘«";
  /** 幅の比較で許す丸め誤差（CSS px）。 */
  const WIDTH_EPSILON_PX = 0.5;
  /** 3行の全候補列挙に切り替える上限。これを超える長文は貪欲に分割する。 */
  const MAX_EXHAUSTIVE_BOUNDARIES = 80;

  const WORD_START = /^[0-9A-Za-z'’]/;
  const DIGIT_START = /^[0-9]/;
  const NUMBER_PUNCTUATION = /^[.,]/;

  let graphemeSegmenter: unknown;

  function splitExplicitLines(text: string): string[] {
    return text.replace(/\r\n?/g, "\n").split("\n");
  }

  function segmentGraphemes(text: string): string[] {
    if (graphemeSegmenter === undefined) {
      const IntlAny = Intl as unknown as {
        Segmenter?: new (
          locales?: string,
          options?: { granularity: string },
        ) => { segment(input: string): Iterable<{ segment: string }> };
      };
      graphemeSegmenter =
        typeof Intl !== "undefined" && IntlAny.Segmenter !== undefined
          ? new IntlAny.Segmenter(undefined, { granularity: "grapheme" })
          : null;
    }
    if (graphemeSegmenter === null) {
      return Array.from(text);
    }
    const segmenter = graphemeSegmenter as {
      segment(input: string): Iterable<{ segment: string }>;
    };
    const clusters: string[] = [];
    for (const part of segmenter.segment(text)) {
      clusters.push(part.segment);
    }
    return clusters;
  }

  function isHeadForbidden(cluster: string): boolean {
    const first = cluster[0];
    return first !== undefined && HEAD_FORBIDDEN.indexOf(first) >= 0;
  }

  function isTailForbidden(cluster: string): boolean {
    const last = cluster[cluster.length - 1];
    return last !== undefined && TAIL_FORBIDDEN.indexOf(last) >= 0;
  }

  function isWordCluster(cluster: string): boolean {
    return WORD_START.test(cluster);
  }

  function isDigitCluster(cluster: string): boolean {
    return DIGIT_START.test(cluster);
  }

  function isNumberPunctuation(cluster: string): boolean {
    return NUMBER_PUNCTUATION.test(cluster);
  }

  /** `index` は clusters[index - 1] と clusters[index] の間の境界。 */
  function boundaryAllowed(clusters: readonly string[], index: number): boolean {
    const prev = clusters[index - 1];
    const next = clusters[index];
    if (prev === undefined || next === undefined) {
      return false;
    }
    if (isHeadForbidden(next) || isTailForbidden(prev)) {
      return false;
    }
    // Break after a space, not before it: the next line should not start with
    // a dangling space after trimming.
    if (/^\s/.test(next)) {
      return false;
    }
    if (isWordCluster(prev) && isWordCluster(next)) {
      return false;
    }
    const nextNext = clusters[index + 1];
    if (
      isDigitCluster(prev) &&
      isNumberPunctuation(next) &&
      nextNext !== undefined &&
      isDigitCluster(nextNext)
    ) {
      return false;
    }
    const prevPrev = clusters[index - 2];
    if (
      isDigitCluster(next) &&
      isNumberPunctuation(prev) &&
      prevPrev !== undefined &&
      isDigitCluster(prevPrev)
    ) {
      return false;
    }
    return true;
  }

  function candidateBoundaries(clusters: readonly string[]): number[] {
    const boundaries: number[] = [];
    for (let index = 1; index < clusters.length; index += 1) {
      if (boundaryAllowed(clusters, index)) {
        boundaries.push(index);
      }
    }
    return boundaries;
  }

  function sliceLine(clusters: readonly string[], start: number, end: number): string {
    return clusters.slice(start, end).join("").trim();
  }

  function measureCandidates(
    candidates: SizedCandidate[],
    measure: CaptionMeasureBatch,
  ): SizedCandidate[] {
    if (candidates.length === 0) {
      return [];
    }
    const uniqueLines: string[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      for (const line of candidate.lines) {
        if (!seen.has(line)) {
          seen.add(line);
          uniqueLines.push(line);
        }
      }
    }
    const widths = measure(uniqueLines);
    // A mismatched measurement means the caller could not measure this batch.
    // Treat every line as too wide so the paragraph stays unbroken instead of
    // silently passing a zero width through the fit check.
    const measured = Array.isArray(widths) && widths.length === uniqueLines.length;
    const widthByLine = new Map<string, number>();
    uniqueLines.forEach((line, index) => {
      const width = measured ? widths[index] : Number.POSITIVE_INFINITY;
      widthByLine.set(
        line,
        typeof width === "number" && Number.isFinite(width)
          ? width
          : Number.POSITIVE_INFINITY,
      );
    });
    return candidates.map((candidate) => ({
      ...candidate,
      widths: candidate.lines.map(
        (line) => widthByLine.get(line) ?? Number.POSITIVE_INFINITY,
      ),
    }));
  }

  function fits(candidate: SizedCandidate, maxWidthPx: number): boolean {
    return candidate.widths.every((width) => width <= maxWidthPx + WIDTH_EPSILON_PX);
  }

  function compareCandidates(a: SizedCandidate, b: SizedCandidate): number {
    let aMin = Infinity;
    let aMax = 0;
    for (const width of a.widths) {
      aMin = Math.min(aMin, width);
      aMax = Math.max(aMax, width);
    }
    let bMin = Infinity;
    let bMax = 0;
    for (const width of b.widths) {
      bMin = Math.min(bMin, width);
      bMax = Math.max(bMax, width);
    }
    // 1. 行幅の最大値と最小値の差が最小。
    if (aMax - aMin !== bMax - bMin) {
      return aMax - aMin - (bMax - bMin);
    }
    // 2. 同点なら最大行幅が小さい。
    if (aMax !== bMax) {
      return aMax - bMax;
    }
    // 3. 前の行が後ろの行より長くなりすぎない。
    const aFirst = a.widths[0] ?? 0;
    const bFirst = b.widths[0] ?? 0;
    if (aFirst !== bFirst) {
      return aFirst - bFirst;
    }
    // 4. 先に現れる境界。結果を決定的にする。
    return a.order - b.order;
  }

  function selectBest(candidates: SizedCandidate[]): SizedCandidate {
    let best = candidates[0]!;
    for (let index = 1; index < candidates.length; index += 1) {
      const candidate = candidates[index]!;
      if (compareCandidates(candidate, best) < 0) {
        best = candidate;
      }
    }
    return best;
  }

  function twoLineCandidates(
    clusters: readonly string[],
    boundaries: readonly number[],
  ): SizedCandidate[] {
    const candidates: SizedCandidate[] = [];
    boundaries.forEach((cut, order) => {
      const left = sliceLine(clusters, 0, cut);
      const right = sliceLine(clusters, cut, clusters.length);
      if (left.length > 0 && right.length > 0) {
        candidates.push({ lines: [left, right], widths: [], cuts: [cut], order });
      }
    });
    return candidates;
  }

  function threeLineCandidates(
    clusters: readonly string[],
    boundaries: readonly number[],
  ): SizedCandidate[] {
    const candidates: SizedCandidate[] = [];
    let order = 0;
    for (let first = 0; first < boundaries.length; first += 1) {
      const cut1 = boundaries[first]!;
      for (let second = first + 1; second < boundaries.length; second += 1) {
        const cut2 = boundaries[second]!;
        const lines = [
          sliceLine(clusters, 0, cut1),
          sliceLine(clusters, cut1, cut2),
          sliceLine(clusters, cut2, clusters.length),
        ];
        if (lines.every((line) => line.length > 0)) {
          candidates.push({ lines, widths: [], cuts: [cut1, cut2], order });
          order += 1;
        }
      }
    }
    return candidates;
  }

  /**
   * 境界が多い長文用。最良の2行候補（幅に収まらなくてもよい）を基準に、
   * 最も広い行だけを2つへ割り、3行候補を測る。全列挙の計算量を避ける。
   */
  function greedyThreeLineCandidates(
    clusters: readonly string[],
    boundaries: readonly number[],
    twoLine: SizedCandidate[],
  ): SizedCandidate[] {
    if (twoLine.length === 0) {
      return [];
    }
    let base = twoLine[0]!;
    for (const candidate of twoLine) {
      if (compareCandidates(candidate, base) < 0) {
        base = candidate;
      }
    }
    const cut = base.cuts[0];
    if (cut === undefined) {
      return [];
    }
    const left = base.lines[0] ?? "";
    const right = base.lines[1] ?? "";
    const candidates: SizedCandidate[] = [];
    const ranges = [
      { start: 0, end: cut, width: base.widths[0] ?? 0 },
      { start: cut, end: clusters.length, width: base.widths[1] ?? 0 },
    ].sort((a, b) => b.width - a.width);
    for (const range of ranges) {
      const within = boundaries.filter(
        (value) => value > range.start && value < range.end,
      );
      within.forEach((value) => {
        const lines =
          range.start === 0
            ? [sliceLine(clusters, 0, value), sliceLine(clusters, value, cut), right]
            : [left, sliceLine(clusters, cut, value), sliceLine(clusters, value, clusters.length)];
        if (lines.every((line) => line.length > 0)) {
          const cuts = value < cut ? [value, cut] : [cut, value];
          candidates.push({ lines, widths: [], cuts, order: candidates.length });
        }
      });
    }
    return candidates;
  }

  function planParagraph(
    text: string,
    options: CaptionParagraphWrapOptions,
  ): CaptionParagraphWrapResult {
    if (text.length === 0) {
      return { lines: [""], overflow: false };
    }
    const maxWidthPx = options.maxWidthPx;
    if (!(maxWidthPx > 0)) {
      return { lines: [text], overflow: true };
    }
    const maxLines = Math.max(1, options.limits.maxLines);
    const wrapUnits = Math.max(0, options.limits.wrapUnitsPerLine);
    const single = measureCandidates(
      [{ lines: [text], widths: [], cuts: [], order: 0 }],
      options.measure,
    )[0]!;
    if (widthUnits(text) <= wrapUnits && single.widths[0]! <= maxWidthPx + WIDTH_EPSILON_PX) {
      return { lines: [text], overflow: false };
    }

    const clusters = segmentGraphemes(text);
    const boundaries = candidateBoundaries(clusters);
    if (boundaries.length === 0) {
      return { lines: [text], overflow: true };
    }

    const twoLine = measureCandidates(twoLineCandidates(clusters, boundaries), options.measure);
    const fittingTwo = twoLine.filter((candidate) => fits(candidate, maxWidthPx));
    if (fittingTwo.length > 0) {
      return { lines: selectBest(fittingTwo).lines, overflow: false };
    }
    if (maxLines < 3) {
      return { lines: [text], overflow: true };
    }

    const threeLine =
      boundaries.length <= MAX_EXHAUSTIVE_BOUNDARIES
        ? threeLineCandidates(clusters, boundaries)
        : greedyThreeLineCandidates(clusters, boundaries, twoLine);
    const fittingThree = measureCandidates(threeLine, options.measure).filter((candidate) =>
      fits(candidate, maxWidthPx),
    );
    if (fittingThree.length > 0) {
      return { lines: selectBest(fittingThree).lines, overflow: false };
    }
    return { lines: [text], overflow: true };
  }

  function plan(text: string, options: CaptionParagraphWrapOptions): CaptionWrapResult {
    const lines: string[] = [];
    let overflow = false;
    for (const paragraph of splitExplicitLines(text)) {
      if (paragraph.trim().length === 0) {
        lines.push("");
        continue;
      }
      const result = planParagraph(paragraph, options);
      lines.push(...result.lines);
      overflow = overflow || result.overflow;
    }
    return { lines, overflow };
  }

  return {
    splitExplicitLines,
    segmentGraphemes,
    isHeadForbidden,
    isTailForbidden,
    candidateBoundaries,
    planParagraph,
    plan,
  };
}

const defaultCounter = createTextWidthCounter();

export const captionWrapCore = createCaptionWrapCore(defaultCounter.textWidthUnits);
