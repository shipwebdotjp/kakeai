# Agent Access ロードマップ

[Agent Access 仕様](./spec.md) の実装完了後の拡張候補を整理する。ここに書いたものは約束された仕様ではなく、優先順位と依存関係を共有するための計画である。実装するときは、この文書を更新したうえで [spec.md](./spec.md) と [todo.md](./todo.md) に詳細を落とす。

## 方針

- 正本は `ContentDocument` と SQLite のままとする。Agent Access は操作コアを呼ぶ薄い束縛であり、束縛ごとに業務ロジックを持たない。
- 可逆な操作だけをエージェントへ公開する。実体削除、外部サービスへの公開、Adapter 設定の変更は人に限る。Voice Profile と Character の削除は人専用に残す。生成操作は、利用者が設定した接続先だけを使えることを条件に公開する（[ADR 0074](../adr/0074-agent-direct-reversible-operations.md)、[ADR 0077](../adr/0077-agent-tts-on-configured-adapters.md)、[ADR 0086](../adr/0086-agent-generation-boundary-by-configured-endpoints.md)、[ADR 0088](../adr/0088-agent-voice-profile-writes.md)、[ADR 0089](../adr/0089-agent-character-set-voices.md)、[ADR 0099](../adr/0099-agent-character-library-writes.md)）。
- 互換性は「追加は自由、破壊は版を上げる」で扱う。エージェントは古いスキーマをキャッシュし得るため、契約の変更は `schemaDigest` とプロトコル版で検知できなければならない。
- スキルは `schema.get` を正とし、操作スキーマや Template 契約を複製しない。
- 個人利用のローカルアプリを前提に、運用負荷より再現性と巻き戻しやすさを優先する。

## 今回の決定

優先「高」の4項目と R3-3 について、実装範囲を次のとおりに決めた。決定理由は各項目の「決定理由」欄に記載する。

| 項目 | 決定 | 決定理由 |
| --- | --- | --- |
| R1-1 操作契約ダイジェスト／プロトコル版 | 機構だけ導入し、版は据え置く | `operationDigest` と対応版の範囲を用意し、破壊的変更が実際に起きた時点で初めて版を上げる。既存クライアントを壊さない |
| R1-2 変更操作の冪等化 | 高コスト操作のみ（`tts.create` / `tts.createBulk` / `render.start` / `composition.publish`） | 二重生成・二重レンダー・二重 publish が実害が大きい。台帳は汎用テーブルにして他操作への拡張余地を残す |
| R1-3 ソケット流量制御・取消・ピア確認 | 上限だけ導入し、ピア確認は文書化 | 信頼境界は `0700` ディレクトリ＋`0600` ソケットのファイル権限で担保できる。ネイティブ UID 検証と実行中操作の取消は費用に見合わない |
| R2-1 素材検索のスケール | 索引化せず、検索の停下来よさを拡張 | 個人ライブラリの規模ではタグ検索の走査コストは支配的でない。索引化（タグのリレーション化）は将来に回す |
| R3-3 スキル配布と版管理 | Gitタグ＋GitHub Releaseを正本とし、`npx skills` にロック・配置・復元を委譲する | 独自 installer は CLI の機能を複製する。不変タグでスキルとアプリの版を対応づけ、`main` 追従を避ける |
| B13 サムネイル操作の公開 | 読み取り・作成・更新・primary 選択・未保存プレビュー・PNG 取得を公開し、削除・共通 Appearance の保存・プリセットは人専用に残す | 候補は版履歴のない可変文書で、削除は取り消せない。PNG はオンデマンド生成で Job を増やさず、素材は利用者が取り込んだ画像だけを使う（ADR 0098） |
| B14 Character ライブラリ作成・更新の公開 | 作成と部分更新を公開し、削除は人専用に残す。外観 ID は作成時にサーバー生成、外観画像は取り込み済みの ready 画像だけを使う。更新は既存 ID を維持できる | 台本の外側の共有ライブラリで、既存台本はコピーを持つため可逆。全項目必須の更新は空配列で意図せず消す事故があるため部分更新にする（ADR 0099） |
| C12 Asset 検索の寸法条件 | `asset.list` に完全一致の `widthPx` / `heightPx` と両端を含む範囲を追加する。寸法を持たない素材は一致させない。向き・寸法順の並べ替え・索引は追加しない | Face Set の同寸レイヤー探索が主目的。向きは正方形の境界と比率の丸めの意味づけが必要で、寸法は DTO で返るため呼び出し側で判定できる（ADR 0106） |
| C13 Asset の可逆な整理 | `asset.update` で `favorited` / `archived` を切り替える。タグは既存の `asset.update` に残し、削除は人専用のままにする | どちらも真偽値の印で、`false` で元に戻り、行・参照・レンダーを壊さない。タグまで含めると `asset.update` と意味が重複するため、整理の印だけに限定する（ADR 0107） |
| B23 Character 外観の差分操作 | 1件追加（addAppearance）と部分更新（updateAppearance）を公開し、削除は人専用に残す。既存 character.update の配列置換は維持する | 1件単位の操作で read-modify-write を解消し、作品コピーの libraryAppearanceId 参照を壊さずに維持できる（ADR 0108） |

## 実施順序

B1 → B2 → B3 → B4 の順で実装し、B5・B6・B8・B9・B11・B12・B13・B14 は B4 の後に実装する。B7 は B2 の後に実装中である。B10 は独立して実施済みである。

| フェーズ | 対象 | 依存 | 順序の理由 |
| --- | --- | --- | --- |
| B1 | R1-1 操作契約ダイジェスト／版折衝の機構 | なし | 以降すべてが契約（入出力・ダイジェスト）を触るため、機構を先に整えるほど差分が小さい |
| B2 | R1-2 高コスト操作の冪等化 | B1 | 変更操作の中心であり副作用の重複が大きい。テーブル1つとディスパッチャのラッパで完結する |
| B3 | R1-3 ソケットの上限 | B1 | トランスポート層のみで独立。契約変更は新エラーコード1つ |
| B4 | R2-1 素材検索の拡張 | B1 | 唯一 HTTP 契約・Web UI・旧 asset-tags 仕様に跨るため、他の変更が固まってから着手する |
| B5 | 作品名の更新 | B1 | 小規模な追加操作。カタログとダイジェストの仕組みに乗る |
| B6 | 視覚確認（R3-4） | B1 | render 成果物の静止画を読むだけの操作。詳細は visual-confirmation 側で管理する |
| B7 | R2-2 TTS 冪等化・`tts.attach` | B2 | B2 の冪等台帳のうえで一括確定を載せる。Web の一括 TTS 契約は変えない |
| B8 | R2-3 ライブラリ読み取り（Theme / Face Set / Voice Profile） | B1 | 既存 DTO とサービスを読むだけ。制作前の判断材料を増やし、編集の往復を減らす |
| B9 | R2-3 声だけの話者と声の割り当て | B1 | `speaker` カテゴリと `ScriptContext` の参照を追加する編集操作。声のプリフライトをキャラクター依存から外す |
| B10 | R3-3 スキル配布と版管理 | なし | 配布経路だけの変更で、操作契約を変えない。リリース後に互換性履歴を更新できるよう B1 のダイジェスト機構と併用する |
| B11 | Voice Profile の作成・更新公開 | B1 | 既存サービスを呼ぶだけの追加操作。声候補の取得と合わせて公開し、人間への作成依頼を不要にする |
| B12 | Character Voice 付け替えの公開 | B1 | 既存の声検証を呼ぶだけの追加操作。外観に触れず声だけを置換し、人間への声付け依頼を不要にする |
| B13 | サムネイル操作の公開 | B1 | 既存サムネイルサービスの読み取り・作成・更新・選択・PNG 取得を公開する。MP4 後の投稿用成果物をエージェントが作れるようにする |
| B14 | Character ライブラリ作成・更新の公開 | B1 | 既存サービスの作成・更新を呼ぶ追加操作。立ち絵付き作品で人間への作成依頼を不要にする |
| B20 | C9〜C11 Face Set の作成・部分更新・合成プレビュー | B1 | Face Set の書き込みと品質確認を1フェーズにまとめる。作品は版を固定するため、改訂版の作成で保存済み台詞は壊れない |
| B21 | C12 素材検索の寸法条件 | B1 | 既存の検索条件に寸法の完全一致と範囲を足すだけ。B20 の Face Set で使う同寸画像をエージェントが探せるようにする |
| B22 | C13 素材の可逆な整理 | B1 | 既存の `updateAsset` を呼ぶ追加操作。削除の境界を変えずに、取り込んだ素材の整理をエージェントへ開く |

