# locale 別テーマフォントのロードマップ

ADR 0097 の実装を2フェーズに分ける。R1はレンダー品質の足場づくり（zh 系の欠字形をまず防ぐ）、R2は作者が字形を意図的に制御できるようにする。適用範囲は trusted テンプレート・話者字幕・サムネイルまで。AI Composition（locale 付き Style Kit）は対象外で、需要が固まってから別フェーズで判断する。

## R1: 見えの土台（契約＋コンパイラ）

- `textStyleSchema` に `fontFaceByLocale` を加算（contracts）。既存 definitionJson のパースが変わらないことを確認する。
- `THEME_FONT_STACKS` を locale 由来にし、`resolveFontFamilyCss` 系が `document.locale` を受け取る（packages/video）。trusted テンプレート・話者字幕の解決経路へ渡す。
- サムネイル: `resolveThumbnailAppearanceDefaults`・`compileThumbnail` が Language Edition の locale を受け取り、解決順（候補 Appearance → Edition 共通 → Theme locale 指定 → Theme 共通 → locale スタック）を実装する。
- 動画・サムネイルの HTML `lang` 属性を locale に従わせる。
- 成果: zh-Hans / zh-Hant の作品が、`PingFang SC/TC` で欠字形が大幅に減った状態でレンダーできる。

## R2: 制御（プレビュー・診断＋UI）

- テーマ代表サンプルプレビューに locale 選択と簡体字／繁体字の判別用サンプル文を追加する。
- レンダー投入時のテーマ診断で、zh 系 document に zh 用指定がなく共通 fontFace のみが使われるロールがある場合に字形不一致リスクを警告する（警告でもコンパイル継続）。
- テーマ編集画面の全ロール＋話者名スタイルに locale タブ（既定＋サポート対象 locale）を足し、Font Face の locale 別上書きを編集・保存・復元できるようにする（空辞書は `fontFaceByLocale` 省略に正規化）。
- 成果: 同じテーマ設計を ja/zh で共有したまま、字形だけを意図的に変えられる。

## R3（未定・需要が固まってから）

- locale 付き Style Kit（AI Composition 対応。生成コンテキスト・Style Provenance・fonts.css の locale 化）。別 ADR。
- アプリ同梱 webfont による出力の再現性向上（別 ADR）。
- 診断の編集画面リアルタイム化（重さが解消できる手段が出た場合のみ）。
