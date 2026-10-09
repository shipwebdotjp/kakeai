# TTS（ローカルTTSアダプター）仕様

## 目的と境界

この文書は、Kakeai が別途起動したローカル TTS エンジンへ接続し、`NarrationSegment` ごとに音声 Take を生成する機能の正とする。ContentDocument の構造は [../mvp/content-schema.md](../mvp/content-schema.md)、HTTP 契約は [../mvp/api-contract.md](../mvp/api-contract.md)、DB モデルと Job 状態遷移は [../mvp/spec.md](../mvp/spec.md) を正とし、この文書はそれらへの TTS 固有の追加を定める。

- アプリ内へ音声モデルを組み込まない。TTS エンジンの起動・停止・同梱・更新は Kakeai の責務に含めない。
- 複数のローカル TTS エンジンを同時に利用できる。初期対象は VOICEVOX ENGINE と AivisSpeech Engine の通常話者のみとする。歌唱、モーフィング、辞書編集、音高・抑揚・音量の調整、Aivis Cloud API は含めない。
- TTS は利用者の明示的な生成操作だけで実行する。自動生成・自動保存・既存 ScriptVersion の書換えは行わない。生成した音声は通常の手動音声と同じ Audio Take 候補として編集フォームへ追加し、明示保存でだけ ScriptVersion へ入る。
- エンジン本体の利用表記と、選択した音声モデル／ライブラリの個別規約の確認は利用者の責任とし、UI とユーザーガイドで案内する。AivisSpeech 本体のクレジット表記は必須ではないが、音声モデルごとにライセンス確認が必要である。

## ContentDocument v2

`Speaker` に必須の `voiceProfileId: string | null` を追加し、ContentDocument の `schemaVersion` を `2` にする。

- `voiceProfileId` はアプリ共通の Voice Profile を参照する。`null` は TTS に使う声が未設定であることを表す。旧版同様、JSON ではこのキーを省略しない。
- アダプター固有の値（VOICEVOX のキャラクター UUID やスタイル ID）は Voice Profile 側にだけ保持し、ContentDocument へ持ち込まない。
- 保存済みの v1 は読み取り・プレビュー・レンダーを維持する。読出し時はメモリ上で全 Speaker の `voiceProfileId` を `null` にした v2 へ正規化し、内部・コンパイラ・レンダーは v2 だけを扱う。保存は常に v2 の新しい ScriptVersion を作る。保存済み JSON は書き換えない。
- v1 の読出し解釈は [ADR 0013](../adr/0013-content-schema-version-starts-at-1.md) の「破壊的変更時に版を上げて移行する」に従い、実際に版を上げるこの変更で追加する。

## Voice Profile

Voice Profile はアプリ共通の声の設定であり、作品台本（`Speaker`）から ID で参照する。

- 表示名、アダプター ID、アダプター専用の設定 JSON、作成・更新日時を持つ。
- `adapterId` は `voicevox` または `aivisspeech` で、作成後は不変とする。アダプターを変えたい場合は新規 Profile を作成し、キャラクター／話者を付け替える。
- 設定はアダプター別のスキーマで検証する。`voicevox` と `aivisspeech` の初期設定形は共通で `{ "speakerUuid": string, "defaultStyleId": number }` とする。`speakerUuid` は接続先エンジンの `/speakers` が返す `speaker_uuid`、`defaultStyleId` は同じ話者の `styles[].id` である。
- `styleId` は任意の 32bit 符号付き整数（`-2147483648`〜`2147483647`）とする。AivisSpeech の VOICEVOX 互換スタイル ID は負値になり得るため、非負制約を設けない。
- 変更は将来の生成だけに効く。既に生成済みの Asset と Job スナップショットは変えない。
- Voice Profile を参照する ScriptVersion が存在する間は削除を拒否する。
- Profile を参照する Speaker を持たない台本、または参照先 Profile が欠けた台本は保存できる。生成時にだけ「未設定」として拒否する。

## TTS アダプター

音声の一覧取得と合成をアダプター境界で抽象化する。アダプター ID ごとに接続先を解決し、エンジン本体は VOICEVOX 互換 HTTP API を共有実装で扱う。

