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

## 拡張フェーズ（B1〜B14）

[ロードマップ](./roadmap.md) の「今回の決定」を正とする。B1 → B2 → B3 → B4 → B5 → B6 → B8 → B9 → B11 → B12 → B13 → B14 の順に実装する。B7 は B2 の後に実装中である。B10 は独立して実装済みである。

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

### [x] B4 素材検索の拡張（R2-1）

- [x] タグ絞り込みを DB 側クエリへ移し、タグ一致は要素の完全一致（ASCII は大文字小文字を区別しない、`%` と `_` は通常の文字として扱う）として契約に固定する。`tagsJson` のまま維持し、索引化は行わない。
- [x] 検索契約に `sort`（`createdAt_desc` 既定 / `createdAt_asc` / `filename_asc` / `duration_asc`）、`hasAudio`、`durationMinMs` / `durationMaxMs`、ページの一致件数 `total` を追加する。カーソルはソート列を含める。
- [x] HTTP API、ローカルソケット、MCP、CLI は同じ契約を使い続ける。`docs/asset-tags/spec.md` をサーバ側絞り込みの現行仕様へ更新する。
- [x] 完了条件: 複合フィルタ＋ソート＋ページングで重複・欠落がなく、`total` がフィルタと一致し、タグの大小文字挙動が契約で固定されている。

### [x] B5 作品名の更新

- [x] `work.update`（`workId` と `title`）を追加し、HTTP の `PATCH /works/:workId` と同じ規則で管理上の作品名だけを変更する。出力は `{ work }` を返し、`schema.get` の操作カタログと契約ダイジェストへ反映する。MCP と CLI はカタログから自動公開する。
- 完了条件: ソケット・MCP・CLI から作品名を変更でき、存在しない Work は `RESOURCE_NOT_FOUND`、空のタイトルは `VALIDATION_ERROR` になる。

### [x] B6 視覚確認（R3-4）

- [x] 実施は [../visual-confirmation/todo.md](../visual-confirmation/todo.md) を正とする。`preview.frame`（render 成果物の指定時刻の原寸 PNG）を操作コア・MCP・CLI へ公開し、仕様・roadmap・ユーザーガイド・スキル・用語を更新する。V2 の保存版・素材プレビューは同フォルダの D1〜D4 で追加済み。
- 完了条件: ソケット・MCP・CLI から指定時刻の静止画が取得でき、異常系が安定コードで返る。

### [ ] B7 エージェント一括TTS確定（R2-2）

- [ ] 契約・操作カタログ・schema digest へ `tts.attachBulk` を追加する。短時間の mutation とし、Job 待機オプションの対象にしない。MCP と CLI は既存カタログ連携で同じ操作を公開する
- [ ] Agent サービスに、元の一括要求の結果参照を冪等台帳から復元し、Job 状態を集計して、サーバー内部で `line.assignTake` 群を作る共通処理を追加する。HTTP の Web 一括 TTS 契約・DB スキーマ・Job 種別は変更しない
- [ ] 一括 Job が未完了なら版を作らず `pending`、全完了後は成功 Job だけを一つの版へ添付して `finalized` を返す。基準版の競合は `SCRIPT_BASE_STALE`、要求元なしは `RESOURCE_NOT_FOUND`、添付の同一 `requestId` 再送は既存版を返す
- [ ] `skills/kakeai-production` の一括 TTS 手順を、`tts.createBulk`（`requestId` 付き）→ `tts.attachBulk` の状態確認／確定→未音声だけ新バッチ、へ変更する。単体 TTS は従来どおり個別の `line.assignTake` を使う
- [ ] TTS 仕様、Agent Access 仕様・roadmap、ユーザーガイドを更新し、Web と Agent の差分、失敗後の再実行、確定前に台本を書き換えない規則を明記する
- 完了条件: 契約・MCP・CLI 公開のテスト、一括未完了／全完了後の一部添付、失敗・取消・対象外を含む部分成功、冪等再送、requestId なし／別 Agent の一括要求、基準版の競合が検証できる。Web の一括生成フローで部分失敗時の件数と保存後の再実行案内が表示され、成功分の保存・次回の未音声一括生成を妨げない。

### [x] B8 ライブラリ読み取り（R2-3）

