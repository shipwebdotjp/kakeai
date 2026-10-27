# エージェントへの Voice Adapter 説明子の公開

Status: accepted

## 背景

TTS の Voice Profile は `adapterId` を持ち、`voiceProfile.listVoices` / `voiceProfile.listModels` / `voiceProfile.create` はその ID を要求する。Agent Access は Voice Profile の書き込みを公開してきたが、対応している Adapter の種別を返す操作が無く、ライブラリに Profile が 1 つも無い状態では `voicevox` / `aivisspeech` / `openai-compatible` をエージェントが推測するしかなかった（[MP4 制作仕様](../agent-mp4-production/spec.md) の人間プリフライト）。

HTTP API は `/voice-adapters` で対応 Adapter の説明子を返している。これは `id`・表示名・既定 locale・声の選択方式・モデル選択の有無だけで、接続先 URL・環境変数名・認証情報を含まない。Agent Access では Adapter 設定の読み書きを公開しない方針であり（[ADR 0086](./0086-agent-generation-boundary-by-configured-endpoints.md)）、この説明子はその境界の外側にある静的なカタログ情報である。

## 決定

`voiceAdapter.list`（read）を公開する。入力は `{}`、出力は既存の `VoiceAdapterList`（`adapters: [{ id, label, defaultLocale, voiceSelection, modelSelection }]`）とする。既存の `listVoiceAdapters` をそのまま呼び、束縛や操作側に第二の一覧を持たない。`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く。

返さないもの:

- 接続先 URL・環境変数名・認証情報。これらは Adapter 設定であり、読み取りも変更も公開しない。
- 「現在接続できるか」という状態。一覧は対応種別であり、接続確認は `voiceProfile.listVoices` / `listModels` の `TTS_ENGINE_UNAVAILABLE` で行う。

## Considered Options

- Adapter 一覧を公開しない。→ 既存 Profile が無い新規環境で `adapterId` を推測するしかなく、誤った ID で作成を試す無駄が残る。静的な説明子だけを公開する。
- `id` だけでなく接続先 URL も返す。→ Adapter 設定の読み取りを公開しない境界に反する。返さない。
- 接続確認（ヘルスチェック）も含める。→ 全 Adapter への接続を試す重い読み取りになり、設定されていない接続先への通信も発生する。既存の `listVoices` に任せる。

## Consequences

- Agent Access 仕様の MCP 操作表・操作詳細、roadmap、todo、制作スキル、ユーザーガイドを更新する。`operationDigest` と `schemaDigest` は変わり、束縛（MCP / CLI）とアプリは同じビルドで揃える。
- エージェントは `voiceAdapter.list` で対応 Adapter を確認してから `voiceProfile.listVoices` / `listModels` / `create` へ進める。
- この決定は恒久ではない。Adapter の追加や接続状態の公開が必要になった場合は、設定の読み取り境界と合わせて新しい ADR で判断する。
