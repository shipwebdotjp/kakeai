# Cue効果（行トリガー付き appear / emphasize）仕様

## 目的と境界

この文書は、VisualCueの内部で特定のセリフ行区間を契機に発火・持続する演出（Cue効果）の正とする。台本の契約は [../mvp/content-schema.md](../mvp/content-schema.md)、Cueの責務分離は [../composite-visuals/spec.md](../composite-visuals/spec.md)、表とグラフの入力は [../table-template/spec.md](../table-template/spec.md)・[../chart-template/spec.md](../chart-template/spec.md) を正とする。決定は [ADR-0062](../adr/0062-line-triggered-effect-unit.md)・[ADR-0063](../adr/0063-animation-onset-and-sustained-state.md) を参照する。

- 目的は「3つのポイントを常時表示し、喋っているセリフに応じて1つずつ強調する」のような、セリフ同期の演出を再利用可能な契約として表すこと。
- セリフ行の実時刻は選択済みAudioTakeの尺から派生する。入力にミリ秒を直書きせず、行IDを参照して共通解決器で解決する。
- 効果は有限enumの語彙と尺だけで表す。任意CSS・keyframe・easing文字列・スクリプトは正本へ持ち込まない（[ADR-0031](../adr/0031-cue-transition-and-animation-ownership.md)）。
- 表示窓・入退場はVisualCue側（`range`・`transition`）のままとし、Cue効果は内部演出だけを担う。両者を混ぜない。
- `appear`（一発で現れる）と `emphasize`（区間中ずっと強調する）を第一弾とする。`emphasize` は発火時の一発演出（`onset`）と、対象以外を減光する `spotlight` を任意で持てる。

## 用語

- **Trigger（Cue Trigger）**: Cue効果を発火・持続させる契機。行区間（`lines`）またはCue窓全体（`cue`）。
- **Effect（Cue Effect）**: Triggerに達したときに対象へ加える変化。`appear` または `emphasize`。
- **発火（onset）**: 一発で完結する変化。`AnimationPlan`（`tl.from`）で表す。
- **持続状態（sustained state）**: 区間中ずっと続き、区間末で解除される状態。`stateIntervals` で表す。
- **spotlight（兄弟減光）**: `emphasize` の `style` の一つ。対象をリングで強調しつつ、兄弟要素を減光する。

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

