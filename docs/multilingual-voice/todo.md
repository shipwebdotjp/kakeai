# 多言語の声と言語版 TODO

- [x] A. 文書・ADR: 内容スキーマ履歴、AGENTS規則、オフライン前提削除（ADR-0050）、アダプター基盤V2（ADR-0051）、v8（ADR-0052）
- [x] B. アダプター基盤V2: contracts記述子・汎用声モデル・TtsAdapter一般化・VoiceProfile形変更
- [x] B. api レジストリ・config・services・worker・DTO・health 追従、DB migration
- [x] B. web 声ピッカー汎用化・ラベルAPI由来
- [x] C. locale拡大・LanguageEdition開放、`Character.voices`（DB＋library＋contentJson v8移行・検証）、Speaker解決
- [x] 完了条件: `npm run typecheck` と `npm test` を通す。既存の voicevox/aivisspeech の一覧・生成フローがV2形式で変わらず動く。ja版の既存作品がv8として読み出せる
- [x] OpenAI互換アダプター（`openai-compatible`）: `/v1/audio/speech` 合成、`/v1/models`・`/v1/audio/voices` 一覧、settings `{model}`、snapshot v3
- [ ] D（将来）: 翻訳の外部取り込み（対象Editionの候補ScriptVersion＋人の承認）
- [ ] E（将来）: locale別テキスト制約
