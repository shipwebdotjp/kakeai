# locale 別テーマフォント（fontFaceByLocale）

## 目的と境界

この文書は、テーマのテキストスタイルに locale 別フォント指定 `fontFaceByLocale` を加算し、フォールバックスタックを document locale 由来にすることの正である。決定の根拠は [ADR 0097](../adr/0097-locale-specific-theme-fonts.md)、テーマ基盤の正は [../theme-customization/spec.md](../theme-customization/spec.md)、多言語版の正は [../multilingual-editions/spec.md](../multilingual-editions/spec.md) とする。`themeDefinitionSchemaVersion` は 2 のまま据え置きとし、ContentDocument の `schemaVersion` は上げない。

対象は `textStyleSchema` を解決するテキストスタイルのうち、信頼済みテンプレート（trusted video templates）、話者字幕（`caption.speaker.text` 含む）、サムネイルの headline/subline。AI Composition（Style Kit 生成）は生成コンテキストに locale を持たないため対象外とし、locale を扱う Style Kit は需要が固まってから別 ADR で設計する。Cue 単位の明示 `fontFace` 上書きは既存の解決順（Cue 上書きが最強）を維持し、この機能はそれに触れない。

## 契約

- `textStyleSchema` に `fontFaceByLocale: Partial<Record<SupportedLocale, FontFaceSpec>>`（optional）を加える。`FontFaceSpec` は既存の `fontFaceSpecSchema` をそのまま再利用する。Zod では列挙キーの部分 Record として検証し、未知 locale のキーを拒否する。
- 空辞書の正規化: locale のエントリをすべて消したときは `{}` を保存せず `fontFaceByLocale` 自体を省略する。空辞書と未指定は同義とし、Draft 差分・テーマ hash に無駄な差を作らない。
- Font Catalog は UI が選択肢を出す根拠であって、保存・公開時に未検出 face を拒否する根拠ではない。既存の欠落時 fallback 方針を維持する。
- `FontFaceSpec.fallbacks` は今回も CSS 出力で使用しない（解決順 `platformId → family → fallbacks → locale 依存スタック` を決めてから有効化する。ja 出力不変のため今回は使わない）。
- 解決順（trusted テンプレート・話者字幕）: Cue の明示 `fontFace` 上書き → `fontFaceByLocale[document.locale]` → ロールの `fontFace`（共通指定）→ カテゴリ別フォールバックスタック。`font` カテゴリは Cue 指定があればそれを使う。該当 locale のエントリがなければ共通指定へ落ちる。
- `THEME_FONT_STACKS` は locale 由来にする。ja-JP・en-US は現状値。zh-Hans は簡体字向け（`PingFang SC` → `Noto Sans SC` など）、zh-Hant は繁体字向け（`PingFang TC` → `Noto Sans TC` など）の CJK スタックを sans/serif ごとに持つ。`mono` は Latin 等幅フォントの後・generic `monospace` の前に SC/TC 向け CJK フォールバックを置く。
- `lang` 属性: 動画の HTML は ContentDocument locale、サムネイルの HTML は Language Edition locale を出力する（いずれも `lang="ja"` 固定から改める）。
- 設計上の値は Font Catalog 由来でなければならず、未エスケープの CSS にはならない（既存の Font Resolver 規則を維持）。

## サムネイル

- 解決順は「候補 Appearance の locale 別 fontFace → Work 共通 Appearance の locale 別 fontFace → Theme の `fontFaceByLocale` → Theme の共通 fontFace → locale 依存スタック」（[ADR 0111](../adr/0111-work-scoped-thumbnail-appearance.md)）。
- サムネイルの Appearance は単一の共通 `fontFace` 上書きを持たず、`fontFaceByLocale` だけを持つ。該当 locale のエントリがない項目は Theme のフォントへ落ちる。
- `resolveThumbnailAppearanceDefaults`（packages/contracts/src/thumbnail/appearance.ts）と `compileThumbnail`（packages/video/src/thumbnails/compile.ts）は Language Edition の locale を受け取る。Appearance の明示指定が Theme の locale 指定より強いことを前提に、既存の日本語用サムネイル Appearance が中国語版の Theme locale 指定を再上書きしない。

