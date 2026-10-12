# Agent Access 実装TODO

[Agent Access 仕様](./spec.md) を正とする。上から順に進める。

## フェーズ

### [x] A1 文書

- [x] [ADR 0043](../adr/0043-agent-direct-reversible-operations.md)（AI は可逆操作を直接実行してよい）と [ADR 0044](../adr/0044-agent-local-socket-single-writer.md)（ローカルソケットで単一ライター）を追加し、[ADR 0015](../adr/0015-minimal-local-api-protection.md) に `amended by` を付ける
- [x] `CONTEXT.md` に Agent と Version Author を追加する
- [x] roadmap の「AI が作品の正本を自動更新しない」記述を可逆／不可逆の境界へ改め、本仕様への参照を張る
- 完了条件: 本フォルダ、ADR、CONTEXT、roadmap、`../mvp/spec.md` の記述が互いに矛盾しない。

### [ ] A2 帰属と契約

- [ ] Prisma `ScriptVersion` に `author`（`human` / `agent`）と任意の `authorAgentId` を追加し、migration を作る
- [ ] ScriptVersion DTO と保存経路に帰属を追加する（UI・HTTP API は既定で `human`）
- [ ] `packages/contracts` に操作コアの入出力スキーマと安定したエラーコードを追加する
- [ ] `schema.get` が返す内容（`contentSchemaVersion`、VisualTemplate `inputFields`、layer・transition・Cue の enum、Asset 種別と用途の制約）の契約を定義する
- 完了条件: `npm run typecheck` と契約テストが通り、帰属を含む ScriptVersion の保存・読出しが成立する。

### [ ] A3 操作コアとローカル制御ソケット

- [ ] タスク指向の操作コア（サービス層）を実装し、HTTP API の既存処理と共通化する
- [ ] 常駐アプリプロセスで操作面をローカル OS ソケットに公開し、ファイル権限で保護する
- [ ] アプリ未起動時の `AGENT_APP_UNAVAILABLE`、未登録操作の `AGENT_OPERATION_UNKNOWN` を実装する
- [ ] `asset.import`（ローカルパス入力、内容ハッシュ由来の `storageKey`、任意の来歴）を実装する
- [ ] 可逆操作のみを公開し、実体削除・外部公開・課金生成を含めない
- 完了条件: ソケット越しに `work.create`→`script.save`→`asset.import`→`render.start`→`job.get` が通り、worker が単一のままである。

### [ ] A4 MCP束縛

- [ ] MCP stdio サーバーを実装し、操作コアへ接続する薄いクライアントにする
- [ ] 操作を MCP ツールとして公開し、`schema.get` でスキーマを返す
- [ ] 長尺操作を Job 投入＋`job.get` ポーリングとして公開する
- 完了条件: 実エージェントから MCP 経由で作成・保存・取り込み・レンダーが通り、エラーが安定コードで返る。

### [ ] A5 CLI束縛

- [ ] MCP と同じ操作コアを呼ぶ CLI を追加し、操作名をサブコマンドとして公開する
- 完了条件: CLI 経由で A4 と同じ往復ができ、MCP と挙動が一致する。

### [ ] A6 Web UI

- [ ] 版履歴に帰属（利用者／エージェント、任意のエージェント識別）を表示する
- 完了条件: エージェント作の版を UI で識別でき、内容を確認して巻き戻せる。

### [ ] A7 レビューとコミット

- [ ] `npm run typecheck`、`npm test`、最大3回の OCR レビューと妥当な指摘の修正
