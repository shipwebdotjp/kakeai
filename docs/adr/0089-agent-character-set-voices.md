# エージェントへの Character Voice 付け替えの公開

Status: accepted

## 背景

キャラクターライブラリの管理は人専用とし、エージェントには `character.list` / `character.get` の読み取りと、操作コアの `character.addFromLibrary` による台本へのコピーだけを公開してきた（[Agent Access 仕様](../agent-access/spec.md)、B9）。立ち絵が必要な作品で対象 locale の声が無い場合、エージェントは声付きキャラクターの作成を人間に依頼するしかなかった（[MP4 制作仕様](../agent-mp4-production/spec.md)）。

一方で、Character の `voices`（locale 別の Voice Profile 割り当て）は、台本の外側にある共有ライブラリの付け替えであり、既存の Script Version・Audio Take は変えない。参照は ID で行われ、変更は以後の `addFromLibrary` コピーとその先の TTS にだけ影響する。すなわち [ADR 0074](./0074-agent-direct-reversible-operations.md) の意味で可逆であり、[ADR 0088](./0088-agent-voice-profile-writes.md) で Voice Profile の作成・更新を公開した判断と平仄が合う。声の実在確認と locale 一致の検証は、HTTP の作成・更新契約と同じサービス層が既に持っている。

## 決定

`character.setVoices`（mutation）を Agent Access に公開する。`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く（加算的変更）。

- 入力は `{ characterId, voices }` を受け、`{ character }` を返す。`voices` は `{ locale, voiceProfileId }[]` で、HTTP と同じ `characterVoicesSchema`（locale 重複不可）で検証する。空配列も許し、全解除できる。
- 検証は既存サービスをそのまま呼ぶ。参照する Profile は実在し、その `locale` と voice の `locale` が一致しなければならない。一括TTSの声選びと同じく、申告 locale の導出は行わず呼び出し側が明示する。存在しない Character は `RESOURCE_NOT_FOUND`、参照欠落・locale 不一致・locale 重複は `VALIDATION_ERROR` とする。
- 外観（立ち絵・表情・Face Set 参照）の変更、Character の作成・削除は公開せず、人専用のまま残す。声の付け替えは外観に触れない。
- `requestId` は持たず、冪等台帳に載せない（`work.create`・`voiceProfile.create` と同じ扱い）。タイムアウト後は `character.get` で確認してから再実行する。

## Considered Options

- `character.create` / `character.update` の全体公開。→ 外観には ready な画像素材・Face Set・expression/pose の指定が要り、ライブラリキュレーションの判断が混ざる。今回の要望（声の割当て）に直結するのは声だけであり、影響範囲を絞る。不採用。
- 声の追加・削除を1件ずつ行う操作（`character.addVoice` / `character.removeVoice`）。→ locale 置換は冪等にしづらく、操作数が増える。配列置換の1操作で十分であり、不採用。
- 作成・更新と同様に `requestId` 付き冪等化。→ 台帳は高コスト操作（Job・Version を増やす操作）の重複防止が目的であり、ライブラリの付け替えは読み直し確認で足りる。ADR 0088 と同じ理由で不採用。
- 空配列（全解除）の禁止。→ 声の無い Character は `addFromLibrary` で `voiceProfileId: null` の Speaker になるだけで、保存・生成時の既存規則（`TTS_INPUT_INVALID`）で扱える。人間の UI と同じく許す。

## Consequences

- Agent Access 仕様の操作表・操作詳細・ポリシー文言（「Voice の形成を含む」）を改め、`character.setVoices` の公開と Character の作成・外観変更・削除の人専用維持を明記する。`operationDigest` と `schemaDigest` は変わり、束縛（MCP / CLI）とアプリは同じビルドで揃える。
- MP4 制作仕様・制作スキル・ユーザーガイドの「立ち絵が必要なら声付きキャラクターの作成を依頼する」を、「既存 Character への声付けはエージェントが行い、Character 自体の新規作成だけを依頼する」へ置き換える。
- この決定は恒久ではない。Character の作成・外観変更の公開が必要になった場合は、素材参照の検証と合わせて新しい ADR で再検討する。
