# Agent Access 実装TODO

[Agent Access 仕様](./spec.md) を正とする。台本の編集操作は [台本編集操作コア](../editor-core/todo.md) の E1〜E5 を前提とし、このフォルダでは束縛と帰属を実装する。A9 完了後の拡張候補は [roadmap.md](./roadmap.md) に整理する。

## フェーズ

### [x] A1 文書

- [x] [ADR 0074](../adr/0074-agent-direct-reversible-operations.md)（AI は可逆操作を直接実行してよい）と [ADR 0075](../adr/0075-agent-local-socket-single-writer.md)（ローカルソケットで単一ライター）を追加し、[ADR 0015](../adr/0015-minimal-local-api-protection.md) に `amended by` を付ける
- [x] [ADR 0076](../adr/0076-shared-script-operation-core.md)（編集意味論は共有操作コア）と [台本編集操作コア仕様](../editor-core/spec.md) を追加する
- [x] `CONTEXT.md` に Agent と Version Author を追加する
- [x] roadmap の「AI が作品の正本を自動更新しない」記述を可逆／不可逆の境界へ改め、本仕様への参照を張る
- [x] main の変更を取り込み、Agent Access の ADR 番号を 0074 / 0075 へ振り直す
- 完了条件: 本フォルダ、ADR、CONTEXT、roadmap、`../mvp/spec.md` の記述が互いに矛盾しない。

### [x] A2 帰属と契約

- [x] Prisma `ScriptVersion` に `author`（`human` / `agent`）、任意の `authorAgentId`、任意の `agentRequestId` と `agentRequestHash` を追加し、`@@unique([languageEditionId, agentRequestId])` と migration を作る
- [x] ScriptVersion DTO と保存経路に帰属を追加する（UI・HTTP API は既定で `human`）
- [x] 操作コアのスキーマを Agent Access の入出力として公開し、`schema.get` が返す内容（`contentSchemaVersion`、VisualTemplate の `inputFields` と制約、操作カタログ、警告コード、`schemaDigest`）を定義する
- [x] `script.edit` の入力（`baseScriptVersionId`・`requestId`・`operations`）と結果（版・作成 ID・警告・timeline）を `packages/contracts` に定義する
- 完了条件: `npm run typecheck` と契約テストが通り、帰属と再送の同一性を含む ScriptVersion の保存・読出しが成立する。

### [x] A3 操作面とローカル制御ソケット

- [x] 常駐アプリプロセスで操作面をローカル OS ソケットに公開し、ディレクトリ `0700`・ソケット `0600` で保護する
- [x] NDJSON のハンドシェイク（`protocolVersion`・`agentId`）、要求・応答、最大ペイロード、タイムアウトを実装する
- [x] アプリ未起動時の `AGENT_APP_UNAVAILABLE`、不正フレームの `AGENT_PROTOCOL_MISMATCH`、未登録操作の `AGENT_OPERATION_UNKNOWN` を実装する
- [x] `script.edit`（基準版の一致、`requestId` の再送、一括適用、保存検証、帰属）を操作コア経由で実装する
- [x] `script.validate`（書込みなしの検証と timeline）と `script.save`（全体置換）を実装する
- [x] `asset.import`（ローカルパス入力、内容ハッシュ由来の `storageKey`、任意の来歴、サイズ上限）を実装する
- [x] 可逆操作のみを公開し、実体削除・外部公開・課金生成を含めない
- 完了条件: ソケット越しに `work.create`→`script.edit`→`asset.import`→`render.start`→`job.get` が通り、worker が単一のままである。

### [x] A4 Composition authoring の束縛

- [x] `composition.list` / `composition.get` / `composition.draft.get` / `composition.authoringContext` を既存サービスへ接続する
- [x] `composition.create` / `composition.draft.save` / `composition.publish`（`dryRun` を含む）を接続する
- [x] 操作面から Composition の実体削除を公開しない
- 完了条件: MCP から Composition を作成し、publish した version を `script.edit` の `composition.full-bleed@1` 参照へ渡せる。

### [x] A5 MCP 束縛

- [x] MCP stdio サーバーを実装し、操作コアへ接続する薄いクライアントにする
- [x] 操作を MCP ツールとして公開し、`schema.get` と操作カタログを返す
- [x] 長尺操作を Job 投入＋`job.get` ポーリングとして公開する
- 完了条件: 実エージェントから MCP 経由で作成・編集・取り込み・Composition 作成・レンダーが通り、エラーが安定コードで返る。

