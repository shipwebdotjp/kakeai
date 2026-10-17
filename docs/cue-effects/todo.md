# Cue効果 実装TODO

[spec.md](./spec.md) の実装フェーズ。契約を先に固め、`packages/contracts` がZodスキーマと型の唯一の定義場所。上から順に進める。

## Phase 1: 共通単位の契約

- [x] `lineTriggerSchema`（`lines` / `cue`）・`effectSchema`（`appear` / `emphasize`）・`timedEffectSchema` を `packages/contracts` に追加する
- [x] トーンの語彙（`tableToneSchema`）を共有モジュールへ移し、強調の `tone` と表の強調で単一定義を共有する
- [x] `VisualTemplateDefinition.collectLineRefs`（任意フック）と `LineReference` 型を追加する
- [x] `RenderContext.lineIntervals`（Cue相対）と `RenderedCue.stateIntervals` の型を追加する（この段階では未使用でも可）
- 完了条件: 新スキーマの受け入れ・拒否テストが通り、`npm run typecheck`・`npm test` が既存挙動を変えずに通る。

## Phase 2: コンパイラとエンジン

- [x] コンパイラが `resolveTimeline` の `placement.lines` から `lineIntervals` を算出してテンプレートへ渡す
- [x] `character.standing` 専用の interval→`tl.set` 生成を共通ヘルパ（`setTweenLine`）へ抽出し、`stateIntervals` に適用する
- [x] `appear`（一発）とグループtargetの `staggerMs` を `AnimationPlan` へ写像する（`planAppearEffect`）
- [x] 行ID不在・逆転区間・空区間・Cue窓外のクランプを検証する（`resolveTriggerWindow`・`stateIntervalTweenLines`）
- 完了条件: `stateIntervals` と `appear` がプレビューのシークとMP4で一致し、`character.standing` の既存挙動が回帰しない。

> Phase 2 は共通ヘルパと型・ユニットテストまで。実素材での end-to-end 一致確認は、効果を使うテンプレートが入る Phase 3・Phase 4 で行う。

## Phase 3: `table.simple@1` / `chart.bar@1` に `effects` を追加（追加型）

二重表現の解消（`reveal`・`emphasis` の削除）は、`effects` 編集UIが要るため Phase 5 に回す。Phase 3 は壊さずに足す。

- [x] `table.simple`・`chart.bar` の入力に任意の `effects` を追加する（target union、行ID不在・範囲外の検証）
- [x] `packages/video` の `table-simple.ts`・`chart-bar.ts` で `effects` を描画する（`appear` は共通ヘルパ、`emphasize` は `stateIntervals`）
- [x] `reveal`・`emphasis`・エディタは変更しない（追加のみ。既存入力を再解釈しないため版は据え置き）
- [x] 契約・レンダラのテストを追加する
- 完了条件: `effects` を持つ表・グラフがプレビューとMP4で一致し、既存の `reveal`・`emphasis` の挙動が回帰しない。

## Phase 4: `list.callout@1`

`inputFields`（編集UI）は、effects 編集部品が要るため Phase 5 に回す。Phase 4 は契約・レンダラまで。

- [x] `list.callout@1` の入力スキーマ・定義・登録を追加する
- [x] `packages/video` に `list.callout` のレンダラを追加し、`dispatchTemplate` に登録する
- [x] ポイント列の描画（アイテムの並び、枠、背景）と `items[].trigger`/`items[].effect`、列全体の `appear` を実装する
- [x] `collectLineRefs` を実装する（Phase 5 の remap で使う）
- [x] 同一テンプレートの複数配置・入れ子で衝突しないことをコンパイラテストで確認する
- [ ] `inputFields` を追加する（Phase 5）
- 完了条件: 3つのポイントを常時表示し、各行区間で個別に強調・解除できる入力を、プレビューとMP4で一致して再現できる（エディタ対応は Phase 5）。

## Phase 5: 二重表現の解消とエディタ

### 5a エディタ

- [x] `TemplateFieldSpec` に `effects`・`calloutItems` 種別を追加し、`table.simple`/`chart.bar`/`list.callout` の `inputFields` に載せる
- [x] `form.ts` の `readCueFields`・`buildCueInput`・`defaultCueFields` を `effects`・`calloutItems` に対応させる
- [x] `EffectsField`・`CalloutItemsField` 部品（対象・契機・効果、行ピッカー）を追加する
- [x] 行の削除で、削除行を参照する効果トリガーを落とし、`countLineCueReferences` にも算入する
- [x] シーン分割（`splitPointScene`）で効果トリガーの参照を前後シーンへ振り分ける
- 完了条件: 表・グラフ・ポイントの効果をエディタで設定でき、行削除・シーン分割後も参照が破綻しない。

