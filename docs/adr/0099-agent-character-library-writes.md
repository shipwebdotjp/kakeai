# エージェントへの Character ライブラリ作成・更新の公開

Status: accepted

Amended by [ADR 0105](./0108-agent-character-appearance-diff-operations.md)（外観の 1 件追加 addAppearance と部分更新 updateAppearance を公開する。削除は人専用のまま）。

## 背景

キャラクターライブラリの書き込みは人専用とし、エージェントには `character.list` / `character.get` の読み取りと、`character.setVoices` による声の付け替えだけを公開してきた（[ADR 0089](./0089-agent-character-set-voices.md)）。そのため立ち絵付きの作品を作るとき、使える Character がライブラリに無ければ、エージェントは制作を止めて人間に作成を依頼するしかなかった（[MP4 制作仕様](../agent-mp4-production/spec.md)）。

Character は台本の外側にある共有ライブラリであり、作成・更新しても既存の Script Version・Audio Take・レンダー成果物は変わらない。台本へは `character.addFromLibrary` でコピーするため、ライブラリの変更は以後のコピーにだけ影響する（[ADR 0026](./0026-character-library-copy-semantics.md)）。参照は ID で行われ、音声の生成も外部公開も伴わない。すなわち [ADR 0074](./0074-agent-direct-reversible-operations.md) の意味で可逆であり、[ADR 0088](./0088-agent-voice-profile-writes.md) で Voice Profile の作成・更新を公開した判断と平仄が合う。外観の画像・Face Set・Voice Profile の検証は、HTTP の作成・更新契約と同じサービス層が既に持っている。

## 決定

次の 2 操作を Agent Access に公開する。`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く（加算的変更）。

- `character.create`（mutation）: `{ name, names?, voices?, appearances? }` を受け、`{ character }` を返す。`names` / `voices` / `appearances` の省略時は空配列とする。HTTP の `POST /characters` と同じサービス（`createCharacter`）を呼ぶ。
- `character.update`（mutation）: `{ characterId, name?, names?, voices?, appearances? }` を受け、`{ character }` を返す。**省略した項目は変更しない**。指定した配列はその全体を置き換える。現在値の読み取りと指定項目のマージは書き込みと同じトランザクション内で行い、同時の `character.setVoices` や UI 編集を古いスナップショットで上書きしない。1 項目も指定しない呼び出しは `VALIDATION_ERROR` とする。

外観は `{ assetId, expression, pose, label?, faceSetId? }` で受け、`id` はサーバーが生成する。ライブラリの外観 ID は台本のコピーにも Face Set にも参照されない内部キーであり、呼び出し側にグローバル一意な ID を発明させると衝突だけが増えるためである。

- 検証は既存サービスをそのまま使う。`assetId` は `kind=image` かつ `status=ready` の Asset、`faceSetId` は実在する Face Set、`voiceProfileId` は実在し `locale` が一致する Profile でなければならない。
- 存在しない `characterId` は `RESOURCE_NOT_FOUND`、上記の参照欠落・不一致、空名、locale 重複、更新項目ゼロは `VALIDATION_ERROR` とする。
- `requestId` は持たず、冪等台帳に載せない（`work.create`・`voiceProfile.create` と同じ扱い）。タイムアウト後は `character.list` / `character.get` で確認してから再実行する。更新は状態の置換なので再送してよい。

`character.delete` は公開せず、人専用のまま残す。ライブラリの削除は取り消し手段が無く、復旧は再作成しかない。台本側はコピーを持つため参照は壊れないが、[ADR 0088](./0088-agent-voice-profile-writes.md) と同じく実体削除は可逆性の基準を満たさない。

## Considered Options

- HTTP と同じ全項目必須の更新（`character.update` に `name` / `names` / `voices` / `appearances` をすべて要求する）。→ 空配列は正当な値なので、「声を変えないつもりで `voices: []` を送って全消し」が型では防げない。更新のたびに読んだ内容をすべて送り直す規律にも依存する。部分更新にして省略＝不変とすれば、この事故を契約で防げる。不採用。
- 外観を `addAppearance` / `updateAppearance` / `removeAppearance` の 3 操作に分ける。→ 取りこぼしには最も強いが、操作数が増え、追加は再送で重複し得る。ADR 0089 が声について「1 件ずつより配列置換の 1 操作」を選んだのと同じ理由で、外観も配列置換に寄せた。不採用。
- `character.delete` も含めて公開する。→ 取り消し不可で、復旧は再作成のみ。人専用に残す。不採用。
- `character.create` / `character.update` に `requestId` を付けて冪等台帳に載せる。→ 台帳は高コスト操作（Job・Version を増やす操作）の重複防止が目的であり、ライブラリの 1 行の作成・更新は読み直し確認で足りる。ADR 0088 / 0089 と同じ理由で不採用。

## Consequences

- Agent Access 仕様の操作表・操作詳細・ポリシー文言を改め、Character の作成・更新の公開と削除の人専用維持を明記する。`operationDigest` と `schemaDigest` は変わり、束縛（MCP / CLI）とアプリは同じビルドで揃える。
- 操作ディスパッチャが 800 行に達していたため、ライブラリ（Character / Face Set / Voice Profile / Theme）の操作定義を `apps/api/src/agent/library-operations.ts` へ分割し、ファイルサイズ baseline から `apps/api/src/agent/operations.ts` を外す。
- 外観の画像は利用者が取り込んだ ready な画像 Asset に限る。画像生成は別機能であり、この決定には含まない。
- ライブラリの編集は既存台本のコピーへ波及しない。既存作品の見た目は、人間が UI で作品ローカルの Character を編集するか、`character.addFromLibrary` でコピーし直してセリフを割り当て直す。スキルとユーザーガイドに明記する。
- この決定は恒久ではない。削除や Face Set・Theme の書き込みが必要になった場合は、参照崩れの回復手順と合わせて新しい ADR で再検討する。
