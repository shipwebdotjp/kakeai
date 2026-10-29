# YouTube投稿設定とSceneチャプター挿入

## Summary

- `LanguageEdition` ごとに、台本・レンダーとは独立した可変の「YouTube投稿設定」を保存する。YouTube API、OAuth、アップロードJob、リモート動画IDは今回追加しない。
- 公開状態の既定値は `public` とする。新規Workでは作品名をYouTubeタイトルへ一度だけコピーし、以後は独立して編集する。
- 説明欄には、保存済み台本の全Sceneから `時刻 Scene.label` 形式のチャプター一覧を生成し、カーソル位置へ挿入できる。

## Key changes

- `YouTubeVideoSettings` をEditionに1件だけ持つPrismaモデルとして追加する。`schemaVersion`、検証済み`settingsJson`、作成・更新日時を持ち、既存Editionも初期設定を作成する。Work複製では設定を複製し、作品名変更・台本保存では変更しない。
- `packages/contracts` に `YouTubeVideoSettingsDocument v1`、DTO、厳密な更新リクエストを追加する。`GET` / `PUT /language-editions/:editionId/youtube-settings` で明示保存・last-write-winsとする。
- 保存対象は、タイトル・説明・タグ・カテゴリ・言語・字幕認証・撮影情報・教育詳細・Shorts関連動画、視聴者／年齢／案件／合成コンテンツ申告、公開／予約／Premiere、ライセンス・埋込・通知・統計、コメント・高評価、チャプター・場所・Shortsリミックスとする。
- 初期値は、タイトル＝Work名、説明＝空、タグ＝空、カテゴリ＝未選択、言語=言語版から最適なものを導出、公開＝`public`、予約・Premiere＝なし、子ども向け／年齢制限／案件／現実的な合成・改変＝すべて「該当しない」とする。
- タイトル100文字、説明5,000コードポイント、タグ上限・重複、予約日時、案件制限、子ども向け動画のコメント不可などを保存時に検証する。
- `buildYouTubeChapterList` を `packages/video` に追加し、保存済み`ScriptVersion`の`resolveTimeline`と全Sceneの`label`から `00:00 導入` 形式の本文候補・診断を生成する。未保存ドラフトは使わない。
- `GET /script-versions/:scriptVersionId/youtube-chapters` を追加する。固定尺超過などタイムラインを解決できない入力は既存レンダーと同じエラー、YouTube章の条件未達は本文候補と警告を返す。
- 投稿設定画面の説明欄に「Sceneチャプターを挿入」ボタンを置く。空行を整えて現在のカーソル／選択範囲に本文を挿入し、保存前に利用者が自由に編集できる。再クリック時の自動置換や不可視マーカーは持たない。
- 章が3件未満、先頭が`00:00`でない、または各Sceneが10秒未満なら、挿入は行いつつYouTubeで章として認識されない可能性を警告する。手動チャプターは自動チャプターより優先される。 [YouTubeの動画チャプター要件](<https://support.google.com/youtube/answer/9884579>)
- サムネイルとSRT字幕は投稿設定JSONに複製せず、既存のThumbnail仕様と保存済みScriptVersion由来のSRTを将来の投稿処理で参照する。
- 設定した項目をテンプレートとして保存できるようにし、次回読み込んで最利用できる形にする
- AIエージェントにもこれらの機能を公開する

## Documentation and tests

- `docs/youtube-publication/spec.md` と`todo.md`を新設し、MVP仕様・API契約・Scene Label仕様・`CONTEXT.md`を同期する。Edition単位の可変設定という境界はADR 0061に記録する。
- 契約テストで初期値、未知フィールド拒否、文字数・タグ・予約・条件付き設定を確認する。
- チャプター生成で秒・分・時間表記、Scene順・label、短いSceneの警告、解決不能な台本を確認する。
- 統合テストで既存Edition移行、作成・複製・削除、設定GET/PUT、台本とは独立した保存を確認する。Webテストでは説明欄への挿入・警告・保存往復を確認する。
- `npm run db:generate --workspace @kakeai/api`、`npm run typecheck`、`npm test`、OCRレビューを最大3回実施後にコミットする。

## Assumptions

- 再生リスト、収益化・広告適性、著作権チェック、終了画面、カードは今回の保存対象外とする。
- `Scene.label` を公開用チャプター名として流用する。label自体を自動変更せず、必要なら利用者が既存のScene名を編集する。
- YouTube APIで直接設定できる値とStudio専用値は将来の変換層で区別し、Studio専用値も設定・チェックリストには保持する。 [YouTube Studioの投稿設定](<https://support.google.com/youtube/answer/57407>)、[Videos resource](<https://developers.google.com/youtube/v3/docs/videos>)