### 5b 二重表現の解消

- [x] `table.simple`・`chart.bar` から `reveal`・`emphasis` を削除し `effects` へ一本化する（`@1` を書き換え）
- [x] `DataGridField` の強調UIと `form.ts` の `grid.emphasis` 依存を `dataKind` へ整理する
- [x] 新規Cueに既定の `effects` を入れる（表=全行フェード、グラフ=全棒grow）
- 完了条件: 実装と文書の矛盾がない。

## Phase 6: 文書同期

- [ ] [../mvp/content-schema.md](../mvp/content-schema.md) のVisualTemplate表とアニメーション記述を更新する
- [ ] [../table-template/spec.md](../table-template/spec.md)・[../chart-template/spec.md](../chart-template/spec.md) の入力契約を `effects` へ更新する
- [ ] [../../CONTEXT.md](../../CONTEXT.md) の用語を確認する
- 完了条件: 実装と文書の矛盾がない。

## Phase 7: onset（発火演出）と spotlight（兄弟減光）

- [x] `onsetSpecSchema`（`sweep | flash | pop`）を `emphasizeEffectSchema.onset` に追加し、`emphasizeStyleSchema` に `spotlight` を追加する
- [x] `chart.bar` の `effect` を `appear`（grow/bounce/fade）と `emphasize`（frame/spotlight）の判別unionにする（`background` は保存時に拒否）
- [x] videoローカルの onset action を追加し、`actionVars` と `STYLES`（走査線オーバーレイ）へ写像する
- [x] `planOnsetEffect` と `SPOTLIGHT_DIM_*` を `cue-effects` に追加する
- [x] `table.simple`・`list.callout`・`chart.bar` で spotlight の兄弟減光と onset オーバーレイを描画する（行targetは各セルへオーバーレイ）
- [x] `EffectsField`・`CalloutItemsField` に spotlight と onset 編集（`OnsetField`）を追加し、chart の効果に「強調」を出す
- [x] 契約・レンダラ・フォームのテストを追加する
- 完了条件: `emphasize` の onset/spotlight がプレビューのシークとMP4で一致し、既存の `appear`・`emphasize` の挙動が回帰しない。

## Phase 8: 保存時検証と remap の collectLineRefs 一本化

- [x] `collectLineReferences(document)` 文書ウォーカーを `packages/contracts` に追加する（`asset-refs` と同型）
- [x] `validateContentDocument` で効果トリガーの lineId が同一Sceneに実在するかを検証する
- [x] `collectLineRefs` の各実装を trigger 部分スキーマの `safeParse` に変え、部分入力を許容する
- [x] web の remap（`removeLineInScene`・`splitPointScene`・`countLineCueReferences`）を `collectLineRefs` に一本化する（未知テンプレートは非破壊保持）
- [x] 契約・web のテストを追加・更新する
- 完了条件: 別Scene・不存在の効果トリガーを保存時に拒否し、行削除・分割後も参照が破綻しない。

## Phase 9: onset preset `marker` / `underline`（蛍光ペン、持続）

- [x] `onsetPresetSchema` に `marker`・`underline` を追加する
- [x] `planOnsetEffect` を `CueEffectPlan`（`{ animation, stateIntervals }`）を返す形にし、`marker`・`underline` は区間ON/OFFの `stateIntervals` を返す
- [x] `actionVars` に `marker`/`underline`（`--kakeai-onset-progress:0`）を追加し、`STYLES` に `::after` の線を追加する
- [x] `STYLES` の onset セレクタのハイフン欠落（`.kakeai-onsetsweep` 等）を修正し、テンプレートの `kakeai-onset-${preset}` と一致させる
- [x] 各テンプレートの `planOnsetEffect` 呼び出しを `CueEffectPlan` へ更新する（`table.simple`・`chart.bar`・`list.callout`・`quote`・`stat`・`flow.diagram`）
- [x] `OnsetField` に `marker`・`underline` のラベルを追加する
- [x] 契約・`cue-effects`・テンプレート・コンパイラ（全presetのセレクタ一致）のテストを追加する
- 完了条件: `marker`/`underline` が発火で線を走らせ、区間末まで残って解除され、プレビューのシークとMP4で一致する。既存 `sweep`/`flash`/`pop` の見た目が修正後も回帰しない。
