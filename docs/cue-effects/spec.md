# Cue効果（行トリガー付き appear / emphasize）仕様

## 目的と境界

この文書は、VisualCueの内部で特定のセリフ行区間を契機に発火・持続する演出（Cue効果）の正とする。台本の契約は [../mvp/content-schema.md](../mvp/content-schema.md)、Cueの責務分離は [../composite-visuals/spec.md](../composite-visuals/spec.md)、表とグラフの入力は [../table-template/spec.md](../table-template/spec.md)・[../chart-template/spec.md](../chart-template/spec.md) を正とする。決定は [ADR-0062](../adr/0062-line-triggered-effect-unit.md)・[ADR-0063](../adr/0063-animation-onset-and-sustained-state.md) を参照する。

- 目的は「3つのポイントを常時表示し、喋っているセリフに応じて1つずつ強調する」のような、セリフ同期の演出を再利用可能な契約として表すこと。
- セリフ行の実時刻は選択済みAudioTakeの尺から派生する。入力にミリ秒を直書きせず、行IDを参照して共通解決器で解決する。
- 効果は有限enumの語彙と尺だけで表す。任意CSS・keyframe・easing文字列・スクリプトは正本へ持ち込まない（[ADR-0031](../adr/0031-cue-transition-and-animation-ownership.md)）。
- 表示窓・入退場はVisualCue側（`range`・`transition`）のままとし、Cue効果は内部演出だけを担う。両者を混ぜない。
- 第一弾は `appear`（一発で現れる）と `emphasize`（区間中ずっと強調する）に限る。発火時の走査演出（枠が一周する `onset`）は後続で語彙を追加する。

## 用語

- **Trigger（Cue Trigger）**: Cue効果を発火・持続させる契機。行区間（`lines`）またはCue窓全体（`cue`）。
- **Effect（Cue Effect）**: Triggerに達したときに対象へ加える変化。`appear` または `emphasize`。
- **発火（onset）**: 一発で完結する変化。`AnimationPlan`（`tl.from`）で表す。
- **持続状態（sustained state）**: 区間中ずっと続き、区間末で解除される状態。`stateIntervals` で表す。

## 共通単位の入力契約

Triggerは既存の `VisualCue.range` の `lines` と同型の判別unionとし、`cue` を加える。

```jsonc
{ "kind": "lines", "startLineId": "line-1", "endLineId": "line-2" }
{ "kind": "cue" }
```

Effectは有限enumとする。

```jsonc
// 一発で現れる。preset は入退場と同じ語彙。
{ "kind": "appear", "preset": "fade", "durationMs": 400, "staggerMs": 150 }

// 区間中ずっと強調する。style は枠か背景、tone はテーマのトーン。
{ "kind": "emphasize", "style": "frame", "tone": "primary" }
```

- `appear.preset` は `fade | slide-up | slide-down | slide-left | slide-right | scale-in`。
- `appear.durationMs` は `animationPolicy.maxDurationMs` でクランプする。
- `appear.staggerMs` は任意で、グループtarget（複数要素をまとめて指す場合）にだけ意味を持つ。省略時は0。
- `emphasize.style` は `background | frame`。`frame` は枠を太くする、`background` は背景色を付ける。
- `emphasize.tone` は `primary | secondary | tertiary | success | warning | error | info` とし、レンダー時にテーマから解決する（`table.simple` の強調と同じ語彙）。

共通単位は `TimedEffect { trigger, effect }` とする。targetの束ね方はテンプレート固有で、テンプレートは次を使い分ける。

- **独立配列型**: `effects: [{ target, trigger, effect }]`。データ駆動テンプレート（`table.simple`・`chart.bar`）はこちら。
- **インライン型**: 著者アイテムの各要素が `trigger` と `effect` を持つ。`list.callout` はこちら。

## Triggerの解決

TriggerはCue相対の時刻へ解決する。テンプレートは `RenderContext.lineIntervals`（Cue相対の行区間）を受け取り、対象の行IDから `startMs`・`endMs` を引く。

- `lines`: `[start行の開始, end行の終了)` をCue相対時刻へ写す。半開区間とする。
- `cue`: `[0, Cue窓の尺)`。
- 解決結果はCue窓 `[0, spanMs]` にクランプする。窓の外・逆転・空区間は効果を出さない。
- 対象の行IDが同一Sceneに存在しない場合、保存時に拒否する。レンダー投入時にも共通解決器で検証し、解決不能なら `unresolvable_range` 相当のエラーとする。

## 効果の実装

- `appear` は対象をTrigger開始で `AnimationPlan`（`startMs` はCue相対）として登場させる。グループtargetでは `startMs = index × staggerMs` を加える。効果以前は非表示、以降は表示のままとする。
- `emphasize` は `stateIntervals` として対象のON区間を返す。ONで強調の見た目、OFFで元に戻す。ON/OFFは `tl.set` で切り替え、補間しない。
- 発火と持続は別サブ要素に割り当て、同じ要素の同じプロパティを取り合わない（[ADR-0063](../adr/0063-animation-onset-and-sustained-state.md)）。
- 効果の尺とTrigger区間の尺は別の時計として扱う。

## コンパイラと契約

