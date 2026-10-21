# 利用者が設定したTTS Adapterへの合成Jobはエージェントに公開し、接続設定の変更とTTS以外の課金生成は人に限る

Status: accepted

Kakeai の TTS は、利用者が事前に設定したループバックの TTS Adapter（VOICEVOX / AivisSpeech / OpenAI 互換）へ合成 Job を投入するだけで、生成された音声は `origin: generated` の Audio Asset として追加され、台本への反映も新しい Script Version の追加だけで行う。どちらも既存の正本を書き換えず、Asset の参照と Script Version は履歴から戻せるため、この合成は [ADR 0074](./0074-agent-direct-reversible-operations.md) の可逆な操作に含まれる。したがって Agent Access は `tts.create` / `tts.createBulk` を公開する。ただしエージェントは接続先・認証情報・Adapter 設定を変更できず、TTS 以外の課金生成を一般に許可しない。

## Considered Options

- TTS を人の明示操作に限り、エージェントには素材取り込みだけを公開する。→ 生成 Asset も Script Version も戻せるため、可逆性の基準と矛盾する。不採用。
- TTS を含む任意の生成 Adapter をエージェントへ開放する。→ 課金・外部送信を伴う生成は巻き戻しの範囲外であり、利用者が設定していない接続先を暗黙に使うおそれがある。不採用。
- エージェントが Adapter の接続先や認証情報も設定できるようにする。→ 利用者の意図しない外部サービスへ音声やテキストを送り得るため不採用。

## Consequences

- `tts.create` と `tts.createBulk` を Agent Access の操作として公開する。既存 HTTP の入力・出力契約、Adapter 解決、エラーコード、Job スナップショットをそのまま共有し、束縛ごとに生成ロジックを複製しない。
- 生成物は既存の `origin: generated` と `provenanceJson` で帰属を表す。TTS 専用の課金管理・プロバイダ管理や新しい帰属列は追加しない。Job の状態は既存の `job.get` / MCP・CLI の Job 待機で確認する。
- 対象は利用者が設定したループバック Adapter に限る。接続先・認証情報・Adapter 設定を変更する操作は公開せず、TTS 以外の課金生成も公開しない。
- Take の正本への反映は、既存の `script.edit` + `line.assignTake` による新しい Script Version の追加とする。
