# 背景・カードの焦点位置 実装TODO

[仕様](./spec.md) を正とする。

## フェーズ

### [x] F1 契約とレンダー

- [x] `media.full-bleed@1`・`media.card@1` の `inputFields` に `mediaCrop`（`key: focalPoint`）を登録する
- [x] 既存の `object-position` 写像（`focalPointStyle`）をそのまま使い、レンダラーは変更しない
- 完了条件: 両テンプレートが焦点位置フィールドを公開し、指定座標どおりに描画される。

### [x] F2 編集UI

- [x] フォーム内部キー `${key}__x` / `${key}__y` で `focalPoint` を復元・組み立てする
- [x] 未指定はUI上50%/50%、初回操作で残りの一軸を中央値補完、中央リセットで `focalPoint` を省略する
- [x] 片軸のみ・範囲外・非数値は保存前エラーにする
- [x] 汎用Cueフィールドに焦点位置コントロール（横・縦スライダー、百分率、中央に戻す）を追加する
- 完了条件: 背景・カードで焦点位置を編集し、ドラフトプレビュー・保存・レンダーへ反映できる。

### [x] F3 テストと文書

- [x] `packages/contracts` / `apps/web` / `packages/video` のテストを追加する
- [x] `docs/mvp/spec.md`・`content-schema.md`・`roadmap.md`・`todo.md`、`docs/composite-visuals/spec.md`、ユーザーガイドを更新する
- 完了条件: `npm run typecheck` と `npm test` が通り、文書が実装と一致する。

## 後続（別プラン）

- 拡大率（ズーム）。`mediaCrop` の `zoomKey` を使い、`transform: scale` とカードのクリップ枠を追加する。`1` 未満も許可する。
