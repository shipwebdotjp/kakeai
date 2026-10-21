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

サムネイル文書は ScriptVersion の `contentJson` にも含めない。独立した契約とし、`schemaVersion: 1` から開始する（[ADR 0058](../adr/0058-thumbnail-mutable-candidates.md)）。

## データモデル

Prisma モデル `Thumbnail` を追加する。1つの LanguageEdition が複数の候補を持つ。

| モデル | 主な列 | 制約・用途 |
| --- | --- | --- |
| `Thumbnail` | `id`, `languageEditionId`, `label`, `schemaVersion`, `templateId`, `templateVersion`, `inputJson`, `createdAt`, `updatedAt` | Language Edition 配下の可変なサムネイル候補。`@@index([languageEditionId])`。テンプレート版のGC条件に使うため `templateId`/`templateVersion` を検索用カラムにも持つ。 |
| `LanguageEdition`（追加列） | `primaryThumbnailId?` | 選択中の候補。投稿に使う1枚を明示する。参照先は同じ Edition でなければならない。`currentScriptVersionId` と同じ扱い。 |

- 候補は可変とし、明示保存で `inputJson` をその場で上書きする（last-write-wins）。版履歴・復元は持たない。
- 候補の追加・削除・選択は自由。`primaryThumbnailId` を指す候補を削除する場合は、同一トランザクションで別候補へ付け替えるか NULL にする。
- `inputJson` は `{ schemaVersion: 1, template: { id, version }, input: <template固有> }` を持つJSON。テンプレートの `inputSchema` で保存前に検証する。
- `inputJson` が参照する `assetId` は、保存前に ready な素材の存在と種別（画像）をアプリケーション層で検証する。ContentDocument と同じく外部キーにはしない。
- Work削除時は、Edition 配下の候補も同一の削除計画で消す。

## テンプレート

- サムネイルテンプレートは VisualTemplate とは別のレジストリとし、`packages/contracts` に置く。`template.id@version` の意味を不変に保ち、変更は新版で行う（[ADR 0009](../adr/0009-template-version-immutability.md) と同じ規律）。
- 定義は VisualTemplate より薄い。`id`、`version`、`inputSchema`（Zod）、`inputFields`（`TemplateFieldSpec`）、`display`、`collectAssetRefs` を持ち、`layers`・`transitionPolicy`・`animationPolicy` は持たない（静止画のため）。
- フォームは既存の `TemplateFieldSpec` を再利用し、汎用フォームエンジンで描画する。テンプレート追加にエディタコードを書かせない（[ADR 0032](../adr/0032-template-input-fields-and-animation-presets.md) と同じ方針）。
- 同梱テンプレートはアプリ開発者が追加する。参照ゼロの版は削除してよいが、可変候補が参照しうるため「どの保存済み候補からも参照されていない版」を削除条件とする。

## 部分装飾（リッチテキスト）

見出しなどの文字入力は、文字列全体ではなく単語単位で装飾できる。正本は今まで通り1本の文字列で、装飾は小さな記法として同じ文字列に含める（[ADR 0080](../adr/0080-thumbnail-inline-text-marks.md)）。`input` の型は `string` のままなので `schemaVersion` は据え置く。