- 登録済みアダプターは `voicevox` と `aivisspeech` の 2 つとする。各 Profile と Job は `adapterId` から正しい接続先を解決する。
- 一覧: `GET /speakers` から `speaker_uuid`、`name`、`styles[].id`、`styles[].name` を得る。`GET /version` からエンジン版を得る。返す `voiceId` は `speaker_uuid` とし、`styleId` はスタイル ID（符号付き整数）とする。
- 合成: `POST /audio_query?text=<speechText>&speaker=<styleId>` でクエリ JSON を得て `speedScale` だけを上書きし、`POST /synthesis?speaker=<styleId>` へ渡して WAV バイト列を得る。AivisSpeech の AudioQuery は VOICEVOX と互換性差分があるため、`intonationScale`・`tempoDynamicsScale`・アクセント句・`kana` など他フィールドは変更せず、汎用的な VOICEVOX 用の編集を持ち込まない。
- 接続失敗（未起動を含む）とエンジンの入力拒否（4xx）と合成失敗を、別々の安定したエラーコードへ分類する。外部 HTTP エラーの本文は API レスポンスへ漏らさない。
- 接続先は環境変数で設定する。既定と変数は次のとおり。
  - `KAKEAI_VOICEVOX_BASE_URL`: 既定 `http://127.0.0.1:50021`
  - `KAKEAI_AIVISSPEECH_BASE_URL`: 既定 `http://127.0.0.1:10101`
- いずれも HTTP かつループバックのみを受け入れ、認証情報・パス・クエリ・フラグメントを拒否する。起動時に検証し、不正なら起動を失敗させる。
- AivisSpeech の話者・スタイルはモデルの追加・削除で変わり得るため、生成前に毎回実行中エンジンの一覧で Profile 設定を検証する。

## TTS Job

1 Narration Segment につき 1 つの `tts` Job を実行する。

- Job は台本版、Segment ID、凍結した `speechText`、Voice Profile から解決した `voice`（`voiceId` と `styleId`）、`adapterId`、話速、エンジン版を入力スナップショットへ保持する。`speechText` は生成要求で直接渡せる（省略時は保存済みセグメントの値）。これにより未保存の編集内容でも生成でき、生成後に明示保存すると1つの版にまとまる。空文字・長すぎるテキストは 422 `TTS_INPUT_INVALID` とする。台本版の ID と Work・LanguageEdition を Job の対象として持つ。
- 生成成功時は WAV を `origin: "generated"` の `ready` な Audio Asset として確定する。SHA-256 が一致する既存 Asset があればその Asset を再利用し、新しい行・ファイルを作らない。
- Asset の `originalFilename` は `tts-<adapterId>-<話者名>-<スタイル名>[-<話速>x]-<narrationSegmentId>.wav` とする。話速は 1.0 以外のときだけ付ける。名前に使えない文字は `_` に置換し、空なら `speakerId` / `styleId` へフォールバックする。再利用時は最初の生成時の名前を保持する。
- 来歴にはアダプター、`voiceId`、`styleId`、話速、エンジン版、元 ScriptVersion と Segment を保存する。
- Job 結果は生成済み Audio Take 候補（`narrationSegmentId`、`assetId`、`durationMs`、`source: "tts"`）を返す。UI はこれを編集フォームへ Take として追加し、自動選択して未保存状態にする。
- 生成済み音声は通常の Take と同様に切替・選択解除・削除できる。

## エラー

生成要求（キュー投入前）:

| code | HTTP | 発生条件 |
| --- | --- | --- |
| `TTS_INPUT_INVALID` | 422 | 空の `speechText`、Speaker/Profile 未設定、Profile のアダプター外スタイル、不正な話速 |
| `TTS_ENGINE_UNAVAILABLE` | 503 | エンジン未起動・接続失敗・不正な応答 |

Job 実行中の失敗（`GET /jobs/:jobId` の `status: failed`）:

| code | 意味 |
| --- | --- |
| `TTS_ENGINE_UNAVAILABLE` | 合成時にエンジンへ接続できない |
| `TTS_INPUT_REJECTED` | エンジンが入力を拒否した |
| `TTS_SYNTHESIS_FAILED` | 合成または WAV 確定に失敗した |

## API 概要

- `GET /voice-profiles`、`POST /voice-profiles`、`PATCH /voice-profiles/:id`、`DELETE /voice-profiles/:id`
- `GET /voice-profiles/voices?adapterId=voicevox|aivisspeech` で接続中エンジンの話者とスタイルを取得する
- `POST /script-versions/:scriptVersionId/narration-segments/:narrationSegmentId/tts-jobs`
  - 任意の `speechText`、`styleId`、`speedScale`（既定 1.0）を受け付ける。`speechText` を省略すると保存済みセグメントの値を使う
- `GET /health` の `capabilities.jobKinds` に `tts`、`capabilities.voiceAdapters` に登録済みアダプター（`voicevox`、`aivisspeech`）を含める

Job 種別は `asset_ingest` / `render` / `tts` の 3 つとなる。単一 worker、`queued → running → succeeded|failed`・`queued → cancelled` の状態遷移、リースなし、起動時 `WORKER_INTERRUPTED` 掃除は [ADR 0020](../adr/0020-no-job-lease-startup-reap.md) と [../mvp/spec.md](../mvp/spec.md) の規則をそのまま適用する。

## Prisma

既存の `VoiceProfile.adapterId`（文字列）と `settingsJson` をそのまま使う。アダプター追加に伴う migration は不要で、既存 VOICEVOX Profile・Job・Asset は変更しない。
