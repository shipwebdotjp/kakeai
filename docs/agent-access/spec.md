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
| 可逆 | 作品作成、作品複製、台本保存（新しい Script Version の追加）と過去版の復元、操作コアによる Scene・セリフ・Cue・素材割り当て・立ち絵・Character コピー・話者と声の割り当ての編集、Composition の draft 更新と publish、Asset 取り込み、タグ更新、レンダー投入、利用者が設定済みの TTS Adapter への合成 Job 投入、queued Job のキャンセル、Voice Profile と Character の作成・更新、Theme の作成・Draft 編集・公開、Artifact の書き出し（既存ファイルは上書きしない） | 可 |
| 不可逆 | Work・Asset 本体・Composition Version・Artifact の実体削除、Theme のアーカイブ、外部サービスへの公開 | 人のみ |

「台本上の削除」（Cue・Scene・セリフ・割り当ての除去）は、要素を除いた新しい Script Version を作るだけの可逆な操作であり、エージェントに許す。実体ファイルや行を消す操作だけが不可逆である。既存の [../mvp/api-contract.md](../mvp/api-contract.md) の削除系はそのまま人専用とし、エージェントの操作面には公開しない。Composition の publish は Kakeai 内の不変版の追加であり、外部サービスへの公開ではない。TTS の合成 Job は、利用者が設定したループバック Adapter だけを対象に可逆な操作として公開する（[ADR 0077](../adr/0077-agent-tts-on-configured-adapters.md)）。

可逆な操作を公開する条件は、金額ではなく接続先で決める。エージェントが使えるのは利用者が設定した接続先だけで、接続先・認証情報・Adapter 設定を作成・変更・読取できない（[ADR 0086](../adr/0086-agent-generation-boundary-by-configured-endpoints.md)）。現時点では Kakeai は接続先（URL）だけを知り、生成サービスの認証情報を保持しない。Kakeai の外で発生する費用は公開条件に含めない。

## 操作コアと束縛

- すべての振る舞いは単一の操作コア（サービス層）に置き、HTTP API・MCP・CLI はそれを薄く呼ぶだけの束縛とする。束縛ごとにロジックを複製しない。
- 台本の編集操作は [../editor-core/spec.md](../editor-core/spec.md) の `ScriptOperation` をそのまま公開する。MCP のツールごとに別の編集ロジックを作らない。
- 操作の入出力は `packages/contracts` の Zod スキーマで検証し、無検証の値を正本へ渡さない。
- エラーは束縛に依存しない安定したエラーコードで返す。

## MCP 束縛

- 実体は `apps/mcp`（`@kakeai/mcp`、bin `kakeai-mcp`）の stdio サーバーである。`@kakeai/agent-client` でローカル制御ソケットへ接続する薄いクライアントであり、Prisma・DB・ファイル書込み・業務ロジックを持たない。MCP は操作を選び、入力と出力を契約スキーマで検証して転送するだけである。
- 公式の `@modelcontextprotocol/sdk`（`^1.32.1`）を使い、低レベルの stdio サーバーとして `initialize` / `tools/list` / `tools/call` を実装する。stdout は JSON-RPC 専用とし、ログは stderr にだけ書く。起動失敗や内部エラーでもスタックトレースを stdout に出さない。
- 設定は `KAKEAI_DATA_DIR`（未指定ならプラットフォーム既定のデータルート）からソケットを解決し、`KAKEAI_SOCKET` または `--socket` で明示パスを指定できる。`--data-dir` も受け付ける。`KAKEAI_AGENT_ID` または `--agent-id` をハンドシェイクの `agentId` に使い、既定は `mcp` とする。`--help` と `--version` をサポートする。ソケット接続時の `protocolVersion` は `1` である。
- ツール名は MCP の命名制約に合わせて `kakeai_<domain>_<verb>` の snake_case とし、説明文に正規の `domain.verb` を必ず含める。`inputSchema` と `outputSchema` は `packages/contracts` の Zod スキーマから `z.toJSONSchema` で生成し、束縛側に JSON Schema を手書きしない。成功時は JSON を `content[].text` と `structuredContent` の両方で返す。画像を返す操作（`agentImagePreviewOperationNames`）に限り、`content[0].text` は `pngBase64` / `imageBase64` を除いたメタ情報の要約 JSON とし、全出力は `structuredContent`、画像バイトは標準の image コンテントブロックで返す（[ADR 0079](../adr/0079-mcp-preview-frame-text-summary.md)）。
- ツール一覧は次のとおり。読み取り・変更の区分と長尺かどうかは `schema.get` の `agentOperations` と同じ分類を使う。

| 操作 | 種別 | 長尺（Job） | MCP ツール名 |
| --- | --- | --- | --- |
| `schema.get` | read | no | `kakeai_schema_get` |
| `template.get` | read | no | `kakeai_template_get` |
| `work.list` | read | no | `kakeai_work_list` |
| `work.get` | read | no | `kakeai_work_get` |
| `work.create` | mutation | no | `kakeai_work_create` |
| `work.update` | mutation | no | `kakeai_work_update` |
| `work.clone` | mutation | no | `kakeai_work_clone` |
| `edition.create` | mutation | no | `kakeai_edition_create` |
| `script.get` | read | no | `kakeai_script_get` |
| `script.listVersions` | read | no | `kakeai_script_list_versions` |
| `script.validate` | read | no | `kakeai_script_validate` |
| `script.subtitles` | read | no | `kakeai_script_subtitles` |
| `script.save` | mutation | no | `kakeai_script_save` |
| `script.edit` | mutation | no | `kakeai_script_edit` |
| `script.restore` | mutation | no | `kakeai_script_restore` |
| `asset.list` | read | no | `kakeai_asset_list` |
| `asset.get` | read | no | `kakeai_asset_get` |
| `asset.import` | mutation | yes | `kakeai_asset_import` |
| `asset.tag` | mutation | no | `kakeai_asset_tag` |
| `render.start` | mutation | yes | `kakeai_render_start` |
| `job.get` | read | no | `kakeai_job_get` |
| `job.list` | read | no | `kakeai_job_list` |
| `job.cancel` | mutation | no | `kakeai_job_cancel` |
| `artifact.get` | read | no | `kakeai_artifact_get` |
| `artifact.export` | mutation | no | `kakeai_artifact_export` |
| `preview.frame` | read | no | `kakeai_preview_frame` |
| `preview.scriptFrame` | read | no | `kakeai_preview_script_frame` |
| `preview.assetFrame` | read | no | `kakeai_preview_asset_frame` |
| `preview.theme` | read | no | `kakeai_preview_theme` |
| `preview.thumbnail` | read | no | `kakeai_preview_thumbnail` |
| `thumbnail.listTemplates` | read | no | `kakeai_thumbnail_list_templates` |
| `thumbnail.list` | read | no | `kakeai_thumbnail_list` |
| `thumbnail.get` | read | no | `kakeai_thumbnail_get` |
| `thumbnail.appearance` | read | no | `kakeai_thumbnail_appearance` |
| `thumbnail.create` | mutation | no | `kakeai_thumbnail_create` |
| `thumbnail.update` | mutation | no | `kakeai_thumbnail_update` |
| `thumbnail.setPrimary` | mutation | no | `kakeai_thumbnail_set_primary` |
| `thumbnail.image` | read | no | `kakeai_thumbnail_image` |
| `composition.list` | read | no | `kakeai_composition_list` |
| `composition.get` | read | no | `kakeai_composition_get` |
| `composition.draft.get` | read | no | `kakeai_composition_draft_get` |
| `composition.authoringContext` | read | no | `kakeai_composition_authoring_context` |
| `composition.create` | mutation | no | `kakeai_composition_create` |
| `composition.draft.save` | mutation | no | `kakeai_composition_draft_save` |
| `composition.publish` | mutation | no | `kakeai_composition_publish` |
| `tts.create` | mutation | yes | `kakeai_tts_create` |
| `tts.createBulk` | mutation | yes | `kakeai_tts_create_bulk` |
| `tts.attachBulk` | mutation | no | `kakeai_tts_attach_bulk` |
| `character.list` | read | no | `kakeai_character_list` |
| `character.get` | read | no | `kakeai_character_get` |
| `character.create` | mutation | no | `kakeai_character_create` |
| `character.update` | mutation | no | `kakeai_character_update` |
| `character.setVoices` | mutation | no | `kakeai_character_set_voices` |
| `theme.list` | read | no | `kakeai_theme_list` |
| `theme.get` | read | no | `kakeai_theme_get` |
| `theme.diagnose` | read | no | `kakeai_theme_diagnose` |
| `theme.create` | mutation | no | `kakeai_theme_create` |
| `theme.draft.get` | read | no | `kakeai_theme_draft_get` |
| `theme.draft.save` | mutation | no | `kakeai_theme_draft_save` |
| `theme.publish` | mutation | no | `kakeai_theme_publish` |
| `font.list` | read | no | `kakeai_font_list` |
| `faceSet.list` | read | no | `kakeai_face_set_list` |
| `faceSet.get` | read | no | `kakeai_face_set_get` |
| `voiceAdapter.list` | read | no | `kakeai_voice_adapter_list` |
| `voiceProfile.list` | read | no | `kakeai_voice_profile_list` |
| `voiceProfile.get` | read | no | `kakeai_voice_profile_get` |
| `voiceProfile.listVoices` | read | no | `kakeai_voice_profile_list_voices` |
| `voiceProfile.listModels` | read | no | `kakeai_voice_profile_list_models` |
| `voiceProfile.create` | mutation | no | `kakeai_voice_profile_create` |
| `voiceProfile.update` | mutation | no | `kakeai_voice_profile_update` |

