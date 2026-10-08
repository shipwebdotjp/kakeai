# 実装TODO

MVPの実装フェーズ。各フェーズは独立して検証できる粒度で切り、上から順に進める。詳細な仕様は [spec.md](./spec.md)、台本の契約は [content-schema.md](./content-schema.md)、HTTP契約は [api-contract.md](./api-contract.md) を正とする。

## 進め方

- 契約を先に固める。`packages/contracts` がZodスキーマと型の唯一の定義場所。
- 縦切りを早く通す。P4（プレビュー）とP5（レンダー）で実素材の取り込みからMP4出力までを継続的に検証する。
- 判断を変えたら文書を直す。ADRを反転させる場合は新しいADRを追加し、旧ADRに `superseded`/`amended` を付ける。

## フェーズ

### [x] P0 基盤

- [x] npm workspaces のmonorepo構成
- [x] `packages/contracts`: ContentDocument v1、DTO、error envelope、Job入力スナップショットunion
- [x] 5つのVisualTemplate入力スキーマとレジストリ
- 完了条件: `npm run typecheck` と `npm test` が通り、v1ドキュメントの検証が成立する。

### [x] P1 永続化とAPI土台

- [x] Prisma 7モデル（Work/LanguageEdition/ScriptVersion/Asset/AssetRendition/Job/Artifact）とSQLite（WAL、busy timeout）
- [x] データルート解決（OSのアプリデータ領域、開発時 `KAKEAI_DATA_DIR`）と `db/` `assets/` `artifacts/` `tmp/` の分離
- [x] Expressシェル: `/api/v1/health`、`{data}`/`{error}` envelope、requestId、厳密な `Host`/`Origin` 検証、メディアセッションCookie発行ヘルパとcontent配信ガード
- 完了条件: `/health` が応答し、DBがmigrateでき、保護が効く。

### [ ] P2 作品と言語版と台本版

- [ ] POST /works（Work + ja-JP Edition + 初期v1 ScriptVersionを1トランザクションで作成）
- [ ] 作品一覧・取得・名称変更・削除（子Workガード、カスケード）
- [ ] 現在台本・版履歴・保存（last-write-wins、テキストあふれは `meta.warnings`）・特定版取得
- [ ] DTO変換でPrismaの `BigInt`（byteSize）を安全整数チェック付き `Number` へ変換する
- [ ] Web UI: 作品一覧、新規作成、固定5シーンの編集フォーム、明示保存
- 完了条件: 作成→保存→再起動→再編集できる。

### [ ] P3 素材ライブラリと取り込み

- [ ] POST /assets（multipart、SHA-256重複排除、原本確定、asset_ingest Job投入）
- [ ] APIプロセス内workerループの骨格（queued取得は `updateMany` のbest-effort）
- [ ] asset_ingest: 形式・長さ・寸法の検査とメタデータ記録、原本を直接使えない場合のみ正規化Rendition作成
- [ ] content / render-content 配信（Range対応、メディアCookie認可）、一覧・削除（ASSET_IN_USE）
- [ ] Web UI: 素材一覧とアップロード、状態表示
- 完了条件: 画像/動画/音声を投入→ready→`<video>` Range再生、未参照削除。

### [ ] P4 プレビュー

- [ ] `packages/video`: ContentDocument→Composition HTMLコンパイラと4 VisualTemplate、`assetResolver` 注入
- [ ] GET /script-versions/:id/preview
- [ ] Web UI: HyperFrames Playerで保存済み台本を表示
- 完了条件: 保存済み台本が実素材でPlayer表示される（縦切りの前半）。

### [ ] P5 レンダー

- [ ] POST /script-versions/:id/render-jobs（入力スナップショットを固定）
- [ ] worker render: スナップショット展開→`@hyperframes/producer` でMP4生成→Artifact確定
- [ ] GET /jobs/:id ポーリング、GET /works/:id/jobs 履歴、POST /jobs/:id/cancel（queuedのみ）
- [ ] Artifact配信（Range）、Web UIのレンダー履歴とMP4再生
- 完了条件: 作成→保存→プレビュー→レンダー→`<video>`再生・シークをオフラインで完了（縦切り完了）。

### [ ] P6 時間・字幕・音声

- [ ] auto/fixed のScene尺計算、字幕区間の解決、先頭/末尾パディングと末尾無音
- [ ] 焼き込み字幕、セリフ音声の登録順配置、BGMのAudioCue
- [ ] 固定尺で音声合計超過時は `RENDER_INPUT_INVALID`
- [ ] Web UI: 算出後の尺と各ライン区間の表示、固定尺への切替
- 完了条件: 自動尺・固定尺・字幕区間・音声配置・BGMの受け入れ条件を満たす。

### [ ] P7 ライフサイクルと堅牢性

- [ ] API起動時に `running` のまま残ったJobを `WORKER_INTERRUPTED` で掃除
- [ ] Work削除のカスケード、Artifact/未参照Assetの明示削除、起動時の孤立ファイル清掃
- [ ] 容量警告（80GiB）とリソース上限、healthのstorage表示
- [ ] テンプレート版のGC条件（参照ゼロで削除可）
- [ ] 代表素材でのレンダー回帰テスト
- 完了条件: 削除・清掃・容量警告・回帰テストが動く。

## 後回し（MVP対象外）

- progressPercent に依存した詳細進捗表示
- chart/table/flow 系VisualTemplate
- Speaker/Character の編集UI（契約と既定値のみ持つ）
- 実行中Jobのキャンセル、複数worker、自動再試行
- contentHash/JCS、Jobリース、楽観ロック、同一SHA復旧の厳密化
