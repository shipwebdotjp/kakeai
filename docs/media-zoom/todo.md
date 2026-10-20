# 背景・カードの拡大率（media zoom） 実装TODO

[仕様](./spec.md) を正とする。

## フェーズ

### [x] Z1 契約とレンダー

- [x] `mediaZoomSchema`（`0.5〜3`）を追加し、`media.full-bleed@1`・`media.card@1` の入力へ任意 `zoom` を追加する
- [x] `mediaCrop` フィールドに `zoomKey: "zoom"` を設定する
- [x] `mediaCropStyle` で `transform: scale` と `transform-origin` を出力する（`zoom` 未指定時は出力しない）
- [x] カードに `.kakeai-cardmedia-clip` のクリップ枠を追加し、拡大メディアを見出し・補足文へはみ出させない
- 完了条件: `zoom` 指定で背景・カードの中のメディアだけが焦点基準で拡大・縮小され、未指定時は従来どおり描画される。

### [x] Z2 編集UI

- [x] フォーム内部キー `${key}__zoom` で拡大率を復元・組み立てする
- [x] 未指定はUI上100%、等倍に戻すで `zoom` を省略、`50〜300%` の範囲外・非数値は保存前エラー
- [x] 焦点位置コントロールに倍率スライダー（`50〜300`、`step=1`、百分率表示）を追加する
- 完了条件: 背景・カードで拡大率を編集し、ドラフトプレビュー・保存・レンダーへ反映できる。

### [x] Z3 テストと文書

- [x] `packages/contracts` / `apps/web` / `packages/video` のテストを追加する
- [x] `docs/focal-point/spec.md`、`docs/mvp/content-schema.md`・`spec.md`・`roadmap.md`・`todo.md`、`docs/composite-visuals/spec.md`、ユーザーガイドを更新する
- 完了条件: `npm run typecheck` と `npm test` が通り、文書が実装と一致する。
