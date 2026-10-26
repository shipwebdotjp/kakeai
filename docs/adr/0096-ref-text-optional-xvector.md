# 参照音声の参照テキストを任意にし、x-vector 方式を選べるようにする

[ADR 0095](./0095-openai-tts-reference-audio.md) で参照音声利用時は `refText`・`langCode` を必須化したが、`refText` の必須化を撤回する。Qwen3-TTS は `ref_audio` のみ（`ref_text` なし）でも生成でき、この場合は参照テキストを使わない x-vector 方式（話者埋め込みのみ）になる。クロスリンガル（日本語参照→中国語出力など）では ICL 方式が参照テキストの言語に引っ張られて出力言語の読みが崩れるため、精度は落ちるものの x-vector 方式を選べる必要がある。

契約は `refAudioAssetId`・`langCode` を必須、`refText`・`maxTokens` を任意とし、アダプターは `refText` がある場合だけ `ref_text` を送る。`langCode` は x-vector 方式でも出力言語の指定に使うため必須のまま残す。サーバーのバッチ可否判定は `ref_audio` の有無だけでも直列実行に落ちるため、合成経路の変更は不要である。

## Considered Options

- `refText` に空文字やダミーを送って x-vector 相当にする。→ サーバーが空文字をどう扱うか不定で、意図しない ICL 動作になる恐れがあるため不採用。送らないことを明示する。
- 方式を表す `mode` フィールドを追加する。→ `refText` の有無がそのまま方式の判別になるため、冗長なフィールドは持たない。

## Consequences

- `openAiAdapterExtrasSchema` の `superRefine` から `refText` 必須を外す。既存の ICL プロファイル（`refText` あり）はそのまま動き、スナップショット互換性に影響しない。
- `docs/tts/spec.md` の参照音声の章を ICL / x-vector の切り替えとして書き直す。ユーザーガイドと MCP・Agent Access の `refText` 必須の記述を任意に直す。