### [x] A6 CLI 束縛

- [x] MCP と同じ操作コアを呼ぶ CLI を追加し、操作名をサブコマンドとして公開する
- 完了条件: CLI 経由で A5 と同じ往復ができ、MCP と挙動が一致する。

### [x] A7 Web UI

- [x] 版履歴に帰属（利用者／エージェント、任意のエージェント識別）を表示する
- [x] エージェント作の版を内容確認して巻き戻せるようにする
- 完了条件: エージェント作の版を UI で識別でき、内容を確認して巻き戻せる。

### [x] A8 レビューとコミット

- [x] `npm run typecheck`、`npm test`、最大3回の OCR レビューと妥当な指摘の修正

### [x] A9 制作フロー操作とスキル

- [x] [ADR 0077](../adr/0077-agent-tts-on-configured-adapters.md) を追加して [ADR 0074](../adr/0074-agent-direct-reversible-operations.md) を amendment する。利用者が事前設定したループバック TTS Adapter への合成 Job は、生成 Asset と ScriptVersion のいずれも履歴から戻せるため、Agent Access に公開する。`openai-compatible` を含める一方、エージェントは接続先・認証情報・Adapter設定を変更できず、TTS以外の課金生成を一般に許可しない。
- [x] Agent Access に長尺変更 `tts.create`（1 Narration Segment）と `tts.createBulk`（未選択の要点セリフ）を追加し、既存HTTPのTTS入力・出力契約、Adapter解決、エラーコード、Job snapshot をそのまま共有する。完了 Job の `ttsResult` を `job.get` / `job.wait` で返し、Takeの正本への反映は既存の `script.edit` + `line.assignTake` とする。添付前に最新台本を読み直し、対象 Segment と読み上げテキストを照合してから新しい版へ保存する。
- [x] Agent Access に `character.list` / `character.get` を追加し、操作コアに `character.addFromLibrary` を追加する。これはライブラリの Character を新しいローカル Character・Appearance・Speaker IDで台本へコピーし、Face Set参照とEdition localeに対応するVoice Profileを既存のコピー規則どおり引き継ぐ。作成された Character・Appearance・Speaker IDを `script.edit` の `created` 結果で返し、後続のセリフ割り当てと `standing.set` で使えるようにする。キャラクターライブラリ自体の作成・更新・削除は公開しない。
- [x] `asset.list` をページング可能な検索操作へ拡張する。`kind` に加え、`ready` を指定できる状態、ファイル名部分一致、タグ（AND / OR を明示）、お気に入り、アーカイブ表示を組み合わせて絞り込めるようにし、既定ではアーカイブ済みを除外する。HTTP API、ローカルソケット、MCP、CLIは同じ契約を使い、返却順・cursor・page sizeの上限を固定する。
- [x] 新操作を `schema.get` の Agent操作カタログと schema digest へ反映し、dispatcher・MCP・CLIがカタログから自動公開することを保つ。Agent Access仕様、ユーザーガイド、エラー／Job待機の説明も同じ変更で更新する。
- [x] `skills/kakeai-production/SKILL.md` を追加する。台本投入とScene分割、ライブラリCharacterのコピー、素材の検索・取り込み待ち、Cue／立ち絵／全体BGMの一括編集、TTS Job作成・待機・Take添付、validate・renderまでの順序、`SCRIPT_BASE_STALE` 時の再読込とrequestId再送規則を定める。スキルは `schema.get` を正とし、個別のTemplate契約や操作スキーマを複製しない。視覚的なプレビュー／レンダー品質の自律確認は対象外とする。
- [x] 既存の [kakeai-composition skill](../../skills/kakeai-composition/SKILL.md) をAgent AccessのComposition操作へ移行し、横断制作スキルからComposition作成時に参照する。両スキルを利用対象のAgent runtimeが検出できる配布場所へ含め、導入方法をAgent Accessガイドに記載する。
- [x] 契約・socket・MCP・CLIのテストで、TTS（VOICEVOX / AivisSpeech / OpenAI互換）、Job待機とTake添付、Characterのコピーと立ち絵設定、複合素材フィルタとページングを検証する。代表的な統合テストは「台本編集 → Character取り込み → TTS → Take添付 → タグ付きready素材のCue／BGM配置 → validate → render投入」を通す。スキル文言自体はテストしない。
- 完了条件: 外部Agentが既存のCharacterとVoice Profile、タグ付け済み素材だけを使い、台本・Scene・TTS音声・Cue・立ち絵・BGMをScriptVersionとして保存し、MCPまたはCLIから検証・レンダー投入まで完了できる。視覚確認の操作面は後続フェーズとする。

