# Visual Theme カスタマイズ 実装TODO

仕様は[spec.md](./spec.md)を正とする。完了後、従来のVisual Theme基盤の固定テーマ前提を本仕様へ統合する。

## 契約とデータ

- [ ] `packages/contracts`にTheme、Theme Revision、Theme Draft、Text Style、Text Surface、Font Face、Font CatalogのZod契約とDTOを追加する
- [ ] Theme Refの形状検証を組み込みThemeレジストリの実在検証から分離する
- [ ] `text.block@2`を追加し、`label` roleとFont Faceを含む個別Text Style上書きを定義する。`text.block@1`は変更しない
- [ ] Prismaに利用者Theme、Theme Revision、Theme Draft、アーカイブ状態を追加する
- [ ] Render Job snapshotへ解決済みTheme Revision定義とFont診断を追加し、旧snapshotを壊さない読み出し規則を定義する

## APIとサービス

- [ ] 組み込み／利用者Themeを統合するTheme Resolverを実装し、保存・プレビュー・レンダー投入の実在性検証へ接続する
- [ ] Theme一覧、詳細、作成、複製、Draft保存・破棄、公開、アーカイブAPIを追加する
- [ ] Theme公開時にのみrevision番号を採番し、不変性と参照保護をトランザクションで保証する
- [ ] macOS Font Catalog adapter、Font Resolver、カタログ取得／手動更新APIを追加する
- [ ] 代表ContentDocumentとTheme Definition overrideを使う非永続Theme DraftプレビューAPIを追加する
- [ ] Render Job作成時にFont欠落を診断し、snapshotに固定したTheme定義だけでworkerがコンパイルするようにする

## コンパイラ

- [ ] Theme定義のText StyleとText SurfaceをコンパイラとRenderContextへ接続する
- [ ] 字幕、`text.block@1`、`text.block@2`、label Cueへ解決順を適用する
- [ ] Font Resolverが返す安全なCSS値だけをHTMLへ出力し、欠落時のfallbackと診断を出す
- [ ] `soft-editorial@1`を新しい定義契約へ適合させ、既存の見た目とテストを保つ

## Web UI

- [ ] グローバルナビゲーション、ルート、API hooksにテーマ一覧とTheme編集画面を追加する
- [ ] Theme一覧に組み込み／利用者、最新公開revision、Draft、アーカイブ、フォント欠落状態を表示する
- [ ] Theme編集フォームに共通色、Text Style、caption／labelのText Surface、Font Face検索を実装する
- [ ] 固定代表サンプルのライブプレビュー、診断表示、明示的なDraft保存・破棄・公開を実装する
- [ ] Work編集画面で公開済みTheme Revisionを選択し、通常の明示台本保存へ反映する。Draftは選択不可にする

## 文書と検証

- [ ] `docs/mvp/spec.md`、`content-schema.md`、`api-contract.md`、ロードマップ、既存Visual Theme仕様を本仕様へ整合させる
- [ ] `user-guide/docs/`へテーマ一覧、編集、公開、作品への適用、Font欠落警告を追加する
- [ ] contracts、サービス、API、コンパイラ、preview、render snapshot、Webの必要最小限の振る舞いテストを追加する
- [ ] `npm run typecheck` と `npm test` を通す
- [ ] `ocr review --audience agent -b "利用者編集可能なVisual Theme、revision、draft preview、ローカルフォント対応"`を実行し、正当な指摘を最大3回まで修正する
- [ ] 変更をコミットする
