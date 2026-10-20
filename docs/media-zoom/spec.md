# 背景・カードの拡大率（media zoom） 仕様

## 目的と境界

この文書は、背景 `media.full-bleed@1` とカード `media.card@1` の**中の画像・動画**を拡大・縮小する拡大率（`zoom`）の正とする。焦点位置は [../focal-point/spec.md](../focal-point/spec.md) を正とし、本仕様はその入力に拡大率を併設する。台本の正本JSON契約は [../mvp/content-schema.md](../mvp/content-schema.md) を正とする。

- 拡大率は**中のメディアだけ**に適用する。背景の全面フレーム、カードの矩形サイズ（`aspect-ratio`・640px）と見出し・補足文の配置は変えない。
- 画像・動画とも同じ拡大率を、そのCueの全表示区間へ適用する。
- `scene.device-frame@1`・`scene.site-mockup@1` などの `nestedMedia` は対象外（読み取り専用で非破壊に保持する）。
- 契約は任意フィールドの追加であり、既存の保存済みJSONはそのまま満たす。`schemaVersion` は上げない。

## データ

`zoom` は対象テンプレートの任意入力で、省略時は等倍 `1` と解釈する。焦点位置 `focalPoint` とは独立に指定できる。

```json
{
  "assetId": "asset-background-1",
  "fit": "cover",
  "focalPoint": { "x": 0.2, "y": 0.8 },
  "zoom": 1.5
}
```

- `zoom` は `0.5〜3`（50%〜300%）の数値。省略時は等倍。
- 拡大率はクロップの拡大倍率として扱う。`focalPoint` を中心に拡大する。
- `focalPoint` が未指定なら中央を中心にする。
- `fit: contain` でも値は保持・編集できるが、主用途は `cover` の切り抜き拡大である。

## レンダリング

- レンダラーは `object-position`（焦点位置）に加えて、`transform: scale(zoom)` と `transform-origin: <x>% <y>%`（焦点基準）を出力する。`zoom` 未指定時は transform を出力しない。
- 背景 `media.full-bleed@1` は `#kakeai-root` の `overflow: hidden` でクリップされるため、追加の枠は要らない。
- カード `media.card@1` は、メディア矩形と同じサイズのクリップ枠 `.kakeai-cardmedia-clip`（`overflow: hidden`、角丸、影）で包み、その中の `.kakeai-cardmedia` を 100% で敷いて拡大する。これにより、拡大したメディアが見出し・補足文へはみ出さない。
- `zoom < 1` では矩形とメディアの間にすき間ができ、シーンの背景が見える。これは許容する。

## 編集UI

- 焦点位置コントロール（`mediaCrop`）に **倍率** スライダー（`50〜300`、`step=1`）を併設し、現在の百分率を表示する。
- 未指定のときはUI上だけ100%として表示し、保存値は省略のまま維持する。
- **等倍に戻す** は拡大率を未指定に戻し、保存時に `zoom` を省略する。
- 拡大率の編集は焦点位置の有無と独立で、片方だけを指定できる。`50〜300%` の範囲外・非数値は保存前エラーにする。
- 編集後の見え方は、保存前のドラフトプレビューで確認できる。

## フィールド仕様

- `TemplateFieldSpec` の `mediaCrop` が持つ `zoomKey`（対象は `zoom`）で、同じコントロールが拡大率を編集する。`zoomKey` を持たないテンプレートでは倍率スライダーを表示しない。
- フォーム内部キーは `${key}__zoom` を使い、保存値の `zoom` 数値へ組み立てる。
- 所有テンプレートは `media.full-bleed@1` と `media.card@1`。
