---
sidebar_position: 20
title: エージェント連携（MCP / CLI）
---

# エージェント連携（MCP / CLI）

Kakeai は、利用者自身のコーディングエージェントから作品を操作するための MCP（stdio）サーバーと CLI（`kakeai-agent`）を同梱しています。どちらも同じ操作コアへ接続する薄い束縛で、できることは同じです。エージェントは台本の編集、素材の検索・取り込み、キャラクターの台本へのコピー、設定済み TTS アダプターへの音声合成、Composition の作成・publish、レンダー投入を行えます。実体の削除、外部サービスへの公開、TTS 以外の課金を伴う生成は公開していません。

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
| 素材 | `kakeai_asset_list`（検索・ページング） / `kakeai_asset_get` / `kakeai_asset_import` / `kakeai_asset_tag` |
| キャラクター | `kakeai_character_list` / `kakeai_character_get` |
| 音声合成 | `kakeai_tts_create` / `kakeai_tts_create_bulk` |
| Composition | `kakeai_composition_list` / `kakeai_composition_get` / `kakeai_composition_draft_get` / `kakeai_composition_authoring_context` / `kakeai_composition_create` / `kakeai_composition_draft_save` / `kakeai_composition_publish` |
| レンダー | `kakeai_render_start` |
| Job | `kakeai_job_get` / `kakeai_job_list` / `kakeai_job_cancel` / `kakeai_job_wait` |

`kakeai_schema_get` の `agentOperations` が、公開されている全操作（読み取り／変更、Job を返すか）の正です。`kakeai_job_wait` は Job を待つための束縛の便宜ツールで、Agent 操作ではありません。

応答には契約の要約 `schemaDigest` と `operationDigest`、対応プロトコル版の `minProtocolVersion` と `protocolVersion` が入ります。`operationDigest` は操作の入力・出力スキーマの要約で、操作の形が変わると変わります。記録した値が変わったときは、キャッシュしたスキーマや ID を使わず `kakeai_schema_get` を取り直してください。任意フィールドの追加や列挙値の追加では版は上がらず、必須化や削除、意味を変えたときだけ `protocolVersion` が変わります。

`kakeai_script_edit` は `baseScriptVersionId` が現在の版と一致している必要があります。`requestId` を付けると再送が冪等になります。

### 冪等化（requestId）

`kakeai_tts_create` / `kakeai_tts_create_bulk` / `kakeai_render_start` / `kakeai_composition_publish` は、任意の `requestId` を受け付けます。同じ `requestId` と同じ入力で呼び直すと、Job や CompositionVersion を作らず、既存のものの現在の状態を返します。タイムアウト後の再送でも二重生成は起こりません。

- `requestId` は操作ごとに一意にしてください。同じ ID を別の入力で使うと `IDEMPOTENCY_CONFLICT` になります。
- 再送は「投入直後の状態」ではなく現在の状態を返します。終了済みの Job は `succeeded` で返ります。
- 同じ ID の処理が別で実行中の場合は `AGENT_IDEMPOTENCY_IN_PROGRESS` を返します。Job を待って結果を確認してください。
- 失敗した呼び出しは記録に残らないので、原因を直した同じ `requestId` で再実行できます。
- `composition.publish` の `dryRun` は副作用がないため記録されません。

台帳の鍵には接続時の `agentId` も含みます。識別子を送らないクライアントは `unknown` の枠を共有するため、衝突を避けるには `KAKEAI_AGENT_ID`（MCP）や `--agent-id`（CLI）で識別子を指定してください。

CLI も同じ入力を使います（例: `kakeai-agent render.start --input '{"scriptVersionId":"scr-123","requestId":"render-1"}'`）。

### 素材の検索

`kakeai_asset_list` は素材を検索し、`{ assets, nextCursor }` の 1 ページを返します。

- `kind`・`status`（`ready` など）・`filename`（大文字小文字を区別しない部分一致）・`tags`・`favorite` を組み合わせられます。
- `tags` は `tagMode` で `and`（すべて含む、既定）と `or`（いずれかを含む）を明示します。
- `archived` は既定で `exclude`（アーカイブ済みを除外）です。`include` / `only` は明示したときだけ使います。
- 返却順は `createdAt desc, id desc` で固定です。`limit` は既定 50、最大 100 です。`cursor` には前ページの `nextCursor` をそのまま渡します。カーソルは絞り込み条件ごとに意味を持つため、別の条件へ流用しません。

### TTS（音声合成）

TTS は、利用者が事前に設定したループバックの TTS アダプター（VOICEVOX / AivisSpeech / OpenAI 互換）へ合成 Job を投入する操作です。接続先・認証情報・アダプター設定・Voice Profile はエージェントから変更できません。TTS 以外の課金を伴う生成も公開していません。