- [x] 契約に `theme.list` / `theme.get`（`{ themes: [{ id, name, isBuiltIn, version }] }` / `{ theme: { id, name, isBuiltIn, version, definition } }`）を追加する。アーカイブされていない利用者 Theme の最新公開 Revision と組み込み Theme だけを返し、Theme Draft・アーカイブ済み Theme・最新でない Revision・Font 診断は返さない。
- [x] 契約に `faceSet.list` / `faceSet.get`（`{ faceSets }` / `{ faceSet }`、`faceSet.get` は任意の `version`）と `voiceProfile.list` / `voiceProfile.get`（`{ voiceProfiles }` / `{ voiceProfile }`）を追加する。既存 DTO をそのまま返し、一覧はページングしない。
- [x] 未知の `themeId` / `faceSetId` / `voiceProfileId` を `RESOURCE_NOT_FOUND` とする。Theme・Face Set・Voice Profile の作成・更新・削除・アーカイブは公開しない。
- [x] 6 操作を `schema.get` の Agent 操作カタログと契約ダイジェストへ反映し、MCP・CLI がカタログから自動公開することを保つ。`operationDigest` と `schemaDigest` が変わり、`AGENT_PROTOCOL_VERSION` は上げない。
- [x] ソケット・MCP・CLI のテストで、6 操作の取得、Theme の最新 Revision 限定、未知 ID の `RESOURCE_NOT_FOUND` を固定する。
- [x] Agent Access 仕様・roadmap・ユーザーガイド・制作スキルを更新する。
- 完了条件: ソケット・MCP・CLI から 6 操作を呼べ、Theme が最新公開 Revision だけを返し、未知 ID が `RESOURCE_NOT_FOUND` になる。束縛とアプリが同じビルドで公開される。

### [x] B9 声だけの話者と声の割り当て（R2-3）

- [x] `speaker.add`（任意の `key`・`name`・必須 `voiceProfileId`）と `speaker.setVoiceProfile`（`speakerId`・`voiceProfileId` / `null`）を操作コアと契約に追加し、`speaker` カテゴリを新設する。作成 ID は `script.edit` の `created.speakerIds` で返す。
- [x] `line.add` / `line.setSpeaker` の `speakerId` を ID または `{ key }` で参照できるようにする。`scene.add.lines[].speakerId` は ID のみのままとする。
- [x] 声の割り当て規則を操作コアに実装する。Profile は実在し `ContentDocument.locale` と完全一致すること、Character 付き Speaker は文書 locale の Character Voice と一致すること。参照欠落は `EDIT_TARGET_NOT_FOUND`、locale・Character Voice の不一致は `EDIT_PRECONDITION_FAILED`。Character に声が無い場合だけ `null` への解除を許す。
- [x] `line.setSpeaker` で声だけの話者へ変えたときに `expressionId` を自動で消し、`line.add` は声だけの話者への明示的な `expressionId` を拒否する。`line.setExpression` も声だけの話者には指定できない。
- [x] `document.setVisualTheme` を、組み込み Theme の最新 Revision とアーカイブされていない利用者 Theme の最新公開 Revision だけに制限する。`script.save` は Theme の変更がアーカイブ済み・最新でない Revision を指す場合だけ拒否し、Theme を変えない保存と `script.restore` を許可する。
- [x] `ScriptContext` に `voiceProfiles` / `themes` の任意参照を追加し、`voiceProfiles` を用意できない場合の `EDIT_PRECONDITION_FAILED` と、選択できない Theme の `EDIT_TARGET_NOT_FOUND` を固定する。
- [x] 声の変更が以後の TTS にだけ影響し、既存の Audio Take を変えないことを仕様に明記する。
- [x] 契約・操作コア・ソケット統合テストで、声だけの話者の作成、`{ key }` 参照、locale 不一致、Character Voice 不一致、`expressionId` の自動消去・拒否、Theme の最新 Revision 制限を固定する。`speaker.add` の replay が `created` を返さないことも確認する。
- [x] Agent Access 仕様・roadmap・TTS 仕様・多言語声仕様・MP4 制作仕様・操作コア仕様・ユーザーガイド・制作スキルを更新する。DB migration と HTTP API の変更は行わない。
- 完了条件: 新規作品で `voiceProfile.list` → `speaker.add` → `line.add`（`speakerId: { key }`）→ TTS → 確定 → レンダーが通り、Character 付き話者の制約と Theme の最新 Revision 制限がテストで固定されている。`AGENT_PROTOCOL_VERSION` は `1` のまま、`operationDigest` と `schemaDigest` だけが変わる。

