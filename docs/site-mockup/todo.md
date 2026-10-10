# サイトモックアップ 実装TODO

仕様は [spec.md](./spec.md) を正とする。`scene.site-mockup@1` をフレーム型で追加し、その後に table/chart 系へ進む。

- [x] `scene.site-mockup@1` を追加: `variant`(enum, 初期セット)、`screen`(nestedMedia)、`theme`(light/dark)、`name`/`handle`/`url`/`caption`(optionalText)、`logo`(nestedMedia)、`animation`。`layers: ["card","overlay"]`
- [x] `inputFields` を定義し、汎用Cueエディタで編集できるようにする（エディタ個別実装を追加しない）
- [x] 画面の描画は共通の `NestedVisual` レンダラ（`renderNested`）を再利用する
- [x] 各 variant の汎用スタイル（配色・ヘッダ構成）を実装。ロゴは同梱せず、`logo` 指定時のみ利用者素材を重ねる
- [x] `collectAssetRefs` に `screen` と `logo` を追加し、素材種別を検証する
- [x] `variant` の加算的enum追加方針をADR 0033に記録し、既存 variant の不変性をテストする
- [x] テスト: variant別のスキーマ検証、複数モックアップのID/CSS/AnimationPlan衝突、画像・動画の保存→プレビュー→MP4（自動テストまで）
- [x] ドキュメント・ユーザーガイドを更新する
- 完了条件: `scene.site-mockup@1` の画像・動画を `card`/`overlay` で保存、プレビュー、MP4レンダーできる。variant追加が既存描画を変えない。

## その後

- [ ] `table.simple@1`（列定義・行・強調セル）→ `chart.bar@1` → `flow.horizontal@1`。構造化入力（リピータ）UIを設計する
