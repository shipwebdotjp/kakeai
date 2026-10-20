# 数値テンプレート 実装TODO

[spec.md](./spec.md) の実装フェーズ。契約を先に固め、`packages/contracts` がZodスキーマと型の唯一の定義場所。上から順に進める。

## Phase 1: 契約（value 効果と stat）

- [x] `valueEffectSchema` と `numericEffectSchema`（`appear` / `emphasize` / `value`）を `packages/contracts` に追加する
- [x] `table.simple` / `chart.bar` の effect を `numericEffectSchema`（table）・value 追加（chart）へ広げ、value の target 制約を検証する
- [x] `statInputSchema`・`statEffectSchema`・`statStyleSchema` と `statV1` を追加・登録する
- [x] `TemplateFieldSpec` に `decimal` 種別、`effects` の `variant` に `stat` を追加する
- 完了条件: 受理・拒否テストが通り、`npm run typecheck` が通る。

## Phase 2: 描画

- [x] `RenderedCue.valueAnimations` と `ValueAnimation` を追加する
- [x] `planValueAnimation` を `cue-effects` に追加する
- [x] コンパイラに value の `fromTo`（プロキシ＋`onUpdate`＋書式化）生成を追加する
- [x] `table.simple`（数値セル）と `chart.bar`（値ラベル）に value を実装する
- [x] `stat` レンダラを追加し、`dispatchTemplate` に登録、`STYLES` を追加する
- [x] `stat` の `appear` / `emphasize` / `onset` を実装する
- 完了条件: value・emphasize・appear がプレビューとMP4で一致する。

## Phase 3: エディタ

- [x] `decimal` フィールド種別を `form.ts` の read/build/default に対応させる
- [x] `EffectsField` に `value` 効果の編集（開始値・尺）と stat（targetなし）variant を追加する
- [x] `effects` の `variant:"stat"` を `form.ts` に対応させる
- 完了条件: stat と table/chart の count-up をエディタで設定できる。

## Phase 4: 文書同期

- [x] [../mvp/content-schema.md](../mvp/content-schema.md) のVisualTemplate表と Cue Effect 記述を更新する
- [x] [../table-template/spec.md](../table-template/spec.md)・[../chart-template/spec.md](../chart-template/spec.md) に value を追記する
- [x] [../cue-effects/spec.md](../cue-effects/spec.md) に value 効果とロードマップを更新する
- [x] [ADR-0065](../adr/0065-count-up-value-effect.md) を追加する
- 完了条件: 実装と文書の矛盾がない。
