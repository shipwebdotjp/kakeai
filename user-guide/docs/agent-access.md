---
sidebar_position: 20
title: エージェント連携（MCP / CLI）
---

# エージェント連携（MCP / CLI）

Kakeai は、利用者自身のコーディングエージェントから作品を操作するための MCP（stdio）サーバーと CLI（`kakeai-agent`）を同梱しています。どちらも同じ操作コアへ接続する薄い束縛で、できることは同じです。エージェントは作品の作成・改名、台本の編集、素材の検索・取り込み、キャラクターの台本へのコピー、設定済み TTS アダプターへの音声合成、Composition の作成・publish、レンダー投入、render 成果物の指定時刻の静止画の取得を行えます。実体の削除、外部サービスへの公開、TTS 以外の課金を伴う生成は公開していません。

## 前提

- Kakeai アプリが同じユーザーで起動していること。MCP サーバーはアプリのローカル制御ソケットへ接続するだけで、アプリを自動起動しません。
- TTS を使う場合は、**対象 locale の声を持つキャラクター**（新規作品）または**既存話者の有効な声**（既存作品）が必要です。どちらも無い場合、エージェントは TTS を開始せず、キャラクター作成を依頼して停止します。
- TTS を使う場合は、利用者が設定した TTS エンジン（VOICEVOX / AivisSpeech / OpenAI 互換）が起動していること。事前確認の操作は無く、`TTS_ENGINE_UNAVAILABLE` で判明します。
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
| 作品 | `kakeai_work_list` / `kakeai_work_get` / `kakeai_work_create` / `kakeai_work_update` |
| 台本 | `kakeai_script_get` / `kakeai_script_validate` / `kakeai_script_save` / `kakeai_script_edit` |
| 素材 | `kakeai_asset_list`（検索・ページング） / `kakeai_asset_get` / `kakeai_asset_import` / `kakeai_asset_tag` |
| キャラクター | `kakeai_character_list` / `kakeai_character_get` |
| 音声合成 | `kakeai_tts_create` / `kakeai_tts_create_bulk` / `kakeai_tts_attach_bulk` |
| Composition | `kakeai_composition_list` / `kakeai_composition_get` / `kakeai_composition_draft_get` / `kakeai_composition_authoring_context` / `kakeai_composition_create` / `kakeai_composition_draft_save` / `kakeai_composition_publish` |
| レンダー | `kakeai_render_start` |
| プレビュー | `kakeai_preview_frame`（render 成果物の指定時刻の原寸 PNG。絵は image ブロックでも返る） |
| Job | `kakeai_job_get` / `kakeai_job_list` / `kakeai_job_cancel` / `kakeai_job_wait` |

`kakeai_schema_get` の `agentOperations` が、公開されている全操作（読み取り／変更、Job を返すか）の正です。`kakeai_job_wait` は Job を待つための束縛の便宜ツールで、Agent 操作ではありません。

応答には契約の要約 `schemaDigest` と `operationDigest`、対応プロトコル版の `minProtocolVersion` と `protocolVersion` が入ります。`operationDigest` は操作の入力・出力スキーマの要約で、操作の形が変わると変わります。記録した値が変わったときは、キャッシュしたスキーマや ID を使わず `kakeai_schema_get` を取り直してください。任意フィールドの追加や列挙値の追加では版は上がらず、必須化や削除、意味を変えたときだけ `protocolVersion` が変わります。

`kakeai_script_edit` は `baseScriptVersionId` が現在の版と一致している必要があります。`requestId` を付けると再送が冪等になります。

- `kakeai_job_list` は `kind`（既定は `render`）で `render` または `tts` の Job を選べます。`asset_ingest` は Work に紐づかないため指定できず、`kakeai_job_get` で確認します。
- `kakeai_script_save` は任意の `baseScriptVersionId`（基準版ガード）と `sourceScriptVersionId`（同一 Edition の復元元）を受け付けます。基準版を省略すると従来どおり last-write-wins です。
- `kakeai_work_create` は指定した `locale`（既定 `ja-JP`、`en-US` も可）で初期台本を作ります。

### 冪等化（requestId）

`kakeai_tts_create` / `kakeai_tts_create_bulk` / `kakeai_render_start` / `kakeai_composition_publish` は、任意の `requestId` を受け付けます。同じ `requestId` と同じ入力で呼び直すと、Job や CompositionVersion を作らず、既存のものの現在の状態を返します。タイムアウト後の再送でも二重生成は起こりません。

