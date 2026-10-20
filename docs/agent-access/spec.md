# Agent Access 仕様

## 目的と境界

この文書は、外部の AI エージェントが Kakeai の作品を操作するためのローカルな操作面（Agent Access）の正とする。正本は引き続き `ContentDocument` と SQLite であり、HTTP 契約は [../mvp/api-contract.md](../mvp/api-contract.md)、台本本文の構造は [../mvp/content-schema.md](../mvp/content-schema.md)、DB モデルと Job 状態遷移は [../mvp/spec.md](../mvp/spec.md) を正とする。

- 台本の編集意味論は [../editor-core/spec.md](../editor-core/spec.md) の操作コアを正とする。Agent Access は操作コアを呼ぶ束縛であり、編集ロジックを持たない。
- AI が実行してよい操作の範囲は [ADR 0074](../adr/0074-agent-direct-reversible-operations.md)、接続方式と単一ライターの維持は [ADR 0075](../adr/0075-agent-local-socket-single-writer.md) を正とする。
- 対象は、利用者自身が用意したコーディングエージェント等の外部 AI クライアントである。Kakeai は LLM プロバイダ、モデル、API キー、課金、会話履歴を管理しない。
- v1 の束縛は MCP（stdio）と CLI とし、どちらも同じ操作コアの薄い束縛である。操作の意味は束縛に依存しない。
- Web UI 向け HTTP API はそのまま維持し、Agent Access はこれとは別の入口とする。

## 操作の公開方針

操作は「可逆」と「不可逆」で分ける。可逆な操作はエージェントが直接実行でき、不可逆な操作は人に限る。

| 区分 | 操作 | エージェント |
| --- | --- | --- |
| 可逆 | 作品作成、台本保存（新しい Script Version の追加と current の前進）、操作コアによる Scene・セリフ・Cue・素材割り当ての編集、Composition の draft 更新と publish、Asset 取り込み、タグ更新、レンダー投入、queued Job のキャンセル | 可 |
| 不可逆 | Work・Asset 本体・Composition Version・Artifact の実体削除、外部サービスへの公開、課金を伴う生成 | 人のみ |

「台本上の削除」（Cue・Scene・セリフ・割り当ての除去）は、要素を除いた新しい Script Version を作るだけの可逆な操作であり、エージェントに許す。実体ファイルや行を消す操作だけが不可逆である。既存の [../mvp/api-contract.md](../mvp/api-contract.md) の削除系はそのまま人専用とし、エージェントの操作面には公開しない。Composition の publish は Kakeai 内の不変版の追加であり、外部サービスへの公開ではない。

## 操作コアと束縛

- すべての振る舞いは単一の操作コア（サービス層）に置き、HTTP API・MCP・CLI はそれを薄く呼ぶだけの束縛とする。束縛ごとにロジックを複製しない。
- 台本の編集操作は [../editor-core/spec.md](../editor-core/spec.md) の `ScriptOperation` をそのまま公開する。MCP のツールごとに別の編集ロジックを作らない。
- 操作の入出力は `packages/contracts` の Zod スキーマで検証し、無検証の値を正本へ渡さない。
- エラーは束縛に依存しない安定したエラーコードで返す。

## MCP 束縛

- 実体は `apps/mcp`（`@kakeai/mcp`、bin `kakeai-mcp`）の stdio サーバーである。`@kakeai/agent-client` でローカル制御ソケットへ接続する薄いクライアントであり、Prisma・DB・ファイル書込み・業務ロジックを持たない。MCP は操作を選び、入力と出力を契約スキーマで検証して転送するだけである。
- 公式の `@modelcontextprotocol/sdk`（`^1.32.1`）を使い、低レベルの stdio サーバーとして `initialize` / `tools/list` / `tools/call` を実装する。stdout は JSON-RPC 専用とし、ログは stderr にだけ書く。起動失敗や内部エラーでもスタックトレースを stdout に出さない。
- 設定は `KAKEAI_DATA_DIR`（未指定ならプラットフォーム既定のデータルート）からソケットを解決し、`KAKEAI_SOCKET` または `--socket` で明示パスを指定できる。`--data-dir` も受け付ける。`KAKEAI_AGENT_ID` または `--agent-id` をハンドシェイクの `agentId` に使い、既定は `mcp` とする。`--help` と `--version` をサポートする。ソケット接続時の `protocolVersion` は `1` である。
- ツール名は MCP の命名制約に合わせて `kakeai_<domain>_<verb>` の snake_case とし、説明文に正規の `domain.verb` を必ず含める。`inputSchema` と `outputSchema` は `packages/contracts` の Zod スキーマから `z.toJSONSchema` で生成し、束縛側に JSON Schema を手書きしない。成功時は JSON を `content[].text` と `structuredContent` の両方で返す。
- ツール一覧は次のとおり。読み取り・変更の区分と長尺かどうかは `schema.get` の `agentOperations` と同じ分類を使う。

