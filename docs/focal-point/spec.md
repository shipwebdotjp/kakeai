# 背景・カードの焦点位置 仕様

## 目的と境界

この文書は、ロードマップ Phase 1「編集表現の拡張」のうち、背景 `media.full-bleed@1` とカード `media.card@1` の焦点位置（`focalPoint`）を編集する範囲の正とする。台本の正本JSON契約は [../mvp/content-schema.md](../mvp/content-schema.md)、HTTP契約は [../mvp/api-contract.md](../mvp/api-contract.md) を正とする。

- `focalPoint` は既存の正規化座標 `{ x, y }`（各 `0..1`）をそのまま編集する。新しいフィールドは追加しない。
- 画像・動画とも同じ焦点位置を、そのCueの全表示区間へ適用する。
- 拡大率（ズーム）は [../media-zoom/spec.md](../media-zoom/spec.md) を正とし、同じコントロールに併設する。
- `scene.device-frame@1`・`scene.site-mockup@1` などの `nestedMedia` は対象外（読み取り専用で非破壊に保持する）。

## データ

`focalPoint` は `media.full-bleed@1` と `media.card@1` の任意入力で、`fit: cover` 時に中央クロップの代わりに使う。未指定時は中央 `{ "x": 0.5, "y": 0.5 }` と解釈する。

```json
{
  "assetId": "asset-background-1",
  "fit": "cover",
  "focalPoint": { "x": 0.2, "y": 0.8 }
}
```

- クロップ位置は出力ピクセルではなく正規化座標で指定し、レンダラーは `object-position` へ写像する。
- `focalPoint` は任意とする。両軸が未指定なら省略し、中央クロップを使う。
- `fit: contain` でも値は保持・編集できるが、主用途は `cover` の切り抜き位置調整である。

## 編集UI

- 対象テンプレートの入力フォームに **焦点位置** コントロールを表示する。横・縦の2本のスライダー（`0..100`、`step=1`）と現在の百分率、**中央に戻す** を出す。
- 未指定のときはUI上だけ横50%・縦50%として表示する。保存値は省略のまま維持する。
- 初回のスライダー操作では、未指定のもう一軸を中央値50%で補完して両軸を確定する。
- **中央に戻す** は両軸を未指定に戻し、保存時に `focalPoint` を省略する。
- 片軸だけが入力された場合、または `0..100%` の範囲外・非数値は保存前エラーにする。
- 編集後の `object-position` は、保存前のドラフトプレビューで確認できる。

## フィールド仕様

編集画面はテンプレート定義の `inputFields` からフォームを生成する（[../composite-visuals/spec.md](../composite-visuals/spec.md)）。

- `TemplateFieldSpec` に `{ kind: "mediaCrop"; key; label; zoomKey? }` を追加する。`key` は対象の入力プロパティ（`focalPoint`）。
- `zoomKey` は拡大率入力のプロパティ名を指す（[../media-zoom/spec.md](../media-zoom/spec.md)）。
- フォーム内部キーは `${key}__x` / `${key}__y`（拡大率は `${key}__zoom`）を使い、保存値の `focalPoint` オブジェクトへ組み立てる。
- 所有テンプレートは `media.full-bleed@1` と `media.card@1`。`media.card@1` は `fit` 入力を持たず、CSSで `object-fit: cover` を固定する。
