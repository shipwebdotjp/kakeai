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
| 可逆 | 作品作成、台本保存（新しい Script Version の追加と current の前進）、操作コアによる Scene・セリフ・Cue・素材割り当て・立ち絵・Character コピーの編集、Composition の draft 更新と publish、Asset 取り込み、タグ更新、レンダー投入、利用者が設定済みの TTS Adapter への合成 Job 投入、queued Job のキャンセル | 可 |
| 不可逆 | Work・Asset 本体・Composition Version・Artifact の実体削除、外部サービスへの公開、TTS 以外の課金を伴う生成 | 人のみ |

「台本上の削除」（Cue・Scene・セリフ・割り当ての除去）は、要素を除いた新しい Script Version を作るだけの可逆な操作であり、エージェントに許す。実体ファイルや行を消す操作だけが不可逆である。既存の [../mvp/api-contract.md](../mvp/api-contract.md) の削除系はそのまま人専用とし、エージェントの操作面には公開しない。Composition の publish は Kakeai 内の不変版の追加であり、外部サービスへの公開ではない。TTS の合成 Job は、利用者が設定したループバック Adapter だけを対象に可逆な操作として公開する（[ADR 0077](../adr/0077-agent-tts-on-configured-adapters.md)）。

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
| `tts.create` | mutation | yes | `kakeai_tts_create` |
| `tts.createBulk` | mutation | yes | `kakeai_tts_create_bulk` |
| `character.list` | read | no | `kakeai_character_list` |
| `character.get` | read | no | `kakeai_character_get` |