| 操作 | 種別 | 長尺（Job） | MCP ツール名 |
| --- | --- | --- | --- |
| `schema.get` | read | no | `kakeai_schema_get` |
| `work.list` | read | no | `kakeai_work_list` |
| `work.get` | read | no | `kakeai_work_get` |
| `work.create` | mutation | no | `kakeai_work_create` |
| `script.get` | read | no | `kakeai_script_get` |
| `script.validate` | read | no | `kakeai_script_validate` |
| `script.save` | mutation | no | `kakeai_script_save` |
| `script.edit` | mutation | no | `kakeai_script_edit` |
| `asset.list` | read | no | `kakeai_asset_list` |
| `asset.get` | read | no | `kakeai_asset_get` |
| `asset.import` | mutation | yes | `kakeai_asset_import` |
| `asset.tag` | mutation | no | `kakeai_asset_tag` |
| `render.start` | mutation | yes | `kakeai_render_start` |
| `job.get` | read | no | `kakeai_job_get` |
| `job.list` | read | no | `kakeai_job_list` |
| `job.cancel` | mutation | no | `kakeai_job_cancel` |
| `composition.list` | read | no | `kakeai_composition_list` |
| `composition.get` | read | no | `kakeai_composition_get` |
| `composition.draft.get` | read | no | `kakeai_composition_draft_get` |
| `composition.authoringContext` | read | no | `kakeai_composition_authoring_context` |
| `composition.create` | mutation | no | `kakeai_composition_create` |
| `composition.draft.save` | mutation | no | `kakeai_composition_draft_save` |
| `composition.publish` | mutation | no | `kakeai_composition_publish` |

- 長尺操作は Job の投入と ID の返却までで完了する。`asset.import` は内容が既存 Asset と同一なら `jobId: null` を返す。`render.start` は `job` を返す。呼び出し側は `job.get` または `job.list` で状態を確認する。
- MCP 束縛は `job.get` の有界ポーリングを `kakeai_job_wait` として提供する。`timeoutMs`（既定 60 秒、最大 600 秒）と `intervalMs`（既定 500 ミリ秒、10〜30000 ミリ秒）を受け、終端状態（`succeeded` / `failed` / `cancelled`）に達したら `{ job, timedOut: false, polls }`、予算超過なら最後の Job と `timedOut: true` を返す。`job_wait` は MCP 束縛の便宜ツールであり、Agent 操作ではない。
- 失敗はすべて `isError: true` のツール結果として返し、サーバーを落とさない。本文は JSON `{ "code": "...", "issues": [...] }` で、Agent Access と操作コアのコードをそのまま透過する。MCP 自身の失敗は `MCP_TOOL_UNKNOWN`（未知のツール名）、`VALIDATION_ERROR`（入力スキーマ不一致、`issues` 付き）、`MCP_INTERNAL_ERROR`（想定外。詳細は返さない）とする。アプリ未起動は `AGENT_APP_UNAVAILABLE`、未知の操作は `AGENT_OPERATION_UNKNOWN` である。
- 実体削除、外部サービスへの公開、課金を伴う生成は MCP にも公開しない。Composition の publish は Kakeai 内の不変版の追加であり、外部公開ではない。

## CLI 束縛

