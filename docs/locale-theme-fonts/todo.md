# locale 別テーマフォント todo

[roadmap.md](roadmap.md) の R1・R2 をフェーズ順に進める。完了したらチェックを付ける。

## R1: 契約＋コンパイラ

- [ ] `packages/contracts/src/content/theme.ts`: `textStyleSchema` に `fontFaceByLocale`（`Partial<Record<SupportedLocale, FontFaceSpec>>`、optional）を加算する。往復テスト（既存 JSON が変更なくパース、新フィールド付き定義のパース）を足す。
- [ ] `packages/video/src/theme.ts`: `THEME_FONT_STACKS` を locale 依存にし、`resolveFontFamilyCss` / `themeRoleFontStyle` が document locale を受ける API にする。ja/en は現行スタックを維持する。
- [ ] 呼び出し側（`compiler/scene.ts`、`templates/text-block.ts`、`skins/handmade-paper.ts`、字幕・サムネイルの文字スタイル解決）へ `document.locale` を渡す。
- [ ] `docs/theme-customization/spec.md` の「テーマ定義」へ `fontFaceByLocale`（v2 加算・version 据え置き）と locale 依存スタックを追記する。
- [ ] `docs/multilingual-editions/spec.md` の「言語別フォント診断・テーマ別フォントは対象外」を R1 で実現した解決に更新する。
- [ ] `npm run typecheck` と `npm test` を通す。

## R2: 診断＋UI

- [ ] レンダー投入時のテーマ診断に zh 系 document の字形カバレッジ不足チェックを追加する（warning、コンパイル継続）。テストでは `FakeFontCatalogAdapter` を注入する。
- [ ] テーマ編集画面の全ロールの文字スタイルに locale タブを足す（既定タブ＋`SUPPORTED_LOCALES` 分）。locale 未指定への操作は `fontFaceByLocale` エントリの削除になる。
- [ ] テーマ Draft の保存・復元・公開・複製で locale 別指定が失われないことをテストする。
- [ ] テーマ代表サンプルプレビューで locale 別指定が効くこと（代表 document の locale で解決）。

- [ ] `npm run typecheck` と `npm test` を通す。
