# 折れ線グラフテンプレート（`chart.line@1`）仕様

## 状態・目的・境界

この文書は、今後追加する `chart.line@1` の正とする。**本書を追加した時点ではテンプレートは未実装であり、レジストリ・台本スキーマ・Web UI・レンダラーには存在しない。** 実装完了時にだけ [../mvp/content-schema.md](../mvp/content-schema.md) のVisualTemplate表とユーザーガイドを対応済みに更新する。

対象は、等間隔に並ぶカテゴリに対する1〜4本の数値系列の推移である。日付や数値の間隔をX軸へ反映する時系列ではない。台本の正本JSONは [../mvp/content-schema.md](../mvp/content-schema.md)、Cue効果の共通単位は [../cue-effects/spec.md](../cue-effects/spec.md)、図形アクションの方針は [ADR-0057](../adr/0057-figure-animation-action-vocabulary.md) を正とする。

- UIでは棒グラフと同じ「グラフ」カテゴリへ置けるが、保存するテンプレートIDは既存の `chart.bar@1` と分け、`chart.line@1` とする。棒グラフの入力・描画・版は変えない。
- 正本は列・行・少数のスタイル・効果からなる構造化JSONとし、SVG path、座標、色の生値、任意CSSやkeyframeを保存しない。
- 線は直線だけで結ぶ。曲線補間は中間の極値を作り得るため初期対象外とする。
- X軸は行配列順に等間隔で置く。カテゴリの文字列を日付や数値として自動解釈しない。
- 値軸は値域に合わせた `fit` だけを持つ。`0`始まり、手動範囲、第二軸は持たない。

## 入力契約

```jsonc
{
  "title": "月別売上", // 任意
  "data": {
    "columns": [
      { "key": "month", "label": "月", "type": "text" },
      { "key": "sales", "label": "売上", "type": "number", "format": "currency" },
      { "key": "plan", "label": "計画", "type": "number", "format": "currency" }
    ],
    "rows": [
      { "month": "1月", "sales": 120, "plan": 100 },
      { "month": "2月", "sales": 150, "plan": 130 }
    ]
  },
  "style": {
    "preset": "grid", // clean | grid（省略時 clean）
    "width": "wide", // wide | medium | narrow（省略時 wide）
    "valueLabels": false // 省略時 false
  },
  "effects": [
    {
      "target": { "kind": "allSeries" },
      "trigger": { "kind": "cue" },
      "effect": { "kind": "appear", "preset": "draw", "durationMs": 600 }
    }
  ]
}
```

- `columns[0]` はカテゴリ列で、`type: "text"` に限る。カテゴリ値は空白だけでない文字列かつデータ内で一意とする。カテゴリは2〜8件で、1件だけの点グラフは受理しない。
- `columns[1..]` は数値系列で、1〜4本とする。列キーは既存の表契約どおり一意である。
- 数値セルは有限の数値、または有限の数値へ解釈できる空でない文字列に限る。未定義、空文字、非数値は保存時に拒否し、0へ補完しない。負値はそのまま受理して描く。
- 全系列の `format` は一致必須とする。`format` 未指定は同じ未指定どうしだけで混在できる。通貨・割合・件数など、単位の異なる値を同じ値軸で比較しないためである。
- `axisUnit` は `integer` または `decimal` の系列にだけ指定できる。`currency`・`percent` と併用して通貨記号・`%`を重複表示させない。
- `style.width` は [../chart-template/spec.md](../chart-template/spec.md) の棒グラフ・表と同じ `wide` / `medium` / `narrow` を使い、文字や線を縮小せずフレームとプロットの最大幅だけを変える。
- `preset: "clean"` は軸と目盛りラベルを表示し、補助線は控えめにする。`preset: "grid"` は各Y軸目盛りに水平補助線を表示する。
- 折れ線に `orientation`、`colorBy`、面塗りは持たない。系列ごとにテーマの `categoryColors` を巡回して色を割り当て、複数系列では凡例を表示する。
- 点マーカーは常時描画する。値ラベルは既定で非表示とし、`style.valueLabels: true` のときだけ描画する。

## 効果と参照

`trigger.kind: "lines"` はセリフ行を参照する既存のTrigger語彙である。対象側で同じ語を使わず、全系列は `allSeries` と呼ぶ。

| target | 保存値 | 許可する効果 | 意味 |
| --- | --- | --- | --- |
| 全系列 | `{ kind: "allSeries" }` | `appear`、`value` | 全パス・全マーカー・全値ラベル |
| 系列 | `{ kind: "series", seriesKey }` | `appear`、`emphasize`、`value` | 1本の線とその点 |
| カテゴリ | `{ kind: "category", categoryKey }` | `emphasize`、`value` | 同じカテゴリにある全系列の点 |
| 個別点 | `{ kind: "point", categoryKey, seriesKey }` | `emphasize`、`value` | 1つの数値点 |