- 実体は `apps/cli`（`@kakeai/cli`、bin `kakeai-agent`）である。`@kakeai/agent-client` で同じローカル制御ソケットへ接続する薄いクライアントであり、Prisma・DB・業務ロジックを持たない。書き込みは stdout と stderr だけで、ファイルは `--input` の読取りにしか使わない。
- サブコマンドは正規の `domain.verb` をそのまま使う（`kakeai-agent work.create --input input.json`、`kakeai-agent schema.get`）。`job.wait <jobId>` は MCP の `kakeai_job_wait` と同じ便利コマンド、`operations` は `agentOperationCatalog` を返す。サブコマンド一覧は操作カタログから導出し、束縛側に第二の一覧を持たない。
- `--input` はインライン JSON・ファイルパス・`-`（標準入力）を受け付ける。省略時は `{}` として扱う。送信前に `packages/contracts` の入力スキーマで検証し、受信後も出力スキーマで検証してから stdout に 1 つの JSON を書く。`--pretty` は出力をインデントする。
- グローバルオプションは `--agent-id`（既定 `cli`）、`--data-dir`、`--socket`、`--timeout`（1 要求のタイムアウト。読み取り・変更の両方に適用）。解決順は MCP と同じく、引数、環境変数（`KAKEAI_AGENT_ID` / `KAKEAI_DATA_DIR` / `KAKEAI_SOCKET`）、プラットフォーム既定の順である。`--help` は種別ごとの操作一覧、`--version` はバージョンを返す。
- 長尺操作は `job.wait <jobId>` または `asset.import` / `render.start` の `--wait` で待てる。どちらも MCP と同じ `jobWaitInputSchema` と `waitForJob` を使い、`--timeout-ms`（既定 60000、最大 600000）と `--interval-ms`（既定 500、10〜30000）を受ける。`job.wait` は `{ job, timedOut, polls }` を返し、予算超過は成功（終了コード 0）で `timedOut: true` とする。`--wait` は操作結果を `{ result, wait }` に包み、Job を投入しなかった場合（`asset.import` の重複）は `wait: null` とする。
- 失敗は stderr に `{ code, issues? }` の 1 行 JSON だけを書き、スタックトレースや自由文を出さない。stdout は常にコマンド出力専用である。終了コードは、`0` が成功（help・version・`operations` を含む）、`1` が操作または契約検証の失敗（code は Agent Access と操作コアの安定コード）、`2` が使い方または `--input` の誤り（`CLI_USAGE_ERROR` / `CLI_INPUT_ERROR`）である。CLI 自身の想定外の失敗は `CLI_INTERNAL_ERROR`（終了コード 1）とし、詳細を返さない。
- MCP と同じく、実体削除、外部サービスへの公開、課金を伴う生成は CLI にも公開しない。Composition の publish は Kakeai 内の不変版の追加であり、外部公開ではない。
- 束縛間で共有する実装は `@kakeai/agent-client` に置く。`jobWaitInputSchema`・`waitForJob`・`createJobGetter` と、`{ code, issues? }` の整形（`zodIssues`・`bindingErrorPayload`）を MCP と CLI が共有し、ポーリングやエラー整形を複製しない。

## ローカル制御ソケット

