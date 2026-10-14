# 表の正本は自前の小さな構造化JSONとし描画と編集を分離する

`table.simple@1` の正本は、自前の小さな構造化JSON（列定義・行・強調・スタイル名・登場指定）とする。CSV・Markdownの表・HTMLは正本にしない。CSVは編集時の貼り付け入口としてJSONへ変換するだけとする。詳細は [../table-template/spec.md](../table-template/spec.md)。

理由は、表に後から必要になるもの（列ごとの型・揃え・数値書式、セルや行の強調、行ごとの登場）がCSV・Markdownでは表せないため。HTMLを入力可能にすると、信頼済みテンプレートだけを実行する方針（[ADR-0030](./0030-composite-visual-template-isolation.md)）と衝突するため。

データ（`data.columns`・`data.rows`）・意味と書式（`type`・`format`・`align`）・見た目（`style.preset` と少数の上書き）・登場（`reveal`）を分ける。色は生値ではなくテーマのトークン名で指定する。プリセットの中身（配色・動きの具体値）はアプリのコードに持ち、JSONには名前だけを保存する。未知のプリセット名は既定へフォールバックし、保存済みJSONの解釈を変えない。

強調（`emphasis`）は位置指定の見た目のため本来は `style` 寄りだが、グリッド編集の一体性のため `data` 配下に置く。登場の動きは既存の `AnimationPlan`（対象要素ID・preset・ローカル時刻・尺）に翻訳するだけとし、新しいアニメーション機構を持たない。将来の `chart.*`・`flow.*` も「`data` ＋ `style.preset` ＋ `reveal`」の型にそろえる。

## Considered Options

- CSV・Markdownの表を正本にする。→ 列の型・書式・強調・登場が入らず、後からの拡張で破綻するため不採用。
- Frictionless Table Schema や Vega-Lite 等の既存規格をそのまま採用する。→ 命名と考え方は借りるが、動画向けの `reveal` やセリフ連動が入れにくくなるため、規格準拠ではなく自前スキーマとして不採用。
- 強調を `style` 配下に置く。→ 見た目の分離としては純粋だが、セル単位の編集UIが `data` と `style` の2箇所を同時編集することになり複雑化するため、編集一体性を優先して不採用。

## Consequences

- `table.simple@1` の入力Zodスキーマが正本の唯一の定義となる。版の意味は不変に保ち、変更は新版で行う。
- `TemplateFieldSpec` に `table` 種別を追加し、列・行・強調・CSV貼り付けを汎用エディタで扱う。chart・flow追加時にこの部品を使い回す。
