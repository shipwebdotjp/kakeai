# Visual Theme 基盤（`soft-editorial@1`）仕様

## 目的と境界

この文書は、VisualTemplateの見た目の既定値を提供する **Visual Theme** の基盤と、唯一の組み込みテーマ `soft-editorial@1` を定める。利用者編集可能なTheme、revision、draft、Font Face、選択UIは[Visual Theme カスタマイズ仕様](../theme-customization/spec.md)を正とする。Themeが選ぶVisual Skin、SkinのTemplate fallback、Composition authoringへの共有は[Visual Skin仕様](../visual-skins/spec.md)を正とする。決定は[ADR 0049](../adr/0049-custom-visual-theme-revisions.md)を参照する。台本契約は [../mvp/content-schema.md](../mvp/content-schema.md) を正とする。

本書の「編集UI」およびrole対応範囲は、カスタマイズ機能を導入する前の基盤の記録である。前記仕様と矛盾するときは、Visual Theme カスタマイズ仕様を優先する。

- Visual Theme は既定値であり、Cueの明示設定が常に優先する。`text.block@1` の入力契約と柔軟性は変えない。
- 初回の組み込みThemeは `soft-editorial@1` である。Theme一覧・選択・利用者Themeの詳細は[Visual Theme カスタマイズ仕様](../theme-customization/spec.md)で拡張する。
- Web UIのライト／ダーク、および `scene.site-mockup@1` の `light`／`dark` はVisual Themeと別概念のままにする。

## 参照と解決

- ContentDocument は直下に必須の `visualTheme: { id: "soft-editorial", version: 1 }` を持つ（`schemaVersion: 1` の基準契約に含まれる）。
- テーマ定義は `packages/contracts` の版付きレジストリ（`id@version`）に置く。参照スキーマは `{ id, version }` で、未知の参照はDocument検証で拒否する。コンパイラも未知テーマを `unknown_theme` で失敗させる。
- テーマ定義自体の形状はZodスキーマで検証し、組込み定義の妥当性をテストする。

## `soft-editorial@1` のトークン

温白色・墨紺を基調とする。値はすべて大文字 `#RRGGBB` で保持する。

| 分類 | 値 |
| --- | --- |
| canvas | base `#FAF6EE`（温白色）、ink `#1F2A44`（墨紺） |
| accents | primary `#19736D`（青緑）、secondary `#A84D3E`（コーラル）、tertiary `#80600F`（黄土） |
| surface / surfaceMuted / text / muted / border / onMedia | `#FFFFFF` / `#F1EAD9` / `#232B3D` / `#4E5A6B` / `#E2DAC6` / `#FFFFFF` |
| scrim / shadow | 色 `#1B2740`＋不透明度（scrim `0.55`、shadow `0.5`）。描画時に `rgba()` へ合成する |
| radius | sm `12` / md `16` / lg `20`（1080p基準px） |
| motion | enter `350` / exit `0` / max `2000`（ms）。有限の動きの予算を示す |
| semantic | success `#2E7D4F` / warning `#80600F` / error `#A84D3E` / info `#19736D` |
| categoryColors | 6色のグラフ用パレット（accents＋調和する3色） |
| artDirection | 画像生成向けの文言（style・palette・avoid）。生成機能が入るまで描画には使わない |

文字トークンは role ごとに書体カテゴリ・サイズ(px)・色・行間・装飾既定（bold/italic/outline/shadow）を持つ。太さは `decoration.bold` で表す。

| role | font | size | color | 行間 | 装飾 |
| --- | --- | --- | --- | --- | --- |
| title | sans | 96 | `#175C57` | 1.4 | bold |
| subtitle | sans | 48 | `#4E5A6B` | 1.4 | - |
| heading | sans | 72 | `#175C57` | 1.4 | bold |
| body | sans | 42 | `#232B3D` | 1.8 | - |
| closing | sans | 48 | `#232B3D` | 1.4 | bold |
| caption | sans | 40 | `#FFFFFF` | 1.5 | shadow |
| label | sans | 28 | `#4E5A6B` | 1.4 | bold |
| code | mono | 34 | `#232B3D` | 1.6 | - |