## テーマ編集 UI

- すべてのロール（title / subtitle / heading / body / closing / caption / label / code）と話者名スタイル（`caption.speaker.text`）の文字スタイル編集に locale タブを足す。既定タブ（共通指定）＋サポート対象 locale 分。タブ間で色・サイズ・装飾は共通のまま、Font Face の指定だけが locale 別に上書きできる。
- locale タブで Font Face を未指定にすると `fontFaceByLocale` の該当エントリを削除する（共通指定へ復帰）。エントリが無くなったら正規化により `fontFaceByLocale` 自体を省略する。
- テーマ一覧・複製・Draft・公開・アーカイブのライフサイクルは既存のまま。公開 revision は locale 別指定も含めて不変である。

## 診断（レンダー前チェック）

- 警告はレンダー投入時のテーマ診断（`createRenderJob` が呼ぶ `FontCatalogService.diagnoseTheme` 系）で出す。編集画面の常時検査は行わない。
- 診断の意味は字形カバレッジの実測ではない。Font Catalog は face の存在と Chromium の解決可否までしか判定できないため、警告は「document locale が zh 系で zh 用の指定がなく、共通 fontFace のみが使われるロールがある」という字形不一致リスクの指摘とする。
- 診断対象は `THEME_TEXT_ROLES` の8ロールに `caption.speaker.text` を加え、locale 適用後に実際に選ばれる fontFace（`fontFaceByLocale` 含む）を見る。Render Job は解決済み Theme Definition を snapshot 化しているため、locale を診断入力に追加しても不変性の設計と整合する。
- 診断はコンパイルを止めず、fallback で継続する（既存の欠落 Font Face 警告と同じ取り扱い）。

## テーマ代表サンプルプレビュー

- 現在の代表プレビューは `ja-JP` 固定。プレビュー locale の選択を追加し、簡体字／繁体字の判別用サンプル文（🎌字の差が分かる文）を含める。locale タブで中国語を選んでも、プレビューで確認できない状態のままにしない。

## 対象外

- AI Composition（Style Kit 生成）の locale 対応。locale 付き Style Kit（生成コンテキスト・Style Provenance・fonts.css の locale 化）は別フェーズ・別 ADR。
- アプリ同梱 webfont（Noto Sans SC/TC のバンドル）。将来の再現性課題として別 ADR。
- Font Catalog の Windows/Linux 実装への展開（既存の platform 境界に従う）。
- 文字スタイル以外（色・サイズ・装飾・Text Surface）の locale 別上書き。
- Cue 単位 fontFace 上書きの locale 分岐。
- text_overflow の行数推定の locale 切替（ADR-0090 維持）。
- `FontFaceSpec.fallbacks` の CSS 出力有効化。

## 検証の方針

- スキーマの往復（既存 definitionJson がそのまま通り、新フィールド付き定義がパースできること）。未知 locale キーの拒否、空辞書が `fontFaceByLocale` 省略に正規化されること。
- 解決順の境界：Cue 上書きが最強であること、locale 指定が共通指定に勝つこと、未指定が共通指定に落ちること。
- サムネイルの解決順（候補 Appearance → Work 共通 → Theme locale 指定 → Theme 共通 → locale スタック）と、locale 受け渡しの境界。
- locale 別スタック（mono の CJK フォールバック位置を含む）の生成と、ja 作品の出力が変わらないこと。
- `lang` 属性が locale を従うこと。
- テーマ編集 UI の locale タブ操作の往復（保存・復元は既存の theme draft 操作を再利用）。
- 代表プレビューの locale 選択と判別用サンプル文の描画。
- プロンプト・UI 文言の検証はしない。
