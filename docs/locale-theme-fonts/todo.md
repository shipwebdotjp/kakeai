# locale 別テーマフォント todo

[roadmap.md](roadmap.md) の R1・R2 をフェーズ順に進める。完了したらチェックを付ける。

## R1: 契約＋コンパイラ

- [x] `packages/contracts/src/content/theme.ts`: `textStyleSchema` に `fontFaceByLocale`（`Partial<Record<SupportedLocale, FontFaceSpec>>`、optional）を加算する。テストは既存 JSON の無変更パース、新フィールド付き定義のパース、未知 locale キーの拒否、空辞書の省略正規化を確認する。
- [x] `packages/video/src/theme.ts`: `THEME_FONT_STACKS` を locale 依存にし、`resolveFontFamilyCss` / `themeRoleFontStyle` が document locale を受ける API にする。ja/en は現行スタックを維持し、`mono` は Latin 等幅の後・generic `monospace` 前に SC/TC 向け CJK フォールバックを置く。`FontFaceSpec.fallbacks` は使用しない。
- [x] 呼び出し側（話者字幕・trusted テンプレート・`text.block`・handmade-paper スキン）へ `document.locale` を渡す。
- [x] サムネイル: `resolveThumbnailAppearanceDefaults`（contracts）と `compileThumbnail`（video）が Language Edition locale を受け取り、解決順（候補 Appearance → Edition 共通 → Theme locale 指定 → Theme 共通 → locale スタック）を実装する。
- [x] `packages/video/src/compiler/compile.ts` の `compileDocument` と `packages/video/src/thumbnails/compile.ts` の `lang` 属性を locale に従わせる。
- [x] `docs/theme-customization/spec.md` の「テーマ定義」へ `fontFaceByLocale`（v2 加算・version 据え置き）、正規化規則、locale 依存スタックを追記する。
- [x] `docs/multilingual-editions/spec.md` の「言語別フォント診断・テーマ別フォントは対象外」を R1 で実現した解決に更新する。
- [x] `npm run typecheck` と `npm test` を通す。

## R2: プレビュー・診断＋UI

- [x] テーマ代表サンプルプレビューに locale 選択と簡体字／繁体字の判別用サンプル文を追加する（`apps/api/src/services/theme-preview.ts` の ja-JP 固定を解消）。
- [x] レンダー投入時のテーマ診断（`FontCatalogService.diagnoseTheme`）に、zh 系 document で zh 用指定がなく共通 fontFace のみが使われるロールの字形不一致リスク警告を追加する（warning、コンパイル継続）。診断対象は8ロール＋`caption.speaker.text`、locale 適用後の fontFace を見る。テストでは `FakeFontCatalogAdapter` を注入する。
- [x] テーマ編集画面の全ロール＋話者名スタイルに locale タブを足す。locale 未指定への操作はエントリ削除（最後の1つを消したら `fontFaceByLocale` 自体を省略）。
- [x] テーマ Draft の保存・復元・公開・複製で locale 別指定（正規化を含む）が失われないことをテストする。
- [x] `npm run typecheck` と `npm test` を通す。