// 区間中ずっと強調する。style は枠・背景・スポットライト、tone はテーマのトーン。
// onset は発火時に一度だけ走る演出（任意）。
{ "kind": "emphasize", "style": "spotlight", "tone": "primary", "onset": { "preset": "sweep", "durationMs": 600 } }
```

- `appear.preset` は `fade | slide-up | slide-down | slide-left | slide-right | scale-in`。
- `appear.durationMs` は `animationPolicy.maxDurationMs` でクランプする。
- `appear.staggerMs` は任意で、グループtarget（複数要素をまとめて指す場合）にだけ意味を持つ。省略時は0。
- `emphasize.style` は `background | frame | spotlight`。`frame` は枠を太くする、`background` は背景色を付ける、`spotlight` は対象をリングで強調し兄弟を減光する。
- `emphasize.tone` は `primary | secondary | tertiary | success | warning | error | info` とし、レンダー時にテーマから解決する（`table.simple` の強調と同じ語彙）。
- `emphasize.onset` は任意で `{ preset: "sweep" | "flash" | "pop", durationMs }`。発火の尺は `animationPolicy.maxDurationMs` とTrigger区間でクランプする。
- `chart.bar` の強調は棒の色を上書きしないよう `frame | spotlight` に限る（`background` は保存時に拒否する）。

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
- `emphasize.onset` は対象内の一時サブ要素（走査線など）に `AnimationPlan`（`startMs` はTrigger開始）として当て、持続の `stateIntervals` とは別要素・別プロパティにする。`sweep`/`flash`/`pop` は有限enumのvideoローカルなactionで、コンパイラが対応するCSSプロパティ・カスタムプロパティの開始値へ写像する。`<tr>` に子要素を置けないため、行targetのonsetは各セルへオーバーレイする。
- `emphasize.style: "spotlight"` は対象にリングの `stateIntervals` を返し、加えて兄弟要素を `filter` で減光する `stateIntervals` を返す。兄弟要素はテンプレートが解決する（`appear` の非表示が `opacity` を使うため、減光は `opacity` ではなく `filter` を使い競合を避ける）。
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
- `chart.bar`: `effects` を持ち、`appear`（preset は `grow`／`bounce`／`fade`）と `emphasize`（`style` は `frame | spotlight`、`onset` 可）を扱う。targetは `{ "kind": "category", "index" } | { "kind": "series", "index" } | { "kind": "bars" }`。`grow`／`bounce`／`fade` は `appear` の preset として保持し、`axis` は描画側が `style.orientation` から決める。`spotlight` の兄弟は同じ棒グラフ内の他の棒。
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
- 効果語彙の追加は、保存済み有効入力の解釈を変えない限り同じ版を書き換えてよい（[ADR-0061](../adr/0061-template-version-as-reinterpretation-boundary.md)）。`spotlight`・`onset` の追加と `chart.bar` の `emphasize` 追加は、いずれも追加のみのため `@1` を据え置いた。

## 非ゴール

- `offset`（ミリ秒）Trigger。第一弾は `lines` と `cue` のみ。
- 任意のkeyframe・CSS・easing文字列・スクリプト。
- 字幕・音声のタイミングを利用者が自由編集すること（既存方針のまま）。

## 受け入れ条件

- 3つのポイントを常時表示し、各ポイントが対応する行区間で強調され、区間末で解除される動画を、プレビューのシークとMP4で一致して再現できる。
- `emphasize` に `onset` を付けたとき、発火がTrigger開始で一度だけ走り、`spotlight` では対象がリングで強調され兄弟が減光され、いずれも区間末で解除される。プレビューとMP4が一致する。
- 行の並べ替え・削除・分割後も、Trigger参照が同じ行を指し続ける。
- 存在しない行ID・逆転区間・空区間を保存時に拒否し、Cue窓外のTriggerをクランプする。
- `table.simple`・`chart.bar` の移行後、既存相当の見た目（一括登場・静的強調）を `effects` で再現でき、プレビューとMP4が一致する。
- 同一テンプレートの複数配置・入れ子で、要素ID・`AnimationPlan`・`stateIntervals` が衝突しない。

## 今後のロードマップ
すぐ効く小粒（1〜2日規模）
- [x] onset（発火の一発演出）: 「枠が一周して光って、そのまま強調が残る」。`emphasize` に `onset: { preset, durationMs }` を足し、`stateIntervals` の開始と別サブ要素（走査線）で当てる。追加のみなので版は据え置き。preset は `sweep | flash | pop`。
- offset トリガー: lineTriggerSchema に { kind: "offset", startMs, endMs } を追加。セリフに紐づかない尺指定の演出（BGM連動・固定尺シーンの見せ場）に効く。
- list.callout の appear を編集UIに出す: レンダラは列全体の登場に対応済みだが inputFields に無い。appear 編集を出せば「列が順に現れる」も可能。
- 保存時検証の穴を塞ぐ: 効果トリガーの lineId が同一Sceneに実在するかは今コンパイル時まで検証されない（別Sceneの行を指してもプレビューまで気づかない）。collectLineRefs を API サービス（faceSet 解決と同様の層）で実在検証＋行の削除/分割時の remap に一本化する。
- list.callout の警告: 文言の行数目安など meta.warnings 未対応。テキスト系の目安を揃える。
効果の語彙（パターン）を増やす
- [x] spotlight（他を暗く）: 対象を強調しつつ兄弟を減光。表・グラフ・ポイントで一番「分かった感」が出る。`emphasize` の style 追加（`style: "spotlight"`）で実装。
- count-up（数値のカウント）: 行区間で数値を0→値へ。chart/table の数値や「stat（大数字）」テンプレートと好相性。持続状態ではなく「区間で進行する値」なので新しい effect 種別 value を足す形。
- marker/underline（蛍光ペン）: 発火で線が走る onset 系。onset の preset として追加すると語彙が自然に増える。
- pulse（繰り返し強調）: 「ずっと点滅」。既に pulse preset はあるので emphasize の繰り返しオプションとして。
- カメラ/画像注釈: 画像の一部へ寄る/丸で囲む（hyperframes-keyframes 相当）。ただし任意keyframeは不可なので、有限プリセット（zoom-to, circle, arrow）に閉じる。
追加すると効くテンプレート
- flow.horizontal@1: content-schema で「将来」と書いてある工程・フロー図。各ステップがそのセリフでハイライトするのは行トリガーと最も相性が良い。
- steps / timeline@1: 番号付き縦ステップ。list.callout の親戚で実装部品を流用可。
- stat@1（大きな数値＋ラベル）: count-up とセット。導入・結びの締めに。
- quote@1: 引用カード。著者・出典付き。行トリガーで強調。
- image.callout@1（画像注釈）: 画像にポイント/矢印/丸を重ね、行ごとに切替。解説動画の主力。
- code.block@1: 行番号付きコードで、ナレーションに合わせて該当行をハイライト。技術解説向け。
- chart.line@1 / chart.pie@1: ADR-0057 が draw/sweep を想定済み。折れ線の描画＋点のハイライトは行トリガーと好相性。
エディタ／プラットフォーム
- Cue Map に効果トリガーのマーカー: どのセリフで何が発火するかを左ペインの帯に出す。今は編集画面のリッチなUIだけなので、俯瞰できると編集速度が上がる。
- 効果のプレビュー再生: 行セレクトの横に「この瞬間へ移動」ボタン。プレビューは同コンパイラ経由なので実装は比較的軽い。
- AI割当て: セリフとポイントを渡して「この行でこのポイントを強調」を自動提案（ネットワーク可）。ADR-0062 の行参照契約があるので、AI出力はテンプレート入力のJSONに閉じれば安全。
- emphasize の見た目プリセット（現状 style 3種 + tone 7色）: 影・下線・拡大など小さな有限setを足す。
おすすめの進め方
1. [x] onset + spotlight（体感価値が最も大きく、emphasize の拡張で追加のみ）
2. 保存時検証と remap の collectLineRefs 一本化（正本性・壊れにくさ。地味だが効く）
3. flow.horizontal or steps（行トリガーが映える新テンプレート）
4. count-up + stat（見せ場づくり）