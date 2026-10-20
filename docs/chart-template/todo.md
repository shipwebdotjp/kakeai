# 棒グラフテンプレート 実装TODO

`chart.bar@1` の実装フェーズ。正とする仕様は [spec.md](./spec.md)。契約は `packages/contracts` が唯一の定義場所。

## フェーズ

### [x] C1 図形アクション語彙

- [x] `AnimationItem` を `action` / `axis` / `ease` に再整理し、`grow` と有限easeを追加
- [x] `table.simple`・`scene.device-frame`・`scene.site-mockup` を移行
- 完了条件: 既存テンプレの描画が変わらず、図形アクションがコンパイラで写像される。

### [x] C2 契約

- [x] `chartDataSchema`・`chartBarInputSchema`・`chartBarV1` の追加・登録
- [x] `TemplateFieldSpec.table` を `grid`（`emphasis?`付き）へ共通化
- [x] グラフのあふれ警告（カテゴリ・系列・負値・登場尺）
- 完了条件: `isEditableTemplate("chart.bar", 1)` が真で、不正入力が拒否されるテストが通る。

### [x] C3 描画

- [x] `chart-bar` レンダラ（グループ棒・値軸/目盛り・値/カテゴリラベル・凡例・配色・grow）
- [x] コンパイラの dispatch とグラフCSS
- 完了条件: 保存→プレビュー→レンダーで棒グラフが表示され、シークとMP4が一致する。

### [x] C4 編集UI

- [x] `grid` 共通化（強調UIを非表示にして棒グラフでも再利用）と chart 固有フィールド
- 完了条件: Cue一覧から棒グラフを追加・編集・保存できる。

### [x] C5 文書・公開

- [x] `docs/mvp/content-schema.md` の `chart.bar@1` 行を対応済みに更新
- [x] ADR の追加
- [x] `user-guide/docs/` の更新
- 完了条件: 仕様・契約・ガイドが一致する。
