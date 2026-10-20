# TTSアダプターを登録式の基盤に作り替え、声をアダプター定義の不透明トークンで扱う

`voicevox` / `aivisspeech` 固定の2アダプター構成を、登録式のアダプター基盤へ作り替える。両エンジンが日本語音声合成のみに対応するため、別言語の声には全く別の基盤（別プロトコル・別方式のエンジン）が必要になり、現行の `speakerUuid` + `styleId` という VOICEVOX 固有の形では載らない。

`packages/contracts` にアダプター記述子（`id`・表示名・設定スキーマ・接続設定・既定 locale）を置き、これを唯一の定義場所とする。アプリが知るのは「声の一覧を取る」「テキスト＋声＋話速を送ると音声が返る」の2境界だけで、エンジンが内部でローカル生成かネットワーク越しかは不透明とする。声はアダプターが定義する不透明な `voiceId` トークンで表し、`styleId` などの VOICEVOX 固有型を共通契約から外す。`VoiceProfile` は `{ id, name, adapterId, voiceId, locale, settings }` とし、`settings` はアダプター固有の追加分だけを持たせる。

## Considered Options

- 現行の style モデル（`styles[{styleId,name}]`）を共通契約として残す。→ 新エンジンは「styleId を持つ」形へ無理に写像が必要になり、別方式エンジンに不向きなため不採用。
- 声も設定も完全にアダプター所有とし、一覧すら任意にする。→ 最も拡張的だが、声ピッカー UI と契約の作り直しが最大になるため、必要になった時点で後方互換な追加として検討し、今回は不採用。

## Consequences

- `TtsAdapter` の引数を接続先込みの `ctx` と不透明 `voiceId` ベースへ一般化する。`config.voiceBaseUrls` は記述子ループで解決する。
- `TtsVoice` / `TtsJobSnapshot` / 声ピッカー UI は汎用化する。VOICEVOX 互換の合成実装は「VOICEVOX 互換」クラスとして残し、別方式アダプターは別クラスで追加する。
- `voice.styleId` を廃止したため `SNAPSHOT_SCHEMA_VERSION` を 2 へ上げる。適用前にキュー済みの旧版スナップショット Job は起動後に失敗するので、利用者が作り直す（単一利用者の開発段階のため許容する）。
- 対象は別のローカルTTSエンジン（ループバック・認証なし）までとする。クラウド／ネットワーク型（APIキー等の認証情報）を載せる場合は、認証情報の保管と送信先許可の仕組みを別途設計し、この決定を新ADRで見直す。
- 既存の `VoiceProfile` の `settingsJson` は `voiceId` と `locale` の追加に伴い移行し、VOICEVOX 系は `speakerUuid:styleId` へ畳む。
