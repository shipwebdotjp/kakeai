# Composition Library 実装TODO

[仕様](./spec.md) を正とする。上から順に進め、各フェーズで `npm run typecheck`、`npm test`、OCRレビューを実行し、妥当な指摘を修正してコミットする。

## C1 契約と永続化

- [x] `Composition`、`CompositionDraft`、`CompositionVersion` のZod契約、DTO、Prismaモデル、bundle manifest を追加する
- [x] app data root に draft / immutable bundle の保存領域を追加し、相対 storage key と content hash を検証する
- [x] `composition.full-bleed@1` の入力、Scene背景限定、同一 version の一 ScriptVersion 内一参照を ContentDocument 検証へ追加する
- [x] 完了条件: publish 済み version だけが台本から参照でき、旧 version と bundle は変更されない

## C2 AI draft と publish

- [x] Kakeai 管理の draft を作成、fork、publish する composition library service を追加する
- [x] publish 時に entrypoint、runtime composition ID、1920×1080、有限尺、音声なし、bundle 内依存を検証する
- [x] HyperFrames の通常の check / preview を AI authoring フローへ接続する。外部 import と手動 HTML 編集 API は追加しない
- [x] AI向けauthoringスキル（`skills/kakeai-composition/`、接続・作成・更新・QA・publish・台本参照の手順）を追加する
- [x] 完了条件: AI の変更は新しい CompositionVersion となり、以前の参照を変更しない

## C3 compiler・preview・render

- [x] compiler 出力を parent HTML と child file tree を含む render project に拡張し、`data-composition-src` host を生成する
- [x] published bundle の読み取り専用 preview content URL と、preview DTO の composition entry 参照を追加する
- [x] Render Job snapshot に CompositionVersion ID、bundle hash、manifest を追加し、worker が照合済み bundle を一時 project へ materialize する
- [x] 完了条件: 全画面 composition を保存済み台本とドラフト・プレビューで seek でき、同じ snapshot から MP4 を render できる

## C4 UI・検証・文書

- [x] Composition Library の一覧、AI の draft / publish 状態、Scene背景への published version 選択を追加する
- [x] テスト: version 不変性、参照検証、bundle 欠損、同一 version の重複参照、preview URL の path 制約、snapshot 固定、nested render の実写 fixture
- [x] [仕様](./spec.md)、[ロードマップ](./roadmap.md)、MVP契約、ADR、CONTEXT、ユーザーガイドを同期する
- [x] 完了条件: AI が作った全画面・無音 composition を publish し、背景として保存、プレビュー、MP4出力できる

## C5 authoring ergonomics（AIのpublish摩擦解消）

- [x] publish の検証失敗を `422 VALIDATION_ERROR` と `details.issues`（path/code/message）で返す
- [x] entry の外部URLと `data-composition-id` 不一致を publish 時に検出する
- [x] manifest の `contentHash` を任意化する
- [x] `GET /compositions/:id/draft/files` で draft を読み戻せるようにする
- [x] `POST /compositions/:id/publish?dryRun=true` で version を作らず検証できるようにする
- [x] draft 更新で `manifest`（durationMs/dependencies）をサーバー生成できるようにする
- [x] スキル・仕様・API契約を新APIに合わせて同期する
