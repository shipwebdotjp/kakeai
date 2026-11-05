# 折れ線グラフテンプレート TODO

[spec.md](./spec.md) と [roadmap.md](./roadmap.md) を正とする。`chart.line@1` は実装済みである。契約の唯一の実装場所は `packages/contracts` とする。

## 設計・記録

- [x] `chart.line@1` を `chart.bar@1` から分離し、等間隔カテゴリの推移だけを初期対象にする。
- [x] `allSeries` / `seriesKey` / `categoryKey` による意味参照を採用し、個別点を配列添字で参照しない。
- [x] `fit` 軸、直線パス、自前のパス長計算、描画ヘッドに追従する点マーカーを決定する。
- [x] `draw` / `fade` の登場、カテゴリ・個別点を含む強調、値ラベル既定オフを決定する。
- [x] [ADR-0057](../adr/0057-figure-animation-action-vocabulary.md) が `draw` の図形アクション追加を既に予見していることを確認した。既存決定の反転ではないため、この設計記録だけを目的としたADRは追加しない。

## L1: 契約と共有ロジック

- [x] `packages/contracts` に `chartLineDataSchema`、スタイル・target・effect・入力スキーマ、`chartLineV1` を追加する。
- [x] カテゴリの非空・一意、最小2／最大8カテゴリ、1〜4系列、有限値、書式・軸単位、意味参照target、効果の組合せを保存時に検証する。
- [x] `FigureAction` とコンパイラの図形アクションへ `draw` を追加する。既存 `chart.bar@1` の入力・解釈・出力を変えない。
- [x] nice ticks、同値域のフォールバック、座標・パス長・マーカー時刻を導出する共有関数を置き、レンダラーと警告で二重実装しない。
- [x] VisualTemplate registry、入力JSON Schema、Agent schema digest、`collectLineRefs` に登録する。
- 完了条件: 受理・拒否、導出、既存テンプレート不変の契約テストが通る。

## L2: レンダラーと効果

- [x] `packages/video` に折れ線レンダラーを追加し、SVG path・マーカー・値軸・凡例・値ラベル・幅・テーマ色を描く。
- [x] `draw` を、出力座標から求めた破線長と累積長で実装し、`getTotalLength()` を使わない。
- [x] targetごとの `appear` / `emphasize` / `value`、spotlight、カテゴリ・個別点のonsetを実装する。
- [x] 値ラベルの決定的オフセットと、重なり警告を実装する。
- [x] CSS、コンパイラdispatch、スコープIDを追加する。
- 完了条件: 代表入力と境界入力で、プレビューとMP4の描画・シークが一致する。

## L3: 編集UI

- [x] グリッドを折れ線データとして編集できるようにし、カテゴリの重複・空値・欠損・混在書式を保存前に明示する。
- [x] カテゴリ値・系列キーの変更を、対応する効果targetへ同じ編集として反映する。
- [x] 行・系列の削除時に影響する効果を表示し、確認後に同時削除する。直接JSON・CSV全置換では対象の自動修復を行わず、保存エラーとして示す。
- [x] `allSeries` / `series` / `category` / `point` と許可効果だけを選べるEffects UIを追加する。
- [x] 新規Cueに最小の有効グリッドと、全系列を600msで描く既定効果を入れる。
- 完了条件: 追加・編集・削除・並べ替え・CSV貼り付け・保存復元で、効果の意図が壊れない。

## L4: 検証と公開文書

- [x] contracts、video、webの振る舞い・境界テスト、代表的なプレビューとMP4の視覚確認を追加する。
- [x] 実装後に [../mvp/content-schema.md](../mvp/content-schema.md)、[../mvp/todo.md](../mvp/todo.md)、[../../user-guide/docs/getting-started/web-ui.md](../../user-guide/docs/getting-started/web-ui.md)、Agent Accessのテンプレートカタログ説明を実際の挙動へ同期する。
- [x] `npm run typecheck`、`npm test`、OCRレビュー、コミットを実施する。
- 完了条件: 保存・プレビュー・MP4・エージェント入力の契約が一致し、利用者向け説明が実装済みの挙動だけを記載する。
