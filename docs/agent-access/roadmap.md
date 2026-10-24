# Agent Access ロードマップ

[Agent Access 仕様](./spec.md) の実装完了後の拡張候補を整理する。ここに書いたものは約束された仕様ではなく、優先順位と依存関係を共有するための計画である。実装するときは、この文書を更新したうえで [spec.md](./spec.md) と [todo.md](./todo.md) に詳細を落とす。

## 方針

- 正本は `ContentDocument` と SQLite のままとする。Agent Access は操作コアを呼ぶ薄い束縛であり、束縛ごとに業務ロジックを持たない。
- 可逆な操作だけをエージェントへ公開する。実体削除、外部サービスへの公開、Adapter 設定の変更、TTS 以外の課金生成は人に限る（[ADR 0074](../adr/0074-agent-direct-reversible-operations.md)、[ADR 0077](../adr/0077-agent-tts-on-configured-adapters.md)）。
- 互換性は「追加は自由、破壊は版を上げる」で扱う。エージェントは古いスキーマをキャッシュし得るため、契約の変更は `schemaDigest` とプロトコル版で検知できなければならない。
- スキルは `schema.get` を正とし、操作スキーマや Template 契約を複製しない。
- 個人利用のローカルアプリを前提に、運用負荷より再現性と巻き戻しやすさを優先する。

## 今回の決定

優先「高」の4項目について、実装範囲を次のとおりに決めた。決定理由は各項目の「決定理由」欄に記載する。

| 項目 | 決定 | 決定理由 |
| --- | --- | --- |
| R1-1 操作契約ダイジェスト／プロトコル版 | 機構だけ導入し、版は据え置く | `operationDigest` と対応版の範囲を用意し、破壊的変更が実際に起きた時点で初めて版を上げる。既存クライアントを壊さない |
| R1-2 変更操作の冪等化 | 高コスト操作のみ（`tts.create` / `tts.createBulk` / `render.start` / `composition.publish`） | 二重生成・二重レンダー・二重 publish が実害が大きい。台帳は汎用テーブルにして他操作への拡張余地を残す |
| R1-3 ソケット流量制御・取消・ピア確認 | 上限だけ導入し、ピア確認は文書化 | 信頼境界は `0700` ディレクトリ＋`0600` ソケットのファイル権限で担保できる。ネイティブ UID 検証と実行中操作の取消は費用に見合わない |
| R2-1 素材検索のスケール | 索引化せず、検索の停下来よさを拡張 | 個人ライブラリの規模ではタグ検索の走査コストは支配的でない。索引化（タグのリレーション化）は将来に回す |

## 実施順序

B1 → B2 → B3 → B4 の順で実装し、B5・B6・B7 は B4 の後に実装する。

| フェーズ | 対象 | 依存 | 順序の理由 |
| --- | --- | --- | --- |
| B1 | R1-1 操作契約ダイジェスト／版折衝の機構 | なし | 以降すべてが契約（入出力・ダイジェスト）を触るため、機構を先に整えるほど差分が小さい |
| B2 | R1-2 高コスト操作の冪等化 | B1 | 変更操作の中心であり副作用の重複が大きい。テーブル1つとディスパッチャのラッパで完結する |
| B3 | R1-3 ソケットの上限 | B1 | トランスポート層のみで独立。契約変更は新エラーコード1つ |
| B4 | R2-1 素材検索の拡張 | B1 | 唯一 HTTP 契約・Web UI・旧 asset-tags 仕様に跨るため、他の変更が固まってから着手する |
| B5 | 作品名の更新 | B1 | 小規模な追加操作。カタログとダイジェストの仕組みに乗る |
| B6 | 視覚確認（R3-4） | B1 | render 成果物の静止画を読むだけの操作。詳細は visual-confirmation 側で管理する |
| B7 | R2-2 TTS 冪等化・`tts.attach` | B2 | B2 の冪等台帳のうえで一括確定を載せる。Web の一括 TTS 契約は変えない |

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

## 保留する拡張

今回の4フェーズでは扱わない。必要になった時点で改めて計画する。

