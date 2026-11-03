/** 半角換算の幅における全角1文字分の単位。 */
export const UNITS_PER_FULLWIDTH_CHAR = 2;

export interface TextWidthCounter {
  textWidthUnits: (text: string) => number;
}

/**
 * テキストの幅を半角換算の単位で数える実装を生成する。
 *
 * この関数は自己完結しており、`toString()` でレンダー HTML のインライン
 * スクリプトへ埋め込める。ブラウザ側の字幕折り返しと、Node 側の警告見積もりが
 * 同じ文字幅判定を使うための唯一の実装とする。
 *
 * 全角（CJK・全角形・絵文字・主な記号）は UNITS_PER_FULLWIDTH_CHAR、
 * ASCII・半角カナなどは1、結合文字・制御文字など幅を持たない主な文字は0と
 * する。英語は1文字あたり約0.47emのため、半角1単位=0.5emとして約7%保守的に
 * 見積もられる。表にない全角文字は半角として数えるため、失敗方向は警告の
 * 出し忘れ（過小評価）側である。
 */
export function createTextWidthCounter(): TextWidthCounter {
  // Must stay inside the factory: the exported constant above is not visible
  // once this function is serialized into the render HTML with `toString()`.
  const unitsPerFullwidthChar = 2;

  function isZeroWidthCodePoint(code: number): boolean {
    if (code <= 0x001f || (code >= 0x007f && code <= 0x009f)) {
      return true;
    }
    if (code === 0x00ad || code === 0xfeff) {
      return true;
    }
    if (code >= 0x200b && code <= 0x200f) {
      return true;
    }
    if (
      (code >= 0x0300 && code <= 0x036f) ||
      (code >= 0x1ab0 && code <= 0x1aff) ||
      (code >= 0x1dc0 && code <= 0x1dff) ||
      (code >= 0x20d0 && code <= 0x20ff) ||
      (code >= 0xfe00 && code <= 0xfe0f) ||
      (code >= 0xe0100 && code <= 0xe01ef)
    ) {
      return true;
    }
    return false;
  }

  function isFullwidthCodePoint(code: number): boolean {
    if (code === 0x231a || code === 0x231b) {
      return true;
    }
    if (code >= 0x23e9 && code <= 0x23f3) {
      return true;
    }
    if (code >= 0x2600 && code <= 0x27bf) {
      return true;
    }
    if (code >= 0x2b00 && code <= 0x2bff) {
      return true;
    }
    return (
      code >= 0x1100 &&
      (code <= 0x115f ||
        code === 0x2329 ||
        code === 0x232a ||
        (code >= 0x2e80 && code <= 0x303e) ||
        (code >= 0x3041 && code <= 0x33ff) ||
        (code >= 0x3400 && code <= 0x4dbf) ||
        (code >= 0x4e00 && code <= 0xa4cf) ||
        (code >= 0xa960 && code <= 0xa97c) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xd7b0 && code <= 0xd7c6) ||
        (code >= 0xd7cb && code <= 0xd7fb) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe10 && code <= 0xfe19) ||
        (code >= 0xfe30 && code <= 0xfe6f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6) ||
        (code >= 0x1b000 && code <= 0x1b001) ||
        (code >= 0x1f000 && code <= 0x1faff) ||
        (code >= 0x20000 && code <= 0x3fffd))
    );
  }

  function textWidthUnits(text: string): number {
    let width = 0;
    for (const char of text) {
      const code = char.codePointAt(0);
      if (code === undefined) {
        continue;
      }
      if (isZeroWidthCodePoint(code)) {
        continue;
      }
      width += isFullwidthCodePoint(code) ? unitsPerFullwidthChar : 1;
    }
    return width;
  }

  return { textWidthUnits };
}

const defaultCounter = createTextWidthCounter();

/** 共有インスタンスの文字幅カウンタ。 */
export const textWidthUnits = defaultCounter.textWidthUnits;