- 長尺操作は Job の投入と ID の返却までで完了する。`asset.import` は内容が既存 Asset と同一なら `jobId: null` を返す。`render.start` と `tts.create` は `job` を返す。`tts.createBulk` は投入した Job の組（`jobs`）と生成できなかったセリフ（`excluded`）を返す。`tts.attachBulk` は短時間の確定操作で Job を待機しない（`pending` / `finalized` と件数を返す）。呼び出し側は `job.get` または `job.list` で状態を確認する。
- `tts.create` / `tts.createBulk` / `render.start` / `composition.publish` は任意の `requestId` を受け付ける（[冪等台帳](#冪等台帳高コスト操作)）。`tts.attachBulk` と `script.restore` は版を作る操作のため `requestId` が必須で、版単位の冪等（`script.edit` と同じ規則）になる。`work.create` / `work.clone` / `script.save` は operation の `requestId` を持たない。束縛は入力をそのまま転送するだけで、台帳の規則を持つのは操作コア側だけである。
- MCP 束縛は `job.get` の有界ポーリングを `kakeai_job_wait` として提供する。`timeoutMs`（既定 60 秒、最大 600 秒）と `intervalMs`（既定 500 ミリ秒、10〜30000 ミリ秒）を受け、終端状態（`succeeded` / `failed` / `cancelled`）に達したら `{ job, timedOut: false, polls }`、予算超過なら最後の Job と `timedOut: true` を返す。`job_wait` は MCP 束縛の便宜ツールであり、Agent 操作ではない。
- 失敗はすべて `isError: true` のツール結果として返し、サーバーを落とさない。本文は JSON `{ "code": "...", "issues": [...] }` で、Agent Access と操作コアのコードをそのまま透過する。MCP 自身の失敗は `MCP_TOOL_UNKNOWN`（未知のツール名）、`VALIDATION_ERROR`（入力スキーマ不一致、`issues` 付き）、`MCP_INTERNAL_ERROR`（想定外。詳細は返さない）とする。アプリ未起動は `AGENT_APP_UNAVAILABLE`、未知の操作は `AGENT_OPERATION_UNKNOWN` である。
- 実体削除と外部サービスへの公開は MCP にも公開しない。生成操作は利用者が設定した接続先だけを使い、接続先・認証情報・Adapter 設定の読み書きは公開しない。Composition の publish は Kakeai 内の不変版の追加であり、外部公開ではない。

## CLI 束縛

- 実体は `apps/cli`（`@kakeai/cli`、bin `kakeai-agent`）である。`@kakeai/agent-client` で同じローカル制御ソケットへ接続する薄いクライアントであり、Prisma・DB・業務ロジックを持たない。書き込みは stdout と stderr、および画像を返す操作の `--out` だけで、ファイルは `--input` の読取りと `--out` の画像書込みに使う。
- サブコマンドは正規の `domain.verb` をそのまま使う（`kakeai-agent work.create --input input.json`、`kakeai-agent schema.get`）。`job.wait <jobId>` は MCP の `kakeai_job_wait` と同じ便利コマンド、`operations` は `agentOperationCatalog` を返す。サブコマンド一覧は操作カタログから導出し、束縛側に第二の一覧を持たない。
- `--input` はインライン JSON・ファイルパス・`-`（標準入力）を受け付ける。省略時は `{}` として扱う。送信前に `packages/contracts` の入力スキーマで検証し、受信後も出力スキーマで検証してから stdout に 1 つの JSON を書く。`--pretty` は出力をインデントする。
- グローバルオプションは `--agent-id`（既定 `cli`）、`--data-dir`、`--socket`、`--timeout`（1 要求のタイムアウト。読み取り・変更の両方に適用）。解決順は MCP と同じく、引数、環境変数（`KAKEAI_AGENT_ID` / `KAKEAI_DATA_DIR` / `KAKEAI_SOCKET`）、プラットフォーム既定の順である。`--help` は種別ごとの操作一覧、`--version` はバージョンを返す。
- `--out <path>` は画像を返す操作（`preview.frame` / `preview.scriptFrame` / `preview.assetFrame` / `preview.thumbnail` / `thumbnail.image`）だけで使える。指定時は画像バイトをそのファイルに書き、stdout JSON は `pngBase64` / `imageBase64` を除いて `path` を付す。書込み失敗は `CLI_OUTPUT_ERROR`（終了コード1）で、入力・出力の契約検証後にだけ書く。
- 長尺操作は `job.wait <jobId>` または `asset.import` / `render.start` / `tts.create` / `tts.createBulk` の `--wait` で待てる。どちらも MCP と同じ `jobWaitInputSchema` と `waitForJob` を使い、`--timeout-ms`（既定 60000、最大 600000）と `--interval-ms`（既定 500、10〜30000）を受ける。`job.wait` は `{ job, timedOut, polls }` を返し、予算超過は成功（終了コード 0）で `timedOut: true` とする。`--wait` は操作結果を `{ result, wait }` に包み、Job を投入しなかった場合（`asset.import` の重複）と複数 Job を投入した場合（`tts.createBulk`）は `wait: null` とする。後者は Job ID ごとに `job.wait` するか `job.get` で確認する。
- 失敗は stderr に `{ code, issues? }` の 1 行 JSON だけを書き、スタックトレースや自由文を出さない。stdout は常にコマンド出力専用である。終了コードは、`0` が成功（help・version・`operations` を含む）、`1` が操作または契約検証の失敗と応答の出力失敗（`--out` の書込み失敗など。code は `CLI_OUTPUT_ERROR`）、`2` が使い方または `--input` の誤り（`CLI_USAGE_ERROR` / `CLI_INPUT_ERROR`）である。CLI 自身の想定外の失敗は `CLI_INTERNAL_ERROR`（終了コード 1）とし、詳細を返さない。
- MCP と同じく、実体削除と外部サービスへの公開は CLI にも公開しない。生成操作は利用者が設定した接続先だけを使い、接続先・認証情報・Adapter 設定の読み書きは公開しない。Composition の publish は Kakeai 内の不変版の追加であり、外部公開ではない。
- 束縛間で共有する実装は `@kakeai/agent-client` に置く。`jobWaitInputSchema`・`waitForJob`・`createJobGetter` と、`{ code, issues? }` の整形（`zodIssues`・`bindingErrorPayload`）を MCP と CLI が共有し、ポーリングやエラー整形を複製しない。

## スキル

- リポジトリの `skills/kakeai-production/` と `skills/kakeai-composition/` に、外部エージェント向けの手順書（スキル）を置く。`kakeai-production` は台本・キャラクター・素材・Cue・TTS・検証・レンダーをまたぐ制作フロー、`kakeai-composition` は再利用する Composition の authoring を扱う。
- スキルは束縛ではない。実行時の入口は MCP または CLI のままとし、スキルはその操作の呼び出し順と判断点だけを定める。HTTP API・ローカルソケット・Prisma を直接使う手順を書かない。
- テンプレート契約・操作の入出力スキーマをスキルへ複製しない。`schema.get`、`template.get`、MCP の `inputSchema` / CLI の検証を正とする。
- 配布元は本リポジトリだけとし、GitHub Release と対になる `vMAJOR.MINOR.PATCH` の不変タグからのみ導入する。`main` やその他の可変 ref を導入元にしない。タグは Kakeai アプリとスキルの共通バージョンであり、初回公開版は `v0.1.0` とする。root・CLI・MCP の `package.json` は当面 `0.0.0` のままとし、リリース版はタグで識別する（[ADR 0087](../adr/0087-agent-skills-distribution.md)）。
- 導入・ロック・配置・復元は `skills@1.7.4` に委譲し、独自の installer や lock 形式を作らない。代表コマンドは `npx skills@1.7.4 add shipwebdotjp/kakeai#v0.1.0 --skill kakeai-production --skill kakeai-composition` である。プロジェクト導入は `skills-lock.json` を Git 管理し、`.agents/` は再生成対象として Git 管理しない。グローバル導入（`-g`）は `skills-lock.json` を作らない。
- 更新は `skills update` で可変 ref に追従させず、新しいタグを指定して同じ `add` を再実行する。復元は `skills@1.7.4` の `experimental_install` を使う。この版に `install` コマンドはない。
- 各公開タグの互換性は [スキル互換性履歴](./skill-compatibility.md) に記録する。対応リリース、含まれるスキル、必須の正規操作、互換性上の注意だけを書き、操作スキーマ・Template 契約・ダイジェスト値は複製しない。
- リリースは手動起動の workflow で行い、版の形式、互換性履歴の当該版エントリ、型検査、全テスト、スキル発見を確認した後、同じコミットから注釈付きタグと GitHub Release を作る。`v*` タグの更新・削除はリポジトリ設定で禁止する。
- リポジトリの Node.js 要件は `>=22.20.0` とし、`.npmrc` の `engine-strict` でインストール時に強制する。`skills@1.7.4` をスキル発見確認用の固定開発依存に置く。アプリは実行時に `skills/` を読みに行かない。
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
- 1 要求の最大ペイロードは 32 MiB（改行を含むバッファ長）とし、超えた場合は `AGENT_PAYLOAD_TOO_LARGE` を返して接続を閉じる。読み取り操作のタイムアウトは原則 10 秒、画像を返すプレビューとサムネイル（`preview.frame` / `preview.scriptFrame` / `preview.assetFrame` / `preview.theme` / `preview.thumbnail` / `thumbnail.image`）と `font.list` は 30 秒、`theme.diagnose` は 60 秒、変更操作は 120 秒とし、サーバー側でも `AGENT_REQUEST_TIMEOUT` を返して接続を閉じる。`theme.diagnose` が長いのは、既定の `verify: true` が Chromium で local face の解決可否を確認するためである。クライアントも同じ時間で打ち切る。タイムアウトは処理の中断を保証しない。`script.edit` は `requestId` で冪等に再送できる。高コスト操作（`tts.create` / `tts.createBulk` / `render.start` / `composition.publish`）も任意の `requestId` で冪等化され、再送しても Job や Version が増えない。それ以外の変更操作は自動再送せず、`job.list`・`script.get`・`composition.get` などで結果を確認してから必要なら再実行する。
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

- `schema.get` — 現在の `contentSchemaVersion`、各 VisualTemplate の `inputFields`・layer・transition・animation の制約、操作カタログ、Asset 種別と用途の制約、警告コードを返す。`schemaDigest` を含め、アプリ更新による変化を検知できるようにする。エージェントが値を推測しないための必須操作。`schemaDigest` はスキーマ関連データを正規化した非暗号の安定フィンガープリント（`fnv1a64:` 接頭辞）であり、意味が変わらなければ同一値を返す。`operations` は台本編集の `ScriptOperation` カタログ（名前とカテゴリ）を従来どおり返し、`agentOperations` は束縛が公開してよい全 Agent 操作のカタログ（`name`、`kind` の `read` / `mutation`、Job を返す `longRunning`）を返す。`agentOperations` は読み取り・変更の分類リストから導出し、束縛ごとに第二の操作一覧を持たない。`operationDigest` は全 Agent 操作の入出力スキーマを正規化した契約のダイジェストで、操作の入力・出力が変わると必ず変化する。`minProtocolVersion` は対応するプロトコル版の下限、`protocolVersion` は上限（対応版）である。テンプレートごとの入力 JSON Schema と入力例は応答に含めず、`template.get` で必要な1件だけを取得する。サムネイルテンプレートの入力契約も応答には含めず、`thumbnail.listTemplates` で取得する。`schemaDigest` はそれらも含むため、テンプレート入力の変更でも変化する。
- `template.get` — VisualTemplate 1件の入力契約を `{ id, version }` で取得する。`inputSchema` はそのテンプレート定義の `inputSchema`（保存時検証と同じ Zod スキーマ）を `toAgentJsonSchema` で変換した JSON Schema（draft 2020-12。`$schema` は付けない）で、`example` は同じスキーマを通ることがテストで固定された入力例である。入力の正はテンプレート定義の `inputSchema` ひとつで、Agent 向けの第二のスキーマは持たない。`id` / `version` は `schema.get` の `templates` から取り、存在しなければ `RESOURCE_NOT_FOUND` とする。`inputFields` を持たないテンプレートでも取得できる。`example` の ID は `<assetId>` のようなプレースホルダなので、実在する ID に置き換えて使う。
- `work.list` / `work.get` — `work.list` は更新日時の降順で Work を返す。`createdAt` と `parentWorkId` を含むため、タイムアウト後に作成済みかを確認できる（後述）。
- `script.get` — `scriptVersionId` を指定するとその版、`languageEditionId` を指定するとその Edition の current の `ContentDocument` と帰属を返す。どちらか一方を必須とする。
- `script.listVersions` — `{ languageEditionId }` を受け、Edition の Script Version 履歴を `versionNumber` の降順で返す。応答は `{ languageEditionId, currentScriptVersionId, scriptVersions }` で、各要素は版番号・作成者・要求 ID・復元元（`sourceScriptVersionId`）・作成日時を持つ要約であり、`ContentDocument` は含めない。Edition が存在しなければ `WORK_NOT_FOUND`。件数は全件で、ページングは履歴が大きくなった時点で追加する。
- `script.validate` — 保存せずに検証する。`{ content }` または `{ baseScriptVersionId, operations }` を受け、`warnings` と解決済み `timeline` を返す。書込みを行わない。
- `script.subtitles` — 保存済み Script Version の SRT 字幕を返す（[ADR 0103](../adr/0103-agent-subtitles-and-artifact-path.md)）。`{ scriptVersionId }` を受け、`{ scriptVersionId, filename, mimeType, byteSize, srt }` を返す。生成は HTTP の `GET /script-versions/:id/subtitles` と同じ `buildSrt` で、タイミングは焼き込み字幕と同じ `resolveTimeline` を使う。Artifact・Job・版を作らない。タイムラインを解決できない場合は `RENDER_INPUT_INVALID`、版が存在しない場合は `RESOURCE_NOT_FOUND`。`byteSize` は `srt` の UTF-8 バイト長である。
- `asset.list` — 素材を検索し、`{ assets, nextCursor, total }` の1ページを返す。`total` は同じ絞り込み条件に一致する素材の総数で、同一条件のどのページでも同じ値になる。
  - 絞り込みは `kind`・`status`・`filename`（大文字小文字を区別しない部分一致）・`tags`（`tagMode` で AND / OR を明示）・`favorite`・`archived`（既定は除外）・`hasAudio`・`durationMinMs` / `durationMaxMs` を組み合わせる。`durationMinMs` / `durationMaxMs` は0以上のミリ秒で、長さを持たない素材（`durationMs` がnull）は範囲に一致しない。下限が上限より大きい場合は `VALIDATION_ERROR` とする。
  - 寸法は `widthPx` / `heightPx`（完全一致）と `widthMinPx` / `widthMaxPx` / `heightMinPx` / `heightMaxPx`（両端を含む範囲）で絞り込む。完全一致と範囲は併用でき、すべて AND で評価する。寸法を持たない素材（音声など）は完全一致にも範囲にも一致しない。範囲の逆転、または完全一致が指定範囲の外にある指定は、一致0件ではなく `VALIDATION_ERROR` とする。Face Set の顔レイヤーと同じ寸法の画像を探す用途に使う（[ADR 0105](../adr/0105-agent-asset-dimension-filters.md)）。
  - タグの照合は `Asset.tagsJson` の要素として DB 側のクエリで行う。`tagMode: "and"` は指定したタグすべてを持つ素材、`"or"` はいずれか1つを持つ素材が一致する。タグは引用符で囲まれた要素として保存されるため `bgm` は `bgm_loop` に一致しない。照合は要素の完全一致で、ASCII の英字は大文字小文字を区別せず（`Summer` は `summer` に一致する）、非ASCII（日本語など）は区別する。`%` と `_` はタグ文字列のままではワイルドカードとして解釈されず通常の文字として扱われるため、これらの文字を含むタグの検索はそのタグを持つ素材にだけ一致する。
  - 並び順は `sort` で指定する。`createdAt_desc`（既定、`createdAt` 降順・`id` 降順）、`createdAt_asc`（昇順）、`filename_asc`（ファイル名のバイト順）、`duration_asc`（長さの昇順。長さを持たない素材是最後）。いずれも（ソート列, `id`）の2段で固定し、同じ値を持つ行がページをまたいでも重複も欠落も起こさない。
  - `cursor` は前ページの `nextCursor` をそのまま渡す不透明値で、ソート列と `id` を含む。別の `sort` で使うと `VALIDATION_ERROR`（issue path は `["cursor"]`）となり、黙って別の並び順として解釈することはない。壊れた cursor も同じ `VALIDATION_ERROR` とする。`limit` は既定50、最大100。
  - HTTP、ソケット、MCP、CLIは同じ契約を使う。
- `asset.get` — Asset 1件を返す。
- `composition.list` / `composition.get` / `composition.draft.get` / `composition.authoringContext`
- `character.list` / `character.get` — キャラクターライブラリの読み取り（後述）。
- `theme.list` / `theme.get` — Visual Theme の読み取り。`theme.list` は `{}` を受け、`{ themes: [{ id, name, isBuiltIn, version }] }` を返す。利用者 Theme はアーカイブされておらず公開済み Revision を持つものだけを対象とし、各 Theme の最新公開 Revision だけを返す。組み込み Theme も含む。`theme.get` は `{ themeId, version? }` を受け、`{ theme: { id, name, isBuiltIn, version, definition } }` を返す。`version` を省略すると `theme.list` に載る最新公開 Revision を返す。`version` を指定すると、その公開 Revision を返す。このときはアーカイブ済み Theme の Revision も読める（既存の Script Version が参照している場合があり、レンダーでも解決されるため）。Theme Draft と存在しない Revision は `RESOURCE_NOT_FOUND` とする。一覧はページングしない。
- `theme.diagnose` — Theme Revision のフォント診断を返す。`{ themeId, version?, locale?, verify? }` を受け、`{ diagnosis: { themeId, version, locale, catalogSupported, verificationSupported, verificationReason, roles, missingFonts, diagnostics } }` を返す。`version` の解決規則は `theme.get` と同じ。`locale` は既定 `ja-JP` で、`fontFaceByLocale` の解決に使う。`verify` は既定 `true` で、レンダー投入時と同じく Chromium が local face を解決できるかまで確認する。`false` なら Font Catalog との照合だけを行う。`roles` は文字 role ごとの解決済み local face と `usesFallback`、`missingFonts` は解決できなかった family、`diagnostics` は人が読める説明である。カタログが使えない platform でもエラーにせず `catalogSupported: false` と理由を返す。存在しない Theme Revision は `RESOURCE_NOT_FOUND`。
- `theme.create` / `theme.draft.get` / `theme.draft.save` / `theme.publish` — Theme の作成と Draft 編集、公開（[ADR 0101](../adr/0101-agent-theme-authoring-and-preview.md)）。`theme.create` は HTTP と同じ `{ name, sourceThemeRef? }` を受け、`{ themeId, draft }` を返す。`sourceThemeRef` を省略すると組み込み Soft Editorial を複製元にする。`theme.draft.get` は `{ themeId }` を受け、`{ draft }` を返す。Draft が無い場合と組み込み Theme は `draft: null`、未知の Theme は `RESOURCE_NOT_FOUND`。`theme.draft.save` は `{ themeId, definition }` を受け、`{ draft }` を返す。Draft は upsert で、公開 Revision を変えず版も消費しない。`theme.publish` は `{ themeId }` を受け、公開した Revision を `{ theme }` で返す。公開時に Draft は破棄され、Draft が無い場合は `INVALID_STATE`。Theme のアーカイブと削除は公開しない。`create` と `publish` は `requestId` を持たないため、タイムアウト後は `theme.list` / `theme.draft.get` / `theme.get` で状態を確認してから再実行する。
- `font.list` — インストール済みフォントの一覧を、検索とページング付きで返す。`{ query?, style?, minWeight?, maxWeight?, available?, limit?, offset? }` を受け、`{ fonts: FontFace[], total, nextOffset, catalog: { supported, reason, updatedAt } }` を返す。`query` は family・表示名・PostScript 名の部分一致（ASCII の大小文字を区別しない）、`style` は `normal` / `italic` / `oblique`、`minWeight` / `maxWeight` は 0〜1000 の整数である。`minWeight` が `maxWeight` より大きい場合は `VALIDATION_ERROR`。並び順は family → weight → style → PostScript 名で固定する。`limit` は既定 50・最大 200、`offset` は 0 以上で、`total` は絞り込み後の件数、`nextOffset` は次ページの offset（無ければ null）である。`fontFace` を組み立てるときに使い、フォントカタログ全体を一度に返さない。
- `faceSet.list` / `faceSet.get` — Face Set ライブラリの読み取り。`faceSet.list` は `{}` を受け、`{ faceSets: FaceSet[] }` を返す。`faceSet.get` は `{ faceSetId, version? }` を受け、`{ faceSet: FaceSet }` を返す。`FaceSet` は `id`・`name`・`version`・`layers`・`expressions`・`createdAt` / `updatedAt` を持つ既存 DTO である。一覧は最新版を返し、ページングしない。`version` を省略すると最新版を返す。作品の表情を編集するときは、`script.get` の外観にある `faceSetVersion` を渡して固定版を読む。存在しない `faceSetId` または版は `RESOURCE_NOT_FOUND` とする。
- `voiceAdapter.list` — 利用可能な TTS Adapter の種別を返す（[ADR 0102](../adr/0102-agent-voice-adapter-descriptors.md)）。`{}` を受け、`{ adapters: [{ id, label, defaultLocale, voiceSelection, modelSelection }] }` を返す。`voiceSelection` は `list` または `list-or-manual`。`voiceProfile.listVoices` / `voiceProfile.listModels` / `voiceProfile.create` の `adapterId` 選びに使う。接続先 URL・環境変数名・認証情報は返さず、Adapter 設定の読み書きは公開しない。
- `voiceProfile.list` / `voiceProfile.get` — Voice Profile の読み取り。`voiceProfile.list` は `{}` を受け、`{ voiceProfiles: VoiceProfile[] }` を返す。`voiceProfile.get` は `{ voiceProfileId }` を受け、`{ voiceProfile: VoiceProfile }` を返す。`VoiceProfile` は `id`・`name`・`adapterId`・`voiceId`・`locale`・`settings`・`createdAt` / `updatedAt` を持つ既存 DTO である。一覧はページングしない。存在しない `voiceProfileId` は `RESOURCE_NOT_FOUND` とする。
- `voiceProfile.listVoices` / `voiceProfile.listModels` — 声・モデル候補の読み取り。`listVoices` は `{ adapterId, model? }` を受け、`{ adapterId, voices }` を返す。`model` は `modelSelection` を持つアダプター（`openai-compatible`）の絞り込みに使い、`list` 型アダプター（`voicevox` / `aivisspeech`）では無視される。`listModels` は `{ adapterId }` を受け、`{ adapterId, models }` を返す。いずれも HTTP の声・モデル一覧と同じサービスを使い、Adapter へ接続できない場合は `TTS_ENGINE_UNAVAILABLE` とする。
- `voiceProfile.create` / `voiceProfile.update` — Voice Profile の作成・更新（[ADR 0088](../adr/0088-agent-voice-profile-writes.md)）。`create` は HTTP の作成契約と同じ `{ name, adapterId, voiceId, locale, settings }` を受け、`{ voiceProfile }` を返す。`voiceId` は `listVoices` で実在を確認して選び、`locale` は使う台本の locale と完全一致させる（導出は行わない）。`settings` はアダプター固有の追加分だけを持ち、`openai-compatible` では `model` が必須である。参照音声（参照クローン）を使う場合は `refAudioAssetId`（取り込み済み音声 Asset の ID）・`langCode` を加え、`refText`（付けると ICL 方式、省略すると x-vector 方式）・`maxTokens` は任意である。`update` は `{ voiceProfileId, name, voiceId, locale, settings }` を受け、`{ voiceProfile }` を返す。`adapterId` は変更できない。存在しない `voiceProfileId` は `RESOURCE_NOT_FOUND` とする。更新は以後の TTS にだけ影響し、既存の Audio Take は変えない。削除は公開せず、人専用のまま残す。`create` は `requestId` を持たないため、タイムアウト後は `voiceProfile.list` で `name` と `createdAt` を確認してから再実行する。
- `job.get` / `job.list` — `job.list` は `{ workId, kind? }` を受け、`kind` は `render`（既定）または `tts` を選ぶ。`asset_ingest` は Work に紐づかないため指定できず、指定すると `VALIDATION_ERROR` になる。
- `artifact.get` — `{ artifactId }` を受け、`{ artifact, filePath }` を返す（[ADR 0103](../adr/0103-agent-subtitles-and-artifact-path.md)）。`filePath` はアプリのデータルート内にある実ファイルの絶対パスで、`resolveArtifactContent` が実在と記録済み `byteSize` の一致を検証する。MP4 は `role: "render"` / `format: "mp4"` の Artifact で、ID は `job.get` / `job.list` から取る。バイトは返さない。`artifact.contentUrl` はブラウザ用で media session Cookie が必要なため、エージェントは `filePath` を使う。Artifact 行が無い、ファイルが欠損している、またはサイズが記録と一致しない場合は `RESOURCE_NOT_FOUND`。
- `artifact.export` — `{ artifactId, outputDir, filename? }` を受け、`{ artifact, sourcePath, exportedPath }` を返す（[ADR 0104](../adr/0104-agent-artifact-export.md)）。正本はデータルートに残したまま、`outputDir`（存在する絶対ディレクトリ）へコピーする。`filename` はパス区切りを含まない basename で、Artifact の拡張子（mp4 / png / jpg / jpeg / vtt）に一致しなければならない。省略時は Work タイトルと Artifact ID から `<title>-<artifactId>.<ext>` を生成する。既存ファイルは上書きせず `EXPORT_TARGET_EXISTS` を返す。コピーは copy-on-write の複製を使い、同一ディレクトリ内の一時ファイルからハードリンクして原子的に公開する（ハードリンクを持たないファイルシステムでは排他的コピーにフォールバックする）。`outputDir` が相対パス・非ディレクトリ・不存在なら `VALIDATION_ERROR`、コピーに失敗したら `EXPORT_FAILED`。`outputDir` は同一ユーザー信頼モデルのもとで任意の絶対パスを許可し、アプリの許可リストは設けない。書き出したコピーはアプリの管理外で、Artifact の削除や保持期間の掃除では消えない。大きなファイルのコピーは変更操作の120秒を超えることがある。タイムアウトしても処理は中断されないため、`exportedPath` の有無を確認し、無ければ同じ入力で再実行する。
- `preview.frame` — render 成果物（`role: "render"`・`format: "mp4"` の Artifact）の指定時刻（`timeMs`）の静止画を原寸 PNG（base64）で返す。時刻解決とキャッシュは既存の静止画抽出の規則を再利用する。詳細は [../visual-confirmation/spec.md](../visual-confirmation/spec.md) を正とする。
- `preview.scriptFrame` — 保存済み ScriptVersion を、Web UI と同じコンパイラの HTML から headless でシークし、指定時刻（`timeMs`）の原寸 PNG（base64）で返す。版・Job・Artifact は作らない。`timeMs` は解決済み尺以下。コンパイル不能は `PREVIEW_INPUT_INVALID`、描画失敗は `INTERNAL_ERROR`。render 前の構図確認用で、最終的な品質判断は人に残す。
- `preview.assetFrame` — Asset 1件の絵を返す。画像は原本（正規化 rendition があればそれ）のバイトと MIME、動画は指定時刻（`timeMs`、既定0）の PNG 静止画、音声は `VALIDATION_ERROR`。画像は `timeMs` を指定できない。巨大な画像は `VALIDATION_ERROR`。
- `preview.theme` — 未保存の Theme 定義を代表サンプルでレンダーし、PNG（base64）を返す。`{ definition, locale?, timeMs? }` を受け、`{ themeId, version, locale, requestedTimeMs, durationMs, width, height, mimeType, imageBase64 }` を返す。`locale` は既定 `ja-JP`、`timeMs` は既定 4500（4秒の導入に続く要点シーンで、見出し・本文・ラベル・字幕が同時に見える時刻）。`timeMs` が代表サンプルの解決済み尺を超える場合は `VALIDATION_ERROR`。DB・Theme Draft・Revision・Job・Artifact は作らない。色・余白・フォントの見え方の確認用で、フォントの解決可否は `theme.diagnose` を使う。

サムネイルは、候補の作成・更新・primary 選択・未保存プレビュー・PNG 取得を公開する（[ADR 0098](../adr/0098-agent-thumbnail-operations.md)）。

- `thumbnail.listTemplates` — 同梱サムネイルテンプレートの一覧を返す。サムネイルテンプレートは VisualTemplate とは別レジストリのため `schema.get` には含めず、この操作だけがカタログになる。各要素は `id`・`version`・`display`（`label` / `description`）・`inputSchema`（保存時検証と同じ Zod スキーマを `toAgentJsonSchema` で変換した JSON Schema）・`example`（そのまま保存検証を通る入力）を持つ。`example` の `<...>` は実在する画像 Asset の ID に置き換える。サムネイルテンプレートの入力契約は `schemaDigest` に含まれる。
- `thumbnail.list` — `{ languageEditionId }` を受け、`{ thumbnails }` を返す。各候補は HTTP と同じ `Thumbnail` DTO で、`isPrimary` と `appearanceOverride` を含む。存在しない言語版は `WORK_NOT_FOUND`。
- `thumbnail.get` — `{ thumbnailId }` を受け、`{ thumbnail }` を返す。存在しない ID は `RESOURCE_NOT_FOUND`。
- `thumbnail.appearance` — `{ languageEditionId }` を受け、言語版共通 Appearance を `{ appearance, defaults, resolved }` で返す。`appearance` は保存済みの疎な上書き（無ければ null）、`defaults` は Theme と locale から解決した既定値、`resolved` は両者をマージした解決済みの値である。共通 Appearance の保存は公開せず、人専用のまま残す。
- `thumbnail.create` — `{ languageEditionId, label, template, input }` と任意の `appearanceOverride` を受け、`{ thumbnail }` を返す。HTTP の作成と同じ入力で、`input` はテンプレートの `inputSchema` で検証し、背景・前景は ready な画像 Asset でなければならない。最初の候補は自動で primary になる。
- `thumbnail.update` — `{ thumbnailId, label, template, input }` と任意の `appearanceOverride` を受け、`{ thumbnail }` を返す。HTTP の明示保存と同じ last-write-wins で、候補に版履歴はない。存在しない ID は `RESOURCE_NOT_FOUND`。
- `thumbnail.setPrimary` — `{ languageEditionId, thumbnailId }` を受け、選んだ候補を `{ thumbnail }` で返す。`thumbnailId: null` で解除し、そのとき `thumbnail` は null になる。同じ言語版に属さない候補と存在しない候補は `RESOURCE_NOT_FOUND`。
- `preview.thumbnail` — 未保存のドラフト（`languageEditionId`・`template`・`input`・任意の `appearanceOverride`・任意の `appearance`）を 1280x720 の PNG にする。`appearance` を省略すると保存済みの言語版共通 Appearance を使い、null なら使わない（HTTP のプレビューと同じ規則）。DB へは書かず、版・Job・Artifact も作らない。
- `thumbnail.image` — 保存済み候補の PNG（1280x720）をオンデマンドで生成し、`{ thumbnailId, filename, width, height, mimeType, pngBase64 }` を返す。Job・Artifact は作らず、ファイルも永続化しない。存在しない ID は `RESOURCE_NOT_FOUND`。
- サムネイル候補の削除、言語版共通 Appearance の保存、外観プリセットの読み書きは公開しない。不要な候補の整理は人が UI で行う。`requestId` は持たず、冪等台帳に載せない。タイムアウト後は `thumbnail.list` の `label` と `createdAt` で結果を確認してから再実行する。

可逆な変更:

- `work.create` — Work、指定 locale（既定は `ja-JP`）の LanguageEdition、その locale の初期 ContentDocument を持つ初期 ScriptVersion を [../mvp/spec.md](../mvp/spec.md) の作成規則で作る。初期 ContentDocument の `locale` は Edition の `originalLocale` と一致する。
- `work.update` — Work の管理上の作品名 `title` を変更する。動画内に表示するタイトルは ContentDocument 側の Scene スロットであり、これとは別である（[../mvp/api-contract.md](../mvp/api-contract.md) の `PATCH /works/:workId` と同じ規則）。
- `work.clone` — 元 Work の現在版から子 Work を作る。引数は `{ workId, title }`。HTTP の `POST /works/:workId/clone` と同じ規則で、元 Work の `originalLocale` の Edition（無ければ先頭の Edition）の current Script Version だけをコピーする。子 Work は `parentWorkId` を持ち、初期版は `sourceScriptVersionId` に複製元を記録する。他の Edition、版履歴、Job、Artifact、サムネイルは複製しない。Agent 経由の初期版は `author: "agent"` / `authorAgentId` になる（HTTP は `human`）。`requestId` を持たず、タイムアウト後は `work.list` で `parentWorkId`・`title`・`createdAt` を確認してから再実行する。存在しない Work は `WORK_NOT_FOUND`。
- `edition.create` — 既存 Work に言語版を追加する。引数は HTTP の `POST /works/:workId/language-editions` と同じ（`workId`、`locale`、`sourceEditionId`）。初期版はシード元 current のコピーに置き換え規則を適用したもの（[../multilingual-editions/spec.md](../multilingual-editions/spec.md)）。重複 locale は `LANGUAGE_EDITION_EXISTS`、他 Work の Edition は `WORK_NOT_FOUND` とする。
- `script.save` — `languageEditionId` と全 `ContentDocument` を受け、検証して新しい Script Version を追加し current を進める。任意の `baseScriptVersionId`（基準版ガード）と `sourceScriptVersionId`（同じ Edition の復元元）も受け付ける（後述）。全体の置換や取り込み向けであり、通常の編集は `script.edit` を使う。
- `script.edit` — 基準版と `ScriptOperation` の配列を受け、操作コアで一括適用し、保存検証を通して新しい Script Version を追加する。1 呼び出しは 1 版とし、途中失敗時は版を作らない。
- `script.restore` — 過去の Script Version を新しい版として復元する。`{ scriptVersionId, baseScriptVersionId?, requestId, authorAgentId? }` を受け、復元元の `ContentDocument` をサーバー側で読み、保存検証を通して新しい版を追加する。呼び出し側は ContentDocument を送らない。復元元の Edition にだけ保存し、新しい版の `sourceScriptVersionId` に復元元を記録する。復元元が current の場合は `VALIDATION_ERROR`。`requestId` は必須で、同じ ID・同じ復元元の再送は既存の版を返す（`replay: true`）。異なる復元元・基準版で同じ ID を使うと `IDEMPOTENCY_CONFLICT`。`baseScriptVersionId` は任意の基準版ガードで、省略時は last-write-wins（[ADR 0021](../adr/0021-script-save-last-write-wins.md)）。
- `asset.import` — 後述の手順で Asset を取り込む。
- `asset.tag` — Asset のタグを更新する。
- `composition.create` / `composition.draft.save` / `composition.publish` — Composition Library の authoring（[../composition-library/spec.md](../composition-library/spec.md)、[../visual-skins/spec.md](../visual-skins/spec.md)）。publish は `dryRun` を受け付ける。
- `render.start` — 対象版と ready な素材から render Job を投入する。
- `tts.create` — 保存済み台本版の 1 セリフについて、利用者が設定済みの TTS Adapter へ合成 Job を投入する（後述）。
- `tts.createBulk` — 保存済み台本版の要点シーンで音声が未選択のセリフへ、まとめて合成 Job を投入する（後述）。
- `tts.attachBulk` — `requestId` 付きで開始した一括生成の結果を確定し、成功 Job だけを一つの Script Version へ添付する（後述）。短時間の操作で Job 待機の対象にしない。
- `job.cancel` — queued の Job をキャンセルする。
- `thumbnail.create` / `thumbnail.update` / `thumbnail.setPrimary` — サムネイル候補の作成・明示保存・primary 選択（前述）。

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

声だけの話者を作る場合は、`speaker.add` と `line.add` を同じ呼び出しに入れ、作成した Speaker を `{ key }` で参照できる。

```jsonc
{
  "baseScriptVersionId": "scr_003",
  "requestId": "edit-2026-10-25-001",
  "operations": [
    { "op": "speaker.add", "key": "speaker-1", "name": "ナレーション", "voiceProfileId": "vp_001" },
    { "op": "scene.add", "kind": "point", "key": "scene-1" },
    { "op": "line.add", "sceneId": { "key": "scene-1" }, "speakerId": { "key": "speaker-1" }, "captionText": "最初の要点です。" }
  ]
}
```

- `baseScriptVersionId` は必須とし、Edition の current と一致しなければ `SCRIPT_BASE_STALE`（409）で拒否する。相対操作を古い文書へ適用して別の要素を壊さないため、ここだけ last-write-wins の例外とする。UI の全体保存は従来どおり last-write-wins のままとする。
- `requestId` は必須とし、同じ Edition で同じ値の版が既にあれば操作を再適用せず、その版を返す（`replay: true`）。再送で版や Job を増やさない。同じ `requestId` で基準版または操作内容が異なる場合は `IDEMPOTENCY_CONFLICT` とするため、要求内容のハッシュも版に保存する。
- 操作は配列順に適用する。作成操作の `key` は同一呼び出し内の後続操作から `{ "key": "..." }` で参照できる。
- 成功時は新しい Script Version、作成した ID、`warnings`、解決済み `timeline` を返す。`script.get` の往復を省略できる。`replay: true` の応答は `created` を復元しないため空になる。`speaker.add` だけを行った呼び出しがタイムアウトした場合は、再送で版は増えないが作成 ID は返らないので、`script.get` で新しい Speaker を確認する。
- Speaker は `speaker` カテゴリの操作で編集する。`speaker.add`（`{ name, voiceProfileId, key? }`）は `characterId: null` の Speaker を作り、作成 ID は `created.speakerIds` で返す。`speaker.setVoiceProfile`（`{ speakerId, voiceProfileId }`）は既存 Speaker の声を変更し、`voiceProfileId: null` で解除する。`line.add` / `line.setSpeaker` の `speakerId` は ID または `{ key }` を受け付け、`null` も指定できる。`scene.add.lines[].speakerId` は ID だけを受け付ける。
- Voice Profile は実在し、`locale` が `ContentDocument.locale` と完全一致しなければならない。Character を持つ Speaker は、その Character の文書 locale の Voice と一致する場合だけ設定できる。Character に文書 locale の Voice が無い場合は非 null の割り当てを拒否し、`null` への解除だけを許す。Character に Voice がある場合は `null` にできない。参照先の Speaker または Profile が無い場合は `EDIT_TARGET_NOT_FOUND`、locale または Character Voice の不一致は `EDIT_PRECONDITION_FAILED` とする。声の変更は以後の TTS にだけ影響し、既存の Audio Take は変えない。
- `line.setSpeaker` で `null` または `characterId: null` の Speaker に変えると `expressionId` は自動で `null` になる。`line.add` は声だけの Speaker に明示的な `expressionId` を指定すると拒否し、`line.setExpression` も声だけの Speaker には指定できない。
- `document.setVisualTheme` は、組み込み Theme の最新 Revision と、アーカイブされていない利用者 Theme の最新公開 Revision だけを選べる。`script.save` は Theme の変更がアーカイブ済みまたは最新でない Revision を指す場合に拒否するが、Theme を変更しない保存は許可する（アーカイブ済み参照のままでも保存できる）。`script.restore` は古いアーカイブ済み Theme 参照を保持する。既存 Script Version に対する `script.edit` は、Theme を変更しない限り継続できる。
- 操作コアのエラーは `EDIT_*` のまま返し、保存検証の `VALIDATION_ERROR` と区別する。

### `script.save` の契約

```jsonc
{
  "languageEditionId": "led_001",
  "content": { "...": "ContentDocument" },
  "baseScriptVersionId": "scr_003",
  "sourceScriptVersionId": "scr_001"
}
```

- `baseScriptVersionId` は任意である。省略時は HTTP の保存と同じ last-write-wins で、Edition の current を新しい版へ進める。指定時はその版が Edition の current と一致する場合だけ保存し、一致しなければ `SCRIPT_BASE_STALE`（409）で版を作らない。存在しない版は `WORK_NOT_FOUND`、別 Edition の版は `VALIDATION_ERROR` とする。
- `sourceScriptVersionId` は任意で、省略時は `null`。HTTP の保存と同じく、同じ Edition の版だけを復元元として受け付け、別 Edition や存在しない版は `VALIDATION_ERROR`（issue path は `["sourceScriptVersionId"]`）とする。
- Theme の変更は、組み込み Theme の最新 Revision またはアーカイブされていない利用者 Theme の最新公開 Revision だけを選べる。Theme を変更しない保存は、参照中の Theme がアーカイブ済みでも許可する。`script.restore` は復元元の参照をそのまま保持する。
- `authorAgentId` は `script.edit` と同じく任意で、省略時は接続の `agentId` を使う。
- `requestId` は持たない。再送の冪等化は `script.edit` / `script.restore` と TTS 系の操作の対象であり、`script.save` は版単位の冪等化を行わない。

### `script.restore` の契約

```jsonc
{
  "scriptVersionId": "scr_001",
  "baseScriptVersionId": "scr_003",
  "requestId": "restore-2026-10-24-1",
  "authorAgentId": "mcp"
}
```

- `scriptVersionId` は復元元の版で必須。対象 Edition は復元元から決まり、別の Edition を指定する入力は持たない。存在しない版は `WORK_NOT_FOUND`（issue path は `["scriptVersionId"]`）。
- 復元元の `ContentDocument` はサーバーが読み、HTTP の保存と同じ検証を通して新しい版にする。呼び出し側は ContentDocument を送らない。
- 復元元が current の場合は `VALIDATION_ERROR`（issue path は `["scriptVersionId"]`）。既存版は変更せず、新しい版の `sourceScriptVersionId` に復元元を記録する。
- `baseScriptVersionId` は任意の基準版ガード。指定時は同じ Edition の版でなければ `VALIDATION_ERROR`、current と一致しなければ `SCRIPT_BASE_STALE`。省略時は last-write-wins（[ADR 0021](../adr/0021-script-save-last-write-wins.md)）。
- `requestId` は必須。同じ Edition・同じ `requestId` の版が既にあれば、同じ `{ scriptVersionId, baseScriptVersionId }` のときはその版を返し `replay: true`、異なる入力では `IDEMPOTENCY_CONFLICT`。`authorAgentId` は要求ハッシュに含めない。
- 成功時は `{ scriptVersion, warnings, replay }` を返す。`script.edit` と同じく、同時実行で競合した場合は既存の要求版を読み直して replay する。

### Work 作成・複製の回復

`work.create` / `work.clone` は operation の `requestId` を持たない。トランスポートの `requestId` は応答の対応づけ用であり、再送の重複排除ではない。

- `work.create` が `AGENT_REQUEST_TIMEOUT` になったら、再実行せず `work.list` を呼び、同じ `title` かつ `createdAt` が要求時刻以降の Work を探す。1件ならそれを使い、0件なら再実行する。複数ある場合は推測せず人間に返す。
- `work.clone` がタイムアウトしたら、`work.list` で `parentWorkId` が元 Work と一致する子を探し、`title` と `createdAt` で特定する。特定できなければ再実行しない。
- `work.list` は `createdAt` と `parentWorkId` を返す。Work の並び順は従来どおり更新日時の降順である。

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
- Theme・Face Set・Voice Profile の読み取り6操作と `speaker` カテゴリの追加は加算的変更であり、`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く。DB migration と HTTP API の変更はない。ただし `operationDigest` と `schemaDigest` は変わり、`schema.get` の操作カタログとカテゴリ enum も変わるため、束縛（MCP / CLI）とアプリは同じビルドで揃える。古い束縛は新しい応答を厳格な検証で拒否し得る。
- `voiceProfile.listVoices` / `voiceProfile.listModels` / `voiceProfile.create` / `voiceProfile.update` の追加も加算的変更であり、`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く（[ADR 0088](../adr/0088-agent-voice-profile-writes.md)）。DB migration と HTTP API の変更はない。ただし `operationDigest` と `schemaDigest` は変わるため、束縛とアプリは同じビルドで揃える。
- `character.setVoices` の追加も加算的変更であり、`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く（[ADR 0089](../adr/0089-agent-character-set-voices.md)）。DB migration と HTTP API の変更はない。ただし `operationDigest` と `schemaDigest` は変わるため、束縛とアプリは同じビルドで揃える。
- `character.create` / `character.update` の追加も加算的変更であり、`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く（[ADR 0099](../adr/0099-agent-character-library-writes.md)）。DB migration と HTTP API の変更はない。ただし `operationDigest` と `schemaDigest` は変わるため、束縛とアプリは同じビルドで揃える。
- サムネイル操作の追加も加算的変更であり、`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く（[ADR 0098](../adr/0098-agent-thumbnail-operations.md)）。DB migration と HTTP API の変更はない。`schemaDigest` に `thumbnailTemplateContracts` を加えたため、サムネイルテンプレートの入力変更も検知できる。`operationDigest` と `schemaDigest` は変わるため、束縛とアプリは同じビルドで揃える。
- 古い束縛は厳格な応答検証で未知のキーを弾くため、`schema.get` の応答にフィールドを増やす変更は、束縛とアプリが同じバージョンで同居することを前提とする。ずれが起きたら束縛も同じ版へ更新する。
- 版の機構は、破壊的変更が実際に起きたときに使う。`AGENT_PROTOCOL_VERSION` を上げると、古い束縛は handshake で `AGENT_PROTOCOL_MISMATCH` になって接続时被弾する（応答検証の失敗ではなく、原因が明確な失敗になる）。

## 素材の取り込み

- エージェントはアプリと同じマシンのファイルシステムを共有するため、`asset.import` はローカルパスを受け取り、バイト列を読んで取り込む。multipart や base64、URL 取得は用いない。
- 取り込みは Web UI の multipart アップロードと同じ内部処理に落とし、`storageKey` は内容ハッシュ由来とする。入力パスを正本へ保存しない（[../mvp/spec.md](../mvp/spec.md)）。
- 読み取りは利用者と同じ権限で行う。実装はサイズ上限とメディア種別の判定を行い、判定できないファイルは取り込まない。取り込み元パスをログや正本へ残さない。
- 生成物の来歴（モデル、プロンプト、生成パラメータ）は `provenance` として任意に受け取り、`Asset.provenanceJson` に保存する。取り込み元のパスは来歴に含めない。画像などの生成自体はアプリ内で行わない。TTS は利用者が設定した Adapter への Job 投入に限る（後述）。

## TTS とキャラクター

利用者が事前に設定したループバックの TTS Adapter（`voicevox` / `aivisspeech` / `openai-compatible`）への合成 Job 投入は、生成 Asset と Script Version のいずれも履歴から戻せるため、可逆な操作として公開する（[ADR 0077](../adr/0077-agent-tts-on-configured-adapters.md)）。

- 対象は利用者が設定済みの Adapter と Voice Profile に限る。接続先・認証情報・Adapter 設定の変更、Voice Profile の削除、Character の削除、Face Set と Theme の作成・更新・アーカイブ・削除は公開しない。Character の声の付け替え（`character.setVoices`）、作成・部分更新（`character.create` / `character.update`）は公開する。
- Voice Profile は読み取り（一覧・取得・声候補・モデル候補）と作成・更新を公開し、Face Set・Theme は読み取り（一覧・取得）を公開する。利用者が用意した既存 Profile、またはエージェントが `voiceProfile.listVoices` で声を選んで `voiceProfile.create` で作った Profile は、`speaker.add` / `speaker.setVoiceProfile` で Speaker に割り当てられる。割り当ては新しい Script Version を作る可逆な変更であり、以後の TTS にだけ影響する。既存の Audio Take は変更しない。
- 割り当てる Voice Profile は実在し、`locale` が `ContentDocument.locale` と完全一致しなければならない。Character を持つ Speaker は、その Character の文書 locale の Voice と一致する場合だけ設定できる。Character に文書 locale の Voice が無い場合は非 null の割り当てを拒否し、`null` への解除だけを許す。Character に Voice がある場合は `null` にできない。参照先が無い場合は `EDIT_TARGET_NOT_FOUND`、locale または Character Voice の不一致は `EDIT_PRECONDITION_FAILED` とする。
- TTS の入力・出力は HTTP の TTS 契約（[../tts/spec.md](../tts/spec.md)）と同じスキーマ・Adapter 解決・エラーコードを共有し、束縛ごとに生成ロジックを複製しない。Job は既存の `job.get`（MCP / CLI では Job 待機）で状態を確認する。
- 完了した Job の `ttsResult` を Take として台本へ入れる操作は公開しない。`script.edit` の `line.assignTake` で新しい Script Version を追加する。
- 生成物は既存の `origin: generated` と `provenanceJson` で帰属し、TTS 専用の課金管理・プロバイダ管理・新しい帰属列は持たない。
- Face Set・Theme のライブラリは読み取りだけを公開する。Voice Profile は読み取りに加えて作成・更新を公開し、削除だけを人専用に残す。Character は読み取りに加えて声の付け替え（`character.setVoices`）と作成・部分更新（`character.create` / `character.update`）を公開し、削除だけを人専用に残す。台本へ入れるときは操作コアの `character.addFromLibrary` で新しいローカル ID へコピーし、Face Set は参照のまま引き継ぐ（[../editor-core/spec.md](../editor-core/spec.md)）。立ち絵を必要としない声だけの話者は、`voiceProfile.list` で選んだ既存 Profile、または `voiceProfile.listVoices` で声を選んで `voiceProfile.create` で作った Profile を `speaker.add` で割り当てる。Face Set・Theme の作成・更新・削除と Voice Profile・Character の削除は公開しない。ライブラリの編集は既存台本のコピーへ波及しない。既存作品の見た目を変えるには、人間が UI で台本ローカルの Character を編集するか、明示的な「ライブラリから更新」を使う。この更新操作はエージェントには公開しない。

### TTS の契約

- `tts.create` は `{ scriptVersionId, narrationSegmentId, voiceId?, speechText?, speedScale? }` を受け、1 つの `tts` Job（`{ job }`）を返す。`speedScale` は HTTP と同じく既定 `1.0`、範囲は `0.5`〜`2.0`。`voiceId` を省くと話者の Voice Profile の声、`speechText` を省くと保存済みセグメントの読み上げテキストを使う。
- `tts.createBulk` は `{ scriptVersionId }` を受け、HTTP と同じ `{ jobs, excluded }` を返す。対象は要点シーンのうち `selectedAudioTakeId` が `null` のセリフで、生成できないセリフは他の生成を止めず `excluded` に `code` と安全な理由を返す。確定の対象にするには `requestId` を付けて開始する（付けない実行は確定できない）。
- `tts.attachBulk` は `{ scriptVersionId, bulkRequestId, requestId }` を受ける。`bulkRequestId` は確定したい `tts.createBulk` の `requestId`、`requestId` は添付自身の必須キーである。出力は `status`（`pending` / `finalized`）、Job 件数（`queued` / `running` / `succeeded` / `failed` / `cancelled`。検証で添付できなかった成功 Job は `failed` へ移す）、対象外行（`excluded`）、失敗／取消行の理由（`failures`）、添付後の `scriptVersion`（添付0件なら `null`）を返す。
  - サーバーは同じ Agent ID・`bulkRequestId` の冪等台帳から元の一括要求の Job 集合と行 ID を復元する。呼び出し側が Job や行の対応付けを指定することはなく、LLM に Asset や行を選ばせない。
  - Job が1件でも未完了なら台本を変更せず `pending` を返す。全 Job が終端状態になったら、成功 Job のみを、元の版が依然 current であること・対象行と読み上げテキスト・ready な Audio Asset が一致することの確認のうえ、一つの原子的な Script Version として添付する（`line.assignTake` 群はサーバー内部で作る）。基準版が古い場合は `SCRIPT_BASE_STALE`、要求元が見つからない／`requestId` なしで開始された場合は `RESOURCE_NOT_FOUND` で、誤添付せず停止する。
  - 添付の同一 `requestId` 再送は既存の Script Version を返す（版単位の冪等で `script.edit` と同じ規則。再送と内容相違の区別は `IDEMPOTENCY_CONFLICT`）。確定は一度だけ行い、途中成功を逐次保存しない。
  - 確定後の失敗・対象外行の再生成は、返された新しい版（添付0件なら元版）の `scriptVersionId` に対して新しい `bulkRequestId` で `tts.createBulk` を実行する。確定前に台本を書き換えると基準版が古くなり確定できなくなるため、一括生成から確定までは台本を書き換えない。
- 完了した `tts` Job の `ttsResult`（`narrationSegmentId`・`assetId`・`durationMs`・`source: "tts"`）は `job.get` と MCP の `kakeai_job_wait` / CLI の `job.wait` がそのまま返す。単体 TTS の Take 反映は `script.edit` の `line.assignTake`（`assetId` に `ttsResult.assetId`、`source: "tts"`）で行い、反映前に最新の台本を `script.get` で読み直して対象 Segment と読み上げテキストを照合する。この照合はワークフローの規約であり、サーバーはテキスト一致を強制しない（`tts.attachBulk` の確定ではサーバー側で強制する）。
- 存在しない台本版・セリフは `RESOURCE_NOT_FOUND`、入力不正は `TTS_INPUT_INVALID`、Adapter へ接続できない場合は `TTS_ENGINE_UNAVAILABLE` を返す。Job 実行中の失敗は `job.get` の `status: failed` と `error` で伝える。

### Character の契約

- `character.list` はキャラクターライブラリの全件を `{ characters }` で返す。`character.get` は `{ characterId }` を受け、`{ character }` を返す。いずれも `id`・`name`・locale 別の `names`・locale 別の `voices`・外観（`assetId`・`expression`・`pose`・任意の `label`・`faceSetId`）・`createdAt` / `updatedAt` を持ち、HTTP の Character 契約と同じ `characterLibraryEntrySchema` を使う。存在しない `characterId` は `RESOURCE_NOT_FOUND` とする。Character の削除は公開しない。
- `character.create` — Character の作成（[ADR 0099](../adr/0099-agent-character-library-writes.md)）。`{ name, names?, voices?, appearances? }` を受け、`{ character }` を返す。`names` / `voices` / `appearances` の省略時は空配列で、外観を持たない声だけの Character も作れる。`appearances` は `{ assetId, expression, pose, label?, faceSetId? }` で、外観 ID はサーバーが生成する（戻り値の `appearances[].id` で読める）。更新時に既存の外観を残す場合は `id` を付けて送る。`id` を省略した外観は新しい外観として扱われ、新しいローカル ID が付く。`assetId` は ready な画像 Asset、`faceSetId` は実在しベース画像と寸法が一致する Face Set、`voiceProfileId` は実在し `locale` が一致する Profile でなければならない。空名・参照欠落・寸法不一致・locale 不一致・locale 重複は `VALIDATION_ERROR`。`requestId` は持たないため、タイムアウト後は `character.list` で確認してから再実行する。HTTP API と同じ `createCharacter` を呼ぶ。
- `character.update` — Character の部分更新（[ADR 0099](../adr/0099-agent-character-library-writes.md)）。`{ characterId, name?, names?, voices?, appearances? }` を受け、`{ character }` を返す。**省略した項目は変更しない**。指定した配列はその全体を置き換えるため、`names` / `voices` / `appearances` を変えるときは `character.get` で読んだ全件を送る。既存の外観の `id` を維持して送ることで、作品コピーの `libraryAppearanceId` リンクを保てる。1 項目も指定しない呼び出しは `VALIDATION_ERROR`。存在しない `characterId` は `RESOURCE_NOT_FOUND`、参照欠落・寸法不一致・locale 不一致・locale 重複・空名は `VALIDATION_ERROR`。更新は以後の `character.addFromLibrary` コピーにだけ影響し、既存の Script Version は変えない。`requestId` は持たないが、状態の置換なので再送してよい（外観 ID は再生成される）。
- `character.setVoices` — Character の声の付け替え（[ADR 0089](../adr/0089-agent-character-set-voices.md)）。`{ characterId, voices }` を受け、`{ character }` を返す。`voices` は `{ locale, voiceProfileId }[]` で、参照する Profile は実在し、その `locale` と voice の `locale` が一致しなければならない。空配列も許し、全解除できる。外観と `names` は変えない。存在しない `characterId` は `RESOURCE_NOT_FOUND`、参照欠落・locale 不一致・locale 重複は `VALIDATION_ERROR` とする。付け替えは以後の `character.addFromLibrary` コピーにだけ影響し、既存の Script Version は変えない。`requestId` は持たないため、タイムアウト後は `character.get` で確認してから再実行する。
- 台本へ入れるときは `script.edit` の操作コア操作 `character.addFromLibrary`（`{ op, libraryCharacterId }`）を使う。ライブラリのキャラクターを、名前・`names`・`voices`・全外観を引き継いだ新しいローカル ID の Character・Appearance・Speaker として文書へコピーする。`faceSetId` は参照のまま引き継ぎ、その時点の最新改訂版を `faceSetVersion` に固定する。`libraryCharacterId` / `libraryAppearanceId` も記録するが、レンダーには使わない。`Character.name` と `Speaker.name` は `ContentDocument.locale` に一致する `names` の名前、一致がなければ既定の `name` とする。Speaker の `voiceProfileId` は `ContentDocument.locale` に一致する `voices` の声、一致がなければ `null` とする。ライブラリ側は変更しない。
- コピーで作られた ID は `script.edit` の `created.characterIds` / `created.appearanceIds` / `created.speakerIds` で返る。後続の `line.add`・`line.setSpeaker`・`standing.set` にはこの ID をそのまま使う。`character.addFromLibrary` は `key` を持たないため、同一呼び出し内で作った ID を `{ key }` で参照することはできない。
- 未知の `libraryCharacterId` は `EDIT_TARGET_NOT_FOUND`、`ScriptContext.libraryCharacters` を用意できない場合は `EDIT_PRECONDITION_FAILED` とする。

## 冪等台帳（高コスト操作）

高コスト操作（`tts.create` / `tts.createBulk` / `render.start` / `composition.publish`）は、任意の `requestId` を受け付ける。`requestId` が渡されたときだけ冪等台帳（`AgentRequest`）に記録し、タイムアウト後の再送でも Job や Version が増えないようにする。`tts.attachBulk` と `script.restore` は台帳に載せず、必須の `requestId` を `script.edit` と同じ版単位の冪等（`ScriptVersion.agentRequestId`）で扱う。

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
- `script.edit` / `script.restore` は従来どおり版単位の冪等（`ScriptVersion.agentRequestId` / `agentRequestHash`）を維持し、台帳には載せない。

## 長尺操作

- 素材取り込み・TTS・レンダーは Job として実行し、操作は Job の投入と ID の返却まで行う。状態は `job.get` のポーリングで確認する。
- 投入済み Job の再発見は `job.list` で行う。`kind` は `render`（既定）または `tts` を選び、Work に紐づく Job だけを返す。取り込み Job は Work に紐づかないため `job.list` の対象外であり、`job.get` で確認する。
- Job の状態遷移、単一 worker、リースなし、起動時 `WORKER_INTERRUPTED` 掃除は [../mvp/spec.md](../mvp/spec.md) と [ADR 0020](../adr/0020-no-job-lease-startup-reap.md) の規則をそのまま適用する。

## 帰属

- `ScriptVersion` は作成者が利用者かエージェントかを示す `author`（`human` / `agent`）と、エージェントを識別する任意の `authorAgentId` を持つ。作成時に確定し、以後変更しない。
- `authorAgentId` は接続時の `agentId` を既定とし、操作ごとに上書きできる。空文字は保存しない。
- 帰属は `ContentDocument` ではなく DB の列として持つ。`contentSchemaVersion` は上げない。
- 帰属は、履歴でエージェント作の版を識別し、巻き戻すために使う。`sourceScriptVersionId`（復元・翻訳・Work 複製・下書きの系統）とは別軸である。
- `script.edit` / `script.restore` の `requestId` は `ScriptVersion.agentRequestId` として保存し、Edition 内で一意にする。`script.save` と UI 保存は `null` とする。要求内容のハッシュ（`agentRequestHash`）も保存し、同じ ID の再送と衝突を区別する。
- `work.clone` の初期版は Agent 経由なら `author: "agent"` と接続の `agentId`、HTTP 経由なら `human` を記録する。複製元は `sourceScriptVersionId` に残す。
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
| `SCRIPT_BASE_STALE` | `baseScriptVersionId` が current と一致しない（`script.edit` の必須の基準版、`script.save` / `script.restore` の任意の基準版ガード） |
| `IDEMPOTENCY_CONFLICT` | 同じ `requestId` が異なる入力で使われた |
| `AGENT_IDEMPOTENCY_IN_PROGRESS` | 同じ `requestId` の処理が実行中で、待機時間内に完了しなかった |
| `EDIT_TARGET_NOT_FOUND` / `EDIT_PRECONDITION_FAILED` / `EDIT_INVALID_INPUT` / `EDIT_UNSUPPORTED_TEMPLATE` / `EDIT_ID_GENERATION_FAILED` | 操作コアのエラー（[../editor-core/spec.md](../editor-core/spec.md)）。Speaker・Voice Profile の参照欠落、声の locale 不一致、Character Voice との不一致、選択できない Theme Revision もここに含む |
| `VALIDATION_ERROR` | 保存検証に適合しない。`issues` に JSON Pointer と理由を含める。MCP の入力スキーマ不一致にも同じコードと `issues` を返す |
| `ASSET_UNAVAILABLE` | 取り込み・レンダー・編集で参照する Asset が ready でない、または欠損している |
| `COMPOSITION_UNAVAILABLE` | 参照する Composition Version が publish 済みでない、または bundle が欠損している |
| `TTS_INPUT_INVALID` | TTS 生成要求の入力が不正（空の読み上げテキスト、話者・声の未設定、Adapter 外の声） |
| `TTS_ENGINE_UNAVAILABLE` | 利用者が設定した TTS Adapter へ接続できない、または不正な応答を返した（`tts.create` / `tts.createBulk` / `voiceProfile.listVoices` / `voiceProfile.listModels`） |
| `THUMBNAIL_INPUT_INVALID` | サムネイルのテンプレートが未対応、入力が `inputSchema` に適合しない、素材が画像でない、または大きすぎる（`preview.thumbnail` / `thumbnail.image`。作成・更新の入力検証は `VALIDATION_ERROR` / `ASSET_*`） |
| `INVALID_STATE` | `theme.publish` の対象に Theme Draft が無い、など操作の現在状態が前提を満たさない |
| `EXPORT_TARGET_EXISTS` | `artifact.export` の書き出し先に同名のファイルまたはディレクトリが存在する。既存ファイルは上書きしない |
| `EXPORT_FAILED` | `artifact.export` のコピーに失敗した（書き込み権限、容量、ファイルシステムの制約など） |
| `RESOURCE_NOT_FOUND` | `tts.create` の対象セリフ、`tts.attachBulk` の元一括要求（`requestId` なし開始・別エージェント・Job 欠損を含む）、`character.get` / `character.update` / `character.setVoices` / `theme.get` / `theme.diagnose` / `theme.draft.get` / `theme.draft.save` / `theme.publish` / `faceSet.get` / `voiceProfile.get` / `voiceProfile.update` / `thumbnail.get` / `thumbnail.update` / `thumbnail.image` / `thumbnail.setPrimary` / `script.subtitles` / `artifact.get` / `artifact.export` の対象など、参照先の資源が存在しない |
| `WORK_NOT_FOUND` | 対象の作品・言語版・版が存在しない（`work.get` / `work.clone` / `script.listVersions` / `script.restore` / `thumbnail.list` / `thumbnail.appearance` / `thumbnail.create` を含む） |

上記のほか、操作が既存サービスから受け取った HTTP API の安定コード（`VALIDATION_ERROR`、`FILE_TOO_LARGE`、`UNSUPPORTED_MEDIA_TYPE`、`JOB_NOT_CANCELLABLE` など）はそのまま返す。入出力の形は `packages/contracts` の Zod スキーマを正とする。

## 非ゴール

これらは現時点の非ゴールであり、恒久の禁止ではない。前提が変わったときは新しい ADR で置き換える（[ADR 0086](../adr/0086-agent-generation-boundary-by-configured-endpoints.md)）。

- アプリ内への LLM 組込、プロバイダ・モデル・API キー・課金・会話履歴の管理。
- アプリ内の画像生成・音声モデルの組込。画像生成はエージェント側に委ね、Agent Access は取り込みだけを公開する。TTS は利用者が設定したループバック Adapter への合成 Job 投入に限る。
- 複数プロセスによる SQLite 共有、worker の外部起動。
- 実体削除、外部サービスへの公開をエージェントへ開放すること。
- リモート・クラウドの MCP 接続、HTTP 経由のエージェント接続。
- 台本編集の意味論を Agent Access 側で持つこと。編集は操作コアだけが行う。

## 将来

- アプリ内ネイティブの AI 編集機能が必要になった場合は、同じ操作コアの上に任意の束縛として載せる。操作コアを変更しない限り、MCP・CLI を置き換えない。
- 操作契約のダイジェストとプロトコル版、素材検索の索引化、Job 操作の一般化などの拡張候補は [roadmap.md](./roadmap.md) に整理する。スキル配布（R3-3）は [ADR 0087](../adr/0087-agent-skills-distribution.md) と [スキル互換性履歴](./skill-compatibility.md) に従って実装済みである。Theme・Face Set・Voice Profile の読み取りと声の割り当て（B8 / B9）は実装済みである。TTS の冪等化と Take 添付の一体化（`tts.attachBulk`）は実装済みで、視覚確認（R3-4）は [../visual-confirmation/spec.md](../visual-confirmation/spec.md) へ切り出して実装した。制作履歴・復旧（R2-4）は `script.listVersions` / `script.restore` / `work.clone` として実装済みである。実装時は本仕様と [todo.md](./todo.md) に詳細を落とす。
