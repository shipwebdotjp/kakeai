# ライブパッケージは声のスナップショットと参照音声だけを持ち、TTS接続設定はライブアプリに置く

Status: accepted

ライブパッケージの`characters.json`は、声の不変スナップショット（`adapterId`・`voiceId`・`speedScale`・`settings`・参照音声の相対パス）だけを持つ。TTSエンジンの`baseUrl`・APIキー・接続先はライブアプリのローカル設定に置く。参照音声はパッケージにコピーし、実行時に絶対パスへ解決する。

## Context

- OpenAI互換TTSの参照音声モードは、`TtsSynthesisRequest.refAudioPath`に、同一マシン上のTTSエンジンが読める絶対パスを要求する。
- 現行Kakeaiは、TTSの`baseUrl`をループバックに制限している。接続設定をライブパッケージへ入れると、パッケージが環境依存の接続設定の正本になり、配布・共有・再実行で壊れる。
- 参照音声のAssetをパッケージに含めないと、該当Voice Profileの生成レスが実行時に必ず失敗する。
- ライブの生成レスは、KakeaiのTTS Job APIを経由せず、TTSアダプタを直接呼ぶ。Jobは永続化と監査に向くが、即時生成には重い。

## 決定

- パッケージの`characters.json`の声は、`adapterId`・`voiceId`・`speedScale`・`settings`・`refAudio`（パッケージ内の相対パス）を持つ。`baseUrl`・APIキー・接続先は持たない。
- ライブアプリのローカル設定に`tts.adapters`（`baseUrl`・任意のAPIキー）を置く。ローカルTTSはKakeaiと同じくループバックのみ許可する。
- 書き出し時に、参照音声を使うVoice Profileの参照音声Assetを`media/voice/`へコピーし、manifestにハッシュ・mediaType・尺を記録する。
- 書き出し時に、各Voice Profileで短いテスト合成を1回行う。失敗したVoice Profileがあれば、書き出しを失敗させる。
- 実行時に、ライブアプリが`refAudio`の相対パスを絶対パスへ解決し、`TtsSynthesisRequest.refAudioPath`に渡す。
- パッケージにはTTSエンジンの接続設定を含めない。ライブアプリの設定画面または設定ファイルで管理する。

## Considered Options

- パッケージに`baseUrl`を含める。→ 接続設定がパッケージの正本になり、環境移行・共有・セキュリティの境界が曖昧になるため不採用。
- ライブアプリがKakeaiのTTS Job APIを呼ぶ。→ Jobの永続化・ポーリングがライブの即時生成に重く、Kakeaiの起動も必要になるため不採用。
- 参照音声をパッケージに含めず、KakeaiのAssetを絶対パスで参照する。→ パッケージが自己完結せず、別マシンで動かないため不採用。
- 参照音声を使うVoice Profileをライブで禁止する。→ 声の選択肢を狭め、KakeaiのVoice Profileと一致しなくなるため不採用。

## Consequences

- パッケージは声の不変スナップショットと参照音声を持ち、接続設定は環境ごとに差し替えられる。
- 参照音声の欠落を書き出し時に検出できる。当日の生成レス失敗を減らせる。
- ライブアプリにTTS接続設定が必要になる。ローカルTTSのループバック制限を維持する。
- 参照音声のファイルサイズとハッシュをmanifestで管理するため、パッケージが少し大きくなる。
- KakeaiのTTS Jobとライブの直接合成で、同じアダプタ契約を使う。実装は共有パッケージへ切り出す。