1. 対象の台本を保存し、`scriptVersionId` を用意します。
2. 1 セリフなら `kakeai_tts_create`（`scriptVersionId` と `narrationSegmentId`、任意で `speechText` / `voiceId` / `speedScale`）を使います。`speedScale` の既定は 1.0、範囲は 0.5〜2.0 です。通常は `speechText` を省略し、保存済みの読み上げテキストを使います。上書きする場合は、添付前にセリフ側も同じテキストへ更新します。
3. 要点シーンで音声が未選択のセリフをまとめて生成するなら `kakeai_tts_create_bulk`（`scriptVersionId`）を使います。応答の `jobs` にセリフごとの Job、`excluded` に生成できなかったセリフと理由が入ります。除外があっても他の生成は続きます。
4. `kakeai_job_wait` / `kakeai_job_get` で完了を待ちます。成功した Job の `ttsResult` に `narrationSegmentId`・`assetId`・`durationMs`・`source: "tts"` が入ります。
5. 添付前に `kakeai_script_get` で最新の台本を読み直し、対象セグメントが残っていて、読み上げテキストが合成した内容と一致することを確認します。変わっていたら、その Take は使わずに生成し直します。
6. `kakeai_script_edit` の `line.assignTake`（`assetId` に `ttsResult.assetId`、`source: "tts"`）で添付します。これは新しい ScriptVersion を作る操作で、生成済み Asset を書き換えるものではありません。

### キャラクター

`kakeai_character_list` / `kakeai_character_get` はキャラクターライブラリの読み取りだけを公開します。ライブラリの作成・更新・削除はエージェントからは行えません。

台本へ入れるときは、`kakeai_script_edit` の操作 `character.addFromLibrary`（`libraryCharacterId`）で新しいローカル Character・Appearance・Speaker としてコピーします。結果の `created.characterIds` / `created.appearanceIds` / `created.speakerIds` を読み、次の `kakeai_script_edit` で `line.setSpeaker` と `standing.set` に使います。`character.addFromLibrary` は `key` を持たないため、同じ呼び出し内で `{ "key": ... }` として参照することはできません。

## 長尺操作

`kakeai_asset_import`、`kakeai_render_start`、`kakeai_tts_create`、`kakeai_tts_create_bulk` は Job を投入してすぐ返ります。

1. `kakeai_asset_import` は `jobId` を返します（同じ内容の素材が既にあれば `null`）。
2. `kakeai_render_start` は `job` を返します。
3. `kakeai_tts_create` は `job` を、`kakeai_tts_create_bulk` は `jobs`（セリフごとの Job）と `excluded` を返します。
4. `kakeai_job_wait` に Job ID を渡すと、終端状態までポーリングします。`timeoutMs` を超えた場合は `timedOut: true` と最後の Job を返すので、そのまま再度呼び出せます。一括生成のように複数の Job がある場合は、Job ID ごとに待つか `kakeai_job_get` で個別に確認します。
5. 個別に確認する場合は `kakeai_job_get`、作品内の一覧は `kakeai_job_list` を使います。

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
| `kakeai_asset_list` | `kakeai-agent asset.list --input '{"tags":["bgm"],"status":"ready"}'` |
| `kakeai_asset_import` | `kakeai-agent asset.import --input ...` |
| `kakeai_character_list` | `kakeai-agent character.list` |
| `kakeai_tts_create` | `kakeai-agent tts.create --input ...` |
| `kakeai_tts_create_bulk` | `kakeai-agent tts.createBulk --input ...` |
| `kakeai_render_start` | `kakeai-agent render.start --input ...` |
| `kakeai_job_wait` | `kakeai-agent job.wait <jobId>` |

MCP ツール名は `kakeai_<domain>_<verb>` の snake_case、CLI のサブコマンドは正規の `domain.verb` です。`createBulk` や `authoringContext` のように語が複数ある操作では機械的な読み替えが一致しないため、`kakeai-agent operations` か `schema.get` の `agentOperations` で正規名を確認してください。同じ操作・同じ入力なら、CLI の stdout JSON は MCP の `structuredContent` と一致します。

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
kakeai-agent tts.create --input '{"scriptVersionId":"scr-123","narrationSegmentId":"line-1"}' --wait