### [x] B10 スキル配布と版管理（R3-3）

- [x] [ADR 0087](../adr/0087-agent-skills-distribution.md) を追加し、GitHub Release と対になる本リポジトリの不変タグ `vMAJOR.MINOR.PATCH` を配布の正本にする。`main` からの導入、独自 installer、独自 lock 形式を採らない。初回公開版を `v0.1.0` とし、アプリとスキルの共通バージョンにする。root・CLI・MCP の `package.json` は `0.0.0` のままにする。
- [x] スキルの導入・ロック・配置・復元を `skills@1.7.4` に委譲する。プロジェクト導入は `skills-lock.json` を Git 管理し、`.agents/` を再生成対象として無視する。更新は新しいタグを指定した `add` の再実行、復元は `experimental_install` とする。
- [x] [スキル互換性履歴](./skill-compatibility.md) を追加し、v0.1.0 の対応リリース、含まれるスキル、各スキルの必須の正規操作、互換性上の注意を記録する。操作スキーマ・Template 契約・ダイジェスト値は複製しない。
- [x] `skills@1.7.4` を root の固定開発依存に追加し、スキル発見確認用の `npm run skills:check` を追加する。Node.js 要件を `>=22.20.0` に揃え、`.npmrc` の `engine-strict` で強制する。`Makefile` の `skill-install` を削除する。
- [x] 手動起動の release workflow を追加する。版の形式、互換性履歴の当該版エントリ、型検査、全テスト、スキル発見を確認した後、同じコミットから注釈付きタグと GitHub Release を作る。`v*` タグの更新・削除はリポジトリ設定で禁止する。
- [x] ユーザーガイドの Agent Access 節を、`skills@1.7.4` を使うプロジェクト導入、グローバル導入、新しいタグでの更新、ロックからの復元の4コマンドへ置き換える。共有ワークスペースの `skills-lock.json` と `.agents/` の扱いを明記する。
- 完了条件: 空のワークスペースへ公開タグを導入して `skills-lock.json` が生成され、新しいタグで更新でき、ロックから同じ版を復元できる。release workflow が互換性履歴・型検査・全テスト・スキル発見のいずれかが欠けるとタグと Release を作らない。

### [x] 生成境界の見直し（ADR 0086）

- [x] 課金の有無を公開条件から外し、利用者が設定した接続先だけを使うことを条件にする。[ADR 0086](../adr/0086-agent-generation-boundary-by-configured-endpoints.md) を追加し、ADR 0074 / 0077 を amendment する。Agent Access 仕様・roadmap・ユーザーガイド・制作スキルを同じ境界へ揃える。現時点（B2）では Kakeai は接続先（URL）だけを知り、生成サービスの認証情報を保持しない。
- 完了条件: 仕様・ガイド・スキルに金額を根拠にした禁止が残らず、可逆性と接続先の帰属で境界が説明されている。

### [x] B11 Voice Profile の作成・更新公開（ADR 0088）

- [x] [ADR 0088](../adr/0088-agent-voice-profile-writes.md) を追加し、Voice Profile の作成・更新の公開と削除の人専用維持を決定する
- [x] 契約に `voiceProfile.listVoices` / `voiceProfile.listModels`（read）と `voiceProfile.create` / `voiceProfile.update`（mutation）を追加する。入出力は HTTP の声・モデル一覧と作成・更新契約と同じ形とし、`AGENT_PROTOCOL_VERSION` は `1` のままにする
- [x] Agent サービスに 4 操作を追加し、既存の `services/voice-profiles.ts`（声・モデル一覧、作成、更新）をそのまま呼ぶ。`create` は `requestId` を持たず冪等台帳に載せない（`work.create` と同じ扱い）。未知の更新対象は `RESOURCE_NOT_FOUND`、エンジン接続失敗は `TTS_ENGINE_UNAVAILABLE` とする
- [x] MCP の説明文を 4 操作分追加し、`voiceProfile.list` の「作成・更新・削除は公開しない」を改める。CLI はカタログ導出のため変更しない
- [x] ソケット統合テストで、一覧取得、作成→取得→話者割当て、モデル付き作成、入力不正、更新成功・対象不明・`adapterId` 変更拒否、エンジン停止時の `TTS_ENGINE_UNAVAILABLE` を固定する。既存の「Voice Profile 書き込み未登録」テストを新方針へ更新する
- [x] Agent Access 仕様・TTS 仕様・MP4 制作仕様・制作スキル・ユーザーガイドの「Profile が無ければ人間に依頼する」手順を `listVoices` → `create` → `speaker.add` へ置き換える。DB migration と HTTP API の変更は行わない
- 完了条件: 新規作品で `voiceProfile.listVoices` → `voiceProfile.create` → `speaker.add` → `line.add` → TTS → 確定 → レンダーが通り、削除は `AGENT_OPERATION_UNKNOWN` のままである。`AGENT_PROTOCOL_VERSION` は `1` のまま、`operationDigest` と `schemaDigest` だけが変わる。

