# Agent Access 仕様

## 目的と境界

この文書は、外部の AI エージェントが Kakeai の作品を操作するためのローカルな操作面（Agent Access）の正とする。正本は引き続き ContentDocument と SQLite であり、HTTP 契約は [../mvp/api-contract.md](../mvp/api-contract.md)、台本本文の構造は [../mvp/content-schema.md](../mvp/content-schema.md)、DB モデルと Job 状態遷移は [../mvp/spec.md](../mvp/spec.md) を正とする。AI が実行してよい操作の範囲は [ADR 0043](../adr/0043-agent-direct-reversible-operations.md)、接続方式と単一ライターの維持は [ADR 0044](../adr/0044-agent-local-socket-single-writer.md) を正とする。

- 対象は、利用者自身が用意したコーディングエージェント等の外部 AI クライアントである。Kakeai は LLM プロバイダ、モデル、API キー、課金、会話履歴を管理しない。
- エージェントは、作品・台本・素材割り当て・素材取り込み・レンダー投入という可逆な操作を直接実行できる。実体の削除、外部への公開、課金を伴う生成は対象外とし、人だけが行う。
- v1 の束縛は MCP（stdio）とし、同じ操作コアの薄い束縛として CLI を続けて追加する。操作の意味は束縛に依存しない。
- Web UI 向け HTTP API はそのまま維持し、Agent Access はこれとは別の入口とする。

## 操作の公開方針

操作は「可逆」と「不可逆」で分ける。可逆な操作はエージェントが直接実行でき、不可逆な操作は人に限る。

| 区分 | 操作 | エージェント |
| --- | --- | --- |
| 可逆 | 作品作成、台本保存（新しい Script Version の追加と current の前進）、Scene・セリフ・素材割り当て、Asset 取り込み、タグ更新、レンダー投入、queued Job のキャンセル | 可 |
| 不可逆 | Work・Asset 本体・Composition Version・Artifact の実体削除、外部への公開、課金を伴う生成 | 人のみ |

「台本上の削除」（Cue・Scene・セリフ・割り当ての除去）は、要素を除いた新しい Script Version を作るだけの可逆な操作であり、エージェントに許す。実体ファイルや行を消す操作だけが不可逆である。既存の [../mvp/api-contract.md](../mvp/api-contract.md) の削除系はそのまま人専用とし、エージェントの操作面には公開しない。

## 操作コアと束縛

- すべての振る舞いは単一の操作コア（サービス層）に置き、HTTP API・MCP・CLI はそれを薄く呼ぶだけの束縛とする。束縛ごとにロジックを複製しない。
- 操作の入出力は [../mvp/content-schema.md](../mvp/content-schema.md) と同様に `packages/contracts` の Zod スキーマで検証し、無検証の値を正本へ渡さない。
- エラーは束縛に依存しない安定したエラーコードで返す。

## ローカル制御ソケット

- 常駐するアプリプロセスが操作面をローカル OS ソケットで公開する。MCP stdio サーバーと CLI はこのソケットへ接続するクライアントである。
- ソケットはアプリデータ領域配下に置き、利用者のファイル権限で保護する。起動トークンや独自ヘッダを持たない（[ADR 0044](../adr/0044-agent-local-socket-single-writer.md)、[ADR 0015](../adr/0015-minimal-local-api-protection.md) の精神を踏襲）。
- アプリプロセスが単一の SQLite ライターかつ単一の worker であり続ける。エージェントは Job を投入するだけで、worker を起動しない。
- v1 はアプリが起動していないとき、接続に失敗する安定したエラーを返す。エージェントによるアプリの自動起動は対象外とする。

## 操作一覧

操作はタスク指向とし、`domain.verb` 形式で表す。v1 は次を土台とし、詳細な入出力は [todo.md](./todo.md) の契約フェーズで確定する。

参照:

