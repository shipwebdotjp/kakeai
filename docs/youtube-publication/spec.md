# YouTube投稿設定とSceneチャプター仕様

## 概要

`LanguageEdition` ごとに独立した YouTube 投稿設定（`YouTubeVideoSettings`）を保持し、画面および Agent 経由で取得・更新できる。
保存済み台本（`ScriptVersion`）のタイムラインから YouTube 動画チャプター本文を自動生成し、説明欄へ挿入できる。

## 仕様

### 1. YouTubeVideoSettings データモデル
- 各 `LanguageEdition` に 1 件の `YouTubeVideoSettings` を持つ（1対1）。
- 新規 Work / LanguageEdition 作成時にデフォルト設定が生成される。
  - タイトル: Work 名（作成時に一度だけコピー）
  - 説明: 空文字 `""`
  - タグ: 空配列 `[]`
  - カテゴリ: 未設定（`null`）
  - 言語: Edition のロケールから導出（例: `ja-JP` -> `ja`）
  - 公開状態: `public`
  - 予約投稿・Premiere: なし（`publishAt` は `null`、`premiere` は `false`）
  - 各種申告（子ども向け/年齢制限/案件/現実的な合成・改変など）: すべて「該当しない」（`not_applicable`）
- 作品名の変更や台本の保存・復元では投稿設定を変更しない。
- Work 複製時には投稿設定を複製するが、タイトルのみ新しい Work 名で上書きする。

### 2. 検証ルール
- タイトル: 最大 100 文字。
- 説明: 最大 5,000 コードポイント（Unicode Code Points）。
- タグ: 個数および重複の検証。
- 予約日時（`publishAt`）: ISO 8601 形式の有効な日時文字列（公開状態によらず形式のみ検証、未来日チェックは行わない）。UTC ISO 8601 として保存。
- 子ども向け動画（`madeForKids`）の場合、コメントを許可（`allow_all`）する設定は不可。

### 3. Sceneチャプター生成ルール
- 保存済みの `ScriptVersion`（未保存ドラフトは対象外）のタイムラインから生成する。
- ナレーション Scene（`intro`, `point`, `outro`）のみを対象とし、`insert` Scene は除外する（チャプター行を出力せず、警告も出さない）。
- 各 Scene の開始時刻を `MM:SS Scene.label` または `HH:MM:SS Scene.label`（1時間以上の場合）の形式で出力する。
- 診断/警告:
  - チャプター数が 3 件未満
  - 先頭チャプターが `00:00` でない
  - いずれかの対象 Scene が 10 秒未満
  ※ 警告があってもチャプター本文は返却され、説明欄への挿入も実行できる。
  ※ タイムライン解決不可の場合はレンダーと同様のエラーとする。

### 4. テンプレート管理
- アプリ全体の名前付きプリセット（`YouTubeSettingsTemplate`）として一覧・作成・更新（上書き）・削除をサポート。
- テンプレート適用時はタイトルを含む全フィールドを上書きする（UI上で要確認）。
- AI エージェントにはテンプレート操作を公開しない。

### 5. エージェント（Agent Access）連携
- エージェントには `youtubeSettings.get`、`youtubeSettings.update`、および `script.youtubeChapters`（または `youtubeChapters.get`）のみを公開する。