### [x] B12 Character Voice 付け替えの公開（ADR 0089）

- [x] [ADR 0089](../adr/0089-agent-character-set-voices.md) を追加し、Character の声の付け替えの公開と作成・外観変更・削除の人専用維持を決定する
- [x] 契約に `character.setVoices`（mutation）を追加する。入力は `{ characterId, voices }`、出力は `{ character }` とし、`AGENT_PROTOCOL_VERSION` は `1` のままにする
- [x] Agent サービスに `setCharacterVoices` を追加し、既存の声検証（実在・locale 一致・重複不可）をそのまま使う。Character の作成・外観変更・削除は公開しない。未知の Character は `RESOURCE_NOT_FOUND`、声の参照欠落・不一致は `VALIDATION_ERROR` とする
- [x] MCP の説明文を 1 操作分追加する。CLI はカタログ導出のため変更しない
- [x] ソケット統合テストで、声の置換・全解除、未知 Character、未知 Profile、locale 不一致・重複、外観の不変、付け替え後の `addFromLibrary` コピーへの反映を固定する。`character.create` / `update` / `delete` が `AGENT_OPERATION_UNKNOWN` のままであることも確認する
- [x] Agent Access 仕様・MP4 制作仕様・制作スキル・ユーザーガイドの「声付きキャラクターの作成を依頼する」を「既存 Character への声付けはエージェントが行い、Character 自体の新規作成だけを依頼する」へ置き換える。DB migration と HTTP API の変更は行わない
- 完了条件: 既存 Character へ `character.setVoices` で声を付け、`character.addFromLibrary` → TTS → 確定 → レンダーが通る。Character の作成・外観変更・削除は `AGENT_OPERATION_UNKNOWN` のままである。`AGENT_PROTOCOL_VERSION` は `1` のまま、`operationDigest` と `schemaDigest` だけが変わる。

### [x] B13 サムネイル操作の公開（ADR 0098）

- [x] [ADR 0098](../adr/0098-agent-thumbnail-operations.md) を追加し、サムネイルの読み取り・作成・更新・primary 選択・未保存プレビュー・PNG 取得の公開と、削除・共通 Appearance の保存・プリセットの人専用維持を決定する
- [x] 契約に `thumbnail.listTemplates` / `thumbnail.list` / `thumbnail.get` / `thumbnail.appearance`（read）、`thumbnail.create` / `thumbnail.update` / `thumbnail.setPrimary`（mutation）、`preview.thumbnail` / `thumbnail.image`（画像 read）を追加する。`AGENT_PROTOCOL_VERSION` は `1` のままにする
- [x] サムネイルテンプレート定義に `exampleInput` を追加し、`thumbnail.listTemplates` が `inputSchema`（`toAgentJsonSchema`）と `example` を返す。入力契約を `schemaDigest` の `thumbnailTemplateContracts` に含める
- [x] Agent サービスに 9 操作を追加し、既存の `services/thumbnails.ts`（一覧・取得・作成・明示保存・primary・Appearance 読み取り・PNG 生成）をそのまま呼ぶ。未保存プレビュー用に、既存のプレビュー HTML をアセットの data URL 付きでラスタライズする共通経路を追加する
- [x] `preview.thumbnail` と `thumbnail.image` を `agentImagePreviewOperationNames` に追加し、MCP の image ブロック・CLI の `--out`・画像系 30 秒タイムアウトを既存の仕組みで使えるようにする
- [x] MCP の説明文を 9 操作分追加する。CLI はカタログ導出のため変更しない
- [x] ソケット統合テストで、テンプレート取得、候補作成・取得・更新、未保存プレビューが DB を書かないこと、primary 選択と解除、PNG 生成（素材の data URL 化を含む）、未知言語版・未知候補・未対応テンプレート・素材欠落・入力不正の安定コード、削除・共通 Appearance 保存・プリセットが `AGENT_OPERATION_UNKNOWN` のままであることを固定する
- [x] Agent Access 仕様・roadmap・サムネイル仕様・MP4 制作仕様とロードマップ・制作スキル・ユーザーガイドを更新する。DB migration と HTTP API の変更は行わない
- 完了条件: ソケット・MCP・CLI から `thumbnail.listTemplates` → `thumbnail.create` → `preview.thumbnail` → `thumbnail.update` → `thumbnail.setPrimary` → `thumbnail.image` が通り、CLI の `--out` で PNG を書き出せる。削除・共通 Appearance 保存・プリセットは `AGENT_OPERATION_UNKNOWN` のままである。`AGENT_PROTOCOL_VERSION` は `1` のまま、`operationDigest` と `schemaDigest` だけが変わる。

