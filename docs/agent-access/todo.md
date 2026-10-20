# Agent Access 実装TODO

[Agent Access 仕様](./spec.md) を正とする。台本の編集操作は [台本編集操作コア](../editor-core/todo.md) の E1〜E5 を前提とし、このフォルダでは束縛と帰属を実装する。

## フェーズ

### [x] A1 文書

- [x] [ADR 0074](../adr/0074-agent-direct-reversible-operations.md)（AI は可逆操作を直接実行してよい）と [ADR 0075](../adr/0075-agent-local-socket-single-writer.md)（ローカルソケットで単一ライター）を追加し、[ADR 0015](../adr/0015-minimal-local-api-protection.md) に `amended by` を付ける
- [x] [ADR 0076](../adr/0076-shared-script-operation-core.md)（編集意味論は共有操作コア）と [台本編集操作コア仕様](../editor-core/spec.md) を追加する
- [x] `CONTEXT.md` に Agent と Version Author を追加する
- [x] roadmap の「AI が作品の正本を自動更新しない」記述を可逆／不可逆の境界へ改め、本仕様への参照を張る
- [x] main の変更を取り込み、Agent Access の ADR 番号を 0074 / 0075 へ振り直す
- 完了条件: 本フォルダ、ADR、CONTEXT、roadmap、`../mvp/spec.md` の記述が互いに矛盾しない。

### [ ] A2 帰属と契約

- [ ] Prisma `ScriptVersion` に `author`（`human` / `agent`）、任意の `authorAgentId`、任意の `agentRequestId` と `agentRequestHash` を追加し、`@@unique([languageEditionId, agentRequestId])` と migration を作る
- [ ] ScriptVersion DTO と保存経路に帰属を追加する（UI・HTTP API は既定で `human`）
- [ ] 操作コアのスキーマを Agent Access の入出力として公開し、`schema.get` が返す内容（`contentSchemaVersion`、VisualTemplate の `inputFields` と制約、操作カタログ、警告コード、`schemaDigest`）を定義する
- [ ] `script.edit` の入力（`baseScriptVersionId`・`requestId`・`operations`）と結果（版・作成 ID・警告・timeline）を `packages/contracts` に定義する
- 完了条件: `npm run typecheck` と契約テストが通り、帰属と再送の同一性を含む ScriptVersion の保存・読出しが成立する。

### [ ] A3 操作面とローカル制御ソケット

- [ ] 常駐アプリプロセスで操作面をローカル OS ソケットに公開し、ディレクトリ `0700`・ソケット `0600` で保護する
- [ ] NDJSON のハンドシェイク（`protocolVersion`・`agentId`）、要求・応答、最大ペイロード、タイムアウトを実装する
- [ ] アプリ未起動時の `AGENT_APP_UNAVAILABLE`、不正フレームの `AGENT_PROTOCOL_MISMATCH`、未登録操作の `AGENT_OPERATION_UNKNOWN` を実装する
- [ ] `script.edit`（基準版の一致、`requestId` の再送、一括適用、保存検証、帰属）を操作コア経由で実装する
- [ ] `script.validate`（書込みなしの検証と timeline）と `script.save`（全体置換）を実装する
- [ ] `asset.import`（ローカルパス入力、内容ハッシュ由来の `storageKey`、任意の来歴、サイズ上限）を実装する
- [ ] 可逆操作のみを公開し、実体削除・外部公開・課金生成を含めない
- 完了条件: ソケット越しに `work.create`→`script.edit`→`asset.import`→`render.start`→`job.get` が通り、worker が単一のままである。

### [ ] A4 Composition authoring の束縛

- [ ] `composition.list` / `composition.get` / `composition.draft.get` / `composition.authoringContext` を既存サービスへ接続する
- [ ] `composition.create` / `composition.draft.save` / `composition.publish`（`dryRun` を含む）を接続する
- [ ] 操作面から Composition の実体削除を公開しない
- 完了条件: MCP から Composition を作成し、publish した version を `script.edit` の `composition.full-bleed@1` 参照へ渡せる。

### [ ] A5 MCP 束縛

- [ ] MCP stdio サーバーを実装し、操作コアへ接続する薄いクライアントにする
- [ ] 操作を MCP ツールとして公開し、`schema.get` と操作カタログを返す
- [ ] 長尺操作を Job 投入＋`job.get` ポーリングとして公開する
- 完了条件: 実エージェントから MCP 経由で作成・編集・取り込み・Composition 作成・レンダーが通り、エラーが安定コードで返る。

### [ ] A6 CLI 束縛

- [ ] MCP と同じ操作コアを呼ぶ CLI を追加し、操作名をサブコマンドとして公開する
- 完了条件: CLI 経由で A5 と同じ往復ができ、MCP と挙動が一致する。

### [ ] A7 Web UI

- [ ] 版履歴に帰属（利用者／エージェント、任意のエージェント識別）を表示する
- [ ] エージェント作の版を内容確認して巻き戻せるようにする
- 完了条件: エージェント作の版を UI で識別でき、内容を確認して巻き戻せる。

### [ ] A8 レビューとコミット

- [ ] `npm run typecheck`、`npm test`、最大3回の OCR レビューと妥当な指摘の修正