### [x] A10 レビューとコミット

- [x] `npm run typecheck`、`npm test`、最大3回のOCRレビューで妥当な指摘を修正し、コミットする。

## 拡張フェーズ（B1〜B4）

[ロードマップ](./roadmap.md) の「今回の決定」を正とする。B1 → B2 → B3 → B4 の順に実装する。

### [x] B1 操作契約ダイジェストと版折衝の機構（R1-1）

- [x] 各操作の入出力スキーマを正規化して `operationDigest` を出し、`schemaDigest` にも操作契約を含める。JSON Schema 変換は contracts に一本化し、MCP のツールスキーマ生成と同一の正規形を使う。
- [x] 対応プロトコル版の範囲（`minProtocolVersion`..`protocolVersion`）を handshake と `schema.get` で扱う。破壊的変更（必須化・削除・意味変更）のときだけ `AGENT_PROTOCOL_VERSION` を上げ、任意フィールド追加や列挙値追加では上げない。
- [x] 完了条件: 操作スキーマの変更で `operationDigest` と `schemaDigest` が変わり、版の範囲外の handshake は `AGENT_PROTOCOL_MISMATCH` のまま拒否される。契約ドリフトを検出するテストがある。

### [x] B2 高コスト操作の冪等化（R1-2）

- [x] 冪等台帳 `AgentRequest`（operation / agentId / requestId / 要求ハッシュ / 結果参照）を追加する。`script.edit` の版単位冪等は維持する。
- [x] `tts.create` / `tts.createBulk` / `render.start` / `composition.publish` に任意の `requestId` を受け付け、同一ID・同一入力は既存の Job／Version を返し、同一ID・異なる入力は `IDEMPOTENCY_CONFLICT` とする。
- [x] 実行前に台帳を claim して二重実行を防ぎ、実行中の重複は `AGENT_IDEMPOTENCY_IN_PROGRESS`、失敗時は claim を解放して再送できるようにする。`dryRun` の publish は記録しない。
- [x] 完了条件: タイムアウト後の再送でも ScriptVersion・Job・CompositionVersion が増えず、再送と衝突をテストで区別できる。

### [x] B3 ソケットの流量制御（R1-3）

- [x] 接続ごとの未処理フレーム数と最大接続数に上限を設け、超過は `AGENT_BACKPRESSURE` などの安定コードで返す（接続は落とさない）。キュー長に応じた backpressure も効かせる。
- [x] 同一ユーザー性の担保が `0700` ディレクトリ＋`0600` ソケットのファイル権限であることを Agent Access 仕様と ADR 0075 に明記する。実行中操作の取消とネイティブ UID 検証は対象外とする。
- [x] 完了条件: 過負荷時も待ち行列が有界で、接続数超過は切断され、同一ユーザー以外が接続できない根拠が仕様上明確である。

### [ ] B4 素材検索の拡張（R2-1）

- [ ] タグ絞り込みを DB 側クエリへ移し、タグ一致は要素の完全一致（ASCII は大文字小文字を区別しない）として契約に固定する。`tagsJson` のまま維持し、索引化は行わない。
- [ ] 検索契約に `sort`（`createdAt_desc` 既定 / `createdAt_asc` / `filename_asc` / `duration_asc`）、`hasAudio`、`durationMinMs` / `durationMaxMs`、ページの一致件数 `total` を追加する。カーソルはソート列を含める。
- [ ] HTTP API、ローカルソケット、MCP、CLI は同じ契約を使い続ける。`docs/asset-tags/spec.md` をサーバ側絞り込みの現行仕様へ更新する。
- [ ] 完了条件: 複合フィルタ＋ソート＋ページングで重複・欠落がなく、`total` がフィルタと一致し、タグの大小文字挙動が契約で固定されている。