### [x] B14 Character ライブラリ作成・更新の公開（ADR 0099）

- [x] [ADR 0099](../adr/0099-agent-character-library-writes.md) を追加し、Character の作成・部分更新の公開と削除の人専用維持を決定する
- [x] 契約に `character.create` / `character.update`（mutation）を追加する。`create` は `{ name, names?, voices?, appearances? }`、`update` は `{ characterId, name?, names?, voices?, appearances? }` を受け、どちらも `{ character }` を返す。外観は `id` を持たず、サーバーが生成する。`AGENT_PROTOCOL_VERSION` は `1` のままにする
- [x] Agent サービスに 2 操作を追加し、既存の `services/character-library.ts`（作成・更新）をそのまま呼ぶ。`update` は現在値を読んで指定項目だけを重ね、1 項目も指定しない呼び出しを `VALIDATION_ERROR` とする。削除は公開しない
- [x] MCP の説明文を 2 操作分追加し、`character.list` / `character.setVoices` の「作成・外観変更は公開しない」を改める。CLI はカタログ導出のため変更しない
- [x] 操作ディスパッチャの肥大化を避けるため、Character / Face Set / Voice Profile / Theme の操作定義を `apps/api/src/agent/library-operations.ts` へ分割し、`scripts/check-file-size.mjs` の baseline から `operations.ts` を外す
- [x] ソケット統合テストで、作成 → 名前/別名/声/外観の部分更新、外観ゼロの Character のコピー、未知 Character、Asset / Face Set / Profile の参照欠落、更新項目ゼロ、削除が `AGENT_OPERATION_UNKNOWN` のままであることを固定する
- [x] Agent Access 仕様・roadmap・キャラクターライブラリ仕様・MP4 制作仕様・制作スキル・ユーザーガイドを更新する。DB migration と HTTP API の変更は行わない
- 完了条件: ソケット・MCP・CLI から `character.create` → `character.get` → `character.update` → `character.addFromLibrary` → TTS → 確定 → レンダーが通り、削除は `AGENT_OPERATION_UNKNOWN` のままである。`AGENT_PROTOCOL_VERSION` は `1` のまま、`operationDigest` と `schemaDigest` だけが変わる。

### [x] B15 フォントカタログ・過去 Theme Revision・フォント診断（ADR 0100）

- [x] [ADR 0100](../adr/0100-agent-font-and-theme-revision-reads.md) を追加し、`font.list` の検索・ページング、`theme.get` の `version`、`theme.diagnose` の対象と Chromium 検証の既定を決定する
- [x] 契約に `font.list` / `theme.diagnose`（read）を追加し、`theme.get` に任意の `version` を加える。`AGENT_PROTOCOL_VERSION` は `1` のままにする
- [x] `font.list` は `query`・`style`・`minWeight` / `maxWeight`・`available` で絞り、`limit`（既定 50・最大 200）/ `offset` でページングする。並び順は family → weight → style → PostScript 名で固定し、`total` と `nextOffset` を返す。絞り込みは `services/font-library.ts` に置く
- [x] `theme.get` は `version` 指定時に `getThemeRevision` を使い、公開済み Revision を返す。アーカイブ済み Theme の Revision も読み、Theme Draft と未知 Revision は `RESOURCE_NOT_FOUND` とする。`theme.list` は最新限定のまま
- [x] `theme.diagnose` は `theme.get` と同じ解決で Revision を選び、`locale`（既定 ja-JP）と `verify`（既定 true）で `resolveThemeFonts` を呼ぶ。`roles`・`missingFonts`・`diagnostics`・カタログ対応状況を返し、カタログ非対応はエラーにしない
- [x] `font.list` を 30 秒、`theme.diagnose` を 60 秒の読み取りタイムアウトにする。MCP の説明文を 3 操作分更新し、CLI はカタログ導出のため変更しない
- [x] サービス・契約・ソケット統合テストで、検索・ページング・絞り込み、最新／過去 Revision の取得、アーカイブ済み Revision の取得、未知 Revision、role 解決、欠落フォント、入力不正を固定する
- [x] Agent Access 仕様・roadmap・制作スキル・ユーザーガイドを更新する。DB migration と HTTP API の変更は行わない
- 完了条件: ソケット・MCP・CLI から `font.list` の検索・ページング、`theme.get` の最新／過去 Revision、`theme.diagnose` の role 解決と欠落フォントが取れる。`AGENT_PROTOCOL_VERSION` は `1` のまま、`operationDigest` と `schemaDigest` だけが変わる。