| 項目 | 保留理由 |
| --- | --- |
| タグの索引化（`AssetTag` リレーション＋インデックス） | 個人ライブラリの規模では走査コストが支配的でない。検索の留下来よさの拡張を優先した |
| 実行中操作の取消（AbortSignal の伝播） | B3-b として保留。Job 投入済み操作では取り消しの意味が薄い。長期実行の Job は `job.cancel` を使う |
| ネイティブによる接続元 UID 検証 | ファイル権限が既に同一ユーザー性を担保している |
| `requestId` の必須化 | 必須化は破壊的変更。版上げの判断が必要な段階で行う |
| `work.create` / `work.clone` / `asset.import` への台帳適用 | 高コスト操作に絞り、台帳の汎用性を先に検証する |
| エラーカタログの公開（R1-4） | 契約の可読性提高であり、緊急度が低い |
| 素材取り込みのガードレール（R1-5） | 同一ユーザー信頼モデルの維持を優先する。許可領域設定は任意機能として将来検討 |
| 参照スコープ読み込みとキャッシュ（R3-1） | 大規模ライブラリ化した時点で必要 |
| 監査ログと帰属の可視化（R3-2） | 複数エージェント運用時に必要 |
| スキル配布と版管理（R3-3） | 導入手段の検討が先。互換判定は `operationDigest` で行える基盤が B1 で整う |
| 視覚確認（R3-4） | 完了。[preview.frame として実装](../visual-confirmation/spec.md)。V2 で保存版・素材のレンダー前確認（`preview.scriptFrame` / `preview.assetFrame`）も追加済み |
| 外部接続・クラウド（R3-5） | 現行の非ゴールを維持 |

## 現状の制約

A9 完了時点で認識している制約である。B1〜B4 の完了で大部分は解消するが、残るものは「保留する拡張」に記した。

| 制約 | 影響 | 対応 |
| --- | --- | --- |
| `schemaDigest` は操作カタログを含むが、各操作の入出力スキーマを含まない | 操作の入力追加・変更をエージェントが検知できない | B1 で解消。`operationDigest` を追加し、`schemaDigest` にも操作契約を含めた |
| ソケットの `AGENT_PROTOCOL_VERSION` は `1` のまま | 破壊的変更時に旧クライアントとの互換性を判定できない | B1 で解消（機構のみ。版は破壊的変更時に上げる） |
| `tts.create` などはタイムアウト後の再送で Job が重複し得る | 二重生成・課金・待機の無駄 | B2 で解消。任意の `requestId` で冪等台帳に記録し、再送しても Job が増えない |
| ソケットのフレームキューと接続数に上限がない | 大量要求時にメモリが膨らむ | B3 で解消。接続ごとの未処理フレーム数と同時接続数に上限を設け、超過は `AGENT_BACKPRESSURE` で返す |
| `asset.list` のタグ検索は SQLite の JSON をメモリで後フィルタする | タグ条件が厳しいとページ取得で走査が増える | B4 で解消。DB 側のクエリで絞り込む（索引化は保留） |
| `script.edit`/`validate` は毎回ライブラリ全体の Asset・Face Set・Character を読み込む | 大規模ライブラリで編集のたびにコストがかかる | 保留 |
| `job.list` はレンダー Job のみ | TTS Job の一覧を取得できない | 解消。`kind` で `render`（既定）と `tts` を選べる。`asset_ingest` は Work に紐づかないため対象外 |
| `work.create` / `work.clone` は operation の `requestId` を持たない | タイムアウト後の再送で Work が増え得る | 解消しない。`work.list` の `createdAt` / `parentWorkId` で確認するガイド路線を維持（台帳適用は保留） |
| `asset.import` は同一ユーザーが読める任意のローカルパスを受け付ける | プロンプト注入時に意図しないファイルを複製し得る | 保留 |
| スキルの配布はリポジトリからのコピー／symlink | 導入と更新が手作業で、版の対応関係が分からない | 保留 |
| プレビュー・レンダー品質の視覚確認は未提供 | エージェントは構文・保存検証までしか自律確認できない | B6 で render 成果物の `preview.frame` を追加。V2 で render 前の `preview.scriptFrame` / `preview.assetFrame` も追加 |

## 優先順位

| 優先 | 項目 | 理由 |
| --- | --- | --- |
| 高 | B1 操作契約ダイジェスト／版折衝の機構 | エージェントのキャッシュと互換性に直結する |
| 高 | B2 高コスト操作の冪等化 | タイムアウト再送での二重生成を防ぐ |
| 高 | B3 ソケットの流量制御 | ローカル操作面の安定性 |
| 高 | B4 素材検索の拡張 | 制作スキルの検索品質を上げる |
| 中 | R2-2 TTS 冪等化・`tts.attach` | 音声制作の反復コストを下げる。B7 で `tts.attachBulk` として実装中 |
| 中 | R2-3 Voice／Face Set 読み取り・`key` 対応 | 制作往復を減らす |
| 中 | R2-4 言語版・履歴・復元 | 多言語・反復制作の入口。履歴一覧・復元・Work 複製は P4（`script.listVersions` / `script.restore` / `work.clone`）で実装済み |
| 低 | R2-5 Job 一般化 | 運用が複雑になった段階で必要 |
| 低 | R3-2 監査ログ／UI | 複数エージェント運用時に必要 |
| 低 | R3-4 視覚確認 | B6 + V2 で完了。下書き・複数フレームは将来拡張 |
| 低 | R3-5 外部接続 | 現行の非ゴールを維持 |

## 変わらない原則

- エージェントは実体削除、外部公開、Adapter 設定の変更、TTS 以外の課金生成を行えない。
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