- 常駐するアプリプロセスが操作面をローカル OS ソケットで公開する。MCP stdio サーバーと CLI はこのソケットへ接続するクライアントである。
- ソケットは `<dataRoot>/agent/agent.sock` に置き、ディレクトリを `0700`、ソケットを `0600` とする。起動トークンや独自ヘッダを持たない（[ADR 0075](../adr/0075-agent-local-socket-single-writer.md)、[ADR 0015](../adr/0015-minimal-local-api-protection.md) の精神を踏襲）。
- アプリプロセスが単一の SQLite ライターかつ単一の worker であり続ける。エージェントは Job を投入するだけで、worker を起動しない。
- v1 はアプリが起動していないとき、接続に失敗する安定したエラーを返す。エージェントによるアプリの自動起動は対象外とする。
- 起動時、ソケットファイルが既にある場合はアプリプロセスだけが後始末する。接続できるソケットは稼働中として残し、接続できないソケットだけを削除してから listen する。ソケットでないファイルは削除しない。終了時は自分が作ったソケットを unlink する。
- 接続時に `{ "protocolVersion": 1, "agentId": "<任意>" }` を送る。未知の版は `AGENT_PROTOCOL_MISMATCH` で拒否する。
- フレームは 1 行 1 JSON（NDJSON）とし、要求は `{ "requestId": "<呼び出し内で一意>", "operation": "<name>", "input": <object> }`、応答は `{ "requestId": "...", "ok": true, "data": ... }` または `{ "requestId": "...", "ok": false, "error": { "code": "...", "issues": [...] } }` とする。`issues` は `{ path, code, message }` の配列で、スタックトレースや自由文の詳細は返さない。
- 1 要求の最大ペイロードは 32 MiB（改行を含むバッファ長）とし、超えた場合は `AGENT_PAYLOAD_TOO_LARGE` を返して接続を閉じる。読み取り操作のタイムアウトは 10 秒、変更操作は 120 秒とし、サーバー側でも `AGENT_REQUEST_TIMEOUT` を返して接続を閉じる。クライアントも同じ時間で打ち切る。タイムアウトは処理の中断を保証しない。`script.edit` は `requestId` で冪等に再送できるが、それ以外の変更操作は自動再送せず、`job.list`・`script.get`・`composition.get` などで結果を確認してから必要なら再実行する。
- サーバーは応答を返した後も同じ接続で次の要求を受け付けるが、5 分間何も受信しない接続は閉じる。
- ソケットファイルが残っていて接続できない場合、クライアントは削除せず `AGENT_APP_UNAVAILABLE` を返す。所有者はアプリプロセスだけとする。

## 操作一覧

操作はタスク指向とし、`domain.verb` 形式で表す。詳細な入出力は [todo.md](./todo.md) の契約フェーズで確定する。

参照:

- `schema.get` — 現在の `contentSchemaVersion`、各 VisualTemplate の `inputFields`・layer・transition・animation の制約、操作カタログ、Asset 種別と用途の制約、警告コードを返す。`schemaDigest` を含め、アプリ更新による変化を検知できるようにする。エージェントが値を推測しないための必須操作。`schemaDigest` はスキーマ関連データを正規化した非暗号の安定フィンガープリント（`fnv1a64:` 接頭辞）であり、意味が変わらなければ同一値を返す。`operations` は台本編集の `ScriptOperation` カタログ（名前とカテゴリ）を従来どおり返し、`agentOperations` は束縛が公開してよい全 Agent 操作のカタログ（`name`、`kind` の `read` / `mutation`、Job を返す `longRunning`）を返す。`agentOperations` は読み取り・変更の分類リストから導出し、束縛ごとに第二の操作一覧を持たない。
- `work.list` / `work.get`
- `script.get` — `scriptVersionId` を指定するとその版、`languageEditionId` を指定するとその Edition の current の `ContentDocument` と帰属を返す。どちらか一方を必須とする。
- `script.validate` — 保存せずに検証する。`{ content }` または `{ baseScriptVersionId, operations }` を受け、`warnings` と解決済み `timeline` を返す。書込みを行わない。
- `asset.list` / `asset.get`
- `composition.list` / `composition.get` / `composition.draft.get` / `composition.authoringContext`
- `job.get` / `job.list`

可逆な変更:

- `work.create` — Work、指定 locale（既定は `ja-JP`）の LanguageEdition、初期 ScriptVersion を [../mvp/spec.md](../mvp/spec.md) の作成規則で作る。
- `script.save` — `languageEditionId` と全 `ContentDocument` を受け、検証して新しい Script Version を追加し current を進める。全体の置換や取り込み向けであり、通常の編集は `script.edit` を使う。
- `script.edit` — 基準版と `ScriptOperation` の配列を受け、操作コアで一括適用し、保存検証を通して新しい Script Version を追加する。1 呼び出しは 1 版とし、途中失敗時は版を作らない。
- `asset.import` — 後述の手順で Asset を取り込む。
- `asset.tag` — Asset のタグを更新する。
- `composition.create` / `composition.draft.save` / `composition.publish` — Composition Library の authoring（[../composition-library/spec.md](../composition-library/spec.md)、[../visual-skins/spec.md](../visual-skins/spec.md)）。publish は `dryRun` を受け付ける。
- `render.start` — 対象版と ready な素材から render Job を投入する。
- `job.cancel` — queued の Job をキャンセルする。

### `script.edit` の契約

