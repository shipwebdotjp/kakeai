# 棒グラフテンプレート（`chart.bar@1`）仕様

## 目的と境界

この文書は、構造化データを信頼済み `VisualTemplate` へ渡して棒グラフを描画する `chart.bar@1` の正とする。台本の契約は [../mvp/content-schema.md](../mvp/content-schema.md)、表の共通部分は [../table-template/spec.md](../table-template/spec.md) を正とする。

- `table.simple@1` と同じ層構成（`data` ＋ `style.preset` ＋ `reveal`）にそろえ、データ形状は `{ columns, rows }` を共有する。先頭の `text` 列をカテゴリ、残りの `number` 列を系列として解釈する。
- 正本は自前の小さな構造化JSONとし、プリセット名と少数の上書きだけを保存する。色はテーマのトークン・パレットから解決し、生値を持たない。
- 登場の動きは、テンプレートが返す `AnimationPlan`（対象要素ID・図形アクション・ローカル時刻・尺）で表す。コンパイラだけがGSAPタイムラインを生成し、ランダムや実時間に依存させない。
- 目盛り・軸ラベル・凡例はテンプレート側の決定的な計算で描く。

## 入力契約

```jsonc
{
  "title": "月別売上",                          // 任意。グラフのタイトル
  "data": {
    "columns": [
      { "key": "month", "label": "月",   "type": "text" },
      { "key": "sales", "label": "売上", "type": "number", "format": "currency" },
      { "key": "cost",  "label": "費用", "type": "number", "format": "currency" }
    ],
    "rows": [
      { "month": "1月", "sales": 120, "cost": 80 },
      { "month": "2月", "sales": 200, "cost": 95 }
    ]
  },
  "style": {
    "preset": "clean",          // clean | grid
    "orientation": "vertical",  // vertical | horizontal
    "valueLabels": true,
    "colorBy": "series",        // series | category（省略時: 系列1本なら category、複数なら series）
    "axisUnit": ""              // 目盛りラベルに付ける任意の単位
  },
  "effects": [
    {
      "target": { "kind": "bars" },                    // category | series | bars
      "trigger": { "kind": "cue" },                    // cue | lines
      "effect": { "kind": "appear", "preset": "grow", "durationMs": 600, "staggerMs": 120 }
    }
  ]
}
```

- `columns[0]` は `text`（カテゴリ）に限り、`columns[1..]` は `number`（系列）に限る。系列数は最大4、カテゴリ（行）は最大8、`columns` は最大5。スキーマで強制する。
- 値ラベルは系列の `format`（`integer | decimal | percent | currency`）で整形する。目盛りは、全系列の `format` が同じときはその `format`、異なるときはそのまま表示し、`axisUnit` を末尾に付ける。
- `colorBy` が `series` のとき系列ごと、`category` のときカテゴリごとに `VisualTheme.categoryColors` を巡回して割り当てる。
- 負値は0として描画し、警告（`chart_negative_value`）を返す。保存は拒否しない。
- `effects` は行トリガー付きの `appear`（`grow`／`bounce`／`fade`）と `emphasize`（`frame`／`spotlight`、任意の `onset`）、`value`（値ラベルのカウント）を持つ。target は `category`（カテゴリ番号）・`series`（系列番号）・`bars`（全棒）を指す。`durationMs` は `animationPolicy.maxDurationMs` でクランプし、ずらしはカテゴリ単位とする。棒の色を上書きしないよう `emphasize.style: background` は保存時に拒否する。`spotlight` の兄弟は同じ棒グラフ内の他の棒。`value` は値ラベルが有効なときだけ効果を出し、書式は系列の `format` を使う。共通単位の契約は [../cue-effects/spec.md](../cue-effects/spec.md) を正とする。

## 図形アクション

`effects.effect.preset` は、テンプレートの `AnimationPlan` の図形アクションへ写像する。

| preset | action | ease | 内容 |
| --- | --- | --- | --- |
| `grow` | `grow` | `normal` | 基準線から伸ばす |
| `bounce` | `grow` | `overshoot` | 伸ばして跳ねる |
| `fade` | `fade` | `normal` | フェードで出す |

- `grow` の軸は `style.orientation` に従い、縦棒は `scaleY`、横棒は `scaleX`。`transform-origin` はテンプレートCSSが持つ。
- `bars` target のずらしはカテゴリ単位（`startMs = カテゴリindex × staggerMs`）。同一カテゴリの系列は同時に伸びる。
- `emphasize` は対象の棒にリング（`stateIntervals`）を付け、`spotlight` では他の棒を `filter` で減光する。`onset` は対象の棒内の一時オーバーレイに発火を当てる。
- `value` は各棒の値ラベルを `from`（既定0）から値へカウントする。書式は系列の `format` を使う。
- 効果がなければ内部アニメを返さない。

## 値軸と凡例

- 値軸は `[0, niceMax]`。`niceMax` は決定的な nice-number アルゴリズム（おおよそ5本の目盛り）で丸める。
- 目盛り線は 0 を棒の基準線（カテゴリ帯の上端）に置き、数値ラベルの左ガターより右（バー領域の左端）から描く。数値と線は重ねない。
- 最大値の値ラベルが凡例に重ならないよう、プロットの上に余白を確保する。横棒では値ラベルのぶんを右側のガターとして確保する。
- 横棒の目盛り線も 0 をバーの左端（カテゴリ名ガターの右）に置き、目盛り線と数値ラベルを重ねない。
- タイトルはテーマの `heading`、目盛り・凡例・カテゴリ名・値ラベルは `body` のフォントを使う。

## テンプレート定義

| 項目 | 値 |
| --- | --- |
| `id@version` | `chart.bar@1` |
| `layers` | `card`, `overlay` |
| `transitionPolicy` | 既定（入退場はCue側） |
| `animationPolicy` | 既定（内部アニメは `effects` が `AnimationPlan`／`stateIntervals` を返す） |
| `collectAssetRefs` | 素材を使わないため空 |
| `collectLineRefs` | `effects[].trigger` の行参照を収集する |

`inputFields` は次の通り。`data` は編集画面の `grid` フィールド（`dataKind: "chart"`）が編集する。

| key | kind | 内容 |
| --- | --- | --- |
| `title` | optionalText | タイトル |
| `data` | grid | カテゴリ＋系列のグリッド。CSV貼り付け対応 |
| `style.preset` | select | clean / grid |
| `style.orientation` | select | vertical / horizontal |
| `style.colorBy` | select（任意） | series / category |
| `style.axisUnit` | optionalText | 軸の単位 |
| `style.valueLabels` | boolean | 値ラベル |
| `effects` | effects | 行トリガー付きの登場・強調・数値カウント（`variant: "chart"`） |

新規Cueには、全棒を伸ばす既定効果を入れる。

## 受け入れ条件

- カテゴリ・系列・値を持つ棒グラフを保存し、プレビューでシークし、MP4をレンダーできる。
- 系列ごとに色が分かれ、複数系列では凡例が出る。値ラベル・目盛りが系列の書式で整形される。
- `grow`・`bounce`・`fade` の登場が、プレビューのシークとMP4で一致する。
- `value` の値ラベルカウントが、プレビューのシークとMP4で一致する。
- `emphasize`（`frame`／`spotlight`）と `onset` が、プレビューのシークとMP4で一致する。`background` 強調は保存時に拒否する。
- 先頭列がカテゴリでない、系列が数値でない、範囲外の効果 target、上限超過の場合を拒否する。
- 負値・カテゴリ/系列の目安超過を `meta.warnings` で返す（拒否しない）。
