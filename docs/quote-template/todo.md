# 引用テンプレート 実装TODO

[spec.md](./spec.md) の実装フェーズ。契約を先に固め、`packages/contracts` がZodスキーマと型の唯一の定義場所。上から順に進める。

## Phase 1: 契約

- [x] `quoteStylePresetSchema`・`quoteStyleSchema`・`quoteEffectSchema` / `quoteEffectsSchema` を `packages/contracts` に追加する
- [x] `quoteInputSchema`（quote / author? / source? / style? / effects?）と `collectLineRefs` を実装する
- [x] `quoteV1` を登録し、`visualTemplateDefinitions` と export に加える
- [x] `TemplateFieldSpec` の `effects` の `variant` に `quote` を追加する
- 完了条件: 受理・拒否テストが通り、`npm run typecheck` が通る。

## Phase 2: 描画

- [x] `packages/video` に `quote` レンダラを追加し、`dispatchTemplate` に登録する
- [x] 引用本文・著者・出典の描画と `style.preset`（plain / card）を実装する
- [x] `appear` / `emphasize` / `spotlight` / `onset` を共通ヘルパで描画する
- [x] `STYLES` に `.kakeai-quote*` を追加する
- [x] 同一テンプレートの複数配置で衝突しないことをコンパイラテストで確認する
- 完了条件: 引用カードがプレビューとMP4で一致し、行トリガー効果が動く。

## Phase 3: エディタ

- [x] `EffectsField` に quote（targetなし）variant を追加する
- [x] `form.ts` の `effectsSchemaForVariant`・`defaultEffectsForVariant` を `quote` に対応させる
- [x] 行削除・分割時の remap が `collectLineRefs` 経由で動くことを確認する
- 完了条件: 引用・著者・出典・効果をエディタで編集でき、行編集後も参照が破綻しない。

## Phase 4: 文書同期

- [x] [../mvp/content-schema.md](../mvp/content-schema.md) のVisualTemplate表を `quote@1`（対応）へ更新する
- [x] [../cue-effects/spec.md](../cue-effects/spec.md) のロードマップを更新する
- [x] ユーザーガイドに引用Cueの説明を追記する
- 完了条件: 実装と文書の矛盾がない。

## 補足

- 新規テンプレートのため ADR は追加しない（新しい機構を導入せず、[ADR-0062](../adr/0062-line-triggered-effect-unit.md)・[ADR-0063](../adr/0063-animation-onset-and-sustained-state.md) の範囲内）。
