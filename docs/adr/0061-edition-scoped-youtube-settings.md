# YouTube投稿設定はLanguageEditionごとの可変な設定境界とする

Status: Accepted

YouTube投稿時のタイトル、説明、タグ、公開設定などのメタデータは、台本（ScriptVersion）の不変な履歴やレンダー結果とは独立して編集される可変な設定である。

## 決定

- `YouTubeVideoSettings` は `LanguageEdition` に1対1で紐づく独立した可変モデルとする。
- 新規 Work または LanguageEdition の作成時に作品名（Work title）および言語版のロケールから初期設定を生成する。
- 作品名の変更や台本の保存・復元（ScriptVersion の作成）は `YouTubeVideoSettings` に影響を与えない。
- Work 複製時には `YouTubeVideoSettings` を複製するが、タイトルのみ新しい Work 名で上書きする。
- 投稿設定のテンプレート（`YouTubeSettingsTemplate`）はアプリ全体の共有資産として管理し、適用時は現在の投稿設定へのスナップショット上書きとする。エージェント（Agent Access）にはテンプレート操作を公開せず、投稿設定の取得・更新およびチャプター候補の取得のみを公開する。

## Considered Options

- 台本（ScriptVersion）の中に YouTube 投稿設定を持たせる。→ 台本を保存・復元するたびに投稿設定まで過去の状態に戻ってしまい、動画投稿前のメタデータ微調整と衝突するため不採用。
- Work 単位で共通の設定を持たせる。→ サムネイル外観と異なり、タイトルや説明欄・言語などは言語版（LanguageEdition）ごとに固有のテキストや言語設定を持つため、LanguageEdition 単位が適切である。

## Consequences

- 投稿設定は台本の不変なバージョン管理と切り離され、明示保存（last-write-wins）で最新状態が維持される。
- 作品名変更や台本編集によって投稿設定が意図せず書き換わることがない。