- `requestId` は操作ごとに一意にしてください。同じ ID を別の入力で使うと `IDEMPOTENCY_CONFLICT` になります。
- 再送は「投入直後の状態」ではなく現在の状態を返します。終了済みの Job は `succeeded` で返ります。
- 同じ ID の処理が別で実行中の場合は `AGENT_IDEMPOTENCY_IN_PROGRESS` を返します。Job を待って結果を確認してください。
- 失敗した呼び出しは記録に残らないので、原因を直した同じ `requestId` で再実行できます。
- `composition.publish` の `dryRun` は副作用がないため記録されません。

台帳の鍵には接続時の `agentId` も含みます。識別子を送らないクライアントは `unknown` の枠を共有するため、衝突を避けるには `KAKEAI_AGENT_ID`（MCP）や `--agent-id`（CLI）で識別子を指定してください。

`kakeai_tts_attach_bulk` は台帳に載りません。`requestId` が必須で、`kakeai_script_edit` と同じ版単位の冪等になります。同じ `requestId` の再送は既存の版を返し、異なる内容での再利用は `IDEMPOTENCY_CONFLICT` になります。

`kakeai_work_create` と `kakeai_script_save` は `requestId` を持たず、再送で Work や版が増える可能性があります。`AGENT_REQUEST_TIMEOUT` の後は、`kakeai_work_list` / `kakeai_script_get` で変更が反映されたかを確認してから再実行してください。

`kakeai_script_save` の `baseScriptVersionId` は任意です。省略すると last-write-wins、指定するとその版が current のときだけ保存し、一致しなければ `SCRIPT_BASE_STALE` になります。

CLI も同じ入力を使います（例: `kakeai-agent render.start --input '{"scriptVersionId":"scr-123","requestId":"render-1"}'`）。

### 大量のリクエスト

短時間に大量の要求を送ると、接続内の未処理要求が上限に達し、要求の一部が `AGENT_BACKPRESSURE` で返ることがあります。接続は閉じられず、その要求だけが実行されませんでした。少し待ってから同じ要求を再送してください。必要なら要求を束ねて減らして送ります。

### 素材の検索

`kakeai_asset_list` は素材を検索し、`{ assets, nextCursor, total }` の 1 ページを返します。`total` は同じ絞り込み条件に一致する素材の総数です。

- `kind`・`status`（`ready` など）・`filename`（大文字小文字を区別しない部分一致）・`tags`・`favorite` を組み合わせられます。
- `tags` は `tagMode` で `and`（すべて含む、既定）と `or`（いずれかを含む）を明示します。タグは完全一致で、要素として照合します（`bgm` は `bgm_loop` に一致しません）。ASCII の英字は大文字小文字を区別しません（`Summer` は `summer` に一致します）。`%` と `_` は通常の文字で、タグ名に含めてもワイルドカードにはなりません。
- `hasAudio`（音声トラックの有無）と `durationMinMs` / `durationMaxMs`（長さの範囲）で絞り込めます。長さを持たない素材は範囲に一致しません。
- `archived` は既定で `exclude`（アーカイブ済みを除外）です。`include` / `only` は明示したときだけ使います。
- 返却順は `sort` で選べます（`createdAt_desc` が既定、`createdAt_asc`、`filename_asc`、`duration_asc`）。`limit` は既定 50、最大 100 です。`cursor` には前ページの `nextCursor` をそのまま渡します。カーソルは絞り込み条件と並び順ごとに意味を持つため、別の条件や別の `sort` へ流用しません（別の `sort` で使うと `VALIDATION_ERROR` になります）。

### TTS（音声合成）

TTS は、利用者が事前に設定したループバックの TTS アダプター（VOICEVOX / AivisSpeech / OpenAI 互換）へ合成 Job を投入する操作です。接続先・認証情報・アダプター設定・Voice Profile はエージェントから変更できません。TTS 以外の課金を伴う生成も公開していません。

