# サムネイル仕様

## 目的と境界

この文書は、保存済みの Language Edition（言語エディション）に対して、YouTube 投稿用のサムネイルをテンプレート方式で作成・管理する機能の正を定める。全体仕様とDBスキーマは [../mvp/spec.md](../mvp/spec.md)、台本契約は [../mvp/content-schema.md](../mvp/content-schema.md)、HTTP契約は [../mvp/api-contract.md](../mvp/api-contract.md)、Theme は [../visual-themes/spec.md](../visual-themes/spec.md) と [../theme-customization/spec.md](../theme-customization/spec.md) を正とし、この文書はそれらへのサムネイル固有の追加を定める。

- サムネイルは AI 生成ではなく、アプリ同梱のサムネイルテンプレートに文字と素材を差し込んで描画する。統一性と予測可能性を優先する。
- サムネイルは動画の ScriptVersion とは別の小さな正本を持つ。台本のコピーでも、台本からの自動要約・自動切り出しでもない。文字と素材は人が用意する。
- サムネイルは Language Edition 単位で持つ。言語ごとに別々のサムネイルを作れる。
- サムネイルの PNG は Job の出力（`Artifact`）にしない。保存済み候補からオンデマンドで生成する（[ADR 0060](../adr/0060-thumbnail-on-demand-png.md)）。
- 出力は YouTube 推奨の 16:9、1280x720 固定とする。9:16 など他比率は対象外。

## 正本と派生

サムネイルの正本は、テンプレート参照と入力JSONを持つ小さな文書（以下「サムネイル文書」）である。次は派生物とし、正本にしない。

- コンパイル済みサムネイル HTML（プレビュー用）
- 生成した PNG

サムネイル文書は ScriptVersion の `contentJson` にも含めない。独立した契約とする。新規保存は `schemaVersion: 2` とし、v1 文書は読み取りのみ互換とする（[ADR 0058](../adr/0058-thumbnail-mutable-candidates.md)）。

## データモデル

Prisma モデル `Thumbnail` を追加する。1つの LanguageEdition が複数の候補を持つ。

| モデル | 主な列 | 制約・用途 |
| --- | --- | --- |
| `Thumbnail` | `id`, `languageEditionId`, `label`, `schemaVersion`, `templateId`, `templateVersion`, `inputJson`, `createdAt`, `updatedAt` | Language Edition 配下の可変なサムネイル候補。`@@index([languageEditionId])`。テンプレート版のGC条件に使うため `templateId`/`templateVersion` を検索用カラムにも持つ。 |
| `LanguageEdition`（追加列） | `primaryThumbnailId?`, `thumbnailAppearanceJson?` | `primaryThumbnailId` は選択中の候補。`thumbnailAppearanceJson` は言語版共通のサムネイル外観（疎な上書きJSON）。 |

- 候補は可変とし、明示保存で `inputJson` をその場で上書きする（last-write-wins）。版履歴・復元は持たない。
- 候補の追加・削除・選択は自由。`primaryThumbnailId` を指す候補を削除する場合は、同一トランザクションで別候補へ付け替えるか NULL にする。
- `inputJson` は v2 では `{ schemaVersion: 2, template: { id, version }, input: <template固有>, appearanceOverride?: <Thumbnail Appearance> }` を持つ。v1 は `appearanceOverride` を持たない文書として読み取る。旧テンプレートを参照する保存済み候補は存在しない前提で、旧テンプレートの解決は行わない。テンプレートの `inputSchema` で保存前に検証する。
- `inputJson` が参照する `assetId` は、保存前に ready な素材の存在と種別（画像）をアプリケーション層で検証する。ContentDocument と同じく外部キーにはしない。
- Work削除時は、Edition 配下の候補も同一の削除計画で消す。

## Thumbnail Appearance

