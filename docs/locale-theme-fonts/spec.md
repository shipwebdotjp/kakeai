# locale 別テーマフォント（fontFaceByLocale）

## 目的と境界

この文書は、テーマのテキストスタイルに locale 別フォント指定 `fontFaceByLocale` を加算し、フォールバックスタックを document locale 由来にすることの正である。決定の根拠は [ADR 0097](../adr/0097-locale-specific-theme-fonts.md)、テーマ基盤の正は [../theme-customization/spec.md](../theme-customization/spec.md)、多言語版の正は [../multilingual-editions/spec.md](../multilingual-editions/spec.md) とする。`themeDefinitionSchemaVersion` は 2 のまま据え置きとし、ContentDocument の `schemaVersion` は上げない。

対象は `textStyleSchema` を解決するすべてのテキストスタイル（テーマの 8 ロール、話者字幕、サムネイルの headline/subline）。Cue 単位の明示 `fontFace` 上書きは既存の解決順（Cue 上書きが最強）を維持し、この機能はそれに触れない。

## 契約

- `textStyleSchema` に `fontFaceByLocale: Partial<Record<SupportedLocale, FontFaceSpec>>`（optional）を加える。`FontFaceSpec` は既存の `fontFaceSpecSchema` をそのまま再利用する。該当ロケールのエントリが存在しなくてよい。
- 解決順: `fontFaceByLocale[document.locale]` → ロールの `fontFace`（共通指定）→ カテゴリ別フォールバックスタック。
- `THEME_FONT_STACKS` は locale 由来にする。ja-JP・en-US は現状値。zh-Hans は簡体字向け（`PingFang SC` → `Noto Sans SC` など）、zh-Hant は繁体字向け（`PingFang TC` → `Noto Sans TC` など）の CJK スタックを sans/serif/mono ごとに持つ。mono は既定の Latin スタックを流用してよい。
- コンパイラ・サムネイル・文字スタイル解決は `document.locale` を受け取る。ja 作品の既存出力ハッシュは変わらない（ja/en スタックと共通 fontFace のみ使うため）。
- `FontFaceSpec`・`fontFaceByLocale` の値は Font Catalog 由来でなければならず、未エスケープの CSS にはならない（既存の Font Resolver 規則を維持）。

## テーマ編集 UI

- すべてのロール（title / subtitle / heading / body / closing / caption / label / code）の文字スタイル編集に locale タブを足す。既定タブ（共通指定）＋サポート対象 locale 分。タブ間で色・サイズ・装飾は共通のまま、Font Face の指定だけが locale 別に上書きできる。
- locale タブで Font Face を未指定にすると `fontFaceByLocale` の該当エントリを削除する（共通指定へ復帰）。
- テーマ一覧・複製・Draft・公開・アーカイブのライフサイクルは既存のまま。公開 revision は locale 別指定も含めて不変である。

## 診断（レンダー前チェック）

- 欠字形・字形カバレッジ不足の警告はレンダー投入時のテーマ診断（`createRenderJob` が呼ぶ `FontCatalogService.diagnoseTheme` 系）で出す。編集画面での常時検査は行わない。
- document locale が zh 系で、ロールの共通指定 fontFace が zh 向けの字形カバレッジを持たない場合、「zh 用の指定がないと該当ロールは日本語字形・欠字形のまま描画される」ことを警告に含める。
- 診断はコンパイルを止めず、fallback で継続する（既存の欠落 Font Face 警告と同じ取り扱い）。

## 対象外

- アプリ同梱 webfont（Noto Sans SC/TC のバンドル）。将来の再現性課題として別 ADR。
- Font Catalog の Windows/Linux 実装への展開（既存の platform 境界に従う）。
- 文字スタイル以外（色・サイズ・装飾・Text Surface）の locale 別上書き。
- Cue 単位 fontFace 上書きの locale 分岐。
- text_overflow の行数推定の locale 切替（ADR-0090 維持）。

## 検証の方針

- スキーマの往復（既存 definitionJson がそのまま通り、新フィールド付き定義がパースできること）。
- 解決順の境界：locale 指定が共通指定に勝つこと、未指定が共通指定に落ちること。
- locale 別スタックの生成と、ja 作品の出力が変わらないこと。
- テーマ編集 UI の locale タブ操作の往復（保存・復元は既存の theme draft 操作を再利用）。
- プロンプト・UI 文言の検証はしない。
