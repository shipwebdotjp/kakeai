# 多言語の声と言語版の仕様

## 目的と境界

この文書は、将来の多言語版（まず英語）に向けて、キャラクターの声と言語の結びを正とする。台本の正本JSON契約は [../mvp/content-schema.md](../mvp/content-schema.md)、破壊変更履歴は [../mvp/content-schema-history.md](../mvp/content-schema-history.md)、HTTP契約は [../mvp/api-contract.md](../mvp/api-contract.md)、DBモデルと Job 状態遷移は [../mvp/spec.md](../mvp/spec.md) を正とし、この文書はそれらへの追加を定める。

- キャラクターは言語中立とし、見た目（`appearances`）は言語をまたいで共通に使う。声と文字だけを言語別にする。
- AI生成 Composition の bundle 内テキストは、言語別に別の Composition を作る。画像に焼き込まれた文字は素材側の責務とし、アプリのデータモデルでは扱わない。
- 翻訳と英語音声の生成は当面の対象外とする。翻訳は外部AIが対象 `LanguageEdition` の候補 `ScriptVersion` を作り、人が承認して確定する将来接続とする。素材の言語は当面タグで扱い、`Asset.language` は自動差し替えが必要になってから検討する。

## 声の言語構造

`VoiceProfile` は必須の `locale`（BCP 47、`ja-JP` など）を持つ。`locale` は選択した声の申告 locale（アダプターの一覧の `locale` またはアダプター記述子の既定）から導出・検証し、人手のラベルに依存しない。

`Character`（アプリ共通のライブラリと ContentDocument の `characters[]` の両方）は、単数の `voiceProfileId` ではなく `voices: { locale, voiceProfileId }[]` を持つ。同一 character 内で `locale` の重複は許さない。`voiceProfileId` はアプリ共通の Voice Profile を参照する。

解決規則は次のとおり。

- Edition の locale（言語部分一致、`en` ↔ `en-US`）に一致する voice を `Speaker.voiceProfileId` へ束ねる。一致する声がない場合は TTS 未設定として扱う。
- ライブラリから台本へ「追加」でコピーするときは `voices` をそのまま引き継ぐ。
- `characterId` を持たない話者（声だけのナレーター）は従来どおり `Speaker.voiceProfileId` を直接持つ。

## ContentDocument v8

`schemaVersion` は `8` とする。v7 の各 Character について、対応する話者（`characterId` 一致かつ `voiceProfileId` 非null）の声があれば document の `locale` と組にして `voices` の1件とし、なければ `voices: []` として v8 として解釈する。`locale` は `ja-JP` のみに加えて `en-US` などを許容する。

## TTSアダプター基盤

アダプターは登録式とし、`packages/contracts` のアダプター記述子（`id`・表示名・設定スキーマ・接続設定・既定 locale）を唯一の定義場所とする。アプリが知る境界は「声の一覧を取る」と「テキスト＋声＋話速を送ると音声が返る」の2つだけで、エンジン内部の生成方式は不透明とする。声はアダプター定義の不透明な `voiceId` トークンで表す。対象は別のローカルTTSエンジン（ループバック・認証なし）までとする。詳細は [ADR-0051](../adr/0051-tts-adapter-registry-v2.md) を正とする。

## API 概要

- `GET /voice-adapters` で登録済みアダプター記述子（`id`・表示名）を取得する。声ピッカーのラベルはこの応答から導出し、クライアント側に固定表を持たない。
- `GET /voice-profiles/voices?adapterId=<id>` は汎用の声（`id`・表示名・任意の `locale`）を返す。
- `VoiceProfile` は `id, name, adapterId, voiceId, locale, settings` を持つ。`settings` はアダプター固有の追加分だけを持たせる。
