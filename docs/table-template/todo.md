# 表テンプレート 実装TODO

`table.simple@1` の実装フェーズ。正とする仕様は [spec.md](./spec.md)。契約を先に固め、`packages/contracts` がZodスキーマと型の唯一の定義場所。

## フェーズ

### [x] T1 契約

- [x] `table.simple` の入力Zodスキーマ（caption / data / style / reveal）と `tableSimpleV1` 定義・登録
- [x] `TemplateFieldSpec` に `table` 種別（key / label / maxColumns / maxRows）を追加
- [x] 表のあふれ警告（セル文字数・行数の目安）を `computeContentWarnings` に追加
- 完了条件: `isEditableTemplate("table.simple", 1)` が真で、不正入力が拒否されるテストが通る。

### [x] T2 描画

- [x] `packages/video` に `table-simple` レンダラ（整形・揃え・エスケープ・強調・`AnimationPlan`）
- [x] コンパイラの dispatch と表CSSの追加
- 完了条件: 保存→プレビュー→レンダーで表が表示され、シークとMP4が一致する。

### [x] T3 編集UI

- [x] `form.ts` の `table` フィールド対応（JSON文字列の保持・検証・雛形）
- [x] `TableField`（列・行・型・揃え・書式・セル強調・CSV貼り付け）
- 完了条件: Cue一覧から表を追加・編集・保存できる。

### [x] T4 文書・公開

- [x] `docs/mvp/content-schema.md` の `table.simple@1` 行を対応済みに更新
- [x] ADR の追加
- [x] `user-guide/docs/` の更新
- 完了条件: 仕様・契約・ガイドが一致する。