サムネイルの見た目は、Visual Theme を既定として、言語版共通と候補単位の2段階で**プロパティ単位の疎な上書き**を行う（[ADR 0084](../adr/0084-thumbnail-appearance-overrides.md)）。全プロパティが省略可能で、未指定の項目は Theme の変更に追従する。明示した色・書体・サイズ・太さ・行間は保持する。

解決順は次とする。

1. Theme（`title` / `heading` / `scrim` / primary accent）
2. 言語版共通 Appearance（`LanguageEdition.thumbnailAppearanceJson`）
3. 候補の Appearance（`Thumbnail` 文書 v2 の `appearanceOverride`）
4. テンプレートの構図・倍率（文字量による自動サイズ補正を含む）

共通と候補のマージは、テキストプロパティ単位、`decoration` のフラグ単位、`outline` のプロパティ単位、`scrim` のプロパティ単位で行う。

| プロパティ | 内容 | 既定 |
| --- | --- | --- |
| `headline` / `subline` | 各テキストロールの上書き | Theme の `title` / `heading` |
| `font` | `sans` / `serif` / `mono` | Theme のロール値 |
| `fontFace` | Font Catalog の Face | Theme のロール値 |
| `fontSize` | 8–240。1080基準px | Theme のロール値 |
| `color` | `#RRGGBB` | 写真上で読める Theme の `onMedia` |
| `lineHeight` | 1–3 | Theme のロール値 |
| `decoration` | `bold` / `italic` / `outline` / `shadow` | Theme のロール値 |
| `outline.color` | 縁取り色。未指定は自動 | `null`（自動） |
| `outline.width` | 縁取りの太さ。0–12、1080基準px。0は縁取りなし | `3` |
| `accent` | `==` 記法のアクセント色 | Theme の primary accent |
| `scrim.color` / `scrim.opacity` | 写真上の暗幕 | Theme の `scrim` |

- 既定の文字色は写真上での可読性を優先し、`onMedia` とする。書体・カテゴリ・サイズ・行間・装飾は `title` / `heading` を継承する。
- 明示した `accent` は自動でコントラスト補正しない。テンプレートの scrim・常時影・任意の縁取りで可読性を支える。未指定時は Theme primary accent を背景とのコントラスト比3以上へ解決する。
- 縁取り色を未指定にした場合、文字色と背景から Theme ニュートラルを選ぶ。明示色はそのまま使う。縁取りの太さは自動文字サイズ補正には連動しない。
- 空のオブジェクト・空の入れ子は保存正規化で削除する。

## テンプレート

- サムネイルテンプレートは VisualTemplate とは別のレジストリとし、`packages/contracts` に置く。`template.id@version` の意味を不変に保ち、変更は新版で行う（[ADR 0009](../adr/0009-template-version-immutability.md) と同じ規律）。
- 定義は VisualTemplate より薄い。`id`、`version`、`inputSchema`（Zod）、`inputFields`（`TemplateFieldSpec`）、`display`、`collectAssetRefs` を持ち、`layers`・`transitionPolicy`・`animationPolicy` は持たない（静止画のため）。
- フォームは既存の `TemplateFieldSpec` を再利用し、汎用フォームエンジンで描画する。テンプレート追加にエディタコードを書かせない（[ADR 0032](../adr/0032-template-input-fields-and-animation-presets.md) と同じ方針）。
- 同梱テンプレートは `thumbnail.cutout-hero@1` のみとする。旧4テンプレート（`headline-photo` / `photo-cover` / `text` / `layered`）は削除し、保存済み候補が存在しない前提で移行しない。
- 参照ゼロの版は削除してよいが、可変候補が参照しうるため「どの保存済み候補からも参照されていない版」を削除条件とする。

### `thumbnail.cutout-hero@1`

背景写真を全面に敷き、片側の透過被写体を下端基準で重ね、反対側の下部安全領域に大見出しを置く。カード状の主役写真は対象外。

