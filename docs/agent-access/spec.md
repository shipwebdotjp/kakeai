# Agent Access 仕様

## 目的と境界

この文書は、外部の AI エージェントが Kakeai の作品を操作するためのローカルな操作面（Agent Access）の正とする。正本は引き続き `ContentDocument` と SQLite であり、HTTP 契約は [../mvp/api-contract.md](../mvp/api-contract.md)、台本本文の構造は [../mvp/content-schema.md](../mvp/content-schema.md)、DB モデルと Job 状態遷移は [../mvp/spec.md](../mvp/spec.md) を正とする。

- 台本の編集意味論は [../editor-core/spec.md](../editor-core/spec.md) の操作コアを正とする。Agent Access は操作コアを呼ぶ束縛であり、編集ロジックを持たない。
- AI が実行してよい操作の範囲は [ADR 0074](../adr/0074-agent-direct-reversible-operations.md)、接続方式と単一ライターの維持は [ADR 0075](../adr/0075-agent-local-socket-single-writer.md) を正とする。
- 対象は、利用者自身が用意したコーディングエージェント等の外部 AI クライアントである。Kakeai は LLM プロバイダ、モデル、API キー、課金、会話履歴を管理しない。
- v1 の束縛は MCP（stdio）とし、同じ操作コアの薄い束縛として CLI を続けて追加する。操作の意味は束縛に依存しない。
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

## ローカル制御ソケット

- 常駐するアプリプロセスが操作面をローカル OS ソケットで公開する。MCP stdio サーバーと CLI はこのソケットへ接続するクライアントである。
- ソケットはアプリデータ領域配下に置き、ディレクトリを `0700`、ソケットを `0600` とする。起動トークンや独自ヘッダを持たない（[ADR 0075](../adr/0075-agent-local-socket-single-writer.md)、[ADR 0015](../adr/0015-minimal-local-api-protection.md) の精神を踏襲）。
- アプリプロセスが単一の SQLite ライターかつ単一の worker であり続ける。エージェントは Job を投入するだけで、worker を起動しない。
- v1 はアプリが起動していないとき、接続に失敗する安定したエラーを返す。エージェントによるアプリの自動起動は対象外とする。
- 接続時に `{ "protocolVersion": 1, "agentId": "<任意>" }` を送る。未知の版は `AGENT_PROTOCOL_MISMATCH` で拒否する。
- フレームは 1 行 1 JSON（NDJSON）とし、要求は `{ "requestId": "<呼び出し内で一意>", "operation": "<name>", "input": <object> }`、応答は `{ "requestId": "...", "ok": true, "data": ... }` または `{ "requestId": "...", "ok": false, "error": { "code": "...", "issues": [...] } }` とする。
- 1 要求の最大ペイロードは 32 MiB、読み取り操作のタイムアウトは 10 秒、変更操作は 120 秒とする。タイムアウトは処理の中断を保証しないため、変更操作は冪等に再試行できること（下記）。
- ソケットファイルが残っていて接続できない場合、クライアントは削除せず `AGENT_APP_UNAVAILABLE` を返す。所有者はアプリプロセスだけとする。

## 操作一覧

操作はタスク指向とし、`domain.verb` 形式で表す。詳細な入出力は [todo.md](./todo.md) の契約フェーズで確定する。

参照:

- `schema.get` — 現在の `contentSchemaVersion`、各 VisualTemplate の `inputFields`・layer・transition・animation の制約、操作カタログ、Asset 種別と用途の制約、警告コードを返す。`schemaDigest` を含め、アプリ更新による変化を検知できるようにする。エージェントが値を推測しないための必須操作。
- `work.list` / `work.get`
- `script.get` — 指定版（既定は current）の `ContentDocument` と帰属を返す。
- `script.validate` — 保存せずに検証する。`{ content }` または `{ baseScriptVersionId, operations }` を受け、`warnings` と解決済み `timeline` を返す。書込みを行わない。
- `asset.list` / `asset.get`
- `composition.list` / `composition.get` / `composition.draft.get` / `composition.authoringContext`
- `job.get` / `job.list`

可逆な変更:

- `work.create` — Work、指定 locale（既定は `ja-JP`）の LanguageEdition、初期 ScriptVersion を [../mvp/spec.md](../mvp/spec.md) の作成規則で作る。
- `script.save` — 全 `ContentDocument` を検証し、新しい Script Version を追加して current を進める。全体の置換や取り込み向けであり、通常の編集は `script.edit` を使う。
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

## 素材の取り込み

- エージェントはアプリと同じマシンのファイルシステムを共有するため、`asset.import` はローカルパスを受け取り、バイト列を読んで取り込む。multipart や base64、URL 取得は用いない。
- 取り込みは Web UI の multipart アップロードと同じ内部処理に落とし、`storageKey` は内容ハッシュ由来とする。入力パスを正本へ保存しない（[../mvp/spec.md](../mvp/spec.md)）。
- 読み取りは利用者と同じ権限で行う。実装はサイズ上限とメディア種別の判定を行い、判定できないファイルは取り込まない。取り込み元パスをログや正本へ残さない。
- 生成物の来歴（モデル、プロンプト、生成パラメータ）は任意メタとして受け取り、`Asset.provenanceJson` に保存する。生成自体はアプリ内で行わない（非ゴール参照）。

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
| `SCRIPT_BASE_STALE` | `baseScriptVersionId` が current と一致しない |
| `IDEMPOTENCY_CONFLICT` | 同じ `requestId` が異なる入力で使われた |
| `EDIT_TARGET_NOT_FOUND` / `EDIT_PRECONDITION_FAILED` / `EDIT_INVALID_INPUT` / `EDIT_UNSUPPORTED_TEMPLATE` | 操作コアのエラー（[../editor-core/spec.md](../editor-core/spec.md)） |
| `VALIDATION_ERROR` | 保存検証に適合しない。`details.issues` に JSON Pointer と理由を含める |
| `ASSET_UNAVAILABLE` | 取り込み・レンダー・編集で参照する Asset が ready でない、または欠損している |
| `COMPOSITION_UNAVAILABLE` | 参照する Composition Version が publish 済みでない、または bundle が欠損している |
| `WORK_NOT_FOUND` | 対象の作品・言語版・版が存在しない |

入出力の詳細な形と追加コードは [todo.md](./todo.md) の契約フェーズで確定する。

## 非ゴール

- アプリ内への LLM 組込、プロバイダ・モデル・API キー・課金・会話履歴の管理。
- アプリ内の画像・音声生成アダプター。生成はエージェント側に委ね、Agent Access は取り込みだけを公開する。
- 複数プロセスによる SQLite 共有、worker の外部起動。
- 実体削除、外部サービスへの公開、課金を伴う生成をエージェントへ開放すること。
- リモート・クラウドの MCP 接続、HTTP 経由のエージェント接続。
- 台本編集の意味論を Agent Access 側で持つこと。編集は操作コアだけが行う。

## 将来

- CLI は、MCP と同じ操作コアを呼ぶ薄い束縛として追加する。
- アプリ内ネイティブの AI 編集機能が必要になった場合は、同じ操作コアの上に任意の束縛として載せる。操作コアを変更しない限り、MCP・CLI を置き換えない。