- 長尺操作は Job の投入と ID の返却までで完了する。`asset.import` は内容が既存 Asset と同一なら `jobId: null` を返す。`render.start` と `tts.create` は `job` を返す。`tts.createBulk` は投入した Job の組（`jobs`）と生成できなかったセリフ（`excluded`）を返す。呼び出し側は `job.get` または `job.list` で状態を確認する。
- `tts.create` / `tts.createBulk` / `render.start` / `composition.publish` は任意の `requestId` を受け付ける（[冪等台帳](#冪等台帳高コスト操作)）。束縛は入力をそのまま転送するだけで、台帳の規則を持つのは操作コア側だけである。
- MCP 束縛は `job.get` の有界ポーリングを `kakeai_job_wait` として提供する。`timeoutMs`（既定 60 秒、最大 600 秒）と `intervalMs`（既定 500 ミリ秒、10〜30000 ミリ秒）を受け、終端状態（`succeeded` / `failed` / `cancelled`）に達したら `{ job, timedOut: false, polls }`、予算超過なら最後の Job と `timedOut: true` を返す。`job_wait` は MCP 束縛の便宜ツールであり、Agent 操作ではない。
- 失敗はすべて `isError: true` のツール結果として返し、サーバーを落とさない。本文は JSON `{ "code": "...", "issues": [...] }` で、Agent Access と操作コアのコードをそのまま透過する。MCP 自身の失敗は `MCP_TOOL_UNKNOWN`（未知のツール名）、`VALIDATION_ERROR`（入力スキーマ不一致、`issues` 付き）、`MCP_INTERNAL_ERROR`（想定外。詳細は返さない）とする。アプリ未起動は `AGENT_APP_UNAVAILABLE`、未知の操作は `AGENT_OPERATION_UNKNOWN` である。
- 実体削除、外部サービスへの公開、TTS 以外の課金を伴う生成は MCP にも公開しない。Composition の publish は Kakeai 内の不変版の追加であり、外部公開ではない。

## CLI 束縛

- 実体は `apps/cli`（`@kakeai/cli`、bin `kakeai-agent`）である。`@kakeai/agent-client` で同じローカル制御ソケットへ接続する薄いクライアントであり、Prisma・DB・業務ロジックを持たない。書き込みは stdout と stderr だけで、ファイルは `--input` の読取りにしか使わない。
- サブコマンドは正規の `domain.verb` をそのまま使う（`kakeai-agent work.create --input input.json`、`kakeai-agent schema.get`）。`job.wait <jobId>` は MCP の `kakeai_job_wait` と同じ便利コマンド、`operations` は `agentOperationCatalog` を返す。サブコマンド一覧は操作カタログから導出し、束縛側に第二の一覧を持たない。
- `--input` はインライン JSON・ファイルパス・`-`（標準入力）を受け付ける。省略時は `{}` として扱う。送信前に `packages/contracts` の入力スキーマで検証し、受信後も出力スキーマで検証してから stdout に 1 つの JSON を書く。`--pretty` は出力をインデントする。
- グローバルオプションは `--agent-id`（既定 `cli`）、`--data-dir`、`--socket`、`--timeout`（1 要求のタイムアウト。読み取り・変更の両方に適用）。解決順は MCP と同じく、引数、環境変数（`KAKEAI_AGENT_ID` / `KAKEAI_DATA_DIR` / `KAKEAI_SOCKET`）、プラットフォーム既定の順である。`--help` は種別ごとの操作一覧、`--version` はバージョンを返す。
- 長尺操作は `job.wait <jobId>` または `asset.import` / `render.start` / `tts.create` / `tts.createBulk` の `--wait` で待てる。どちらも MCP と同じ `jobWaitInputSchema` と `waitForJob` を使い、`--timeout-ms`（既定 60000、最大 600000）と `--interval-ms`（既定 500、10〜30000）を受ける。`job.wait` は `{ job, timedOut, polls }` を返し、予算超過は成功（終了コード 0）で `timedOut: true` とする。`--wait` は操作結果を `{ result, wait }` に包み、Job を投入しなかった場合（`asset.import` の重複）と複数 Job を投入した場合（`tts.createBulk`）は `wait: null` とする。後者は Job ID ごとに `job.wait` するか `job.get` で確認する。
- 失敗は stderr に `{ code, issues? }` の 1 行 JSON だけを書き、スタックトレースや自由文を出さない。stdout は常にコマンド出力専用である。終了コードは、`0` が成功（help・version・`operations` を含む）、`1` が操作または契約検証の失敗（code は Agent Access と操作コアの安定コード）、`2` が使い方または `--input` の誤り（`CLI_USAGE_ERROR` / `CLI_INPUT_ERROR`）である。CLI 自身の想定外の失敗は `CLI_INTERNAL_ERROR`（終了コード 1）とし、詳細を返さない。
- MCP と同じく、実体削除、外部サービスへの公開、TTS 以外の課金を伴う生成は CLI にも公開しない。Composition の publish は Kakeai 内の不変版の追加であり、外部公開ではない。
- 束縛間で共有する実装は `@kakeai/agent-client` に置く。`jobWaitInputSchema`・`waitForJob`・`createJobGetter` と、`{ code, issues? }` の整形（`zodIssues`・`bindingErrorPayload`）を MCP と CLI が共有し、ポーリングやエラー整形を複製しない。

## スキル

- リポジトリの `skills/kakeai-production/` と `skills/kakeai-composition/` に、外部エージェント向けの手順書（スキル）を置く。`kakeai-production` は台本・キャラクター・素材・Cue・TTS・検証・レンダーをまたぐ制作フロー、`kakeai-composition` は再利用する Composition の authoring を扱う。
- スキルは束縛ではない。実行時の入口は MCP または CLI のままとし、スキルはその操作の呼び出し順と判断点だけを定める。HTTP API・ローカルソケット・Prisma を直接使う手順を書かない。
- テンプレート契約・操作の入出力スキーマをスキルへ複製しない。`schema.get` と、MCP の `inputSchema` / CLI の検証を正とする。
- 配布はリポジトリの `skills/` を配布元とし、利用するエージェントランタイムのスキルディレクトリへディレクトリごとコピーまたはシンボリックリンクして検出させる。検出先はランタイム依存であり、特定ベンダーのパスを前提にしない。アプリは実行時に `skills/` を読みに行かない。
- 導入手順は [ユーザーガイドのエージェント連携](../../user-guide/docs/agent-access.md) に記載する。

## ローカル制御ソケット

- 常駐するアプリプロセスが操作面をローカル OS ソケットで公開する。MCP stdio サーバーと CLI はこのソケットへ接続するクライアントである。
- ソケットは `<dataRoot>/agent/agent.sock` に置き、ディレクトリを `0700`、ソケットを `0600` とする。起動トークンや独自ヘッダを持たない（[ADR 0075](../adr/0075-agent-local-socket-single-writer.md)、[ADR 0015](../adr/0015-minimal-local-api-protection.md) の精神を踏襲）。
- 同一ユーザー性の担保は、このファイル権限（`0700` のディレクトリと `0600` のソケット）そのものである。接続元プロセスの UID をネイティブに検証しない。ネイティブ UID 検証は導入せず、ファイル権限で同じユーザーだけが接続できる根拠を仕様上明確にする（[ADR 0075](../adr/0075-agent-local-socket-single-writer.md)）。接続数の超過も利用者自身の接続であるため、切断のみで拒否する。
- アプリプロセスが単一の SQLite ライターかつ単一の worker であり続ける。エージェントは Job を投入するだけで、worker を起動しない。
- v1 はアプリが起動していないとき、接続に失敗する安定したエラーを返す。エージェントによるアプリの自動起動は対象外とする。
- 起動時、ソケットファイルが既にある場合はアプリプロセスだけが後始末する。接続できるソケットは稼働中として残し、接続できないソケットだけを削除してから listen する。ソケットでないファイルは削除しない。終了時は自分が作ったソケットを unlink する。
- 接続時に `{ "protocolVersion": 1, "agentId": "<任意>" }` を送る。対応するプロトコル版は `minProtocolVersion`..`protocolVersion` の範囲であり、この範囲外の版は `AGENT_PROTOCOL_MISMATCH` で拒否して接続を閉じる。
- フレームは 1 行 1 JSON（NDJSON）とし、要求は `{ "requestId": "<呼び出し内で一意>", "operation": "<name>", "input": <object> }`、応答は `{ "requestId": "...", "ok": true, "data": ... }` または `{ "requestId": "...", "ok": false, "error": { "code": "...", "issues": [...] } }` とする。`issues` は `{ path, code, message }` の配列で、スタックトレースや自由文の詳細は返さない。
- 1 要求の最大ペイロードは 32 MiB（改行を含むバッファ長）とし、超えた場合は `AGENT_PAYLOAD_TOO_LARGE` を返して接続を閉じる。読み取り操作のタイムアウトは 10 秒、変更操作は 120 秒とし、サーバー側でも `AGENT_REQUEST_TIMEOUT` を返して接続を閉じる。クライアントも同じ時間で打ち切る。タイムアウトは処理の中断を保証しない。`script.edit` は `requestId` で冪等に再送できる。高コスト操作（`tts.create` / `tts.createBulk` / `render.start` / `composition.publish`）も任意の `requestId` で冪等化され、再送しても Job や Version が増えない。それ以外の変更操作は自動再送せず、`job.list`・`script.get`・`composition.get` などで結果を確認してから必要なら再実行する。
- サーバーは応答を返した後も同じ接続で次の要求を受け付けるが、5 分間何も受信しない接続は閉じる。
- ソケットファイルが残っていて接続できない場合、クライアントは削除せず `AGENT_APP_UNAVAILABLE` を返す。所有者はアプリプロセスだけとする。

### 流量制御

ソケットは過剰な入力から守られる。待ち行列と接続数には上限があり、上限は `packages/contracts` の定数が正で、上限に達した要求は接続を落とさずに安定したコードで返す。

- 接続ごとの未処理フレーム数に上限を設ける（`AGENT_MAX_PENDING_FRAMES_PER_CONNECTION`、既定 64）。数えるのは「受信済みで、まだ応答を返していない要求フレーム」の数で、ハンドシェイクは数えない。同じ接続で 2 個目のハンドシェイクは要求フレームとして数える。
- 未処理フレームのバイト数にも上限を設ける（1 要求の上限と同じ 32 MiB）。フレーム数だけでは 1 フレーム 32 MiB × 64 フレームで接続ごとに 2 GiB を保持できてしまうため、バイト数も予算に含める。どちらの予算超でも同じ扱いで、要求は実行しない。
- 上限に達しているときの新しい要求フレームは実行しない。`AGENT_BACKPRESSURE` を返して読み飛ばし、接続は開いたままにする。応答は要求順を待たずに返るため、クライアントは `requestId` で対応づける。已经キューに入った要求は実行され、完了する。
- 上限超過時は、要求として解釈できないフレームも同じ `AGENT_BACKPRESSURE`（`requestId` は空）で返す。上限に達していないときは、従来どおり不正フレームは `AGENT_PROTOCOL_MISMATCH` で接続を閉じる。
- 読み取り側には backpressure を効かせる。いずれかの予算に達している間はソケットの読み取りを止め、キューが下限（フレーム数は上限の半分、バイト数も上限の半分、最低 1）まで減ると読み取りを再開する。速い書き手がサーバーのメモリを際限なく増やさないようにするためである。停止中の接続は待ち行列を処理中なので、アイドルタイムアウトでは閉じない。
- 読み飛ばしたフレームは待ち行列に入らないため、それだけでは読み取りを止める理由にならない。読み飛ばした直後は読み取りを少し（実装は 50 ミリ秒）止めてから再開し、収まらないフレームを線路速度で 1 枚ずつ答え続けることを避ける。
- 応答は読み飛ばしたフレームも含めて 1 枚ずつ返すので、応答量は読み取った量に比例する。クライアントが応答を読まない場合、サーバーの書き込みバッファが際限なく増えるため、バッファが上限を超えたら読み取りも止める。
- 同時接続数にも上限を設ける（`AGENT_MAX_CONNECTIONS`、既定 16）。上限を超えた接続はハンドシェイクの前に切断し、ログに残す（切断の記録は連打でログを埋めないよう間引く）。上限以内の接続は影響を受けない。
- 上限は実装の既定値であり、テストでは小さくできる。クライアントは `AGENT_BACKPRESSURE` を受けたら少し待って再送する。
- 実行中操作の取消は対象外とする。取り消しには `AbortSignal` の伝播が必要なため、別途検討する。

## 操作一覧

操作はタスク指向とし、`domain.verb` 形式で表す。詳細な入出力は `packages/contracts` の Zod スキーマを正とする。

参照:

- `schema.get` — 現在の `contentSchemaVersion`、各 VisualTemplate の `inputFields`・layer・transition・animation の制約、操作カタログ、Asset 種別と用途の制約、警告コードを返す。`schemaDigest` を含め、アプリ更新による変化を検知できるようにする。エージェントが値を推測しないための必須操作。`schemaDigest` はスキーマ関連データを正規化した非暗号の安定フィンガープリント（`fnv1a64:` 接頭辞）であり、意味が変わらなければ同一値を返す。`operations` は台本編集の `ScriptOperation` カタログ（名前とカテゴリ）を従来どおり返し、`agentOperations` は束縛が公開してよい全 Agent 操作のカタログ（`name`、`kind` の `read` / `mutation`、Job を返す `longRunning`）を返す。`agentOperations` は読み取り・変更の分類リストから導出し、束縛ごとに第二の操作一覧を持たない。`operationDigest` は全 Agent 操作の入出力スキーマを正規化した契約のダイジェストで、操作の入力・出力が変わると必ず変化する。`minProtocolVersion` は対応するプロトコル版の下限、`protocolVersion` は上限（対応版）である。
- `work.list` / `work.get`
- `script.get` — `scriptVersionId` を指定するとその版、`languageEditionId` を指定するとその Edition の current の `ContentDocument` と帰属を返す。どちらか一方を必須とする。
- `script.validate` — 保存せずに検証する。`{ content }` または `{ baseScriptVersionId, operations }` を受け、`warnings` と解決済み `timeline` を返す。書込みを行わない。
- `asset.list` — 素材を検索し、`{ assets, nextCursor, total }` の1ページを返す。`total` は同じ絞り込み条件に一致する素材の総数で、同一条件のどのページでも同じ値になる。
  - 絞り込みは `kind`・`status`・`filename`（大文字小文字を区別しない部分一致）・`tags`（`tagMode` で AND / OR を明示）・`favorite`・`archived`（既定は除外）・`hasAudio`・`durationMinMs` / `durationMaxMs` を組み合わせる。`durationMinMs` / `durationMaxMs` は0以上のミリ秒で、長さを持たない素材（`durationMs` がnull）は範囲に一致しない。下限が上限より大きい場合は `VALIDATION_ERROR` とする。
  - タグの照合は `Asset.tagsJson` の要素として DB 側のクエリで行う。`tagMode: "and"` は指定したタグすべてを持つ素材、`"or"` はいずれか1つを持つ素材が一致する。タグは引用符で囲まれた要素として保存されるため `bgm` は `bgm_loop` に一致しない。照合が SQLite の `LIKE` を通るため ASCII の英字は大文字小文字を区別せず、非ASCII（日本語など）は区別する。`LIKE` のワイルドカード `_`（任意1文字）と `%`（任意文字列）はタグ文字列のままワイルドカードとして解釈されるので、これらの文字を含むタグの検索は他のタグにも一致し得る（タグ `%` はタグを持つ素材すべてに一致する）。
  - 並び順は `sort` で指定する。`createdAt_desc`（既定、`createdAt` 降順・`id` 降順）、`createdAt_asc`（昇順）、`filename_asc`（ファイル名のバイト順）、`duration_asc`（長さの昇順。長さを持たない素材是最後）。いずれも（ソート列, `id`）の2段で固定し、同じ値を持つ行がページをまたいでも重複も欠落も起こさない。
  - `cursor` は前ページの `nextCursor` をそのまま渡す不透明値で、ソート列と `id` を含む。別の `sort` で使うと `VALIDATION_ERROR`（issue path は `["cursor"]`）となり、黙って別の並び順として解釈することはない。壊れた cursor も同じ `VALIDATION_ERROR` とする。`limit` は既定50、最大100。
  - HTTP、ソケット、MCP、CLIは同じ契約を使う。
- `asset.get` — Asset 1件を返す。
- `composition.list` / `composition.get` / `composition.draft.get` / `composition.authoringContext`
- `character.list` / `character.get` — キャラクターライブラリの読み取り（後述）。
- `job.get` / `job.list`

可逆な変更:

- `work.create` — Work、指定 locale（既定は `ja-JP`）の LanguageEdition、初期 ScriptVersion を [../mvp/spec.md](../mvp/spec.md) の作成規則で作る。
- `script.save` — `languageEditionId` と全 `ContentDocument` を受け、検証して新しい Script Version を追加し current を進める。全体の置換や取り込み向けであり、通常の編集は `script.edit` を使う。
- `script.edit` — 基準版と `ScriptOperation` の配列を受け、操作コアで一括適用し、保存検証を通して新しい Script Version を追加する。1 呼び出しは 1 版とし、途中失敗時は版を作らない。
- `asset.import` — 後述の手順で Asset を取り込む。
- `asset.tag` — Asset のタグを更新する。
- `composition.create` / `composition.draft.save` / `composition.publish` — Composition Library の authoring（[../composition-library/spec.md](../composition-library/spec.md)、[../visual-skins/spec.md](../visual-skins/spec.md)）。publish は `dryRun` を受け付ける。
- `render.start` — 対象版と ready な素材から render Job を投入する。
- `tts.create` — 保存済み台本版の 1 セリフについて、利用者が設定済みの TTS Adapter へ合成 Job を投入する（後述）。
- `tts.createBulk` — 保存済み台本版の要点シーンで音声が未選択のセリフへ、まとめて合成 Job を投入する（後述）。
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

## プロトコル版と契約ダイジェスト

- 互換性は「追加は自由、破壊は版を上げる」で扱う。操作の入出力への任意フィールドの追加や列挙値の追加では `AGENT_PROTOCOL_VERSION` を上げない。必須化・フィールドの削除・意味変更のときだけ上げる。
- 対応版は範囲として扱う。`AGENT_PROTOCOL_MIN_VERSION` が下限、`AGENT_PROTOCOL_VERSION` が上限であり、handshake はこの範囲の版だけを受け入れる。範囲外の handshake は `AGENT_PROTOCOL_MISMATCH` で拒否する。現在の版は下限も上限も `1` であり、機構的出现で挙動は変わらない。
- `schema.get` は `minProtocolVersion`（下限）と `protocolVersion`（上限）を返す。エージェントはどちらの版でも接続できるかを確かめられる。
- `schema.get` の `operationDigest` は、全 Agent 操作の入出力スキーマを JSON Schema に正規化して摘要した値である。JSON Schema への変換は `packages/contracts` の `toAgentJsonSchema` に一本化し、MCP のツールスキーマ生成と同じ正規形を使う。摘要対象のキーの並び順には依存しない。
- `schemaDigest` は Template・警告・操作カタログ・操作契約をまとめた摘要である。`operationDigest` を含むため、操作の入力・出力が変われば `schemaDigest` も必ず変化する。エージェントは保存した `schemaDigest` と `operationDigest` を比較して契約ドリフトを検知できる。
- 摘要は非暗号の安定フィンガープリント（`fnv1a64:` 接頭辞）であり、意味が変わらなければ同一値を返す。衝突耐性はセキュリティの目的ではなく、変更検知の合図である。
- `schema.get` の応答には `operationDigest` と `minProtocolVersion` が入る。両方ともこの機構の導入前に作られた応答には存在しないため、応答スキーマでは任意扱いにする（現在のサーバーは必ず返す）。これにより、新しい束縛は古いアプリの応答も検証できる。
- 古い束縛は厳格な応答検証で未知のキーを弾くため、`schema.get` の応答にフィールドを増やす変更は、束縛とアプリが同じバージョンで同居することを前提とする。ずれが起きたら束縛も同じ版へ更新する。
- 版の機構は、破壊的変更が実際に起きたときに使う。`AGENT_PROTOCOL_VERSION` を上げると、古い束縛は handshake で `AGENT_PROTOCOL_MISMATCH` になって接続时被弾する（応答検証の失敗ではなく、原因が明確な失敗になる）。

## 素材の取り込み

- エージェントはアプリと同じマシンのファイルシステムを共有するため、`asset.import` はローカルパスを受け取り、バイト列を読んで取り込む。multipart や base64、URL 取得は用いない。
- 取り込みは Web UI の multipart アップロードと同じ内部処理に落とし、`storageKey` は内容ハッシュ由来とする。入力パスを正本へ保存しない（[../mvp/spec.md](../mvp/spec.md)）。
- 読み取りは利用者と同じ権限で行う。実装はサイズ上限とメディア種別の判定を行い、判定できないファイルは取り込まない。取り込み元パスをログや正本へ残さない。
- 生成物の来歴（モデル、プロンプト、生成パラメータ）は `provenance` として任意に受け取り、`Asset.provenanceJson` に保存する。取り込み元のパスは来歴に含めない。画像などの生成自体はアプリ内で行わない。TTS は利用者が設定した Adapter への Job 投入に限る（後述）。

## TTS とキャラクター

利用者が事前に設定したループバックの TTS Adapter（`voicevox` / `aivisspeech` / `openai-compatible`）への合成 Job 投入は、生成 Asset と Script Version のいずれも履歴から戻せるため、可逆な操作として公開する（[ADR 0077](../adr/0077-agent-tts-on-configured-adapters.md)）。

- 対象は利用者が設定済みの Adapter と既存の Voice Profile に限る。接続先・認証情報・Adapter 設定の変更、Voice Profile の作成・更新・削除は公開しない。
- TTS の入力・出力は HTTP の TTS 契約（[../tts/spec.md](../tts/spec.md)）と同じスキーマ・Adapter 解決・エラーコードを共有し、束縛ごとに生成ロジックを複製しない。Job は既存の `job.get`（MCP / CLI では Job 待機）で状態を確認する。
- 完了した Job の `ttsResult` を Take として台本へ入れる操作は公開しない。`script.edit` の `line.assignTake` で新しい Script Version を追加する。
- 生成物は既存の `origin: generated` と `provenanceJson` で帰属し、TTS 専用の課金管理・プロバイダ管理・新しい帰属列は持たない。
- Character ライブラリは読み取り（一覧・取得）だけを公開する。台本へ入れるときは操作コアの `character.addFromLibrary` で新しいローカル ID へコピーし、Face Set は参照のまま引き継ぐ（[../editor-core/spec.md](../editor-core/spec.md)）。ライブラリの作成・更新・削除は公開しない。

### TTS の契約

- `tts.create` は `{ scriptVersionId, narrationSegmentId, voiceId?, speechText?, speedScale? }` を受け、1 つの `tts` Job（`{ job }`）を返す。`speedScale` は HTTP と同じく既定 `1.0`、範囲は `0.5`〜`2.0`。`voiceId` を省くと話者の Voice Profile の声、`speechText` を省くと保存済みセグメントの読み上げテキストを使う。
- `tts.createBulk` は `{ scriptVersionId }` を受け、HTTP と同じ `{ jobs, excluded }` を返す。対象は要点シーンのうち `selectedAudioTakeId` が `null` のセリフで、生成できないセリフは他の生成を止めず `excluded` に `code` と安全な理由を返す。
- 完了した `tts` Job の `ttsResult`（`narrationSegmentId`・`assetId`・`durationMs`・`source: "tts"`）は `job.get` と MCP の `kakeai_job_wait` / CLI の `job.wait` がそのまま返す。Take への反映前に最新の台本を `script.get` で読み直し、対象 Segment と読み上げテキストを照合してから `script.edit` の `line.assignTake`（`assetId` に `ttsResult.assetId`、`source: "tts"`）を適用する。この照合はワークフローの規約であり、サーバーはテキスト一致を強制しない。
- 存在しない台本版・セリフは `RESOURCE_NOT_FOUND`、入力不正は `TTS_INPUT_INVALID`、Adapter へ接続できない場合は `TTS_ENGINE_UNAVAILABLE` を返す。Job 実行中の失敗は `job.get` の `status: failed` と `error` で伝える。

### Character の契約

- `character.list` はキャラクターライブラリの全件を `{ characters }` で返す。`character.get` は `{ characterId }` を受け、`{ character }` を返す。いずれも `id`・`name`・locale 別の `voices`・外観（`assetId`・`expression`・`pose`・任意の `label`・`faceSetId`）・`createdAt` / `updatedAt` を持ち、HTTP の Character 契約と同じ `characterLibraryEntrySchema` を使う。存在しない `characterId` は `RESOURCE_NOT_FOUND` とする。ライブラリの作成・更新・削除は公開しない。
- 台本へ入れるときは `script.edit` の操作コア操作 `character.addFromLibrary`（`{ op, libraryCharacterId }`）を使う。ライブラリのキャラクターを、名前・`voices`・全外観を引き継いだ新しいローカル ID の Character・Appearance・Speaker として文書へコピーする。`faceSetId` は参照のまま引き継ぎ、Face Set の内容はコピーしない。Speaker の `voiceProfileId` は `ContentDocument.locale` に一致する `voices` の声、一致がなければ `null` とする。ライブラリ側は変更しない。
- コピーで作られた ID は `script.edit` の `created.characterIds` / `created.appearanceIds` / `created.speakerIds` で返る。後続の `line.add`・`line.setSpeaker`・`standing.set` にはこの ID をそのまま使う。`character.addFromLibrary` は `key` を持たないため、同一呼び出し内で作った ID を `{ key }` で参照することはできない。
- 未知の `libraryCharacterId` は `EDIT_TARGET_NOT_FOUND`、`ScriptContext.libraryCharacters` を用意できない場合は `EDIT_PRECONDITION_FAILED` とする。

## 冪等台帳（高コスト操作）

高コスト操作（`tts.create` / `tts.createBulk` / `render.start` / `composition.publish`）は、任意の `requestId` を受け付ける。`requestId` が渡されたときだけ冪等台帳（`AgentRequest`）に記録し、タイムアウト後の再送でも Job や Version が増えないようにする。

- 台帳の鍵は `(operation, agentId, requestId)` の一意制約で決まる。`agentId` は接続時の識別子で、識別子を送らないクライアントは予約値 `none` を使う。クライアントが送った識別子は `agent:` を前置して保存するので、予約値を偽装できない。識別子を送らないクライアントは `none` の枠を共有するため、衝突を避けるには接続時に `agentId` を送る。同じ `requestId` を別の操作や別のエージェントで使っても別の行になる。
- `requestId` は任意のままにする。必須化は破壊的変更 ([../mvp/api-contract.md](../mvp/api-contract.md) の互換性方針) になるため行わない。渡さない呼び出しは台帳に記録されず、従来どおり毎回新しい Job を作る。
- 要求ハッシュは操作名と入力（`requestId` を除く）から決める。キーの並び順に依存せず、同じ論理的な要求は常に同じハッシュになるため、再送と入力の相違を区別できる。意味が変わらない省略（`composition.publish` の `dryRun: false` など）はハッシュから落とすので、等価な呼び出しは同じ要求として扱う。
- 台帳に保存するのは結果の参照（Job id、CompositionVersion id、一括 TTS の Job id と除外一覧）だけで、応答のスナップショットは保存しない。再送時は現在の Job／Version から応答を再構築するため、投入直後のキュー状態ではなく完了済みの状態を返す。
- 実行前に台帳の行を先に確保する（claim）。同一要求の競合は一意制約で収束し、二重実行されない。
- 同じ `requestId`・同じ入力で完了済みの場合は、既存の Job／Version を再構築して返す。
- 同じ `requestId`・異なる入力は `IDEMPOTENCY_CONFLICT` とする。
- 同じ `requestId` で実行中のままの場合は、重複側だけを支柱時間（最大 2 秒）待って完了を待つ。完了しなければ `AGENT_IDEMPOTENCY_IN_PROGRESS` を返す。所有者が結果を残さずに消えた請求は、請求の有効期間（10 分）を超えていれば入力が違っても引き継いで実行する（放棄された請求が同じ ID を永久に塞がないようにするため）。ソケットのタイムアウトは実行中の処理を打ち切らないため、10 分を超えても実行が続く異常な処理では Job が二重になる可能性がある。実行中の取消は対象外とする。
- 操作が失敗した場合は台帳の行を残さない（claim を解放する）。同じ `requestId` で実行し直せる。恒久的な失敗なら毎回同じエラーが返る。publish は版行の追加と応答の組み立てを 1 つのトランザクションで行い、途中で失敗したときはバンドルも削除するため、版もバンドルも残らない。
- `composition.publish` の `dryRun: true` は副作用がないので台帳に記録しない。同じ `requestId` で実 publish を另行実行できる。
- 保存した参照が既に存在しない資源を指した場合は、新しい呼び出しと同じ安定コード（`RESOURCE_NOT_FOUND`）を返す。汎用の内部エラーにはしない。
- 台帳の行は定期（数分に 1 回程度）に掃除する。完了した行は記録の保持期間（30 日）を超えると削除し、結果を残していない請求は請求の有効期間（10 分）を超えたら削除する。台帳は再送に耐える短期の記録として保つ。
- `script.edit` は従来どおり版単位の冪等（`ScriptVersion.agentRequestId` / `agentRequestHash`）を維持し、台帳には載せない。

## 長尺操作

- 素材取り込み・TTS・レンダーは Job として実行し、操作は Job の投入と ID の返却まで行う。状態は `job.get` のポーリングで確認する。
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
| `AGENT_BACKPRESSURE` | 接続ごとの未処理フレーム数またはバイト数の上限に達し、その要求が実行されなかった。接続は開いたままなので、待って再送する |
| `MCP_TOOL_UNKNOWN` | MCP のツール名が未登録（MCP 束縛のみ） |
| `MCP_INTERNAL_ERROR` | MCP 束縛で想定外の失敗。詳細は返さない（MCP 束縛のみ） |
| `CLI_USAGE_ERROR` | 未知のサブコマンド、不正な引数、`--wait` などの誤用（CLI 束縛のみ） |
| `CLI_INPUT_ERROR` | `--input` のファイル・標準入力を読めない、または JSON として解析できない（CLI 束縛のみ） |
| `CLI_INTERNAL_ERROR` | CLI 束縛で想定外の失敗。詳細は返さない（CLI 束縛のみ） |
| `SCRIPT_BASE_STALE` | `baseScriptVersionId` が current と一致しない |
| `IDEMPOTENCY_CONFLICT` | 同じ `requestId` が異なる入力で使われた |
| `AGENT_IDEMPOTENCY_IN_PROGRESS` | 同じ `requestId` の処理が実行中で、待機時間内に完了しなかった |
| `EDIT_TARGET_NOT_FOUND` / `EDIT_PRECONDITION_FAILED` / `EDIT_INVALID_INPUT` / `EDIT_UNSUPPORTED_TEMPLATE` / `EDIT_ID_GENERATION_FAILED` | 操作コアのエラー（[../editor-core/spec.md](../editor-core/spec.md)） |
| `VALIDATION_ERROR` | 保存検証に適合しない。`issues` に JSON Pointer と理由を含める。MCP の入力スキーマ不一致にも同じコードと `issues` を返す |
| `ASSET_UNAVAILABLE` | 取り込み・レンダー・編集で参照する Asset が ready でない、または欠損している |
| `COMPOSITION_UNAVAILABLE` | 参照する Composition Version が publish 済みでない、または bundle が欠損している |
| `TTS_INPUT_INVALID` | TTS 生成要求の入力が不正（空の読み上げテキスト、話者・声の未設定、Adapter 外の声） |
| `TTS_ENGINE_UNAVAILABLE` | 利用者が設定した TTS Adapter へ接続できない、または不正な応答を返した |
| `RESOURCE_NOT_FOUND` | `tts.create` の対象セリフ、`character.get` のキャラクターなど、参照先の資源が存在しない |
| `WORK_NOT_FOUND` | 対象の作品・言語版・版が存在しない |

上記のほか、操作が既存サービスから受け取った HTTP API の安定コード（`VALIDATION_ERROR`、`FILE_TOO_LARGE`、`UNSUPPORTED_MEDIA_TYPE`、`JOB_NOT_CANCELLABLE` など）はそのまま返す。入出力の形は `packages/contracts` の Zod スキーマを正とする。

## 非ゴール

- アプリ内への LLM 組込、プロバイダ・モデル・API キー・課金・会話履歴の管理。
- アプリ内の画像生成・音声モデルの組込。画像生成はエージェント側に委ね、Agent Access は取り込みだけを公開する。TTS は利用者が設定したループバック Adapter への合成 Job 投入に限る。
- 複数プロセスによる SQLite 共有、worker の外部起動。
- 実体削除、外部サービスへの公開、TTS 以外の課金を伴う生成をエージェントへ開放すること。
- リモート・クラウドの MCP 接続、HTTP 経由のエージェント接続。
- 台本編集の意味論を Agent Access 側で持つこと。編集は操作コアだけが行う。

## 将来

- アプリ内ネイティブの AI 編集機能が必要になった場合は、同じ操作コアの上に任意の束縛として載せる。操作コアを変更しない限り、MCP・CLI を置き換えない。
- 操作契約のダイジェストとプロトコル版、素材検索の索引化、TTS の冪等化と Take 添付の一体化、Voice／Face Set の読み取り面、Job 操作の一般化、スキル配布、視覚確認などの拡張候補は [roadmap.md](./roadmap.md) に整理する。実装時は本仕様と [todo.md](./todo.md) に詳細を落とす。