# 一括生成は複数 Job を返すため、--wait は wait: null になる
kakeai-agent tts.createBulk --input '{"scriptVersionId":"scr-123"}'
```

`job.wait` は `{ job, timedOut, polls }` を、`--wait` は操作結果を `{ result, wait }` に包んで返します。どちらも MCP の `kakeai_job_wait` と同じ有界ポーリングで、予算を超えた場合は失敗ではなく `timedOut: true` と最後の Job を返します。`--wait` で Job が投入されなかった場合（同じ内容の素材が既にある場合）と、`tts.createBulk` のように複数 Job を投入した場合は `wait: null` です。後者は `job.wait <jobId>` を Job ごとに実行するか、`job.get` で確認します。待ち時間の既定は 60000 ミリ秒、ポーリング間隔は 500 ミリ秒です。

### 終了コードとエラー

- `0`: 成功（`--help`、`--version`、`operations` を含む）
- `1`: 操作または検証の失敗。stderr に `{ "code": "...", "issues": [...] }` を 1 行で出力する
- `2`: 使い方または `--input` の誤り（`CLI_USAGE_ERROR` / `CLI_INPUT_ERROR`）

stdout は常にコマンド出力専用で、失敗時は空です。スタックトレースは出力しません。

## スキル

Kakeai は、エージェントが制作手順をたどるためのスキル（手順書）をリポジトリに同梱しています。どちらも MCP / CLI の同じ Agent Access 操作だけを使い、HTTP API・ソケット・Prisma を直接使いません。

| スキル | 内容 |
| --- | --- |
| [`skills/kakeai-production/`](https://github.com/shipwebdotjp/kakeai/tree/main/skills/kakeai-production) | 1 本の動画を作る横断手順。`schema.get` → 作品と台本 → キャラクター → 素材 → Cue・立ち絵・BGM → TTS → 検証 → レンダー、および再送・古い基準版の扱い |
| [`skills/kakeai-composition/`](https://github.com/shipwebdotjp/kakeai/tree/main/skills/kakeai-composition) | 再利用する Composition の draft 作成・QA・publish と、台本からの参照 |

使い方は、各スキルのディレクトリを、利用するエージェントランタイムのスキルディレクトリへコピーするかシンボリックリンクします。

```sh
# 例: プロジェクト単位で検出させる場合
mkdir -p .opencode/skills
ln -s /path/to/kakeai/skills/kakeai-production .opencode/skills/kakeai-production
ln -s /path/to/kakeai/skills/kakeai-composition .opencode/skills/kakeai-composition
```

スキルの検出場所はランタイムごとに異なります（プロジェクト内の `.opencode/skills/`、ホームの `~/.claude/skills/` など）。実際のパスは利用するランタイムの設定に合わせてください。リポジトリの `skills/` は配布元で、Kakeai 本体が実行時に読みに行く場所ではありません。

スキルは `schema.get` を正とし、テンプレート契約や操作の JSON スキーマを複製しません。操作の入力は MCP の `inputSchema` または CLI の検証に従います。

## エラー

ツールの失敗は `isError: true` と JSON `{ "code": "...", "issues": [...] }` で返ります。主なコードは次のとおりです。

| code | 意味 |
| --- | --- |
| `AGENT_APP_UNAVAILABLE` | Kakeai が起動していない、またはソケットに接続できない |
| `AGENT_PROTOCOL_MISMATCH` | ソケットのプロトコル版が一致しない |
| `AGENT_OPERATION_UNKNOWN` | 操作名が未登録。`schema.get` / `operations` で正規名を確認する |
| `AGENT_REQUEST_TIMEOUT` | 操作がタイムアウトした。`script.edit` は同じ `requestId` で再送してよい。`tts.create` / `tts.createBulk` / `render.start` / `composition.publish` も任意の `requestId` を付けて再送すると既存の Job／Version が返る。それ以外の変更操作は `script.get`・`job.list`・`asset.list` などで結果を確認してから再実行する |
| `SCRIPT_BASE_STALE` | `baseScriptVersionId` が現在の版と異なる。`kakeai_script_get` で取り直し、同じ意図を適用し直す |
| `IDEMPOTENCY_CONFLICT` | 同じ `requestId` を異なる内容で使った。既存の版を確認し、同じ ID を別内容で再利用しない |
| `AGENT_IDEMPOTENCY_IN_PROGRESS` | 同じ `requestId` の処理が実行中で、待機時間内に完了しなかった。実行中の Job を `kakeai_job_get` / `kakeai_job_wait` で確認する |
| `VALIDATION_ERROR` | 入力または保存内容がスキーマに適合しない。`issues` を確認する |
| `EDIT_TARGET_NOT_FOUND` など `EDIT_*` | 台本操作の対象や前提が成立しない |
| `ASSET_UNAVAILABLE` | 参照する素材が `ready` でない、または欠損している |
| `COMPOSITION_UNAVAILABLE` | 参照する CompositionVersion が未 publish、または bundle が欠損している |
| `TTS_INPUT_INVALID` | 読み上げテキストが空、話者・声が未設定、設定済みアダプター外の声など |
| `TTS_ENGINE_UNAVAILABLE` | 設定済みの TTS アダプターへ接続できない。利用者にエンジンの起動を依頼する |
| `RESOURCE_NOT_FOUND` / `WORK_NOT_FOUND` | 参照する台本版・セリフ・素材・作品が存在しない |
| `MCP_TOOL_UNKNOWN` | ツール名が存在しない |
| `MCP_INTERNAL_ERROR` | MCP 側の想定外の失敗。詳細は返らない |

`failed` な Job の理由は `job.error` に、レンダー・取り込み・TTS の安定コードとして入ります。
