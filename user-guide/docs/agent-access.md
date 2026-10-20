---
sidebar_position: 20
title: エージェント連携（MCP / CLI）
---

# エージェント連携（MCP / CLI）

Kakeai は、利用者自身のコーディングエージェントから作品を操作するための MCP（stdio）サーバーと CLI（`kakeai-agent`）を同梱しています。どちらも同じ操作コアへ接続する薄い束縛で、できることは同じです。エージェントは台本の編集、素材の取り込み、Composition の作成・publish、レンダー投入を行えます。実体の削除、外部サービスへの公開、課金を伴う生成は公開していません。

## 前提

- Kakeai アプリが同じユーザーで起動していること。MCP サーバーはアプリのローカル制御ソケットへ接続するだけで、アプリを自動起動しません。
- リポジトリで `npm install` が完了していること。
- 既定のソケットは `<データディレクトリ>/agent/agent.sock` です。データディレクトリを変えている場合は `KAKEAI_DATA_DIR` を設定してください。

## 起動

リポジトリ内の `node_modules/.bin/kakeai-mcp` を MCP サーバーのコマンドに指定します。

```json
{
  "mcpServers": {
    "kakeai": {
      "command": "/path/to/kakeai/node_modules/.bin/kakeai-mcp",
      "env": {
        "KAKEAI_AGENT_ID": "my-coding-agent"
      }
    }
  }
}
```

開発中は `npm run start --workspace @kakeai/mcp` でも起動できます。`kakeai-mcp --help` で引数を確認できます。

| 設定 | 意味 |
| --- | --- |
| `KAKEAI_DATA_DIR` / `--data-dir` | Kakeai のデータディレクトリ。既定は macOS なら `~/Library/Application Support/Kakeai` |
| `KAKEAI_SOCKET` / `--socket` | ソケットパスの明示指定。データディレクトリより優先 |
| `KAKEAI_AGENT_ID` / `--agent-id` | ハンドシェイクで送るエージェント識別子。既定は `mcp`。台本版の帰属に使われる |

stdout は MCP の通信専用です。ログは stderr に出るため、エージェント設定で stdout に混ぜないでください。

## ツール

最初に `kakeai_schema_get` を呼んでください。Content Schema の版、VisualTemplate の入力フィールドと制約、警告コード、全操作カタログ（読み取り／変更、Job を返すか）が返ります。

| 用途 | ツール |
| --- | --- |
| スキーマ確認 | `kakeai_schema_get` |
| 作品 | `kakeai_work_list` / `kakeai_work_get` / `kakeai_work_create` |
| 台本 | `kakeai_script_get` / `kakeai_script_validate` / `kakeai_script_save` / `kakeai_script_edit` |
| 素材 | `kakeai_asset_list` / `kakeai_asset_get` / `kakeai_asset_import` / `kakeai_asset_tag` |
| Composition | `kakeai_composition_*`（list / get / draft_get / authoring_context / create / draft_save / publish） |
| レンダー | `kakeai_render_start` |
| Job | `kakeai_job_get` / `kakeai_job_list` / `kakeai_job_cancel` / `kakeai_job_wait` |

`kakeai_script_edit` は `baseScriptVersionId` が現在の版と一致している必要があります。`requestId` を付けると再送が冪等になります。

## 長尺操作

`kakeai_asset_import` と `kakeai_render_start` は Job を投入してすぐ返ります。

1. `kakeai_asset_import` は `jobId` を返します（同じ内容の素材が既にあれば `null`）。
2. `kakeai_render_start` は `job` を返します。
3. `kakeai_job_wait` に Job ID を渡すと、終端状態までポーリングします。`timeoutMs` を超えた場合は `timedOut: true` と最後の Job を返すので、そのまま再度呼び出せます。
4. 個別に確認する場合は `kakeai_job_get`、作品内の一覧は `kakeai_job_list` を使います。

## CLI（kakeai-agent）

MCP の代わりに、同じ操作をシェルから実行できます。接続先・検証・エラーコードは MCP と共通で、操作名は MCP ツール名ではなく正規の `domain.verb` です。

リポジトリで `npm install` した後、`node_modules/.bin/kakeai-agent` を使います。開発中は `npm run start --workspace @kakeai/cli -- schema.get` でも実行できます。

```sh
kakeai-agent schema.get
kakeai-agent work.create --input '{"title":"新しい作品"}'
kakeai-agent work.create --input input.json
echo '{"title":"標準入力から"}' | kakeai-agent work.create --input -
kakeai-agent job.get --input '{"jobId":"job-123"}'
kakeai-agent operations --pretty
kakeai-agent --help
```

