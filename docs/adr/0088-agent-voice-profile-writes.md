# エージェントへの Voice Profile 作成・更新の公開

Status: accepted

Amended by [ADR 0109](./0109-agent-operation-set-update-semantics.md)（`voiceProfile.update` を部分更新化）。

## 背景

Voice Profile の作成・更新・削除は人専用とし、エージェントには `voiceProfile.list` / `voiceProfile.get` の読み取りと、既存 Profile の `speaker.add` / `speaker.setVoiceProfile` による割り当てだけを公開してきた（[Agent Access 仕様](../agent-access/spec.md)、B8・B9）。対象 locale の Profile が無い新規作品では、エージェントは制作を止めて人間に作成を依頼するしかなかった（[MP4 制作仕様](../agent-mp4-production/spec.md)）。

一方で、Voice Profile は台本の外側にある共有ライブラリであり、作成・更新しても既存の Script Version・Audio Take は変わらない。参照は ID で行われ、更新は以後の TTS にだけ影響する。すなわち [ADR 0074](./0074-agent-direct-reversible-operations.md) の意味で可逆であり、[ADR 0086](./0086-agent-generation-boundary-by-configured-endpoints.md) の条件（利用者が設定した接続先だけを使い、接続先・認証情報・アダプター設定を読み書きしない）も満たせる。作成に必要な `voiceId` はエンジンの声一覧から選ぶ必要があり、その一覧取得もエージェント面に無いため、合わせて公開する必要がある。

## 決定

次の 4 操作を Agent Access に公開する。`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く（加算的変更）。

- `voiceProfile.listVoices`（read）: `{ adapterId, model? }` を受け、`{ adapterId, voices }` を返す。HTTP の `GET /voice-profiles/voices` と同じサービス・同じエラー（接続失敗は `TTS_ENGINE_UNAVAILABLE`）を使う。
- `voiceProfile.listModels`（read）: `{ adapterId }` を受け、`{ adapterId, models }` を返す。HTTP の `GET /voice-profiles/models` と同じサービスを使う。
- `voiceProfile.create`（mutation）: HTTP の `POST /voice-profiles` と同じ入力（`name` / `adapterId` / `voiceId` / `locale` / `settings`）を受け、`{ voiceProfile }` を返す。`requestId` は持たず、冪等台帳にも載せない（`work.create` と同じ扱い。タイムアウト後は `voiceProfile.list` で確認してから再実行する）。
- `voiceProfile.update`（mutation）: `{ voiceProfileId, name, voiceId, locale, settings }` を受け、`{ voiceProfile }` を返す。HTTP の `PATCH /voice-profiles/:id` と同じく `adapterId` は変更できない。存在しない ID は `RESOURCE_NOT_FOUND`。更新は以後の TTS にだけ影響し、既存の Audio Take は変えない。

Voice Profile の削除は人専用のまま残す。利用中の Profile は `VOICE_PROFILE_IN_USE` で守られるとはいえ、誤消去の後戻りコスト（共有ライブラリの欠損と、それを参照する台本・Character Voice の崩れ）は作成・更新と比べて大きく、可逆性の基準を満たさない。

`locale` は呼び出し側が明示する。Web UI のように声の申告 locale や記述子の既定値から導出する処理は契約に入れず、導出の指針は制作スキル側に書く。暗黙の導出は契約を曖昧にするためである。

## Considered Options

- 作成のみ公開し、更新は人専用に残す。→ エージェントが作った Profile の誤り（声の選び間違いなど）をエージェント自身が直せず、人間の手戻りが残る。更新も既存 Take を変えない可逆な操作であり、残す理由がない。不採用。
- 削除も含めて公開する。→ 共有ライブラリの欠損は台本側の参照崩れを招き、復旧が作成・更新より重い。人専用に残す。不採用。
- `listVoices` / `listModels` を公開せず、`create` のサーバー側で `voiceId` をエンジン一覧に照合する。→ `list` 型アダプター（VOICEVOX 系）での実在確認はできるが、エージェントが声を選ぶ手段を持たないままになる。一覧取得は読み取りであり、公開しない理由がない。不採用。
- `voiceProfile.create` に `requestId` を付けて冪等台帳に載せる。→ 台帳は高コスト操作（Job・Version を増やす操作）の重複防止が目的であり、ライブラリの 1 行追加は `work.create` と同じく一覧確認での回復で足りる。機構を増やさない。不採用。

## Consequences

- Agent Access 仕様の操作表・操作詳細・ポリシー文言（「ライブラリは読み取りだけ」）を改め、作成・更新の公開と削除の人専用維持を明記する。`operationDigest` と `schemaDigest` は変わり、束縛（MCP / CLI）とアプリは同じビルドで揃える。
- TTS 仕様・MP4 制作仕様・制作スキル・ユーザーガイドの「Profile が無ければ人間に依頼する」手順を、`listVoices` → `create` → `speaker.add` の手順へ置き換える。
- Character・Face Set・Theme の作成・更新・削除・アーカイブは引き続き公開しない。この決定は Voice Profile の作成・更新に限る。
- この決定は恒久ではない。削除の公開が必要になった場合は、参照崩れの回復手順と合わせて新しい ADR で再検討する。