- `schema.get` — 現在の `contentSchemaVersion`、各 VisualTemplate の `inputFields`、layer・transition・VisualCue の enum、Asset 種別と用途の制約を返す。エージェントが値を推測しないための必須操作。
- `work.list` / `work.get`
- `script.get` — 指定版（既定は current）の ContentDocument を返す。
- `asset.list` / `asset.get`
- `job.get` / `job.list`

可逆な変更:

- `work.create` — Work、`ja-JP` の LanguageEdition、初期 ScriptVersion を [../mvp/spec.md](../mvp/spec.md) の作成規則で作る。
- `script.save` — 全 ContentDocument を検証し、新しい ScriptVersion を追加して current を進める。要素単位の操作（例 `scene.add`、`narration.assignAudio`）は、`script.save` を土台として後から追加する。
- `asset.import` — 後述の手順で Asset を取り込む。
- `asset.tag` — Asset のタグを更新する。
- `render.start` — 対象版と ready な素材から render Job を投入する。
- `job.cancel` — queued の Job をキャンセルする。

## 素材の取り込み

- エージェントはアプリと同じマシンのファイルシステムを共有するため、`asset.import` はローカルパスを受け取り、バイト列を読んで取り込む。multipart や base64、URL 取得は用いない。
- 取り込みは Web UI の multipart アップロードと同じ内部処理に落とし、`storageKey` は内容ハッシュ由来とする。入力パスを正本へ保存しない（[../mvp/spec.md](../mvp/spec.md)）。
- 生成物の来歴（モデル、プロンプト、生成パラメータ）は任意メタとして受け取り、`Asset.provenanceJson` に保存する。生成自体はアプリ内で行わない（非ゴール参照）。

## 長尺操作

- 素材取り込みとレンダーは Job として実行し、操作は Job の投入と ID の返却まで行う。状態は `job.get` のポーリングで確認する。
- Job の状態遷移、単一 worker、リースなし、起動時 `WORKER_INTERRUPTED` 掃除は [../mvp/spec.md](../mvp/spec.md) と [ADR 0020](../adr/0020-no-job-lease-startup-reap.md) の規則をそのまま適用する。

## 帰属

- `ScriptVersion` は作成者が利用者かエージェントかを示す `author`（`human` / `agent`）と、エージェントを識別する任意の `authorAgentId` を持つ。作成時に確定し、以後変更しない。
- 帰属は ContentDocument ではなく DB の列として持つ。`contentSchemaVersion` は上げない。
- 帰属は、履歴でエージェント作の版を識別し、巻き戻すために使う。`sourceScriptVersionId`（復元・翻訳・下書きの系統）とは別軸である。
- Asset の生成元は既存の `origin`（`generated`）と `provenanceJson` で表し、別の帰属列は持たない。

## エラー

| code | 発生条件 |
| --- | --- |
| `AGENT_APP_UNAVAILABLE` | アプリプロセスが起動しておらずソケットへ接続できない |
| `AGENT_OPERATION_UNKNOWN` | 未登録の操作名 |
| `VALIDATION_ERROR` | 入力が Zod スキーマに適合しない |
| `ASSET_UNAVAILABLE` | 取り込み・レンダーで参照する Asset が ready でない、または欠損している |
| `WORK_NOT_FOUND` | 対象の作品・版が存在しない |

入出力の詳細な形と追加コードは [todo.md](./todo.md) の契約フェーズで確定する。

## 非ゴール

- アプリ内への LLM 組込、プロバイダ・モデル・API キー・課金・会話履歴の管理。
- アプリ内の画像・音声生成アダプター。生成はエージェント側に委ね、Agent Access は取り込みだけを公開する。
- 複数プロセスによる SQLite 共有、worker の外部起動。
- 実体削除、外部公開、課金を伴う生成をエージェントへ開放すること。
- リモート・クラウドの MCP 接続、HTTP 経由のエージェント接続。

## 将来

- CLI は、MCP と同じ操作コアを呼ぶ薄い束縛として追加する。
- アプリ内ネイティブの AI 編集機能が必要になった場合は、同じ操作コアの上に任意の束縛として載せる。操作コアを変更しない限り、MCP・CLI を置き換えない。