### [x] B16 Theme の作成・Draft 編集・公開と PNG プレビュー（ADR 0101）

- [x] [ADR 0101](../adr/0101-agent-theme-authoring-and-preview.md) を追加し、Theme の作成・Draft 編集・公開の公開範囲、アーカイブ・削除の人専用維持、`preview.theme` の入力と既定時刻を決定する
- [x] 契約に `theme.create` / `theme.draft.save` / `theme.publish`（mutation）、`theme.draft.get`（read）、`preview.theme`（画像 read）を追加する。`theme.create` は HTTP の作成契約を再利用する。`AGENT_PROTOCOL_VERSION` は `1` のままにする
- [x] Agent サービスに Theme の書き込みを追加し、既存の `ThemeService`（作成・Draft upsert・公開）をそのまま呼ぶ。Draft の読み取りは `theme-library` に追加し、組み込み Theme と Draft なしは `null`、未知 Theme は `RESOURCE_NOT_FOUND` とする
- [x] `preview.theme` は未保存の `definition` を `compileThemeRepresentativePreview` でコンパイルし、既存の `PreviewRasterizer` で PNG 化する。`timeMs` 既定 4500、`timeMs` 超過は `VALIDATION_ERROR`。DB・Draft・Revision・Job・Artifact を作らない
- [x] `preview.theme` を `agentImagePreviewOperationNames` に追加し、MCP の image ブロック・CLI の `--out`・画像系 30 秒タイムアウトを使えるようにする。MCP の説明文を 5 操作分更新し、CLI はカタログ導出のため変更しない
- [x] サービス・契約・ソケット統合テストで、作成 → draft.get → draft.save → publish、公開後の Draft 破棄、再 publish の `INVALID_STATE`、未知 Theme、組み込み Theme の Draft null、preview.theme の既定時刻・PNG・timeMs 超過・DB 非更新を固定する
- [x] Agent Access 仕様・roadmap・テーマカスタマイズ仕様・制作スキル・ユーザーガイドを更新する。DB migration と HTTP API の変更は行わない
- 完了条件: ソケット・MCP・CLI から `theme.create` → `theme.draft.get` → `theme.draft.save` → `preview.theme` → `theme.publish` が通り、Theme のアーカイブ・削除が `AGENT_OPERATION_UNKNOWN` のままである。`AGENT_PROTOCOL_VERSION` は `1` のまま、`operationDigest` と `schemaDigest` だけが変わる。

### [x] B17 Voice Adapter 一覧の公開（ADR 0102）

- [x] [ADR 0102](../adr/0102-agent-voice-adapter-descriptors.md) を追加し、公開するのは静的説明子だけとし、接続先 URL・環境変数名・認証情報を返さないことを決定する
- [x] 契約に `voiceAdapter.list`（read）を追加する。入力は `{}`、出力は既存の `VoiceAdapterList`（`id`・`label`・`defaultLocale`・`voiceSelection`・`modelSelection`）。`AGENT_PROTOCOL_VERSION` は `1` のままにする
- [x] Agent サービスに `voiceAdapter.list` を追加し、既存の `listVoiceAdapters` をそのまま呼ぶ。接続設定の読み書きは公開しない
- [x] MCP の説明文を追加する。CLI はカタログ導出のため変更しない
- [x] 契約・ソケット統合テストで、Adapter の並び、説明子の形、接続設定が出力に含まれないこと、catalog の read 登録を固定する
- [x] Agent Access 仕様・roadmap・制作スキル・ユーザーガイドを更新する。DB migration と HTTP API の変更は行わない
- 完了条件: ソケット・MCP・CLI から `voiceAdapter.list` が取れ、`AGENT_PROTOCOL_VERSION` は `1` のまま、`operationDigest` と `schemaDigest` だけが変わる。