| MCP ツール | CLI |
| --- | --- |
| `kakeai_schema_get` | `kakeai-agent schema.get` |
| `kakeai_work_create` | `kakeai-agent work.create --input ...` |
| `kakeai_script_edit` | `kakeai-agent script.edit --input ...` |
| `kakeai_asset_import` | `kakeai-agent asset.import --input ...` |
| `kakeai_render_start` | `kakeai-agent render.start --input ...` |
| `kakeai_job_wait` | `kakeai-agent job.wait <jobId>` |

ツール名の `kakeai_` を外し、`_` を `.` に読み替えるだけです。同じ操作・同じ入力なら、CLI の stdout JSON は MCP の `structuredContent` と一致します。

### `--input` と共通オプション

`--input` はインライン JSON、ファイルパス、`-`（標準入力）を受け付けます。省略すると `{}` として扱います。入力は送信前に契約スキーマで検証され、応答も検証されてから出力されます。`--pretty` は出力 JSON をインデントします。

| 設定 | 意味 |
| --- | --- |
| `--agent-id` | ハンドシェイクで送るエージェント識別子。既定は `cli`。`KAKEAI_AGENT_ID` でも指定できる |
| `--data-dir` / `KAKEAI_DATA_DIR` | Kakeai のデータディレクトリ |
| `--socket` / `KAKEAI_SOCKET` | ソケットパスの明示指定。データディレクトリより優先 |
| `--timeout` | 1 要求のタイムアウト（ミリ秒）。読み取り・変更の両方に適用 |

### 長尺操作

```sh
# jobId を取得してから待つ
job_id=$(kakeai-agent asset.import --input '{"path":"/path/to/image.png"}' | jq -r .jobId)
kakeai-agent job.wait "$job_id" --timeout-ms 60000 --interval-ms 500

# 操作結果を受け取ったまま待つ
kakeai-agent render.start --input '{"scriptVersionId":"scr-123"}' --wait
```

`job.wait` は `{ job, timedOut, polls }` を、`--wait` は操作結果を `{ result, wait }` に包んで返します。どちらも MCP の `kakeai_job_wait` と同じ有界ポーリングで、予算を超えた場合は失敗ではなく `timedOut: true` と最後の Job を返します。`--wait` で Job が投入されなかった場合（同じ内容の素材が既にある場合）は `wait: null` です。待ち時間の既定は 60000 ミリ秒、ポーリング間隔は 500 ミリ秒です。

### 終了コードとエラー

- `0`: 成功（`--help`、`--version`、`operations` を含む）
- `1`: 操作または検証の失敗。stderr に `{ "code": "...", "issues": [...] }` を 1 行で出力する
- `2`: 使い方または `--input` の誤り（`CLI_USAGE_ERROR` / `CLI_INPUT_ERROR`）

stdout は常にコマンド出力専用で、失敗時は空です。スタックトレースは出力しません。

## エラー

ツールの失敗は `isError: true` と JSON `{ "code": "...", "issues": [...] }` で返ります。主なコードは次のとおりです。

| code | 意味 |
| --- | --- |
| `AGENT_APP_UNAVAILABLE` | Kakeai が起動していない、またはソケットに接続できない |
| `AGENT_PROTOCOL_MISMATCH` | ソケットのプロトコル版が一致しない |
| `AGENT_OPERATION_UNKNOWN` | 操作名が未登録 |
| `AGENT_REQUEST_TIMEOUT` | 操作がタイムアウトした。`script.edit` は同じ `requestId` で再送してよい。それ以外の変更操作は結果を確認してから再実行する |
| `SCRIPT_BASE_STALE` | `baseScriptVersionId` が現在の版と異なる。`kakeai_script_get` で取り直す |
| `IDEMPOTENCY_CONFLICT` | 同じ `requestId` を異なる内容で使った |
| `VALIDATION_ERROR` | 入力または保存内容がスキーマに適合しない。`issues` を確認する |
| `EDIT_TARGET_NOT_FOUND` など `EDIT_*` | 台本操作の対象や前提が成立しない |
| `MCP_TOOL_UNKNOWN` | ツール名が存在しない |
| `MCP_INTERNAL_ERROR` | MCP 側の想定外の失敗。詳細は返らない |

`failed` な Job の理由は `job.error` に、レンダーや取り込みの安定コードとして入ります。
