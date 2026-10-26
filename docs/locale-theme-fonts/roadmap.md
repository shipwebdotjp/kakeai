# locale 別テーマフォントのロードマップ

ADR 0097 の実装を2フェーズに分ける。R1はレンダー品質の足場づくり（zh 系の欠字形をまず防ぐ）、R2は作者が字形を意図的に制御できるようにする。

## R1: 見えの土台（契約＋コンパイラ）

- `textStyleSchema` に `fontFaceByLocale` を加算（contracts）。既存 definitionJson のパースが変わらないことを確認する。
- `THEME_FONT_STACKS` を locale 由来にし、`resolveFontFamilyCss` 系が `document.locale` を受け取る（packages/video）。テンプレート・話者字幕・サムネイルの解決経路へ渡す。
- 成果: zh-Hans / zh-Hant の作品が、`PingFang SC/TC` で欠字形が大幅に減った状態でレンダーできる。

## R2: 制御（診断＋UI）

- レンダー投入時のテーマ診断で、zh 系 document における共通指定 fontFace の字形カバレッジ不足を警告する。
- テーマ編集画面の全ロールに locale タブ（既定＋サポート対象 locale）を足し、Font Face の locale 別上書きを編集・保存・復元できるようにする。
- 成果: 同じテーマ設計を ja/zh で共有したまま、字形だけを意図的に変えられる。

## R3（未定・需要が固まってから）

- アプリ同梱 webfont による出力の再現性向上（別 ADR）。
- 診断の編集画面リアルタイム化（重さが解消できる手段が出た場合のみ）。