基盤時点では`label`・`code`・`artDirection`に対応する描画はない。`label`の描画は[Visual Theme カスタマイズ仕様](../theme-customization/spec.md)の`text.block@1`で追加する。

## テキストの解決順序

`text.block` はプロパティ単位で次を適用する。`decoration.bold` なども個別にこの順で解決し、未指定の項目だけテーマを使う。`text.block@1` は `label` を含む6分類を描画する（[ADR-0061](../adr/0061-template-version-as-reinterpretation-boundary.md)）。

1. Cueの明示値
2. 選択中テーマのrole別既定値
3. テンプレートの最終fallback（`soft-editorial@1` と同値）

焼き込み字幕（`lines.captionText` の固定層）は caption トークン（書体・サイズ・色・行間）と scrim で描画する。

## Sceneアクセント

Sceneは `accent`（旧 `accentColor`）を必須で持つ。

- `{ kind: "theme", token: "primary" | "secondary" | "tertiary" }`
- `{ kind: "custom", color: "#RRGGBB" }`

描画規則は次とする。

- Scene背景は `linear-gradient(135deg, mix(accent, canvas.base, 0.72), mix(accent, canvas.base, 0.88))` の柔らかい tint とする。
- custom accent の soft 色は `mix(accent, canvas.base, 0.8)` で作る。前景色は白と本文色のうちコントラスト比（WCAG相対輝度）が高い方を使う。解決結果はSceneラッパーのCSS変数（`--kakeai-accent` / `--kakeai-accent-soft` / `--kakeai-accent-fg`）として出し、将来のテンプレートが使えるようにする。
- rootにはテーマ全体のCSS変数（canvas・surface・text・scrim・shadow・radius・accents・書体スタック）を出す。

## テンプレートへの適用

コンパイラはDocumentからテーマを解決し、`RenderContext` を通じて各テンプレートへ渡す。

- Text Cue・字幕：上記の解決順序とトークンを使う。
- カード・端末枠・立ち絵・Nested Visual：汎用のsurface・文字・scrim・影・角丸をテーマから取る。`scene.device-frame@1` の `backgroundColor` 未指定時の既定は `surfaceMuted` とする。
- サイトモックアップ：実在サービス固有のアクセントバーは維持する。テーマは外側の汎用surface・文字・影だけへ適用し、入力の `theme`（`light`/`dark`）の意味は変えない。

## 移行

- 旧版の読出し移行は持たない（[ADR-0061](../adr/0061-template-version-as-reinterpretation-boundary.md) で `schemaVersion: 1` へ再基準化）。
- Text Cueの `font`・`fontSize`・`color`・`decoration` の明示値は保持する。
- Render Jobのsnapshot schema versionは変更しない。

## 編集UI

- 基盤実装ではテーマ選択を表示せず、全作品で `soft-editorial@1` を使う。カスタマイズ機能では[Visual Theme カスタマイズ仕様](../theme-customization/spec.md)に従う。
- Sceneごとにテーマアクセント3色（プライマリ／セカンダリ／ターシャリ）または自由色を選ぶ。自由色が空の場合はテーマ既定（primary）で保存する。
- Text Cueの既存スタイル入力は維持する。未指定項目はテーマのrole別スタイルで描画される旨をCue編集欄に表示する。

## 検証

- 契約テスト：テーマ参照、アクセントunion、未知テーマ拒否、Text Cueの明示スタイル保持。
- コンパイラテスト：theme既定値の適用、Cue単位の各上書き、custom accent、既存VisualTemplateとNested Visualへの伝播、サイト固有色の維持。
- API/統合テスト：旧v5台本・旧Render Job snapshotの取得・保存・プレビュー・レンダー、新規Workのv6初期Document。
- Webテスト：アクセント選択の往復、テーマ既定、明示Textスタイルの保持。