### [x] B18 SRT 字幕と MP4 Artifact パスの公開（ADR 0103）

- [x] [ADR 0103](../adr/0103-agent-subtitles-and-artifact-path.md) を追加し、SRT はテキストで返し、MP4 はデータルート内の絶対パスで返すことを決定する
- [x] 契約に `script.subtitles`（read）を追加する。`{ scriptVersionId }` を受け、`{ scriptVersionId, filename, mimeType, byteSize, srt }` を返す。`AGENT_PROTOCOL_VERSION` は `1` のままにする
- [x] 契約に `artifact.get`（read）を追加する。`{ artifactId }` を受け、`{ artifact, filePath }` を返す。`filePath` は `resolveArtifactContent` が返すデータルート内の絶対パスとし、バイトは返さない
- [x] Agent サービスで既存の `getScriptVersionSubtitles` と `getArtifact` / `resolveArtifactContent` をそのまま呼ぶ。`script.subtitles` は Artifact・Job・版を作らない
- [x] MCP の説明文を 2 操作分追加する。CLI はカタログ導出のため変更しない
- [x] 契約・ソケット統合テストで、SRT の内容・UTF-8 バイト長・Artifact 非作成、Artifact のメタデータ・絶対パス・欠損／サイズ不一致／未知 ID の `RESOURCE_NOT_FOUND` を固定する
- [x] Agent Access 仕様・roadmap・MP4 制作仕様とロードマップ・制作スキル・ユーザーガイドを更新する。DB migration と HTTP API の変更は行わない
- 完了条件: ソケット・MCP・CLI から `script.subtitles` が取れ、`job.get` の Artifact ID から `artifact.get` で MP4 の絶対パスが取れる。`AGENT_PROTOCOL_VERSION` は `1` のまま、`operationDigest` と `schemaDigest` だけが変わる。

### [x] B19 Artifact のワークスペース書き出し（ADR 0104）

- [x] [ADR 0104](../adr/0104-agent-artifact-export.md) を追加し、正本はデータルートに残し、`artifact.export` で任意の絶対ディレクトリへコピーする決定と、既存ファイルを上書きしない方針を記録する
- [x] 契約に `artifact.export`（mutation）を追加する。`{ artifactId, outputDir, filename? }` を受け、`{ artifact, sourcePath, exportedPath }` を返す。`AGENT_PROTOCOL_VERSION` は `1` のままにする
- [x] Agent サービスに `exportArtifact` を追加する。`outputDir` は存在する絶対ディレクトリ、`filename` は basename かつ Artifact の拡張子に一致することを検証する。`COPYFILE_FICLONE` を試し、一時ファイルからハードリンクして原子的に公開する。既存名は上書きしない
- [x] エラーコード `EXPORT_TARGET_EXISTS` / `EXPORT_FAILED` を追加し、相対パス・不存在・不正なファイル名は `VALIDATION_ERROR`、未知 Artifact は `RESOURCE_NOT_FOUND` とする
- [x] MCP の説明文を追加する。CLI はカタログ導出のため変更しない
- [x] 契約・ソケット統合テストで、指定名・既定名の書き出し、内容一致、既存名の `EXPORT_TARGET_EXISTS`、相対パス・不存在・パス区切り・拡張子不一致の `VALIDATION_ERROR`、未知 Artifact の `RESOURCE_NOT_FOUND`、DB非更新を固定する
- [x] Agent Access 仕様・roadmap・MP4 制作仕様とロードマップ・制作スキル・ユーザーガイドを更新する。DB migration と HTTP API の変更は行わない
- 完了条件: ソケット・MCP・CLI から `artifact.export` で Artifact を任意の絶対ディレクトリへ書き出せ、既存ファイルは上書きされない。正本の `artifact.get` は従来どおり動く。`AGENT_PROTOCOL_VERSION` は `1` のまま、`operationDigest` と `schemaDigest` だけが変わる。