| 入力 | 型 | 既定 | 内容 |
| --- | --- | --- | --- |
| `headline` | richText | 必須 | 大見出し。4種の部分装飾を許可する。 |
| `subline` | richText | 任意 | 見出し上の補足文。4種の部分装飾を許可する。 |
| `backgroundAssetId` | image Asset | 必須 | 全面の背景写真。 |
| `backgroundFocalPoint` | `{x,y}` | 中央 | 背景の切り出し位置。 |
| `backgroundZoom` | number | 1 | 背景の拡大率。 |
| `foregroundAssetId` | image Asset | 必須 | 透過PNG/WebPの前景切り抜き。 |
| `subjectSide` | `left` / `right` | `right` | 被写体を置く側。見出しは反対側へ置く。 |
| `flipForeground` | boolean | `false` | 前景を左右反転する。 |
| `subjectScale` | number 0.6–1.5 | 1 | 被写体の大きさ。 |

- 被写体は被写体側の幅50%、高さ `78% × subjectScale` の領域に `contain` で下端基準に描画する（`object-position: 50% 100%`）。
- 見出し・補足文は反対側の幅50%、下padding 48pxの領域に置く。被写体が右なら左寄せ、左なら右寄せにする。
- 背景の下端42%から100%へ scrim グラデーションを敷く。被写体は scrim より上に描画し、暗幕で暗くしない。
- 見出し・補足文には scrim 色由来の淡い常時影を付ける。
- 見出しの文字サイズは、記法・空白を除く可視文字数で自動補正する。10文字以下は1.7倍、18文字以下は1.45倍、26文字以下は1.2倍、それ以上は1.0倍。補足文は1.0倍。最終サイズは16–200pxにクランプする。
- 前景の透過性メタデータは検査しない。非透過画像を選ぶと四角い背景ごと表示されるため、プレビューで確認する利用者責任とする。

## 部分装飾（リッチテキスト）

見出し・補足文は、文字列全体ではなく単語単位で装飾できる。正本は今まで通り1本の文字列で、装飾は小さな記法として同じ文字列に含める（[ADR 0080](../adr/0080-thumbnail-inline-text-marks.md)）。`input` の型は `string` のままなので `schemaVersion` は据え置く。

