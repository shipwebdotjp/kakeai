# Visual Theme 基盤 実装TODO

仕様は [spec.md](./spec.md) を正とする。`soft-editorial@1` を唯一の組み込みテーマとして、正本・プレビュー・レンダー・既存VisualTemplateへ接続する。

- [x] `packages/contracts` にVisual Themeの版付きレジストリ、参照スキーマ、トークン型を追加する（`src/content/theme.ts`）
- [x] `soft-editorial@1` を定義する（canvas・accents・surface系・scrim/shadow・radius・motion・semantic・categoryColors・role別文字トークン・artDirection）
- [x] ContentDocument の `schemaVersion: 1` の基準契約に必須 `visualTheme` を含め、未知参照を拒否する
- [x] `Scene.accentColor` を `accent` union（`{kind:"theme",token}`/`{kind:"custom",color}`）へ置換する
- [x] 旧版の読出し移行を削除する（[ADR-0061](../adr/0061-template-version-as-reinterpretation-boundary.md)）
- [x] `packages/video` でテーマ解決（root CSS変数・`RenderContext`）、Scene背景・字幕・Text Cue・カード・端末枠・立ち絵・Nested Visualへ適用する。サイト固有色は維持する
- [x] `text.block` を `Cue明示値 → theme role既定 → template fallback` の順にプロパティ単位で解決する
- [x] Render Jobの既存v5スナップショットを読出し移行で実行できるようにする（snapshot schema versionは変更しない）
- [x] Web編集でテーマ選択を表示せず、Sceneごとにテーマアクセント3色または自由色を選べるようにする。Text Cueの「既定」はテーマのrole別スタイルを使う旨を表示する
- [x] 契約・コンパイラ・API/統合・Webのテストを追加する
- [x] `docs/adr/0040-visual-theme-contract.md`、`CONTEXT.md`、MVP仕様・content schema・ロードマップ・API契約・ユーザーガイドを更新する
- 完了条件: 新規Workがv6＋`soft-editorial@1`で作成でき、旧v5台本・旧Render Job snapshotの取得・保存・プレビュー・レンダーが通り、`npm run typecheck` と `npm test` が通る。
