# 表テンプレート（`table.simple@1`）仕様

## 目的と境界

この文書は、構造化データを信頼済み `VisualTemplate` へ渡して表を描画する `table.simple@1` の正とする。台本の契約は [../mvp/content-schema.md](../mvp/content-schema.md)、HTTP契約は [../mvp/api-contract.md](../mvp/api-contract.md)、編集画面の方針は [../editor/spec.md](../editor/spec.md) を正とする。

- 正本は自前の小さな構造化JSONとする。CSV・Markdownの表・HTMLは正本にしない。CSVは編集時の貼り付け入口としてJSONへ変換するだけとする。
- JSONには「データ＋意味・書式＋プリセット名と少数の上書き」だけを保存し、プリセットの中身（配色・動きの具体値）はアプリのコードに持つ。未知のプリセット名は既定へフォールバックし、保存済みJSONの解釈を変えない。
- 色は生のカラーコードではなくテーマのトークン名で指定し、テーマ切替に追従する。
- セル内テキストはプレーンテキストに限り、太字・リンク・HTMLは入れない。
- 動きは「Cue内の経過時間を渡すと状態が決まる」既存の `AnimationPlan`（対象要素ID・preset・ローカル時刻・尺）で表し、ランダムや実時間に依存させない。プレビューのシークとMP4が一致する。
- 将来の `chart.*`・`flow.*` も「`data` ＋ `style.preset` ＋ `reveal`」の型にそろえ、エディタ部品を使い回す。

## 入力契約

`table.simple@1` の `visualCue.input` は次を満たす。

```jsonc
{
  "caption": "料金プラン",                        // 任意。表の見出し
  "data": {
    "columns": [
      { "key": "name",  "label": "プラン", "type": "text",   "align": "left" },
      { "key": "price", "label": "月額",   "type": "number", "align": "right", "format": "currency" }
    ],
    "rows": [
      { "name": "Free", "price": 0 },
      { "name": "Pro",  "price": 1500 }
    ]
  },
  "style": {
    "preset": "clean",            // clean | striped | bordered
    "zebra": true,                // プリセットの上書き。省略時はプリセット既定
    "headerAccent": "primary"     // primary | secondary | tertiary。省略時はテーマ既定
  },
  "effects": [
    {
      "target": { "kind": "rows" },                         // row | cell | rows | columns
      "trigger": { "kind": "cue" },                         // cue | lines
      "effect": { "kind": "appear", "preset": "fade", "durationMs": 400, "staggerMs": 150 }
    },
    {
      "target": { "kind": "row", "index": 1 },
      "trigger": { "kind": "lines", "startLineId": "line-1", "endLineId": "line-2" },
      "effect": { "kind": "emphasize", "style": "frame", "tone": "primary" }
    }
  ]
}
```

- `columns[].key` は行オブジェクトのキーと対応する識別子で、`columns` 内で一意とする。`key` は `[A-Za-z0-9_-]` の1〜64文字とする。
- `rows` は「列キー→値」のオブジェクト配列とする。値は文字列または数値のみとする。列定義に無いキーは空セルとして扱い、欠けたキーは空セルとする。
- `columns[].type` は `text | number` とする。`align`（`left | center | right`）の既定は型から導出する（text→left、number→right）。`format` は number 列だけが持ち、`integer | decimal | percent | currency` とする（省略時はそのまま表示）。`percent` は比率（0.25→25%）と解釈し、`currency` はJPY・小数なしと解釈する。数値整形は `ja-JP` ロケールでコンパイル時に静的HTML化する。
- `effects` は行トリガー付きの `appear`／`emphasize` を持つ。target は `row`（行番号）・`cell`（行番号と列キー）・`rows`（全行）・`columns`（全列）を指す。`trigger` は `cue`（Cue全体）または `lines`（同じSceneのセリフ区間）。`appear` は登場、`emphasize` は枠・背景の強調。セリフの実時間は音声尺から解決する。詳細は [../cue-effects/spec.md](../cue-effects/spec.md) を正とする。
- 列数は最大 `8`、行数は最大 `12`、効果は最大 `32` をスキーマで強制する。フォントサイズはテンプレート契約として固定し、行数超過で描画時に黙って縮小しない。超過の目安は警告（`meta.warnings`）で返す。

## テンプレート定義

| 項目 | 値 |
| --- | --- |
| `id@version` | `table.simple@1` |
| `layers` | `overlay` |
| `transitionPolicy` | 既定（入退場はCue側） |
| `animationPolicy` | 既定（内部アニメは `effects` が `AnimationPlan`／`stateIntervals` を返す） |
| `collectAssetRefs` | 素材を使わないため空 |
| `collectLineRefs` | `effects[].trigger` の行参照を収集する |

`inputFields` は次を持ち、編集画面はこれを解釈してフォームを生成する。テンプレートを追加してもエディタのコードを増やさない規約は維持する。

| key | kind | 内容 |
| --- | --- | --- |
| `caption` | optionalText | 表の見出し |
| `data` | grid | 列・行の一括編集。CSV貼り付けからの変換入口（`dataKind: "table"`） |
| `style.preset` | select | clean / striped / bordered |
| `style.headerAccent` | select（任意） | primary / secondary / tertiary |
| `style.zebra` | boolean | ゼブラの上書き |
| `effects` | effects | 行トリガー付きの登場・強調（`variant: "table"`） |

`grid` フィールド種別は `{ kind: "grid", key, label, maxColumns, maxRows, dataKind }` とし、`data` オブジェクトを編集する。`dataKind` は `table | chart` で、検証に使うスキーマを選ぶ。`effects` フィールド種別は target・trigger・effect を編集する（[../cue-effects/spec.md](../cue-effects/spec.md)）。新規Cueには2列の雛形と、全行をフェードで登場させる既定効果を入れる。

## CSV貼り付け

- 先頭行を見出し（列ラベル）として取り込み、列キーは `col1`、`col2`、…と採番する。
- 列の値は空を除いてすべて数値として解釈できるとき `number` 列、そうでなければ `text` 列とする。
- ダブルクォート囲みと改行・カンマのエスケープに対応する最小のCSV解釈とする。TSVやMarkdown表は対象外とする。
- 上限超過は取り込まず、件数を切り捨てた旨を利用者に表示する。

## レンダリング

- `effects` のみが内部アニメを生む。`appear` は対象を `AnimationPlan` として登場させ、グループtarget（`rows`/`columns`）では `startMs = index × staggerMs` でずらす。`emphasize` は `stateIntervals` として対象の区間中だけ強調し、区間末で元に戻す。
- 強調は行全体またはセルにテーマ由来の背景色（`style: background`）または枠（`style: frame`）を付け、背景の文字色はコントラストの取れる側を選ぶ。
- 見出し行はテーマのアクセント色で装飾する。表本体はテーマの surface・border・text を使い、9:16テンプレート将来対応のため出力ピクセルではなく相対配置で描く。
- 同一テンプレートの複数配置・入れ子で要素ID・AnimationPlan・stateIntervalsが衝突しないことをコンパイラテストで確認する。

## 受け入れ条件

- 列定義・行・効果を持つ表を保存し、プレビューでシークし、MP4をレンダーできる。
- 列キーの重複、範囲外の効果 target、許可外の `preset`・`format`・`tone`、上限超過の列数・行数を拒否する。
- セル文字数・行数の目安超過を `meta.warnings` で返す（拒否しない）。
- CSV貼り付けで行列・型推論が成立し、上限超過は切り捨てを表示する。
