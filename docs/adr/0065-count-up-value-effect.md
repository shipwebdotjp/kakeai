# 数値のカウント（count-up）は有限の value 効果とし、コンパイラが値のトゥイーンを生成する

Cue効果の語彙に、区間中で数値が進行する **`value`（count-up）** を追加する。`value` は `appear`・`emphasize` と並ぶ効果の一種で、`from`（既定0）から対象の値へ、Trigger区間（または `durationMs`）で数える。対象は数値を持つテンプレートに限り、`table.simple`（数値セル）・`chart.bar`（値ラベル）・`stat@1`（数値）で使う。値の表示はコンパイラが生成するプロキシオブジェクトの `fromTo`（`onUpdate` で `Intl.NumberFormat` によりテキストを更新）で行い、正本には数値・書式名・尺だけを保存する。

## Considered Options

- 正本に数値の各フレームや最終テキストを書き込む。→ 尺や値の変更で破綻し、正本が派生物で膨らむため不採用。
- 対象要素のテキストを CSS カウンタで進める。→ 書式（桁区切り・通貨・パーセント）を再現できず、ブラウザ差も大きいため不採用。
- 任意の onUpdate スクリプトをテンプレート入力に持たせる。→ 正本へスクリプトを持ち込む方針（[ADR-0031](./0031-cue-transition-and-animation-ownership.md)）に反するため不採用。
- `emphasize` の拡張で表す。→ 「区間中ずっと続く状態」ではなく「区間で進行する値」であり、`stateIntervals`（`tl.set`）では表現できないため不採用。

## Consequences

- `valueEffectSchema`（`from?`・`durationMs?`）と `numericEffectSchema`（`appear` / `emphasize` / `value`）を `packages/contracts` に置く。`table.simple`・`chart.bar` は `value` を受け付ける。既存の `appear`・`emphasize` の解釈は変えないため版は据え置く（[ADR-0061](./0061-template-version-as-reinterpretation-boundary.md)）。
- `table.simple` の `value` は数値セルだけを対象とし、それ以外は保存時に拒否する。`chart.bar` の `value` は値ラベルを対象とし、値ラベルが無効のときは効果を出さない。
- `RenderedCue` に `valueAnimations` を追加し、コンパイラだけがプロキシの `fromTo` を生成する。テンプレートは対象要素ID・開始値・終了値・書式名・開始・尺だけを返す。
- カウント中の書式は静的表示と同じ `ja-JP` の `Intl.NumberFormat` を使い、プレビューのシークとMP4で一致させる。
- 新しい数値テンプレート（`stat@1`）と、既存の表・グラフの数値が同じ `value` 語彙を共有する。`flow`・`list.callout` は数値を持たないため対象外とする。