| 記法 | 意味 | 描画 |
| --- | --- | --- |
| `**文字**` | 太字 | `font-weight:700` |
| `*文字*` | 斜体 | `font-style:italic`（書体に斜体がない場合は合成斜体） |
| `==文字==` | アクセント色 | Theme の primary アクセント |
| `%%文字%%` | 縁取り | Theme のニュートラル色による text-shadow |
| `\` | エスケープ | 直後の記法記号をそのまま表示する |

- 装飾は任意の順で入れ子にできる。対になっていない記法記号は文字として表示し、フィールドが許可しない記法だけを保存時に `VALIDATION_ERROR`（パスは該当フィールド）とする。
- 記法記号以外の直前にある `\` はバックスラッシュのまま表示する。
- 色・書体・太さは利用者が指定しない。`TemplateFieldSpec` の `richText` が許可する装飾（`marks`）を宣言し、アクセント色は Theme の primary アクセントから解決する。
- アクセント色は背景とのコントラスト比が3未満なら、Theme のアクセントを白または scrim 方向へ寄せた色に解決する。縁取り色は文字色に対してコントラストが取れる Theme ニュートラル（`onMedia` または `scrim`）を選び、同点の場合は背景とのコントラストで決める。
- 改行はそのまま保持する（`white-space:pre-line`）。
- 同梱テンプレートは見出し・補足文で4種すべて、バッジでアクセントを除く3種を許可する。バッジは背景がアクセント色のため。
- 編集UIは textarea とツールバー（選択範囲を記法で囲む）で構成する。任意HTMLは受け付けず、contenteditable の内部状態も保存しない。

## レイアウト自由度

フリーキャンバス（ドラッグ・リサイズ・回転による絶対配置）は提供しない。テンプレートが構図を固定し、利用者は次だけを調整する。

- 写真の切り出し位置・ズーム（既存の `mediaCrop` 相当）
- 文字の寄せ・縦位置・フォントサイズ（テンプレートが許す範囲）
- 構図の配置バリアント（「写真左／右」など）を、テンプレート入力の `select` として選ぶ

構図差はテンプレートを増やすことで広げ、チャンネルごとの個性は Theme と配置バリアントで出す（[ADR 0059](../adr/0059-thumbnail-shares-visual-theme.md)）。`TemplateFieldSpec` に座標・サイズ・回転の種別は追加しない。

## ブランド（Theme共有）

- サムネイルは独自のブランド設定を持たず、その Edition の現行 ScriptVersion の `visualTheme`（選択中 Theme Revision）を参照する。
- 描画に使うトークンは canvas、accents、text／muted／onMedia、scrim、radius、textRoles（title／heading／label）、surfaces（label／caption）の範囲とする。motion・semantic・categoryColors は使わない。
- Theme の文字サイズは 1920x1080 基準のため、サムネイル（1280x720）ではテンプレート側でスケールする。色・書体・装飾はそのまま使う。
- ロゴ／チャンネル名帯は、今回は Theme に持たせずサムネイルテンプレートの入力（画像 Asset）に置く。将来 Theme にロゴを持たせる場合は「Theme優先→入力上書き」の解決順で非破壊に移行する。

## 描画

- 描画は `packages/video` にサムネイル用コンパイラを追加し、サムネイル文書・テンプレート・Theme から静止画 HTML（1280x720）を生成する。レンダーと同様、検証済みJSONだけから HTML を派生させ、任意 HTML を実行しない。
- プレビューは、未保存の編集中入力に対するコンパイル済み HTML をデバウンスして取得し、同一origin の `srcDoc` iframe で表示する。iframe は `sandbox="allow-same-origin"`（スクリプトは実行しない）とし、不透明originになる sandbox で実行しない。これにより HTML 内の写真（`/api/v1/assets/:id/render-content`）のリクエストが同一originとなり、メディアセッション Cookie で認可される（[../mvp/api-contract.md](../mvp/api-contract.md)）。
- PNG（1280x720）は保存済み候補からオンデマンド生成する。管理下の Chrome とフォントでコンパイル済み HTML をラスタライズして返す。Job を作らない。
- コンパイルや PNG 生成は、テンプレート未対応・入力不正・素材欠損・Theme未解決などの理由で失敗しうる。失敗は JSON エラー契約で返す。

## HTTP

外部キーや内部パスは返さず、既存の共通規約（`{ data }` 封筒、Host/Origin 検証、エラー契約）に従う。詳細なDTOは実装時に [../mvp/api-contract.md](../mvp/api-contract.md) へ追記する。

- `GET /api/v1/language-editions/:editionId/thumbnails` は Edition の候補一覧を返す。各候補に `isPrimary` を含める。
- `POST /api/v1/language-editions/:editionId/thumbnails` は候補を新規作成する。
- `GET /api/v1/thumbnails/:thumbnailId` は候補を返す。
- `PUT /api/v1/thumbnails/:thumbnailId` は候補を明示保存（上書き）する。本文は `label`、`template`、`input`。
- `DELETE /api/v1/thumbnails/:thumbnailId` は候補を削除する。選択中を消す場合は付け替えまたは NULL にする。
- `PUT /api/v1/language-editions/:editionId/primary-thumbnail` は選択中の候補を設定する。本文は `thumbnailId`（解除は null）。
- `POST /api/v1/language-editions/:editionId/thumbnail-preview` は未保存の編集中入力（`template`、`input`）のコンパイル済み HTML を返す。DBへ書かない。
- `GET /api/v1/thumbnails/:thumbnailId/image` は PNG バイト列を返す。オンデマンド生成で、DBへ書かない。
  - `Content-Type: image/png`
  - `Content-Disposition: attachment`（ファイル名は Work タイトル由来の `.png`、空題は `thumbnail.png`）
  - `X-Content-Type-Options: nosniff`、`Cache-Control: private, max-age=0, must-revalidate`
- 検証不正は `VALIDATION_ERROR`、存在しない候補は `RESOURCE_NOT_FOUND`、素材欠損は既存の `ASSET_UNAVAILABLE` 系で返す。

## UI

- 作品編集画面から、各 Language Edition のサムネイル編集を開く。
- テンプレートを選び、文字・画像を入力する。プレビューを表示し、明示保存で候補を保存する。
- 候補一覧を表示し、追加・選択（投稿用の1枚）・削除ができる。
- 選択中または任意の候補の PNG をダウンロードできる。
- 素材は既存のメディアライブラリから選ぶ。

## 対象外

- AIによるサムネイル画像生成（[../mvp/roadmap.md](../mvp/roadmap.md) の画像生成Jobは別機能）
- フリーキャンバス、絶対配置、レイヤー合成の自由編集
- 台本からの文言自動要約・自動切り出し
- サムネイルの版履歴・復元
- 16:9 以外の比率、複数サイズの同時出力
- 利用者によるテンプレート作成

## 検証

- 契約テスト: サムネイル文書の検証、テンプレート参照、未知テンプレート拒否、素材種別の検証。部分装飾記法の解析（入れ子・エスケープ・対になっていない記号・未許可装飾）とフィールド宣言との一致。
- コンパイラテスト: Theme トークンの適用、配置バリアント、写真クロップ、1280x720 の確定性。部分装飾の描画、アクセント色のコントラスト解決、縁取り色、HTMLエスケープ、改行保持。
- API/統合テスト: 候補の CRUD、選択ポインタ、明示保存の上書き、選択中削除の付け替え、PNGのオンデマンド生成、Work削除での連鎖削除、テンプレート版のGC条件、不正な記法の保存拒否。
- Webテスト: テンプレ選択・入力の往復、候補の追加・選択・削除、選択範囲への装飾適用。
