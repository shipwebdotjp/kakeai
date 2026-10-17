# Visual Skin ロードマップ

この文書は[spec.md](./spec.md)の初期実装後に進める拡張を記録する。先に`neutral@1`と`handmade-paper@1`でSkin境界、Style Kit、Composition Style Provenanceを確立し、Skin数やTemplate対応数を先に増やさない。

## R1: `handmade-paper`の対応Templateを増やす

実動画で中立fallbackが不調和になることを確認した順に、表、棒グラフ、フローダイアグラム、stat、端末枠、立ち絵を対応する。Skinに合わせるためだけにTemplateの意味や入力スキーマを変えない。

## R2: 追加の組み込みSkin

`modern-business`、`cyber-noir`、`chalkboard`、`scrapbook`は別々のSkinとして評価する。黒板と紙／テープ、スクラップブックと編集ノートは異なる世界観であり、`handmade-paper`へ混在させない。各Skinはneutral fallbackを前提に、少数の支配的表現から導入する。

## R3: CompositionのTheme追従変数

CompositionVersionがThemeの色・Font Faceなどへ実行時に追従する要求が生じたときは、typedなComposition slotまたはTheme variable contractを別途設計する。親CSS変数へ偶然依存する実装、任意CSS文字列の注入、既存bundleの暗黙再解釈は許可しない。初期仕様のComposition Style Provenanceはauthoring時の来歴であり、実行時変数ではない。

## R4: クロスマシン／クラウド用font pack

別Mac、Docker、クラウドでの完全なTypography再現が必要になった時点で、再配布可能なfont fileをStyle Kitへ同梱するfont packを導入する。ローカル`@font-face local()`利用と混在させず、ライセンス、bundle容量、renderer環境、Job snapshotを明示して扱う。

## R5: Skin authoringの拡張

利用者または第三者がSkinを作る要求が明確になったときだけ、宣言的なSkin DSL、署名済みパッケージ、審査、互換性、sandboxを設計する。任意HTML/CSS/JavaScriptのSkin importは、Composition Libraryのtrusted bundle境界を迂回するため追加しない。
