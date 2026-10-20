# フローテンプレート 実装TODO

[spec.md](./spec.md) の実装フェーズ。契約を先に固め、`packages/contracts` がZodスキーマと型の唯一の定義場所。上から順に進める。

## Phase 1: 契約

- [x] `flowDiagramSchema`（nodes / edges、範囲・自己ループ検証）・`flowStyleSchema`（orientation / preset）・`flowEffectTargetSchema` / `flowEffectSchema` / `flowEffectsSchema` を `packages/contracts` に追加する
- [x] `flowDiagramInputSchema`（title / diagram / style / effects）と `collectLineRefs` を実装する
- [x] `flowDiagramV1` を登録し、`visualTemplateDefinitions` と export に加える
- [x] `TemplateFieldSpec` に `flow` 種別、`effects` の `variant` に `flow` を追加する
- 完了条件: 受理・拒否テストが通り、`npm run typecheck` が通る。

## Phase 2: 描画

- [x] `packages/video` に `flow-diagram` レンダラを追加し、`dispatchTemplate` に登録する
- [x] 縦横のレイアウト、ノード描画、SVGの辺・矢印・辺ラベルを実装する
- [x] `appear` / `emphasize` / `spotlight` / `onset` を共通ヘルパで描画する
- [x] `STYLES` に `.kakeai-flow*` を追加する
- [x] 同一テンプレートの複数配置で衝突しないことをコンパイラテストで確認する
- 完了条件: 縦横のフロー図がプレビューとMP4で一致し、行トリガー効果が動く。

## Phase 3: エディタ

- [x] `FlowField` 部品（ノード・辺のリピータ、追加/削除、上限、ノード削除時の辺の再index）を追加する
- [x] `form.ts` の `readCueFields`・`buildCueInput`・`defaultCueFields` を `flow` と effects `variant:"flow"` に対応させる
- [x] `CueList` の `CueField` に `flow` を追加する
- [x] `EffectsField` に flow の target（`node` / `nodes`）を追加する
- [x] 行削除・分割時の remap が `collectLineRefs` 経由で動くことを確認する
- 完了条件: フロー図のノード・辺・効果をエディタで編集でき、行編集後も参照が破綻しない。

## Phase 4: 文書同期

- [x] [../mvp/content-schema.md](../mvp/content-schema.md) のVisualTemplate表を `flow.diagram@1`（対応）へ更新する
- [x] [../cue-effects/spec.md](../cue-effects/spec.md) のロードマップを更新する
- [x] [ADR-0064](../adr/0064-flow-diagram-graph-contract.md) を追加する
- 完了条件: 実装と文書の矛盾がない。
