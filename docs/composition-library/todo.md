# Composition Library 実装TODO

[仕様](./spec.md) を正とする。上から順に進め、各フェーズで `npm run typecheck`、`npm test`、OCRレビューを実行し、妥当な指摘を修正してコミットする。

## C1 契約と永続化

- [x] `Composition`、`CompositionDraft`、`CompositionVersion` のZod契約、DTO、Prismaモデル、bundle manifest を追加する
- [x] app data root に draft / immutable bundle の保存領域を追加し、相対 storage key と content hash を検証する
- [x] `composition.full-bleed@1` の入力、background層限定（`scene` / `lines` / `offset` の全 range を許可）、同一 version の一 ScriptVersion 内一参照を ContentDocument 検証へ追加する
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

- [x] Composition Library の一覧、AI の draft / publish 状態、Composition背景への published version 選択（line / offset range を含む）を追加する
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
- [x] `filesBase64` でバイナリdraftファイルを送受信できるようにする（読み戻しは `binaryFiles`）
- [x] publish時に返却・保存する manifest の `contentHash` を実ハッシュに設定する
- [x] スキルにバイナリ資産・HyperFramesとの関係・lint escape hatch・保存レイアウト・複数composition運用を追記する
- [x] スターターテンプレート（`skills/kakeai-composition/templates/starter/`）を同梱する

## C6 Composition range 解禁と pre-1.0 互換整理

- [x] `composition.full-bleed@1` を `layer: background` のまま `scene` / `lines` / `offset` の全 range へ解禁し、`@2` は追加しない
- [x] 実効表示窓 `min(range 尺, manifest.durationMs)`、child 終端での打ち切り、Cue transition の実効窓検証、crossfade 尺不足の保存・レンダー投入時エラーを追加する
- [x] 現行機能を template `@1` と ContentDocument `schemaVersion: 1` に再基準化し、旧版 decoder・migration・旧版昇格を削除する
- [x] [ADR-0061](../adr/0061-template-version-as-reinterpretation-boundary.md) を追加し、ADR-0009/0018/0034 に `amended by` を追記する
- [x] 完了条件: line / offset range の Composition 背景を保存・プレビュー・MP4出力でき、旧 `@2/@3` と `schemaVersion != 1` を拒否する

## R2 複数 instance

- [x] ContentDocument の「同一 CompositionVersion は一文書内で一度だけ」制約を外す
- [x] compiler・preview・snapshot が同一 version の複数配置を重複排除しつつ複数ホストを許容することを確認する
- [x] 同一 version を複数 screen／background に置いても ID・timeline が衝突しない回帰テストを追加する
- [x] HyperFrames の native nested composition 分離（runtime composition ID・CSS・DOM・timeline・SVG id のスコープ）を仕様へ記録する

## R3 端末画面への Native Composition 埋め込み

- [x] `NestedVisual` に `kind: "composition"`（`compositionVersionId`、必須 `fit`、任意 `zoom`・`position`）を追加し、再帰検証・再帰的な Composition 参照収集へ対応する
- [x] `scene.device-frame@1` の screen を素材／Composition で選べるようにし、公開 version selector と fit・zoom・位置編集を追加する
- [x] compiler が slot の content box を基準に `contain`／`cover`＋zoom＋position を適用し、`container-type: size` と `cqw`/`cqh`・`tan(atan2())` で frame 非依存に倍率を求める
- [x] preview の content URL 解決、render snapshot、bundle materialize を入れ子参照へ対応する
- [x] テスト: Zod 契約、laptop／phone の contain・cover、zoom・position、child 終端での非表示、preview URL、snapshot 固定、R2 回帰、UI form の round-trip・非破壊保存
- [x] 完了条件: 端末画面に publish 済み Composition を埋め込み、保存・プレビュー・MP4出力できる
