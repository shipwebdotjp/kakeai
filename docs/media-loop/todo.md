# 背景・カードの動画ループ（media loop） 実装TODO

[仕様](./spec.md) を正とする。

## フェーズ

### [x] L1 契約

- [x] `media.full-bleed@1` / `media.card@1` の入力へ任意 `loop: boolean` を統合する（[ADR-0061](../adr/0061-template-version-as-reinterpretation-boundary.md) で `@2` から `@1` へ再基準化）
- [x] `media.full-bleed@1` / `media.card@1` を `inputFields`（`boolean` key `loop`）付きで登録する
- 完了条件: `@1` が `loop` を受理する。

### [x] L2 レンダー

- [x] `resolveCueMedia` が `durationMs` を返し、`ResolvedMedia` に持たせる
- [x] `RenderContext` に `cueTiming`（絶対開始・窓長）を渡し、`media.full-bleed@1` / `media.card@1` で複製動画を出力する
- [x] `loop_span_too_long` の上限ガードを動画にも適用する
- [x] メディアtiming付与は既に `data-start` を持つ動画を上書きしない
- [x] `render-jobs`・`script-versions`・`worker/render` の asset resolver が動画の `durationMs` を渡す
- 完了条件: `loop: true` の短い動画が窓いっぱいに連続配置され、プレビューとレンダーで一致する。

### [x] L3 編集UI

- [x] `toCueFormValue` の旧版昇格を削除し、`media.full-bleed@1` / `media.card@1` をそのまま読む
- [x] `boolean` フィールドから `loop` を復元・組み立てする（既定は省略）
- 完了条件: 既存の背景・カードCueでループを編集・保存できる。

### [x] L4 テスト

- [x] contracts: `@2` の `loop` optional、`@1` は `loop` を拒否、`@2` のみ `loop` フィールドを持つ
- [x] video: 素材<窓で複製、素材≧窓で単一、`loop` 無効で単一、上限エラー、カード枠内の複製
- [x] web: `@1`→`@2` 昇格と `loop` の往復、既定時の省略
- 完了条件: `npm run typecheck` と `npm test` が通る。

### [x] L5 文書

- [x] `docs/mvp/content-schema.md` のテンプレート表へ `@2` を追記する
- [x] ユーザーガイドへ操作を追記する
- 完了条件: 仕様・契約・実装が一致する。
