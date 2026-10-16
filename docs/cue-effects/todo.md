# Cue効果 実装TODO

[spec.md](./spec.md) の実装フェーズ。契約を先に固め、`packages/contracts` がZodスキーマと型の唯一の定義場所。上から順に進める。

## Phase 1: 共通単位の契約

- [x] `lineTriggerSchema`（`lines` / `cue`）・`effectSchema`（`appear` / `emphasize`）・`timedEffectSchema` を `packages/contracts` に追加する
- [x] トーンの語彙（`tableToneSchema`）を共有モジュールへ移し、強調の `tone` と表の強調で単一定義を共有する
- [x] `VisualTemplateDefinition.collectLineRefs`（任意フック）と `LineReference` 型を追加する
- [x] `RenderContext.lineIntervals`（Cue相対）と `RenderedCue.stateIntervals` の型を追加する（この段階では未使用でも可）
- 完了条件: 新スキーマの受け入れ・拒否テストが通り、`npm run typecheck`・`npm test` が既存挙動を変えずに通る。

## Phase 2: コンパイラとエンジン

- [ ] コンパイラが `resolveTimeline` の `placement.lines` から `lineIntervals` を算出してテンプレートへ渡す
- [ ] `character.standing` 専用の interval→`tl.set` 生成を共通ヘルパへ抽出し、`stateIntervals` に適用する
- [ ] `appear`（一発）とグループtargetの `staggerMs` を `AnimationPlan` へ写像する
- [ ] 行ID不在・逆転区間・空区間・Cue窓外のクランプを検証する
- 完了条件: `stateIntervals` と `appear` がプレビューのシークとMP4で一致し、`character.standing` の既存挙動が回帰しない。

## Phase 3: `table.simple@1` / `chart.bar@1` の移行

契約・レンダラ・warnings・web フォームを同じ変更で更新する（契約だけ先に変えるとビルドが壊れるため）。

- [ ] 保存済みScriptVersionの参照を確認し、参照ゼロなら `@1` を書き換え、参照があれば `@2` を切る
- [ ] `table.simple`・`chart.bar` の入力スキーマを `effects` へ移行する（target union、`data.emphasis`・`reveal` の統合）
- [ ] `packages/video` の `table-simple.ts`・`chart-bar.ts` を `effects` 前提へ移行する
- [ ] `packages/contracts` の `warnings.ts` の `reveal` 依存を `effects` へ移行する
- [ ] `apps/web` のフォーム（`DataGridField`・`form.ts`）を `effects` 前提へ移行する
- [ ] コンパイラテストを `effects` 前提へ更新する
- 完了条件: 一括登場・静的強調・`grow`/`bounce` が移行前と同一の見た目で、プレビューとMP4が一致する。

## Phase 4: `list.callout@1`

- [ ] `list.callout@1` の入力スキーマ・定義・登録・`inputFields` を追加する
- [ ] `packages/video` に `list.callout` のレンダラを追加し、`dispatchTemplate` に登録する
- [ ] ポイント列の描画（アイテムの並び、枠、背景）と `items[].trigger`/`items[].effect`、列全体の `appear` を実装する
- [ ] 同一テンプレートの複数配置・入れ子で衝突しないことをコンパイラテストで確認する
- 完了条件: 3つのポイントを常時表示し、各行区間で個別に強調・解除できる動画を保存→プレビュー→レンダーできる。

## Phase 5: エディタ

- [ ] 行の並べ替え・削除・分割で、`collectLineRefs` を使ってTrigger参照をremapする
- [ ] 行区間の選択UIを行ピッカーで実装する
- [ ] `effects` 配列・`items` の編集を汎用リピータ部品で実装する（必要な `TemplateFieldSpec` 種別を追加する）
- [ ] UI未対応のTrigger・Effectを読み取り専用で非破壊に保持する
- 完了条件: エディタでTriggerを設定し、行を並べ替えても参照が保たれ、保存・プレビューできる。

## Phase 6: 文書同期

- [ ] [../mvp/content-schema.md](../mvp/content-schema.md) のVisualTemplate表とアニメーション記述を更新する
- [ ] [../table-template/spec.md](../table-template/spec.md)・[../chart-template/spec.md](../chart-template/spec.md) の入力契約を `effects` へ更新する
- [ ] [../../CONTEXT.md](../../CONTEXT.md) の用語を確認する
- 完了条件: 実装と文書の矛盾がない。