```jsonc
{
  "baseScriptVersionId": "scr_003",
  "requestId": "edit-2026-10-20-001",
  "operations": [
    { "op": "scene.add", "kind": "point", "key": "scene-1" },
    { "op": "line.add", "sceneId": { "key": "scene-1" }, "captionText": "最初の要点です。" }
  ]
}
```

- `baseScriptVersionId` は必須とし、Edition の current と一致しなければ `SCRIPT_BASE_STALE`（409）で拒否する。相対操作を古い文書へ適用して別の要素を壊さないため、ここだけ last-write-wins の例外とする。UI の全体保存は従来どおり last-write-wins のままとする。
- `requestId` は必須とし、同じ Edition で同じ値の版が既にあれば操作を再適用せず、その版を返す（`replay: true`）。再送で版や Job を増やさない。同じ `requestId` で基準版または操作内容が異なる場合は `IDEMPOTENCY_CONFLICT` とするため、要求内容のハッシュも版に保存する。
- 操作は配列順に適用する。作成操作の `key` は同一呼び出し内の後続操作から `{ "key": "..." }` で参照できる。
- 成功時は新しい Script Version、作成した ID、`warnings`、解決済み `timeline` を返す。`script.get` の往復を省略できる。
- 操作コアのエラーは `EDIT_*` のまま返し、保存検証の `VALIDATION_ERROR` と区別する。

### Composition authoring の契約

- 読み取りは `composition.list` / `composition.get` / `composition.draft.get` / `composition.authoringContext`。`composition.authoringContext` は HTTP の `POST /composition-authoring-contexts` と同じ入力（`visualTheme` と任意の `canvasProfile`）を受け、`context` を返す。
- 変更は `composition.create` / `composition.draft.save` / `composition.publish`。入出力は [../composition-library/spec.md](../composition-library/spec.md) の HTTP authoring API と同じ `packages/contracts` のスキーマを使う。`authoringStyle` 付きの作成は HTTP と同じ authoring context の解決を通す。
- `composition.publish` は任意の `dryRun` を受け付ける。`true` なら version を作らずに publish と同じ検証だけを行い `{ dryRun: true, manifest, fontDiagnostics }` を返し、`false` または省略時は publish して `{ dryRun: false, version, fontDiagnostics }` を返す。検証失敗は `VALIDATION_ERROR` と `issues`、Style Kit の改変は `STYLE_KIT_MODIFIED` とする。
- 存在しない Composition は、束縛に依存しない HTTP の安定コード `RESOURCE_NOT_FOUND` で返す。
- Composition の実体削除は操作面に公開しない（HTTP の削除系も従来どおり人専用）。

## 素材の取り込み

- エージェントはアプリと同じマシンのファイルシステムを共有するため、`asset.import` はローカルパスを受け取り、バイト列を読んで取り込む。multipart や base64、URL 取得は用いない。
- 取り込みは Web UI の multipart アップロードと同じ内部処理に落とし、`storageKey` は内容ハッシュ由来とする。入力パスを正本へ保存しない（[../mvp/spec.md](../mvp/spec.md)）。
- 読み取りは利用者と同じ権限で行う。実装はサイズ上限とメディア種別の判定を行い、判定できないファイルは取り込まない。取り込み元パスをログや正本へ残さない。
- 生成物の来歴（モデル、プロンプト、生成パラメータ）は `provenance` として任意に受け取り、`Asset.provenanceJson` に保存する。取り込み元のパスは来歴に含めない。生成自体はアプリ内で行わない（非ゴール参照）。

## 長尺操作

- 素材取り込みとレンダーは Job として実行し、操作は Job の投入と ID の返却まで行う。状態は `job.get` のポーリングで確認する。
- Job の状態遷移、単一 worker、リースなし、起動時 `WORKER_INTERRUPTED` 掃除は [../mvp/spec.md](../mvp/spec.md) と [ADR 0020](../adr/0020-no-job-lease-startup-reap.md) の規則をそのまま適用する。

## 帰属

