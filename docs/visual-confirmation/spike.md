# 視覚確認 V2 スパイク結果

2026-10-24 実施。保存版 ScriptVersion の HTML を、レンダーなしで指定時刻の PNG にする可否と、10秒の read timeout に収まるかを確認した。

## 方法

1. `getScriptVersionPreview` で保存版の `compositionHtml` と `timeline` を取得する。
2. `@hyperframes/engine` の `acquireBrowser` で headless Chrome を起動する。
3. アプリの `/api/v1/preview-host`（空の `text/html`）へ遷移し、same-origin の media session cookie を受け取る。
4. `page.setContent` の前に、`@hyperframes/core/runtime-script` の HyperFrames runtime を HTML の `<meta charset>` 直後へ注入する。
   - composition の inline script は `window.__timelines` へ代入するため、runtime が先に `window.__timelines` を初期化している必要がある。後から `addScriptTag` すると `Cannot set properties of undefined` で timeline が登録されない。
5. runtime の `window.__player` が `getDuration() > 0` になるまで待ち、画像・フォント・動画の準備を待つ。
6. `window.__player.seek(timeSeconds)` でシークし、`<video>` の `seeked` と 2〜3 回の `requestAnimationFrame` を待って screenshot する。

`page.setContent` を `/api/v1/health`（JSON）の後に行うと、document の content type が `application/json` のままになり、inline script が実行されない。`text/html` の host ページが必要。

## 計測結果

初期台本に確認用のテキスト Cue を足した保存版で、0 / 1 / 3 / 6 秒を取得した。

| 時刻 | 時間（compile + rasterize） | PNG サイズ |
| --- | --- | --- |
| 0ms | 965ms | 326,509 bytes |
| 1000ms | 660ms | 326,509 bytes |
| 3000ms | 687ms | 326,509 bytes |
| 6000ms | 737ms | 310,139 bytes |

- 出力は 1920×1080 PNG。
- 0 / 1 / 3 秒は同じ intro シーンなので同一画像、6 秒は outro シーンで異なる画像になった。シークは反映されている。
- 1 回あたり 0.7〜1.0 秒で、通常は 10 秒の read timeout に収まる。長尺台本・多数の動画素材の worst case に備え、画像プレビュー操作だけ 30 秒の read timeout を持たせる。
- 先頭の browser launch を含む。ブラウザは呼び出しごとに起動されたが、それでも 1 秒未満だった。

## 確認できたこと

- 保存版 ScriptVersion から、レンダー Job・ScriptVersion・Artifact を作らずに PNG を取得できる。
- `getScriptVersionPreview` の HTML はそのまま使える。新しいコンパイラは不要。
- app origin に一度遷移すれば media session cookie が付き、同じ origin の素材 URL を読める。
- runtime は `<video data-start>` を `data-start` / `data-media-start` に従ってシークする。
- runtime は `data-composition-src` の入れ子 Composition を展開する（別途、親子のモック HTML で確認）。
- H.264 は headless shell で `canPlayType` が `probably` を返し、実フレームのシークも確認できた。

## 残るリスク

- 実際の Composition bundle を使った入れ子の確認は、モックではなく本物の bundle で追加確認したい。
- シェーダー遷移・CSS animation など、GSAP timeline 以外の動きはフレームによって差が出る可能性がある。プレビューは構図確認用とし、最終判断は人に残す。
- 動画素材のコーデック・可変フレームレートによっては、指定時刻と実際のフレームがずれる。`preview.frame` と同じく、見た目を確認する用途に留める。
- 同時実行は 1 本に直列化している。エージェントが短時間に大量のプレビューを要求しても、CPU を占有し続けないようにするため。

## 判断

- V2 は sync read のまま実装する。Job 化しない。
- 通常の read timeout は 10 秒のまま。画像プレビュー操作だけ 30 秒の上限を持たせる。
- キャッシュは必須ではない。必要になったら `ScriptVersion` が不変であることを利用して `(scriptVersionId, timeMs, compilerVersion)` で追加する。