- `seriesKey` は数値列の `key`、`categoryKey` はカテゴリ列の一意な文字列値である。配列添字をtargetに使わないため、行の並び替えで効果が別の値を指さない。
- UIでカテゴリ値または数値列キーを変更するときは、その値を参照する効果も同じ編集で更新する。行・系列を削除するときは、影響する効果を表示して確認後に同時削除する。直接JSON、CSV全置換、API、エージェント経由の入力では自動修復しない。存在しない `categoryKey` / `seriesKey` を参照する効果は保存時エラーとする。
- `appear` は `allSeries` と `series` にだけ許可する。`preset` は `draw` / `fade` とし、棒向けの `grow` / `bounce` は受理しない。カテゴリ・個別点は登場対象にしない。
- `draw` は対象の各系列を同時に描く。新規Cueには、Cue全体を契機に全系列を600msで描く `draw` 効果を1件入れる。系列を順番に説明するときは、系列別の効果とそれぞれのTriggerを置く。
- `draw` 中の点マーカーは、パスの描画ヘッドがその点へ到達した時点で表示する。最初の点は開始時、以後の点はパス全長に対する累積線分長の割合で現れる。`fade` は対象パスと全マーカーを同時にフェード表示する。効果がないときは線・点マーカーを最終状態で表示する。
- `emphasize.style` は `frame` / `spotlight` に限り、`background` は拒否する。`frame` は系列では線幅・ハロー、カテゴリ・個別点ではリング・ハローに写像する。`spotlight` は対象外の線と点を減光する。`onset` はカテゴリ・個別点だけに許可し、マーカー上の一時的な発火として描く。
- `value` は `valueLabels: true` が必要である。対象の値ラベルを既存の数値書式でカウントする。ラベルを非表示にしたままの暗黙表示はしない。
- 値ラベルは系列ごとの決定的なオフセットで重なりを減らす。収まらない場合も値を自動で隠さず、警告を返す。

## 値軸・レイアウト・決定性

Y軸は、全系列の解析済み数値から次の手順で決める。

1. 最小値と最大値の差を `span` とする。全値が同じときは、`span = max(abs(value) × 0.1, 1)` として、その値を中心に仮の範囲を作る。
2. 範囲の両端へ `span × 0.1` の余白を足す。
3. 余白込みの範囲を5区間程度に割った値以上となる、`1` / `2` / `5 × 10^n` の最小の刻みを選ぶ。
4. 下端をその刻みの切り下げ、上端を切り上げにする。両端を含む等間隔の目盛りを描く。

この規則は同じ入力で同じ軸を返す。値域がゼロをまたぐときだけゼロ目盛り・ゼロ線が範囲へ自然に含まれる。正値だけ・負値だけの `fit` 軸にゼロを強制しない。

- プロット内でカテゴリを等間隔に置き、系列ごとに直線のSVG pathを1本描く。タイトルはテーマの `heading`、軸・凡例・カテゴリ・値ラベルは `body` を使う。
- `draw` 用のパス長は、実際にSVGへ出力する点座標から各直線区間の長さを合計して決める。ブラウザの `getTotalLength()` に依存しない。SVGの破線オフセットと各マーカーの時刻はこの同じ長さから導出する。
- ID、軸、点座標、パス長、効果時刻はCue scope・入力・テーマ・キャンバスからだけ導出する。同じ入力・同じシーク位置でプレビューとMP4は一致しなければならない。

## テンプレート定義

| 項目 | 値 |
| --- | --- |
| `id@version` | `chart.line@1` |
| `layers` | `card`, `overlay` |
| `transitionPolicy` | 既定（入退場はCue側） |
| `animationPolicy` | 既定（内部効果は `AnimationPlan` / `stateIntervals` / `valueAnimations` を返す） |
| `collectAssetRefs` | 空 |
| `collectLineRefs` | `effects[].trigger` の行参照を収集 |

想定する `inputFields` は次のとおり。`data` はグリッドフィールドが編集する。

| key | kind | 内容 |
| --- | --- | --- |
| `title` | optionalText | タイトル |
| `data` | grid | カテゴリ＋系列のグリッド。CSV貼り付け対応 |
| `style.preset` | select | clean / grid |
| `style.width` | select | wide / medium / narrow |
| `style.axisUnit` | optionalText | integer / decimal 系列の軸単位 |
| `style.valueLabels` | boolean | 値ラベル（既定オフ） |
| `effects` | effects | 行トリガー付きの折れ線用効果 |

## 非ゴール

- 日付・数値の間隔を反映するX軸、カテゴリ文字列の自動日付解釈。
- 曲線補間、ステップ線、面グラフ、積み上げ、手動Y軸範囲、0始まりの強制、第二軸。
- 欠損値で線を切る表現。初期版では欠損を拒否する。
- 系列ごとの単位・書式の混在、カテゴリ別の色分け、横向きレイアウト。
- カテゴリ・個別点に対する登場アニメーション、全系列・系列へのonset。

## 受け入れ条件

- 2〜8個の一意なカテゴリと1〜4本の同一書式の数値系列を保存し、プレビューとMP4で同じ折れ線を描ける。
- 負値、全値同一、正負をまたぐ値域で、nice ticksを持つ決定的な `fit` 軸を描ける。
- 全系列・系列の `draw` / `fade`、系列・カテゴリ・個別点の強調、表示中値ラベルのカウントが、セリフ行とCueを契機にシーク安全に動く。
- `draw` の線とマーカーの進行がプレビューとMP4で一致し、パス長計算にブラウザAPIへ依存しない。
- 1カテゴリ、重複・空カテゴリ、空・非有限の数値、混在する書式・不正な軸単位、存在しないtarget参照、不許可の効果組合せを保存時に拒否する。
- 行・系列の並べ替え後も、`categoryKey` / `seriesKey` を使う効果が同じ論理データを指す。

## 関連文書

- [todo.md](./todo.md): 実装フェーズ
- [roadmap.md](./roadmap.md): 導入順序と保留事項
- [../chart-template/spec.md](../chart-template/spec.md): 既存の棒グラフ契約
- [../cue-effects/spec.md](../cue-effects/spec.md): Cue効果の共通契約
