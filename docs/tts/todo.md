# TTS 実装TODO

[TTS仕様](./spec.md) を正とする。上から順に進める。

## フェーズ

### [x] T1 契約と文書

- [x] ContentDocument v2（`Speaker.voiceProfileId` 必須）と v1→v2 正規化（読取）を `packages/contracts` に追加
- [x] `VoiceProfile` DTO、作成・更新リクエスト、VOICEVOX 設定スキーマ、話者一覧 DTO を追加
- [x] `tts` Job 種別、入力スナップショット、Job 結果 DTO、health capability、エラーコードを追加
- [x] `CONTEXT.md` に Voice Profile を追加し、本フォルダと [../mvp/api-contract.md](../mvp/api-contract.md)、[../mvp/roadmap.md](../mvp/roadmap.md) を参照でつなぐ
- 完了条件: `npm run typecheck` と契約テストが通り、v1/v2 の検証が成立する。

### [x] T2 永続化・アダプター・Job

- [x] Prisma `VoiceProfile` モデルと migration、`KAKEAI_VOICEVOX_BASE_URL` の検証
- [x] VOICEVOX アダプター（一覧・エンジン版・合成）とエラー分類
- [x] Voice Profile サービスと CRUD API、話者一覧 API
- [x] `tts` Job 作成サービスと worker 分岐（WAV Asset 確定、SHA 重複再利用、来歴）
- 完了条件: モックアダプターで生成・再利用・来歴・エラー契約のテストが通り、実 VOICEVOX で往復できる。

### [x] T3 Web UI

- [x] Voice Profile 管理画面（一覧・作成・更新・削除、エンジンからの話者・スタイル選択）
- [x] 台本編集画面で Speaker の作成・Profile 紐付け・各ラインへの Speaker 選択
- [x] セリフ音声欄に TTS 生成（既定スタイル・1.0倍速の初期表示、スタイルと話速の上書き、成功時の Take 追加・自動選択）
- [x] Job ポーリングと安定したエラー表示、VOICEVOX 利用規約の案内
- 完了条件: 生成後の Take 自動選択、明示保存前は ScriptVersion が変わらないこと、保存後のプレビュー・レンダー反映を確認できる。

### [x] T4 レビューとコミット

- [x] `npm run typecheck`、`npm test`、最大3回の OCR レビューと妥当な指摘の修正