| 記法 | 意味 | 描画 |
| --- | --- | --- |
| `**文字**` | 太字 | `font-weight:700` |
| `*文字*` | 斜体 | `font-style:italic`（書体に斜体がない場合は合成斜体） |
| `==文字==` | アクセント色 | Appearance の強調色。未指定時は Theme primary accent を可読性解決 |
| `%%文字%%` | 縁取り | Appearance の縁取り色・太さ。未指定色は自動解決 |
| `\` | エスケープ | 直後の記法記号をそのまま表示する |

- 装飾は任意の順で入れ子にできる。対になっていない記法記号は文字として表示し、フィールドが許可しない記法だけを保存時に `VALIDATION_ERROR`（パスは該当フィールド）とする。
- 記法記号以外の直前にある `\` はバックスラッシュのまま表示する。
- 色・書体・太さは、Appearance の上書きがある場合だけ利用者が指定する。上書きがなければ Theme とテンプレートが解決する。
- アクセント色は Appearance で明示した場合、背景とのコントラスト比による自動置換をしない。未指定時はコントラスト比3未満なら Theme のアクセントを白または scrim 方向へ寄せた色に解決する。
- `%%` の縁取りは、ロールの `outline` 設定（色・太さ）を全体装飾と共有する。縁取り色が未指定なら、スパンごとの文字色（アクセント色を含む）に対してコントラストが取れる Theme ニュートラルを選ぶ。
- 改行はそのまま保持する（`white-space:pre-line`）。
- 同梱テンプレートは見出し・補足文で4種すべてを許可する。
- 編集UIは textarea とツールバー（選択範囲を記法で囲む）で構成する。任意HTMLは受け付けず、contenteditable の内部状態も保存しない。

## レイアウト自由度

フリーキャンバス（ドラッグ・リサイズ・回転による絶対配置）は提供しない。テンプレートが構図を固定し、利用者は次だけを調整する。

- 背景写真の切り出し位置・ズーム
- 被写体の左右バリアント・左右反転・倍率
- 文字量に応じた自動サイズ補正の範囲内での見た目（Appearance の書体・サイズ・色・装飾）
- 言語版共通／候補単位の Appearance 上書き

構図差はテンプレートを増やすことで広げ、チャンネルごとの個性は Theme と Appearance で出す（[ADR 0059](../adr/0059-thumbnail-shares-visual-theme.md)）。`TemplateFieldSpec` に座標・サイズ・回転の種別は追加しない。

## ブランド（Theme共有）

- サムネイルは独自のブランド設定を持たず、その Edition の現行 ScriptVersion の `visualTheme`（選択中 Theme Revision）を参照する。
- 描画に使うトークンは canvas、accents、text／muted／onMedia、scrim、shadow、textRoles（title／heading）の範囲とする。motion・semantic・categoryColors・surfaces は使わない。
- Theme の文字サイズは 1920x1080 基準のため、サムネイル（1280x720）ではテンプレート側でスケールする。色・書体・装飾はそのまま使う。
- 言語版共通 Appearance と候補 Appearance は、Theme を置き換えず、明示したプロパティだけを上書きする。
- Theme を変更すると、未上書きの項目は新しい Theme に追従する。明示した色・書体・サイズ・太さ・行間は保持する。
- ロゴ／チャンネル名帯は、今回は Theme に持たせず、サムネイルテンプレートの入力（画像 Asset）に置く。将来 Theme にロゴを持たせる場合は「Theme優先→入力上書き」の解決順で非破壊に移行する。

## 描画

- 描画は `packages/video` にサムネイル用コンパイラを追加し、サムネイル文書・テンプレート・Theme・Appearance から静止画 HTML（1280x720）を生成する。レンダーと同様、検証済みJSONだけから HTML を派生させ、任意 HTML を実行しない。
- プレビューは、未保存の編集中入力に対するコンパイル済み HTML をデバウンスして取得し、同一origin の `srcDoc` iframe で表示する。iframe は `sandbox="allow-same-origin"`（スクリプトは実行しない）とし、不透明originになる sandbox で実行しない。これにより HTML 内の写真（`/api/v1/assets/:id/render-content`）のリクエストが同一originとなり、メディアセッション Cookie で認可される（[../mvp/api-contract.md](../mvp/api-contract.md)）。
- プレビューAPIは未保存の言語版共通 Appearance を受け取れるため、保存前の見た目を確認できる。
- PNG（1280x720）は保存済み候補からオンデマンド生成する。管理下の Chrome とフォントでコンパイル済み HTML をラスタライズして返す。Job を作らない。
- 描画に使う背景・前景の両 Asset は、保存前とPNG生成時に ready な画像として検証する。
- コンパイルや PNG 生成は、テンプレート未対応・入力不正・素材欠損・Theme未解決などの理由で失敗しうる。失敗は JSON エラー契約で返す。

## HTTP

外部キーや内部パスは返さず、既存の共通規約（`{ data }` 封筒、Host/Origin 検証、エラー契約）に従う。詳細なDTOは [../mvp/api-contract.md](../mvp/api-contract.md) を正とする。

- `GET /api/v1/language-editions/:editionId/thumbnails` は Edition の候補一覧を返す。各候補に `isPrimary` と `appearanceOverride` を含める。
- `POST /api/v1/language-editions/:editionId/thumbnails` は候補を新規作成する。本文は `label`、`template`、`input`、任意の `appearanceOverride`。
- `GET /api/v1/thumbnails/:thumbnailId` は候補を返す。
- `PUT /api/v1/thumbnails/:thumbnailId` は候補を明示保存（上書き）する。本文は `label`、`template`、`input`、任意の `appearanceOverride`。
- `DELETE /api/v1/thumbnails/:thumbnailId` は候補を削除する。選択中を消す場合は付け替えまたは NULL にする。
- `PUT /api/v1/language-editions/:editionId/primary-thumbnail` は選択中の候補を設定する。本文は `thumbnailId`（解除は null）。
- `GET /api/v1/language-editions/:editionId/thumbnail-appearance` は言語版共通 Appearance と、Theme 由来の既定値・解決済み値を返す。
- `PUT /api/v1/language-editions/:editionId/thumbnail-appearance` は `{ appearance }`（解除は null）で共通 Appearance を保存する。
- `POST /api/v1/language-editions/:editionId/thumbnail-preview` は未保存の編集中入力（`template`、`input`、`appearanceOverride`、任意の `appearance`）のコンパイル済み HTML を返す。`appearance` を省略すると保存済み共通 Appearance を使い、null なら共通 Appearance なしでプレビューする。DBへ書かない。
- `GET /api/v1/thumbnails/:thumbnailId/image` は PNG バイト列を返す。オンデマンド生成で、DBへ書かない。
  - `Content-Type: image/png`
  - `Content-Disposition: attachment`（ファイル名は Work タイトル由来の `.png`、空題は `thumbnail.png`）
  - `X-Content-Type-Options: nosniff`、`Cache-Control: private, max-age=0, must-revalidate`
- 検証不正は `VALIDATION_ERROR`、存在しない候補は `RESOURCE_NOT_FOUND`、素材欠損は既存の `ASSET_UNAVAILABLE` 系で返す。

## UI

- 作品編集画面から、各 Language Edition のサムネイル編集を開く。
- サムネイル画面に「共通の見た目」を置き、Theme 継承中の項目をプロパティ単位でリセットできる。共通 Appearance は明示保存する。
- 候補フォームでは、必要な項目だけ候補単位の上書きを有効化できる。Font Face は既存の Font Catalog から選ぶ。
- 未保存の共通 Appearance は、候補フォームのプレビューに反映される。
- テンプレートを選び、文字・背景・前景を入力する。プレビューを表示し、明示保存で候補を保存する。
- 候補一覧を表示し、追加・選択（投稿用の1枚）・削除ができる。
- 選択中または任意の候補の PNG をダウンロードできる。
- 背景・前景の素材は既存のメディアライブラリから選ぶ。
- 透過でない前景画像は四角く表示される。アプリは透過性を検査しない。

## 対象外

- AIによるサムネイル画像生成（[../mvp/roadmap.md](../mvp/roadmap.md) の画像生成Jobは別機能）
- フリーキャンバス、絶対配置、レイヤー合成の自由編集
- 台本からの文言自動要約・自動切り出し
- サムネイルの版履歴・復元
- 16:9 以外の比率、複数サイズの同時出力
- 利用者によるテンプレート作成
- カード状の主役写真テンプレート、AI背景除去
- Work横断のAppearanceプリセットライブラリ
- 前景画像の透過メタデータ検査

## 検証

- 契約テスト: サムネイル文書v1/v2の検証、テンプレート参照、未知テンプレート拒否、素材種別の検証、Appearanceのプロパティ単位マージと正規化、縁取り色・太さの範囲。部分装飾記法の解析（入れ子・エスケープ・対になっていない記号・未許可装飾）とフィールド宣言との一致。
- コンパイラテスト: Theme トークンの適用、Appearance の継承順、背景クロップ、前景の左右・反転・倍率、1280x720 の確定性、文字量による自動サイズ、アクセント色のコントラスト解決と明示色の保持、縁取り色・太さ（全体と `%%`）、HTMLエスケープ、改行保持。
- API/統合テスト: 候補の CRUD、選択ポインタ、明示保存の上書き、選択中削除の付け替え、共通 Appearance の取得・保存・解除、未保存 Appearance のプレビュー、背景・前景両 Asset の検証、PNGのオンデマンド生成、Work削除での連鎖削除、v1文書の読み取り。
- Webテスト: テンプレ選択・入力の往復、候補の追加・選択・削除、選択範囲への装飾適用、Appearance の set/clear と継承シード。
