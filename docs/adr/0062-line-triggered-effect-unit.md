# 行トリガー付き効果を共通単位として定義し、容器とtarget指定はテンプレートに残す

VisualCueの内部で、特定のセリフ行区間を契機に発火・持続する演出を、テンプレート入力の共通単位 `TimedEffect { trigger, effect }` として定義する。`trigger` は既存の `VisualCue.range` の `lines` 形（`{ "kind": "lines", "startLineId", "endLineId" }`）と同型の行区間、または `{ "kind": "cue" }`（Cue窓の全体）とする。`effect` は有限enumの効果とし、第一弾は `appear`（一発で現れる）と `emphasize`（区間中ずっと強調する）の2種とする。

共通化するのは **トリガーのスキーマ・効果の語彙・コンパイラの解決機構**までとする。**効果をどのtargetに束ねるか（容器の形）はテンプレート固有**とし、データ駆動テンプレート（`table.simple`・`chart.bar`）はtargetを指す独立配列、著者アイテム型テンプレート（`list.callout`）は各アイテムへのインライン付与とする。

理由は、セリフ行の実時刻が選択済みAudioTakeの `durationMs` から `resolveTimeline` で派生するため、ミリ秒を入力へ直書きすると台本編集で同期が壊れること。行ID参照にして共通の解決器で解決する。一方でtargetの指し方はデータ構造に依存し、横断的に固定すると新しいテンプレートで窮屈になる。既存 `table.simple` の `data.emphasis`（行・セルを指す静的強調）が示すとおり、データと演出の分離には独立配列が適する。

## Considered Options

- 各テンプレートが独自のトリガー語彙を持つ。→ 行区間解決が重複し、効果の見た目もテンプレートごとにばらつくため不採用。
- 表示窓（Cueの `range`）だけでトリガーを表す。→ 複数のポイントを常時表示しつつ個別のセリフで発火できないため不採用。
- targetの指し方まで共通DSL化する。→ 具体的な利用例が少なく、抽象が早すぎて窮屈になるため不採用。

## Consequences

- 共通スキーマ（`lineTriggerSchema`・`effectSchema`・`timedEffectSchema`）を `packages/contracts` に置く。
- `VisualTemplateDefinition` に `collectLineRefs` を追加し、保存時の行ID実在検証と、行の並べ替え・削除・分割時の参照remapに使う。Cueの `range` が行IDを指すのと同じ規律に揃える。
- `RenderContext` にCue相対の行区間（`lineIntervals`）を追加し、テンプレートがトリガーを解決できるようにする。
- 第一弾で `table.simple@1`・`chart.bar@1` の `reveal`・`emphasis` を本単位へ寄せる。これは保存済み有効入力の再解釈を伴うため、保存済み参照がゼロなら [ADR-0034](./0034-destructive-changes-before-1-0.md) に従い `@1` を書き換え、参照があれば [ADR-0061](./0061-template-version-as-reinterpretation-boundary.md) に従い `@2` を切る。
- 発火時に枠が一周する走査演出は第一弾に含めず、後続で効果語彙を追加する。