- `ScriptVersion` は作成者が利用者かエージェントかを示す `author`（`human` / `agent`）と、エージェントを識別する任意の `authorAgentId` を持つ。作成時に確定し、以後変更しない。
- `authorAgentId` は接続時の `agentId` を既定とし、操作ごとに上書きできる。空文字は保存しない。
- 帰属は `ContentDocument` ではなく DB の列として持つ。`contentSchemaVersion` は上げない。
- 帰属は、履歴でエージェント作の版を識別し、巻き戻すために使う。`sourceScriptVersionId`（復元・翻訳・下書きの系統）とは別軸である。
- `script.edit` の `requestId` は `ScriptVersion.agentRequestId` として保存し、Edition 内で一意にする。`script.save` と UI 保存は `null` とする。要求内容のハッシュ（`agentRequestHash`）も保存し、同じ ID の再送と衝突を区別する。
- Asset の生成元は既存の `origin`（`generated`）と `provenanceJson` で表し、別の帰属列は持たない。

## エラー

| code | 発生条件 |
| --- | --- |
| `AGENT_APP_UNAVAILABLE` | アプリプロセスが起動しておらずソケットへ接続できない |
| `AGENT_PROTOCOL_MISMATCH` | `protocolVersion` が未知、またはフレームが不正 |
| `AGENT_OPERATION_UNKNOWN` | 未登録の操作名 |
| `AGENT_PAYLOAD_TOO_LARGE` | 1 要求が 32 MiB を超えた |
| `AGENT_REQUEST_TIMEOUT` | 読み取り 10 秒／変更 120 秒を超えた |
| `MCP_TOOL_UNKNOWN` | MCP のツール名が未登録（MCP 束縛のみ） |
| `MCP_INTERNAL_ERROR` | MCP 束縛で想定外の失敗。詳細は返さない（MCP 束縛のみ） |
| `CLI_USAGE_ERROR` | 未知のサブコマンド、不正な引数、`--wait` などの誤用（CLI 束縛のみ） |
| `CLI_INPUT_ERROR` | `--input` のファイル・標準入力を読めない、または JSON として解析できない（CLI 束縛のみ） |
| `CLI_INTERNAL_ERROR` | CLI 束縛で想定外の失敗。詳細は返さない（CLI 束縛のみ） |
| `SCRIPT_BASE_STALE` | `baseScriptVersionId` が current と一致しない |
| `IDEMPOTENCY_CONFLICT` | 同じ `requestId` が異なる入力で使われた |
| `EDIT_TARGET_NOT_FOUND` / `EDIT_PRECONDITION_FAILED` / `EDIT_INVALID_INPUT` / `EDIT_UNSUPPORTED_TEMPLATE` / `EDIT_ID_GENERATION_FAILED` | 操作コアのエラー（[../editor-core/spec.md](../editor-core/spec.md)） |
| `VALIDATION_ERROR` | 保存検証に適合しない。`issues` に JSON Pointer と理由を含める。MCP の入力スキーマ不一致にも同じコードと `issues` を返す |
| `ASSET_UNAVAILABLE` | 取り込み・レンダー・編集で参照する Asset が ready でない、または欠損している |
| `COMPOSITION_UNAVAILABLE` | 参照する Composition Version が publish 済みでない、または bundle が欠損している |
| `WORK_NOT_FOUND` | 対象の作品・言語版・版が存在しない |

上記のほか、操作が既存サービスから受け取った HTTP API の安定コード（`VALIDATION_ERROR`、`FILE_TOO_LARGE`、`UNSUPPORTED_MEDIA_TYPE`、`JOB_NOT_CANCELLABLE` など）はそのまま返す。入出力の形は `packages/contracts` の Zod スキーマを正とする。

## 非ゴール

- アプリ内への LLM 組込、プロバイダ・モデル・API キー・課金・会話履歴の管理。
- アプリ内の画像・音声生成アダプター。生成はエージェント側に委ね、Agent Access は取り込みだけを公開する。
- 複数プロセスによる SQLite 共有、worker の外部起動。
- 実体削除、外部サービスへの公開、課金を伴う生成をエージェントへ開放すること。
- リモート・クラウドの MCP 接続、HTTP 経由のエージェント接続。
- 台本編集の意味論を Agent Access 側で持つこと。編集は操作コアだけが行う。

## 将来

- アプリ内ネイティブの AI 編集機能が必要になった場合は、同じ操作コアの上に任意の束縛として載せる。操作コアを変更しない限り、MCP・CLI を置き換えない。