対象の話者に `voiceProfileId` が無い場合は TTS を開始しないでください。既存作品は `kakeai_script_get` の `speakers[]`、新規作品は `kakeai_character_list` で対象 locale の声を確認し、無ければ人間にキャラクター作成を依頼して停止します（[キャラクター](#キャラクター)）。

1. 対象の台本を保存し、`scriptVersionId` を用意します。**一括生成から確定までは台本を書き換えないでください。**確定前に保存し直すと元の版が最新でなくなり、確定は `SCRIPT_BASE_STALE` で停止します。
2. 1 セリフなら `kakeai_tts_create`（`scriptVersionId` と `narrationSegmentId`、任意で `speechText` / `voiceId` / `speedScale`）を使います。`speedScale` の既定は 1.0、範囲は 0.5〜2.0 です。通常は `speechText` を省略し、保存済みの読み上げテキストを使います。上書きする場合は、添付前にセリフ側も同じテキストへ更新します。
3. 要点シーンで音声が未選択のセリフをまとめて生成するなら `kakeai_tts_create_bulk`（`scriptVersionId`）を使います。`requestId` は契約上は任意ですが、**確定には必須**なので必ず付けてください（付けない実行は確定できません）。応答の `jobs` にセリフごとの Job、`excluded` に生成できなかったセリフと理由が入ります。除外があっても他の生成は続きます。
4. 一括生成の確定は `kakeai_tts_attach_bulk`（`scriptVersionId`、元の `bulkRequestId`、添付自身の `requestId`）で行います。開始したときと**同じ binding・同じ `agentId`** で呼んでください。別の `agentId` では元の一括要求を見つけられず `RESOURCE_NOT_FOUND` になります。Job が1件でも未完了なら台本を変更せず `pending`（件数付き）を返すので、繰り返し呼んで待ちます。全 Job が終端状態になると成功分だけを一つの台本版へ添付して `finalized` を返します。100件以上の対応表を手で作る必要はありません。同じ `requestId` の再送は既存の版を返します。
5. `finalized` の `failures` に残った行は、新しい `bulkRequestId` で `kakeai_tts_create_bulk` を実行し直してから、もう一度確定します。対象の版は、返された新しい版（添付0件なら元の版）です。
6. 単体生成の添付は `kakeai_script_edit` の `line.assignTake`（`assetId` に `ttsResult.assetId`、`source: "tts"`）で行います。添付前に `kakeai_script_get` で最新の台本を読み直し、対象セグメントが残っていて、読み上げテキストが合成した内容と一致することを確認します。変わっていたら、その Take は使わずに生成し直します。

### キャラクター

`kakeai_character_list` / `kakeai_character_get` はキャラクターライブラリの読み取りだけを公開します。ライブラリの作成・更新・削除はエージェントからは行えません。

声は、対象 locale の声を持つ Entry を選びます。声が無い Entry をコピーすると `voiceProfileId: null` になり、その話者の TTS は `TTS_INPUT_INVALID` で失敗します。既存作品の話者に有効な `voiceProfileId` があれば、ライブラリから追加せずそのまま使えます。声の割り当て（Voice Profile の作成・変更を含む）は UI で人間が行い、エージェントには既存話者へ声を割り当てる専用操作がありません。

台本へ入れるときは、`kakeai_script_edit` の操作 `character.addFromLibrary`（`libraryCharacterId`）で新しいローカル Character・Appearance・Speaker としてコピーします。結果の `created.characterIds` / `created.appearanceIds` / `created.speakerIds` を読み、次の `kakeai_script_edit` で `line.setSpeaker` と `standing.set` に使います。`character.addFromLibrary` は `key` を持たないため、同じ呼び出し内で `{ "key": ... }` として参照することはできません。

## 動画制作の流れとMP4の合格ライン

エージェントは、`schema.get` → 作品と台本 → 声のプリフライト → 素材 → 映像演出・BGM → TTS → 検証 → レンダーの順で進めます。MP4 の合格ラインは次の2つです。

1. `render` Job が `succeeded` になる。
2. `kakeai_job_get` の `artifacts` に `role: "render"` / `format: "mp4"` の Artifact が存在する。

エージェントは Artifact の ID・尺（`durationMs`）・寸法（`widthPx` / `heightPx`）を報告します。最終的な絵・音の確認、MP4 の取得、サムネイル、SRT 字幕、YouTube の投稿設定は人間が行います。`kakeai_preview_frame` による静止画確認は任意の補助で、合格ラインには含みません。詳しい手順は [スキル](#スキル) の `kakeai-production` を参照してください。

## 長尺操作

`kakeai_asset_import`、`kakeai_render_start`、`kakeai_tts_create`、`kakeai_tts_create_bulk` は Job を投入してすぐ返ります。

1. `kakeai_asset_import` は `jobId` を返します（同じ内容の素材が既にあれば `null`）。
2. `kakeai_render_start` は `job` を返します。
3. `kakeai_tts_create` は `job` を、`kakeai_tts_create_bulk` は `jobs`（セリフごとの Job）と `excluded` を返します。`kakeai_tts_attach_bulk` は短時間の確定操作で、Job を待機しない代わりに `pending` / `finalized` と件数を返します。
4. `kakeai_job_wait` に Job ID を渡すと、終端状態までポーリングします。`timeoutMs` を超えた場合は `timedOut: true` と最後の Job を返すので、そのまま再度呼び出せます。一括生成のように複数の Job がある場合は、Job ID ごとに待つか `kakeai_job_get` で個別に確認します。
5. 個別に確認する場合は `kakeai_job_get`、作品内の一覧は `kakeai_job_list` を使います。`kind` で `render`（既定）と `tts` を選べます。`asset_ingest` は Work に紐づかないため `kakeai_job_list` の対象外で、`kakeai_job_get` で確認します。
6. TTS Job の ID を失った場合は、`kakeai_job_list` に `{ "workId": "...", "kind": "tts" }` を渡して再発見します。ただし `requestId` なしで開始した一括生成は、Job を見つけても確定できません。

## CLI（kakeai-agent）

MCP の代わりに、同じ操作をシェルから実行できます。接続先・検証・エラーコードは MCP と共通で、操作名は MCP ツール名ではなく正規の `domain.verb` です。

リポジトリで `npm install` した後、`node_modules/.bin/kakeai-agent` を使います。開発中は `npm run start --workspace @kakeai/cli -- schema.get` でも実行できます。

```sh
kakeai-agent schema.get
kakeai-agent work.create --input '{"title":"新しい作品"}'
kakeai-agent work.update --input '{"workId":"work-123","title":"改訂版の作品名"}'
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
| `kakeai_work_update` | `kakeai-agent work.update --input ...` |
| `kakeai_script_edit` | `kakeai-agent script.edit --input ...` |
| `kakeai_asset_list` | `kakeai-agent asset.list --input '{"tags":["bgm"],"status":"ready"}'` |
| `kakeai_asset_import` | `kakeai-agent asset.import --input ...` |
| `kakeai_character_list` | `kakeai-agent character.list` |
| `kakeai_tts_create` | `kakeai-agent tts.create --input ...` |
| `kakeai_tts_create_bulk` | `kakeai-agent tts.createBulk --input ...` |
| `kakeai_tts_attach_bulk` | `kakeai-agent tts.attachBulk --input ...` |
| `kakeai_render_start` | `kakeai-agent render.start --input ...` |
| `kakeai_preview_frame` | `kakeai-agent preview.frame --input ... [--out ...]` |
| `kakeai_job_wait` | `kakeai-agent job.wait <jobId>` |

MCP ツール名は `kakeai_<domain>_<verb>` の snake_case、CLI のサブコマンドは正規の `domain.verb` です。`createBulk` や `authoringContext` のように語が複数ある操作では機械的な読み替えが一致しないため、`kakeai-agent operations` か `schema.get` の `agentOperations` で正規名を確認してください。同じ操作・同じ入力なら、CLI の stdout JSON は MCP の `structuredContent` と一致します（`preview.frame` の `--out` 指定時を除く。`--out` 指定時は PNG がファイルに書かれ、stdout JSON は `pngBase64` の代わりに `path` を含みます）。

### 静止画の取得（`preview.frame`）

render が完了した成果物の指定時刻の絵を、原寸 PNG で確認できます。`artifactId` は `job.get` の `artifacts` で取得します。これは任意の補助で、MP4 の合格ラインには含まれません。最終的な絵・音の判断は人間が行います。

```sh
# JSON で受け取る（pngBase64 に原寸 PNG の base64 が入る）
kakeai-agent preview.frame --input '{"artifactId":"art-123","timeMs":1500}'

# PNG ファイルに書き出す（stdout は pngBase64 なしのメタ情報 + path）
kakeai-agent preview.frame --input '{"artifactId":"art-123","timeMs":1500}' --out frame.png
```

- `timeMs` はミリ秒で、`artifact` の確定尺を超えると `VALIDATION_ERROR` になります。
- 応答の `resolvedTimeMs` が実際に抜いた時刻、`width`・`height` が原寸の寸法です。指定時刻直前のフレームに丸められるため、`resolvedTimeMs` が `timeMs` より少し前になることがあります。
- 対象は render の MP4 成果物だけです。字幕などの成果物を指定すると `VALIDATION_ERROR` になります。
- 初回はサーバー側のフレーム走査が入るため、長尺の動画では `AGENT_REQUEST_TIMEOUT` になることがあります。その場合は同じ入力でもう一度呼び直してください（2回目はキャッシュが効きます）。

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
- `1`: 操作または検証の失敗。stderr に `{ "code": "...", "issues": [...] }` を 1 行で出力する。`--out` の書込み失敗もここに含む（`CLI_OUTPUT_ERROR`）
- `2`: 使い方または `--input` の誤り（`CLI_USAGE_ERROR` / `CLI_INPUT_ERROR`）

stdout は常にコマンド出力専用で、失敗時は空です。スタックトレースは出力しません。

## スキル

Kakeai は、エージェントが制作手順をたどるためのスキル（手順書）をリポジトリに同梱しています。どちらも MCP / CLI の同じ Agent Access 操作だけを使い、HTTP API・ソケット・Prisma を直接使いません。

| スキル | 内容 |
| --- | --- |
| [`skills/kakeai-production/`](https://github.com/shipwebdotjp/kakeai/tree/main/skills/kakeai-production) | 1 本の動画を作る横断手順。`schema.get` → 作品と台本 → キャラクター → 素材 → 映像演出・立ち絵・BGM → TTS → 検証 → レンダー、および再送・古い基準版の扱い |
| [`skills/kakeai-composition/`](https://github.com/shipwebdotjp/kakeai/tree/main/skills/kakeai-composition) | 再利用する Composition の draft 作成・QA・publish と、台本からの参照 |

`kakeai-production` には、声のプリフライト、一括TTSの順序（`requestId`、同じ `agentId`、確定までの台本保存禁止）、MP4の合格ライン（render Job 成功 + MP4 Artifact）が含まれます。

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
| `AGENT_REQUEST_TIMEOUT` | 操作がタイムアウトした。`script.edit` と `kakeai_tts_attach_bulk` は同じ `requestId` で再送してよい（既存の版が返る）。`tts.create` / `tts.createBulk` / `render.start` / `composition.publish` も任意の `requestId` を付けて再送すると既存の Job／Version が返る。`work.create` / `script.save` は `requestId` を持たないため、`work.list` / `script.get` で反映を確認してから再実行する。それ以外の変更操作は `script.get`・`job.list`・`asset.list` などで結果を確認してから再実行する |
| `SCRIPT_BASE_STALE` | `baseScriptVersionId` が現在の版と異なる。`kakeai_script_get` で取り直し、同じ意図を適用し直す。`kakeai_tts_attach_bulk` では一括生成の後に台本を保存した場合、`kakeai_script_save` では基準版ガードに指定した版が古い場合に返る |
| `IDEMPOTENCY_CONFLICT` | 同じ `requestId` を異なる内容で使った。既存の版を確認し、同じ ID を別内容で再利用しない |
| `AGENT_IDEMPOTENCY_IN_PROGRESS` | 同じ `requestId` の処理が実行中で、待機時間内に完了しなかった。実行中の Job を `kakeai_job_get` / `kakeai_job_wait` で確認する |
| `AGENT_BACKPRESSURE` | 短時間に多すぎる要求を送り、接続内の未処理要求が上限を超えた。接続は閉じられない。しばらく待ってから再送する |
| `VALIDATION_ERROR` | 入力または保存内容がスキーマに適合しない。`issues` を確認する |
| `EDIT_TARGET_NOT_FOUND` など `EDIT_*` | 台本操作の対象や前提が成立しない |
| `ASSET_UNAVAILABLE` | 参照する素材が `ready` でない、または欠損している |
| `COMPOSITION_UNAVAILABLE` | 参照する CompositionVersion が未 publish、または bundle が欠損している |
| `TTS_INPUT_INVALID` | 読み上げテキストが空、話者・声が未設定、設定済みアダプター外の声など |
| `TTS_ENGINE_UNAVAILABLE` | 設定済みの TTS アダプターへ接続できない。利用者にエンジンの起動を依頼する |
| `RESOURCE_NOT_FOUND` / `WORK_NOT_FOUND` | 参照する台本版・セリフ・素材・作品が存在しない。別の `agentId` で呼んだ `kakeai_tts_attach_bulk` や、`requestId` なしで開始した一括生成の確定もここに含む |
| `JOB_NOT_CANCELLABLE` | queued 以外の Job は取り消せない。実行中の Job は待つ |
| `RENDER_FAILED` / `RENDER_INPUT_INVALID` | レンダーが失敗した。`job.error` を確認し、素材・尺・テンプレート入力を直す。同じ入力で無限に再試行しない |
| `MCP_TOOL_UNKNOWN` | ツール名が存在しない |
| `MCP_INTERNAL_ERROR` | MCP 側の想定外の失敗。詳細は返らない |

`failed` な Job の理由は `job.error` に、レンダー・取り込み・TTS の安定コードとして入ります。