C1〜C8 は B15〜B18 として実装し、C8 の書き出しを B19 で拡張した。C9〜C11 は B20、C12 は B21、C13 は B22 として実装した。C14〜C16（[次期候補](#次期候補c1c16)）はこの順序に含めず、着手するときに優先順位・実装範囲・設計を決める。

## フェーズ詳細

### B1 操作契約ダイジェストと版折衝の機構（R1-1）

- 状態: 完了。機構だけを導入し、`AGENT_PROTOCOL_VERSION` は `1` のまま据え置いた（`AGENT_PROTOCOL_MIN_VERSION` も `1`）。`schema.get` に `operationDigest` と `minProtocolVersion` を追加し、`schemaDigest` は操作契約を含む。仕様は [spec.md](./spec.md)、実施項目は [todo.md](./todo.md) を参照。
- `schema.get` に各操作の入出力スキーマの正規形ハッシュ `operationDigest` を追加する。JSON Schema への変換は contracts に一本化し、MCP のツールスキーマ生成とダイジェストで同じ正規形を使う。
- `schemaDigest` は Template・警告・操作カタログ・操作契約をまとめたものにし、操作契約の変更で必ず変わるようにする。
- 対応プロトコル版の範囲（`minProtocolVersion`..`protocolVersion`）を handshake と `schema.get` で扱う。破壊的変更（必須化・削除・意味変更）のときだけ `AGENT_PROTOCOL_VERSION` を上げる。任意フィールドの追加や列挙値の追加では版を上げない。
- 完了条件: 操作の入出力スキーマを変えると `operationDigest` と `schemaDigest` が変わり、版の範囲外の handshake は `AGENT_PROTOCOL_MISMATCH` のまま拒否される。契約ドリフトを検出するテストがある。

### B2 高コスト操作の冪等化（R1-2）

- 状態: 完了。冪等台帳 `AgentRequest`（`operation` / `agentId` / `requestId` / 要求ハッシュ / 結果参照）を追加し、`tts.create` / `tts.createBulk` / `render.start` / `composition.publish` に任意の `requestId` を受け付けた。`requestId` は任意のまま（必須化は破壊的変更なので行わない）。仕様は [spec.md](./spec.md)、実施項目は [todo.md](./todo.md) を参照。
- 冪等台帳として `AgentRequest`（`operation` / `agentId` / `requestId` / 要求ハッシュ / 結果参照）を持つ。`script.edit` の既存の版単位冪等（`ScriptVersion.agentRequestId`）はそのまま維持する。
- 対象は `tts.create` / `tts.createBulk` / `render.start` / `composition.publish`。`requestId` は任意とし、渡されたときだけ冪等化する。必須化は破壊的変更になるため行わない。
- 保存するのは結果の参照（Job id や CompositionVersion id）だけで、再送時は現在のリソースから結果を再構築する。古いスナップショットを返さない。
- 同一 `requestId`・同一入力は既存の Job／Version を返し、同一 `requestId`・異なる入力は `IDEMPOTENCY_CONFLICT` とする。同一要求の競合は台帳の一意制約で収束させる。
- 実行前に台帳を claim する。実行中の重複は支柱時間（最大 2 秒）待って、完了しなければ `AGENT_IDEMPOTENCY_IN_PROGRESS` を返す。失敗時は claim を解放するので再送できる。`dryRun` の publish は副作用がないため記録しない。
- 完了条件: タイムアウト後の再送でも ScriptVersion・Job・CompositionVersion が増えず、再送と衝突をテストで区別できる。他操作へ台帳を適用しやすい。

### B3 ソケットの流量制御（R1-3）

- 状態: 完了。接続ごとの未処理フレーム数（`AGENT_MAX_PENDING_FRAMES_PER_CONNECTION`、既定 64）と未処理バイト数（1 要求の上限と同じ 32 MiB）、同時接続数（`AGENT_MAX_CONNECTIONS`、既定 16）に上限を設けた。上限超過の要求は実行せず `AGENT_BACKPRESSURE` を返して読み飛ばし、接続は落とさない。キューが上限に達している間はソケットの読み取りを止め、キューが下限まで減ると再開する。接続数超過はハンドシェイク前に切断する。仕様は [spec.md](./spec.md)、実施項目は [todo.md](./todo.md) を参照。
- 接続ごとの未処理フレーム数と最大接続数に上限を設ける。上限超過は `AGENT_BACKPRESSURE` などの安定コードで返し、接続そのものは落とさない。キューが閾値を超えたら読み取り側を止め、書き込みの backpressure を効かせる。
- 同一ユーザー性の担保は `0700` ディレクトリ＋`0600` ソケットのファイル権限であることを仕様と ADR 0075 に明記する。ネイティブの UID 検証は導入しない。
- 実行中操作の取消は今回対象外とし、別途 B3-b として残す。
- 完了条件: 過負荷時もメモリと待ち行列が有界で、接続数超過は切断され、同一ユーザー以外が接続できない根拠が仕様上明確である。

### B4 素材検索の拡張（R2-1）

- 状態: 完了。タグの絞り込みは `Asset.tagsJson` に対する DB 側のクエリへ移し、`tagsJson` のまま維持して索引化は行わない。タグ一致は要素の完全一致とし、照合は SQLite の `lower()` が ASCII しか畳み込まないため ASCII タグは大文字小文字を区別しないものとして契約に固定した（`%` と `_` はワイルドカードではなく通常の文字で、これらの文字を含むタグは自身のタグにだけ一致する）。検索契約に `sort`（`createdAt_desc` 既定 / `createdAt_asc` / `filename_asc` / `duration_asc`）、`hasAudio`、`durationMinMs` / `durationMaxMs`、一致件数 `total` を追加し、カーソルはソート列と `id` を含む。ソートを変更すると旧カーソルは `VALIDATION_ERROR` とする。HTTP API、ローカルソケット、MCP、CLI は同じ契約を使い続ける。仕様は [spec.md](./spec.md)、実施項目は [todo.md](./todo.md) を参照。
- 検索契約に `sort`（`createdAt_desc` 既定 / `createdAt_asc` / `filename_asc` / `duration_asc`）、`hasAudio`、`durationMinMs` / `durationMaxMs` を追加する。ページには一致件数 `total` を返す。
- カーソルはソート列を含める。ソートを変更すると旧カーソルは `VALIDATION_ERROR` とする。ソートは（キー, id）の二段で固定し、同値時も重複・欠落を起こさない。
- HTTP API、ローカルソケット、MCP、CLI は同じ契約を使い続ける。
- [../asset-tags/spec.md](../asset-tags/spec.md) の「絞り込みはクライアント側」という記述を現行のサーバ側絞り込みへ更新する。
- 完了条件: 複合フィルタ＋ソート＋ページングで重複・欠落がなく、`total` がフィルタと一致し、タグの大小文字挙動が契約で固定されている。タグのリレーション化（索引化）は将来課題として残す。

### B7 エージェント一括TTS確定（R2-2）

- 状態: 実装中。`tts.attachBulk`（`scriptVersionId`・元の `bulkRequestId`・添付自身の必須 `requestId`）を操作コア・MCP・CLI へ公開する。一括 Job が未完了なら版を作らず `pending` を返し、全 Job が終端状態になったら成功 Job のみを一つの Script Version へ原子的に添付して `finalized` を返す。Job 集合と行 ID は冪等台帳から復元し、呼び出し側に対応付けを指定させない。基準版の競合は `SCRIPT_BASE_STALE`、要求元なしは `RESOURCE_NOT_FOUND`、同一 `requestId` 再送は既存版を返す。仕様は [spec.md](./spec.md)、実施項目は [todo.md](./todo.md) を参照。
- 一括生成の HTTP 契約・DB スキーマ・Job 種別は変更しない。失敗後の再生成は新しい `bulkRequestId` で `tts.createBulk` を実行する。
- 完了条件: 契約・MCP・CLI 公開のテスト、一括未完了／全完了後の一部添付、失敗・取消・対象外を含む部分成功、冪等再送、`requestId` なし／別 Agent の一括要求、基準版の競合が検証できる。

### B8 ライブラリ読み取り（R2-3）

- 状態: 完了。`theme.list` / `theme.get`、`faceSet.list` / `faceSet.get`、`voiceProfile.list` / `voiceProfile.get` を追加した。一覧はページングせず、既存の DTO（`FaceSet` / `VoiceProfile`）をそのまま返す。`faceSet.get` は任意の `version` で固定版を読める。未知の ID・版は `RESOURCE_NOT_FOUND`。仕様は [spec.md](./spec.md)、実施項目は [todo.md](./todo.md) を参照。
- Theme は、アーカイブされていない利用者 Theme の最新公開 Revision と組み込み Theme だけを返す。Theme Draft、アーカイブ済み Theme、最新でない Revision、Font 診断は返さない。`theme.get` は `theme` として `{ id, name, isBuiltIn, version, definition }` を返す。
- Face Set は `id`・`name`・`layers`・`expressions`・作成日時を、Voice Profile は `id`・`name`・`adapterId`・`voiceId`・`locale`・`settings`・作成日時を返す。Theme・Face Set の書き込み（作成・更新・削除・アーカイブ）は公開しない。Voice Profile の書き込みは B11 で作成・更新だけを公開し、削除は人専用のまま残す。
- 完了条件: ソケット・MCP・CLI から同じ 6 操作を呼べ、Theme が最新公開 Revision だけを返し、未知の ID が `RESOURCE_NOT_FOUND` になる。`operationDigest` と `schemaDigest` が変わり、`AGENT_PROTOCOL_VERSION` は上がらない。

### B9 声だけの話者と声の割り当て（R2-3）

- 状態: 完了。`speaker.add`（`key?`・`name`・`voiceProfileId`）と `speaker.setVoiceProfile`（`speakerId`・`voiceProfileId` / `null`）を追加し、`speaker` カテゴリを新設した。`line.add` / `line.setSpeaker` の `speakerId` は ID または `{ key }` を受け付ける。仕様は [spec.md](./spec.md)、実施項目は [todo.md](./todo.md) を参照。
- 割り当てる Profile は実在し、`ContentDocument.locale` と完全一致する。Character 付き Speaker は、その Character の文書 locale の Voice と一致する場合だけ設定でき、Character にその声が無い場合は `null` への解除だけを許す。参照欠落は `EDIT_TARGET_NOT_FOUND`、locale・Character Voice の不一致は `EDIT_PRECONDITION_FAILED`。
- `line.setSpeaker` は声だけの話者へ変えると `expressionId` を自動で消す。`line.add` は声だけの話者への明示的な `expressionId` を拒否し、`line.setExpression` も拒否する。`document.setVisualTheme` は最新 Revision だけを選べる。`script.save` は Theme の変更がアーカイブ済み・最新でない Revision を指す場合だけ拒否し、Theme を変えない保存と `script.restore` は許可する。
- 声の変更は以後の TTS にだけ影響し、既存の Audio Take は変えない。Character の削除と Face Set・Theme の管理は引き続き人専用である。Voice Profile 自体の作成・更新は B11、Character への声付けは B12、Character の作成・更新は B14 で公開する。
- 完了条件: 新規作品で `voiceProfile.list` → `speaker.add` → `line.add`（`speakerId: { key }`）→ TTS → 確定 → レンダーが通り、Character 付き話者・locale 不一致・Character Voice 不一致・`expressionId` の拒否がテストで固定されている。DB migration と HTTP API の変更はない。

### B10 スキル配布と版管理（R3-3）

- 状態: 完了。[ADR 0087](../adr/0087-agent-skills-distribution.md) を追加し、GitHub Release と対になる本リポジトリの不変タグ `vMAJOR.MINOR.PATCH` を配布の正本にした。`npx skills@1.7.4` にロック・配置・復元を委譲し、`main` からの導入と独自 installer を採らない。仕様は [spec.md](./spec.md)、互換性履歴は [skill-compatibility.md](./skill-compatibility.md) を参照。
- 初回公開版を `v0.1.0` とし、アプリとスキルの共通バージョンにする。root・CLI・MCP の `package.json` は `0.0.0` のままにする。
- 手動起動の release workflow を追加する。版の形式、互換性履歴の当該版エントリ、型検査、全テスト、スキル発見を確認した後、同じコミットから注釈付きタグと GitHub Release を作る。`v*` タグの更新・削除はリポジトリ設定で禁止する。
- プロジェクト導入は `skills-lock.json` を Git 管理し、`.agents/` を再生成対象として無視する。更新は新しいタグを指定した `add` の再実行、復元は `experimental_install` とする。
- 完了条件: 空のワークスペースへ公開タグを導入して `skills-lock.json` が生成され、新しいタグで更新でき、ロックから同じ版を復元できる。公開タグの互換性履歴に、対応リリース・スキル・必須の正規操作・注意が記録されている。

### B11 Voice Profile の作成・更新公開

- 状態: 完了。`voiceProfile.listVoices` / `voiceProfile.listModels`（read）と `voiceProfile.create` / `voiceProfile.update`（mutation）を追加した。入出力は HTTP の声・モデル一覧と作成・更新契約と同じ形で、既存サービスをそのまま呼ぶ。`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く。仕様は [spec.md](./spec.md)、実施項目は [todo.md](./todo.md)、決定記録は [ADR 0088](../adr/0088-agent-voice-profile-writes.md) を参照。
- `create` は `requestId` を持たず冪等台帳に載せない（`work.create` と同じ扱い）。タイムアウト後は `voiceProfile.list` で確認してから再実行する。`update` の `adapterId` は変更できず、未知の ID は `RESOURCE_NOT_FOUND`、エンジン接続失敗は `TTS_ENGINE_UNAVAILABLE` とする。削除は人専用のまま残す。
- 完了条件: 新規作品で `voiceProfile.listVoices` → `voiceProfile.create` → `speaker.add` → `line.add`（`speakerId: { key }`）→ TTS → 確定 → レンダーが通り、削除は `AGENT_OPERATION_UNKNOWN` のままである。`operationDigest` と `schemaDigest` が変わり、`AGENT_PROTOCOL_VERSION` は上がらない。

### B12 Character Voice 付け替えの公開

- 状態: 完了。`character.setVoices`（mutation）を追加した。`{ characterId, voices }` を受け、`{ character }` を返す。既存サービスの声検証（実在・locale 一致・重複不可）をそのまま使い、外観には触れない。`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く。仕様は [spec.md](./spec.md)、実施項目は [todo.md](./todo.md)、決定記録は [ADR 0089](../adr/0089-agent-character-set-voices.md) を参照。
- `requestId` は持たず冪等台帳に載せない（`work.create`・`voiceProfile.create` と同じ扱い）。タイムアウト後は `character.get` で確認してから再実行する。未知の Character は `RESOURCE_NOT_FOUND`、声の参照欠落・不一致は `VALIDATION_ERROR` とする。Character の削除は人専用のまま残す（作成・更新は B14 で公開）。
- 完了条件: 既存 Character へ声を付けて `character.addFromLibrary` → TTS → 確定 → レンダーが通り、削除は `AGENT_OPERATION_UNKNOWN` のままである。`operationDigest` と `schemaDigest` が変わり、`AGENT_PROTOCOL_VERSION` は上がらない。

### B13 サムネイル操作の公開

- 状態: 完了。`thumbnail.listTemplates` / `thumbnail.list` / `thumbnail.get` / `thumbnail.appearance`（read）、`thumbnail.create` / `thumbnail.update` / `thumbnail.setPrimary`（mutation）、`preview.thumbnail` / `thumbnail.image`（画像 read）を追加した。既存の `services/thumbnails.ts` をそのまま呼び、素材検証・Appearance 解決・PNG ラスタライズを複製しない。`preview.thumbnail` と `thumbnail.image` は画像系操作として MCP の image ブロックと CLI の `--out` に対応する。`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く。仕様は [spec.md](./spec.md)、実施項目は [todo.md](./todo.md)、決定記録は [ADR 0098](../adr/0098-agent-thumbnail-operations.md) を参照。
- サムネイルテンプレートは VisualTemplate と別レジストリのため、`schema.get` を増やさず `thumbnail.listTemplates` で `inputSchema` と `example` を返す。入力契約は `schemaDigest` に含め、テンプレート入力の変更でも検知できるようにする。
- 候補の削除、言語版共通 Appearance の保存、外観プリセットの読み書きは公開しない。`requestId` は持たず、タイムアウト後は `thumbnail.list` で確認してから再実行する。PNG はオンデマンド生成で、Job・Artifact・版を作らない。
- 完了条件: ソケット・MCP・CLI からテンプレート取得 → 候補作成 → 未保存プレビュー → 更新 → primary 選択 → PNG 取得が通り、削除・共通 Appearance 保存・プリセットが `AGENT_OPERATION_UNKNOWN` のままである。`operationDigest` と `schemaDigest` が変わり、`AGENT_PROTOCOL_VERSION` は上がらない。

### B14 Character ライブラリ作成・更新の公開

- 状態: 完了。`character.create` / `character.update`（mutation）を追加した。`character.create` は `{ name, names?, voices?, appearances? }`、`character.update` は `{ characterId, name?, names?, voices?, appearances? }` を受け、どちらも `{ character }` を返す。既存の `createCharacter` / `updateCharacter` をそのまま呼び、外観の画像・Face Set・Voice Profile の検証を複製しない。外観 ID は作成時にサーバーが生成し、更新では既存の外観に `id` を付けると維持される。`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く。仕様は [spec.md](./spec.md)、実施項目は [todo.md](./todo.md)、決定記録は [ADR 0099](../adr/0099-agent-character-library-writes.md) を参照。
- `update` は省略した項目を変更せず、指定した配列だけを置き換える。既存の外観は `id` を付けて送ることで ID を維持できる。現在値の読み取りとマージは書き込みと同じトランザクション内で行う。1 項目も指定しない呼び出しは `VALIDATION_ERROR`。未知の Character は `RESOURCE_NOT_FOUND`、Asset・Face Set・Profile の参照欠落や locale 不一致は `VALIDATION_ERROR`。`requestId` は持たず、タイムアウト後は `character.list` / `character.get` で確認してから再実行する。
- `character.delete` は人専用のまま残す。ライブラリの編集は既存台本のコピーへ波及しない。外観の画像は取り込み済みの ready な画像 Asset に限る。
- 完了条件: ソケット・MCP・CLI から作成 → 取得 → 名前/別名/声/外観の更新 → `character.addFromLibrary` → TTS → 確定 → レンダーが通り、外観ゼロの声だけ Character もコピーでき、削除が `AGENT_OPERATION_UNKNOWN` のままである。`operationDigest` と `schemaDigest` が変わり、`AGENT_PROTOCOL_VERSION` は上がらない。

### B15 フォントカタログ・過去 Theme Revision・フォント診断（C1〜C3）

- 状態: 完了。`font.list`、`theme.get` の `version`、`theme.diagnose` を read として追加した。既存の `FontCatalogService` と `theme-library` を呼び、絞り込みとページングだけを `services/font-library.ts` に置く。`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く。仕様は [spec.md](./spec.md)、実施項目は [todo.md](./todo.md)、決定記録は [ADR 0100](../adr/0100-agent-font-and-theme-revision-reads.md) を参照。
- `font.list` は約2,800 faceを一度に返さないため、`query`・`style`・`minWeight` / `maxWeight`・`available` で絞り、`limit`（既定50・最大200）/ `offset` でページングする。並び順は family → weight → style → PostScript 名で固定する。カタログは既存のキャッシュを使い、強制更新は公開しない。
- `theme.get` は `version` を任意で受け、指定時はアーカイブ済み Theme の公開 Revision も返す。`theme.list` は最新限定のまま。`theme.diagnose` は `theme.get` と同じ解決で Theme Revision を選び、`locale`（既定 ja-JP）と `verify`（既定 true）で `resolveThemeFonts` を呼ぶ。
- 読み取りタイムアウトは `font.list` 30 秒、`theme.diagnose` 60 秒。カタログが使えない platform はエラーにせず `catalogSupported: false` と理由を返す。
- 完了条件: ソケット・MCP・CLI から `font.list` の検索・ページング、`theme.get` の最新／過去 Revision、`theme.diagnose` の role 解決と欠落フォントが取れ、`operationDigest` と `schemaDigest` が変わり、`AGENT_PROTOCOL_VERSION` は上がらない。

### B16 Theme の作成・Draft 編集・公開と PNG プレビュー（C4 / C5）

- 状態: 完了。`theme.create` / `theme.draft.get` / `theme.draft.save` / `theme.publish` と `preview.theme` を追加した。書き込みは既存の `ThemeService`、プレビューは `compileThemeRepresentativePreview` と既存の `PreviewRasterizer` を呼ぶ。`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く。仕様は [spec.md](./spec.md)、実施項目は [todo.md](./todo.md)、決定記録は [ADR 0101](../adr/0101-agent-theme-authoring-and-preview.md) を参照。
- `theme.create` は HTTP と同じ `{ name, sourceThemeRef? }`。`theme.draft.save` は Draft の upsert で、公開 Revision を変えず版を消費しない。`theme.publish` は Draft を新しい公開 Revision にし、Draft を破棄する。アーカイブ・削除は人専用のまま。
- `preview.theme` は未保存の定義を代表サンプルでラスタライズし、`timeMs` 既定 4500 の PNG を返す。DB・Draft・Revision・Job・Artifact を作らない。フォントの解決可否は `theme.diagnose` が担う。
- 完了条件: ソケット・MCP・CLI から create → draft.get → draft.save → preview.theme → publish が通り、未知 Theme・Draft なし publish・timeMs 超過の安定コードが固定されている。`operationDigest` と `schemaDigest` が変わり、`AGENT_PROTOCOL_VERSION` は上がらない。

### B17 Voice Adapter 一覧の公開（C6）

- 状態: 完了。`voiceAdapter.list` を追加した。既存の `listVoiceAdapters` が返す静的説明子（`id`・`label`・`defaultLocale`・`voiceSelection`・`modelSelection`）だけを返し、接続先 URL・環境変数名・認証情報は返さない。`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く。仕様は [spec.md](./spec.md)、実施項目は [todo.md](./todo.md)、決定記録は [ADR 0102](../adr/0102-agent-voice-adapter-descriptors.md) を参照。
- `voiceProfile.listVoices` / `voiceProfile.listModels` / `voiceProfile.create` の `adapterId` を、ライブラリに既存 Profile が無い状態でも推測せずに選べる。一覧は「対応している Adapter」であり、接続済みかどうかは `listVoices` などの `TTS_ENGINE_UNAVAILABLE` で判明する。
- 完了条件: ソケット・MCP・CLI から `voiceAdapter.list` が取れ、接続設定が出力に含まれず、`operationDigest` と `schemaDigest` が変わり、`AGENT_PROTOCOL_VERSION` は上がらない。

### B18 SRT 字幕と MP4 Artifact パスの公開（C7 / C8）

- 状態: 完了。`script.subtitles` と `artifact.get` を追加した。SRT は既存の `getScriptVersionSubtitles`、MP4 は `resolveArtifactContent` が返すデータルート内の絶対パスを返す。`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く。仕様は [spec.md](./spec.md)、実施項目は [todo.md](./todo.md)、決定記録は [ADR 0103](../adr/0103-agent-subtitles-and-artifact-path.md) を参照。
- `script.subtitles` は保存済み Script Version から SRT をオンデマンド生成し、`{ scriptVersionId, filename, mimeType, byteSize, srt }` を返す。Artifact・Job・版を作らない。タイミングは焼き込み字幕と同じ `resolveTimeline` を使う。
- `artifact.get` は `{ artifact, filePath }` を返す。`filePath` はデータルート内の実ファイルの絶対パスで、`resolveArtifactContent` が実在と記録サイズを検証する。バイトは返さない。`contentUrl` はブラウザ用で media session Cookie が必要なため、エージェントは `filePath` を使う。
- 完了条件: ソケット・MCP・CLI から `script.subtitles` が取れ、`job.get` の Artifact ID から `artifact.get` で MP4 の絶対パスが取れる。欠損・サイズ不一致・未知 ID は `RESOURCE_NOT_FOUND`。`operationDigest` と `schemaDigest` が変わり、`AGENT_PROTOCOL_VERSION` は上がらない。

### B19 Artifact のワークスペース書き出し（C8 拡張）

- 状態: 完了。`artifact.export` を追加した。正本はデータルートに残したまま、`outputDir`（任意の絶対ディレクトリ）へコピーし、`{ artifact, sourcePath, exportedPath }` を返す。既存ファイルは上書きしない。`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く。仕様は [spec.md](./spec.md)、実施項目は [todo.md](./todo.md)、決定記録は [ADR 0104](../adr/0104-agent-artifact-export.md) を参照。
- レンダー Job の成功と書き出しの失敗を分離するため、`render.start` には `outputDir` を載せず、レンダー後の独立した mutation にした。
- コピーは `COPYFILE_FICLONE`（APFS の copy-on-write）を試し、未対応なら通常コピーにする。同一ディレクトリの一時ファイルからハードリンクして原子的に公開し（未対応なら排他的コピー）、既存名とは競合させる。
- `filename` は basename のみで、Artifact の拡張子に一致する必要がある。省略時は Work タイトルと Artifact ID から生成する。
- 完了条件: ソケット・MCP・CLI から `artifact.export` で MP4 を任意の絶対ディレクトリへ書き出せ、既存ファイルは上書きされず `EXPORT_TARGET_EXISTS`、相対パス・不存在・不正名は `VALIDATION_ERROR`、コピー失敗は `EXPORT_FAILED` になる。`operationDigest` と `schemaDigest` が変わり、`AGENT_PROTOCOL_VERSION` は上がらない。

### B20 Face Set の作成・部分更新・合成プレビュー（C9〜C11）

- 状態: 完了。`faceSet.create` / `faceSet.update` / `faceSet.usages`（mutation）と `preview.faceSet`（画像 read）を追加した。既存の Face Set サービスを呼び、部分更新と改訂版の作成、作品からの参照確認、未保存プレビューのラスタライズをそのまま使う。`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く。仕様は [spec.md](./spec.md)、実施項目は [todo.md](./todo.md)、決定記録は [ADR 0105](../adr/0105-agent-face-set-writes-and-preview.md) を参照。
- 作品は `faceSetVersion` を固定しているため、改訂版を作っても保存済みの `expressionId` は壊れない。Face Set のアーカイブ・削除は公開しない。

### B21 Asset 検索の寸法条件（C12）

- 状態: 完了。`asset.list` に完全一致の `widthPx` / `heightPx` と、両端を含む範囲の `widthMinPx` / `widthMaxPx` / `heightMinPx` / `heightMaxPx` を追加した。絞り込みは既存の検索と同じ DB クエリで行い、索引と migration は増やしていない。`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く。仕様は [spec.md](./spec.md)、実施項目は [todo.md](./todo.md)、決定記録は [ADR 0106](../adr/0106-agent-asset-dimension-filters.md) を参照。
- 完全一致と範囲は併用でき、すべて AND で評価する。寸法を持たない素材（音声など）は完全一致にも範囲にも一致しない。範囲の逆転、または完全一致が指定範囲の外にある指定は `VALIDATION_ERROR` とする。
- 向き（landscape / portrait / square）と寸法順の並べ替えは追加しない。寸法は Asset の DTO で返るため、エージェント側で必要なら判定できる。DB 索引と migration は追加しない。
- 完了条件: ソケット・MCP・CLI から `asset.list` の完全一致・範囲・併用が効き、寸法を持たない素材が除外され、矛盾した指定が `VALIDATION_ERROR` になる。`operationDigest` と `schemaDigest` が変わり、`AGENT_PROTOCOL_VERSION` は上がらない。

### B22 Asset の可逆な整理（C13）

- 状態: 完了。`asset.update`（mutation）を追加し、`{ assetId, favorited?, archived? }` で素材のお気に入りとアーカイブを切り替える。既存の `updateAsset` をそのまま呼ぶ。`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く。仕様は [spec.md](./spec.md)、実施項目は [todo.md](./todo.md)、決定記録は [ADR 0107](../adr/0107-agent-asset-organization.md) を参照。
- 少なくとも1つの項目を必須とし、項目なしは `VALIDATION_ERROR`、未知の素材は `RESOURCE_NOT_FOUND`。タグは既存の `asset.update` が担い、`asset.update` には含めない。`requestId` は持たず、冪等台帳に載せない（タイムアウト後は `asset.get` で確認する）。
- アーカイブは行を残して既定の `asset.list` とピッカーから隠すだけで、台本の参照・Job・レンダーを壊さない。`archived: false` で解除でき、アーカイブ済みは `asset.list` の `archived: "only"` で見つけられる。`asset.delete` は人専用のまま残す。
- 完了条件: ソケット・MCP・CLI から `asset.update` でお気に入り・アーカイブを設定・解除でき、既定の検索から隠れ、`archived: "only"` で発見でき、未知 ID は `RESOURCE_NOT_FOUND`、項目なしは `VALIDATION_ERROR`、`asset.delete` は `AGENT_OPERATION_UNKNOWN` のままである。`operationDigest` と `schemaDigest` が変わり、`AGENT_PROTOCOL_VERSION` は上がらない。

## 次期候補（C1〜C16）

B1〜B14 の後、または並行して検討する候補である。C1〜C8 は B15〜B18 として実装し、C8 の書き出しを B19 で拡張した。C9〜C11 は B20、C12 は B21、C13 は B22 として実装した。C14〜C16 は実装範囲・優先順位・設計をまだ決めていない。**着手するときに** [spec.md](./spec.md)・[todo.md](./todo.md) と必要な ADR を書き、この表を更新する。C 番号は議論用の識別子で、実施順を意味しない。

- 台本の中身は `script.save` で全文書を書けるため、「公開されていない編集操作」は実質的な穴ではない。C の中心は台本の外側（ライブラリ・成果物・診断）である。
- 可逆性の基準（[ADR 0074](../adr/0074-agent-direct-reversible-operations.md)）と人専用の境界（削除・外部公開・Adapter 設定）は C でも変えない。
- C7 / C8 は [エージェントMP4制作ロードマップ](../agent-mp4-production/roadmap.md) の「納品物」と同じ候補である。こちらは Agent Access 側の受け皿として扱う。
- C9〜C11 の Face Set の更新方法は B20 で決めた（[ADR 0105](../adr/0105-agent-face-set-writes-and-preview.md)）。
- C12 の寸法条件は B21、C13 の素材整理は B22 で決めた（[ADR 0106](../adr/0106-agent-asset-dimension-filters.md) / [ADR 0107](../adr/0107-agent-asset-organization.md)）。

| ID | 候補 | 種別 | 何を開くか | 価値・注意 |
| --- | --- | --- | --- | --- |
| C1（実装済み） | フォントカタログの読み取り | read | `font.list`（family / PostScript 名 / weight / style / 利用可否） | B15 で実装。検索・ページング付きで返す |
| C2（実装済み） | 過去 Revision の Theme 読み取り | read | `theme.get` の `version` 任意化 | B15 で実装。アーカイブ済み Theme の Revision も読める。`theme.list` の latest 限定は維持する |
| C3（実装済み） | フォント診断の読み取り | read | `theme.diagnose` | B15 で実装。Theme Revision を対象に role 解決と欠落フォントを返す |
| C4（実装済み） | Theme の作成・編集・公開 | mutation | `theme.create` / `theme.draft.save` / `theme.draft.get` / `theme.publish` | B16 で実装。Draft は可変で既存 Revision を壊さない。公開時に Draft は破棄され Revision が増える。アーカイブ・削除は人専用のまま |
| C5（実装済み） | Theme Draft の PNG プレビュー | read | `preview.theme`（代表サンプルを PNG 化） | B16 で実装。未保存の定義を渡して PNG を得る。DB・Draft・Revision を作らない |
| C6（実装済み） | Voice Adapter の一覧 | read | `voiceAdapter.list` | B17 で実装。HTTP `/voice-adapters` の静的説明子だけを返し、接続設定は返さない |
| C7（実装済み） | SRT 字幕の取得 | read | `script.subtitles`（保存版から SRT） | B18 で実装。Artifact を作らずオンデマンド生成。タイミングは `resolveTimeline` と同一 |
| C8（実装済み） | MP4 Artifact の取得と書き出し | read / mutation | `artifact.get`（絶対パス）、`artifact.export`（任意の絶対ディレクトリへコピー） | B18 / B19 で実装。バイトは返さず、正本の `filePath` と書き出し先の `exportedPath` を返す。既存ファイルは上書きしない |
| C9（実装済み） | Face Set の作成 | mutation | `faceSet.create` | B20 で実装。顔レイヤーは同寸・透過の ready 画像で `normal` が必須。寸法は既存サービスが検証するが透過は検証しない。品質確認は C11 |
| C10（実装済み） | Face Set の差分編集 | mutation | `faceSet.update` / `faceSet.usages` | B20 で実装。省略項目は不変の部分更新で、内容変更時だけ改訂版を作る。作品は固定版を使い続けるため、Expression ID の消失で保存済み台詞は壊れない。ライブラリ Character は最新版へ即時追従する |
| C11（実装済み） | Face Set の合成プレビュー | read | `preview.faceSet`（ベース外観＋表情の PNG） | B20 で実装。未保存の下書きをベース画像の寸法で合成する。DB・Job・Artifact を作らない |
| C12（実装済み） | Asset 検索の寸法条件 | read | `asset.list` の `widthPx` / `heightPx`（完全一致）と `widthMinPx` / `widthMaxPx` / `heightMinPx` / `heightMaxPx`（両端を含む範囲） | B21 で実装。表情レイヤー・背景の「同寸画像」を探す。向きは追加していない |
| C13（実装済み） | Asset の可逆な整理 | mutation | `asset.update` の `favorited` / `archived` | B22 で実装。削除は人専用のまま。アーカイブは既定の検索から隠すだけで参照は壊さない |
| C14（実装済み） | Character 外観の差分操作 | mutation | `character.addAppearance` / `character.updateAppearance` | B23 で実装。1件追加（全項目）と部分更新（省略＝不変、null＝解除）を公開し、作品コピーの ID 参照を維持する |
| C15（実装済み） | 未保存 ContentDocument のプレビュー | read | `preview.scriptFrame` の下書き対応 | C15 で実装。`{ content, languageEditionId?, timeMs }` を受け、版を作らず PNG を返す。`scriptVersionId` は `null` になる |
| C16 | 音声の自動検査 | read | `tts.inspect` / `preview.audio`（長さ・ラウドネス・無音） | エージェントは音を聴けないため、無音 TTS を検出できない。新しい解析能力の要否から決める |

### 着手時に決めた論点（B20）

C9〜C11 は次のとおり決めた。決定は [ADR 0105](../adr/0105-agent-face-set-writes-and-preview.md) と spec.md / todo.md に記録する。

- Face Set の更新（改訂版の作成）は公開する。省略項目を変えない部分更新にし、内容変更時だけ改訂版を作る。ライブラリ Character は最新版へ即時追従するが、作品は `faceSetVersion` を固定しているため保存済み `expressionId` の参照崩れは起きない。影響確認は `faceSet.usages`、寸法は `preview.faceSet` と保存時検証で担う。
- C9 / C10 / C11 は 1 フェーズ（B20）にまとめた。preview は作成・更新の品質確認であり、分けると回帰テストが重複する。
- C12 / C13 の公開範囲は B21 / B22 で決めた（[ADR 0106](../adr/0106-agent-asset-dimension-filters.md) / [ADR 0107](../adr/0107-agent-asset-organization.md)）。C14〜C16 の優先順位と実施順は引き続き未定。

## 保留する拡張

今回の拡張フェーズでは扱わない。必要になった時点で改めて計画する。

| 項目 | 保留理由 |
| --- | --- |
| タグの索引化（`AssetTag` リレーション＋インデックス） | 個人ライブラリの規模では走査コストが支配的でない。検索の留下来よさの拡張を優先した |
| 実行中操作の取消（AbortSignal の伝播） | B3-b として保留。Job 投入済み操作では取り消しの意味が薄い。長期実行の Job は `job.cancel` を使う |
| ネイティブによる接続元 UID 検証 | ファイル権限が既に同一ユーザー性を担保している |
| 既存 `character.update` の `appearances` 配列における `faceSetId` 省略時 null 解除 | 既存契約の維持と互換性を優先。MCP 説明文で警告し、将来の修正候補とする |
| `requestId` の必須化 | 必須化は破壊的変更。版上げの判断が必要な段階で行う |
| `work.create` / `work.clone` / `asset.import` への台帳適用 | 高コスト操作に絞り、台帳の汎用性を先に検証する |
| エラーカタログの公開（R1-4） | 契約の可読性提高であり、緊急度が低い |
| 素材取り込みのガードレール（R1-5） | 同一ユーザー信頼モデルの維持を優先する。許可領域設定は任意機能として将来検討 |
| 参照スコープ読み込みとキャッシュ（R3-1） | 大規模ライブラリ化した時点で必要 |
| 監査ログと帰属の可視化（R3-2） | 複数エージェント運用時に必要 |
| 視覚確認（R3-4） | 完了。[preview.frame として実装](../visual-confirmation/spec.md)。V2 で保存版・素材のレンダー前確認（`preview.scriptFrame` / `preview.assetFrame`）も追加済み |
| 外部接続・クラウド（R3-5） | 現行の非ゴールを維持 |

## 現状の制約

A9 完了時点で認識している制約である。B1〜B4・B10 の完了で大部分は解消するが、残るものは「保留する拡張」に記した。

| 制約 | 影響 | 対応 |
| --- | --- | --- |
| `schemaDigest` は操作カタログを含むが、各操作の入出力スキーマを含まない | 操作の入力追加・変更をエージェントが検知できない | B1 で解消。`operationDigest` を追加し、`schemaDigest` にも操作契約を含めた |
| ソケットの `AGENT_PROTOCOL_VERSION` は `1` のまま | 破壊的変更時に旧クライアントとの互換性を判定できない | B1 で解消（機構のみ。版は破壊的変更時に上げる） |
| `tts.create` などはタイムアウト後の再送で Job が重複し得る | 二重生成・課金・待機の無駄 | B2 で解消。任意の `requestId` で冪等台帳に記録し、再送しても Job が増えない |
| ソケットのフレームキューと接続数に上限がない | 大量要求時にメモリが膨らむ | B3 で解消。接続ごとの未処理フレーム数と同時接続数に上限を設け、超過は `AGENT_BACKPRESSURE` で返す |
| `asset.list` のタグ検索は SQLite の JSON をメモリで後フィルタする | タグ条件が厳しいとページ取得で走査が増える | B4 で解消。DB 側のクエリで絞り込む（索引化は保留） |
| 素材はファイル名・タグ・長さでしか絞り込めず、寸法では探せない | Face Set のレイヤーや背景に使う同寸画像を探すのに全件取得が必要 | B21 で解消。`asset.list` に寸法の完全一致と範囲を追加した |
| 素材のお気に入り・アーカイブは Web UI だけ | エージェントが取り込んだ素材を整理できず、ライブラリに溜まる | B22 で解消。`asset.update` で切り替えられる（削除は人専用） |
| `script.edit`/`validate` は毎回ライブラリ全体の Asset・Face Set・Character・Theme・Voice Profile を読み込む | 大規模ライブラリで編集のたびにコストがかかる | 保留 |
| `job.list` はレンダー Job のみ | TTS Job の一覧を取得できない | 解消。`kind` で `render`（既定）と `tts` を選べる。`asset_ingest` は Work に紐づかないため対象外 |
| `work.create` / `work.clone` は operation の `requestId` を持たない | タイムアウト後の再送で Work が増え得る | 解消しない。`work.list` の `createdAt` / `parentWorkId` で確認するガイド路線を維持（台帳適用は保留） |
| `asset.import` は同一ユーザーが読める任意のローカルパスを受け付ける | プロンプト注入時に意図しないファイルを複製し得る | 保留 |
| スキルの配布はリポジトリからのコピー／symlink | 導入と更新が手作業で、版の対応関係が分からない | B10 で解消。不変タグと GitHub Release から `npx skills` で導入し、`skills-lock.json` で版を固定する |
| サムネイルの作成・選択・PNG 取得は Web UI だけ | MP4 を完成させても、投稿用サムネイルは人が作り直す必要がある | B13 で解消。候補の作成・更新・primary 選択・未保存プレビュー・PNG 取得を公開した（削除・共通 Appearance の保存・プリセットは人専用） |
| Character の作成・名前/別名・外観の編集は Web UI だけ | 立ち絵付きの新規作品は、使える Character が無いと人間の作成待ちで止まる | B14 で解消。`character.create` / `character.update` を公開した（削除は人専用、外観画像は取り込み済みの ready 画像のみ） |
| Theme は最新公開 Revision しか読めない | 既存作品が参照する古い Revision を確認できず、それを複製元にもできない | B15 で解消。`theme.get` の `version` 指定で、アーカイブ済み Theme の公開 Revision も読める |
| フォントカタログとフォント診断はエージェントに無い | Theme の `fontFace` を選べず、欠落フォントもレンダー失敗でしか分からない | B15 で解消。`font.list` と `theme.diagnose` を追加した |
| Theme の作成・編集・公開は Web UI だけ | 作品の見た目をエージェントが作れず、テーマは人間の作成待ちになる | B16 で解消。`theme.create` / `theme.draft.get` / `theme.draft.save` / `theme.publish` を公開した（アーカイブ・削除は人専用） |
| テーマの見た目は HTML プレビューしかなく、エージェントが確認できない | 公開するまで色・余白・フォントの崩れに気づけない | B16 で解消。`preview.theme` が代表サンプルの PNG を返す |
| 利用できる TTS Adapter の種別をエージェントが知る手段がない | 既存 Profile が無い状態では `adapterId` を推測するしかない | B17 で解消。`voiceAdapter.list` が静的説明子を返す |
| SRT 字幕は Web UI のダウンロードだけ | エージェントが字幕を納品物として出せない | B18 で解消。`script.subtitles` が保存版から SRT を返す |
| MP4 は Web UI から人間が取得するだけ | エージェントが最終ファイルを渡せない | B18 / B19 で解消。`artifact.get` が正本の絶対パスを返し、`artifact.export` が任意の絶対ディレクトリへコピーする |
| プレビュー・レンダー品質の視覚確認は未提供 | エージェントは構文・保存検証までしか自律確認できない | B6 で render 成果物の `preview.frame` を追加。V2 で render 前の `preview.scriptFrame` / `preview.assetFrame` も追加 |

## 優先順位

| 優先 | 項目 | 理由 |
| --- | --- | --- |
| 高 | B1 操作契約ダイジェスト／版折衝の機構 | エージェントのキャッシュと互換性に直結する |
| 高 | B2 高コスト操作の冪等化 | タイムアウト再送での二重生成を防ぐ |
| 高 | B3 ソケットの流量制御 | ローカル操作面の安定性 |
| 高 | B4 素材検索の拡張 | 制作スキルの検索品質を上げる |
| 中 | R2-2 TTS 冪等化・`tts.attach` | 音声制作の反復コストを下げる。B7 で `tts.attachBulk` として実装中 |
| 中 | R2-3 Voice／Face Set／Theme 読み取り・`key` 対応 | B8 / B9 で実装済み。Theme・Face Set の読み取りと、Voice Profile・Character の可逆な書き込みに限定し、削除は人専用を維持する |
| 中 | B13 サムネイル操作の公開 | 既存サムネイルサービスの読み取り・作成・更新・選択・PNG 取得を追加する。削除・共通 Appearance の保存・プリセットは人専用に残す |
| 中 | B14 Character ライブラリ作成・更新の公開 | 既存サービスの作成・部分更新を追加する。削除は人専用に残し、外観画像は取り込み済みの ready 画像だけを使う |
| 中 | R2-4 言語版・履歴・復元 | 多言語・反復制作の入口。履歴一覧・復元・Work 複製は P4（`script.listVersions` / `script.restore` / `work.clone`）で実装済み |
| 低 | R2-5 Job 一般化 | 運用が複雑になった段階で必要 |
| 低 | R3-2 監査ログ／UI | 複数エージェント運用時に必要 |
| 低 | R3-3 スキル配布と版管理 | B10 で完了。公開タグと互換性履歴でスキルとアプリの版を対応づける |
| 低 | R3-4 視覚確認 | B6 + V2 で完了。下書き・複数フレームは将来拡張 |
| 低 | R3-5 外部接続 | 現行の非ゴールを維持 |
| 完了 | C1〜C3 フォントと Theme Revision の読み取り | B15 で実装。`font.list`・`theme.get` の version・`theme.diagnose` |
| 完了 | C4 / C5 Theme の作成・編集・公開と PNG プレビュー | B16 で実装。`theme.create` / `theme.draft.get` / `theme.draft.save` / `theme.publish` / `preview.theme` |
| 完了 | C6 Voice Adapter 一覧の公開 | B17 で実装。`voiceAdapter.list`。接続設定は返さない |
| 完了 | C7 / C8 SRT 字幕と MP4 Artifact パス | B18 で実装。`script.subtitles` / `artifact.get` |
| 完了 | C8 拡張 Artifact のワークスペース書き出し | B19 で実装。`artifact.export`。既存ファイルは上書きしない |
| 完了 | C9〜C11 Face Set 作成・部分更新・合成プレビュー | B20 で実装。`faceSet.create` / `faceSet.update` / `faceSet.usages` / `preview.faceSet`（[ADR 0105](../adr/0105-agent-face-set-writes-and-preview.md)） |
| 完了 | C12 Asset 検索の寸法条件 | B21 で実装。`asset.list` の完全一致と範囲。向き・索引は追加しない |
| 完了 | C13 Asset の可逆な整理 | B22 で実装。`asset.update` のお気に入り・アーカイブ。削除は人専用 |
| 完了 | C15 未保存 ContentDocument プレビュー | C15 で実装。`preview.scriptFrame` の `{ content, languageEditionId?, timeMs }` |
| 未定 | C14〜C16 次期候補 | 台本の外側のライブラリ・成果物・診断。着手時に優先順位と設計を決める（[次期候補](#次期候補c1c16)） |

## 変わらない原則

- エージェントは実体削除、外部公開、Adapter 設定の変更、利用者が設定していない接続先の利用を行えない。
- すべての台本変更は新しい ScriptVersion の追加であり、既存版を書き換えない。
- 操作の意味は束縛に依存しない。MCP・CLI・将来の束縛は同じ操作コアを呼ぶ。
- スキルは `schema.get` を正とし、契約を複製しない。
- 視覚品質の最終判断は人に残す。

## 更新ルール

- この文書は候補の一覧であり、実装の正は [spec.md](./spec.md) と [todo.md](./todo.md) に置く。
- 項目を実装するときは、この文書の該当項目を完了または仕様へ移し、必要なら ADR を追加する。
- 前提が変わった項目は削除してよい。優先順位は固定ではない。
- MP4出力に限定した実行計画（人間が最終確認・サムネイル・字幕・YouTube設定を行う前提）は
  [エージェントMP4制作](../agent-mp4-production/spec.md) を参照する。
