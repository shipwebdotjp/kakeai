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

### [x] P2 作品と言語版と台本版

- [x] POST /works（Work + ja-JP Edition + 初期v1 ScriptVersionを1トランザクションで作成）
- [x] 作品一覧・取得・名称変更・削除（子Workガード、カスケード）
- [x] 現在台本・版履歴・保存（last-write-wins、テキストあふれは `meta.warnings`）・特定版取得
- [x] DTO変換でPrismaの `BigInt`（byteSize）を安全整数チェック付き `Number` へ変換する
- [x] Web UI: 作品一覧、新規作成、初期5シーンの編集フォーム、明示保存
- 完了条件: 作成→保存→再起動→再編集できる。

### [x] P3 素材ライブラリと取り込み

- [x] POST /assets（multipart、SHA-256重複排除、原本確定、asset_ingest Job投入）
- [x] APIプロセス内workerループの骨格（queued取得は `updateMany` のbest-effort）
- [x] asset_ingest: 形式・長さ・寸法の検査とメタデータ記録、原本を直接使えない場合のみ正規化Rendition作成
- [x] content / render-content 配信（Range対応、メディアCookie認可）、一覧・削除（ASSET_IN_USE）
- [x] Web UI: 素材一覧とアップロード、状態表示
- 完了条件: 画像/動画/音声を投入→ready→`<video>` Range再生、未参照削除。

### [x] P4 プレビュー

- [x] `packages/video`: ContentDocument→Composition HTMLコンパイラと5 VisualTemplate、`assetResolver` 注入
- [x] GET /script-versions/:id/preview
- [x] Web UI: HyperFrames Playerで保存済み台本を表示
- 完了条件: 保存済み台本が実素材でPlayer表示される（縦切りの前半）。

### [x] P5 レンダー

- [x] POST /script-versions/:id/render-jobs（入力スナップショットを固定）
- [x] worker render: スナップショット展開→`@hyperframes/producer` でMP4生成→Artifact確定
- [x] GET /jobs/:id ポーリング、GET /works/:id/jobs 履歴、POST /jobs/:id/cancel（queuedのみ）
- [x] Artifact配信（Range）、Web UIのレンダー履歴とMP4再生
- 完了条件: 作成→保存→プレビュー→レンダー→`<video>`再生・シークをオフラインで完了（縦切り完了）。

### [x] P6a 可変Sceneとビジュアル素材編集

- [x] `explanation-scenes@1` を導入し、導入→要点0件以上→結びのScene構成と初期の要点3件を契約化する
- [x] 未参照の `explanation-5-scenes@1` を置換し、作品作成・保存・プレビュー・レンダーを可変Sceneに対応させる
- [x] Web UI: 要点Sceneの追加・削除・並べ替え。追加時だけIDを発行し、保存・移動では既存IDを維持する
- [x] Web UI: 各SceneにScene全体の背景とカードを各1件選択・解除する。背景は最背面、カードはその上とする
- [x] Web UI: 画像・動画の素材ピッカーとピッカー内アップロード。`ready`以外の素材は選択不可にする
- [x] Web UI: カードの見出し・補足文を編集する。背景クロップは中央固定とする
- [x] UI未対応の複数Cue、`lines`／`offset`範囲、他のVisualTemplateを非破壊で保持する
- 完了条件: 要点数を変え、背景・カードを選択して保存、プレビュー、レンダーできる。未対応Cueを含むContentDocumentを保存しても値を失わない。

### [x] P6b 時間・字幕・音声

- [x] auto/fixed のScene尺計算、字幕区間の解決、先頭/末尾パディングと末尾無音
- [x] 焼き込み字幕、セリフ音声の登録順配置、Audio Take候補の追加・選択・解除・削除
- [x] Web UI: セリフ音声とBGMの素材ピッカーおよびピッカー内アップロード。新規Takeは `source=manual` とAssetの確定尺を使う
- [x] Web UI: 作品全体のBGMを1曲指定し、`loop` と `gainDb` を編集する。既定値は `loop=true`、`gainDb=-18`
- [x] 固定尺で音声合計超過時は `RENDER_INPUT_INVALID`
- [x] Web UI: 算出後の尺と各ライン区間の表示、固定尺への切替
- [x] UI未対応のScene別・複数BGM・SFXを非破壊で保持する
- 完了条件: 自動尺・固定尺・字幕区間・音声候補・作品全体BGMの受け入れ条件を満たす。

### [x] P6c 立ち絵

- [x] Characterと画像のCharacter Appearanceを手動で登録・編集する。SpeakerとCharacterの対応は任意とし、表示を音声選択へ暗黙連動させない
- [x] Web UI: 各Sceneに `character.standing@1` を最大1件、`{ "kind": "scene" }` で選択・解除する。立ち絵は位置と倍率を編集できる
- [x] 立ち絵はreadyな画像素材だけを使い、背景→カード→立ち絵→Scene本文・字幕の順で描画する
- [x] UI未対応の複数立ち絵、`lines`／`offset`範囲、他のVisualTemplateを非破壊で保持する
- [x] 表情自動切替・口パクは追加しない
- 完了条件: 手動で登録した立ち絵をSceneごとに選択し、保存、プレビュー、レンダーできる。

### [ ] P7 ライフサイクルと堅牢性

- [ ] API起動時に `running` のまま残ったJobを `WORKER_INTERRUPTED` で掃除
- [ ] Work削除のカスケード、Artifact/未参照Assetの明示削除、起動時の孤立ファイル清掃
- [ ] テンプレート版のGC条件（参照ゼロで削除可）
- [ ] 版の掃除
- 完了条件: 削除・清掃・が動く。

## MVP後（ロードマップへ記載済み）

- [ロードマップ Phase 1](./roadmap.md#phase-1-編集表現の拡張): 背景・カードの焦点位置、複数VisualCue、表示区間、Scene別・複数BGM、SFX、立ち絵の区間別切替、table/chart/flow系VisualTemplate
- [ロードマップ Phase 5](./roadmap.md#phase-5-派生コンテンツと制作運用): progressPercentに依存した詳細進捗表示、実行中Jobのキャンセル、複数worker、自動再試行、contentHash/JCS、Jobリース、楽観ロック、同一SHA復旧の厳密化