- `packages/contracts` に `lineTriggerSchema`・`effectSchema`・`timedEffectSchema` と各テンプレートの入力スキーマを置く。テンプレート入力は無検証でレンダーへ渡さない。
- `RenderContext` に `lineIntervals: { lineId, startMs, endMs }[]`（Cue相対）を追加する。コンパイラが `resolveTimeline` の `placement.lines` から算出する。
- `RenderedCue` に `stateIntervals: { targetId, intervals: { startMs, endMs }[], on, off }[]` を追加する。コンパイラだけが `tl.set` を生成する。
- `VisualTemplateDefinition` に `collectLineRefs(input, path)` を追加する。保存時の行ID実在検証と、行編集時の参照remapに使う。`collectAssetRefs` と同じ規律で、テンプレート定義へ集約する。
- プレビューはレンダーと同じ `compileDocument` を通るため、解決ロジックは `packages/video` に置き、web側で再実装しない。

## エディタ

- 行の並べ替え・削除・分割で、Cueの `range` だけでなく各テンプレート入力のTrigger参照も同じ規則でremapする（`apps/web/src/content/form.ts` の `moveLineInScene`・`removeLineInScene`・`splitPointScene` と同様）。remapは `collectLineRefs` を使って歩査する。
- 行区間の選択UIは、Cueの表示区間編集と同じ行ピッカーを使い回す。
- Trigger値は `inputFields` から生成する。データ駆動テンプレートの `effects` 配列は、targetの選択と効果の編集を汎用のリピータ部品で扱う。
- 編集UIが未対応のTrigger・Effectは読み取り専用で非破壊に保持する。

## 各テンプレートへの適用

### `table.simple@1` / `chart.bar@1`

`effects` を唯一の内部演出とし、`reveal`・`emphasis` は廃止する。

- `table.simple`: `effects` のみを持つ。targetは `{ "kind": "row", "index" } | { "kind": "cell", "row", "key" } | { "kind": "rows" } | { "kind": "columns" }`。`appear` は共通ヘルパ、`emphasize` は `stateIntervals` で描画する。旧 `data.emphasis`（静的強調）は `trigger: { "kind": "cue" }` の `emphasize`、旧 `reveal`（一括登場）はグループtarget＋`staggerMs` の `appear` で表す。
- `chart.bar`: `effects`（`appear` のみ）を持つ。targetは `{ "kind": "category", "index" } | { "kind": "series", "index" } | { "kind": "bars" }`。`grow`／`bounce`／`fade` は `appear` の preset として保持し、`axis` は描画側が `style.orientation` から決める。
- `reveal`・`emphasis` の削除は保存済み有効入力の再解釈を伴う。`@1` を書き換えた（正式リリース前の破壊的変更。[ADR-0034](../adr/0034-destructive-changes-before-1-0.md)）。新規Cueには既定の `effects`（表は全行フェード、グラフは全棒grow）を入れる。

### `list.callout@1`（新規）

セリフ同期のポイント列を表す著者アイテム型テンプレート。

```jsonc
{
  "title": "テンプレート化の要点",                 // 任意
  "items": [
    { "text": "再利用できる", "trigger": { "kind": "lines", "startLineId": "line-1", "endLineId": "line-1" }, "effect": { "kind": "emphasize", "style": "frame", "tone": "primary" } },
    { "text": "表記ゆれを防ぐ", "trigger": { "kind": "lines", "startLineId": "line-2", "endLineId": "line-3" }, "effect": { "kind": "emphasize", "style": "background", "tone": "secondary" } }
  ],
  "appear": { "trigger": { "kind": "cue" }, "effect": { "kind": "appear", "preset": "fade", "durationMs": 400, "staggerMs": 120 } }
}
```

- `items[].trigger`・`items[].effect` は任意。省略したアイテムは常時表示で効果なし。
- `appear` は列全体の登場を表す任意フィールド。グループtarget＋`staggerMs` と同じ意味。

## 版と移行

- 新規テンプレート（`list.callout@1`）は `@1` から開始する。
- 既存テンプレートの入力形状変更は、保存済み参照の有無で `@1` 書き換えか `@2` 追加かを決める。`table.simple@1`・`chart.bar@1` の `reveal`・`emphasis` 削除は、正式リリース前の破壊的変更として `@1` を書き換えた（[ADR-0034](../adr/0034-destructive-changes-before-1-0.md)）。
- 効果語彙の追加（将来の `onset` など）は、保存済み有効入力の解釈を変えない限り同じ版を書き換えてよい（[ADR-0061](../adr/0061-template-version-as-reinterpretation-boundary.md)）。

## 非ゴール

- 発火時の走査演出（枠が一周する `onset`）。後続で語彙を追加する。
- `offset`（ミリ秒）Trigger。第一弾は `lines` と `cue` のみ。
- 任意のkeyframe・CSS・easing文字列・スクリプト。
- 字幕・音声のタイミングを利用者が自由編集すること（既存方針のまま）。

## 受け入れ条件

- 3つのポイントを常時表示し、各ポイントが対応する行区間で強調され、区間末で解除される動画を、プレビューのシークとMP4で一致して再現できる。
- 行の並べ替え・削除・分割後も、Trigger参照が同じ行を指し続ける。
- 存在しない行ID・逆転区間・空区間を保存時に拒否し、Cue窓外のTriggerをクランプする。
- `table.simple`・`chart.bar` の移行後、既存相当の見た目（一括登場・静的強調）を `effects` で再現でき、プレビューとMP4が一致する。
- 同一テンプレートの複数配置・入れ子で、要素ID・`AnimationPlan`・`stateIntervals` が衝突しない。
