# OpenAI互換TTSアダプターを追加し、アダプター固有settingsを実体化する

別言語の声を出す第一歩として、OpenAI互換の `POST /v1/audio/speech` を話すローカルTTSサーバー（mlx-audio-server など）へ接続する `openai-compatible` アダプターを追加する。接続先はループバック限定を維持し、認証は扱わない（[ADR-0051](./0051-tts-adapter-registry-v2.md) のスコープ内）。リモートや認証付きは将来の別ADRとする。

これまで `VoiceProfile.settings` は VOICEVOX 系の空オブジェクトしか無かったが、OpenAI互換は合成に `model` を要する。アダプター固有settingsを `{ model: string }` として実体化し、`TtsJobSnapshot` に載せてワーカーへ渡す。`voice.styleId` を廃止した ADR-0051 に続き、`SNAPSHOT_SCHEMA_VERSION` を `3` へ上げる。

声の一覧はOpenAI仕様に標準が無いため、`GET /v1/audio/voices?model=`（Blaizzy/mlx-audio 系の慣習）を試し、取得できなければ空を返して利用者の手入力に委ねる。アダプター記述子に `voiceSelection`（`list` / `list-or-manual`）・`modelSelection`・`defaultLocale`（nullable）を持たせ、UIと検証がアダプターIDに依存せず分岐できるようにする。合成は `response_format: "wav"` を指定し、既存のWAV前提パイプラインをそのまま使う。

## Considered Options

- 声の一覧を標準APIに依存させる。→ OpenAI本体に built-in 声の一覧APIが無く、互換サーバーごとに有無が異なるため不採用。`/v1/audio/voices` があれば使い、無ければ手入力にする。
- モデルをサーバー既定に固定する。→ サーバーは複数モデルを持ち得て、声は（モデル, 声）で決まるため、`model` をプロファイル設定として保持する。
- mp3等の複数フォーマットに追従する。→ mediaTypeをスナップショットとAssetへ通す追加対応が必要で、現状のWAV前提から外れるため、今回はWAV強制とする。必要になった時に別ADRで拡張する。

## Consequences

- contracts に記述子3件目と `openAiAdapterExtrasSchema` を追加し、`TtsAdapter` は `listVoices(ctx, { settings })`・任意の `listModels(ctx)`・`synthesize(ctx, { ..., settings })` を持つ。
- `TtsJobSnapshot.settings` を追加し `SNAPSHOT_SCHEMA_VERSION` を `3` にする。適用前にキュー済みの旧TTS Jobは失敗するため、利用者が作り直す（単一利用者・開発段階で許容）。
- `GET /voice-profiles/models?adapterId=` と、`GET /voice-profiles/voices?adapterId=&model=` の `model` を追加する。
- `voiceSelection === "list-or-manual"` のアダプターは、実行中エンジンの一覧に無い声でも生成要求を受け付ける。一覧に有る場合は表示名を使う。
- 出力はWAV固定。`response_format` を無視して常にmp3を返すサーバーは誤ラベルになるため、対応が必要になれば新ADRで content-type 追従を追加する。
